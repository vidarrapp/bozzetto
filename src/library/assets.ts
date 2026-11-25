import { PRESETS } from '../viewer/Lighting';

/**
 * The lists the Asset library's tabs and the panels' own pickers are both built from, and nothing
 * else: the matcaps (the Material panel's picker and the Materials tab), the light rigs (the
 * Lighting tab's Rig select and the Lighting tab of the library) and the environments (the HDRI
 * select and the HDRIs tab). The models (Create choices and the Models tab) are in modelAssets.ts,
 * which needs the base-mesh data. An entry has an id, a label, a picture where it has one, and
 * what using it does is the one place that applies it (the viewer's own setters).
 */
export interface Asset {
  id: string;
  label: string;
  /** A small picture of it, fetched lazily by whoever shows it. */
  thumb?: string;
}

// --- matcaps -------------------------------------------------------------------------------------

export interface MatcapAsset extends Asset {
  /** The matcap's own picture, the file the view is lit by. */
  url: string;
  thumb: string;
}

/** The project's matcaps (the VR pack, owner-supplied): single-sphere PNGs, each with a 64px thumbnail. */
export const MATCAP_ASSETS: readonly MatcapAsset[] = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  const id = `vr${n}`;
  return { id, label: `VR${n}`, url: `/assets/matcaps/${id}.png`, thumb: `/assets/matcaps/thumbs/${id}.png` };
});

/** A matcap's small picture. */
export function matcapThumbUrl(id: string): string {
  return `/assets/matcaps/thumbs/${id}.png`;
}

// --- light rigs ----------------------------------------------------------------------------------

export interface RigAsset extends Asset {
  thumb: string;
}

/** A built-in rig's picture (tools/render-library-thumbs.mjs makes them): a grey ball under the rig. */
export function rigThumbUrl(id: string): string {
  return `/assets/rigs/${id}.png`;
}

/** The built-in rigs, in the Lighting tab's Rig select's order. */
export function rigAssets(): RigAsset[] {
  return PRESETS.map((p) => ({ id: p.id, label: p.label, thumb: rigThumbUrl(p.id) }));
}

// --- environments --------------------------------------------------------------------------------

/** One file of an environment: a resolution of it. Only the first is listed today; a larger library on a server adds more. */
export interface EnvironmentFile {
  /** What the file is called to the person ('1k'), for a later choice of resolution. */
  res: string;
  url: string;
}

export interface EnvironmentAsset extends Asset {
  thumb: string;
  /** The files of the environment, the one used now first. */
  files: readonly EnvironmentFile[];
}

/** An environment's picture (tools/render-library-thumbs.mjs makes them): a chrome ball lit by it. */
export function environmentThumbUrl(id: string): string {
  return `/assets/env/thumbs/${id}.png`;
}

const env = (id: string, label: string, file: string): EnvironmentAsset => ({
  id,
  label,
  thumb: environmentThumbUrl(id),
  files: [{ res: '1k', url: `/assets/env/${file}` }],
});

/** Available HDRIs (public/assets/env). The file is fetched only when one is used. */
export const ENVIRONMENT_ASSETS: readonly EnvironmentAsset[] = [
  env('studio-neutral', 'Neutral studio', 'studio-neutral.hdr'),
  env('studio-photo', 'Photo studio', 'studio-photo.hdr'),
  env('overcast', 'Soft overcast', 'overcast.hdr'),
  env('interior-warm', 'Warm interior', 'interior-warm.hdr'),
  env('garage', 'Garage', 'garage.hdr'),
  env('plaza', 'Outdoor plaza', 'plaza.hdr'),
];
