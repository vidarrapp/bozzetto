import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  Clock,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector3,
} from 'three';
import { MeshStandardNodeMaterial, RenderPipeline, WebGPURenderer, type Node } from 'three/webgpu';
import { pass, mrt, output, normalView, float, vec3, vec4, mix, uniform, uv, smoothstep } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import type { BufferGeometry } from 'three';
import { CaptureGuide, type AspectId } from './CaptureGuide';
import { Controls } from './Controls';
import { FrameStreamer } from './FrameStreamer';
import { Lighting } from './Lighting';
import type { LightingState } from './Lighting';
import { Materials } from './Materials';
import type { MaterialState } from './Materials';
import { Environment } from './Environment';
import type { EnvState } from './Environment';
import { Timeline } from './Timeline';
import type { AssetSource } from './AssetSource';
import type { Manifest, Tier } from '../types/manifest';
import { detectQuality, SHADOW_TIERS } from './quality';

/** Default lens when a project has no saved focal length (a "normal" lens). */
const DEFAULT_FOCAL_LENGTH = 50;

/** World-up axis the turntable capture spins the model about. */
const TURNTABLE_UP = new Vector3(0, 1, 0);

/** Depth-of-field aperture default (f-stop). */
const DEFAULT_FSTOP = 4;
/** Focus plane across the subject depth: 0 = front (nearest), 1 = back. */
const DEFAULT_DOF_FOCUS = 0.35;
/**
 * Depth-of-field look mapping for DepthOfFieldNode. The node ramps a circle of
 * confusion from sharp to fully blurred across a depth range, so the lens
 * controls map to: a focus band whose half-depth widens with the f-stop (deeper
 * focus at higher f), scaled by the subject radius so it's scale-independent;
 * and a maximum bokeh radius (px) that grows as the aperture opens (∝ 1/f-stop).
 * Both are look-tuning constants (subject radii, and pixels at f/1).
 */
const DOF_RANGE_SCALE = 0.12;
const DOF_BLUR_PX = 18;

/** Ambient-occlusion state (persisted in a project's `data.ao`). */
export interface AOState {
  enabled: boolean;
  /** GTAO blend strength (ignored by the SSAO fallback). */
  intensity: number;
  /** AO sample radius as a fraction of the subject radius. */
  radius: number;
}

/** Depth-of-field state (persisted in `camera.dof`). */
export interface DoFState {
  enabled: boolean;
  /** Aperture as an f-stop; lower is shallower (more blur). */
  fStop: number;
  /** Focus plane across the subject depth: 0 = front (nearest), 1 = back. */
  focus: number;
}

/** Ground presentation: a contact shadow, a fading studio floor, or a pedestal. */
export type GroundMode = 'off' | 'shadow' | 'floor' | 'pedestal';

/** Stage / presentation state (persisted in a project's `data.presentation`). */
export interface StageState {
  ground: GroundMode;
  /** Stage-surface PBR. Floor and pedestal are exclusive, so one set serves both. */
  color: string;
  roughness: number;
  metalness: number;
}

/** Visible ground disc fade (plane-UV radius from the centre): opaque within
 *  INNER, fully transparent by OUTER. The plane extends past OUTER (invisible)
 *  so it still catches shadows across its full span. */
const GROUND_FADE_INNER = 0.2;
const GROUND_FADE_OUTER = 0.36;

/** Default stage-surface PBR (the floor / pedestal share one material). */
const DEFAULT_STAGE_COLOR = '#c9c4bb';
const DEFAULT_STAGE_ROUGHNESS = 0.9;

/** Pedestal proportions: square base = subject footprint × FOOTPRINT, and the
 *  plinth height = that base × HEIGHT (a self-consistent column, independent of
 *  how tall or flat the subject is). */
const PEDESTAL_FOOTPRINT = 1.15;
const PEDESTAL_HEIGHT = 1.2;

/**
 * Scene, renderer, camera, and the single render loop (design doc §4).
 *
 * The display object is one persistent Mesh: only its geometry is swapped per
 * frame, and its material is swapped only on mode change. A single rAF loop
 * advances the timeline, resolves the current frame, swaps geometry when a
 * decoded frame is ready (holding the previous frame otherwise — no stall), and
 * renders at display refresh.
 */
export class Viewer {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly timeline: Timeline;
  readonly materials: Materials;
  readonly lighting: Lighting;
  readonly environment: Environment;
  private readonly envLoadingEl: HTMLDivElement;
  /** Crop-framing overlay for video/thumbnail capture (editor only). */
  private readonly captureGuide: CaptureGuide;

  private readonly controls: Controls;
  private readonly streamer: FrameStreamer;
  private readonly clock = new Clock();

  private readonly display = new Mesh();
  // Stage: one ground plane whose material swaps between a shadow-catcher and a
  // radial-fade studio floor, plus a pedestal box — all sized to the subject.
  private readonly ground = new Mesh();
  private readonly shadowMaterial = new ShadowMaterial({ opacity: 0.32 });
  // Floor (radial-fade) and pedestal (opaque) share one PBR look; they're never
  // shown together, so the panel exposes a single material — applied to both.
  private readonly floorMaterial = makeFloorMaterial(DEFAULT_STAGE_COLOR, DEFAULT_STAGE_ROUGHNESS);
  private readonly pedestal = new Mesh();
  private readonly pedestalMaterial = new MeshStandardNodeMaterial({
    color: DEFAULT_STAGE_COLOR,
    roughness: DEFAULT_STAGE_ROUGHNESS,
    metalness: 0,
  });
  private groundMode: GroundMode = 'shadow';
  private stageColor = DEFAULT_STAGE_COLOR;
  private stageRoughness = DEFAULT_STAGE_ROUGHNESS;
  private stageMetalness = 0;

  /** Wireframe overlay drawn on top of the current material (hotkey "w"). */
  private readonly wireframe = new Mesh();
  private readonly wireMaterial = new MeshBasicMaterial({
    wireframe: true,
    color: 0x000000,
    // Faint by default. With AO on, the overlay composites in linear HDR before
    // tone-mapping, so a low opacity still reads clearly; the panel slider tunes it.
    transparent: true,
    opacity: 0.05,
    // The overlay shares the surface geometry; keep its lines out of the depth
    // buffer so the AO pass doesn't sample them. depthTest stays on so back-facing
    // wires remain hidden behind the surface.
    depthWrite: false,
  });
  private wireframeOn = false;

  private currentMode = 'lit';
  /** Lens focal length (35mm-equivalent mm); drives the camera FOV. */
  private focalLength = DEFAULT_FOCAL_LENGTH;
  /** Frame ordinal targeted by the timeline/scrubber. */
  private targetIndex = -1;
  /** Frame ordinal whose geometry is currently displayed. */
  private displayedIndex = -1;
  private subjectBox = new Box3();
  private rafId = 0;
  /** Non-null while an offline capture holds the renderer (see beginCapture). */
  private capturing = false;
  private captureSaved: { pixelRatio: number; frame: number; playing: boolean } | null = null;
  /** Vertical axis the turntable spins the model about (its bounding-box centre). */
  private readonly turntableCenter = new Vector3();
  /** Smoothed frames-per-second, for the dev FPS meter (hotkey "t"). */
  private fps = 60;

  /**
   * Node postprocessing graph: a scene pass (colour + depth + normal via MRT)
   * composited with Ground-Truth ambient occlusion, then an optional DoF gather,
   * tone-mapped on output. Toggling an effect recomposes `pipeline.outputNode`.
   */
  private pipeline: RenderPipeline | null = null;
  private aoNode: ReturnType<typeof ao> | null = null;
  /** Pre-built graph nodes: the AO-composited colour, and the DoF gather over it. */
  private aoColor: Node | null = null;
  private dofNode: ReturnType<typeof dof> | null = null;
  /** Effective AO strength uniform (= intensity when enabled, else 0). */
  private readonly aoStrengthU = uniform(1);
  private aoEnabled = true; // AO on by default
  private aoIntensity = 1;
  private aoRadiusFraction = 0.5;
  private subjectRadius = 1;
  /** `?aodebug`: render the raw GTAO buffer (untone-mapped) and log AO params. */
  private readonly aoDebug = new URLSearchParams(location.search).has('aodebug');
  /** Depth-of-field uniforms: focus distance, focus-band range, max bokeh (px). */
  private readonly dofFocusU = uniform(1);
  private readonly dofRangeU = uniform(1);
  private readonly dofBokehU = uniform(1);
  private dofEnabled = false;
  private dofFStop = DEFAULT_FSTOP;
  private dofFocus = DEFAULT_DOF_FOCUS;
  /** Adaptive quality: trims render cost when measured FPS is low. */
  private adaptTimer = 0;
  private adaptStep = 0;

  /** Fired when the target frame changes (drives the scrubber + stage label). */
  onFrame: ((ordinal: number) => void) | null = null;
  /** Fired when play/pause changes (drives the transport play button). */
  onPlayStateChange: ((playing: boolean) => void) | null = null;

  /**
   * Build a viewer with an initialized renderer. The renderer targets WebGPU and
   * falls back to a WebGL 2 backend automatically when WebGPU is unavailable, so
   * the same node graph runs on either. Device init is async, so construction
   * goes through this factory instead of `new`; callers then `await viewer.boot()`
   * to load the first frame and start the loop.
   */
  static async create(
    container: HTMLElement,
    manifest: Manifest,
    source: AssetSource,
    options: { preserveDrawingBuffer?: boolean } = {},
  ): Promise<Viewer> {
    const renderer = new WebGPURenderer({ antialias: true });
    await renderer.init();
    return new Viewer(renderer, container, manifest, source, options);
  }

  private constructor(
    renderer: WebGPURenderer,
    private readonly container: HTMLElement,
    readonly manifest: Manifest,
    source: AssetSource,
    // preserveDrawingBuffer is a WebGL notion with no WebGPU equivalent: with the
    // render loop paused for capture, the canvas retains its last frame for
    // read-back, so the option is accepted for call-site compatibility but unused.
    options: { preserveDrawingBuffer?: boolean } = {},
  ) {
    void options;
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = 'srgb';
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      1000,
    );
    // The camera is lens-driven: a 35mm-equivalent focal length sets the FOV.
    this.focalLength = manifest.camera.focalLength ?? DEFAULT_FOCAL_LENGTH;
    this.camera.setFocalLength(this.focalLength);

    this.lighting = new Lighting(this.scene, this.renderer);
    this.materials = new Materials(source);
    this.environment = new Environment(this.scene, this.renderer, source);
    this.envLoadingEl = document.createElement('div');
    this.envLoadingEl.className = 'env-loading';
    this.envLoadingEl.textContent = 'Loading environment…';
    this.envLoadingEl.hidden = true;
    container.appendChild(this.envLoadingEl);
    this.environment.onLoading = (loading) => {
      this.envLoadingEl.hidden = !loading;
    };
    this.captureGuide = new CaptureGuide(container);

    this.currentMode = this.materials.has(manifest.defaults.material)
      ? manifest.defaults.material
      : 'lit';
    this.controls = new Controls(this.camera, this.renderer.domElement);

    const tier: Tier = manifest.config.tiers.includes('hd') ? 'hd' : 'sd';
    this.streamer = new FrameStreamer(source, manifest.frames, tier);

    this.timeline = new Timeline(
      manifest.config.frameCount,
      manifest.config.fps,
      manifest.stages,
      { loop: true, playing: manifest.defaults.playing },
    );

    this.display.castShadow = true;
    this.display.receiveShadow = true;

    // Stage geometry is sized to the subject in layoutStage(); set up the static
    // bits here. updateStage() drives visibility and the ground's material.
    this.ground.geometry = new PlaneGeometry(1, 1);
    this.ground.material = this.shadowMaterial;
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.pedestal.geometry = new BoxGeometry(1, 1, 1);
    this.pedestal.material = this.pedestalMaterial;
    // No cast shadow — a box throws an ugly hard directional slab. The plinth is
    // grounded by GTAO at the subject↔plinth contact instead, and still catches
    // the subject's shadow on its top face.
    this.pedestal.castShadow = false;
    this.pedestal.receiveShadow = true;
    this.pedestal.visible = false;
    this.scene.add(this.ground, this.pedestal);

    // Wireframe overlay shares the display geometry; toggled with "w".
    this.wireframe.material = this.wireMaterial;
    this.wireframe.visible = false;
    this.scene.add(this.wireframe);

    this.buildPipeline();

    window.addEventListener('resize', this.onResize);
  }

  /** Load the first frame, frame the subject, then start the render loop. */
  async boot(): Promise<void> {
    const start = clampOrdinal(
      this.manifest.defaults.frame,
      this.manifest.config.frameCount,
    );

    const geom = await this.streamer.ensure(start);
    this.display.geometry = geom;
    this.wireframe.geometry = geom;
    this.scene.add(this.display);
    this.displayedIndex = start;
    this.targetIndex = start;
    this.timeline.setFrame(start);

    this.fitScene(geom);

    this.setMaterial(this.currentMode);
    this.lighting.applyPreset(this.manifest.defaults.lightingPreset);
    // A saved custom rig (set in the editor) overrides the preset.
    if (this.manifest.lighting) {
      this.lighting.applyState(this.manifest.lighting as LightingState);
    }
    if (this.manifest.material) {
      this.materials.applyMaterialState(this.manifest.material as MaterialState);
    }
    if (this.manifest.environment) {
      void this.environment.applyState(this.manifest.environment as EnvState);
    }
    if (this.manifest.ao) {
      this.setAO(this.manifest.ao as AOState);
    }
    if (this.manifest.camera.dof) {
      this.setDoF(this.manifest.camera.dof);
    }
    if (this.manifest.presentation) {
      this.applyStageState(this.manifest.presentation as StageState);
    }
    // Keep the HDRI orientation in sync with the (possibly saved) rig rotation.
    this.environment.setRotation(this.lighting.getRigRotation());

    this.streamer.setPlayhead(start);
    this.onFrame?.(start);

    this.clock.start();
    this.loop();
    this.startAdaptive();
  }

  // --- transport / commands used by the UI panel -------------------------

  togglePlay(): void {
    this.timeline.togglePlay();
    this.onPlayStateChange?.(this.timeline.playing);
  }

  play(): void {
    this.timeline.play();
    this.onPlayStateChange?.(true);
  }

  pause(): void {
    this.timeline.pause();
    this.onPlayStateChange?.(false);
  }

  step(delta: number): void {
    if (delta >= 0) this.timeline.stepForward();
    else this.timeline.stepBack();
  }

  setFps(fps: number): void {
    this.timeline.setFps(fps);
  }

  setLoop(loop: boolean): void {
    this.timeline.setLoop(loop);
  }

  /** Scrub to a frame ordinal: prioritise it, holding the nearest resident. */
  scrubTo(ordinal: number): void {
    this.timeline.pause();
    this.timeline.setFrame(ordinal);
    this.onPlayStateChange?.(false);
  }

  /** Jump to a frame ordinal without changing play state (stage jumps). */
  jumpTo(ordinal: number): void {
    this.timeline.setFrame(ordinal);
  }

  setMaterial(mode: string): void {
    if (!this.materials.has(mode)) return;
    this.currentMode = mode;
    this.display.material = this.materials.get(mode);

    const lit = this.materials.isLit(mode);
    this.lighting.setShadowsEnabled(lit);
    this.display.castShadow = lit;
    this.updateStage();
  }

  getMaterial(): string {
    return this.currentMode;
  }

  // --- stage (ground: off / shadow / floor / pedestal) ------------------

  setGround(mode: GroundMode): void {
    this.groundMode = mode;
    this.layoutStage(); // the pedestal changes the ground height
    this.updateStage();
  }

  getGround(): GroundMode {
    return this.groundMode;
  }

  /** Cycle off → shadow → floor → pedestal → off (hotkey "g"). */
  cycleGround(): void {
    const order: GroundMode[] = ['off', 'shadow', 'floor', 'pedestal'];
    this.setGround(order[(order.indexOf(this.groundMode) + 1) % order.length]);
  }

  // Stage-surface PBR — applied to both the floor and pedestal materials (only
  // one is ever shown, so they read as a single material in the panel).
  setStageColor(hex: string): void {
    this.stageColor = hex;
    this.floorMaterial.color.set(hex);
    this.pedestalMaterial.color.set(hex);
  }

  setStageRoughness(value: number): void {
    this.stageRoughness = value;
    this.floorMaterial.roughness = value;
    this.pedestalMaterial.roughness = value;
  }

  setStageMetalness(value: number): void {
    this.stageMetalness = value;
    this.floorMaterial.metalness = value;
    this.pedestalMaterial.metalness = value;
  }

  getStageState(): StageState {
    return {
      ground: this.groundMode,
      color: this.stageColor,
      roughness: this.stageRoughness,
      metalness: this.stageMetalness,
    };
  }

  applyStageState(state: Partial<StageState>): void {
    if (typeof state.color === 'string') this.setStageColor(state.color);
    if (typeof state.roughness === 'number') this.setStageRoughness(state.roughness);
    if (typeof state.metalness === 'number') this.setStageMetalness(state.metalness);
    if (state.ground) this.groundMode = state.ground;
    this.layoutStage();
    this.updateStage();
  }

  /**
   * Drive the ground material and pedestal visibility from the mode: 'floor'
   * shows the fading floor, 'shadow' the shadow-catcher, 'pedestal' the plinth
   * with no ground catcher (GTAO grounds the subject↔plinth contact); everything
   * hides in unlit modes.
   */
  private updateStage(): void {
    const mode = this.materials.isLit(this.currentMode) ? this.groundMode : 'off';
    if (mode === 'floor') {
      this.ground.material = this.floorMaterial;
      this.ground.visible = true;
    } else if (mode === 'shadow') {
      this.ground.material = this.shadowMaterial;
      this.ground.visible = true;
    } else {
      this.ground.visible = false;
    }
    this.pedestal.visible = mode === 'pedestal';
  }

  /** Size + position the ground plane and pedestal to the current subject. */
  private layoutStage(): void {
    const size = this.subjectBox.getSize(new Vector3());
    const center = this.subjectBox.getCenter(new Vector3());
    const baseY = this.subjectBox.min.y;
    const footprint = Math.max(size.x, size.z, 1e-3) * PEDESTAL_FOOTPRINT;

    // Pedestal: a column under the subject, top flush with the subject base; its
    // height tracks its own footprint, so the plinth shape is consistent for any
    // subject rather than ballooning for tall ones.
    const pedH = footprint * PEDESTAL_HEIGHT;
    this.pedestal.geometry.dispose();
    this.pedestal.geometry = new BoxGeometry(footprint, pedH, footprint);
    this.pedestal.position.set(center.x, baseY - pedH / 2, center.z);

    // Ground sits at the foot of whatever stands on it (the pedestal, or the
    // subject directly). A large span so the shadow-catcher reaches the shadows.
    const standY = this.groundMode === 'pedestal' ? baseY - pedH : baseY;
    const span = Math.max(size.x, size.z) * 12 + 1;
    this.ground.geometry.dispose();
    this.ground.geometry = new PlaneGeometry(span, span);
    this.ground.position.set(center.x, standY - size.y * 0.001, center.z);
  }

  /** Rotate the whole lighting environment — directional rig + HDRI — together. */
  setRigRotation(deg: number): void {
    this.lighting.setRigRotation(deg);
    this.environment.setRotation(deg);
  }

  /** AO is available once the node pipeline built (it always does on WebGPU). */
  aoAvailable(): boolean {
    return this.aoNode !== null;
  }

  /** Smoothed frames-per-second (dev FPS meter). */
  getFps(): number {
    return this.fps;
  }

  /** Live diagnostics for the debug overlay (hotkey "t"): [label, value] rows. */
  debugInfo(): Array<[string, string]> {
    const b = this.renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    const backend = b.isWebGPUBackend ? 'WebGPU' : b.isWebGLBackend ? 'WebGL2' : '?';
    const { w, h } = this.viewportSize();
    return [
      ['fps', String(Math.round(this.fps))],
      ['backend', backend],
      ['size', `${w}×${h} @${this.renderer.getPixelRatio()}x`],
      ['material', this.currentMode],
      ['AO', this.aoEnabled ? `str ${this.aoIntensity.toFixed(2)} · rad ${this.aoRadiusFraction.toFixed(2)}` : 'off'],
      ['DoF', this.dofEnabled ? `f/${this.dofFStop} · focus ${this.dofFocus.toFixed(2)}` : 'off'],
      ['subject r', this.subjectRadius.toFixed(1)],
      ['clip', `${this.camera.near.toFixed(1)}–${this.camera.far.toFixed(0)}`],
      ['env', this.scene.environment ? 'loaded' : 'none'],
    ];
  }

  setAO(state: Partial<AOState>): void {
    if (typeof state.enabled === 'boolean') this.aoEnabled = state.enabled;
    if (typeof state.intensity === 'number') this.aoIntensity = state.intensity;
    if (typeof state.radius === 'number') {
      this.aoRadiusFraction = state.radius;
      this.applyAoRadius();
    }
    // AO stays in the graph; enabling/strength just drive the effective-strength
    // uniform (0 when disabled), so no recompile is needed.
    this.applyAoStrength();
  }

  getAOState(): AOState {
    return { enabled: this.aoEnabled, intensity: this.aoIntensity, radius: this.aoRadiusFraction };
  }

  /** DoF is available once the node pipeline built (it always does on WebGPU). */
  dofAvailable(): boolean {
    return this.dofNode !== null;
  }

  setDoF(state: Partial<DoFState>): void {
    if (typeof state.enabled === 'boolean' && state.enabled !== this.dofEnabled) {
      this.dofEnabled = state.enabled;
      this.rebuildOutput(); // include/exclude the DoF gather in the graph
    }
    if (typeof state.fStop === 'number') this.dofFStop = state.fStop;
    if (typeof state.focus === 'number') this.dofFocus = state.focus;
    this.applyDof();
  }

  getDoFState(): DoFState {
    return { enabled: this.dofEnabled, fStop: this.dofFStop, focus: this.dofFocus };
  }

  /** Set the lens (35mm-equivalent mm), dollying to keep the subject framed. */
  setFocalLength(mm: number): void {
    const oldFov = this.camera.fov;
    this.camera.setFocalLength(mm);
    this.focalLength = mm;
    this.controls.dollyForFov(oldFov, this.camera.fov);
  }

  getFocalLength(): number {
    return this.focalLength;
  }

  /** Current camera placement, persisted with the saved look (editor). */
  getCameraState(): {
    autoFrame: boolean;
    position: number[];
    target: number[];
    focalLength: number;
    dof: DoFState;
  } {
    const s = this.controls.getState();
    return {
      autoFrame: false,
      position: s.position,
      target: s.target,
      focalLength: this.focalLength,
      dof: this.getDoFState(),
    };
  }

  /** Frame the current model in place, keeping the view angle (hotkey "f"). */
  focusSubject(): void {
    const geom = this.display.geometry;
    geom.computeBoundingBox();
    if (geom.boundingBox) {
      this.subjectBox.copy(geom.boundingBox);
      this.controls.focus(this.subjectBox);
    }
  }

  toggleWireframe(): boolean {
    this.setWireframe(!this.wireframeOn);
    return this.wireframeOn;
  }

  setWireframe(on: boolean): void {
    this.wireframeOn = on;
    this.wireframe.visible = on;
    if (on) this.updateWireColor();
  }

  isWireframe(): boolean {
    return this.wireframeOn;
  }

  /** Overlay line opacity (0..1). Low values fight overlap saturation on dense meshes. */
  setWireframeOpacity(value: number): void {
    this.wireMaterial.opacity = value;
  }

  getWireframeOpacity(): number {
    return this.wireMaterial.opacity;
  }

  /** Dark wires on a light albedo, light wires on a dark one. */
  private updateWireColor(): void {
    this.wireMaterial.color.set(this.materials.albedoLuminance() > 0.5 ? 0x000000 : 0xffffff);
  }

  /** Show/hide the crop-framing guide for a capture aspect (null hides it). */
  setCaptureAspect(aspect: AspectId | null): void {
    this.captureGuide.setAspect(aspect);
  }

  getCaptureAspect(): AspectId | null {
    return this.captureGuide.getAspect();
  }

  // --- offline frame capture (reel/video export) ------------------------
  //
  // Capture renders the *live* framing at a higher resolution and lets the
  // caller crop the guide rectangle, so the export is WYSIWYG with the on-screen
  // guide. The render loop, timeline, and adaptive-quality timer are all paused
  // for the duration so nothing resizes the renderer or advances the playhead
  // mid-capture; endCapture restores the previous state exactly.

  /** Live viewport size in CSS pixels (drives the capture resolution + crop). */
  viewportSize(): { w: number; h: number } {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  /** The renderer canvas, read back per frame during capture. */
  get captureCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Enter capture mode: pause the loop and resize the renderer to `w`×`h` device
   * pixels (same aspect as the live view, just denser). The camera FOV is left
   * untouched so the framing is identical to what the guide shows.
   */
  beginCapture(w: number, h: number): void {
    if (this.capturing) return;
    this.capturing = true;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    clearTimeout(this.adaptTimer);
    this.captureSaved = {
      pixelRatio: this.renderer.getPixelRatio(),
      frame: this.timeline.frameIndex(),
      playing: this.timeline.playing,
    };
    this.timeline.pause();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    // Match the projection to the capture buffer (avoids any stretch from the
    // integer rounding of w/h) while preserving the live vertical FOV.
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Load + display one frame's geometry (no render). Used by the capture paths. */
  private async showCaptureFrame(ordinal: number): Promise<void> {
    // Keep the frame inside the streamer window so ensure() caches (not disposes)
    // the decoded geometry.
    this.streamer.setPlayhead(ordinal);
    const geom = await this.streamer.ensure(ordinal);
    this.display.geometry = geom;
    this.wireframe.geometry = geom;
    this.displayedIndex = ordinal;
  }

  /** Load + render one frame into the capture canvas (call between begin/end). */
  async renderCaptureFrame(ordinal: number): Promise<void> {
    await this.showCaptureFrame(ordinal);
    await this.renderForReadback();
  }

  /**
   * Prepare a turntable: ensure the current frame is displayed and snapshot the
   * vertical axis (its bounding-box centre) the model will spin around. The
   * camera and lighting stay fixed, so the user's framing is preserved.
   */
  async prepareTurntable(): Promise<void> {
    await this.showCaptureFrame(this.timeline.frameIndex());
    const geom = this.display.geometry;
    geom.computeBoundingBox();
    (geom.boundingBox ?? new Box3()).getCenter(this.turntableCenter);
  }

  /** Spin the held frame to `angle` (radians) about its vertical axis and render. */
  async renderTurntableAngle(angle: number): Promise<void> {
    const c = this.turntableCenter;
    // Rotate the mesh about the world-up axis through `c`: world = Ry·(local − c) + c,
    // i.e. rotation Ry(angle) with position c − Ry·c (the y term cancels).
    const offset = c.clone().sub(c.clone().applyAxisAngle(TURNTABLE_UP, angle));
    this.display.rotation.set(0, angle, 0);
    this.display.position.copy(offset);
    this.wireframe.rotation.set(0, angle, 0);
    this.wireframe.position.copy(offset);
    await this.renderForReadback();
  }

  /** Leave capture mode: restore the renderer, camera, and play state, resume. */
  endCapture(): void {
    if (!this.capturing) return;
    const saved = this.captureSaved;
    this.capturing = false;
    this.captureSaved = null;
    // Undo any turntable spin so the resumed live view sits at identity.
    this.display.rotation.set(0, 0, 0);
    this.display.position.set(0, 0, 0);
    this.wireframe.rotation.set(0, 0, 0);
    this.wireframe.position.set(0, 0, 0);
    if (saved) {
      this.renderer.setPixelRatio(saved.pixelRatio);
      this.onResize(); // restore renderer size and the live camera
      this.timeline.setFrame(saved.frame);
      if (saved.playing) this.timeline.play();
    }
    // Force the resumed loop to re-resolve the target frame (the streamer window
    // moved during capture) and re-sync the UI via onFrame.
    this.targetIndex = -1;
    this.displayedIndex = -1;
    this.clock.getDelta(); // discard time accumulated during capture
    this.loop();
  }

  /**
   * Render the current frame and read it back as a JPEG thumbnail blob. When a
   * crop guide is active the thumbnail is cropped to it, so the saved image
   * matches the framing used for the reel.
   */
  async captureThumbnail(maxWidth = 640): Promise<Blob> {
    await this.renderForReadback();
    const srcCanvas = this.renderer.domElement;
    const crop = this.captureGuide.rectFor(srcCanvas.width, srcCanvas.height);
    const sx = crop ? Math.round(crop.x) : 0;
    const sy = crop ? Math.round(crop.y) : 0;
    const sw = crop ? Math.round(crop.w) : srcCanvas.width;
    const sh = crop ? Math.round(crop.h) : srcCanvas.height;
    const scale = Math.min(1, maxWidth / sw);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for capture');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, w, h);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('thumbnail capture failed'))),
        'image/jpeg',
        0.82,
      );
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.adaptTimer);
    window.removeEventListener('resize', this.onResize);
    this.envLoadingEl.remove();
    this.captureGuide.dispose();
    this.controls.dispose();
    this.streamer.dispose();
    this.materials.dispose();
    this.environment.dispose();
    this.pipeline?.dispose();
    this.wireMaterial.dispose();
    this.shadowMaterial.dispose();
    this.floorMaterial.dispose();
    this.pedestalMaterial.dispose();
    this.ground.geometry.dispose();
    this.pedestal.geometry.dispose();
    this.renderer.dispose();
  }

  // --- internals ---------------------------------------------------------

  private fitScene(geom: BufferGeometry): void {
    geom.computeBoundingBox();
    this.subjectBox.copy(geom.boundingBox ?? new Box3());

    const sphere = this.subjectBox.getBoundingSphere(new Sphere());
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    this.applyAoRadius();
    this.applyDof(); // focus-band range scales with the subject

    const cam = this.manifest.camera;
    if (cam.position && cam.target) {
      this.controls.setState(cam.position, cam.target);
    } else if (cam.autoFrame) {
      this.controls.frameSubject(this.subjectBox);
    }
    this.lighting.fitToBounds(this.subjectBox);
    this.layoutStage();

    if (this.aoDebug) {
      // Surface the values that would explain "GTAO sees no occlusion": the
      // subject's world scale (drives the AO radius), the resolved AO radius and
      // samples, and the camera depth range (near/far against the subject
      // distance — a tiny near with a huge far wrecks depth precision).
      const size = this.subjectBox.getSize(new Vector3());
      console.log('[AO debug]', {
        subjectRadius: this.subjectRadius,
        aoRadius: this.aoNode?.radius.value,
        aoSamples: this.aoNode?.samples.value,
        aoResolutionScale: this.aoNode?.resolutionScale,
        cameraNear: this.camera.near,
        cameraFar: this.camera.far,
        targetDistance: this.controls.targetDistance(),
        subjectSize: { x: size.x, y: size.y, z: size.z },
      });
    }
  }

  /**
   * Build the node postprocessing graph: a scene pass writing colour, depth and
   * view-space normals (MRT), feeding a Ground-Truth AO node whose sample count
   * and render scale follow the device tier. The colour/AO composite is assembled
   * in rebuildOutput().
   */
  private buildPipeline(): void {
    const tier = SHADOW_TIERS[detectQuality()];
    const scenePass = pass(this.scene, this.camera);
    // GTAO reads colour, depth and view-space normals. Normals come from an MRT
    // target (read via .sample()): GTAONode's alternative depth-reconstruction
    // path dereferences the pass depth texture at shader-build time, which isn't
    // a valid texture yet, so that path fails to compile.
    scenePass.setMRT(mrt({ output, normal: normalView }));

    const aoNode = ao(
      scenePass.getTextureNode('depth'),
      scenePass.getTextureNode('normal'),
      this.camera,
    );
    aoNode.samples.value = tier.aoSamples;
    aoNode.resolutionScale = tier.aoResolutionScale;

    // Scene colour modulated by AO (effective strength 0 when disabled), then a
    // depth-of-field gather over that colour. Both nodes stay built; rebuildOutput
    // selects whether DoF is in the output, and applyAoStrength()/applyDof() drive
    // the look through uniforms — so toggling never rebuilds the graph nodes.
    const aoFactor = mix(float(1), aoNode.getTextureNode().r, this.aoStrengthU);
    const aoColor = scenePass.getTextureNode('output').mul(vec4(vec3(aoFactor), float(1)));
    const dofNode = dof(
      aoColor,
      scenePass.getViewZNode(),
      this.dofFocusU,
      this.dofRangeU,
      this.dofBokehU,
    );

    this.aoNode = aoNode;
    this.aoColor = aoColor;
    this.dofNode = dofNode;
    this.pipeline = new RenderPipeline(this.renderer);
    // In AO-debug, show the raw occlusion values (1 = unoccluded ... 0 = fully
    // occluded) without the ACES/sRGB output transform, so the buffer reads true.
    if (this.aoDebug) this.pipeline.outputColorTransform = false;
    this.applyAoStrength();
    this.applyDof();
    this.rebuildOutput();
  }

  /**
   * Select the pipeline output: the depth-of-field gather when DoF is on,
   * otherwise the AO-composited colour directly (so the DoF gather leaves the
   * graph and costs nothing). The pipeline applies tone mapping + sRGB on output.
   */
  private rebuildOutput(): void {
    if (!this.pipeline || !this.aoColor || !this.dofNode || !this.aoNode) return;
    if (this.aoDebug) {
      // Diagnostic view: the raw GTAO buffer as greyscale. Uniform white means
      // GTAO computed no occlusion anywhere (the bug we're chasing); visible dark
      // creases mean AO works and the composite/strength is the problem instead.
      this.pipeline.outputNode = vec4(vec3(this.aoNode.getTextureNode().r), float(1));
    } else {
      this.pipeline.outputNode = this.dofEnabled ? this.dofNode : this.aoColor;
    }
    this.pipeline.needsUpdate = true;
  }

  /** Drive the effective AO strength: the user intensity when enabled, else 0. */
  private applyAoStrength(): void {
    this.aoStrengthU.value = this.aoEnabled ? this.aoIntensity : 0;
  }

  /** AO sample radius scales with the subject, so the look is scale-independent. */
  private applyAoRadius(): void {
    if (!this.aoNode) return;
    const radius = this.aoRadiusFraction * this.subjectRadius;
    this.aoNode.radius.value = radius;
    // `thickness` gates which samples count as occluders — abs(viewΔz) < thickness,
    // in world units. Its default of 1 rejects every occluder on large models
    // (subjects here can be ~hundreds of units), which zeroed AO entirely. Track
    // it to the sampling radius so the depth tolerance scales with the subject.
    this.aoNode.thickness.value = radius;
  }

  /**
   * Map the aperture (f-stop) and subject scale to the DoF node's focus-band
   * range and maximum bokeh radius. The focus distance itself tracks the orbit
   * target per frame (updateDofFocus).
   */
  private applyDof(): void {
    this.dofRangeU.value = Math.max(this.dofFStop * this.subjectRadius * DOF_RANGE_SCALE, 1e-3);
    this.dofBokehU.value = DOF_BLUR_PX / this.dofFStop;
  }

  /** Track the focus plane to the orbit target, biased across the subject depth. */
  private updateDofFocus(): void {
    const focus = this.controls.targetDistance() + (this.dofFocus * 2 - 1) * this.subjectRadius;
    this.dofFocusU.value = Math.max(focus, 0.01);
  }

  /**
   * Render the scene to the canvas. The renderer is initialized up front (see
   * Viewer.create), so per-frame rendering is synchronous.
   */
  private renderOnce(): void {
    if (this.dofEnabled) this.updateDofFocus(); // focus plane tracks the orbit target
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Render and wait until the frame has settled on the canvas, so an immediate
   * read-back (drawImage during capture) sees the rendered pixels. One
   * animation-frame yield after the synchronous render lets the WebGPU canvas
   * present.
   */
  private async renderForReadback(): Promise<void> {
    this.renderOnce();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  /**
   * Adaptive quality: after a warmup, if the measured FPS is below target, shed
   * cost by lowering the device-pixel-ratio cap in two steps.
   */
  private startAdaptive(): void {
    this.adaptTimer = window.setTimeout(() => this.adapt(), 2000);
  }

  private adapt(): void {
    const TARGET = 50;
    if (this.fps >= TARGET || this.adaptStep >= 2) return;
    this.adaptStep += 1;
    this.setRenderScale(this.adaptStep === 1 ? 1.25 : 1.0);
    this.adaptTimer = window.setTimeout(() => this.adapt(), 1200);
  }

  private setRenderScale(maxRatio: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private readonly loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.1; // smoothed
    // Clamp dt so a backgrounded tab (which pauses rAF) can't return a huge
    // delta and lurch the playhead across many frames on the next visible tick.
    const dt = Math.min(raw, 0.1);

    this.timeline.update(dt);
    const target = this.timeline.frameIndex();

    if (target !== this.targetIndex) {
      this.targetIndex = target;
      this.streamer.setPlayhead(target);
      this.onFrame?.(target);
    }

    // Show the target frame if resident; otherwise hold the most recent decoded
    // frame at or before it (a frame arriving out of order must never flash ahead
    // and snap back). Fall back to the overall nearest only when nothing at or
    // behind the target is resident, e.g. a backward scrub into an unloaded gap.
    let geom = this.streamer.get(target);
    let shownIndex = target;
    if (!geom) {
      const pick =
        this.streamer.nearestResidentAtOrBefore(target) ??
        this.streamer.nearestResident(target);
      if (pick !== null) {
        geom = this.streamer.get(pick);
        shownIndex = pick;
      }
    }
    if (geom && shownIndex !== this.displayedIndex) {
      this.display.geometry = geom;
      this.wireframe.geometry = geom;
      this.displayedIndex = shownIndex;
    }

    this.controls.update();
    this.renderOnce();
  };

  private readonly onResize = (): void => {
    // A capture owns the renderer size; a stray window resize must not clobber it.
    if (this.capturing) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    // Re-apply the lens so the focal length stays fixed across aspect changes
    // (setFocalLength recomputes the FOV and the projection matrix).
    this.camera.setFocalLength(this.focalLength);
    this.renderer.setSize(w, h);
  };
}

function clampOrdinal(value: number, count: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(value)));
}

/**
 * Visible studio floor: a soft neutral plane whose alpha falls off in a circle
 * from the centre (UV-based, so the disc scales with the plane), fading into the
 * background at the edges. Receives shadows like any lit surface.
 */
function makeFloorMaterial(color: string, roughness: number): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ color, roughness, metalness: 0 });
  m.transparent = true;
  const d = uv().sub(0.5).length();
  m.opacityNode = float(1).sub(smoothstep(GROUND_FADE_INNER, GROUND_FADE_OUTER, d));
  return m;
}
