export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Optional comma-separated allowlist of admin emails (from Access). */
  ADMIN_EMAILS?: string;
  /** Local-dev only: when "true", treats every request as an authed admin. */
  DEV_ADMIN?: string;
}

export type ProjectMode = 'timelapse' | 'model';

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
  stages: StageMeta[];
  frames: FrameMeta[];
}

export interface ProjectRow {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  data: string;
  created_at: number;
  updated_at: number;
}
