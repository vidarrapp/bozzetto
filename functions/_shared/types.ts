/**
 * 'scene' is a sculpt saved to the library: one .bozz file, opened in Sculpt
 * rather than played in the viewer, so it has no frames.
 */
export type ProjectMode = 'timelapse' | 'model' | 'scene';

/**
 * Public projects are anyone's to see; private ones the owner's alone. Only
 * a template is ever public (docs/accounts.md §1): on one, private means
 * privatised, taken off the gallery.
 */
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
  /** Whose it is; null for a template, and for the owner's own before the bootstrap. */
  owner_id: string | null;
  /** 1 for a template: the site's, listed in the gallery while public. */
  template: 0 | 1;
  /** Where its files are in R2; null for the legacy projects/<id>/ (see prefixFor). */
  storage_prefix: string | null;
  /** What its files weigh, as counted against its owner's quota. */
  bytes: number;
  /** Phase 3's; 'none' until then. */
  moderation: string;
}

export type Role = 'owner' | 'moderator' | 'member';
export type UserStatus = 'active' | 'suspended' | 'deleting';

/** A row of users (migrations/0003_accounts.sql). */
export interface UserRow {
  id: string;
  handle: string;
  email: string;
  webauthn_user_id: string;
  role: Role;
  status: UserStatus;
  quota_bytes: number;
  bytes_used: number;
  invite_id: string | null;
  terms_version: string;
  terms_accepted_at: number;
  age_confirmed_at: number;
  handle_changed_at: number | null;
  suspended_reason: string | null;
  created_at: number;
  updated_at: number;
}

/** A row of sessions: the cookie's token is never stored, only its hash. */
export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  method: string;
  client: string;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  reauth_at: number;
  expires_at: number;
  revoked_at: number | null;
}
