import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  type ToneMapping,
  Box3,
  BoxGeometry,
  Timer,
  Mesh,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector2,
  Vector3, BackSide, FrontSide, HalfFloatType, RedFormat, Quaternion } from 'three';
import { MeshStandardNodeMaterial, RenderPipeline, WebGPURenderer, type Node, MeshBasicNodeMaterial } from 'three/webgpu';
import { pass, mrt, output, normalView, float, vec2, vec3, vec4, pow, uniform, uv, smoothstep, screenSize, perspectiveDepthToViewZ, positionLocal, normalLocal, rtt, mix } from 'three/tsl';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { softAo, type SoftGTAONode } from './gtao';
import type { Matrix4, Texture } from 'three';
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
import { formatMs, perfLog, STALL_MS } from './perfLog';
import { FrameStats, ms, type FrameSummary } from './frameStats';
import { FrameClock } from './frameClock';
import { AccumulateNode, stillOffsets } from './accumulate';
import { AdaptiveQuality, type QualityKnobs } from './adaptive';
import { settings } from '../ui/settings';

/** Output grade choices (Render panel > Camera > Tone mapping). */
export type ToneMappingId = 'none' | 'neutral' | 'agx' | 'cinematic';
const TONE_MAPPINGS: Record<ToneMappingId, ToneMapping> = {
  none: NoToneMapping, // straight linear -> sRGB, nothing graded
  neutral: NeutralToneMapping, // Khronos PBR neutral: true colours, soft shoulder
  agx: AgXToneMapping, // Blender-era filmic: gentle, desaturating highlights
  cinematic: ACESFilmicToneMapping, // the shipped default
};

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

/**
 * Double-press tap-to-focus tuning, shared by touch double-tap and mouse
 * double-click. Two presses whose pointer-downs fall within DOUBLE_TAP_MS and
 * DOUBLE_TAP_DIST px of each other set focus. A "press" (tap or click) counts
 * only if it lifts having drifted under TAP_SLOP px — more is an orbit, not a
 * press. (We avoid long-press: on iOS a sustained press fires the text callout.)
 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 36;
const TAP_SLOP = 10;

/**
 * Playback buffering: when the playhead reaches a frame that isn't decoded yet,
 * the clock stalls and resumes only once this many consecutive upcoming frames
 * are resident (clamped to the sequence end). A run — rather than just the one
 * missing frame — gives hysteresis, so slow sources buffer once and then play
 * smoothly instead of stuttering frame by frame.
 */
const PLAYBACK_MIN_BUFFER = 4;

/**
 * GTAO's defaults (Render panel > Ambient occlusion > GTAO), set on a box
 * room, the default sphere on the floor and on the pedestal, a head and
 * the mannequin. The radius is a fraction of the subject's bounding
 * radius. At 0.5 it felt large for the scene (owner report) - in a box
 * room it shaded most of each wall - and the owner had settled on 0.2 with
 * the old term; this one fades towards the edge of its radius (gtao.ts),
 * so 0.3 now reaches about as far as 0.2 did. The strength is an exponent
 * on the term (see buildPipeline): 1, the term as computed, sits mid-travel.
 */
export const DEFAULT_AO = { intensity: 1, radius: 0.3 } as const;

/** The sculpt cavity's defaults: its strength, and its tap radius in pixels. */
export const DEFAULT_CAVITY = { strength: 0.9, radius: 8 } as const;

/**
 * The AO a look comes to where the cavity does not draw - the viewer, the
 * editors, a published project, Armature mode: only sculpt mode's own
 * composite has it. A look made on the cavity (GTAO off, a cavity
 * strength) asked for an AO, so it gets GTAO, at its own GTAO settings,
 * rather than none; Off (neither) and GTAO stay as they were.
 */
export function aoWithoutCavity(look: { ao: AOState; sculptAO?: { strength: number } }): AOState {
  return !look.ao.enabled && (look.sculptAO?.strength ?? 0) > 0 ? { ...look.ao, enabled: true } : look.ao;
}

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
  /**
   * Tap-to-focus lock (double-click / double-tap): a world-space point it sticks
   * to as the camera orbits/dollies. Absent means focus tracks the orbit target
   * with the `focus` bias above. Dragging the Focus slider clears it.
   */
  focusPoint?: [number, number, number];
}

/**
 * Everything the Look dev panel owns, gathered into one serialisable record:
 * the shape a project's saved look and a sculpt session's saved look share.
 */
export interface LookState {
  lighting: LightingState;
  material: MaterialState;
  environment: EnvState;
  ao: AOState;
  /** The cheap depth-SSAO ("cavity") pass, which sculpt mode uses instead. */
  sculptAO: { strength: number; radius: number };
  presentation: StageState;
  camera: {
    autoFrame: boolean;
    position: number[];
    target: number[];
    focalLength: number;
    dof: DoFState;
  };
  /** Material mode (lit / a matcap), stored as `defaults.material`. */
  materialMode: string;
  /** Output grade (absent in older saves: they get the Cinematic default). */
  toneMapping?: ToneMappingId;
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
  /** Pedestal base scale (width/depth only; height is unaffected). */
  pedestalScale: number;
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

/** Wireframe overlay: the material opacity at which each line colour reads as
 *  fully solid. The 0–1 panel slider maps onto 0..this per colour, so both white
 *  and black wires ramp invisible→solid across the whole slider rather than
 *  saturating in the first third/half. */
const WIRE_MAX_OPACITY_WHITE = 0.4;
const WIRE_MAX_OPACITY_BLACK = 0.6;

/**
 * MSAA samples for the scene pass. The renderer itself is made without
 * antialias: with it, the canvas got a 4x colour and depth buffer of its
 * own, and the only thing ever drawn there is the pipeline's full-screen
 * output quad, which has no edges to smooth. The scene pass keeps its 4x.
 * `?canvasmsaa=1` builds the old way, to compare a frame against.
 */
const SCENE_SAMPLES = 4;
const CANVAS_MSAA = new URLSearchParams(location.search).has('canvasmsaa');

/**
 * Fast frames (Viewer.updateFrameMode): how long ambient occlusion takes to
 * fade back in once the view stops, and how recently the camera must have
 * moved to count as moving (the damped coast after a drag, a wheel zoom).
 */
const AO_FADE_MS = 150;
const MOVED_WITHIN_MS = 150;
/**
 * The smallest turn (radians) or move (share of the orbit distance) in a
 * frame that counts as the camera moving: about a quarter of a pixel, so
 * the coast's last imperceptible creep does not keep the AO away.
 */
const CAMERA_STILL_EPS = 2e-4;

/** What a frame is doing, for the fast frames and the meter. */
export type InteractionKind = 'stroke' | 'move';

/**
 * Anti-aliasing (Viewer.setAntialias). 'always': the scene pass's 4x MSAA
 * on every frame, the viewer's and the embeds' way. 'still': no MSAA, and a
 * view left still is smoothed by jittered samples summed over the next
 * frames (accumulate.ts); Sculpt and Armature's default. 'off': no MSAA and
 * no smoothing on screen. Thumbnails are smooth in every mode.
 */
export type AntialiasMode = 'still' | 'always' | 'off';

/**
 * How long nothing may change before a still frame starts smoothing (ms),
 * and how many jittered samples it averages. Sixteen at 60 Hz is a quarter
 * of a second after the wait; the owner asked for a mode that kicks in on
 * a still frame, not a cost paid on every one.
 */
const STILL_AA_AFTER_MS = 1000;
const STILL_AA_SAMPLES = 16;
const STILL_OFFSETS = stillOffsets(STILL_AA_SAMPLES);

/**
 * The desktop app with v-sync off draws a frame as soon as the last is done.
 * With nothing happening for this long (no input, playback, stroke, camera
 * move or smoothing still to finish) it paces itself to the display instead
 * (Viewer.scheduleNext), so an idle window does not run the GPU flat out.
 */
const IDLE_AFTER_MS = 1000;

/** The desktop app's frame pacing, from its launch state (desktop/launch.ts). */
export interface Pacing {
  /** V-sync is off: frames are not held for the display. */
  uncapped: boolean;
  /** The display's refresh rate, from Electron (0: not known). */
  displayHz: number;
  /** Running on battery: paced to the display while working too. */
  onBattery: boolean;
}

/** Counts of the renderer's builds and allocations; see Viewer.instrumentBackend. */
export interface RenderCounters {
  /** Node graphs built into shaders. */
  nodeBuilds: number;
  /** Shader modules compiled. */
  programs: number;
  /** Render pipelines created. */
  pipelines: number;
  /** GPU textures created, render targets included (a resize is one). */
  textures: number;
  /** GPU buffers created for geometry. */
  buffers: number;
  /** Bind groups created. */
  bindGroups: number;
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
  private readonly timer = new Timer();

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
  private pedestalScale = 1;

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
  /** Wireframe panel-slider value (0..1); mapped to material opacity per colour. */
  private wireOpacity = 0.3;
  private wireIsWhite = true;
  /**
   * Sculpt mode's wireframe: the mesh's own edges as line segments, so a
   * quad reads as a quad (owner request) where the triangle wireframe above
   * would cut every one in two. One per sculpt object, a child of the
   * object's display mesh so it follows the matrix and the visibility for
   * free. Its geometry comes from a provider (GeometrySync.wireGeometry)
   * that shares the surface's positions and rebuilds only the edge index,
   * lazily, after topology changes; asked before each render while the
   * overlay is on, which costs nothing when nothing changed.
   */
  private readonly wireLineMaterial = new LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
  });
  private readonly sculptWires = new Map<Mesh, { lines: LineSegments; provider: () => BufferGeometry }>();
  private inSculpt = false;

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
  /** Smoothed frames-per-second, for the frame meter (P). */
  private fps = 60;
  /**
   * The stall watchdog's clock: when the last frame began (0 when there is
   * no frame to measure from, after a hidden tab or a capture) and how long
   * that frame's own work took.
   */
  private frameStart = 0;
  private frameWork = 0;

  /** Where each frame's time goes, for the frame meter (frameStats.ts). */
  readonly frameStats = new FrameStats();
  /** Builds and allocations since boot; see instrumentBackend. */
  private readonly counters: RenderCounters = {
    nodeBuilds: 0,
    programs: 0,
    pipelines: 0,
    textures: 0,
    buffers: 0,
    bindGroups: 0,
  };
  /** Shadow maps drawn per light since boot, counted as they render. */
  private readonly shadowRenders = { key: 0, fill: 0, rim: 0 };
  /** This browser can time the GPU with timestamp queries (WebGPU's, or WebGL's timer query). */
  private gpuTimestamps = false;
  /** The meter is up, so the GPU is timed; see setGpuTiming. */
  private gpuTiming = false;
  private timestampPending = false;
  private donePending = false;

  /**
   * Fast frames: while a stroke, a pose drag or the view is moving, ambient
   * occlusion holds or steps aside and the fill and rim shadows refresh
   * less often (updateFrameMode). The editors switch this on while they are
   * mounted (Sculpt, Armature); the viewer and embeds draw every frame full.
   */
  fastFrames = false;
  /** What the mounted editor is doing right now: a stroke, a drag that moves things, or neither. */
  interactionProbe: (() => InteractionKind | null) | null = null;
  /** Pins the frame mode for tests and measurements; undefined follows the probe and the camera. */
  debugInteraction: InteractionKind | null | undefined = undefined;
  /**
   * Test hook: the loop runs and paces as ever but nothing is drawn, a
   * readback's renders included, so the desktop suite can measure the
   * pacing apart from a software renderer that takes a tenth of a second
   * over every frame (and seconds over a thumbnail).
   */
  debugSkipRender = false;
  private interaction: InteractionKind | null = null;
  /** The AO texture matches the view and the scene as they are (safe to hold). */
  private aoValid = false;
  /** 0: the AO term as drawn; 1: no AO (the view is moving). Fades back on its own clock. */
  private readonly aoDropU = uniform(0);
  /** The denoised AO, drawn to a texture of its own so a stroke can hold it. */
  private aoRtt: ReturnType<typeof rtt> | null = null;
  /** Denoise passes drawn since boot. */
  private aoRttRenders = 0;
  private lastCameraMove = -Infinity;
  private readonly lastCamPos = new Vector3();
  private readonly lastCamQuat = new Quaternion();
  private frameNo = 0;
  /** Counters when the interaction under way began, and across the last whole one. */
  private interactionStart: RenderCounters | null = null;
  private lastInteractionDelta: RenderCounters | null = null;

  /** The frame clock: every render a new frame, and the only rAF loop (frameClock.ts). */
  readonly clock: FrameClock;
  /** Anti-aliasing in force; the viewer and embeds keep 'always' (setAntialias). */
  private aaMode: AntialiasMode = 'always';
  /** The still frame's sum (accumulate.ts), drawn through in 'still' and 'off'. */
  private accumulate: AccumulateNode | null = null;
  /** How many samples the sum holds, for the output to divide by. */
  private readonly aaCountU = uniform(1);
  /** Samples summed for the still frame so far (0: the frame is plain). */
  private aaSamples = 0;
  /**
   * A readback's smooth image waits on the canvas to be read: until it is,
   * the loop draws the same held image rather than going back to a plain
   * frame (the readback waits a frame for the canvas to present, and the
   * loop draws in that frame first).
   */
  private readbackHold = false;
  /** When the picture last changed (invalidate), for the still frame's wait. */
  private lastChange = 0;
  /** The scene pass, whose MSAA follows the anti-aliasing mode. */
  private scenePass: ReturnType<typeof pass> | null = null;
  /** Adaptive quality (adaptive.ts), and the tier it steps down from. */
  private readonly adaptive: AdaptiveQuality;
  /** Unsubscribes adaptive quality from Preferences (dispose). */
  private readonly offAdaptive: () => void;
  private readonly tierAoSamples: number;
  private readonly tierAoScale: number;
  private readonly startRatio: number;
  /** The desktop app's pacing; a browser leaves the defaults (setPacing). */
  private pacing: Pacing = { uncapped: false, displayHz: 0, onBattery: false };
  /** A paced frame waiting on its timer (scheduleNext), or 0. */
  private pacer = 0;
  /** When input last arrived (wake), for the idle pacing. */
  private lastInput = 0;

  /**
   * Node postprocessing graph: a scene pass (colour + depth + normal via MRT)
   * composited with Ground-Truth ambient occlusion, then an optional DoF gather,
   * tone-mapped on output. Toggling an effect recomposes `pipeline.outputNode`.
   */
  private pipeline: RenderPipeline | null = null;
  private aoNode: SoftGTAONode | null = null;
  /** The edge-aware denoise over the GTAO term (its depth tolerance follows the radius). */
  private aoDenoise: ReturnType<typeof denoise> | null = null;
  /**
   * The output composites: the viewer's (scene colour, x GTAO) and sculpt
   * mode's (x cavity, x GTAO), each without GTAO and with it.
   */
  private composites: Record<'viewer' | 'sculpt', Record<'plain' | 'ao', Node>> | null = null;
  /** DoF gathers over the composites, built as each is first wanted (owner call: DoF in sculpt). */
  private readonly dofNodes = new Map<Node, Node>();
  /** The output in the 'still' and 'off' anti-aliasing modes: the sum over its count. */
  private accumulateOut: Node | null = null;
  /** What the sum is of now (rebuildOutput rebuilds the output when it changes). */
  private accumulateInput: Node | null = null;
  private viewZNode: Node | null = null;
  /** `?aodebug` in sculpt: R = view distance/400, G = raw occlusion, B = factor. */
  private sculptAoDebugNode: Node | null = null;
  /** `?aodebug` in the viewer: the GTAO term as greyscale. */
  private aoDebugNode: Node | null = null;
  /** `?dofdebug` in viewer: the DoF chain's viewZ as distance/400 greyscale. */
  private dofViewZDebugNode: Node | null = null;
  private readonly dofDebug = new URLSearchParams(location.search).has('dofdebug');
  private sculptShading = false;
  /** Effective AO strength uniform (= intensity when enabled, else 0). */
  private readonly aoStrengthU = uniform(1);
  /** Sculpt SSAO strength and tap radius in px (tunable later in-palette). */
  private readonly cavityStrengthU = uniform(DEFAULT_CAVITY.strength);
  private readonly sculptAoRadiusU = uniform(DEFAULT_CAVITY.radius);
  private aoEnabled = true; // AO on by default
  private aoIntensity: number = DEFAULT_AO.intensity;
  private aoRadiusFraction: number = DEFAULT_AO.radius;
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
  /** Tap-to-focus lock: world point the focus plane sticks to (null = track target). */
  private dofFocusPoint: Vector3 | null = null;
  /** Double-press focus picking: ray + reusable pointer NDC. */
  private readonly picker = new Raycaster();
  private readonly pickNdc = new Vector2();
  /** Brief on-canvas confirmation flashed at a focus pick. */
  private readonly reticle: HTMLDivElement;
  /**
   * Touch double-tap → tap-to-focus state. The in-progress tap is tracked by
   * `tapPointerId`/`tapStart*`/`tapMoved`; `lastTap*` remember the previous clean
   * tap so the next one can complete a double-tap (−1 time = no tap pending).
   * `activeTouches` counts fingers down so a second one (pinch/pan) aborts it.
   */
  private tapPointerId = -1;
  private tapStartX = 0;
  private tapStartY = 0;
  private tapStartTime = 0;
  private tapMoved = false;
  private lastTapTime = -1;
  private lastTapX = 0;
  private lastTapY = 0;
  private readonly activeTouches = new Set<number>();
  /** Container box watcher: the resize source of truth (see the constructor). */
  private containerObserver: ResizeObserver | null = null;
  /** Playback is stalled waiting for PLAYBACK_MIN_BUFFER frames to decode. */
  private buffering = false;

  /** Fired when the target frame changes (drives the scrubber + stage label). */
  onFrame: ((ordinal: number) => void) | null = null;
  /** Fired when play/pause changes (drives the transport play button). */
  onPlayStateChange: ((playing: boolean) => void) | null = null;
  /** Fired when a playback stall starts/ends (drives the buffering pill). */
  onBufferingChange: ((buffering: boolean) => void) | null = null;
  /** Fired when a frame finishes decoding (drives the transport buffer bar). */
  onBufferChange: (() => void) | null = null;
  /** Loading-status messages during boot (drives the entry overlay's text). */
  onStatus: ((msg: string) => void) | null = null;
  /** Fired when DoF is toggled on/off (e.g. hotkey or a tap-to-focus that turns
   *  it on), so the panel checkbox can re-sync. */
  onDofChange: (() => void) | null = null;

  /** The adapter line's wording, reachable from the console and the tests. */
  static readonly describeAdapter = describeAdapter;

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
    // On dual-GPU machines (discrete + integrated) the default adapter can
    // land on the integrated chip; ask for the fast one explicitly.
    // Timestamps are asked for here, where the backend checks the adapter
    // can give them, and then switched off until the meter wants them
    // (setGpuTiming): three can only turn them on at construction.
    const renderer = new WebGPURenderer({
      antialias: CANVAS_MSAA,
      powerPreference: 'high-performance',
      trackTimestamp: true,
    } as ConstructorParameters<typeof WebGPURenderer>[0]);
    await renderer.init();
    const viewer = new Viewer(renderer, container, manifest, source, options);
    viewer.warnIfSoftwareRendering();
    return viewer;
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
    this.clock = new FrameClock(renderer);
    this.startRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.startRatio);
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
    this.setUpTiming();
    this.instrumentBackend();
    this.materials = new Materials(source);
    this.environment = new Environment(this.scene, this.renderer, source);
    // The lights, the materials and the environment are edited directly by
    // the panels, not through the viewer, so they say when the picture has
    // changed themselves: a still frame then starts smoothing over.
    const changed = (): void => this.invalidate();
    this.lighting.onChange = changed;
    this.materials.onChange = changed;
    this.environment.onChange = changed;
    const quality = SHADOW_TIERS[detectQuality()];
    this.tierAoSamples = quality.aoSamples;
    this.tierAoScale = quality.aoResolutionScale;
    this.adaptive = new AdaptiveQuality(this.qualityKnobs());
    // Off in Preferences, or for the e2e harness, whose software frames
    // miss every refresh and would walk every suite down the ladder.
    const adaptiveWanted = (): boolean =>
      settings.get('adaptive') === 'on' && !(window as { __bozzettoAdaptiveOff?: boolean }).__bozzettoAdaptiveOff;
    this.adaptive.setEnabled(adaptiveWanted());
    this.offAdaptive = settings.onChange(() => this.adaptive.setEnabled(adaptiveWanted()));
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
    this.streamer.onResident = () => this.onBufferChange?.();

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
    // ShadowMaterial ships with `map` left undefined (not null). Under VSM the
    // ground is a shadow receiver, so it's rendered into the shadow pass too,
    // where three gates a map lookup on `material.map !== null` — an undefined
    // map passes that gate and builds `texture(undefined)`, throwing in the
    // shadow pass the moment the catcher is shown. Normalising it to null (as
    // the node materials already are) sidesteps the lookup.
    // (@types/three doesn't declare `map` on ShadowMaterial, but the renderer
    // reads it; cast to set it.)
    (this.shadowMaterial as ShadowMaterial & { map: Texture | null }).map = null;
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
    document.addEventListener('visibilitychange', this.onVisibility);
    // iOS standalone (home-screen) apps settle their viewport AFTER load and
    // often skip the window resize event entirely, leaving a stale canvas
    // size (the render centre then sits at the visible bottom edge). A
    // ResizeObserver on the container fires on the actual box change, no
    // matter which events the platform forgot to send.
    this.containerObserver = new ResizeObserver(() => this.onResize());
    this.containerObserver.observe(container);
    // Input: a pointer over the view (hovering included: the gizmo and the
    // figure's balls light up under it), the wheel, a key, or a control
    // moved in a panel. Each wakes a paced desktop loop at once and starts
    // a still frame's wait over (onActivity).
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      this.container.addEventListener(type, this.onActivity, { capture: true, passive: true });
    }
    window.addEventListener('keydown', this.onActivity, { capture: true, passive: true });
    document.addEventListener('input', this.onActivity, { capture: true, passive: true });
    document.addEventListener('change', this.onActivity, { capture: true, passive: true });

    // Tap-to-focus: a brief reticle flashed at a double-click / double-tap pick.
    this.reticle = document.createElement('div');
    this.reticle.className = 'focus-reticle';
    this.container.appendChild(this.reticle);
    // Capture on the container so these run ahead of OrbitControls' canvas
    // handler and keep seeing the pointer even while it holds pointer capture.
    // They only track presses to spot a double-click / double-tap (tap-to-focus);
    // a single press or a drag passes straight through and orbits as normal.
    this.container.addEventListener('pointerdown', this.onPickPointer, true);
    this.container.addEventListener('pointermove', this.onTapMove, true);
    this.container.addEventListener('pointerup', this.onTapEnd, true);
    this.container.addEventListener('pointercancel', this.onTapCancel, true);
    // No touch on the canvas may start one of iOS's own gestures. A finger
    // or Pencil held still arms the long press (callout, loupe, drag lift)
    // at about 450ms whatever the CSS says, and Safari then cancels the
    // touch - which ends a press held on the model, or on an armature ball
    // before it is dragged, as if it had lifted (implementation notes,
    // WS6 round 6). Only the default goes: pointer events still arrive,
    // and nothing here relies on the click a touch would have synthesised.
    this.renderer.domElement.addEventListener('touchstart', preventTouchDefault, { passive: false });
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
    // A published model that was painted carries COLOR_0, which the loader
    // hands back as a `color` attribute. Albedo then comes from the paint,
    // exactly as it did in sculpt mode (the fill IS the material colour, so
    // unpainted areas read as their material too). materialsPBR does not
    // exist here, so only the colour half of the sculpt path switches on.
    if (geom.getAttribute('color')) this.materials.setSculptVertexColor(true);
    this.lighting.applyPreset(this.manifest.defaults.lightingPreset);
    // A saved custom rig (set in the editor) overrides the preset.
    if (this.manifest.lighting) {
      this.lighting.applyState(this.manifest.lighting as LightingState);
    }
    if (this.manifest.material) {
      this.materials.applyMaterialState(this.manifest.material as MaterialState);
    }
    if (this.manifest.environment) {
      const env = this.manifest.environment as EnvState;
      // Load the HDRI before revealing the model, so it appears already lit by it
      // rather than popping in a frame or two later.
      if (env.id) this.onStatus?.('Loading environment…');
      await this.environment.applyState(env);
    }
    if (this.manifest.ao) {
      this.setAO(this.manifest.ao as AOState);
    }
    if (this.manifest.camera.dof) {
      const d = this.manifest.camera.dof;
      this.setDoF(d);
      // Restore a saved tap-to-focus lock (after setDoF, which clears it).
      if (d.focusPoint) {
        this.dofFocusPoint = new Vector3(d.focusPoint[0], d.focusPoint[1], d.focusPoint[2]);
      }
    }
    if (this.manifest.presentation) {
      this.applyStageState(this.manifest.presentation as StageState);
    }
    // Keep the HDRI orientation in sync with the (possibly saved) rig rotation.
    this.environment.setRotation(this.lighting.getRigRotation());

    this.streamer.setPlayhead(start);
    this.onFrame?.(start);

    // Start playback pre-buffered: hold the clock until a short run of frames
    // is resident, so slow sources begin smoothly instead of sticking on the
    // first frame while the playhead silently runs ahead.
    if (this.timeline.playing && this.manifest.config.frameCount > 1) {
      this.setBuffering(true);
    }

    this.timer.update(); // establish the delta baseline before the first frame
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

  // --- playback buffering ------------------------------------------------

  /** True while a playing timeline is stalled waiting for frames to decode. */
  isBuffering(): boolean {
    return this.buffering;
  }

  /** True when the frame the playhead wants isn't decoded yet (pill state). */
  isAwaitingFrame(): boolean {
    return this.buffering || !this.streamer.has(this.timeline.frameIndex());
  }

  /** Resident frame runs (inclusive ordinals), for the transport buffer bar. */
  getBufferedRanges(): Array<[number, number]> {
    return this.streamer.bufferedRanges();
  }

  /**
   * Per-tick stall decision. Playing into a non-resident frame starts a stall;
   * it ends once PLAYBACK_MIN_BUFFER consecutive frames from the playhead are
   * resident (clamped at the sequence end — the last frames need only
   * themselves). Pausing always clears the stall.
   */
  private updateBuffering(): boolean {
    if (!this.timeline.playing) {
      this.setBuffering(false);
      return false;
    }
    const target = this.timeline.frameIndex();
    const need = Math.min(PLAYBACK_MIN_BUFFER, this.timeline.frameCount - target);
    if (this.buffering) {
      let run = 0;
      while (run < need && this.streamer.has(target + run)) run++;
      if (run >= need) this.setBuffering(false);
    } else if (!this.streamer.has(target)) {
      this.setBuffering(true);
    }
    return this.buffering;
  }

  private setBuffering(buffering: boolean): void {
    if (this.buffering === buffering) return;
    this.buffering = buffering;
    this.onBufferingChange?.(buffering);
  }

  setMaterial(mode: string): void {
    if (!this.materials.has(mode)) return;
    this.currentMode = mode;
    this.display.material = this.materials.get(mode);
    for (const extra of this.sculptExtras) extra.material = this.display.material;
    this.applyToneMapping();
    // The ground/shadow/pedestal follow the chosen Ground option, not the
    // material's shading — so matcap renders keep the stage too.
    this.updateStage();
    this.invalidate();
  }

  /** The chosen output grade (lit modes; matcap always renders ungraded). */
  private toneMappingId: ToneMappingId = 'cinematic';

  getToneMapping(): ToneMappingId {
    return this.toneMappingId;
  }

  /** Pick the output grade (Render panel; rides the saved look). */
  setToneMapping(id: ToneMappingId): void {
    if (!(id in TONE_MAPPINGS)) return;
    this.toneMappingId = id;
    this.applyToneMapping();
    this.invalidate();
  }

  /**
   * Push the effective grade into the renderer. A matcap is display-
   * referred art - its shading was already graded by whoever painted it,
   * and running it through ACES a second time halved its brightness and
   * greyed the highlights (measured against the source PNGs) - so matcap
   * mode always renders ungraded, whatever grade the look chose for the
   * lit modes. The sRGB output transform stays on either way.
   */
  private applyToneMapping(): void {
    const tm =
      this.currentMode === 'matcap' ? NoToneMapping : TONE_MAPPINGS[this.toneMappingId];
    if (this.renderer.toneMapping !== tm) {
      this.renderer.toneMapping = tm;
      if (this.pipeline) this.pipeline.needsUpdate = true; // output bakes the curve
    }
  }

  // --- extra sculpt subjects (multi-mesh: extractions, added objects) -----

  private readonly sculptExtras: Mesh[] = [];

  /**
   * Add a secondary sculpt mesh sharing the primary's material and flags.
   * `wire` supplies its edge lines for the wireframe overlay (see
   * sculptWires); without it the object simply has no wireframe.
   */
  addSculptExtra(geometry: BufferGeometry, matrix: Matrix4, wire?: () => BufferGeometry): Mesh {
    const mesh = new Mesh(geometry, this.display.material);
    mesh.castShadow = this.display.castShadow;
    mesh.receiveShadow = this.display.receiveShadow;
    mesh.userData.locked = 0; // the shared material reads it; never undefined
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.frustumCulled = false; // over-allocated sculpt arrays: bounds lie
    this.sculptExtras.push(mesh);
    this.scene.add(mesh);
    if (wire) this.attachWire(mesh, wire);
    this.invalidate();
    return mesh;
  }

  /** Hang a sculpt object's edge lines under its display mesh. */
  private attachWire(host: Mesh, provider: () => BufferGeometry): void {
    this.detachWire(host);
    const lines = new LineSegments(new BufferGeometry(), this.wireLineMaterial);
    lines.name = 'sculpt-wire';
    lines.frustumCulled = false;
    lines.visible = this.wireframeOn;
    host.add(lines);
    this.sculptWires.set(host, { lines, provider });
  }

  private detachWire(host: Mesh): void {
    const w = this.sculptWires.get(host);
    if (!w) return;
    host.remove(w.lines);
    // The geometry is the provider's (it shares the surface's positions),
    // so it is not disposed here.
    this.sculptWires.delete(host);
  }

  /** Give every sculpt wire its current edge lines, before a render. */
  private refreshSculptWires(): void {
    for (const w of this.sculptWires.values()) {
      const g = w.provider();
      if (w.lines.geometry !== g) w.lines.geometry = g;
    }
  }

  /**
   * Take in a mesh built elsewhere (the armature's skinned figure): it
   * draws with the current material and follows every material swap like
   * the sculpt extras do, and removeSculptExtra takes it out again.
   */
  adoptMesh(mesh: Mesh): void {
    mesh.material = this.display.material;
    mesh.castShadow = this.display.castShadow;
    mesh.receiveShadow = this.display.receiveShadow;
    if (mesh.userData.locked === undefined) mesh.userData.locked = 0;
    this.sculptExtras.push(mesh);
    this.scene.add(mesh);
    this.invalidate();
  }

  setSculptExtraMatrix(mesh: Mesh, matrix: Matrix4): void {
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
    this.invalidate();
  }

  removeSculptExtra(mesh: Mesh): void {
    const i = this.sculptExtras.indexOf(mesh);
    if (i >= 0) this.sculptExtras.splice(i, 1);
    this.highlightSculpt(mesh, false);
    this.detachWire(mesh);
    this.scene.remove(mesh);
    this.invalidate();
  }

  /**
   * Selection highlight for a sculpt object (owner call: the thin outline
   * disappeared on a big smooth shape): a translucent wash of the accent
   * colour over the whole visible surface, plus a wider inverted-hull rim
   * around the silhouette. Both are children of the object's display mesh,
   * so they follow its matrix for free and share its geometry. 'primary'
   * is the active object's own display; the others are the extras' handles.
   */
  private readonly sculptOutlines = new Map<Mesh, Mesh>();
  private outlineMaterial: MeshBasicNodeMaterial | null = null;
  private washMaterial: MeshBasicNodeMaterial | null = null;

  highlightSculpt(target: Mesh | 'primary', on: boolean): void {
    this.invalidate();
    const host = target === 'primary' ? this.display : target;
    const existing = this.sculptOutlines.get(host);
    if (!on) {
      if (existing) {
        host.remove(existing);
        this.sculptOutlines.delete(host);
      }
      return;
    }
    if (existing) return;
    if (!this.outlineMaterial || !this.washMaterial) {
      const rim = new MeshBasicNodeMaterial();
      rim.color.set('#c87049');
      rim.side = BackSide;
      rim.transparent = true;
      rim.opacity = 0.95;
      rim.depthWrite = false;
      // Pushed out along the normal, not scaled about the origin: the rim
      // is the same width everywhere, whatever shape the object.
      rim.positionNode = positionLocal.add(normalLocal.mul(float(0.028)));
      this.outlineMaterial = rim;
      // The wash sits a hair above the surface so it wins the depth test
      // against the object it covers, and only where that surface faces
      // the camera - the hidden side never bleeds through.
      const wash = new MeshBasicNodeMaterial();
      wash.color.set('#c87049');
      wash.side = FrontSide;
      wash.transparent = true;
      wash.opacity = 0.28;
      wash.depthWrite = false;
      wash.positionNode = positionLocal.add(normalLocal.mul(float(0.004)));
      this.washMaterial = wash;
    }
    const outline = new Mesh(host.geometry, this.outlineMaterial);
    outline.frustumCulled = false;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.name = 'sculpt-outline';
    const wash = new Mesh(host.geometry, this.washMaterial);
    wash.frustumCulled = false;
    wash.castShadow = false;
    wash.receiveShadow = false;
    wash.name = 'sculpt-wash';
    // The wash draws after the rim so the rim never tints through it.
    outline.renderOrder = 1;
    wash.renderOrder = 2;
    outline.add(wash);
    host.add(outline);
    this.sculptOutlines.set(host, outline);
  }

  /** Whether an object carries the selection highlight (tests read this). */
  isSculptHighlighted(target: Mesh | 'primary'): boolean {
    return this.sculptOutlines.has(target === 'primary' ? this.display : target);
  }

  /**
   * A locked object draws as if fully masked (the darken the mask uses),
   * so the outliner padlock can be seen in the viewport. Per object, read
   * by the shared sculpt material off each display mesh's userData.
   */
  setSculptLocked(target: Mesh | 'primary', locked: boolean): void {
    const host = target === 'primary' ? this.display : target;
    host.userData.locked = locked ? 1 : 0;
    this.invalidate();
  }

  /**
   * Show or hide the PRIMARY sculpt subject (outliner eye on the active
   * object; the extras carry their own `.visible`). Sculpt mode must restore
   * this on unmount - the viewer side never hides its display itself.
   */
  setSculptVisible(visible: boolean): void {
    this.display.visible = visible;
    this.invalidate();
  }

  /**
   * Size the stage - ground, pedestal, shadow, AO radius - to a world box,
   * and frame it. enterSculpt does this for sculpt mode; a mode that brings
   * its own subject (the armature's figure) calls it directly, or the stage
   * stays sized to whatever the boot manifest's placeholder was.
   */
  fitSubject(box: Box3, frame = true): void {
    this.fitSubjectBounds(box, frame);
  }

  /** Sculpt SSAO knobs (WS4 palette): cavity strength and tap radius (px). */
  setSculptAO(state: { strength?: number; radius?: number }): void {
    if (typeof state.strength === 'number') this.cavityStrengthU.value = state.strength;
    if (typeof state.radius === 'number') this.sculptAoRadiusU.value = state.radius;
    this.invalidate();
  }

  getSculptAO(): { strength: number; radius: number } {
    return { strength: this.cavityStrengthU.value, radius: this.sculptAoRadiusU.value };
  }

  getMaterial(): string {
    return this.currentMode;
  }

  // --- stage (ground: off / shadow / floor / pedestal) ------------------

  setGround(mode: GroundMode): void {
    this.groundMode = mode;
    this.layoutStage(); // the pedestal changes the ground height
    this.updateStage();
    this.invalidate();
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
    this.invalidate();
  }

  setStageRoughness(value: number): void {
    this.stageRoughness = value;
    this.floorMaterial.roughness = value;
    this.pedestalMaterial.roughness = value;
    this.invalidate();
  }

  setStageMetalness(value: number): void {
    this.stageMetalness = value;
    this.floorMaterial.metalness = value;
    this.pedestalMaterial.metalness = value;
    this.invalidate();
  }

  /** Scale the pedestal's base (width/depth only); the height is unaffected. */
  setPedestalScale(value: number): void {
    this.pedestalScale = value;
    this.layoutStage();
    this.invalidate();
  }

  getStageState(): StageState {
    return {
      ground: this.groundMode,
      color: this.stageColor,
      roughness: this.stageRoughness,
      metalness: this.stageMetalness,
      pedestalScale: this.pedestalScale,
    };
  }

  applyStageState(state: Partial<StageState>): void {
    if (typeof state.color === 'string') this.setStageColor(state.color);
    if (typeof state.roughness === 'number') this.setStageRoughness(state.roughness);
    if (typeof state.metalness === 'number') this.setStageMetalness(state.metalness);
    if (typeof state.pedestalScale === 'number') this.pedestalScale = state.pedestalScale;
    if (state.ground) this.groundMode = state.ground;
    this.layoutStage();
    this.updateStage();
    this.invalidate();
  }

  /**
   * Drive the ground material and pedestal visibility from the Ground mode:
   * 'floor' shows the fading floor, 'shadow' the shadow-catcher, 'pedestal' the
   * plinth with no ground catcher (GTAO grounds the subject↔plinth contact),
   * 'off' hides everything. Shadows are always cast (constructor + Lighting): the
   * stage only swaps the receiver, never the shadow pass. Toggling shadow-casting
   * at runtime rebuilds the WebGPU shadow-map targets and leaves the node
   * pipeline holding a stale (null) shadow texture, so with the ground 'off' we
   * keep casting — there's simply no receiver, hence no visible ground shadow.
   */
  private updateStage(): void {
    const mode = this.groundMode;

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
    const baseFootprint = Math.max(size.x, size.z, 1e-3) * PEDESTAL_FOOTPRINT;

    // Pedestal: a column under the subject, top flush with the subject base. The
    // height tracks the unscaled base (a consistent column shape); the Pedestal
    // width slider scales the footprint (width/depth) only, leaving height alone.
    const pedH = baseFootprint * PEDESTAL_HEIGHT;
    const footprint = baseFootprint * this.pedestalScale;
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
    this.invalidate();
  }

  /** AO is available once the node pipeline built (it always does on WebGPU). */
  aoAvailable(): boolean {
    return this.aoNode !== null;
  }

  /** Smoothed frames-per-second (the frame meter). */
  getFps(): number {
    return this.fps;
  }

  /**
   * Whether the GPU can be timed here, settled once: WebGPU keeps
   * trackTimestamp only when the adapter has the timestamp-query feature,
   * and WebGL needs its timer-query extension. Either way tracking goes off
   * until the meter asks for it (setGpuTiming): every pass would otherwise
   * write timestamps nobody reads, until the query pool filled.
   */
  private setUpTiming(): void {
    const b = this.renderer.backend as { trackTimestamp?: boolean; isWebGPUBackend?: boolean; disjoint?: unknown };
    this.gpuTimestamps = b.trackTimestamp === true && (b.isWebGPUBackend === true || !!b.disjoint);
    b.trackTimestamp = false;
  }

  /**
   * Count what the renderer builds and allocates, at the backend, where
   * every node build, shader module, pipeline, texture, geometry buffer and
   * bind group is made. Fast frames promise none of these from pen-down to
   * pen-up, so the first dab never waits on a compile, and these counts are
   * how that is checked, by the latency suite and on the meter. A wrapper
   * around each call and an increment; nothing else.
   */
  private instrumentBackend(): void {
    const be = this.renderer.backend as unknown as Record<string, unknown>;
    const count = (method: string, key: keyof RenderCounters): void => {
      const fn = be[method];
      if (typeof fn !== 'function') return;
      be[method] = (...args: unknown[]): unknown => {
        this.counters[key]++;
        return (fn as (...a: unknown[]) => unknown).apply(be, args);
      };
    };
    count('createNodeBuilder', 'nodeBuilds');
    count('createProgram', 'programs');
    count('createRenderPipeline', 'pipelines');
    count('createTexture', 'textures');
    count('createAttribute', 'buffers');
    count('createIndexAttribute', 'buffers');
    count('createStorageAttribute', 'buffers');
    count('createBindings', 'bindGroups');
    // A shadow map is drawn by a render with its light's shadow camera,
    // which nothing else renders with, so that is where they are counted.
    const cameras = new Map(this.lighting.shadowCameras());
    const render = this.renderer.render.bind(this.renderer);
    this.renderer.render = (scene, camera) => {
      const id = cameras.get(camera);
      if (id) this.shadowRenders[id]++;
      render(scene, camera);
    };
  }

  /** Builds and allocations since boot (a copy). */
  renderCounters(): RenderCounters {
    return { ...this.counters };
  }

  /** Passes drawn since boot: GTAO, its denoise, and each light's shadow map. */
  passCounts(): { gtao: number; denoise: number; shadows: { key: number; fill: number; rim: number } } {
    return { gtao: this.aoNode?.renders ?? 0, denoise: this.aoRttRenders, shadows: { ...this.shadowRenders } };
  }

  /**
   * Time the GPU while the meter is up. With timestamp queries every pass
   * gets two timestamp writes, read back once a frame (sampleGpu); without
   * them, on WebGPU, how long after submission the queue reports the frame
   * done stands in. Off, neither runs.
   */
  setGpuTiming(on: boolean): void {
    if (this.gpuTiming === on) return;
    this.gpuTiming = on;
    if (this.gpuTimestamps) {
      (this.renderer.backend as { trackTimestamp?: boolean }).trackTimestamp = on;
    }
    if (!on) this.frameStats.clearGpu();
  }

  /** How the GPU is being timed, for the meter's GPU row. */
  gpuTimingSource(): 'timestamps' | 'submit' | null {
    if (this.gpuTimestamps) return 'timestamps';
    return (this.renderer.backend as { device?: unknown }).device ? 'submit' : null;
  }

  /**
   * After a frame's submission, while the meter is up: one timestamp read
   * back in flight at a time (three sums the passes of the newest frame in
   * the batch), and one wait on the queue, which also dates the GPU
   * finishing the frame that used an input event.
   */
  private sampleGpu(submittedAt: number, inputAt: number): void {
    if (this.gpuTimestamps && !this.timestampPending) {
      this.timestampPending = true;
      void this.renderer
        .resolveTimestampsAsync('render')
        .then((gpuMs) => {
          if (this.gpuTiming && typeof gpuMs === 'number' && gpuMs > 0) this.frameStats.noteGpu(gpuMs, 'timestamps');
        })
        .catch(() => undefined)
        .finally(() => {
          this.timestampPending = false;
        });
    }
    const device = (this.renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
    if (device && !this.donePending) {
      this.donePending = true;
      void device.queue
        .onSubmittedWorkDone()
        .then(() => {
          if (!this.gpuTiming) return;
          const done = performance.now();
          if (!this.gpuTimestamps) this.frameStats.noteGpu(done - submittedAt, 'submit');
          if (inputAt > 0) this.frameStats.noteReady(done - inputAt);
        })
        .catch(() => undefined)
        .finally(() => {
          this.donePending = false;
        });
    }
  }

  /**
   * A pointer handler did work for the coming frame (a stroke step, a pose
   * drag): its time, the event's timestamp and the vendored step's share.
   */
  noteInput(ms: number, eventTime: number, stepMs = 0): void {
    this.frameStats.noteInput(ms, eventTime, stepMs);
  }

  /** The point the camera orbits, without the copy getCameraState makes (per-frame callers). */
  orbitTarget(): Vector3 {
    return this.controls.controls.target;
  }

  /**
   * What the frames are doing now, for the meter and the tests: the kind of
   * interaction, whether the AO is held or dropped, how the fill and rim
   * shadows are scheduled, and the builds across the last interaction.
   */
  frameMode(): {
    kind: InteractionKind | null;
    fast: boolean;
    ao: 'full' | 'held' | 'off' | 'fading';
    aoDrop: number;
    shadows: 'all' | 'hold' | 'stagger';
    lastInteraction: RenderCounters | null;
  } {
    const fast = this.fastActive();
    const kind = fast ? this.interaction : null;
    const drop = this.aoDropU.value as number;
    const ao = kind === 'move' ? 'off' : this.aoNode?.skip ? 'held' : drop > 0 ? 'fading' : 'full';
    return {
      kind: this.interaction,
      fast,
      ao,
      aoDrop: drop,
      shadows: kind === 'stroke' ? 'hold' : kind === 'move' ? 'stagger' : 'all',
      lastInteraction: this.lastInteractionDelta ? { ...this.lastInteractionDelta } : null,
    };
  }

  private gpuInfoCache: string | null = null;

  /**
   * The device actually rendering, so "slow for some reason" reports carry
   * the reason: the WebGPU adapter description, or for the WebGL2 fallback
   * the unmasked renderer string, which names software rasterizers
   * (SwiftShader, WARP, llvmpipe) and remote-desktop stand-ins outright.
   */
  private gpuDescription(): string {
    if (this.gpuInfoCache !== null) return this.gpuInfoCache;
    let info = '?';
    const b = this.renderer.backend as {
      isWebGPUBackend?: boolean;
      device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } };
      gl?: WebGL2RenderingContext;
    };
    try {
      if (b.isWebGPUBackend && b.device) {
        info = describeAdapter(b.device.adapterInfo);
      } else if (b.gl) {
        const gl = b.gl;
        const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
          UNMASKED_RENDERER_WEBGL: number;
        } | null;
        const raw = String(
          gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '?',
        );
        // "ANGLE (vendor, device (id), backend)" -> the device part.
        const inner = raw.replace(/^ANGLE \((.*)\)$/, '$1');
        const parts = inner.split(', ');
        info = parts.length >= 2 ? parts[1] : inner;
      }
    } catch {
      info = '?';
    }
    if (info.length > 44) info = `${info.slice(0, 43)}…`;
    this.gpuInfoCache = info;
    return info;
  }

  /** One console note when the fallback landed on a software rasterizer. */
  warnIfSoftwareRendering(): void {
    const gpu = this.gpuDescription();
    if (/swiftshader|software|basic render|llvmpipe|warp\b/i.test(gpu)) {
      console.warn(
        `Bozzetto: software rendering detected (${gpu}). ` +
          'Check that hardware acceleration is enabled (chrome://settings/system) ' +
          'and see chrome://gpu; remote-desktop sessions often lack GPU access.',
      );
    }
  }

  /** The frame meter's numbers, about the last second. */
  frameSummary(): FrameSummary {
    return this.frameStats.summary();
  }

  /**
   * Live diagnostics for the frame meter (P): [label, value] rows. The
   * first rows say where the frame's time goes against the display's
   * budget and which side is short; the rest describe the renderer.
   */
  debugInfo(): Array<[string, string]> {
    const b = this.renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    const backend = b.isWebGPUBackend ? 'WebGPU' : b.isWebGLBackend ? 'WebGL2' : '?';
    const { w, h } = this.viewportSize();
    const rows: Array<[string, string]> = [];
    if (backend === 'WebGL2') {
      // Say WHY WebGPU was skipped: adapter refused (blocklist, software
      // rendering, remote desktop) vs a browser without the API.
      rows.push([
        'webgpu',
        'gpu' in navigator ? 'no adapter · see chrome://gpu' : 'unsupported browser',
      ]);
    }
    const s = this.frameStats.summary();
    const budget = s.periodMs ? `${ms(s.periodMs)} ms` : '…';
    const gpuSource = this.gpuTimingSource();
    const gpu =
      s.gpuMs !== null
        ? s.gpuSource === 'timestamps'
          ? `${ms(s.gpuMs)} ms`
          : `≈ ${ms(s.gpuMs)} ms (submit to done)`
        : gpuSource
          ? 'measuring'
          : 'not available';
    const frame = `CPU ${ms(s.cpuMs)} · GPU ${s.gpuMs !== null ? `${s.gpuSource === 'timestamps' ? '' : '≈'}${ms(s.gpuMs)}` : '–'} · budget ${budget}`;
    const latency =
      s.inputToSubmitMs !== null
        ? `input to submit ${ms(s.inputToSubmitMs)}${s.inputToReadyMs !== null ? ` · to GPU done ${ms(s.inputToReadyMs)}` : ''} ms`
        : 'no input';
    const info = this.renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number };
    const mode = this.frameMode();
    // The AO part only where GTAO is drawn at all: the cavity, and no AO,
    // have nothing to hold or drop.
    const aoText = this.aoEnabled ? ` · AO ${mode.ao}` : '';
    const modeText = mode.kind
      ? `${mode.kind === 'stroke' ? 'stroke' : 'moving'}${mode.fast ? `${aoText} · fill/rim ${mode.shadows === 'all' ? 'every frame' : mode.shadows === 'hold' ? 'held' : 'every 3rd frame'}` : ' · full look'}`
      : mode.ao === 'fading'
        ? 'still · AO fading in'
        : 'still';
    const last = mode.lastInteraction;
    const given = this.frameStats.reportedPeriod ? (this.pacing.displayHz > 0 ? ' (display)' : ' (assumed)') : '';
    const refresh = s.refreshHz ? `${s.refreshHz} Hz${given}` : '…';
    const p = this.pacing;
    const pacing = p.uncapped
      ? `v-sync off · ${this.isPaced() ? `paced to ${p.displayHz || 60} Hz${p.onBattery ? ' (battery)' : ' (idle)'}` : 'unpaced'}`
      : null;
    return [
      ['fps', `${Math.round(s.frames ? s.fps : this.fps)} · refresh ${refresh} · missed ${s.missed}/${s.refreshes}`],
      ...(pacing ? ([['pacing', pacing]] as Array<[string, string]>) : []),
      ['frame', frame],
      ['verdict', s.verdict],
      ['cpu', `input ${ms(s.inputMs)} (step ${ms(s.stepMs)}) · loop ${ms(s.loopMs)} · encode ${ms(s.encodeMs)} ms`],
      ['gpu time', gpu],
      ['moves', s.movesPerFrame ? `${s.movesPerFrame.toFixed(1)} per frame` : '–'],
      ['latency', latency],
      ['draws', `${info.drawCalls ?? info.calls ?? 0} · ${formatCount(info.triangles ?? 0)} tris`],
      ['frames', modeText],
      ['AA', this.antialiasState()],
      ['quality', this.adaptive.describe()],
      [
        'builds',
        last
          ? `last stroke or drag: ${last.nodeBuilds + last.programs + last.pipelines} builds · ${last.textures + last.buffers + last.bindGroups} allocations`
          : 'no stroke or drag yet',
      ],
      ['backend', backend],
      ['gpu', this.gpuDescription()],
      ...rows,
      ['size', `${w}×${h} @${this.renderer.getPixelRatio()}x`],
      ['material', this.currentMode],
      ['AO', this.aoEnabled ? `str ${this.aoIntensity.toFixed(2)} · rad ${this.aoRadiusFraction.toFixed(2)}` : 'off'],
      [
        'DoF',
        this.dofEnabled
          ? `f/${this.dofFStop} · ${this.dofFocusPoint ? 'locked' : `focus ${this.dofFocus.toFixed(2)}`}`
          : 'off',
      ],
      ['subject r', this.subjectRadius.toFixed(1)],
      ['clip', `${this.camera.near.toFixed(1)}–${this.camera.far.toFixed(0)}`],
      ['env', this.scene.environment ? 'loaded' : 'none'],
    ];
  }

  setAO(state: Partial<AOState>): void {
    if (typeof state.enabled === 'boolean' && state.enabled !== this.aoEnabled) {
      this.aoEnabled = state.enabled;
      this.rebuildOutput(); // GTAO joins or leaves the graph
    }
    if (typeof state.intensity === 'number') this.aoIntensity = state.intensity;
    if (typeof state.radius === 'number') {
      this.aoRadiusFraction = state.radius;
      this.applyAoRadius();
    }
    this.applyAoStrength();
    this.invalidate();
  }

  getAOState(): AOState {
    return { enabled: this.aoEnabled, intensity: this.aoIntensity, radius: this.aoRadiusFraction };
  }

  /** DoF is available once the node pipeline built (it always does on WebGPU). */
  dofAvailable(): boolean {
    return this.pipeline !== null;
  }

  setDoF(state: Partial<DoFState>): void {
    if (typeof state.enabled === 'boolean' && state.enabled !== this.dofEnabled) {
      this.dofEnabled = state.enabled;
      this.rebuildOutput(); // include/exclude the DoF gather in the graph
      this.onDofChange?.(); // keep the panel checkbox in sync
    }
    if (typeof state.fStop === 'number') this.dofFStop = state.fStop;
    if (typeof state.focus === 'number') {
      this.dofFocus = state.focus;
      // A manual focus from the slider releases any tap-to-focus lock.
      this.dofFocusPoint = null;
    }
    // A lock handed back (a saved state, or the Focus slider putting back
    // the one its own first press let go of) holds over the focus above.
    const fp = state.focusPoint;
    if (fp?.length === 3) this.dofFocusPoint = new Vector3(fp[0], fp[1], fp[2]);
    this.applyDof();
    this.invalidate();
  }

  /** Flip DoF on/off (hotkey "b"); returns the new state. */
  toggleDoF(): boolean {
    this.setDoF({ enabled: !this.dofEnabled });
    return this.dofEnabled;
  }

  getDoFState(): DoFState {
    const s: DoFState = { enabled: this.dofEnabled, fStop: this.dofFStop, focus: this.dofFocus };
    if (this.dofFocusPoint) {
      s.focusPoint = [this.dofFocusPoint.x, this.dofFocusPoint.y, this.dofFocusPoint.z];
    }
    return s;
  }

  /**
   * Tap-to-focus (double-click, or a double-tap on touch): raycast the pointer/finger
   * against the subject and lock the DoF focus plane onto the hit point, turning
   * DoF on if it was off. The lock is a world point, so focus stays glued to that
   * spot as the camera moves (see updateDofFocus). Returns false on a miss
   * (empty space), changing nothing.
   */
  focusAtPointer(clientX: number, clientY: number): boolean {
    if (!this.dofAvailable()) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.picker.setFromCamera(this.pickNdc, this.camera);
    const hit = this.picker.intersectObject(this.display, false)[0];
    if (!hit) return false;
    this.dofFocusPoint = hit.point.clone();
    this.invalidate();
    if (!this.dofEnabled) this.setDoF({ enabled: true });
    this.updateDofFocus(); // apply this frame, not next
    this.flashReticle(clientX - rect.left, clientY - rect.top);
    return true;
  }

  /** Restart the reticle pulse at a viewport-local position (px). */
  private flashReticle(x: number, y: number): void {
    const r = this.reticle;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    r.classList.remove('focus-reticle--show');
    void r.offsetWidth; // reflow so the animation restarts on re-add
    r.classList.add('focus-reticle--show');
  }

  /** Set the lens (35mm-equivalent mm), dollying to keep the subject framed. */
  setFocalLength(mm: number): void {
    const oldFov = this.camera.fov;
    this.camera.setFocalLength(mm);
    this.focalLength = mm;
    this.controls.dollyForFov(oldFov, this.camera.fov);
    this.invalidate();
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

  /**
   * The whole look as one record: what the editor's "Save look" writes to a
   * project, and what sculpt mode keeps so a session comes back the way it
   * was left. One place to gather it means the two paths cannot drift.
   */
  getLook(): LookState {
    return {
      lighting: this.lighting.serialize(),
      material: this.materials.getMaterialState(),
      environment: this.environment.getState(),
      ao: this.getAOState(),
      sculptAO: this.getSculptAO(),
      presentation: this.getStageState(),
      camera: this.getCameraState(),
      materialMode: this.getMaterial(),
      toneMapping: this.toneMappingId,
    };
  }

  /**
   * Re-apply a saved look. Mirrors the order boot() applies a manifest in,
   * because it matters: the HDRI has to land before the rig rotation is
   * pushed to it, and setDoF clears any tap-to-focus lock it must restore.
   * Every field is optional so a partial record (an older save) still works.
   */
  async applyLook(look: Partial<LookState> | null | undefined): Promise<void> {
    if (!look) return;
    if (look.toneMapping) this.setToneMapping(look.toneMapping);
    if (look.materialMode) this.setMaterial(look.materialMode);
    if (look.lighting) this.lighting.applyState(look.lighting);
    if (look.material) this.materials.applyMaterialState(look.material);
    if (look.environment) await this.environment.applyState(look.environment);
    if (look.sculptAO) this.setSculptAO(look.sculptAO);
    if (look.ao) {
      // Out of sculpt mode a look saved on the cavity comes back on GTAO -
      // which is every armature saved while the Render panel was putting
      // each look on the cavity - and from then on reads as GTAO (the
      // cavity at zero, as a pick in the panel leaves it out here).
      const ao = this.sculptShading ? look.ao : aoWithoutCavity({ ao: look.ao, sculptAO: look.sculptAO });
      this.setAO(ao);
      if (ao !== look.ao) this.setSculptAO({ strength: 0 });
    }
    if (look.presentation) this.applyStageState(look.presentation);
    const cam = look.camera;
    if (cam) {
      if (cam.focalLength) this.setFocalLength(cam.focalLength);
      if (cam.position?.length === 3 && cam.target?.length === 3) {
        this.controls.setState(cam.position, cam.target);
      }
      if (cam.dof) {
        this.setDoF(cam.dof);
        const fp = cam.dof.focusPoint;
        if (fp) this.dofFocusPoint = new Vector3(fp[0], fp[1], fp[2]);
      }
    }
    this.environment.setRotation(this.lighting.getRigRotation());
    this.onDofChange?.();
  }

  /** Frame the current model in place, keeping the view angle (hotkey "f"). */
  focusSubject(): void {
    const geom = this.display.geometry;
    geom.computeBoundingBox();
    if (geom.boundingBox) {
      this.subjectBox.copy(geom.boundingBox);
      this.controls.focus(this.subjectBox);
    }
    this.invalidate();
  }

  toggleWireframe(): boolean {
    this.setWireframe(!this.wireframeOn);
    return this.wireframeOn;
  }

  setWireframe(on: boolean): void {
    this.wireframeOn = on;
    // Sculpt mode draws its objects' own edges instead of the triangle
    // wireframe; the streamed frames have only triangles to show.
    this.wireframe.visible = on && !this.inSculpt;
    for (const w of this.sculptWires.values()) w.lines.visible = on;
    if (on) this.updateWireColor();
    this.invalidate();
  }

  isWireframe(): boolean {
    return this.wireframeOn;
  }

  /** Overlay line opacity slider (0..1). Mapped per colour so white and black
   *  wires both span invisible→solid across the whole range (see applyWireOpacity). */
  setWireframeOpacity(value: number): void {
    this.wireOpacity = value;
    this.applyWireOpacity();
  }

  getWireframeOpacity(): number {
    return this.wireOpacity;
  }

  /** Map the 0..1 slider onto the material opacity, capped at the value where the
   *  current line colour reads as solid — so the ramp uses the full slider and
   *  feels the same whether the wires are white or black. */
  private applyWireOpacity(): void {
    const max = this.wireIsWhite ? WIRE_MAX_OPACITY_WHITE : WIRE_MAX_OPACITY_BLACK;
    this.wireMaterial.opacity = this.wireOpacity * max;
    this.wireLineMaterial.opacity = this.wireOpacity * max;
    this.invalidate();
  }

  /** Light wires on a dark albedo, dark wires on a light one. */
  private updateWireColor(): void {
    this.wireIsWhite = this.materials.albedoLuminance() <= 0.5;
    this.wireMaterial.color.set(this.wireIsWhite ? 0xffffff : 0x000000);
    this.wireLineMaterial.color.copy(this.wireMaterial.color);
    this.applyWireOpacity(); // re-scale: white and black saturate at different opacities
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
    // A paused loop is not a stalled one.
    this.frameStart = 0;
    clearTimeout(this.pacer);
    this.pacer = 0;
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
    this.invalidate(); // a smoothed capture frame is of the frame before
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
    this.invalidate();
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
    this.timer.update(); // discard time accumulated during capture
    this.frameStats.resetClock(); // nor is the capture a frame to the meter
    this.endReadback();
    this.loop();
  }

  /**
   * Render the current frame and read it back as a JPEG thumbnail blob. When a
   * crop guide is active the thumbnail is cropped to it, so the saved image
   * matches the framing used for the reel. Smoothed whatever the screen
   * shows (renderForReadback); `smooth` false takes the frame in one render
   * instead, for a page on its way out, which may not live through sixteen.
   */
  async captureThumbnail(maxWidth = 640, smooth = true): Promise<Blob> {
    const t0 = performance.now();
    await this.renderForReadback(smooth);
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
    let draw = 0;
    try {
      if (!ctx) throw new Error('2D context unavailable for capture');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Timed on its own: drawing the WebGPU canvas into a 2D one can wait
      // on the GPU, and it waits on the main thread.
      const d0 = performance.now();
      ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, w, h);
      draw = performance.now() - d0;
    } finally {
      this.endReadback();
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('thumbnail capture failed'))),
        'image/jpeg',
        0.82,
      );
    });
    perfLog.record('thumbnail', performance.now() - t0, `read-back ${formatMs(draw)}`);
    return blob;
  }

  /**
   * The colour under a screen point, read from the rendered frame, as a
   * hex string - or null when the point is off the canvas. The paint
   * brush's swatch drag samples with this: the FRAME, so a background, an
   * environment and (one day) a reference board all count, not only the
   * model's own vertex colours.
   */
  async samplePixel(clientX: number, clientY: number): Promise<string | null> {
    const src = this.renderer.domElement;
    const rect = src.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
      return null;
    }
    // The colour as drawn: one plain frame, not the still frame's smoothing
    // (the swatch drag samples on every move).
    await this.renderForReadback(false);
    const sx = Math.floor(((clientX - rect.left) / rect.width) * src.width);
    const sy = Math.floor(((clientY - rect.top) / rect.height) * src.height);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, sx, sy, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = (v: number): string => v.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.pacer);
    this.offAdaptive();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      this.container.removeEventListener(type, this.onActivity, { capture: true });
    }
    window.removeEventListener('keydown', this.onActivity, { capture: true });
    document.removeEventListener('input', this.onActivity, { capture: true });
    document.removeEventListener('change', this.onActivity, { capture: true });
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.containerObserver?.disconnect();
    this.containerObserver = null;
    this.container.removeEventListener('pointerdown', this.onPickPointer, true);
    this.container.removeEventListener('pointermove', this.onTapMove, true);
    this.container.removeEventListener('pointerup', this.onTapEnd, true);
    this.renderer.domElement.removeEventListener('touchstart', preventTouchDefault);
    this.container.removeEventListener('pointercancel', this.onTapCancel, true);
    this.reticle.remove();
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
    const cam = this.manifest.camera;
    if (cam.position && cam.target) {
      // Bounds first: the restored camera is clamped to this subject's
      // dolly limits, so they have to be this subject's already.
      this.fitSubjectBounds(geom.boundingBox ?? new Box3(), false);
      this.controls.setState(cam.position, cam.target);
    } else {
      this.fitSubjectBounds(geom.boundingBox ?? new Box3(), !!cam.autoFrame);
    }

    this.logAoDebug();
  }

  /**
   * Fit everything that keys off the subject's world bounds: AO radius, DoF
   * focus band, lighting rig, stage layout, and (optionally) the camera
   * framing. Shared by fitScene (streamed subjects, bounds from geometry) and
   * enterSculpt (an external subject with its own world box).
   */
  private fitSubjectBounds(box: Box3, frame: boolean, keepAngle = false): void {
    this.subjectBox.copy(box);

    const sphere = this.subjectBox.getBoundingSphere(new Sphere());
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    // The dolly floor and ceiling and the clip planes scale with it.
    this.controls.setSubjectRadius(this.subjectRadius);
    this.applyAoRadius();
    this.applyDof(); // focus-band range scales with the subject

    if (frame) {
      // keepAngle is the DCC "frame selected": pan and dolly the subject
      // into view without touching the orbit angle. Only a first load (or
      // sculpt entry) is entitled to choose the direction for you.
      if (keepAngle) this.controls.focus(this.subjectBox);
      else this.controls.frameSubject(this.subjectBox);
    }
    this.lighting.fitToBounds(this.subjectBox);
    this.layoutStage();
    this.invalidate();
  }

  private sculptSaved: { geometry: BufferGeometry; frustumCulled: boolean } | null = null;

  /**
   * Sculpt mode (src/sculpt/mode.ts): pause playback and adopt the sculpt
   * geometry on the DISPLAY mesh itself, carrying the vendor mesh's matrix.
   * Because the display mesh keeps rendering, the entire material system -
   * panel modes, albedo/roughness, matcaps, flat shading, the wireframe
   * overlay - drives the sculpt subject with no extra wiring. exitSculpt
   * restores the streamed frame. Framing/stage/lighting refit to worldBox.
   */
  enterSculpt(geometry: BufferGeometry, matrix: Matrix4, worldBox: Box3, wire?: () => BufferGeometry): void {
    this.timeline.pause();
    this.onPlayStateChange?.(false);
    this.sculptSaved = {
      geometry: this.display.geometry,
      frustumCulled: this.display.frustumCulled,
    };
    this.display.geometry = geometry;
    this.wireframe.geometry = geometry;
    this.inSculpt = true;
    if (wire) this.attachWire(this.display, wire);
    this.wireframe.visible = false; // the sculpt wires take over (setWireframe)
    this.display.matrixAutoUpdate = false;
    this.wireframe.matrixAutoUpdate = false;
    // Sculpt backing arrays are over-allocated; their bounds are meaningless.
    this.display.frustumCulled = false;
    // The shared sculpt material reads the lock off userData; never undefined.
    this.display.userData.locked = 0;
    this.wireframe.frustumCulled = false;
    this.setSculptMatrix(matrix);
    this.fitSubjectBounds(worldBox, true);
  }

  /** Follow vendor mesh swaps (dyntopo, undo) that can change the transform. */
  setSculptMatrix(matrix: Matrix4): void {
    this.display.matrix.copy(matrix);
    this.wireframe.matrix.copy(matrix);
    this.display.matrixWorldNeedsUpdate = true;
    this.wireframe.matrixWorldNeedsUpdate = true;
    this.invalidate();
  }

  exitSculpt(): void {
    const saved = this.sculptSaved;
    if (!saved) return;
    this.sculptSaved = null;
    this.detachWire(this.display);
    this.inSculpt = false;
    this.wireframe.visible = this.wireframeOn;
    this.display.geometry = saved.geometry;
    this.wireframe.geometry = saved.geometry;
    this.display.matrixAutoUpdate = true;
    this.wireframe.matrixAutoUpdate = true;
    this.display.frustumCulled = saved.frustumCulled;
    this.wireframe.frustumCulled = saved.frustumCulled;
    this.fitScene(this.display.geometry);
    this.invalidate();
  }

  /**
   * Sculpt-mode rendering: swap the pipeline output to the cavity composite
   * (no GTAO, no DoF; both leave the graph entirely). The viewer's normal
   * output returns when disabled. GTAO stays available as an opt-in later.
   */
  setSculptShading(on: boolean): void {
    if (this.sculptShading === on) return;
    this.sculptShading = on;
    // Mask visibility rides the sculpt shading state: masked vertices darken
    // (the sculpt geometry carries masking in its materialsPBR attribute).
    this.materials.setSculptMaskTint(on);
    this.rebuildOutput();
    this.invalidate();
  }

  /**
   * Frame arbitrary world bounds (sculpt f: frame the live sculpt mesh),
   * keeping the view angle - f means "fit this in view", not "look at it
   * from somewhere else", and it used to swing the camera to the default
   * three-quarter direction.
   */
  frameBounds(box: Box3): void {
    this.fitSubjectBounds(box, true, true);
  }

  // The camera moves below are seen by the next frame anyway; invalidating
  // at once also covers a readback taken before that frame.

  /** Turntable step around the subject (sculpt wheel keys, degrees). */
  orbitAzimuth(deg: number): void {
    this.controls.rotateAzimuth(deg);
    this.invalidate();
  }

  /** Place the camera and its orbit target directly (pivot-orbit rewrite). */
  setCameraState(position: Vector3, target: Vector3): void {
    this.controls.placeCamera(position, target);
    this.invalidate();
  }

  /**
   * Park or release the orbit controls (the transform gizmo takes the
   * pointer while dragging, and both listening at once fights the drag).
   */
  setOrbitEnabled(on: boolean): void {
    this.controls.controls.enabled = on;
  }

  /** Turntable about a world point; see Controls.rotateAzimuthAbout. */
  orbitAzimuthAbout(centre: Vector3, deg: number): void {
    this.controls.rotateAzimuthAbout(centre, deg);
    this.invalidate();
  }

  /** Dolly by a multiplier (>1 out, <1 in); see Controls.dollyBy. */
  dolly(factor: number): void {
    this.controls.dollyBy(factor);
    this.invalidate();
  }

  /** Stop the orbit's damped drift where it is; see Controls.halt. */
  haltOrbit(): void {
    this.controls.halt();
  }


  private logAoDebug(): void {
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
   * and render scale follow the device tier, and the cavity term sculpt mode
   * uses. Four composites come out of it - the viewer's and sculpt mode's,
   * each with GTAO and without - and rebuildOutput() puts one on screen, with
   * a depth-of-field gather over it when DoF is on.
   */
  private buildPipeline(): void {
    const tier = SHADOW_TIERS[detectQuality()];
    // The scene keeps its 4x MSAA here, the canvas has none (SCENE_SAMPLES);
    // setAntialias takes it away for the still frame's own smoothing.
    const scenePass = pass(this.scene, this.camera, CANVAS_MSAA ? {} : { samples: SCENE_SAMPLES });
    this.scenePass = scenePass;
    // GTAO reads colour, depth and view-space normals. Normals come from an MRT
    // target (read via .sample()): GTAONode's alternative depth-reconstruction
    // path dereferences the pass depth texture at shader-build time, which isn't
    // a valid texture yet, so that path fails to compile.
    scenePass.setMRT(mrt({ output, normal: normalView }));
    const colour = scenePass.getTextureNode('output');
    const depthTex = scenePass.getTextureNode('depth');
    const normalTex = scenePass.getTextureNode('normal');

    const aoNode = softAo(depthTex, normalTex, this.camera);
    aoNode.samples.value = tier.aoSamples;
    aoNode.resolutionScale = tier.aoResolutionScale;
    // GTAO turns its slices per pixel by a 5x5 noise tile and leaves the
    // averaging to whoever reads it. Read raw, the tile printed as a hatch
    // over every partly occluded surface, and as a black one once the
    // strength went up. three's edge-aware denoise averages it along a
    // surface and not across an edge (depth and normal weighted).
    const aoClean = denoise(aoNode.getTextureNode(), depthTex, normalTex, this.camera);
    // The denoise gets a pass and a texture of its own. Inline, its 16-tap
    // loop ran inside the output shader on every frame, so a stroke could
    // not hold the AO without paying for the denoise anyway; drawn to a
    // texture, holding it is skipping its pass (updateFrameMode). One
    // channel at half float, the same pixels it computed inline.
    const aoRtt = rtt(aoClean as unknown as Node, null, null, {
      type: HalfFloatType,
      format: RedFormat,
      depthBuffer: false,
    } as unknown as { type: typeof HalfFloatType });
    const updateRtt = aoRtt.updateBefore.bind(aoRtt);
    aoRtt.updateBefore = (frame) => {
      if (aoRtt.autoUpdate || aoRtt.textureNeedsUpdate) this.aoRttRenders++;
      return updateRtt(frame);
    };
    this.aoRtt = aoRtt;
    const aoTerm = (aoRtt as unknown as { r: ReturnType<typeof float> }).r.clamp(1e-4, 1);
    // Strength is an exponent on the term: 0 none, 1 the term as computed, 2
    // its square. It was a blend, mix(1, term, strength), which past 1 ran
    // below zero wherever the term fell under 1 - 1/strength and was floored
    // to black there - every half-occluded pixel at strength 2. A power
    // deepens the same pixels without ever crossing zero. The drop fades it
    // to none while the view moves (updateFrameMode): a uniform, so dropping
    // it changes no shader.
    const aoFactor = mix(pow(aoTerm, this.aoStrengthU), float(1), this.aoDropU);

    // Sculpt-mode composite: a small depth-only SSAO (8 taps), the cavity.
    // Depth ignores facet normals, so flat shading shows no grid at facet
    // edges (a normal-divergence term did); only real creases occlude.
    const suv = uv();
    const pixel = vec2(1, 1).div(screenSize).mul(this.sculptAoRadiusU);
    // near/far must be bound to the SCENE camera explicitly. The contextual
    // cameraNear/cameraFar accessors update per render call, and this code
    // runs in the pipeline's fullscreen quad, whose orthographic camera
    // (near 0, far 1) makes perspectiveDepthToViewZ collapse to ~0 for every
    // pixel - which is why the cavity term never darkened anything.
    const camNearU = uniform(this.camera.near).onRenderUpdate(() => this.camera.near);
    const camFarU = uniform(this.camera.far).onRenderUpdate(() => this.camera.far);
    // TSL's generated typings are narrower than the runtime accepts, so the
    // uv/accumulator seams cast through the shared Node type.
    const viewDist = (uvNode: unknown): Node =>
      perspectiveDepthToViewZ(
        depthTex.sample(uvNode as never).r,
        camNearU,
        camFarU,
      ).negate() as unknown as Node;
    const centerDist = viewDist(suv) as ReturnType<typeof float>;
    // Four OPPOSED tap pairs, measuring concavity rather than closeness: the
    // centre against the average of each pair. On a slope the nearer and
    // farther neighbour cancel, so smoothly curved surfaces (a sphere's
    // whole limb) read zero however steep they get on screen - a
    // one-sided "neighbour is closer" diff fired across half of every
    // curved surface. Only a genuine crease, where BOTH sides sit closer,
    // pushes the average under the centre; at silhouettes the far side
    // blows the average out the other way and the term goes negative.
    const axes: Array<[number, number]> = [
      [1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7],
    ];
    let occlusion: Node = float(0);
    for (const [ox, oy] of axes) {
      const off = vec2(ox, oy).mul(pixel);
      const a = viewDist(suv.add(off)) as ReturnType<typeof float>;
      const b = viewDist(suv.sub(off)) as ReturnType<typeof float>;
      const cav = (centerDist
        .sub(a.add(b as never).mul(0.5) as never)
        .div(centerDist.max(float(1e-4) as never) as never) as unknown) as ReturnType<typeof float>;
      // The floor sits ~5x above a sphere's curvature term at the default
      // radius (second-order, ~1.5e-4 of view distance) and well under a
      // sculpted crease (~1e-2, measured); the ceiling fades out gaps seen
      // clean through the model, where the background is the centre.
      const crease = smoothstep(float(0.0008), float(0.006), cav).mul(
        float(1).sub(smoothstep(float(0.15), float(0.5), cav)),
      );
      occlusion = (occlusion as ReturnType<typeof float>).add(crease) as unknown as Node;
    }
    const sculptAo = float(1)
      .sub((occlusion as ReturnType<typeof float>).div(axes.length).mul(this.cavityStrengthU))
      .clamp(0.35, 1);

    // The cavity gates itself through its strength (1.0 at strength 0), so
    // Off and Cavity share a composite. GTAO is the one thing that leaves
    // the graph when it is not chosen: its pass and the denoise are the
    // heaviest work here, and they used to run on every frame, picked or
    // not, gated only by a zero strength. Switching it on or off now costs
    // one rebuild of the output, as turning DoF on or off always has.
    const shade = (factor: unknown): Node =>
      colour.mul(vec4(vec3(factor as never), float(1))) as unknown as Node;
    this.composites = {
      viewer: { plain: colour as unknown as Node, ao: shade(aoFactor) },
      sculpt: { plain: shade(sculptAo), ao: shade(sculptAo.mul(aoFactor as never)) },
    };
    this.viewZNode = scenePass.getViewZNode() as unknown as Node;
    // Diagnostic view for ?aodebug in sculpt: channels expose each stage so a
    // dead cavity can be blamed on depth, ramp or composite in one frame.
    this.sculptAoDebugNode = vec4(
      (centerDist as unknown as ReturnType<typeof float>).div(float(400)),
      (occlusion as ReturnType<typeof float>).div(axes.length),
      sculptAo,
      float(1),
    ) as unknown as Node;
    // ?aodebug in the viewer: the GTAO term the composite multiplies by, as
    // greyscale (1 = open ... 0 = fully occluded).
    this.aoDebugNode = vec4(vec3(aoTerm), float(1)) as unknown as Node;
    // ?dofdebug: scene depth as distance/400 greyscale, through the SAME
    // bound-uniform conversion the cavity uses. A model-vs-background
    // gradient proves the depth texture and conversion; note DoF itself
    // keeps getViewZNode() - its contextual camera accessors resolve
    // correctly inside the DoF node's own passes (verified by A/B), unlike
    // in this pipeline's final output quad, where the cavity had to bind
    // the camera explicitly.
    this.dofViewZDebugNode = vec4(
      vec3(
        (perspectiveDepthToViewZ(
          scenePass.getTextureNode('depth'),
          camNearU,
          camFarU,
        ) as unknown as ReturnType<typeof float>)
          .negate()
          .div(float(400)),
      ),
      float(1),
    ) as unknown as Node;

    this.aoNode = aoNode;
    this.aoDenoise = aoClean;
    // The still frame's sum, and the output that reads it (used by the
    // 'still' and 'off' anti-aliasing modes; rebuildOutput picks).
    this.accumulate = new AccumulateNode(this.composites.viewer.plain);
    this.accumulateOut = (this.accumulate.getTextureNode() as ReturnType<typeof float>).div(this.aaCountU) as unknown as Node;
    this.pipeline = new RenderPipeline(this.renderer);
    // In AO-debug, show the raw occlusion values (1 = unoccluded ... 0 = fully
    // occluded) without the ACES/sRGB output transform, so the buffer reads true.
    if (this.aoDebug || this.dofDebug) this.pipeline.outputColorTransform = false;
    this.applyAoStrength();
    this.applyAoRadius();
    this.applyDof();
    this.rebuildOutput();
  }

  /** The depth-of-field gather over a composite, built the first time it is asked for. */
  private dofOver(base: Node): Node {
    let node = this.dofNodes.get(base);
    if (!node) {
      const viewZ = this.viewZNode as never;
      node = dof(base as never, viewZ, this.dofFocusU, this.dofRangeU, this.dofBokehU) as unknown as Node;
      this.dofNodes.set(base, node);
    }
    return node;
  }

  /**
   * Select the pipeline output: the viewer's or sculpt mode's composite, with
   * GTAO or without, and the depth-of-field gather over it when DoF is on (so
   * neither GTAO nor the gather is in the graph, or costs anything, while it
   * is off). The pipeline applies tone mapping + sRGB on output.
   */
  private rebuildOutput(force = false): void {
    const c = this.composites;
    if (!this.pipeline || !c) return;
    let out: Node;
    if (this.sculptShading && this.aoDebug && this.sculptAoDebugNode) {
      out = this.sculptAoDebugNode;
    } else if (!this.sculptShading && this.dofDebug && this.dofViewZDebugNode) {
      out = this.dofViewZDebugNode;
    } else if (!this.sculptShading && this.aoDebug && this.aoDebugNode) {
      // Diagnostic view: the GTAO term as greyscale. Uniform white means GTAO
      // computed no occlusion anywhere; visible dark creases mean AO works and
      // the composite/strength is the problem instead.
      out = this.aoDebugNode;
    } else {
      const base = c[this.sculptShading ? 'sculpt' : 'viewer'][this.aoEnabled ? 'ao' : 'plain'];
      const picture = this.dofEnabled ? this.dofOver(base) : base;
      // 'still' and 'off' draw through the sum, which a moving view replaces
      // every frame and a still one adds jittered samples to; 'always'
      // draws the picture straight, from the MSAA scene pass.
      if (this.aaMode !== 'always' && this.accumulate && this.accumulateOut) {
        if (this.accumulateInput !== picture) {
          this.accumulate.setInput(picture);
          this.accumulateInput = picture;
          force = true; // the sum's own pass rebuilds with the output
        }
        out = this.accumulateOut;
      } else {
        out = picture;
      }
    }
    if (this.pipeline.outputNode === out && !force) return;
    this.pipeline.outputNode = out;
    this.pipeline.needsUpdate = true;
    // A new output may bring GTAO into the graph: a stroke holds an AO only
    // once one has been drawn for the view (updateFrameMode).
    this.aoValid = false;
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
    // The denoise's depth tolerance is in world units too (its default of 5
    // is a small fraction of a subject here, or most of one): a neighbour
    // further off this pixel's tangent plane than a quarter of the radius
    // is another surface, and is not averaged in.
    if (this.aoDenoise) this.aoDenoise.depthPhi.value = Math.max(radius * 0.25, 1e-4);
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

  /**
   * Drive the focus distance. With a tap-to-focus lock, it's the camera→locked
   * point distance (so focus stays on that spot through orbit/dolly); otherwise
   * it tracks the orbit target, biased across the subject depth by the slider.
   */
  private updateDofFocus(): void {
    const focus = this.dofFocusPoint
      ? this.camera.position.distanceTo(this.dofFocusPoint)
      : this.controls.targetDistance() + (this.dofFocus * 2 - 1) * this.subjectRadius;
    this.dofFocusU.value = Math.max(focus, 0.01);
  }

  // --- anti-aliasing when still --------------------------------------------

  /**
   * Choose the anti-aliasing (AntialiasMode). The editors set theirs from
   * Preferences while they are mounted; the viewer and embeds keep 'always'.
   * Moving to or from 'always' changes the scene pass's MSAA, which
   * rebuilds the output and recompiles the scene's pipelines once, here;
   * going still, smoothing, holding and moving again never do
   * (updateAntialias).
   */
  setAntialias(mode: AntialiasMode): void {
    if (mode === this.aaMode) return;
    this.aaMode = mode;
    const scene = this.scenePass as unknown as { options: { samples?: number } } | null;
    if (scene && !CANVAS_MSAA) scene.options.samples = mode === 'always' ? SCENE_SAMPLES : 0;
    this.resetStill();
    this.rebuildOutput(true);
    this.invalidate();
  }

  getAntialias(): AntialiasMode {
    return this.aaMode;
  }

  /**
   * The picture changed: a still frame's smoothing starts over from the
   * plain frame, at once. Every setter here that changes what is drawn
   * calls this, as do the lights, the materials and the environment (their
   * onChange), the editors' redraw requests, input over the view
   * (onActivity) and a resize; a stroke, drag or camera move counts for as
   * long as it lasts (updateAntialias). A smoothed image cannot outlive
   * what it shows.
   */
  invalidate(): void {
    this.lastChange = performance.now();
    if (this.aaSamples > 0) this.resetStill();
  }

  /** Back to the plain frame: the sum replaced each frame, no camera offset. */
  private resetStill(): void {
    this.aaSamples = 0;
    if (this.accumulate) this.accumulate.mode = 'replace';
    this.aaCountU.value = 1;
    if (this.camera.view?.enabled) this.camera.clearViewOffset();
  }

  /**
   * Once a frame, before it renders. While anything changes the frame is
   * plain (the sum replaced by it). Once nothing has for STILL_AA_AFTER_MS,
   * each frame adds one sample drawn through a sub-pixel camera offset, the
   * last plain frame being the first; at STILL_AA_SAMPLES the sum is held,
   * and nothing is drawn but its average until the next change. Held, the
   * image is the same every frame: no shimmer.
   */
  private updateAntialias(now: number): void {
    const acc = this.accumulate;
    if (!acc || this.aaMode === 'always' || this.capturing || this.readbackHold) return;
    if (this.interaction !== null) this.lastChange = now;
    if (this.aaMode === 'off' || now - this.lastChange < STILL_AA_AFTER_MS) {
      if (this.aaSamples > 0 || acc.mode !== 'replace') this.resetStill();
      return;
    }
    if (this.aaSamples >= STILL_AA_SAMPLES) {
      acc.mode = 'hold';
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
      return;
    }
    this.addStillSample();
  }

  /**
   * Set up the next sample: the camera offset by its sub-pixel step, the
   * sum told to add, and the count the output divides by. The step is in
   * the drawing buffer's pixels, whatever its size (a capture renders
   * denser than the screen), and the view keeps the camera's own aspect.
   */
  private addStillSample(): void {
    const acc = this.accumulate;
    if (!acc) return;
    if (this.aaSamples === 0) this.aaSamples = 1; // the plain frame already in the sum
    const [jx, jy] = STILL_OFFSETS[this.aaSamples];
    const buffer = this.renderer.getDrawingBufferSize(this.bufferSize);
    const fh = buffer.y;
    const fw = fh * this.camera.aspect;
    this.camera.setViewOffset(fw, fh, (jx * fw) / buffer.x, jy, fw, fh);
    acc.mode = 'add';
    this.aaSamples++;
    this.aaCountU.value = this.aaSamples;
  }

  /** Scratch for addStillSample. */
  private readonly bufferSize = new Vector2();

  /** The anti-aliasing as the meter says it: "4× MSAA", "off …", "plain …" (not yet still), "9/16", "16/16 held". */
  private antialiasState(): string {
    if (this.aaMode === 'always') return '4× MSAA';
    if (this.aaMode === 'off') return 'off (thumbnails smoothed)';
    if (this.aaSamples === 0) return `plain (smooths after ${STILL_AA_AFTER_MS / 1000} s still)`;
    const held = this.accumulate?.mode === 'hold';
    return `${this.aaSamples}/${STILL_AA_SAMPLES}${held ? ' held' : ''}`;
  }

  // --- desktop pacing ------------------------------------------------------

  /**
   * The desktop app's launch state and what changes after it (the battery,
   * the display moved to). Browsers never call this: they hold every frame
   * for the display themselves.
   */
  setPacing(p: Partial<Pacing>): void {
    this.pacing = { ...this.pacing, ...p };
    const { uncapped, displayHz } = this.pacing;
    // Uncapped, rAF's spacing is the frame time, not the display's: the
    // meter's budget comes from the display Electron reports instead, or
    // 60 Hz where it reports none, as the idle pacing assumes.
    this.frameStats.setDisplayPeriod(uncapped ? 1000 / (displayHz > 0 ? displayHz : 60) : 0);
    this.wake();
  }

  getPacing(): Pacing {
    return { ...this.pacing };
  }

  /**
   * Input arrived: a loop paced because it was idle draws its next frame
   * now rather than on its timer. On battery the cap holds while working
   * too, so input leaves the timer be (it is never more than a refresh off).
   */
  wake(): void {
    this.lastInput = performance.now();
    if (!this.pacer || this.capturing || this.isPaced()) return;
    clearTimeout(this.pacer);
    this.pacer = 0;
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** Input over the view, a key, or a panel control moved (see the constructor). */
  private readonly onActivity = (): void => {
    this.invalidate();
    this.wake();
  };

  /**
   * Nothing has happened for IDLE_AFTER_MS: no input, no camera move, no
   * stroke or drag, no playback, and no still frame part-way through its
   * smoothing (which should finish at full speed).
   */
  private idle(now: number): boolean {
    const smoothing = this.aaMode !== 'always' && this.aaSamples > 0 && this.accumulate?.mode !== 'hold';
    return (
      now - this.lastInput > IDLE_AFTER_MS &&
      now - this.lastCameraMove > IDLE_AFTER_MS &&
      this.interaction === null &&
      !this.timeline.playing &&
      !smoothing
    );
  }

  /** Whether the next frame is paced to the display (the meter and the tests read this). */
  isPaced(now = performance.now()): boolean {
    const p = this.pacing;
    return p.uncapped && (p.onBattery || this.idle(now));
  }

  /**
   * Ask for the next frame. Browsers, and the desktop app with v-sync on,
   * already hold each frame for the display. With v-sync off the app draws
   * as fast as frames finish while you work; idle, or on battery all the
   * time, it waits on a timer until a refresh period after this frame
   * began, so it never draws frames the display cannot show.
   */
  private scheduleNext(frameStart: number): void {
    if (this.isPaced(frameStart)) {
      const hz = this.pacing.displayHz > 0 ? this.pacing.displayHz : 60;
      const wait = frameStart + 1000 / hz - performance.now();
      if (wait > 1) {
        this.pacer = window.setTimeout(() => {
          this.pacer = 0;
          this.rafId = requestAnimationFrame(this.loop);
        }, wait);
        return;
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** Fast frames apply: an editor is mounted, and Preferences says Fast frames. */
  private fastActive(): boolean {
    return this.fastFrames && settings.get('interactionLook') === 'fast';
  }

  /**
   * Decide what this frame draws, after everything that moves the camera has
   * run and before it renders (see fastFrames).
   *
   * Under a stroke ('stroke': the editor says so, and the camera is still)
   * the AO texture from the last full frame stays: GTAO and its denoise are
   * skipped, and nothing outside the brush changes, so pen-down shows no
   * pop. While anything moves ('move': the camera, the gizmo, a pose drag) a
   * held screen-space AO would smear across the view, so the AO is dropped,
   * and fades back over AO_FADE_MS once things stop. A held AO is always one
   * drawn for the view on screen: after a move, a stroke draws one full
   * frame before holding. The fill and rim shadows hold under a stroke and
   * redraw in turn while things move (Lighting.scheduleShadows).
   *
   * None of it builds, compiles or allocates anything: passes are skipped,
   * a uniform moves and the shadows' update flags change. The skipped passes
   * were compiled by the full frames before, and keep their targets.
   */
  private updateFrameMode(now: number, dt: number): void {
    const moved = this.cameraMoved();
    if (moved) this.lastCameraMove = now;
    const navigating = this.controls.isHeld() || now - this.lastCameraMove < MOVED_WITHIN_MS;
    const probe = this.interactionProbe?.() ?? null;
    let kind: InteractionKind | null = probe === 'move' || navigating ? 'move' : probe;
    if (this.debugInteraction !== undefined) kind = this.debugInteraction;
    // Come to rest from a coast: what the damping still owes the view is a
    // fraction of a pixel, but it creeps on, and the creep adds up against
    // the last place the camera counted as moving, so it could count once
    // more a moment later and drop the AO again as it faded back in (the
    // latency suite caught it). The coast ends here instead.
    if (this.interaction === 'move' && kind === null && !this.controls.isHeld()) this.controls.halt();
    this.bracketInteraction(kind, probe !== null || this.controls.isHeld());
    this.interaction = kind;

    const fast = this.fastActive();
    const ao = this.aoNode;
    const denoise = this.aoRtt;
    if (fast && kind === 'move') {
      if (ao) ao.skip = true;
      if (denoise) denoise.autoUpdate = false;
      this.aoValid = false;
      this.aoDropU.value = 1;
    } else {
      const hold = fast && kind === 'stroke' && this.aoValid && !moved;
      if (ao) ao.skip = hold;
      if (denoise) denoise.autoUpdate = !hold;
      // Not held: this frame draws the AO for the view as it now stands.
      if (!hold) this.aoValid = this.aoEnabled;
      const drop = this.aoDropU.value as number;
      if (drop > 0) this.aoDropU.value = Math.max(0, drop - (dt * 1000) / AO_FADE_MS);
    }
    this.lighting.scheduleShadows(
      fast && kind === 'stroke' ? 'hold' : fast && kind === 'move' ? 'stagger' : 'all',
      this.frameNo,
    );
  }

  /**
   * Whether the camera turned or moved this frame by more than about a
   * quarter of a pixel (CAMERA_STILL_EPS), measured from where it last
   * counted as moving, so a slow creep still adds up.
   */
  private cameraMoved(): boolean {
    const cam = this.camera;
    const dist = Math.max(this.controls.targetDistance(), 1e-6);
    // 1 - |q.q'| is about angle^2 / 8 for small turns.
    const turned = 1 - Math.abs(cam.quaternion.dot(this.lastCamQuat));
    const shifted = cam.position.distanceTo(this.lastCamPos) / dist;
    const moved = shifted > CAMERA_STILL_EPS || turned > (CAMERA_STILL_EPS * CAMERA_STILL_EPS) / 8;
    if (moved) {
      this.lastCamPos.copy(cam.position);
      this.lastCamQuat.copy(cam.quaternion);
    }
    return moved;
  }

  /**
   * Whether the camera is off where it last counted as moving, by the same
   * quarter-pixel margin, without moving that mark: for a readback taken
   * between frames, after a camera change no frame has seen yet.
   */
  private cameraDrifted(): boolean {
    const cam = this.camera;
    const dist = Math.max(this.controls.targetDistance(), 1e-6);
    const turned = 1 - Math.abs(cam.quaternion.dot(this.lastCamQuat));
    const shifted = cam.position.distanceTo(this.lastCamPos) / dist;
    return shifted > CAMERA_STILL_EPS || turned > (CAMERA_STILL_EPS * CAMERA_STILL_EPS) / 8;
  }

  /** True from an interaction's end until the frame after it has rendered. */
  private interactionEnding = false;

  /**
   * Bracket each stroke or drag with the build counters, so the meter (and
   * a test) can say what one cost: from the frame it began through the
   * first full frame after it ended, the frame the skipped passes return
   * in. Only a person starts one - a stroke, a pose or gizmo drag, a pointer
   * on the view - and the coast after it stays inside; the camera moving on
   * its own (the framing at boot, while the first frames compile) does not.
   */
  private bracketInteraction(kind: InteractionKind | null, byUser: boolean): void {
    if (kind !== null && byUser && !this.interactionStart) this.interactionStart = this.renderCounters();
    if (!this.interactionStart) return;
    this.interactionEnding = kind === null;
  }

  private finishInteraction(): void {
    this.interactionEnding = false;
    const start = this.interactionStart;
    if (!start) return;
    const now = this.counters;
    this.lastInteractionDelta = {
      nodeBuilds: now.nodeBuilds - start.nodeBuilds,
      programs: now.programs - start.programs,
      pipelines: now.pipelines - start.pipelines,
      textures: now.textures - start.textures,
      buffers: now.buffers - start.buffers,
      bindGroups: now.bindGroups - start.bindGroups,
    };
    this.interactionStart = null;
  }

  /**
   * Render the scene to the canvas. The renderer is initialized up front (see
   * Viewer.create), so per-frame rendering is synchronous.
   */
  private renderOnce(): void {
    if (this.debugSkipRender) return;
    // Every render is a frame of its own (frameClock.ts): a readback's
    // sixteen in a row each redraw the scene.
    this.clock.tick();
    if (this.dofEnabled) this.updateDofFocus(); // focus plane tracks the orbit target
    if (this.wireframeOn && this.sculptWires.size) this.refreshSculptWires();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Render and wait until the frame has settled on the canvas, so an immediate
   * read-back (drawImage during capture) sees the rendered pixels. One
   * animation-frame yield after the synchronous render lets the WebGPU canvas
   * present.
   */
  private async renderForReadback(smooth = true): Promise<void> {
    const acc = this.accumulate;
    // A camera moved since the last frame (directly, by code) makes a held
    // or part-smoothed image stale: start from a plain frame of this view.
    // Anything else that changes the picture says so (invalidate), as
    // Armature does when it hides its handles for its picture.
    if (this.aaSamples > 0 && this.cameraDrifted()) this.resetStill();
    if (smooth && acc && this.aaMode !== 'always') {
      // Thumbnails, and anything else published, are smooth whatever the
      // screen shows (owner call): the still frame's samples are finished
      // now, one render each, from a plain frame if there is none. A view
      // already held costs one render.
      if (this.aaSamples < STILL_AA_SAMPLES) {
        if (this.aaSamples === 0) {
          acc.mode = 'replace';
          this.aaCountU.value = 1;
          this.renderOnce();
        }
        do {
          this.addStillSample();
          this.renderOnce();
        } while (this.aaSamples < STILL_AA_SAMPLES);
        acc.mode = 'hold';
        this.camera.clearViewOffset();
      }
      this.readbackHold = true; // until the caller has read it (endReadback)
      this.renderOnce();
    } else {
      this.renderOnce();
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  /** The canvas has been read: the loop's anti-aliasing goes on as before. */
  private endReadback(): void {
    this.readbackHold = false;
  }

  private setRenderScale(maxRatio: number): void {
    const ratio = Math.min(this.startRatio, maxRatio);
    if (ratio === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.invalidate(); // the still frame's sum is reallocated at the new size
  }

  /**
   * The knobs adaptive quality turns (adaptive.ts), each from the tier's
   * own setting: uniforms, shadow schedules and map sizes, and the pixel
   * ratio. Nothing here rebuilds a shader, and the anti-aliasing mode is
   * never one of them.
   */
  private qualityKnobs(): QualityKnobs {
    return {
      hasAo: () => this.aoEnabled,
      setAoSamples: (share) => {
        if (this.aoNode) this.aoNode.samples.value = Math.max(4, Math.round(this.tierAoSamples * share));
        this.invalidate();
      },
      setAoResolution: (share) => {
        if (this.aoNode) this.aoNode.resolutionScale = this.tierAoScale * share;
        this.invalidate();
      },
      setShadowEconomy: (on) => this.lighting.setShadowQuality(on, this.shadowMapShare),
      pixelRatioSteps: () => [1.75, 1.5, 1.25, 1].filter((cap) => cap < this.startRatio),
      setPixelRatioCap: (cap) => this.setRenderScale(cap),
      setShadowMapScale: (share) => {
        this.shadowMapShare = share;
        this.lighting.setShadowQuality(this.adaptive.level >= 3, share);
      },
    };
  }

  /** Adaptive quality's shadow map share, kept beside the economy it is set with. */
  private shadowMapShare = 1;

  /** Per-frame hook (sculpt mode: light follow + cursor re-projection). */
  onTick: (() => void) | null = null;
  /**
   * Called right AFTER the orbit controls have updated. Anything that needs
   * the final camera for the frame - or needs to override it - belongs here;
   * onTick runs before the controls and gets overwritten.
   */
  onPostControls: (() => void) | null = null;

  private readonly loop = (rafTime?: number): void => {
    const now = performance.now();
    // The stall watchdog (perfLog): frames this far apart mean the main
    // thread was held up, which is what a freeze on the device is. The note
    // is the previous frame's own share (tick, controls, render); the rest
    // of the gap went to something outside the loop.
    if (this.frameStart > 0 && now - this.frameStart > STALL_MS) {
      perfLog.record('stall', now - this.frameStart, `frame ${formatMs(this.frameWork)}`);
    }
    this.frameStart = now;
    this.scheduleNext(now);
    this.onTick?.();
    this.timer.update();
    const raw = this.timer.getDelta();
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.1; // smoothed
    // Clamp dt so a backgrounded tab (which pauses rAF) can't return a huge
    // delta and lurch the playhead across many frames on the next visible tick.
    const dt = Math.min(raw, 0.1);

    // While buffering, the clock holds (dt 0) so the playhead never runs ahead
    // of what can be shown — playback resumes in order instead of skipping.
    this.timeline.update(this.updateBuffering() ? 0 : dt);
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
      this.invalidate();
    }

    this.controls.update(dt);
    this.onPostControls?.();
    // After everything that moves the camera this frame: the near plane
    // follows the distance it ended at.
    this.controls.syncLimits();
    this.updateFrameMode(now, dt);
    // The desktop suite's hook draws nothing, so there is nothing to sum.
    if (this.debugSkipRender) this.resetStill();
    else this.updateAntialias(now);
    // Adaptive quality judges a window a second, and changes anything only
    // between strokes and drags, the view still for a moment.
    this.adaptive.tick(
      now,
      () => this.frameStats.summary(),
      this.interaction === null && now - this.lastCameraMove > 300 && !this.capturing,
    );
    this.frameNo++;
    const encodeStart = performance.now();
    this.renderOnce();
    const end = performance.now();
    this.frameWork = end - now;
    // The loop's own share, the encode, and the input the frame carried;
    // rAF's own timestamp, aligned to the display, measures the refresh.
    const inputAt = this.frameStats.endFrame(rafTime ?? now, encodeStart - now, end - encodeStart, end);
    if (this.gpuTiming) this.sampleGpu(end, inputAt);
    if (this.interactionEnding) this.finishInteraction();
  };

  /**
   * A hidden tab gets no frames at all; coming back is not a stall, so the
   * watchdog starts over from the next one, and the meter does not read
   * the gap as a frame.
   */
  private readonly onVisibility = (): void => {
    this.frameStart = 0;
    this.frameStats.resetClock();
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
    this.invalidate(); // a new size: the still frame's sum is reallocated
  };

  /**
   * Pointer-down pick. We begin tracking a press here; a double press —
   * double-click (mouse) or double-tap (touch) — is recognised on lift (see
   * onTapEnd), so a single press or a drag still passes through and orbits.
   */
  private readonly onPickPointer = (e: PointerEvent): void => {
    // Only the primary button opens a focus press; middle/right stay with
    // OrbitControls (pan/dolly). Touch reports button 0 for each finger.
    if (e.button !== 0) return;
    this.activeTouches.add(e.pointerId);
    // A second finger means pinch/two-finger pan — abort the press sequence.
    if (this.activeTouches.size > 1) {
      this.tapPointerId = -1;
      this.lastTapTime = -1;
      return;
    }
    this.tapPointerId = e.pointerId;
    this.tapStartX = e.clientX;
    this.tapStartY = e.clientY;
    this.tapStartTime = e.timeStamp;
    this.tapMoved = false;
  };

  /** A tracked finger that drifts past the slop is an orbit, not a tap. */
  private readonly onTapMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.tapPointerId || this.tapMoved) return;
    const dx = e.clientX - this.tapStartX;
    const dy = e.clientY - this.tapStartY;
    if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) this.tapMoved = true;
  };

  /**
   * Tap lift. A clean tap (no drift) that lands soon after, and near, the
   * previous one completes a double-tap and sets focus; otherwise it's banked
   * as the first tap. A drifted lift (an orbit) breaks any pending sequence.
   */
  /** Sculpt mode turns the double-tap focus off: two quick dabs are strokes. */
  tapToFocus = true;

  private readonly onTapEnd = (e: PointerEvent): void => {
    this.activeTouches.delete(e.pointerId);
    if (!this.tapToFocus) {
      this.lastTapTime = -1;
      return;
    }
    if (e.pointerId !== this.tapPointerId) return;
    this.tapPointerId = -1;
    if (this.tapMoved) {
      this.lastTapTime = -1;
      return;
    }
    const dx = this.tapStartX - this.lastTapX;
    const dy = this.tapStartY - this.lastTapY;
    const isDouble =
      this.lastTapTime >= 0 &&
      this.tapStartTime - this.lastTapTime <= DOUBLE_TAP_MS &&
      dx * dx + dy * dy <= DOUBLE_TAP_DIST * DOUBLE_TAP_DIST;
    if (isDouble) {
      this.lastTapTime = -1; // consume — a third tap starts fresh
      e.preventDefault(); // suppress the synthesised click / double-tap zoom
      if (this.focusAtPointer(this.tapStartX, this.tapStartY)) {
        navigator.vibrate?.(15); // haptic confirm where supported (ignored on iOS)
      }
      return;
    }
    this.lastTapTime = this.tapStartTime; // bank as the first tap
    this.lastTapX = this.tapStartX;
    this.lastTapY = this.tapStartY;
  };

  /** A cancelled pointer (gesture stolen) drops the in-progress tap sequence. */
  private readonly onTapCancel = (e: PointerEvent): void => {
    this.activeTouches.delete(e.pointerId);
    if (e.pointerId === this.tapPointerId) this.tapPointerId = -1;
    this.lastTapTime = -1;
  };
}

function preventTouchDefault(e: TouchEvent): void {
  e.preventDefault();
}

/**
 * The WebGPU adapter in a line. Firefox-based browsers (Zen among them)
 * report nothing at all, deliberately, and the line says that rather than
 * looking like a fault.
 */
export function describeAdapter(ai: { vendor?: string; architecture?: string; description?: string } | undefined): string {
  return (
    [ai?.description, ai?.vendor, ai?.architecture].filter(Boolean).join(' · ') ||
    'not reported by this browser'
  );
}

/** 1.6M, 820k, 950: a count the meter can print in a few characters. */
function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
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
