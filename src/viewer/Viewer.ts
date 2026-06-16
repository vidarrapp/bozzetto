import {
  ACESFilmicToneMapping,
  Box3,
  Clock,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { BufferGeometry } from 'three';
import { Controls } from './Controls';
import { FrameStreamer } from './FrameStreamer';
import { Lighting } from './Lighting';
import type { LightingState } from './Lighting';
import { Materials } from './Materials';
import type { MaterialState } from './Materials';
import { Timeline } from './Timeline';
import type { Manifest, Tier } from '../types/manifest';
import { getTheme, onThemeChange, THEME_BG } from '../ui/theme';

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

  private readonly controls: Controls;
  private readonly streamer: FrameStreamer;
  private readonly clock = new Clock();
  private disposeTheme: () => void = () => {};

  private readonly display = new Mesh();
  private readonly ground: Mesh;
  private groundEnabled = true;

  /** Wireframe overlay drawn on top of the current material (hotkey "w"). */
  private readonly wireframe = new Mesh();
  private readonly wireMaterial = new MeshBasicMaterial({ wireframe: true, color: 0xffffff });
  private wireframeOn = false;

  private currentMode = 'lit';
  /** Frame ordinal targeted by the timeline/scrubber. */
  private targetIndex = -1;
  /** Frame ordinal whose geometry is currently displayed. */
  private displayedIndex = -1;
  private subjectBox = new Box3();
  private rafId = 0;

  /** Fired when the target frame changes (drives the scrubber + stage label). */
  onFrame: ((ordinal: number) => void) | null = null;
  /** Fired when play/pause changes (drives the transport play button). */
  onPlayStateChange: ((playing: boolean) => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    readonly manifest: Manifest,
    manifestUrl: string,
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

    this.scene.background = new Color(THEME_BG[getTheme()]);
    this.disposeTheme = onThemeChange((theme) => this.setBackground(THEME_BG[theme]));

    this.camera = new PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      1000,
    );

    this.lighting = new Lighting(this.scene, this.renderer);
    this.materials = new Materials();
    this.currentMode = this.materials.has(manifest.defaults.material)
      ? manifest.defaults.material
      : 'lit';
    this.controls = new Controls(this.camera, this.renderer.domElement);

    const tier: Tier = manifest.config.tiers.includes('hd') ? 'hd' : 'sd';
    this.streamer = new FrameStreamer(manifestUrl, manifest.frames, tier);

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

    this.streamer.setPlayhead(start);
    this.onFrame?.(start);

    this.clock.start();
    this.loop();
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

  resetView(): void {
    this.controls.reset();
  }

  /** Re-frame the camera on the current model (hotkey "f"). */
  focusSubject(): void {
    const geom = this.display.geometry;
    geom.computeBoundingBox();
    if (geom.boundingBox) {
      this.subjectBox.copy(geom.boundingBox);
      this.controls.frameSubject(this.subjectBox);
    }
  }

  setBackground(hex: string): void {
    this.scene.background = new Color(hex);
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

  /** Dark wires on a light albedo, light wires on a dark one. */
  private updateWireColor(): void {
    this.wireMaterial.color.set(this.materials.albedoLuminance() > 0.5 ? 0x1b1d21 : 0xffffff);
  }

  /** Render the current frame and read it back as a JPEG thumbnail blob. */
  async captureThumbnail(maxWidth = 640): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
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
    this.disposeTheme();
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.streamer.dispose();
    this.materials.dispose();
    this.wireMaterial.dispose();
    this.renderer.dispose();
  }

  // --- internals ---------------------------------------------------------

  private fitScene(geom: BufferGeometry): void {
    geom.computeBoundingBox();
    this.subjectBox.copy(geom.boundingBox ?? new Box3());

    if (this.manifest.camera.autoFrame) {
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

  private readonly loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    // Clamp dt so a backgrounded tab (which pauses rAF) can't return a huge
    // delta and lurch the playhead across many frames on the next visible tick.
    const dt = Math.min(this.clock.getDelta(), 0.1);

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
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}

function clampOrdinal(value: number, count: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(value)));
}
