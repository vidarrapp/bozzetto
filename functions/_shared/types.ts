export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Optional comma-separated allowlist of admin emails (from Access). */
  ADMIN_EMAILS?: string;
  /** Local-dev only: when "true", treats every request as an authed admin. */
  DEV_ADMIN?: string;
  /**
   * Optional hardening: when both are set, admin routes verify the Access
   * JWT (`Cf-Access-Jwt-Assertion`) against the team's public keys instead
   * of trusting the email header - which is only unforgeable while an
   * Access application actually fronts the route. TEAM_DOMAIN is the
   * `<team>.cloudflareaccess.com` host; AUD is the application audience tag.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/**
 * 'scene' is a sculpt saved to the library: one .bozz file, opened in Sculpt
 * rather than played in the viewer, so it has no frames.
 */
export type ProjectMode = 'timelapse' | 'model' | 'scene';

/** Public projects are anyone's to see; private ones the owner's alone. */
export type Visibility = 'public' | 'private';

/** What a scene card shows, recorded when its file lands. */
export interface SceneMeta {
  objects: number;
  tris: number;
  /** Size of the stored .bozz file, as R2 measured it. */
  bytes: number;
}

export interface FrameMeta {
  index: number;
  tris: number;
}

export interface StageMeta {
  name: string;
  frame: number;
  desc: string;
}

/** JSON blob stored in projects.data. */
export interface ProjectData {
  defaults: {
    frame: number;
    playing: boolean;
    material: string;
    lightingPreset: string;
  };
  camera: { autoFrame: boolean };
  /** Custom lighting rig state (applied by the editor/viewer when present). */
  lighting?: unknown;
  /** Custom material look (albedo/roughness/metalness/flat/matcap). */
  material?: unknown;
  /** Selected HDRI environment + intensity. */
  environment?: unknown;
  /** Ambient-occlusion settings. */
  ao?: unknown;
  /** Presentation: ground shadow / floor / pedestal. */
  presentation?: unknown;
  stages: StageMeta[];
  frames: FrameMeta[];
  /** A scene project's counts and size; absent until its first upload completes. */
  scene?: SceneMeta;
}

export interface ProjectRow {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  data: string;
  visibility: Visibility;
  created_at: number;
  updated_at: number;
}
