import type { Viewer } from '../viewer/Viewer';
import type { Visibility } from './api';

/**
 * What the two owner pages that edit a published frame project share: the
 * editor (/admin/?p=) and Present (/?tl=&present=1). The shapes they read
 * from /admin/api/projects/:id, how a stage list is tidied before it is
 * sent, and the look as the project's blocks. One place, so the two cannot
 * drift apart in what they write.
 */

export interface Stage {
  name: string;
  frame: number;
  desc: string;
}

/** The manifest-shaped fields the owner pages read from /admin/api/projects/:id. */
export interface EditorProject {
  id: string;
  title: string;
  mode: string;
  visibility?: Visibility;
  config: { fps: number; frameCount: number };
  frames: { index: number; tris: number; sd?: string | null }[];
  stages: Stage[];
}

/**
 * The owner's manifest URL. Frame paths in it are root-absolute (/media
 * or, for a project the gallery does not list, /admin/api/media), or full
 * addresses on the server's files host, so this is only what the paths
 * resolve against - but it has to be the route the manifest came from.
 */
export const manifestUrl = (id: string): string =>
  new URL(`/admin/api/projects/${encodeURIComponent(id)}`, location.href).href;

/**
 * The look as a project's blocks, as Save look writes them. One gatherer
 * for the whole look (Viewer.getLook), shared with sculpt mode's session
 * save, so the two cannot drift apart; the stage carries the played scale
 * where Set scale gave the project one.
 */
export function lookPatch(p: Viewer): Record<string, unknown> {
  const look = p.getLook();
  return {
    // The scale those numbers are on: a project stored in metres played
    // here in centimetres (types/manifest.ts onCentimetres), so a save
    // marks it 'cm' with them. One without units stays without.
    ...(p.manifest.units ? { units: p.manifest.units } : {}),
    lighting: look.lighting,
    material: look.material,
    environment: look.environment,
    ao: look.ao,
    presentation: look.presentation,
    camera: look.camera,
    defaults: { material: look.materialMode },
  };
}

/** A stage list as it is saved: names trimmed, unnamed ones dropped, in frame order. */
export function normalizeStages(list: readonly Stage[]): Stage[] {
  return list
    .map((s) => ({ name: s.name.trim(), frame: Math.max(0, Math.round(Number(s.frame) || 0)), desc: s.desc.trim() }))
    .filter((s) => s.name)
    .sort((a, b) => a.frame - b.frame);
}

/** Whether two stage lists say the same thing. */
export function sameStages(a: readonly Stage[], b: readonly Stage[]): boolean {
  return JSON.stringify(normalizeStages(a)) === JSON.stringify(normalizeStages(b));
}

/** The index in a frame-ordered list of the stage in force at `frame`, or -1 before the first. */
export function stageIndexAt(stages: readonly Stage[], frame: number): number {
  let at = -1;
  stages.forEach((s, i) => {
    if (s.frame <= frame) at = i;
  });
  return at;
}
