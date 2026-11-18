import type { Box3 } from 'three';
import type { Viewer } from '../viewer/Viewer';
import { pageChrome } from '../ui/ChromeToggle';
import { settings } from '../ui/settings';

/**
 * What Armature needs from the viewer, in one place.
 *
 * Armature does not own the viewer: it borrows it. Each thing it sets on
 * the viewer is one entry of the list below, with how to read it, how to
 * write it and what Armature wants it to be. `apply` puts the list to work
 * (the first time with the values Armature starts from, later with the
 * values it held when it was undone) and `undo` puts every entry back to
 * what the viewer had when Armature last took it over. Mount and resume
 * call `apply`; suspend and dispose call `undo`. A workspace that shares
 * the viewer with Armature reads and changes what Armature asks of it here
 * and nowhere else.
 *
 * Two kinds of entry:
 *   fixed   Armature always wants one value (`want`, read fresh on every
 *           apply): the tap-to-focus off, the fast frames on, and so on.
 *   held    the value belongs to what Armature is doing (the floor under
 *           this figure, the box the stage is fitted to, a light's Casts
 *           shadow box a person ticked): `undo` keeps what the viewer had
 *           and `apply` writes it back. `start` is the value the mode starts
 *           from, written by the first `apply` only.
 *
 * Not in the list, on purpose: the look (background, lights' colours, tone
 * and the rest), which is the armature's content and rides in its file, and
 * the figure itself, which the mode adopts and removes.
 */

export interface ViewerNeedsHooks {
  /** The interaction probe's answer: 'move' while a handle or a gizmo is being dragged, else null. */
  interaction: () => 'move' | null;
  /** The page chrome flipped (the interface hidden or shown). */
  chromeChanged: (hidden: boolean) => void;
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

/** The two fields of the viewer that have no accessor: the primary subject's visibility and the box the stage is fitted to. */
interface ViewerInternals {
  display: { visible: boolean };
  subjectBox: Box3;
}

export function viewerNeeds(viewer: Viewer, hooks: ViewerNeedsHooks): ViewerNeeds {
  const lighting = viewer.lighting;
  const inside = viewer as unknown as ViewerInternals;
  const casts = (id: 'fill' | 'rim'): boolean => lighting.state().find((l) => l.id === id)?.castShadow ?? true;
  const chrome = pageChrome();

  const needs: Need[] = [
    // The Floor offset is the look's; it goes back with the floor it belongs to.
    { id: 'floorOffset', read: () => viewer.getFloorOffset(), write: (v) => viewer.setFloorOffset(v as number) },
    // The ground fixed where the figure stands (the mode holds it per figure, holdFloor).
    { id: 'lockFloor', read: () => viewer.lockedFloor(), write: (v) => viewer.lockFloor(v as number | null), start: () => 0 },
    // Only the key light casts by default (owner call); the fill's and the rim's boxes may be ticked on.
    { id: 'fillCasts', read: () => casts('fill'), write: (v) => lighting.setShadow('fill', v as boolean), start: () => false },
    { id: 'rimCasts', read: () => casts('rim'), write: (v) => lighting.setShadow('rim', v as boolean), start: () => false },
    { id: 'keyOnlyShadows', read: () => lighting.keyOnlyShadows, write: (v) => (lighting.keyOnlyShadows = v as boolean), want: () => true },
    // A tap on the figure selects a part, it does not move the camera to it.
    { id: 'tapToFocus', read: () => viewer.tapToFocus, write: (v) => (viewer.tapToFocus = v as boolean), want: () => false },
    // The boot placeholder cube is sent away: the figure is the subject.
    {
      id: 'sculptVisible',
      read: () => inside.display.visible,
      write: (v) => viewer.setSculptVisible(v as boolean),
      want: () => false,
    },
    // Anti-aliasing as Preferences says, as in Sculpt (the viewer's own is 4x MSAA).
    { id: 'antialias', read: () => viewer.getAntialias(), write: (v) => viewer.setAntialias(v as ReturnType<Viewer['getAntialias']>), want: () => settings.get('antialias') },
    // Fast frames while a pose drag moves the figure (Viewer.updateFrameMode).
    { id: 'fastFrames', read: () => viewer.fastFrames, write: (v) => (viewer.fastFrames = v as boolean), want: () => true },
    {
      id: 'interactionProbe',
      read: () => viewer.interactionProbe,
      write: (v) => (viewer.interactionProbe = v as Viewer['interactionProbe']),
      want: () => () => hooks.interaction(),
    },
    {
      id: 'chromeOnChange',
      read: () => chrome.onChange,
      write: (v) => (chrome.onChange = v as typeof chrome.onChange),
      want: () => (hidden: boolean) => hooks.chromeChanged(hidden),
    },
    // The stage (ground, shadow, lights, AO) fitted to the figure's box; the mode fits it itself (frame()).
    {
      id: 'subjectFit',
      read: () => inside.subjectBox.clone(),
      // Without the camera: the view is the person's, and stays where it is.
      write: (v) => viewer.fitSubject(v as Box3, false),
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
      // The subject fit has no value to start from: the mode fits the stage itself the first time (frame()).
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
