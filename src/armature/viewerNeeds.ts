import type { GroundMode, Viewer } from '../viewer/Viewer';

/**
 * What Armature needs from the viewer, on top of Sculpt's working view, in
 * one place.
 *
 * Armature is a workspace of the Sculpt page and shows the view Sculpt
 * shows: its light, its shading, the cavity pass and no ambient occlusion
 * of its own, flat clay, the one look of the scene. So changing tab changes
 * nothing but the tools. Three things are asked of the viewer besides:
 *
 *   lockFloor          the ground fixed where the mannequin stands (0 at its
 *                      soles), as it is in a scene on real units. Sculpt's
 *                      own is the scene's (fixed at 0 on real units, following
 *                      the subject in one from before them) and goes back.
 *   ground             the floor shown. Sculpt starts with no stage under the
 *                      work; the mannequin stands on one. What a person
 *                      sets with G in Armature is kept for the next visit.
 *   interactionProbe   a pose drag (a handle, a gizmo) is a move for the
 *                      frame meter and the fast frames, as a stroke is in
 *                      Sculpt.
 *
 * What Sculpt sets and Armature used to set again is not here any more: the
 * tap-to-focus off, the fast frames on, the anti-aliasing, the key-only
 * shadows, the fill's and rim's Casts shadow, the ambient occlusion, the
 * hiding of the boot cube (Sculpt owns the subject), the page chrome's
 * hook (the shell's) and the Floor offset (the look's, one for the scene).
 * The shadows' bound is Sculpt's, which takes the mannequin in while it is
 * drawn (ArmatureSlot.shadowBox).
 *
 * Two kinds of entry:
 *   fixed   Armature always wants one value (`want`, read fresh on every
 *           apply).
 *   held    the value belongs to what Armature is doing: `undo` keeps what
 *           the viewer had and `apply` writes it back. `start` is the value
 *           the workspace starts from, written by the first `apply` only.
 *
 * `apply` puts the list to work (entering Armature) and `undo` puts every
 * entry back to what the viewer had when Armature last took it over
 * (leaving it).
 */

export interface ViewerNeedsHooks {
  /** The interaction probe's answer: 'move' while a handle or a gizmo is being dragged, else null. */
  interaction: () => 'move' | null;
}

export interface ViewerNeeds {
  /** The ids of the entries, in the order they are applied (undone in the reverse). */
  readonly ids: readonly string[];
  apply(): void;
  undo(): void;
  isApplied(): boolean;
}

interface Need<T = unknown> {
  id: string;
  read(): T;
  write(value: T): void;
  want?: () => T;
  start?: () => T;
}

export function viewerNeeds(viewer: Viewer, hooks: ViewerNeedsHooks): ViewerNeeds {
  const needs: Need[] = [
    // The ground fixed where the mannequin stands (the mode holds it per figure, holdFloor).
    { id: 'lockFloor', read: () => viewer.lockedFloor(), write: (v) => viewer.lockFloor(v as number | null), start: () => 0 },
    // The floor shown: Sculpt works with no stage under the model, the mannequin stands on one.
    { id: 'ground', read: () => viewer.getGround(), write: (v) => viewer.setGround(v as GroundMode), start: () => 'floor' },
    // The frame meter and the fast frames: a pose drag is a move, as a stroke is in Sculpt.
    {
      id: 'interactionProbe',
      read: () => viewer.interactionProbe,
      write: (v) => (viewer.interactionProbe = v as Viewer['interactionProbe']),
      want: () => () => hooks.interaction(),
    },
  ];

  const ids = needs.map((n) => n.id);
  /** What the viewer had when the list was last applied. */
  const found = new Map<string, unknown>();
  /** What the held entries had when the list was last undone. */
  const held = new Map<string, unknown>();
  let applied = false;
  let first = true;

  const apply = (): void => {
    if (applied) return;
    for (const n of needs) found.set(n.id, n.read());
    for (const n of needs) {
      if (n.want) n.write(n.want());
      else if (first) {
        if (n.start) n.write(n.start());
      } else if (held.has(n.id)) n.write(held.get(n.id));
    }
    applied = true;
    first = false;
  };

  const undo = (): void => {
    if (!applied) return;
    // What Armature holds is read before anything is put back: entries lean on each other (the key-only
    // rule decides what the fill's and rim's boxes read).
    for (const n of needs) if (!n.want) held.set(n.id, n.read());
    for (const n of [...needs].reverse()) n.write(found.get(n.id));
    applied = false;
  };

  return { ids, apply, undo, isApplied: () => applied };
}
