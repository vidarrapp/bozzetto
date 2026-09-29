import { MODEL_REVISION } from '../viewer/assetVersion';

/**
 * The mannequins: Blender Studio's "primitive" figures from the Human Base
 * Meshes bundle (CC0), rigged onto the app's own bones by
 * tools/build-mannequins.py and shipped as skinned .glb files under
 * public/assets/armature. The app reads one exactly as it reads a rigged
 * model you load yourself (glbRig.ts), so a mannequin is a preset in the
 * Figure list and nothing more: no bytes in the autosave, no special case
 * in the file format. Fetched on first use, a megabyte each, and kept by
 * the service worker.
 */
export interface FigureInfo {
  id: string;
  label: string;
  sex: 'male' | 'female';
  style: 'realistic' | 'stylized';
}

export const FIGURES: FigureInfo[] = [
  { id: 'mannequin-male-realistic', label: 'Male mannequin, realistic', sex: 'male', style: 'realistic' },
  { id: 'mannequin-female-realistic', label: 'Female mannequin, realistic', sex: 'female', style: 'realistic' },
  { id: 'mannequin-male-stylized', label: 'Male mannequin, stylized', sex: 'male', style: 'stylized' },
  { id: 'mannequin-female-stylized', label: 'Female mannequin, stylized', sex: 'female', style: 'stylized' },
];

export function figureById(id: string): FigureInfo | undefined {
  return FIGURES.find((f) => f.id === id);
}

export function figureUrl(id: string): string {
  return `/assets/armature/${id}.glb?r=${MODEL_REVISION}`;
}

const inflight = new Map<string, Promise<ArrayBuffer>>();

/**
 * The file's bytes, fetched once per session. A failed fetch is forgotten
 * so the next pick tries again - offline with nothing cached is the usual
 * cause, and the network may be back by then.
 */
export function fetchFigure(id: string): Promise<ArrayBuffer> {
  const held = inflight.get(id);
  if (held) return held;
  const p = (async () => {
    const res = await fetch(figureUrl(id));
    if (!res.ok) throw new Error(`Figure "${id}" failed to load (${res.status})`);
    return res.arrayBuffer();
  })();
  inflight.set(id, p);
  p.catch(() => inflight.delete(id));
  return p;
}
