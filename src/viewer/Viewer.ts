import {
  ACESFilmicToneMapping,
  Box3,
  Clock,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
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

/** Default lens when a project has no saved focal length (a "normal" lens). */
const DEFAULT_FOCAL_LENGTH = 50;

/** World-up axis the turntable capture spins the model about. */
const TURNTABLE_UP = new Vector3(0, 1, 0);

/** Depth-of-field defaults (persisted look state; render wiring lands later). */
const DEFAULT_FSTOP = 4;
/** Focus plane across the subject depth: 0 = front (nearest), 1 = back. */
const DEFAULT_DOF_FOCUS = 0.35;

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
  private readonly ground: Mesh;
  private groundEnabled = true;

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

  // AO and depth of field are reintroduced as a node-based PostProcessing graph
  // in a later migration phase. Until then these hold the persisted look state
  // (so saved projects round-trip) but drive no render pass: aoAvailable() and
  // dofAvailable() report false, so the panel hides the controls.
  private aoEnabled = false;
  private aoRadiusFraction = 0.5;
  private aoIntensity = 1;
  /** Depth-of-field (off by default; focus tracks the orbit target). */
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
   * Build a viewer with an initialized WebGPU renderer. WebGPU device init is
   * async, so construction goes through this factory instead of `new`; callers
   * then `await viewer.boot()` to load the first frame and start the loop.
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

    // Shadow-catching ground plane; sized/positioned once bounds are known.
    this.ground = new Mesh(
      new PlaneGeometry(1, 1),
      new ShadowMaterial({ opacity: 0.32 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Wireframe overlay shares the display geometry; toggled with "w".
    this.wireframe.material = this.wireMaterial;
    this.wireframe.visible = false;
    this.scene.add(this.wireframe);

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
    this.ground.visible = lit && this.groundEnabled;
  }

  getMaterial(): string {
    return this.currentMode;
  }

  setGround(enabled: boolean): void {
    this.groundEnabled = enabled;
    this.ground.visible = enabled && this.materials.isLit(this.currentMode);
  }

  isGroundEnabled(): boolean {
    return this.groundEnabled;
  }

  /** Rotate the whole lighting environment — directional rig + HDRI — together. */
  setRigRotation(deg: number): void {
    this.lighting.setRigRotation(deg);
    this.environment.setRotation(deg);
  }

  // AO and DoF report unavailable until the node PostProcessing graph is wired
  // back in (later migration phase); the panel hides their controls meanwhile.
  aoAvailable(): boolean {
    return false;
  }

  aoIsGtao(): boolean {
    return false;
  }

  /** Smoothed frames-per-second (dev FPS meter). */
  getFps(): number {
    return this.fps;
  }

  setAO(state: Partial<AOState>): void {
    if (typeof state.enabled === 'boolean') this.aoEnabled = state.enabled;
    if (typeof state.radius === 'number') this.aoRadiusFraction = state.radius;
    if (typeof state.intensity === 'number') this.aoIntensity = state.intensity;
  }

  getAOState(): AOState {
    return { enabled: this.aoEnabled, intensity: this.aoIntensity, radius: this.aoRadiusFraction };
  }

  dofAvailable(): boolean {
    return false;
  }

  setDoF(state: Partial<DoFState>): void {
    if (typeof state.enabled === 'boolean') this.dofEnabled = state.enabled;
    if (typeof state.fStop === 'number') this.dofFStop = state.fStop;
    if (typeof state.focus === 'number') this.dofFocus = state.focus;
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
    await this.renderFrame();
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
    await this.renderFrame();
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
    void this.loop();
  }

  /**
   * Render the current frame and read it back as a JPEG thumbnail blob. When a
   * crop guide is active the thumbnail is cropped to it, so the saved image
   * matches the framing used for the reel.
   */
  async captureThumbnail(maxWidth = 640): Promise<Blob> {
    await this.renderFrame();
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
    this.wireMaterial.dispose();
    this.renderer.dispose();
  }

  // --- internals ---------------------------------------------------------

  private fitScene(geom: BufferGeometry): void {
    geom.computeBoundingBox();
    this.subjectBox.copy(geom.boundingBox ?? new Box3());

    const cam = this.manifest.camera;
    if (cam.position && cam.target) {
      this.controls.setState(cam.position, cam.target);
    } else if (cam.autoFrame) {
      this.controls.frameSubject(this.subjectBox);
    }
    this.lighting.fitToBounds(this.subjectBox);

    // Size and drop the ground plane to the subject's base.
    const size = this.subjectBox.getSize(new Vector3());
    const center = this.subjectBox.getCenter(new Vector3());
    const span = Math.max(size.x, size.z) * 12 + 1;
    this.ground.geometry.dispose();
    this.ground.geometry = new PlaneGeometry(span, span);
    this.ground.position.set(center.x, this.subjectBox.min.y - size.y * 0.001, center.z);
  }

  /**
   * Render the current scene. WebGPU submits asynchronously, so this awaits the
   * frame; the renderer applies tone mapping and the sRGB output transform on the
   * way to the canvas. AO/DoF rejoin here as a node PostProcessing graph later.
   */
  private renderFrame(): Promise<void> {
    return this.renderer.renderAsync(this.scene, this.camera);
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

  private readonly loop = async (): Promise<void> => {
    // The render is awaited (WebGPU submits asynchronously), so schedule the next
    // frame only once it completes — this paces to display refresh when frames are
    // cheap and sheds frames naturally when they aren't, with no overlapping
    // submissions. A capture takes over the renderer, so bail without rescheduling.
    if (this.capturing) return;
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
    await this.renderFrame();
    // Re-check: a capture may have started while the frame was in flight.
    if (!this.capturing) this.rafId = requestAnimationFrame(this.loop);
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
