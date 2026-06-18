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
  Sphere,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
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

/** Depth-of-field defaults and blur tuning (see applyDofAperture). */
const DEFAULT_FSTOP = 4;
/** Focus plane across the subject depth: 0 = front (nearest), 1 = back. */
const DEFAULT_DOF_FOCUS = 0.35;
/** Subject back-edge blur is roughly DOF_APERTURE_C / fStop, scale-independent. */
const DOF_APERTURE_C = 0.2;
/** Cap on the (UV-space) defocus blur. Lower trims v1's highlight ringing. */
const DOF_MAX_BLUR = 0.08;

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

type BokehUniforms = {
  focus: { value: number };
  aperture: { value: number };
  maxblur: { value: number };
};

/**
 * BokehPass renders the scene into a depth target to drive the blur. A textured
 * scene.background (the blurred HDRI) would be drawn into that depth target and
 * corrupt the depth, so hide it for the depth sub-render only — the colour
 * buffer being blurred still carries the background from the RenderPass.
 */
class DofPass extends BokehPass {
  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const background = this.scene.background;
    this.scene.background = null;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.scene.background = background;
  }
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
  readonly renderer: WebGLRenderer;
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
  /** Smoothed frames-per-second, for the dev FPS meter (hotkey "t"). */
  private fps = 60;

  /** Postprocessing composer: AO (GTAO / SSAO by tier) then depth of field. */
  private composer: EffectComposer | null = null;
  private aoPass: GTAOPass | SSAOPass | null = null;
  private aoKind: 'gtao' | 'ssao' | 'none' = 'none';
  private aoEnabled = false;
  private aoRadiusFraction = 0.5;
  private subjectRadius = 1;
  /** Depth-of-field (off by default; focus tracks the orbit target). */
  private bokehPass: BokehPass | null = null;
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

  constructor(
    private readonly container: HTMLElement,
    readonly manifest: Manifest,
    source: AssetSource,
    options: { preserveDrawingBuffer?: boolean } = {},
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      // The editor preview needs this so captureThumbnail() can read the canvas.
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
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

    this.initComposer();

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

  aoAvailable(): boolean {
    return this.aoKind !== 'none';
  }

  /** GTAO exposes a blend Strength; the SSAO mobile fallback does not. */
  aoIsGtao(): boolean {
    return this.aoKind === 'gtao';
  }

  /** Smoothed frames-per-second (dev FPS meter). */
  getFps(): number {
    return this.fps;
  }

  setAO(state: Partial<AOState>): void {
    if (typeof state.enabled === 'boolean') {
      this.aoEnabled = state.enabled && this.aoKind !== 'none';
      if (this.aoPass) this.aoPass.enabled = this.aoEnabled;
    }
    if (typeof state.radius === 'number') {
      this.aoRadiusFraction = state.radius;
      this.applyAoRadius();
    }
    if (typeof state.intensity === 'number' && this.aoPass instanceof GTAOPass) {
      this.aoPass.blendIntensity = state.intensity;
    }
  }

  getAOState(): AOState {
    return {
      enabled: this.aoEnabled,
      intensity: this.aoPass instanceof GTAOPass ? this.aoPass.blendIntensity : 1,
      radius: this.aoRadiusFraction,
    };
  }

  /** Whether depth of field is available (the composer built successfully). */
  dofAvailable(): boolean {
    return this.bokehPass !== null;
  }

  setDoF(state: Partial<DoFState>): void {
    if (typeof state.enabled === 'boolean') {
      this.dofEnabled = state.enabled && this.bokehPass !== null;
      if (this.bokehPass) this.bokehPass.enabled = this.dofEnabled;
    }
    if (typeof state.fStop === 'number') this.dofFStop = state.fStop;
    if (typeof state.focus === 'number') this.dofFocus = state.focus;
    this.applyDofAperture();
  }

  getDoFState(): DoFState {
    return { enabled: this.dofEnabled, fStop: this.dofFStop, focus: this.dofFocus };
  }

  /** Aperture scales inversely with f-stop and subject size, so the look is
   *  consistent across subjects of different scales. */
  private applyDofAperture(): void {
    if (!this.bokehPass) return;
    const u = this.bokehPass.uniforms as BokehUniforms;
    u.aperture.value = DOF_APERTURE_C / (this.dofFStop * this.subjectRadius);
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

  /** Render the current frame and read it back as a JPEG thumbnail blob. */
  async captureThumbnail(maxWidth = 640): Promise<Blob> {
    this.renderFrame();
    const gl = this.renderer.domElement;
    const scale = Math.min(1, maxWidth / gl.width);
    const w = Math.max(1, Math.round(gl.width * scale));
    const h = Math.max(1, Math.round(gl.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for capture');
    ctx.drawImage(gl, 0, 0, w, h);
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
    this.aoPass?.dispose();
    this.bokehPass?.dispose();
    this.composer?.dispose();
    this.wireMaterial.dispose();
    this.renderer.dispose();
  }

  // --- internals ---------------------------------------------------------

  private fitScene(geom: BufferGeometry): void {
    geom.computeBoundingBox();
    this.subjectBox.copy(geom.boundingBox ?? new Box3());

    const sphere = this.subjectBox.getBoundingSphere(new Sphere());
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    this.applyAoRadius();
    this.applyDofAperture();
    if (this.aoPass instanceof GTAOPass) this.aoPass.setSceneClipBox(this.subjectBox);

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
   * Build the postprocessing composer: an AO pass per device tier (GTAO / SSAO)
   * followed by an optional depth-of-field pass, then tone-mapping. Each effect
   * pass toggles via `.enabled`, so the chain is only used when one is active.
   */
  private initComposer(): void {
    const tier = SHADOW_TIERS[detectQuality(this.renderer)];
    this.aoKind = tier.ao;

    try {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));

      if (this.aoKind === 'gtao') {
        const gtao = new GTAOPass(this.scene, this.camera, w, h);
        gtao.output = GTAOPass.OUTPUT.Default;
        gtao.blendIntensity = 1;
        gtao.updateGtaoMaterial({ samples: tier.aoSamples });
        this.aoPass = gtao;
        composer.addPass(gtao);
      } else if (this.aoKind === 'ssao') {
        const ssao = new SSAOPass(this.scene, this.camera, w, h);
        ssao.output = SSAOPass.OUTPUT.Default;
        this.aoPass = ssao;
        composer.addPass(ssao);
      }
      this.aoEnabled = this.aoKind !== 'none'; // AO on by default where available
      if (this.aoPass) this.aoPass.enabled = this.aoEnabled;

      // Depth of field, off by default. focus is set per-frame from the orbit
      // target; aperture is derived from the f-stop + subject scale.
      const bokeh = new DofPass(this.scene, this.camera, {
        focus: 1,
        aperture: 0,
        maxblur: DOF_MAX_BLUR,
      });
      bokeh.enabled = false;
      this.bokehPass = bokeh;
      composer.addPass(bokeh);

      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (err) {
      console.error('Composer init failed; using direct render', err);
      this.composer = null;
      this.aoPass = null;
      this.bokehPass = null;
      this.aoKind = 'none';
      this.aoEnabled = false;
      this.dofEnabled = false;
    }
  }

  private applyAoRadius(): void {
    const radius = this.aoRadiusFraction * this.subjectRadius;
    if (this.aoPass instanceof GTAOPass) this.aoPass.updateGtaoMaterial({ radius });
    else if (this.aoPass instanceof SSAOPass) this.aoPass.kernelRadius = radius;
  }

  /** Composer when an effect is on; otherwise the plain (proven) direct render. */
  private renderFrame(): void {
    if (this.composer && (this.aoEnabled || this.dofEnabled)) {
      if (this.dofEnabled && this.bokehPass) {
        // Focus tracks the orbit target, biased across the subject depth so the
        // slider can pull the focal plane to the front of the subject (the face)
        // rather than the bounding-sphere centre.
        const focus = this.controls.targetDistance() + (this.dofFocus * 2 - 1) * this.subjectRadius;
        (this.bokehPass.uniforms as BokehUniforms).focus.value = Math.max(focus, 0.01);
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Adaptive quality: after a warmup, if the measured FPS is below target, shed
   * cost in cheap-but-impactful steps (pixel ratio first, then GTAO samples).
   * The low tier is already minimal, so it's skipped.
   */
  private startAdaptive(): void {
    if (this.aoKind === 'none') return;
    this.adaptTimer = window.setTimeout(() => this.adapt(), 2000);
  }

  private adapt(): void {
    const TARGET = 50;
    if (this.fps >= TARGET || this.adaptStep >= 3) return;
    this.adaptStep += 1;
    if (this.adaptStep === 1) this.setRenderScale(1.25);
    else if (this.adaptStep === 2) this.setRenderScale(1.0);
    else if (this.aoPass instanceof GTAOPass) this.aoPass.updateGtaoMaterial({ samples: 8 });
    this.adaptTimer = window.setTimeout(() => this.adapt(), 1200);
  }

  private setRenderScale(maxRatio: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
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
    this.renderFrame();
  };

  private readonly onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    // Re-apply the lens so the focal length stays fixed across aspect changes
    // (setFocalLength recomputes the FOV and the projection matrix).
    this.camera.setFocalLength(this.focalLength);
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  };
}

function clampOrdinal(value: number, count: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(value)));
}
