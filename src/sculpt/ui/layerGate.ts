import { askWindow } from '../../ui/askWindow';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Operations that rebuild or renumber an object's vertices (remesh, merge,
 * split, dynamic topology) cannot keep its layers, which are displacements
 * of vertices. Before one of them runs on an object that has layers, the
 * person is asked; yes flattens the layers (part of the surface, one undo
 * step joined to the operation's own), no leaves everything as it was.
 *
 * `go` runs at once when no object has layers, so an operation stays as
 * synchronous as it was for the ones that do not.
 */
export function withLayersFlattened(
  session: SculptSession,
  meshes: SculptMesh[],
  /** What is about to happen, as the button says it after "Flatten and": "remesh", "merge". */
  verb: string,
  go: () => void,
): void {
  if (!session.layers.withLayers(meshes).length) {
    go();
    return;
  }
  void askFlatten(session, meshes, verb).then((ok) => {
    if (ok) go();
  });
}

/** The question itself, for an operation that is already async: true to go on. */
export async function askFlatten(session: SculptSession, meshes: SculptMesh[], verb: string): Promise<boolean> {
  const have = session.layers.withLayers(meshes);
  if (!have.length) return true;
  const names = have.map((m) => `"${session.getMeshName(m)}"`);
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');
  return askWindow({
    title: `Flatten the layers of ${list}?`,
    text: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} rebuilds the surface, so its layers become part of it, and their masks go. Undo brings them back.`,
    yes: `Flatten and ${verb}`,
  });
}
