import {
  ARMATURE_FILE,
  ARMATURE_MAX_BYTES,
  ARMATURE_PROJECT_KIND,
  ArmatureFileError,
  knownArmatureFigure,
  parseArmatureProject,
} from '../../shared/armature';
import { ApiError, AuthExpiredError, libraryProjects, mediaPath, type SceneProject } from '../admin/api';
import { apiFetch } from '../net/origin';
import { gunzipCapped } from '../viewer/inflate';
import { sanitizeLook } from '../sculpt/bridge/sanitize';
import { sceneManifest, templateManifest, unreachable } from '../sculpt/bridge/SceneProjects';
import type { LookState } from '../viewer/Viewer';
import type { ArmatureState } from './Armature';
import type { ArmatureFile } from './persist';

/**
 * Armature projects (docs/accounts.md §4): an armature saved to the
 * library when someone is signed in - My projects with accounts on, the
 * owner's Projects with them off - as one file, armature.json
 * (shared/armature.ts), with a thumbnail beside it. A guest's Save to
 * library is the .armature download it always was (file.ts); the project
 * file is the server's format, gzipped JSON, and only comes back in
 * through decodeArmatureProject, which takes nothing it has not checked.
 */

/** The figure an unknown one becomes (mode.ts DEFAULT_FIGURE). */
export const DEFAULT_PROJECT_FIGURE = 'mannequin-male-realistic';

/** Where Save to library writes again: the project the armature was opened from or last saved to. */
export interface ArmatureLink {
  id: string;
  title: string;
  /** The owner tools' routes, for one opened from Projects with accounts on. */
  scope?: 'admin';
}

/** What an armature project's file comes back as. */
export interface DecodedArmature {
  file: ArmatureFile;
  symmetry: boolean;
  /** Something about it that was not as saved: an unknown figure, stood in for. */
  notice: string | null;
}

/** The longest title a project keeps (functions/_shared/projects.ts). */
const MAX_TITLE = 200;
/** A bone, chain or part name as the rigs spell them: 'upperarm.L', 'foot.R'. */
const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The most entries any one table of the state may have; a rig has a few dozen bones. */
const MAX_ENTRIES = 256;
/** How far from the origin a root or pin may be, in scene units: well past any figure. */
const MAX_COORD = 1e5;

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const triple = (v: unknown, max: number): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => finite(x, max)) ? [v[0], v[1], v[2]] : null;

/** Each entry of a table whose key is a name and whose value `take` accepts; the rest left behind. */
function table<T>(v: unknown, take: (x: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRec(v)) return out;
  let n = 0;
  for (const [k, x] of Object.entries(v)) {
    if (n >= MAX_ENTRIES) break;
    if (!NAME.test(k)) continue;
    const got = take(x);
    if (got === null) continue;
    out[k] = got;
    n++;
  }
  return out;
}

/**
 * A state as Armature.restore takes one, every field checked: the root a
 * finite position and a unit quaternion, each pose three finite angles,
 * each proportion two positive numbers, each pin a finite point, each aim a
 * finite angle. What is not so is left out, and the figure stands as it
 * would without it. `plant` and `pins` stay absent when the file had none,
 * as restore reads that (an older figure, brought up to date).
 */
export function sanitizeArmatureState(raw: unknown, figure: string): ArmatureState {
  const s = isRec(raw) ? raw : {};
  const state: ArmatureState = {
    v: 1,
    preset: figure,
    root: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    pose: table(s.pose, (x) => triple(x, 720)),
    proportions: table(s.proportions, (x) =>
      isRec(x) && finite(x.size) && finite(x.length) && x.size > 0 && x.length > 0
        ? { size: Math.min(20, x.size), length: Math.min(20, x.length) }
        : null,
    ),
  };
  const root = isRec(s.root) ? s.root : null;
  const position = triple(root?.position, MAX_COORD);
  const q = root?.quaternion;
  const quaternion =
    Array.isArray(q) && q.length === 4 && q.every((x) => finite(x, 2)) ? (q as [number, number, number, number]) : null;
  const len = quaternion ? Math.hypot(...quaternion) : 0;
  if (position && quaternion && len > 1e-6) {
    state.root = { position, quaternion: quaternion.map((x) => x / len) as [number, number, number, number] };
  } else {
    // No root worth the name: the rig's own rest, which restore keeps when given none.
    delete (state as Partial<ArmatureState>).root;
  }
  if (isRec(s.pins)) state.pins = table(s.pins, (x) => triple(x, MAX_COORD));
  if (isRec(s.aims)) state.aims = table(s.aims, (x) => (finite(x, 1e6) ? x : null));
  if (typeof s.plant === 'boolean') state.plant = s.plant;
  return state;
}

/**
 * The project's file from its text, parsed (shared/armature.ts: one object,
 * v 1, no __proto__) and every field sanitised. A figure the app does not
 * have becomes the default mannequin, with a notice saying so.
 */
export function readArmatureProject(text: string): DecodedArmature {
  const rec = parseArmatureProject(text);
  let figure = rec.figure as string;
  let notice: string | null = null;
  if (!knownArmatureFigure(figure)) {
    notice = `This armature was posed on a figure Bozzetto does not have ("${figure.slice(0, 40)}"); it stands on the realistic male mannequin instead.`;
    figure = DEFAULT_PROJECT_FIGURE;
  }
  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim().slice(0, MAX_TITLE) : 'Armature';
  return {
    file: {
      kind: 'bozzetto-armature',
      v: 1,
      name,
      state: sanitizeArmatureState(rec.state, figure),
      look: sanitizeLook(rec.look) as LookState | undefined,
      savedAt: finite(rec.savedAt) ? rec.savedAt : Date.now(),
    },
    symmetry: rec.symmetry === true,
    notice,
  };
}

const isGzip = (b: Uint8Array): boolean => b.length >= 3 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08;

/** The file's bytes as stored - gzip, or the plain JSON - as text, held to the format's cap. */
export async function armatureText(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  const tooLarge = `An armature may be at most ${ARMATURE_MAX_BYTES / (1024 * 1024)} MB`;
  let raw = bytes;
  if (isGzip(head)) {
    try {
      raw = await gunzipCapped(bytes, ARMATURE_MAX_BYTES, tooLarge);
    } catch (err) {
      throw new ArmatureFileError(err instanceof Error && err.message === tooLarge ? tooLarge : 'This armature file is damaged');
    }
  } else if (bytes.byteLength > ARMATURE_MAX_BYTES) {
    throw new ArmatureFileError(tooLarge);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new ArmatureFileError('This armature file is not text');
  }
}

/** An armature project's file, as stored, read and sanitised. */
export async function decodeArmatureProject(bytes: ArrayBuffer): Promise<DecodedArmature> {
  return readArmatureProject(await armatureText(bytes));
}

/** Whether parsed JSON is a project's file rather than a .armature one: it says so, or names a figure. */
export const isProjectRecord = (rec: unknown): boolean =>
  isRec(rec) && (rec.kind === ARMATURE_PROJECT_KIND || (rec.kind === undefined && typeof rec.figure === 'string'));

/** The armature as the project's file: the figure on top, the state without its preset, gzipped where the browser can. */
export async function encodeArmatureProject(file: ArmatureFile, symmetry: boolean): Promise<ArrayBuffer> {
  const { preset, v: _v, ...state } = file.state;
  const json = JSON.stringify({
    kind: ARMATURE_PROJECT_KIND,
    v: 1,
    figure: preset,
    name: file.name,
    state,
    symmetry,
    ...(file.look ? { look: file.look } : {}),
    savedAt: file.savedAt,
  });
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return raw.buffer;
  return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

/** "Armature 7 Oct 14:05": a new project's title, when the armature has no name of its own. */
export function defaultArmatureTitle(name?: string): string {
  if (name && name.trim() && name !== 'Armature') return name.trim().slice(0, MAX_TITLE);
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `Armature ${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- the server -----------------------------------------------------------------------------

export interface ArmatureUpload {
  bytes: ArrayBuffer;
  /** The title a new project gets; a re-save keeps the project's own. */
  title: string;
  thumb?: Blob;
  /** Re-save this project in place; absent makes a new one. */
  projectId?: string;
  scope?: 'admin';
}

/**
 * Save an armature to the library: create its project (or re-save the one
 * it came from), send the file, then a best-effort thumbnail, on the routes
 * its scope says (libraryProjects). A project created here is taken back
 * if the file does not go, so a failed save leaves no card that opens
 * nothing. A project deleted elsewhere since is made again, keeping the work.
 */
export async function uploadArmature(u: ArmatureUpload, onProgress: (text: string) => void = () => {}): Promise<ArmatureLink> {
  try {
    const client = await libraryProjects(u.scope);
    let id = u.projectId ?? null;
    let title = u.title.slice(0, MAX_TITLE);
    let sent = false;
    if (id) {
      onProgress('Uploading...');
      try {
        title = (await client.armatureUpload(id, u.bytes)).title || title;
        sent = true;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        id = null;
      }
    }
    if (!id) {
      onProgress('Creating project...');
      const made = await client.create({ mode: 'armature', title });
      id = made.id;
      title = made.title || title;
    }
    const project = id;
    if (!sent) {
      onProgress('Uploading...');
      try {
        title = (await client.armatureUpload(project, u.bytes)).title || title;
      } catch (err) {
        if (!u.projectId || u.projectId !== project) await client.remove(project).catch(() => undefined);
        throw err;
      }
    }
    if (u.thumb) {
      try {
        await client.uploadThumb(project, u.thumb);
      } catch {
        // The card shows without a picture until the next save.
      }
    }
    return { id: project, title, ...(u.scope === 'admin' ? { scope: 'admin' as const } : {}) };
  } catch (err) {
    throw unreachable(err);
  }
}

/** An armature project's file, from under the base its manifest names. */
async function armatureBytes(project: SceneProject): Promise<ArrayBuffer> {
  if (project.mode !== 'armature') throw new Error(`"${project.title}" is not an armature`);
  const res = await apiFetch(mediaPath(project, `${ARMATURE_FILE}?v=${project.updated_at}`)).catch((err: unknown) => {
    throw unreachable(err);
  });
  if (res.signedOut) throw new AuthExpiredError();
  if (res.status === 404) throw new Error(`"${project.title}" has no armature file: its save did not finish`);
  if (!res.ok || !res.bytes || res.contentType.includes('text/html')) {
    throw new Error(`Could not download "${project.title}" (${res.status})`);
  }
  return res.bytes;
}

/**
 * One's own armature project (`/?armature=1&project=<id>`), read and
 * sanitised, through the routes sceneManifest picks: the account's own, or
 * the owner tools' with `scope` 'admin'; and the link to save it back to.
 */
export async function fetchArmatureProject(id: string, scope?: 'admin'): Promise<DecodedArmature & { link: ArmatureLink | null; title: string }> {
  const found = await sceneManifest(id, scope);
  const decoded = await decodeArmatureProject(await armatureBytes(found.project));
  // Off the public route it is a template seen by someone else: no link, a copy.
  const link = found.owner ? { id: found.project.id, title: found.project.title, ...(found.scope ? { scope: found.scope } : {}) } : null;
  return { ...decoded, link, title: found.project.title };
}

/** A template's armature (`/?armature=1&template=<id>`), as a copy: nobody's project, no link. */
export async function fetchArmatureTemplate(id: string): Promise<DecodedArmature & { title: string }> {
  const project = await templateManifest(id);
  return { ...(await decodeArmatureProject(await armatureBytes(project))), title: project.title };
}

/**
 * The armature kept on this device (the autosave record), saved to the
 * library from its gallery card: as Save to library in the mode saves it,
 * to the project it belongs to if it has one. A model loaded from a file
 * is not the library's to keep.
 */
export async function uploadKeptArmature(rec: ArmatureFile, onProgress: (text: string) => void = () => {}): Promise<ArmatureLink> {
  if (!knownArmatureFigure(rec.state.preset)) {
    throw new Error('A model loaded from a file stays on this device; the library keeps the built-in figures');
  }
  const bytes = await encodeArmatureProject(rec, rec.symmetry === true);
  const link = rec.project;
  return uploadArmature(
    { bytes, title: link?.title ?? defaultArmatureTitle(rec.name), thumb: rec.thumb, projectId: link?.id, scope: link?.scope },
    onProgress,
  );
}

export { ArmatureFileError };
