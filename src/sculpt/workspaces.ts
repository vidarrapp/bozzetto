import type { Viewer } from '../viewer/Viewer';
import type { SculptSession } from './bridge/SculptSession';
import type { InputShell } from './bridge/InputShell';
import type { TransformGizmo } from './bridge/transform';
import type { ScenePanel } from './ui/ScenePanel';
import type { ModelPanel } from './ui/ModelPanel';
import type { LayersPanel } from './ui/LayersPanel';
import type { SculptPanel } from './ui/SculptPanel';
import type { FileMenu } from './ui/FileMenu';
import type { PresentMode } from './ui/Present';
import type { PublishWindow } from './ui/PublishWindow';
import type { MenuItem } from './ui/TopMenu';
import { editMenuItems } from './ui/menuShape';
import { keyFor, viewMenuItems } from './ui/viewMenu';
import { makeSculptDetails } from './ui/DetailsOverlay';
import type { Readout } from './ui/TitleStrip';
import { CONTROLS_REFRESH_EVENT } from '../ui/Panel';
import { pasteFromClipboard } from '../reference/intake';
import type { Studio, Workspace, WorkspaceId } from '../studio/Studio';
import type { ArmatureSlot } from '../armature/workspace';

/**
 * Sculpt, Paint and Present as the three workspaces the Sculpt page hands
 * its shell (studio/Studio.ts), and the facade of the fourth, Armature, which
 * loads its code when it is first entered. They share one controller, as they always
 * have (the closures of mountSculptMode: one input shell, one session, one
 * set of panels): what a person sees is the same page, and what the shell
 * now does is the switching, the menus, the path, the panels each remembers
 * and the details, by asking the one in front.
 *
 * The controller does the work of going to Paint (it saves what Sculpt had
 * up, so the way back is the same) and of putting Present away; a
 * workspace's `enter` asks for the work its own way in needs, and its
 * `leave` for what only its own way out needs (Present's ending).
 */

/** What the three workspaces need of the page: the pieces they ask, and the things only the controller can do. */
export interface SculptPage {
  studio: Studio;
  viewer: Viewer;
  session: SculptSession;
  input: InputShell;
  gizmo: TransformGizmo;
  present: PresentMode;
  scenePanel: ScenePanel;
  modelPanel: ModelPanel;
  layersPanel: LayersPanel;
  sculptPanel: SculptPanel;
  fileMenu: FileMenu;
  publishWindow: PublishWindow;
  /** The readout's pieces: the scene's name, whether it has edits, where it is kept, and Present's image size and lens. */
  readout: {
    projectName(): string | null | undefined;
    hasWork(): boolean;
    state(): string | null;
    frame(): { w: number; h: number } | null;
    lens(): number | null;
  };
  /** Whether Paint is on, for the details' wording. */
  isPaint(): boolean;
  frameModel(): void;
  frameAll(): void;
  setGroupColors(on: boolean): void;
  /** The controller's way into and out of Paint, and Present's way out (to the workspace named). */
  enterPaint(): void;
  leavePaint(): void;
  leavePresent(to: 'sculpt' | 'paint'): void;
  /** Armature, the path's first step: loaded on first use, hosted like the others (armature/workspace.ts). */
  armature: ArmatureSlot;
  /** The autosave, the picture and the look, written. False: not stored. */
  flush(): Promise<boolean>;
  /** Hide the interface (View). */
  hideInterface(): void;
}

/** The workspaces, to register with the shell: Sculpt, Paint and Present, and Armature's facade. */
export function sculptWorkspaces(p: SculptPage): Workspace[] {
  const { session, viewer, input, scenePanel } = p;
  const lighting = viewer.lighting;
  const readSculptDetails = makeSculptDetails(session, () => p.isPaint());

  /** The Edit menu is the same in the three workspaces: undo and redo, the objects' commands, Paste picture, Preferences. */
  const editItems = (): MenuItem[] => {
    // What used to be the Scene panel's buttons (owner call: only Create
    // stays there), each on the whole selection as before.
    const acts = (): boolean => scenePanel.hasTargets();
    return editMenuItems({
      mode: 'sculpt',
      history: [
        { label: 'Undo', key: keyFor('edit.undo'), action: () => session.undo() },
        { label: 'Redo', key: keyFor('edit.redo'), action: () => session.redo() },
      ],
      own: [
        { label: 'Duplicate', enabled: acts, action: () => scenePanel.duplicateSelected() },
        { label: 'Delete', key: keyFor('scene.delete'), enabled: acts, action: () => scenePanel.deleteSelected() },
        {
          label: 'Merge',
          key: keyFor('scene.merge'),
          enabled: () => scenePanel.canMerge(),
          action: () => scenePanel.mergeSelected(),
        },
        // Mirror: a copy across a world axis; the hotkey takes the brush's
        // symmetry axis.
        {
          label: 'Mirror',
          key: keyFor('scene.mirror'),
          enabled: acts,
          choices: () =>
            (['x', 'y', 'z'] as const).map((axis) => ({
              label: axis.toUpperCase(),
              title: `Mirror the selected objects across ${axis.toUpperCase()}`,
              action: () => scenePanel.mirrorActive(axis),
            })),
        },
        // Radial copies: a ring around the brush's symmetry axis, which the
        // Tool panel can change between opens.
        {
          label: () => `Radial copies around ${session.getSymmetryAxis().toUpperCase()}`,
          enabled: acts,
          choices: () =>
            [3, 4, 5, 6, 8, 12].map((count) => ({
              label: `×${count}`,
              title: `${count} copies around ${session.getSymmetryAxis().toUpperCase()}`,
              action: () => scenePanel.radialActive(count),
            })),
        },
        { separator: true },
        // Poly groups into objects (owner call, 2026-11-01), on the active
        // object; greyed out where there is nothing to split.
        {
          label: 'Split groups into objects',
          enabled: () => session.splittableGroups() >= 2,
          action: () => scenePanel.splitActive('groups'),
        },
        {
          label: 'Split hidden into object',
          enabled: () => {
            const s = session.hiddenSplit();
            return s.hidden > 0 && s.shown > 0;
          },
          action: () => scenePanel.splitActive('hidden'),
        },
        {
          label: 'Delete hidden',
          enabled: () => {
            const s = session.hiddenSplit();
            return s.hidden > 0 && s.shown > 0;
          },
          action: () => scenePanel.splitActive('delete-hidden'),
        },
        { separator: true },
        { label: 'Paste picture', hint: "Adds the clipboard's picture to the Reference panel", action: () => void pasteFromClipboard(p.studio.reference.board) },
      ],
    });
  };

  /** The panels the View menu lists: the workspace's own (Present has Lighting, Camera and Render). */
  const panelsOf = (id: 'sculpt' | 'paint' | 'present'): Array<[string, string]> =>
    id === 'present'
      ? [
          ['lighting', 'Lighting'],
          ['camera', 'Camera'],
          ['render', 'Render'],
          ['material', 'Material'],
          ['output', 'Output'],
        ]
      : id === 'paint'
        ? [
            ['scene', 'Scene'],
            ['layers', 'Layers'],
            ['sculpt', 'Tool'],
            ['material', 'Material'],
            ['reference', 'Reference'],
          ]
        : [
            ['scene', 'Scene'],
            ['model', 'Model'],
            ['layers', 'Layers'],
            ['sculpt', 'Tool'],
            ['material', 'Material'],
            ['reference', 'Reference'],
          ];

  /** View: framing, the viewport's switches, the panels, Hide interface and the workspaces: each the command its hotkey runs. */
  const viewItems = (id: 'sculpt' | 'paint' | 'present'): MenuItem[] => {
    const { board, view } = p.studio.reference;
    return viewMenuItems({
      frameSelected: p.frameModel,
      frameAll: p.frameAll,
      wireframe: {
        get: () => viewer.isWireframe(),
        toggle: () => {
          viewer.toggleWireframe();
          window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
        },
      },
      shadows: {
        get: () => lighting.getShadowsMaster(),
        toggle: () => {
          lighting.setShadowsMaster(!lighting.getShadowsMaster());
          window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
        },
      },
      groupColors: { get: () => session.groups.isShowing(), toggle: () => p.setGroupColors(!session.groups.isShowing()) },
      referenceShow: { get: () => view.isShown(), toggle: () => view.setShown(!view.isShown()) },
      referenceArrange: { get: () => board.isArranging(), toggle: () => board.setArranging(!board.isArranging()), key: true },
      toolKeys: true,
      details: true,
      panels: panelsOf(id),
      moveLight: { get: () => input.isLightArmed(), toggle: () => input.armLight(!input.isLightArmed()) },
      hideInterface: p.hideInterface,
      workspace: () => p.studio.way(),
      workspaceKeys: true,
    });
  };

  const panels = {
    left: [p.scenePanel, p.modelPanel, p.layersPanel],
    right: [p.sculptPanel],
  };
  const history = {
    undo: () => session.undo(),
    redo: () => session.redo(),
    canUndo: () => session.canUndo(),
    canRedo: () => session.canRedo(),
  };
  const readout = (): Readout => {
    const name = p.readout.projectName() ?? null;
    return {
      name,
      edited: !!name && p.readout.hasWork(),
      state: name ? p.readout.state() : null,
      // In Present the readout is the project, the image Save image writes and the lens.
      frame: p.readout.frame(),
      lens: p.readout.lens(),
    };
  };

  const of = (id: 'sculpt' | 'paint' | 'present', keyMode: Workspace['keyMode'], own: Pick<Workspace, 'enter' | 'leave' | 'details'>): Workspace => ({
    id,
    keyMode,
    menus: () => ({ file: p.fileMenu.items(), edit: editItems(), view: viewItems(id) }),
    // The shell hosts all four steps: each is a `go`.
    path: () => ({}),
    panels,
    readout,
    history,
    // Nothing is left half done: refused mid-stroke and mid-drag.
    mayLeave: () => !input.isStroking() && !p.gizmo.isDragging(),
    beforeLeavingPage: p.flush,
    shown: () => p.publishWindow.setInPresent(id === 'present'),
    tick: () => p.modelPanel.refreshHeading(),
    ...own,
  });

  // Sculpt, Paint and Present are one controller's states: a way into Sculpt or Paint does the
  // work of its own state (Paint saves what Sculpt had up, Sculpt puts Paint away; each stays
  // under Present, which comes back to it), and the way out of Present is Present's own (its
  // turntable stopped, a clip being saved cancelled), landing on the workspace asked for with
  // that one's panels.
  const leavePresentTo = (to: WorkspaceId): void => {
    // Armature is entered from Sculpt's own state (it leaves Paint first, as a way through Sculpt would).
    if (to === 'sculpt' || to === 'paint') p.leavePresent(to);
    else if (to === 'armature') p.leavePresent('sculpt');
  };
  return [
    p.armature.workspace,
    of('sculpt', 'sculpt', {
      enter: () => p.leavePaint(),
      leave: () => undefined,
      details: () => readSculptDetails(),
    }),
    of('paint', 'paint', {
      enter: () => p.enterPaint(),
      leave: () => undefined,
      details: () => readSculptDetails(),
    }),
    of('present', 'sculpt', {
      enter: () => void p.present.enter(),
      leave: leavePresentTo,
      // The view is the presentation: its numbers are not written.
      details: () => null,
    }),
  ];
}
