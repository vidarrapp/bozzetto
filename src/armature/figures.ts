/**
 * The mannequins: Blender Studio's "primitive" figures from the Human Base
 * Meshes bundle (CC0), rigged onto the app's own bones by
 * tools/build-mannequins.py and shipped as skinned .glb files under
 * public/assets/armature. The app reads one exactly as it reads a rigged
 * model you load yourself (glbRig.ts), so a mannequin is a preset in the
 * Figure list and nothing more: no bytes in the autosave, no special case
 * in the file format. A megabyte each, fetched when picked and precached
 * by the service worker with the app, so all four are there offline.
 */
import type { RigDefinition, Vec3 } from './rig';

export interface FigureInfo {
  id: string;
  label: string;
  sex: 'male' | 'female';
  style: 'realistic' | 'stylized';
  /**
   * How far the neck's joint is raised from where the file puts it, in
   * metres (tuneRig). The build places it a fixed share of the way up the
   * neck lump (tools/build-mannequins.py, NECK_JOINT_AT); a rebuild that
   * moves it should take this back out.
   */
  neckRaise?: number;
}

export const FIGURES: FigureInfo[] = [
  // The realistic male's neck turned about a point half a centimetre under
  // where the back of its neck leaves the chest (1.422 m against 1.427),
  // inside the chest, so a head turn swung from too low (owner report).
  // The other three turn 0.7 to 1.4 cm above that line; raised 1.5 cm,
  // this one turns 1 cm above it, as they do on average.
  { id: 'mannequin-male-realistic', label: 'Male mannequin, realistic', sex: 'male', style: 'realistic', neckRaise: 0.015 },
  { id: 'mannequin-female-realistic', label: 'Female mannequin, realistic', sex: 'female', style: 'realistic' },
  { id: 'mannequin-male-stylized', label: 'Male mannequin, stylized', sex: 'male', style: 'stylized' },
  { id: 'mannequin-female-stylized', label: 'Female mannequin, stylized', sex: 'female', style: 'stylized' },
];

export function figureById(id: string): FigureInfo | undefined {
  return FIGURES.find((f) => f.id === id);
}

/**
 * A mannequin's rig, as read from its file, with this list's corrections:
 * the neck's joint raised (neckRaise), up the neck's own line. Only the
 * joint moves - the neck's direction, the chest's frame, the head's joint
 * and the geometry stay as the file has them, so a saved pose, which is
 * joint turns, opens as it was.
 */
export function tuneRig(rig: RigDefinition, info: FigureInfo): RigDefinition {
  const neck = rig.bones.find((b) => b.name === 'neck');
  const rise = neck ? neck.tail[1] - neck.head[1] : 0;
  if (neck && info.neckRaise && rise > info.neckRaise) {
    // Up the neck's own line, so the bone keeps its direction and with it
    // the frame a saved neck turn is measured in.
    const k = info.neckRaise / rise;
    neck.head = neck.head.map((v, i) => v + (neck.tail[i] - v) * k) as Vec3;
  }
  return rig;
}

export function figureUrl(id: string): string {
  return `/assets/armature/${id}.glb`;
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
