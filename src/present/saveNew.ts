import { AuthExpiredError, libraryProjects, uploadFailure } from '../admin/api';
import { loadConfig, sizeText } from '../net/account';
import { signInButton } from '../ui/signIn';
import { aoWithoutCavity, type Viewer } from '../viewer/Viewer';
import type { StatusToast } from '../sculpt/ui/statusToast';
import type { Stage } from '../admin/projectEdit';
import type { FrameItem, FramesSource } from './frameStore';
import { framePath, MAX_FRAMES } from './frameStore';

/**
 * Save from Create (`/create/`): a project that is not on the site yet is
 * made on the library's routes and filled. This is what the Create page's
 * Save to My projects did, moved into the Present workspace unchanged in
 * what it sends and what it refuses.
 */

/** A member's frame cap (docs/accounts.md §4), when /api/config does not say. */
const FRAME_BYTES = 32 * 1024 * 1024;
/** The longest title the server keeps. */
const MAX_TITLE = 200;

const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A number /api/config gives, or the fallback when it gives none. */
const limit = (v: unknown, fallback: number): number => (typeof v === 'number' && v > 0 ? v : fallback);

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * The picture a save sends: the frame on screen when playback is paused
 * (so pausing on a frame chooses it), else the last - the finished piece -
 * at the camera as set. Taken by the viewer's captureThumbnail, the 4:5
 * portrait at 800 x 1000 every picture in the app is; playback is put back
 * as it was.
 */
export async function savePicture(p: Viewer): Promise<Blob> {
  const was = p.timeline.frameIndex();
  const playing = p.timeline.playing;
  if (playing) {
    p.pause();
    p.jumpTo(p.timeline.frameCount - 1);
  }
  for (let i = 0; i < 100 && p.isAwaitingFrame(); i++) await new Promise((r) => setTimeout(r, 30));
  await nextFrame();
  try {
    return await p.captureThumbnail();
  } finally {
    if (playing) {
      p.jumpTo(was);
      p.play();
    }
  }
}

export interface NewProject {
  title: string;
  mode: 'timelapse' | 'model';
  fps: number;
  stages: Stage[];
}

/**
 * Make the project and fill it: created on the library's routes (the
 * account's own, private, under the server's id; or the owner tools',
 * private, under an id made from the title), the frames uploaded four at
 * a time, then its data in one patch - the frame list, which publishes
 * them, the stages and the look - and its picture. A save that does not
 * finish takes the project back, as Capture's publish does, so nothing
 * half-made holds the quota. Answers where to go and what it is called.
 */
export async function saveNewProject(
  p: Viewer,
  items: readonly FrameItem[],
  source: FramesSource,
  v: NewProject,
  status: StatusToast,
): Promise<{ title: string; href: string }> {
  const client = await libraryProjects();
  const config = client.scope === 'me' ? await loadConfig() : null;
  const maxFrames = limit(config?.limits.framesPerProject, MAX_FRAMES);
  if (items.length > maxFrames) {
    throw new Error(`Too many frames (${items.length.toLocaleString('en-US')}): a project takes at most ${maxFrames.toLocaleString('en-US')}`);
  }
  if (client.scope === 'me') {
    const cap = limit(config?.limits.frameBytes, FRAME_BYTES);
    const big = items.findIndex((f) => f.bytes > cap);
    if (big >= 0) throw new Error(`Frame ${big + 1} is ${sizeText(items[big].bytes)}: a frame may be at most ${sizeText(cap)}`);
  }
  const title = v.title.trim().slice(0, MAX_TITLE) || 'Untitled';
  const mode = v.mode;
  const fps = Math.min(30, Math.max(1, Math.round(v.fps || 4)));
  const count = items.length;
  status.set('Creating project...');
  const made = await client.create(
    client.scope === 'me'
      ? { title, mode, fps }
      : { id: `${slug(title).slice(0, 50) || 'timelapse'}-${Math.random().toString(36).slice(2, 8)}`, title, mode, fps, visibility: 'private' },
  );
  const id = made.id;
  try {
    // Four in flight; the first refusal stops the rest before they start,
    // and the lanes settle before the project is taken back.
    let failure: unknown = null;
    let next = 0;
    let done = 0;
    const lane = async (): Promise<void> => {
      while (failure === null && next < count) {
        const i = next++;
        try {
          await client.uploadFrame(id, i, await source.getBytes(framePath(i)));
          done += 1;
          status.set(`Uploading frame ${done} of ${count}...`);
        } catch (err) {
          failure ??= err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, count) }, lane));
    if (failure !== null) throw failure;
    status.set('Finishing...');
    const look = p.getLook();
    await client.update(id, {
      title,
      mode,
      fps,
      frames: items.map((f, index) => ({ index, tris: f.tris })),
      stages: v.stages,
      lighting: look.lighting,
      material: look.material,
      environment: look.environment,
      ao: aoWithoutCavity(look),
      presentation: look.presentation,
      camera: look.camera,
      defaults: { material: look.materialMode },
    });
    await client.uploadThumb(id, await savePicture(p));
  } catch (err) {
    await client.remove(id).catch(() => undefined);
    throw err;
  }
  return { title, href: client.scope === 'me' ? '/?me' : '/admin/' };
}

/** How a save that did not happen ended, said as Sculpt's Save to library says it. */
export function notSavedNotice(status: StatusToast, err: unknown, place: string, again: () => void): void {
  const why = err instanceof Error ? err.message.replace(/\.$/, '') : String(err);
  switch (uploadFailure(err)) {
    case 'expired': {
      const retry = signInButton('', (ok) => (ok ? again() : undefined), 'Sign in again', err instanceof AuthExpiredError ? err.via : undefined);
      status.fail('Your sign-in has expired. Nothing was saved; the frames are still here.', retry);
      break;
    }
    case 'suspended':
      status.fail(`${why}. Nothing was saved.`);
      break;
    case 'full':
      // The server's numbers: "Your storage is full (248 of 250 MB)".
      status.fail(`${why}. Nothing was saved; make room in ${place}, then try again.`);
      break;
    case 'offline':
      status.fail('No connection. Nothing was saved; try again when you are online.');
      break;
    default:
      status.fail(`Not saved to ${place}: ${why}.`);
  }
}
