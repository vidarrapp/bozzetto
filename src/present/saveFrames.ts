import { api } from '../admin/api';
import { runPool } from '../admin/convert';
import type { FrameItem, FramesSource } from './frameStore';
import { entriesFromProject } from './frameStore';

/**
 * Writing a changed sequence to a project on the site (the Frames tab's
 * part of the page's one Save). The site keeps frame N as the file at
 * place N, and frames are only added at the end or cleared, so a change is
 * a matter of which places need a new file: a frame that stays where it
 * was needs none, one that is new is uploaded to its place, four at a
 * time; the frame list in the same patch as the rest of the save is what
 * publishes them and drops the places past the end.
 */

/** Whether the frame at place `i` is already the file the site has there. */
export const inPlace = (f: FrameItem, i: number): boolean => f.glb === null && f.url !== null && f.index === i;

/** Whether the list differs from the sequence the site has (`was`: the keys in its order). */
export function sequenceChanged(items: readonly FrameItem[], was: readonly number[]): boolean {
  return items.length !== was.length || items.some((f, i) => f.key !== was[i] || f.glb !== null);
}

/**
 * Upload what the sequence needs. Returns the places written, in order
 * (those the patch's frame list then names). A refusal throws with the
 * frame list not yet changed.
 */
export async function uploadSequence(
  id: string,
  items: readonly FrameItem[],
  source: FramesSource,
  progress: (done: number, total: number) => void,
): Promise<number> {
  const places = items.map((f, i) => i).filter((i) => !inPlace(items[i], i));
  let done = 0;
  progress(0, places.length);
  await runPool(
    places.map((i) => async () => {
      await api.uploadFrame(id, i, await source.bytesOf(items[i]));
      progress(++done, places.length);
    }),
    4,
  );
  return places.length;
}

/**
 * The list after a save: every frame is on the site now, at its place, under the
 * address the owner's manifest gives it (a new version), and no longer held in memory.
 * Keys stay, so the rows do not change under the hand.
 */
export async function reseat(id: string, items: FrameItem[]): Promise<FrameItem[]> {
  const fresh = (await api.get(id)) as { frames?: Array<{ index: number; tris: number; sd?: string | null }> };
  const now = entriesFromProject(fresh.frames ?? []);
  return items.map((f, i) => ({
    ...f,
    glb: null,
    bytes: 0,
    url: now[i]?.url ?? null,
    index: now[i]?.index ?? i,
  }));
}
