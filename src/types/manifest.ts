/**
 * TypeScript types mirroring the manifest schema (design doc §11).
 *
 * The app boots from `?tl=<id>` and loads `/timelapses/<id>/manifest.json`.
 * All frame paths and counts are read from the manifest — nothing about the
 * asset layout is hardcoded in the viewer.
 */

export type Tier = 'sd' | 'hd';

export interface ManifestConfig {
  /** Number of frames in the timeline. */
  frameCount: number;
  /** Default playback rate (frames per second). Low and deliberate. */
  fps: number;
  /** File extension of frame meshes (e.g. "glb"). */
  ext: string;
  /** Tiers present in this timelapse. v1 ships ["sd"]; schema is tier-ready. */
  tiers: Tier[];
  /** Manifest index of the first frame (cosmetic; playback is 0-based). */
  frameStartIndex: number;
}

export interface ManifestDefaults {
  /** Initial frame (ordinal, 0-based). */
  frame: number;
  /** Whether playback starts immediately. */
  playing: boolean;
  /** Initial material mode id (e.g. "lit"). */
  material: string;
  /** Initial lighting preset id (e.g. "three_point"). */
  lightingPreset: string;
}

export interface ManifestCamera {
  /** Auto-frame the subject on load (used when no saved camera is present). */
  autoFrame: boolean;
  /** Saved camera position [x, y, z]; restored on load when present. */
  position?: number[];
  /** Saved orbit target [x, y, z]; restored alongside `position`. */
  target?: number[];
  /** Lens focal length in 35mm-equivalent mm (drives the perspective). */
  focalLength?: number;
  /** Depth-of-field: on/off, aperture (f-stop), and focus across the subject. */
  dof?: {
    enabled: boolean;
    fStop: number;
    focus?: number;
    /** Tap-to-focus lock: a world-space point the focus plane sticks to. */
    focusPoint?: [number, number, number];
  };
}

export interface FrameEntry {
  /** Manifest index of this frame. */
  index: number;
  /** Path to the sd-tier mesh, relative to the manifest location. */
  sd: string;
  /** Path to the hd-tier mesh, or null when only one tier ships. */
  hd: string | null;
  /** Triangle count (informational: budget display, debugging). */
  tris: number;
}

export interface StageEntry {
  /** Display name of the stage (e.g. "Big Volumes"). */
  name: string;
  /** Frame ordinal where the stage begins. */
  frame: number;
  /** Short description shown alongside the stage label. */
  desc: string;
}

export type ProjectMode = 'timelapse' | 'model';

export interface Manifest {
  id: string;
  title: string;
  /** Presentation mode. API projects carry it; static manifests default to timelapse. */
  mode: ProjectMode;
  /** Optional custom lighting rig state (applied by the viewer when present). */
  lighting: unknown;
  /** Optional custom material look (applied by the viewer when present). */
  material: unknown;
  /** Optional HDRI environment selection (applied by the viewer when present). */
  environment: unknown;
  /** Optional ambient-occlusion settings (applied by the viewer when present). */
  ao: unknown;
  /** Optional presentation (ground shadow, floor, pedestal) when present. */
  presentation: unknown;
  config: ManifestConfig;
  defaults: ManifestDefaults;
  camera: ManifestCamera;
  frames: FrameEntry[];
  stages: StageEntry[];
}

/**
 * Validate parsed JSON against the manifest schema. Throws with a clear
 * message on the first structural problem so the console error is actionable.
 */
export function validateManifest(data: unknown): Manifest {
  const fail = (msg: string): never => {
    throw new Error(`Invalid manifest: ${msg}`);
  };

  if (typeof data !== 'object' || data === null) fail('expected a JSON object');
  const m = data as Record<string, unknown>;

  if (typeof m.id !== 'string') fail('`id` must be a string');
  if (typeof m.title !== 'string') fail('`title` must be a string');

  const config = m.config as Record<string, unknown> | undefined;
  if (!config || typeof config !== 'object') fail('`config` is required');
  if (typeof config!.frameCount !== 'number' || config!.frameCount <= 0) {
    fail('`config.frameCount` must be a positive number');
  }
  if (typeof config!.fps !== 'number' || config!.fps <= 0) {
    fail('`config.fps` must be a positive number');
  }
  if (!Array.isArray(config!.tiers) || config!.tiers.length === 0) {
    fail('`config.tiers` must be a non-empty array');
  }

  if (!Array.isArray(m.frames) || m.frames.length === 0) {
    fail('`frames` must be a non-empty array');
  }
  const frames = m.frames as unknown[];
  if (frames.length !== (config!.frameCount as number)) {
    fail(
      `\`frames.length\` (${frames.length}) must equal \`config.frameCount\` (${config!.frameCount})`,
    );
  }
  frames.forEach((f, i) => {
    const fe = f as Record<string, unknown>;
    if (typeof fe.sd !== 'string') fail(`frames[${i}].sd must be a string path`);
  });

  // `defaults`, `camera`, and `stages` are filled with safe fallbacks if absent.
  const defaults: ManifestDefaults = {
    frame: 0,
    playing: true,
    material: 'lit',
    lightingPreset: 'three_point',
    ...((m.defaults as object) ?? {}),
  };
  const camera: ManifestCamera = {
    autoFrame: true,
    ...((m.camera as object) ?? {}),
  };
  const stages: StageEntry[] = Array.isArray(m.stages)
    ? (m.stages as StageEntry[])
    : [];

  return {
    id: m.id as string,
    title: m.title as string,
    mode: m.mode === 'model' ? 'model' : 'timelapse',
    lighting: m.lighting ?? null,
    material: m.material ?? null,
    environment: m.environment ?? null,
    ao: m.ao ?? null,
    presentation: m.presentation ?? null,
    config: {
      frameStartIndex: 0,
      ext: 'glb',
      ...(config as object),
    } as ManifestConfig,
    defaults,
    camera,
    frames: frames as FrameEntry[],
    stages,
  };
}
