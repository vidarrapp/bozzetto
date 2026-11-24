import { Box3, Group, Mesh, Plane, Quaternion, Raycaster, Sphere, Vector2, Vector3, Object3D } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, normalLocal, positionLocal } from 'three/tsl';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer } from '../viewer/Viewer';
import { KEY_DRAG_DEG_PER_PX } from '../viewer/Lighting';
import { keymap } from '../ui/keymap';
import { isShowKey } from '../ui/ChromeToggle';
import { pasteFromClipboard } from '../reference/intake';
import type { DetailLine, Workspace } from '../studio/Studio';
import type { ArmatureHost } from './host';
import { Hidden, watchAdditions } from '../studio/hidden';
import { eventTime, isTextEntryTarget, LONG_PRESS_MS } from '../ui/dom';
import { mayStore, onDeviceChoice } from '../ui/deviceStorage';
import { downloadBlob } from '../ui/download';
import { keyFor, viewMenuItems } from '../sculpt/ui/viewMenu';
import { editMenuItems, fileMenuItems } from '../sculpt/ui/menuShape';
import type { MenuItem } from '../sculpt/ui/TopMenu';
import { recentMenuItem } from '../sculpt/ui/recentMenu';
import { recordRecent } from '../ui/recent';
import '../sculpt/ui/shell.css';
import { formatLength } from '../viewer/units';
import { Armature, buildArmature, importArmature, SCENE_SCALE, type ArmatureState } from './Armature';
import { ARROW_TIP, HandleKit, RING_RADIUS, type HandleShape, type HandleState, type HandleView } from './handleViews';
import { onCentimetres } from './units';
import { UNITS } from '../viewer/units';
import { fetchFigure, figureById, tuneRig } from './figures';
import { rigFromGLTF } from './glbRig';
import { getGLTFLoader } from '../loaders/gltf';
import { ArmaturePanel, prettyName } from './ArmaturePanel';
import { CONTROLS_REFRESH_EVENT } from '../ui/Panel';
import { statusToast } from '../sculpt/ui/statusToast';
import { armatureStamp, packArmature, unpackArmature } from './file';
import { loadArmature, saveArmature, type ArmatureFile } from './persist';
import { AuthExpiredError, checkSignIn, failureText, roleOf, type Role } from '../admin/api';
import { suspensionText } from '../net/account';
import { signInAgain, signInButton } from '../ui/signIn';
import { sceneStateWord } from '../ui/sceneState';
import { defaultSceneName, newSceneName } from '../sculpt/bridge/SceneLibrary';
import {
  ArmatureFileError,
  armatureText,
  defaultArmatureTitle,
  encodeArmatureProject,
  fetchArmatureProject,
  fetchArmatureTemplate,
  isProjectRecord,
  readArmatureProject,
  uploadArmature,
  type ArmatureLink,
} from './project';
import { askText, askWindow, tellWindow } from '../ui/askWindow';
import { viewerNeeds } from './viewerNeeds';

/** Undo steps kept (owner call), the oldest let go past it. */
const HISTORY_LIMIT = 100;
/**
 * How long a panel slider rests before its change is one undo step: a
 * drag of a slider is one step, not one per value it passed through. A
 * release (its change event) takes the step at once.
 */
const SLIDER_SETTLE_MS = 400;
/** How long Save to library waits on the sign-in probe before treating the visit as a guest's. */
const ROLE_WAIT_MS = 5000;
const SAVE_GAP_MS = 400;
/** The preset id a figure read from a file goes under. */
const IMPORTED = 'imported';
/** The figure a new armature starts on (owner call): a mannequin, fetched at boot. */
const DEFAULT_FIGURE = 'mannequin-male-realistic';
/**
 * What stands in when a mannequin cannot be fetched or a saved model
 * cannot be read: the blocks are code, so they are always there.
 */
const FALLBACK_FIGURE = 'placeholder-male';
/** What a press on the root's handle records, and its name in the scene. */
const ROOT_BALL = 'root';
/**
 * The head's look-at handle: its id as a selection (the old head chain's
 * id, kept), and the names of its arrowhead and its dashed line in the scene.
 */
const LOOK_ID = 'head';
const LOOK_NAME = 'look:head';
const LOOK_DASH = 'dash:head';
/** A floor ring's quad is this much wider than the ring it holds (handleViews.ts). */
const FLOOR_RING_MARGIN = 1.1;

/** The rig of a model already parsed once this session, by its bytes. */
const parsed = new WeakMap<ArrayBuffer, ReturnType<typeof rigFromGLTF>>();

/**
 * The rig of a loaded model. Parsing a glTF is asynchronous and building a
 * figure is not, so the bytes are read once, up front, and the result is
 * kept for the rebuilds that follow.
 */
function readModel(bytes: ArrayBuffer): ReturnType<typeof rigFromGLTF> {
  const held = parsed.get(bytes);
  if (!held) throw new Error('that model has not been read yet');
  parsed.set(bytes, held);
  return held;
}

/** Parse a .glb and derive its rig, before anything is built from it. */
async function parseModel(bytes: ArrayBuffer): Promise<ReturnType<typeof rigFromGLTF>> {
  const gltf = await getGLTFLoader().parseAsync(bytes.slice(0), '');
  const read = rigFromGLTF(gltf, IMPORTED, 'Model');
  read.rig.id = IMPORTED;
  parsed.set(bytes, read);
  return read;
}

/**
 * The mannequins' rigs, read once per session as they are picked. A
 * mannequin is a rigged .glb like any the owner loads, only fetched from
 * the app's own assets and named by its preset id, so the autosave and the
 * .armature file carry the id and nothing else.
 */
const figureReads = new Map<string, ReturnType<typeof rigFromGLTF>>();
async function ensureFigure(id: string): Promise<void> {
  if (figureReads.has(id)) return;
  const info = figureById(id);
  if (!info) throw new Error(`Unknown figure "${id}"`);
  const bytes = await fetchFigure(id);
  const gltf = await getGLTFLoader().parseAsync(bytes.slice(0), '');
  const read = rigFromGLTF(gltf, id, info.label);
  read.rig.id = id;
  tuneRig(read.rig, info);
  figureReads.set(id, read);
}

/** What the mannequin does while Armature is suspended: stays drawn (the posed figure shows in other workspaces) or goes. */
export interface SuspendOptions {
  /** Default 'hide'. */
  figure?: 'show' | 'hide';
}

/**
 * What mounting Armature gives back: the disposer, which is also the thing
 * itself, with `suspend` and `resume` beside it. Suspended, Armature hears
 * nothing, shows nothing of its own and has put the viewer back as it found
 * it (viewerNeeds.ts); resumed, it has everything as it left it.
 */
export type ArmatureMount = (() => void) & {
  /** The workspace the page's shell hosts (registered by the lazy loader, armature/workspace.ts). */
  workspace: Workspace;
  /** The tests' hook: Armature and the shell put away (what step B built), and back. */
  suspend(opts?: SuspendOptions): void;
  resume(): void;
  isSuspended(): boolean;
  /** The posed figure as world-space triangles, for Remesh to a figure. */
  bake(): { positions: Float32Array; indices: Uint32Array };
  /** The figure's mesh in the scene, for a press that may land on it. */
  mesh(): Mesh;
  /** The mesh while the figure is drawn outside Armature, where a press on it asks about a remesh; null otherwise. */
  outside(): Mesh | null;
  /** The posed figure's world box into `out`, for the shadow fit; false when it is not drawn. */
  shadowBox(out: Box3): boolean;
  /** Whether the figure is drawn while Armature is put away (no figure made yet). */
  showOutside(shown: boolean): void;
  /** The armature's name, as the Scene tab lists it. */
  armatureName(): string;
  /** The camera onto the figure. */
  frame(): void;
  /** What the Figure section of the Armature tab says, read again. */
  figureChanged(): void;
};

/**
 * Armature, a workspace of the Sculpt page (owner design): a posable
 * mannequin, the first step of a sculpt through Remesh to a figure. The
 * page's shell hosts it beside Sculpt, Paint and Present (src/armature/
 * workspace.ts loads this module the first time it is entered), in Sculpt's
 * own working view with the floor shown.
 *
 * Interaction is one idea: click a part and its joint's rotate gizmo
 * appears, clamped to that joint's limits and mirrored to the other side
 * while symmetry is on; the pelvis is the root and gets a move gizmo too.
 * Everything else - dragging off the figure, the wheel, the panels - is
 * the viewer as it always was.
 */
export async function mountArmatureMode(viewer: Viewer, host: ArmatureHost): Promise<ArmatureMount> {
  const studio = host.studio;
  // What this workspace adds to the page, found by what the build below puts there (ownedDom).
  const addedToPage = watchAdditions([document.body, viewer.captureCanvas.parentElement]);
  // What Armature asks of the viewer, on top of Sculpt's working view, is one short list
  // (viewerNeeds.ts), applied on entering and undone on leaving: the floor fixed where the figure
  // stands (its height comes once the figure is built, holdFloor), the floor shown, and a pose
  // drag counted as a move. The hook is filled in once the mode has built what it asks about.
  const hooks = {
    interaction: (): 'move' | null => null,
  };
  const needs = viewerNeeds(viewer, { interaction: () => hooks.interaction() });
  needs.apply();
  // The Render panel, Help and Preferences all listen for this: the hotkey guide of Armature's keys.
  const announce = (mode: 'armature' | 'sculpt'): void => {
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: true, mode } }));
  };
  announce('armature');
  /**
   * Armature is suspended: it hears nothing and shows nothing (suspend()).
   * Read by the few places that would otherwise bring something back into
   * view on their own, a figure arriving or a selection made by a test hook.
   */
  let suspended = false;
  /** What the figure does while suspended; see SuspendOptions. */
  let figureShown = false;
  /**
   * Everything the mode listens to or runs on its own, as a list of things
   * that start and stop: every window, document and canvas listener, the
   * observers, the timers, the subscriptions to settings and the device's
   * choice. Registered once, started at once; suspend stops them all, resume
   * starts them again, and nothing is added twice.
   */
  const subscriptions: Array<{ start(): void; stop(): void }> = [];
  const subscribe = (start: () => () => void): void => {
    let off: (() => void) | null = null;
    const sub = {
      start: () => {
        off ??= start();
      },
      stop: () => {
        off?.();
        off = null;
      },
    };
    subscriptions.push(sub);
    sub.start();
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listen = (target: EventTarget, type: string, fn: (e: any) => void, options?: boolean | AddEventListenerOptions): void =>
    subscribe(() => {
      target.addEventListener(type, fn as EventListener, options);
      return () => target.removeEventListener(type, fn as EventListener, options);
    });

  // An armature project opened by its address (docs/accounts.md §4-5): one's
  // own (`&project=<id>`, from My projects or the owner's gallery, saved back
  // there) or a template's copy (`&template=<id>`, nobody's project, so Save
  // to library makes one of your own). Read through the sanitiser
  // (project.ts) before anything is replaced; the address is cleaned at once,
  // so a reload does not open it again over the work done since.
  // The page read the address (an armature address leaves these parameters to this workspace) and
  // took the open token; they are cleaned off the address now, so a reload does not open the
  // project again over the work done since.
  const { project: projectId, template: templateId, scope: projectScope, sentHere } = host.address;
  if (projectId !== null || templateId !== null) {
    const url = new URL(window.location.href);
    for (const k of ['project', 'template', 'scope']) url.searchParams.delete(k);
    history.replaceState(history.state, '', url);
  }
  let saved = await loadArmature();
  /** The project Save to library writes to: the autosave's, or the one just opened. */
  let bootLink: ArmatureLink | null = saved?.project ?? null;
  let bootSymmetry: boolean | null = null;
  /** Whether the boot armature is its project's as saved: a project just opened, or an autosave that said so. */
  let bootSynced = !!bootLink && saved?.synced === true;
  /** A project or template was opened by its address: its pictures are the board's, not the autosave's. */
  let openedProject = false;
  /** Said once the page is up: what an opened file needed mending, or why it did not open. */
  const bootNotes: string[] = [];
  if (projectId || templateId) {
    try {
      const got: Awaited<ReturnType<typeof fetchArmatureTemplate>> & { link?: ArmatureLink | null } = projectId
        ? await fetchArmatureProject(projectId, projectScope)
        : await fetchArmatureTemplate(templateId!);
      const what = got.link ? `"${got.title}"` : `a copy of "${got.title}"`;
      const key = projectId ? `project:${projectId}` : `template:${templateId}`;
      // The card that sent this tab here asked already, if there was
      // anything to ask about (ui/openToken); an address alone asks here.
      if (
        !saved ||
        sentHere === key ||
        (await askWindow({
          title: `Open ${what}?`,
          text: 'The armature in progress on this device will be replaced.',
          yes: 'Replace',
          danger: true,
        }))
      ) {
        saved = got.file;
        openedProject = true;
        bootLink = got.link ?? null;
        bootSynced = !!got.link;
        bootSymmetry = got.symmetry;
        if (got.notice) bootNotes.push(got.notice);
      }
    } catch (err) {
      console.warn('armature: the project could not be opened', err);
      bootNotes.push(`That armature could not be opened: ${failureText(err)}`);
    }
  }
  // On centimetres, whichever scale it was saved on (armature/units.ts).
  if (saved) saved = onCentimetres(saved);
  if (saved?.model) {
    try {
      await parseModel(saved.model);
    } catch (err) {
      console.warn('armature: the saved model could not be read', err);
      saved.model = undefined;
      saved.state.preset = FALLBACK_FIGURE;
    }
  }
  // Always named: the project's title, the name it was kept under, or today's study.
  let name =
    bootLink?.title ?? (saved?.name && saved.name !== 'Armature'
      ? saved.name
      : saved?.savedAt
        ? defaultSceneName(new Date(saved.savedAt))
        : await newSceneName());
  /**
   * A figure read from a rigged file: its bytes, so it can be built again
   * on the next visit, and the rig derived from them. The built-in presets
   * are code and need none of this.
   */
  let model: { bytes: ArrayBuffer; name: string } | null =
    saved?.model ? { bytes: saved.model, name: saved.modelName ?? 'Model' } : null;
  const figureFor = (preset: string): Armature => {
    const material = viewer.materials.get(viewer.getMaterial());
    const mannequin = figureReads.get(preset);
    if (mannequin) return importArmature(mannequin, material);
    if (preset === IMPORTED && model) {
      return importArmature(readModel(model.bytes), material);
    }
    return buildArmature(preset === IMPORTED ? FALLBACK_FIGURE : preset, material);
  };
  // A mannequin - the saved one, or the one a new armature starts on - is
  // fetched before anything is built; if that fails (offline before the
  // service worker has precached it, or with no worker at all) the blocks
  // stand in and a saved pose still applies, since every figure shares the
  // bone names.
  let wanted = saved?.state.preset ?? DEFAULT_FIGURE;
  if (figureById(wanted)) {
    try {
      await ensureFigure(wanted);
    } catch (err) {
      console.warn(`armature: the mannequin "${wanted}" could not be fetched`, err);
      wanted = FALLBACK_FIGURE;
    }
  }
  let armature = figureFor(wanted);
  /**
   * The ground, fixed at the floor a figure stands on as it is built: the
   * lowest point of its feet in the rest pose, which is the height its
   * planting stands feet at too. The four mannequins rest with their soles
   * at 0, at their files' own sizes, so the floor is at 0 as it is in a
   * sculpt on real units, and stays put as one replaces another; the
   * Floor offset raises or lowers it from there. Called on a figure fresh
   * from figureFor, before any pose or placement lands.
   */
  const holdFloor = (): void => {
    const soles = armature.bounds().min.y;
    viewer.lockFloor(Math.abs(soles) < 1e-6 ? 0 : soles);
  };
  holdFloor();
  let restored = false;
  if (saved) {
    try {
      armature.restore(saved.state);
      restored = true;
    } catch (err) {
      console.warn('armature: saved state ignored', err);
    }
  }
  // A new armature starts with its feet pinned (owner call), taken where
  // they stand once the figure is placed: pins captured on a pose that is
  // then replaced would hold the feet somewhere they are not.
  if (!restored) armature.pinFeet();
  if (bootSymmetry !== null) armature.symmetry = bootSymmetry;
  viewer.adoptMesh(armature.mesh);
  viewer.setSculptAlbedo(armature.mesh, host.mannequinAlbedo());
  // The look is the scene's, one for the page (Sculpt's): an armature opened by itself, as a
  // project, a template or a file, brings the look it was saved under, as opening a scene does;
  // the armature left in progress on this device does not put its own over the scene's.
  if (openedProject && saved?.look) await host.applyLook(saved.look);

  /** The camera onto the figure, the view's angle kept. */
  const frame = (): void => {
    const box = armature.bounds();
    if (box.isEmpty()) return;
    // The camera comes to the figure, the view's angle kept.
    viewer.frameBounds(box);
  };
  // The stage (the ground's size, how near and far the camera may go) takes the mannequin in: it is
  // fitted to what the scene and the mannequin make together, never smaller than it was, and the camera
  // does not move (the four workspaces share one camera).
  const fitStage = (): void => {
    const box = armature.bounds();
    if (box.isEmpty()) return;
    viewer.fitSubject(viewer.subjectBounds().union(box), false);
  };
  /** Whether the whole figure is in the view now. */
  const figureInView = (): boolean => {
    const box = armature.bounds();
    if (box.isEmpty()) return true;
    viewer.camera.updateMatrixWorld();
    const corner = new Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(viewer.camera);
      if (Math.abs(corner.x) > 1 || Math.abs(corner.y) > 1 || corner.z > 1) return false;
    }
    return true;
  };
  // The first entry in a visit: a figure not wholly in view is framed once, the view's angle kept. After that
  // Armature keeps whatever the camera is.
  fitStage();
  if (!figureInView()) frame();
  fitStage();

  // --- selection + gizmos ---------------------------------------------------
  const canvas = viewer.renderer.domElement;
  let selected: string | null = null;
  /**
   * The IK ball picked by a tap, if any (owner request): shown selected,
   * with the move gizmo on it, which reaches the limb as a drag of the ball
   * does. A part's selection and a ball's are one at a time.
   */
  let selectedHandle: string | null = null;
  const wash = new MeshBasicNodeMaterial();
  wash.color.set('#c87049');
  wash.transparent = true;
  wash.opacity = 0.32;
  wash.depthWrite = false;
  // Eight millimetres off the surface (given in metres, times SCENE_SCALE).
  wash.positionNode = positionLocal.add(normalLocal.mul(float(0.008 * SCENE_SCALE)));
  let highlight: Mesh | null = null;

  const rotateTc = new TransformControls(viewer.camera, null);
  rotateTc.mode = 'rotate';
  rotateTc.space = 'local';
  rotateTc.setSize(0.75);
  const moveTc = new TransformControls(viewer.camera, null);
  moveTc.mode = 'translate';
  moveTc.space = 'world';
  moveTc.setSize(0.9);
  /**
   * The part's proportions (R): the handle along the bone is its length,
   * the two across it its size. It drives a stand-in on the bone rather
   * than the part itself, whose scale is the proportions' to set; the
   * stand-in's scale is read as a factor on the part as the drag found it.
   */
  const scaleTc = new TransformControls(viewer.camera, null);
  scaleTc.mode = 'scale';
  scaleTc.space = 'local';
  scaleTc.setSize(0.75);
  const scaleProxy = new Object3D();
  scaleProxy.name = 'armature-scale';
  /**
   * What the pelvis's move gizmo is attached to: a point in the world at
   * the middle of the box round the hips, where the gizmo should sit (the
   * pelvis bone's own joint is down at its bottom). A change of it moves
   * the root by the same step.
   */
  const rootProxy = new Object3D();
  rootProxy.name = 'armature-root-move';
  /**
   * The same for the pelvis's rotate gizmo: at the middle of the box, turned
   * as the hips are. Its turn is the hips' turn about that middle: what it
   * has turned by since the last change is `spinLast`'s inverse.
   */
  const rootSpin = new Object3D();
  rootSpin.name = 'armature-root-turn';
  const spinLast = new Quaternion();
  const spinStep = new Quaternion();
  const spinAt = new Vector3();
  const spinFrom = new Vector3();
  let spinning = false;
  /** The part's proportions as the drag began. */
  let scaleFrom: { size: number; length: number } | null = null;
  const controls = [rotateTc, moveTc, scaleTc];
  // Their own pointer listeners on the canvas are part of what is suspended.
  subscribe(() => {
    for (const tc of controls) tc.connect(canvas);
    return () => {
      for (const tc of controls) tc.disconnect();
    };
  });
  const attached = new Set<TransformControls>();
  const rootMiddle = new Vector3();
  const rootStep = new Vector3();
  let dragging = false;
  /** Which handles the selection gets, as in sculpt mode: t, w, e, r. */
  let gizmoMode: 'all' | 'translate' | 'rotate' | 'scale' = 'all';

  /**
   * With both controls on the pelvis, the middle belongs to the move
   * control's screen-plane handle (owner call) - so the rotate control's
   * invisible free-rotate sphere, which sits on top of it and is first in
   * line for the pointer, comes off. A joint that only rotates keeps it.
   */
  const freeRotate: Array<{ parent: Object3D; child: Object3D }> = [];
  const trimFreeRotate = (off: boolean): void => {
    for (const { parent, child } of freeRotate) parent.add(child);
    freeRotate.length = 0;
    if (!off) return;
    const internals = (
      rotateTc as unknown as {
        _gizmo: { gizmo: Record<string, Object3D>; picker: Record<string, Object3D> };
      }
    )._gizmo;
    for (const group of [internals.gizmo.rotate, internals.picker.rotate]) {
      for (const child of [...group.children]) {
        if (child.name === 'XYZE') {
          freeRotate.push({ parent: group, child });
          group.remove(child);
        }
      }
    }
  };
  for (const tc of controls) {
    const helper = tc.getHelper();
    helper.visible = false;
    viewer.scene.add(helper);
    tc.enabled = false;
    tc.addEventListener('dragging-changed', (e) => {
      const on = !!(e as unknown as { value: boolean }).value;
      dragging = on;
      if (tc === rotateTc) spinning = on;
      viewer.setOrbitEnabled(!on);
      if (tc === scaleTc) {
        scaleProxy.scale.set(1, 1, 1);
        scaleFrom = on && selected ? armature.getProportions(selected) : null;
      }
      // One control at a time on the root, where both are attached.
      for (const other of controls) if (other !== tc) other.enabled = !on && attached.has(other);
      // A drag of the look-at handle's gizmo turns from where it began, as a drag of the handle does.
      if (selectedHandle === LOOK_ID) {
        if (on) armature.beginLook();
        else armature.endLook();
      }
      if (!on) {
        commit();
        flushPanel();
      }
    });
    tc.addEventListener('objectChange', () => {
      if (tc === scaleTc) scaled();
      else if (tc === rotateTc && rotateTc.object === rootSpin) {
        // The hips turned about the middle of their box: the root turns by
        // the step the proxy took, and goes round that middle with it.
        spinStep.copy(rootSpin.quaternion).multiply(spinLast.invert());
        armature.rootHandleWorld(spinAt);
        armature.root.getWorldPosition(spinFrom).sub(spinAt).applyQuaternion(spinStep).add(spinAt);
        armature.root.quaternion.premultiply(spinStep);
        armature.root.position.copy(armature.root.parent ? armature.root.parent.worldToLocal(spinFrom) : spinFrom);
        spinLast.copy(rootSpin.quaternion);
        afterGizmo(null);
      } else if (tc === moveTc && moveTc.object === rootProxy) {
        // The proxy was moved from the box's middle: the root goes by that step.
        armature.rootHandleWorld(rootMiddle);
        const to = rootProxy.getWorldPosition(rootStep).sub(rootMiddle).add(armature.root.getWorldPosition(rootMiddle));
        armature.root.position.copy(armature.root.parent ? armature.root.parent.worldToLocal(to) : to);
        afterGizmo(null);
      } else if (selectedHandle) handleMoved(selectedHandle);
      else afterGizmo(selected && armature.def(selected)?.kind !== 'root' ? selected : null);
    });
  }
  /**
   * After a gizmo moved something: the root, or `joint` turned by hand. A
   * joint is clamped to its limits and becomes its limb's aim, so the pin
   * re-solve that follows keeps the knee or elbow where it was turned to.
   */
  const afterGizmo = (joint: string | null): void => {
    // The head or the neck turned by hand takes the look-at target with it;
    // any other change leaves the target and the head faces it again.
    const byHand = !!joint && armature.isLookBone(joint);
    if (joint) {
      armature.clampPose(joint);
      armature.followAims(joint);
      if (byHand) armature.carryLook();
    }
    // Pinned hands and feet hold their ground while the rest moves; this
    // is what lets the pelvis drop into a crouch with the feet planted. A
    // foot being turned by hand is not stood flat again under the gizmo,
    // or no drag of it would show.
    armature.applyPins(undefined, armature.plantFeet && !(joint && armature.isFoot(joint)), !byHand);
    syncHandles();
    refreshPanel();
    scheduleSave();
  };
  /**
   * The scale gizmo moved: the selected part's length by the handle along
   * its bone, its size by whichever handle across it moved further (both
   * go together, the cross-section being one size), in whole percent,
   * clamped and mirrored as the panel's sliders are. The panel catches up
   * when the drag ends.
   */
  const scaled = (): void => {
    if (!selected || !scaleFrom) return;
    const s = scaleProxy.scale;
    const across = Math.abs(s.x - 1) >= Math.abs(s.z - 1) ? s.x : s.z;
    // In whole percent, as the panel's rows read.
    const pct = (v: number): number => Math.round(v * 100) / 100;
    armature.setProportions(selected, { size: pct(scaleFrom.size * across), length: pct(scaleFrom.length * s.y) });
    armature.applyPins();
    syncHandles();
    refreshPanel();
    scheduleSave();
  };
  // Attached pickers need their matrices before the first hover.
  const placeControls = (): void => {
    for (const tc of controls) if (tc.enabled) tc.getHelper().updateMatrixWorld(true);
  };

  const select = (bone: string | null): void => {
    if (highlight) {
      highlight.removeFromParent();
      highlight = null;
    }
    for (const tc of controls) {
      tc.detach();
      tc.enabled = false;
      tc.getHelper().visible = false;
    }
    attached.clear();
    scaleProxy.removeFromParent();
    rootProxy.removeFromParent();
    rootSpin.removeFromParent();
    selectedHandle = null;
    selected = bone && armature.bones.has(bone) ? bone : null;
    if (selected) {
      const def = armature.def(selected)!;
      const target = armature.bones.get(selected)!;
      const l = armature.limitsOf(selected);
      rotateTc.showX = def.kind === 'root' || l.x[1] > l.x[0];
      rotateTc.showY = def.kind === 'root' || l.y[1] > l.y[0];
      rotateTc.showZ = def.kind === 'root' || l.z[1] > l.z[0];
      // A bone rotates; the pelvis is the root, so it also moves.
      // Any part scales (R), the pelvis included.
      const wanted =
        gizmoMode === 'scale'
          ? [scaleTc]
          : def.kind === 'root'
            ? gizmoMode === 'translate'
              ? [moveTc]
              : gizmoMode === 'rotate'
                ? [rotateTc]
                : [rotateTc, moveTc]
            : [rotateTc];
      trimFreeRotate(wanted.length > 1);
      if (gizmoMode === 'scale') {
        target.add(scaleProxy);
        scaleProxy.scale.set(1, 1, 1);
      }
      for (const tc of wanted) {
        if (tc === moveTc && def.kind === 'root') {
          armature.rootHandleWorld(rootProxy.position);
          viewer.scene.add(rootProxy);
        }
        if (tc === rotateTc && def.kind === 'root') {
          armature.rootHandleWorld(rootSpin.position);
          armature.root.getWorldQuaternion(rootSpin.quaternion);
          spinLast.copy(rootSpin.quaternion);
          viewer.scene.add(rootSpin);
        }
        const root = def.kind === 'root';
        tc.attach(tc === scaleTc ? scaleProxy : tc === moveTc && root ? rootProxy : tc === rotateTc && root ? rootSpin : target);
        tc.enabled = true;
        tc.getHelper().visible = !suspended;
        attached.add(tc);
      }
      placeControls();
      highlight = armature.partHighlight(selected, wash);
      if (highlight) {
        highlight.visible = !suspended;
        armature.partBones.get(selected)!.add(highlight);
      }
    }
    syncHandles();
    panel.refresh(selected);
  };

  /**
   * A tap on a handle: that handle selected (its outline turns orange). No
   * gizmo comes with it (owner call, 2026-11-17): a handle is moved by
   * dragging it. `gizmo` puts the move gizmo on it, which Move (W) asks for
   * on a selected handle, for a move along one axis.
   */
  let handleGizmo = false;
  const selectHandle = (id: string | null, gizmo = false): void => {
    select(null);
    handleGizmo = false;
    const ball = id ? handleMesh(id) : undefined;
    if (!id || !ball || !handlesOn) return;
    selectedHandle = id;
    handleGizmo = gizmo;
    if (gizmo) {
      trimFreeRotate(false);
      moveTc.attach(ball);
      moveTc.enabled = true;
      moveTc.getHelper().visible = !suspended;
      attached.add(moveTc);
    }
    syncHandles();
    placeControls();
  };
  /** The mesh of a selectable handle: a reach ring by its chain, or the look-at by LOOK_ID. */
  const handleMesh = (id: string): Mesh | undefined => (id === LOOK_ID ? views.get(LOOK_NAME)?.mesh : id.startsWith('aim:') ? aims.get(id.slice(4)) : handles.get(id));
  /**
   * The selected handle moved by its gizmo: the limb reaches for it, as a
   * drag of the ring reaches; the head turns to face it, as a drag of the
   * look-at turns it.
   */
  const handleMoved = (id: string): void => {
    const ball = handleMesh(id);
    if (!ball) return;
    if (id === LOOK_ID) {
      armature.lookAt(ball.getWorldPosition(dragPoint));
      armature.applyPins();
    } else if (id.startsWith('aim:')) {
      armature.placePole(id.slice(4), ball.getWorldPosition(dragPoint));
      armature.applyPins();
    } else {
      // The ring sits on the middle of the part, off the effector point the reach is aimed at: by that much.
      const c = armature.chain(id);
      ball.getWorldPosition(dragPoint);
      if (c) dragPoint.sub(armature.ringWorld(id, grabAt)).add(armature.effectorWorld(c.effector, joint));
      armature.reach(id, dragPoint);
      armature.repin(id);
      armature.applyPins(id);
    }
    // Back where the hand, foot or head got to, which the gizmo then follows.
    syncHandles();
    placeControls();
    refreshPanel();
    scheduleSave();
  };

  // --- IK handles ------------------------------------------------------------
  // Controls drawn the way animation programs draw them (handleViews.ts):
  // outlines, neutral, orange only while selected or dragged.
  //   a ring at each chain's far end: drag it and the limb reaches for it;
  //   pin it (a dot in its middle) and it holds its ground while the figure moves.
  //   an arrowhead out from each knee and elbow, joined to the joint by a
  //   dashed line: drag it and the joint turns toward it.
  //   an arrowhead in front of the face, the same way: drag it and the head
  //   (and the neck, and a little of the back) turn to face it.
  //   a rectangle round the hips for the root: drag it and the whole figure moves.
  // Drawn over everything (depth test off): a handle you cannot click
  // because the figure's own arm is in front of it is no handle at all.
  const handleGroup = new Group();
  handleGroup.name = 'ik-handles';
  viewer.scene.add(handleGroup);
  const kit = new HandleKit();
  // The shaders measure their pixels against the canvas as the page shows it.
  const placeViewport = (): void => {
    const r = canvas.getBoundingClientRect();
    kit.setViewport(r.width, r.height);
  };
  placeViewport();
  const viewportObserver = new ResizeObserver(placeViewport);
  subscribe(() => {
    viewportObserver.observe(canvas);
    return () => viewportObserver.disconnect();
  });
  // The handle being dragged or hovered, and what it is doing. Declared
  // here, ahead of the first sync, which paints from them.
  /** The reach ring being dragged, by chain. */
  let reaching: string | null = null;
  /** The knee or elbow being aimed, if any. */
  let aiming: string | null = null;
  /** The head's look-at being dragged. */
  let looking = false;
  /**
   * The root being moved by its handle: where the press met its plane
   * and where the root stood then, in the world. The root goes by what the
   * pointer has moved since, as the gizmo's centre moves it, so a press
   * that landed off the handle's centre does not make the figure jump.
   */
  let moving: { from: Vector3; root: Vector3 } | null = null;
  /** The handle under the pointer, by name, if any. */
  let hovered: string | null = null;
  // A ring on the floor under each foot planting holds flat (owner report:
  // the box seemed to do nothing, since pins - not planting - hold a foot
  // in place, and a foot standing flat looks much as one at rest).
  const plantGroup = new Group();
  plantGroup.name = 'plant-marks';
  viewer.scene.add(plantGroup);
  const plantMarks = new Map<string, HandleView>();
  const markAt = new Vector3();
  const syncPlantMarks = (): void => {
    const planted = new Set(armature.plantedFeet());
    const floor = viewer.lockedFloor() ?? 0;
    for (const [foot, ring] of plantMarks) {
      if (!planted.has(foot)) ring.mesh.visible = false;
    }
    for (const foot of planted) {
      let ring = plantMarks.get(foot);
      if (!ring) {
        ring = kit.create('floor', `plant:${foot}`);
        kit.paint(ring, 'rest');
        plantGroup.add(ring.mesh);
        plantMarks.set(foot, ring);
      }
      armature.effectorWorld(foot, markAt, 0.5);
      // About a foot's length across, a hair above the floor.
      ring.mesh.scale.setScalar(0.13 * armature.scale * FLOOR_RING_MARGIN);
      ring.mesh.position.set(markAt.x, floor + 0.002 * armature.scale, markAt.z);
      ring.mesh.visible = true;
    }
  };
  let handlesOn = true;
  /** Every handle's drawing, by name: 'ik:<chain>', 'aim:<chain>', 'dash:<chain>', 'look:head', 'dash:head', 'root'. */
  const views = new Map<string, HandleView>();
  const handles = new Map<string, Mesh>();
  const aims = new Map<string, Mesh>();
  /** What a press can take, aim and look first and the root's last. */
  const pickList: Ball[] = [];
  // Every figure has one root, so one handle serves them all and is kept
  // through a change of figure.
  const rootView = kit.create('box', ROOT_BALL);
  handleGroup.add(rootView.mesh);
  views.set(ROOT_BALL, rootView);
  const make = (shape: HandleShape, name: string): HandleView => {
    const v = kit.create(shape, name);
    handleGroup.add(v.mesh);
    views.set(name, v);
    return v;
  };
  const buildHandles = (): void => {
    for (const [name, v] of [...views]) {
      if (v === rootView) continue;
      kit.release(v);
      views.delete(name);
    }
    handles.clear();
    aims.clear();
    pickList.length = 0;
    const rings: Ball[] = [];
    const poles: Ball[] = [];
    for (const c of armature.chains()) {
      const ring = make('ring', `ik:${c.id}`);
      handles.set(c.id, ring.mesh);
      rings.push({ kind: 'ik', id: c.id, ball: ring.mesh, view: ring });
      if (!c.poleRef) continue;
      make('dash', `dash:${c.id}`);
      const arrow = make('arrow', `aim:${c.id}`);
      aims.set(c.id, arrow.mesh);
      poles.push({ kind: 'aim', id: c.id, ball: arrow.mesh, view: arrow });
    }
    if (armature.hasLook()) {
      make('dash', LOOK_DASH);
      const arrow = make('arrow', LOOK_NAME);
      poles.push({ kind: 'look', id: LOOK_ID, ball: arrow.mesh, view: arrow });
    }
    pickList.push(...poles, ...rings, { kind: 'root', id: armature.root.name, ball: rootView.mesh, view: rootView });
  };
  /** How a handle is drawn: orange when selected or dragged, white under the pointer, else neutral. */
  const stateOf = (name: string, hot: boolean): HandleState => (hot ? 'hot' : hovered === name ? 'hover' : 'rest');
  const paintHandles = (): void => {
    for (const id of handles.keys()) {
      const name = `ik:${id}`;
      kit.paint(views.get(name)!, stateOf(name, id === selectedHandle || id === reaching), armature.isPinned(id));
    }
    for (const id of aims.keys()) {
      const name = `aim:${id}`;
      const state = stateOf(name, id === aiming || selectedHandle === name);
      // Dimmer while the joint cannot bend toward its target: out of range, not a fault.
      const dim = !armature.poleInRange(id);
      kit.paint(views.get(name)!, state, false, dim);
      kit.paint(views.get(`dash:${id}`)!, state, false, dim);
    }
    const lookArrow = views.get(LOOK_NAME);
    if (lookArrow) {
      // Dimmer while the head cannot reach the target: out of range, not a fault.
      const state = stateOf(LOOK_NAME, looking || selectedHandle === LOOK_ID);
      const dim = !armature.lookInRange();
      kit.paint(lookArrow, state, false, dim);
      kit.paint(views.get(LOOK_DASH)!, state, false, dim);
    }
    kit.paint(rootView, stateOf(ROOT_BALL, moving !== null || selected === armature.root.name));
  };
  const at = new Vector3();
  const joint = new Vector3();
  const syncHandles = (): void => {
    // Every pose change, selection and figure swap comes through here: the
    // picture changed, so a still frame's smoothing starts over.
    viewer.invalidate();
    syncPlantMarks();
    handleGroup.visible = handlesOn && !suspended;
    if (!handlesOn) return;
    placeViewport();
    for (const [id, m] of handles) {
      const c = armature.chain(id);
      if (!c) continue;
      // The ring is drawn on the middle of the hand's or foot's own geometry; the reach aims at its effector point.
      armature.ringWorld(id, at);
      m.position.copy(at);
    }
    for (const [id, m] of aims) {
      const where = armature.hingeWorld(id, joint);
      const target = where ? armature.poleTarget(id, at) : null;
      const arrow = views.get(`aim:${id}`)!;
      const dash = views.get(`dash:${id}`)!;
      m.visible = dash.mesh.visible = !!target;
      if (!where || !target) continue;
      m.position.copy(target);
      arrow.toward.value.copy(joint);
      dash.mesh.position.copy(joint);
      dash.from.value.copy(joint);
      dash.toward.value.copy(target);
    }
    const lookArrow = views.get(LOOK_NAME);
    if (lookArrow) {
      const dash = views.get(LOOK_DASH)!;
      const target = armature.lookFromWorld(joint) ? armature.lookTarget(at) : null;
      lookArrow.mesh.visible = dash.mesh.visible = !!target;
      if (target) {
        lookArrow.mesh.position.copy(target);
        lookArrow.toward.value.copy(joint);
        dash.mesh.position.copy(joint);
        dash.from.value.copy(joint);
        dash.toward.value.copy(target);
      }
    }
    // The box round the hips: the pelvis part's bounds in its own frame.
    if (armature.rootBoxMatrix(rootView.mesh.matrix)) {
      rootView.mesh.matrix.decompose(rootView.mesh.position, rootView.mesh.quaternion, rootView.mesh.scale);
      rootView.mesh.matrixWorldNeedsUpdate = true;
      rootView.mesh.position.copy(armature.rootHandleWorld(at));
    }
    // The pelvis's move gizmo sits in the middle of that box.
    if (!dragging) rootProxy.position.copy(rootView.mesh.position);
    // And so does its turn gizmo, turned as the hips are.
    if (!spinning && rootSpin.parent) {
      rootSpin.position.copy(rootView.mesh.position);
      armature.root.getWorldQuaternion(rootSpin.quaternion);
      spinLast.copy(rootSpin.quaternion);
    }
    paintHandles();
  };
  buildHandles();
  // Placed now, not on the first interaction: until then every handle sat at
  // the origin, between the feet, where a press could take the wrong one.
  syncHandles();

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const aimAt = (x: number, y: number): void => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, viewer.camera);
  };
  const aim = (e: PointerEvent): void => aimAt(e.clientX, e.clientY);
  // A reach ring slides on a plane through where it was grabbed, facing the
  // camera, so the drag follows the pointer.
  /** A handle or a gizmo is being dragged: the figure is moving under the pointer. */
  const dragUnderway = (): boolean => dragging || reaching !== null || aiming !== null || looking || moving !== null;
  /**
   * The panel was not refreshed during a drag, and owes a refresh at its
   * end. A refresh rebuilds the joint and part sections, and doing that on
   * every move of a drag held each frame up for rows nobody reads until the
   * drag ends, where the numbers then land.
   */
  let panelStale = false;
  const refreshPanel = (): void => {
    if (dragUnderway()) panelStale = true;
    else panel.refresh(selected);
  };
  const flushPanel = (): void => {
    if (!panelStale) return;
    panelStale = false;
    panel.refresh(selected);
  };
  // Fast frames while a pose drag moves the figure (and, the viewer sees
  // for itself, while the view moves): Viewer.updateFrameMode. The viewer's side
  // of it is viewerNeeds' interactionProbe; this is what the probe asks.
  hooks.interaction = () => (dragUnderway() ? 'move' : null);
  const dragPlane = new Plane();
  const dragPoint = new Vector3();
  // Scratch for the aim and look drags, which run on every move.
  const dragNormal = new Vector3();
  const lookPoint = new Vector3();
  /** Where a press landed on the look-at target, from its middle in the world, so the drag does not jump by it. */
  const lookGrab = new Vector3();
  /** Where a press landed on a pole target, from its middle; and on a ring, from the effector point its reach is aimed at. */
  const poleGrab = new Vector3();
  const ringGrab = new Vector3();
  const grabAt = new Vector3();
  /** What the last press took: 'ik:<chain>', 'aim:<chain>', 'look:head', 'root', a part's bone, or nothing. */
  let picked: string | null = null;
  /**
   * How near a handle's centre a press has to land to take it, in CSS
   * pixels: a 44 px circle, the least a finger needs. The root's box takes
   * a press inside its outline or within the same distance of an edge.
   */
  const PICK_RADIUS = 22;
  /**
   * How far a press may travel and still be a tap, in CSS pixels: the
   * viewer's own TAP_SLOP and Sculpt's for a finger (InputShell). A press
   * that goes farther is a drag - an orbit, a pan, a ball's drag - and
   * selects nothing.
   */
  const TAP_SLOP = 10;
  /**
   * A press that may yet be a tap (owner request): on a part, or on empty
   * space, the selection changes only when it lifts within TAP_SLOP, so
   * the view can be turned, panned and zoomed - from on the figure or off
   * it, by mouse or by fingers - and the part stays selected with its
   * gizmo. On an IK ball it is the ball's drag from the start, as ever,
   * and only becomes the ball's selection if it lifts within the slop:
   * `before` is the pose at the press, put back then if the drag had
   * stirred it on the way.
   */
  let tap: { id: number; x: number; y: number; target: string | null; ball: string | null; before: string | null; at?: number } | null = null;
  /**
   * Pinning a hand or a foot by its ring (owner request): a double-click or
   * double-tap, or a press held still for LONG_PRESS_MS, toggles its pin.
   * `pinPress` is a press on a ring that may yet become the long press;
   * `pinHeld` is the pointer of a press that pinned (or was the second of a
   * double), whose lift does nothing more; `lastRingTap` is the last tap on
   * a ring, which a second press close to it in time and place completes.
   */
  let pinPress: { id: number; chain: string; x: number; y: number; downAt: number; timer: number; waits: number } | null = null;
  let pinHeld = -1;
  /** The press that pinned, to put the pin back if its lift turns out (by the events' own times) to have come before the time ran out. */
  let heldPress: { chain: string; was: boolean; downAt: number; x: number; y: number } | null = null;
  let lastRingTap: { chain: string; at: number; x: number; y: number } | null = null;
  const DOUBLE_TAP_MS = 350;
  /** How far a press may wander and still be held still for the long press, in CSS pixels: a drag that starts is a drag at once, however slowly the page takes its first moves. */
  const LONG_PRESS_SLOP = 4;
  /** How far apart a double-click's two presses may be, in CSS pixels: tight for a mouse, wider for a finger or the Pencil. */
  const doubleTapDistance = (e: PointerEvent): number => (e.pointerType === 'mouse' ? 6 : 24);
  const cancelPinPress = (): void => {
    if (pinPress) clearTimeout(pinPress.timer);
    pinPress = null;
  };
  /** The pointers down on the canvas: a second one is a pinch, never a tap. */
  const down = new Set<number>();
  const travelled = (e: PointerEvent): boolean =>
    !!tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP;
  const projected = new Vector3();
  /** Where a world point falls on the page, in CSS pixels; null behind the camera. */
  const toPage = (world: Vector3): [number, number] | null => {
    projected.copy(world).project(viewer.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const r = canvas.getBoundingClientRect();
    return [r.left + ((projected.x + 1) / 2) * r.width, r.top + ((1 - projected.y) / 2) * r.height];
  };
  /** Where a world point falls on the page, in CSS pixels, into `out`; false behind the camera. */
  const pagePoint = (world: Vector3, out: { x: number; y: number }): boolean => {
    projected.copy(world).project(viewer.camera);
    if (projected.z < -1 || projected.z > 1) return false;
    const r = canvas.getBoundingClientRect();
    out.x = r.left + ((projected.x + 1) / 2) * r.width;
    out.y = r.top + ((1 - projected.y) / 2) * r.height;
    return true;
  };
  const rimAt = new Vector3();
  const ballOnScreen = (ball: Mesh): [number, number] | null => toPage(ball.getWorldPosition(rimAt));
  interface Ball {
    kind: 'ik' | 'aim' | 'look' | 'root';
    /** The chain, or for the root its bone. */
    id: string;
    ball: Mesh;
    view: HandleView;
  }
  /** What a press on a handle records: 'aim:<chain>', 'ik:<chain>', 'look:head' or 'root'. */
  const ballName = (b: Ball): string => b.view.name;
  const handlePage = { x: 0, y: 0 };
  /** The box's eight corners on the page, in the order of the cube's bits. */
  const cornerPage = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  const cornerAt = new Vector3();
  const rootCorners = (): boolean => {
    rootView.mesh.updateMatrixWorld(true);
    for (let i = 0; i < 8; i++) {
      cornerAt.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).applyMatrix4(rootView.mesh.matrixWorld);
      if (!pagePoint(cornerAt, cornerPage[i])) return false;
    }
    return true;
  };
  /** How far a point is from the segment between two page points. */
  const segmentDistance = (x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (a.x + k * dx), y - (a.y + k * dy));
  };
  const insideTriangle = (x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean => {
    const s1 = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s2 = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
    const s3 = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  /** The faces of the cube as corner indices, round each face. */
  const BOX_FACES = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  /**
   * The root's pick shape: inside the box's outline on the page, or within
   * PICK_RADIUS (22 px, so 44 px across) of any of its edges.
   */
  const onRootBox = (x: number, y: number): boolean => {
    if (!rootCorners()) return false;
    for (const f of BOX_FACES) {
      if (insideTriangle(x, y, cornerPage[f[0]], cornerPage[f[1]], cornerPage[f[2]]) || insideTriangle(x, y, cornerPage[f[0]], cornerPage[f[2]], cornerPage[f[3]])) return true;
    }
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (!(i & bit) && segmentDistance(x, y, cornerPage[i], cornerPage[i | bit]) <= PICK_RADIUS) return true;
      }
    }
    return false;
  };
  /**
   * How far a press at (x, y) is from a handle's centre, in CSS pixels, if
   * it lands on the handle's pick shape - a 44 px circle round the centre,
   * and for the root the whole box (onRootBox) - else Infinity.
   */
  const pickDistance = (b: Ball, x: number, y: number): number => {
    if (!b.ball.visible || !pagePoint(b.ball.getWorldPosition(rimAt), handlePage)) return Infinity;
    const d = Math.hypot(handlePage.x - x, handlePage.y - y);
    if (d <= PICK_RADIUS) return d;
    return b.kind === 'root' && onRootBox(x, y) ? d : Infinity;
  };
  /**
   * The handle a press takes: the nearest visible one whose pick shape holds
   * the pointer, however deep it sits (owner call: the handles win over the
   * parts). A handle is a few pixels across, and a press that had to land on
   * the drawing itself, with a part right behind it taking every near miss,
   * made the knees and elbows the hardest things on the figure to grab. On a
   * tie the pole and look-at targets win, being the smaller, and the root's
   * loses, being the one that moves everything.
   */
  const ballUnder = (e: PointerEvent): Ball | null => {
    if (!handlesOn) return null;
    let best: Ball | null = null;
    let nearest = Infinity;
    for (const b of pickList) {
      const d = pickDistance(b, e.clientX, e.clientY);
      if (d < nearest) {
        nearest = d;
        best = b;
      }
    }
    return best;
  };
  // --- hold L: the key light -------------------------------------------------
  /**
   * Hold L and move the pointer (owner request, as in sculpt mode): across
   * swings the key light around the figure, up and down raises and lowers
   * it, half a degree a pixel (Lighting.nudgeKey). While L is held the
   * pointer is the light's alone - a press orbits nothing, picks no part,
   * grabs no ball and starts no gizmo drag - and letting go of L gives it
   * back. The orbit and both gizmos listen on the canvas too, so the
   * light's events end there with stopImmediatePropagation: stopPropagation
   * alone stops nothing on the element it is called on.
   */
  let lightHeld = false;
  /** View > Move light: the next drag moves the key light, then it lets go (Esc cancels). */
  let lightArmed = false;
  let lightPointer = -1;
  const armLight = (on: boolean): void => {
    lightArmed = on;
    lightPointer = -1;
    lightHeld = on;
  };
  /** Where the pointer last moved over the canvas: the light turns by the step from there. */
  const lastPointer = { x: NaN, y: NaN };
  let lightSyncTimer = 0;
  const lightMoved = (): void => {
    scheduleSave(); // the look rides the armature's record
    // The Render panel's azimuth and elevation rows read their values when
    // they are built: one rebuild once the drag settles, as sculpt does.
    clearTimeout(lightSyncTimer);
    lightSyncTimer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('bozzetto:look-restored')), 350);
  };
  const claimForLight = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** A hand or foot pinned if it is free, freed if it is pinned: one undo step, the panel's box following. */
  const togglePin = (chain: string): void => {
    armature.setPinned(chain, !armature.isPinned(chain));
    syncHandles();
    panel.refresh(selected);
    commit();
  };
  /**
   * A press on a ring is a long press: pin it, with the press still down.
   * The limb goes back to where the press found it (a hand that shook a
   * little under the finger), and the lift that follows does nothing.
   */
  const longPin = (press: NonNullable<typeof pinPress>): void => {
    if (tap && tap.id === press.id && tap.before !== null) armature.restore(JSON.parse(tap.before) as ArmatureState);
    cancelPinPress();
    tap = null;
    reaching = null;
    pinHeld = press.id;
    heldPress = { chain: press.chain, was: armature.isPinned(press.chain), downAt: press.downAt, x: press.x, y: press.y };
    togglePin(press.chain);
    paintHandles();
    viewer.invalidate();
  };
  function pinHeldDown(): void {
    const press = pinPress;
    if (!press) return;
    // A page busy with a frame runs this timer ahead of events that came in
    // before it ran out: a move that was made in time, a second finger. Where
    // the browser can say so, those are let through first (a few turns of the
    // loop at most), since they are what cancels the press.
    const scheduling = (navigator as Navigator & { scheduling?: { isInputPending?: (o?: { includeContinuous?: boolean }) => boolean } }).scheduling;
    if (press.waits < 40 && scheduling?.isInputPending?.({ includeContinuous: true })) {
      press.waits++;
      press.timer = window.setTimeout(pinHeldDown, 5);
      return;
    }
    press.timer = 0;
    longPin(press);
  }

  const onPointerDown = (e: PointerEvent): void => {
    down.add(e.pointerId);
    // A second finger: a pinch or a two-finger pan, whatever the first was.
    if (down.size > 1) {
      tap = null;
      cancelPinPress();
    }
    if (lightHeld) {
      if (lightArmed && lightPointer === -1) {
        lightPointer = e.pointerId;
        lastPointer.x = e.clientX;
        lastPointer.y = e.clientY;
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      claimForLight(e);
      return;
    }
    if (e.button !== 0 || dragging) return;
    // A press on a gizmo handle belongs to the gizmo (its hover set `axis`).
    for (const tc of controls) {
      if (!tc.enabled) continue;
      const t = tc as unknown as {
        _getPointer(ev: PointerEvent): { x: number; y: number; button: number };
        pointerHover(p: { x: number; y: number; button: number }): void;
        axis: string | null;
      };
      t.pointerHover(t._getPointer(e));
      if (t.axis) {
        picked = null;
        tap = null;
        return;
      }
    }
    aim(e);
    // The balls come before the parts: they are drawn over the figure, so
    // they are picked over it too, near misses included.
    const ball = ballUnder(e);
    if (ball) {
      picked = ballName(ball);
      if (ball.kind === 'aim') {
        aiming = ball.id;
        // A point placed in the plane through where it is, facing the camera: the press's offset from its middle is kept.
        dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragNormal), ball.ball.position);
        if (raycaster.ray.intersectPlane(dragPlane, poleGrab)) poleGrab.sub(ball.ball.position);
        else poleGrab.set(0, 0, 0);
        if (down.size === 1) {
          tap = { id: e.pointerId, x: e.clientX, y: e.clientY, target: null, ball: `aim:${ball.id}`, before: null };
        }
      } else if (ball.kind === 'look') {
        // The target is a point in the world, moved in the plane that faces
        // the camera through where it is. Where on the handle the press
        // landed is kept, so the drag does not jump by it; the torso's
        // poses now are what the drag's small shares turn from.
        looking = true;
        dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragNormal), ball.ball.position);
        if (raycaster.ray.intersectPlane(dragPlane, lookGrab)) lookGrab.sub(ball.ball.position);
        else lookGrab.set(0, 0, 0);
        armature.beginLook();
        if (down.size === 1) {
          tap = { id: e.pointerId, x: e.clientX, y: e.clientY, target: null, ball: LOOK_ID, before: null };
        }
      } else {
        dragPlane.setFromNormalAndCoplanarPoint(
          viewer.camera.getWorldDirection(dragPoint).clone(),
          ball.ball.position,
        );
        // No selection, and so no gizmo: attached under this press, the
        // pelvis gizmo would hear it too and could start a drag of its own.
        if (ball.kind === 'root') {
          moving = {
            from: raycaster.ray.intersectPlane(dragPlane, new Vector3()) ?? ball.ball.position.clone(),
            root: armature.root.getWorldPosition(new Vector3()),
          };
          // A tap on the box selects the hips; a press that travels moves the figure.
          if (down.size === 1) {
            tap = { id: e.pointerId, x: e.clientX, y: e.clientY, target: null, ball: ROOT_BALL, before: null };
          }
        } else {
          if (down.size === 1 && lastRingTap && lastRingTap.chain === ball.id && eventTime(e) - lastRingTap.at <= DOUBLE_TAP_MS && Math.hypot(e.clientX - lastRingTap.x, e.clientY - lastRingTap.y) <= doubleTapDistance(e)) {
            // The second press of a double-click or double-tap: it toggles the pin
            // and is nothing else, so it moves no limb and starts no drag.
            lastRingTap = null;
            pinHeld = e.pointerId;
            togglePin(ball.id);
          } else {
            reaching = ball.id;
            // The press's offset from the effector point the reach is aimed at (the ring is on the middle of the part): kept, so the hand goes by the pointer's travel and nothing jumps.
            const rc = armature.chain(ball.id);
            if (rc && raycaster.ray.intersectPlane(dragPlane, ringGrab)) ringGrab.sub(armature.effectorWorld(rc.effector, grabAt));
            else ringGrab.set(0, 0, 0);
            if (down.size === 1) {
              tap = { id: e.pointerId, x: e.clientX, y: e.clientY, target: null, ball: ball.id, before: null, at: eventTime(e) };
              // Held still, it pins when the time runs out, with the press still down.
              // (A mouse has the double-click; a mouse button held still is not the gesture, and a slow first move of a drag must not be taken for it.)
              cancelPinPress();
              if (e.pointerType !== 'mouse') pinPress = { id: e.pointerId, chain: ball.id, x: e.clientX, y: e.clientY, downAt: eventTime(e), timer: window.setTimeout(pinHeldDown, LONG_PRESS_MS), waits: 0 };
            }
          }
        }
      }
      viewer.setOrbitEnabled(false);
      hovered = null;
      paintHandles();
      viewer.invalidate();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A skinned mesh turns a ray away at its bounding sphere and box before it looks at a triangle, and it
    // works the sphere out once and keeps it: the figure as it stood at the first press. Posed or moved since,
    // whatever had left that first ball (a raised hand, the feet of a leap, the head of a figure moved up)
    // could not be tapped, while the hips and chest near the middle still could. Both are taken afresh for
    // the press, from the figure as it stands.
    armature.mesh.computeBoundingSphere();
    armature.mesh.computeBoundingBox();
    const hit = raycaster.intersectObject(armature.mesh, false)[0];
    picked = hit ? armature.boneAt(hit) : null;
    // Selected when it lifts, if it was a tap; the press goes on to the
    // orbit either way.
    tap = down.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, target: picked, ball: null, before: null } : null;
  };
  const onPointerMove = (e: PointerEvent): void => {
    const t0 = performance.now();
    // A drag's work for the coming frame, for the frame meter.
    const noteWork = (): void => viewer.noteInput(performance.now() - t0, e.timeStamp);
    if (tap && e.pointerId === tap.id && travelled(e)) tap = null;
    if (pinPress && e.pointerId === pinPress.id && Math.hypot(e.clientX - pinPress.x, e.clientY - pinPress.y) > LONG_PRESS_SLOP) cancelPinPress();
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (lightHeld) {
      if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0) && (!lightArmed || lightPointer === e.pointerId)) {
        viewer.lighting.nudgeKey(dx * KEY_DRAG_DEG_PER_PX, -dy * KEY_DRAG_DEG_PER_PX);
        lightMoved();
      }
      claimForLight(e);
      return;
    }
    // The pointer over a handle, no press: it brightens, as a hover does.
    if (!dragUnderway() && e.pointerType !== 'touch') {
      const under = ballUnder(e);
      const name = under ? ballName(under) : null;
      if (name !== hovered) {
        hovered = name;
        paintHandles();
        viewer.invalidate();
      }
    }
    if (aiming) {
      // The target is a point placed in the plane that faces the camera through
      // where it is, under the pointer with the press's offset kept. The knee or
      // elbow turns toward it and the hand or foot never moves. On the limb's own
      // line it has no direction, and the target stays where it was.
      aim(e);
      const target = aims.get(aiming)?.position;
      if (!target) return;
      dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragNormal), target);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      if (tap?.ball && tap.before === null) tap.before = JSON.stringify(armature.serialize());
      if (armature.placePole(aiming, dragPoint.sub(poleGrab))) {
        armature.applyPins();
        syncHandles();
        placeControls();
        refreshPanel();
        scheduleSave();
      }
      e.preventDefault();
      e.stopPropagation();
      noteWork();
      return;
    }
    if (looking) {
      // The pointer's ray meets the plane through the target that faces the
      // camera: the target goes to where it lands, anywhere on the screen,
      // with the handle under the pointer, and the head turns to face it
      // (as far as its limits allow; the target stays where it was put).
      if (tap?.ball && tap.before === null) tap.before = JSON.stringify(armature.serialize());
      aim(e);
      if (raycaster.ray.intersectPlane(dragPlane, lookPoint)) {
        armature.lookAt(lookPoint.sub(lookGrab));
        armature.applyPins(undefined, armature.plantFeet, false);
        syncHandles();
        placeControls();
        refreshPanel();
        scheduleSave();
      }
      e.preventDefault();
      e.stopPropagation();
      noteWork();
      return;
    }
    if (moving) {
      aim(e);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      // Still maybe a tap: what the pose was, should it be one.
      if (tap?.ball && tap.before === null) tap.before = JSON.stringify(armature.serialize());
      const to = dragPoint.sub(moving.from).add(moving.root);
      armature.root.position.copy(armature.root.parent ? armature.root.parent.worldToLocal(to) : to);
      // As the gizmo's own change does: the pins re-solved, the feet
      // planted when planting is on.
      afterGizmo(null);
      placeControls();
      e.preventDefault();
      e.stopPropagation();
      noteWork();
      return;
    }
    if (!reaching) return;
    aim(e);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    // Still maybe a tap: what the pose was, should it be one.
    if (tap?.ball && tap.before === null) tap.before = JSON.stringify(armature.serialize());
    armature.reach(reaching, dragPoint.sub(ringGrab));
    armature.repin(reaching);
    armature.applyPins(reaching);
    syncHandles();
    placeControls();
    refreshPanel();
    scheduleSave();
    e.preventDefault();
    e.stopPropagation();
    noteWork();
  };
  const onPointerUp = (e: PointerEvent): void => {
    down.delete(e.pointerId);
    if (lightArmed && lightPointer === e.pointerId) {
      armLight(false);
      claimForLight(e);
      return;
    }
    // A long press whose timer a busy page had not run by the lift: the events' own
    // times say it was one, and it pins now.
    if (pinPress && e.pointerId === pinPress.id) {
      const press = pinPress;
      cancelPinPress();
      if (e.type === 'pointerup' && eventTime(e) - press.downAt >= LONG_PRESS_MS) longPin(press);
    }
    if (pinHeld === e.pointerId) {
      // The lift of a press that pinned: no tap, no selection, no drag.
      pinHeld = -1;
      const held = heldPress;
      heldPress = null;
      if (held && e.type === 'pointerup' && eventTime(e) - held.downAt < LONG_PRESS_MS) {
        // The timer ran first on a busy page: by the events' own times this was a tap. The pin goes back, with its step.
        armature.setPinned(held.chain, held.was);
        dropStep();
        selectHandle(held.chain);
        lastRingTap = { chain: held.chain, at: held.downAt, x: held.x, y: held.y };
      }
      tap = null;
      reaching = null;
      viewer.setOrbitEnabled(true);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Never captured (synthetic events): nothing to release.
      }
      paintHandles();
      viewer.invalidate();
      return;
    }
    let tapped: typeof tap = null;
    if (tap && e.pointerId === tap.id) {
      if (e.type === 'pointerup' && !travelled(e)) tapped = tap;
      tap = null;
    }
    // A tap on a part or on empty space: that part selected, or nothing.
    if (tapped && !tapped.ball) select(tapped.target);
    if (!reaching && !aiming && !moving && !looking) return;
    reaching = null;
    aiming = null;
    moving = null;
    if (looking) {
      looking = false;
      armature.endLook();
    }
    viewer.setOrbitEnabled(true);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Never captured (synthetic events): nothing to release.
    }
    if (tapped?.ball) {
      // A tap on an IK ball: the pose as it was at the press, and the ball selected.
      if (tapped.before !== null) {
        armature.restore(JSON.parse(tapped.before) as ArmatureState);
      }
      // A tap on the hips' box selects the hips, with the move and the turn gizmo; any other, its handle.
      if (tapped.ball === ROOT_BALL) select(armature.root.name);
      else {
        selectHandle(tapped.ball);
        // A tap on a ring: a second one close to it pins the hand or foot.
        if (handles.has(tapped.ball) && tapped.at !== undefined) lastRingTap = { chain: tapped.ball, at: tapped.at, x: tapped.x, y: tapped.y };
      }
    } else {
      commit();
    }
    // Back to neutral: the handle is no longer in hand.
    paintHandles();
    viewer.invalidate();
    flushPanel();
  };
  listen(canvas, 'pointerdown', onPointerDown, true);
  listen(canvas, 'pointermove', onPointerMove, true);
  listen(window, 'pointerup', onPointerUp, true);
  // A second finger anywhere on the page cancels a long press waiting on the first.
  listen(window, 'pointerdown', (e) => {
    if (pinPress && e.pointerId !== pinPress.id) cancelPinPress();
  }, true);
  listen(window, 'pointercancel', onPointerUp, true);

  // --- history + autosave ----------------------------------------------------
  /**
   * Undo (owner request: as in Sculpt, the same keys and buttons): each
   * entry is the figure as it stood - its state and symmetry, the figure's
   * id among them - before a change: a drag's end (a gizmo, a ball, the
   * root's ball: one step a drag, never one a frame), a pin, Plant feet, a
   * reset, a mirror, symmetry, a change of figure, and a panel slider once
   * it rests (SLIDER_SETTLE_MS) or is let go. HISTORY_LIMIT steps are kept;
   * New, Open, Load model and an opened project start it over.
   */
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const snap = (): string => JSON.stringify({ s: armature.serialize(), y: armature.symmetry });
  let last = snap();
  /** A slider's step, waiting for the slider to rest. */
  let pendingStep = 0;
  /** An undo or redo putting a state back: what it does is not a step of its own. */
  let stepping = false;
  const commit = (): void => {
    if (pendingStep) {
      clearTimeout(pendingStep);
      pendingStep = 0;
    }
    if (stepping) return;
    const now = snap();
    if (now === last) return;
    undoStack.push(last);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    last = now;
    scheduleSave();
    histButtons.refresh();
  };
  /** A panel slider moved: its step is taken once it rests, so a drag of it is one. */
  const commitSoon = (): void => {
    if (pendingStep) clearTimeout(pendingStep);
    pendingStep = window.setTimeout(commit, SLIDER_SETTLE_MS);
    histButtons.refresh();
  };
  /** Start the history over, from the figure as it stands. */
  /** The newest step of the history forgotten, with the state as it now stands taken as the one it left. */
  const dropStep = (): void => {
    undoStack.pop();
    last = snap();
    histButtons.refresh();
  };
  const clearHistory = (): void => {
    if (pendingStep) clearTimeout(pendingStep);
    pendingStep = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    last = snap();
    histButtons.refresh();
  };
  const applyState = async (json: string): Promise<void> => {
    const { s: state, y: symmetry } = JSON.parse(json) as { s: ArmatureState; y: boolean };
    stepping = true;
    try {
      // A step across a change of figure puts that figure back too.
      if (state.preset !== armature.rig.id) await replaceFigure(state.preset, state);
      else armature.restore(state);
      armature.symmetry = symmetry;
    } finally {
      stepping = false;
    }
    last = snap();
    // Also syncs the handles and the panel.
    if (selectedHandle) selectHandle(selectedHandle, handleGizmo);
    else select(selected);
    panel.syncFigure();
    scheduleSave();
    histButtons.refresh();
  };
  const undo = (): void => {
    if (stepping) return;
    commit(); // a slider's step still resting is the one to undo
    const prev = undoStack.pop();
    if (prev === undefined) return;
    redoStack.push(last);
    void applyState(prev);
  };
  const redo = (): void => {
    if (stepping) return;
    commit();
    const next = redoStack.pop();
    if (next === undefined) return;
    undoStack.push(last);
    void applyState(next);
  };
  // The page's shell (studio/Studio.ts) is the host's: the title strip, the four menus, the edge
  // column with the undo and redo buttons, the details overlay, the Material and Reference panels
  // and the page's one reference board.
  const strip = studio.strip;
  const histButtons = studio.edge.history;
  const referenceBoard = studio.reference.board;
  const referenceView = studio.reference.view;

  /**
   * The gallery card's picture. It is taken on the way out, and carried by
   * every save in between: the autosave writes its record whole, and a
   * record written without it would leave the card blank again.
   */
  let thumb: Blob | null = saved?.thumb instanceof Blob ? saved.thumb : null;
  const currentFile = (): ArmatureFile => ({
    kind: 'bozzetto-armature',
    v: 1,
    name,
    state: armature.serialize(),
    look: viewer.getLook(),
    savedAt: Date.now(),
    ...(model ? { model: model.bytes, modelName: model.name } : {}),
    ...(thumb ? { thumb } : {}),
    ...(link ? { project: { ...link } } : {}),
    ...(link && syncedAt === edits ? { synced: true } : {}),
    symmetry: armature.symmetry,
    units: UNITS,
  });
  /** The library project Save to library writes to (project.ts), kept in the autosave record. */
  let link: ArmatureLink | null = bootLink;
  /**
   * Edits made so far, and the count the armature was last saved to its
   * project at (-1 for none): while they agree, it is the project's as
   * saved (ArmatureFile.synced).
   */
  let edits = 0;
  let syncedAt = bootSynced ? 0 : -1;
  let saveTimer = 0;
  const flushSave = async (): Promise<void> => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    // Saving off (ui/deviceStorage): nothing is written.
    if (!mayStore()) return;
    await saveArmature(currentFile());
  };
  const scheduleSave = (edit = true): void => {
    if (edit) edits++;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), SAVE_GAP_MS);
  };
  // Turned on from Preferences: the figure as it stands is kept straight away.
  subscribe(() =>
    onDeviceChoice((c) => {
      if (c === 'keep') scheduleSave(false);
    }),
  );
  /**
   * Picture the figure for the gallery card, as sculpt mode does its work,
   * and save it with the rest. The balls, the gizmo and the selection wash
   * stay out of the picture: they are the tool, not the figure. `smooth`
   * false (a page on its way out) takes it in one render, not sixteen: the
   * card is drawn down to a quarter of the canvas's width or less, which
   * smooths its edges about as much.
   */
  const snapshot = async (smooth = true): Promise<void> => {
    await capture(smooth);
    await flushSave();
  };
  /** The picture alone: the card's, and a library project's thumbnail. Null when none could be had. */
  const capture = async (smooth = true): Promise<Blob | null> => {
    const overlays: Object3D[] = [handleGroup, plantGroup, ...controls.map((tc) => tc.getHelper())];
    if (highlight) overlays.push(highlight);
    const shown = overlays.map((o) => o.visible);
    for (const o of overlays) o.visible = false;
    // A held, smoothed view still has them in it: the picture starts over.
    viewer.invalidate();
    try {
      // The gallery's 4:5 portrait at its one size, as every card's picture is.
      thumb = await viewer.captureThumbnail(undefined, smooth);
      return thumb;
    } catch {
      // Never block leaving the page over a picture.
      return null;
    } finally {
      overlays.forEach((o, i) => (o.visible = shown[i]));
      // The handles are back: the picture changed without a setter.
      viewer.invalidate();
    }
  };
  const onLookEdit = (e: Event): void => {
    // A panel control in hand: no rebuild of the panel under it.
    clearTimeout(lightSyncTimer);
    scheduleSave();
    // An Armature slider let go (or a value typed): its step is taken now.
    if (e.type === 'change' && pendingStep && (e.target as Element | null)?.closest?.('.panel--armature')) commit();
  };
  listen(document, 'input', onLookEdit);
  listen(document, 'change', onLookEdit);
  // Leaving some other way - a reload, a closed tab: the record is saved at
  // once, and the picture follows if the page lives long enough to take it
  // (a page on its way out may never draw another frame).
  const onHidden = (): void => {
    void flushSave();
    void snapshot(false);
  };
  listen(window, 'pagehide', onHidden);
  // File > Close: the armature is pictured and written, then the page does what it does on its way
  // out (its scene written, the gallery next).
  const leaveForGallery = (): void => {
    void snapshot().finally(() => host.leaveForGallery());
  };
  // --- the figure: presets and files ----------------------------------------------
  /**
   * Swap the figure: a different preset, a file being opened, or a fresh
   * start. Without a state the new figure keeps where the old one stood -
   * changing preset should not move it - unless `fresh`, which leaves it
   * standing on the rig's own rest position, feet on the ground.
   */
  const replaceFigure = async (preset: string, state?: ArmatureState, fresh = false): Promise<void> => {
    // A mannequin not yet seen this session is fetched first; the figure
    // on screen stays until it has arrived, and stays for good if it
    // cannot.
    const info = figureById(preset);
    if (info && !figureReads.has(preset)) {
      panel.setNote(`Fetching the ${info.label.toLowerCase()}…`);
      try {
        await ensureFigure(preset);
      } catch (err) {
        console.warn(err);
        panel.setNote(`The ${info.label.toLowerCase()} could not be fetched. Offline, perhaps; a mannequin is kept once seen.`);
        panel.syncFigure();
        return;
      }
      panel.setNote('');
    }
    select(null);
    viewer.removeSculptExtra(armature.mesh);
    const placement = armature.placement();
    const symmetry = armature.symmetry;
    const plant = armature.plantFeet;
    const pinned = armature.chains().filter((c) => armature.isPinned(c.id)).map((c) => c.id);
    armature.dispose();
    armature = figureFor(preset);
    holdFloor();
    armature.symmetry = symmetry;
    if (state) {
      armature.restore(state);
    } else if (fresh) {
      armature.pinFeet();
    } else {
      // The new figure stands where the old one stood, with the same
      // handles pinned - each taken where the new figure's hand or foot is,
      // now that it has been placed - and planting as it was. Its feet go
      // on the floor (owner call): where the old one stood across the floor
      // and which way it faced, not how high.
      placement.position.y = 0;
      armature.setPlacement(placement);
      armature.plantFeet = plant;
      for (const id of pinned) armature.setPinned(id, true);
      // Where the figure now stands, the head looks straight ahead again.
      armature.placeLook();
    }
    viewer.adoptMesh(armature.mesh);
    viewer.setSculptAlbedo(armature.mesh, host.mannequinAlbedo());
    if (suspended) armature.mesh.visible = figureShown;
    measureSkinPad();
    buildHandles();
    syncHandles();
    panel.syncFigure();
    commit();
  };
  /**
   * Open a file: an .armature (file.ts), or a library project's
   * armature.json, gzipped or not, as My projects' Download or the export
   * hands one out - read through the same sanitiser as an opened project.
   * Either way it is a file, not a project: Save to library makes one anew.
   */
  const openFile = async (file: File): Promise<void> => {
    let parsed: ArmatureFile;
    let symmetry: boolean | null = null;
    let notice: string | null = null;
    try {
      const text = await armatureText(await file.arrayBuffer());
      let rec: unknown = null;
      try {
        rec = JSON.parse(text);
      } catch {
        // Not JSON at all: unpackArmature says so in its own words.
      }
      if (isProjectRecord(rec)) {
        const read = readArmatureProject(text);
        parsed = read.file;
        symmetry = read.symmetry;
        notice = read.notice;
      } else {
        parsed = unpackArmature(text);
      }
      parsed = onCentimetres(parsed);
    } catch (err) {
      void tellWindow({ title: 'That file did not open', text: err instanceof ArmatureFileError || err instanceof Error ? err.message : String(err) });
      return;
    }
    name = parsed.name !== 'Armature' ? parsed.name : await newSceneName();
    await replaceFigure(parsed.state.preset, parsed.state);
    if (symmetry !== null) armature.symmetry = symmetry;
    panel.refresh(selected);
    // Said after the swap, whose fetch of a mannequin clears the note.
    if (notice) panel.setNote(notice);
    if (parsed.look) {
      await viewer.applyLook(parsed.look);
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    }
    frame();
    link = null;
    syncedAt = -1;
    clearHistory();
    scheduleSave();
  };
  /**
   * Take a rigged .glb as the figure: the bones become the rig, the skin
   * becomes the shape. What the file does not say - a joint's limits, which
   * bones a hand reaches on - is worked out and reported, so a model
   * exported without the custom properties is stiff rather than broken.
   */
  const loadModel = async (file: File): Promise<void> => {
    const bytes = await file.arrayBuffer();
    let read: ReturnType<typeof rigFromGLTF>;
    try {
      read = await parseModel(bytes);
    } catch (err) {
      void tellWindow({ title: 'That model could not be read', text: err instanceof Error ? err.message : String(err) });
      return;
    }
    model = { bytes, name: file.name };
    name = file.name.replace(/\.(glb|gltf)$/i, '') || 'Model';
    await replaceFigure(IMPORTED, undefined, true);
    frame();
    // Another figure altogether: its own history, and no project yet (the
    // library keeps the built-in figures; a model stays on this device).
    link = null;
    syncedAt = -1;
    clearHistory();
    if (read.inferred.length) {
      console.info(`armature: ${read.inferred.join('; ')}`);
    }
    panel.setNote(
      read.inferred.length
        ? `${file.name}: ${read.inferred.join('; ')}.`
        : `${file.name}: ${read.rig.bones.length} bones, ${read.rig.ik.length} reach chains.`,
    );
  };

  /**
   * Remesh to a figure (the page's: it holds the scene the figure joins), from this tab. The
   * posed mannequin is baked by `bake`; the page prices it, voxelises it into an object named
   * "Figure" in one undo step and says if the device cannot take the resolution. Nothing changes
   * page, and the armature stays as it is.
   */
  const remesh = async (resolution: number): Promise<void> => {
    if (remeshing) return;
    remeshing = true;
    try {
      await host.remesh(resolution);
    } finally {
      remeshing = false;
      panel.setFigureMade(host.figureMade());
    }
  };
  let remeshing = false;

  /**
   * Turn a joint by hand, as its sliders do: clamped, taken as its limb's
   * aim, the pins re-solved around it - all but a foot's own planting,
   * since standing it flat again would undo the turn.
   */
  const turnJoint = (bone: string, xyz: [number, number, number], slider = false): void => {
    armature.setPoseEuler(bone, xyz[0], xyz[1], xyz[2]);
    armature.followAims(bone);
    const byHand = armature.isLookBone(bone);
    if (byHand) armature.carryLook();
    armature.applyPins(undefined, armature.plantFeet && !armature.isFoot(bone), !byHand);
    placeControls();
    syncHandles();
    // A slider's drag is one step, taken when it rests (commitSoon).
    if (slider) commitSoon();
    else commit();
  };

  // --- the panel --------------------------------------------------------------------
  const panel = new ArmaturePanel(
    () => armature,
    {
      preset: (id) => void replaceFigure(id),
      symmetry: (on) => {
        armature.symmetry = on;
        commit();
      },
      resetPose: () => {
        armature.resetPose();
        select(selected);
        commit();
      },
      mirror: (from) => {
        armature.mirrorPose(from);
        armature.applyPins();
        select(selected);
        commit();
      },
      joint: (bone, xyz) => turnJoint(bone, xyz, true),
      proportions: (bone, p) => {
        armature.setProportions(bone, p);
        armature.applyPins();
        placeControls();
        syncHandles();
        commitSoon();
      },
      handles: (on) => {
        handlesOn = on;
        // A hidden ball cannot stay selected.
        if (!on && selectedHandle) select(null);
        syncHandles();
      },
      pin: (id, on) => {
        armature.setPinned(id, on);
        syncHandles();
        commit();
      },
      plant: (on) => {
        armature.plantFeet = on;
        // On, it takes hold at once: the feet on the ground stand flat, the
        // pinned ones keeping their marks. Off, nothing moves.
        if (on) armature.applyPins();
        placeControls();
        syncHandles();
        commit();
      },
      aim: (id, degrees) => {
        armature.aimChain(id, degrees);
        armature.applyPins();
        placeControls();
        syncHandles();
        commitSoon();
      },
      resetProportions: () => {
        for (const bone of armature.boneNames()) armature.setProportions(bone, { size: 1, length: 1 }, false);
        armature.applyPins();
        placeControls();
        syncHandles();
        commit();
      },
      remesh: (resolution) => void remesh(resolution),
    },
    viewer,
    host.figure,
  );
  panel.setFigureMade(host.figureMade());
  // The Material tab beside Armature's, and the Reference panel and board, are the page's: one
  // of each, the same pictures in every workspace.
  // What an opened project needed mending, or why it did not open: said
  // now that there is a page to say it on.
  for (const note of bootNotes) {
    panel.setNote(note);
    statusToast('').fail(note);
  }
  // An opened project is the work on this device now: the autosave says so at once.
  if (bootSymmetry !== null) scheduleSave(false);

  // --- menus -------------------------------------------------------------------------
  const openInput = document.createElement('input');
  openInput.type = 'file';
  openInput.accept = '.armature,.json,.gz,application/json,application/gzip';
  openInput.hidden = true;
  openInput.addEventListener('change', () => {
    const f = openInput.files?.[0];
    openInput.value = '';
    if (f) void openFile(f);
  });
  document.body.appendChild(openInput);
  const modelInput = document.createElement('input');
  modelInput.type = 'file';
  modelInput.accept = '.glb,.gltf,model/gltf-binary';
  modelInput.hidden = true;
  modelInput.addEventListener('change', () => {
    const f = modelInput.files?.[0];
    modelInput.value = '';
    if (f) void loadModel(f);
  });
  document.body.appendChild(modelInput);
  // --- the library ---------------------------------------------------------------
  // Save to library, as Sculpt's (owner request): for whoever saves to a
  // server here - the owner's Projects with accounts off, the account's own
  // My projects with them on - an armature project (project.ts), created
  // once and then updated in place; for a guest, the .armature download
  // Save is. Who the page is for comes from the sign-in probe, asked once.
  let role: Role | null = null;
  let accountsHere = false;
  let suspension = '';
  const probeRole = async (): Promise<Role> => {
    try {
      const answer = await checkSignIn();
      role = roleOf(answer);
      accountsHere = answer.accounts === true;
      suspension = answer.suspended ? suspensionText(answer.suspended.reason) : '';
    } catch {
      role = 'guest';
    }
    return role;
  };
  /** The File menu's rows depend on who is here: the shell reads them again. */
  const refreshFileMenu = (): void => studio.refreshMenus();
  let roleKnown = probeRole().then((who) => {
    refreshFileMenu();
    return who;
  });
  /** The project this armature is, if it is one, goes to the top of the recent list: opened, or saved to. */
  const noteOpened = (): void => {
    if (link) recordRecent({ id: link.id, kind: 'armature', name: link.title, place: place(), ...(link.scope ? { scope: link.scope } : {}) });
  };
  void roleKnown.then(noteOpened);
  /** Whether Save to library goes to a server for `who`, as Sculpt's File menu decides it. */
  const uploads = (who: Role): boolean =>
    who === 'owner' || who === 'expired' || (accountsHere && (who === 'member' || who === 'moderator'));
  const place = (): string => (accountsHere && link?.scope !== 'admin' ? 'My projects' : 'Projects');
  const libraryHint = (): string => {
    if (role === 'expired') return 'Your sign-in has expired: sign in again to save';
    if (role === 'suspended') return 'Your account is suspended: downloads a .armature file to keep';
    if (!role || !uploads(role)) return 'Downloads a .armature file to keep';
    if (link) return `Updates "${link.title}" in ${place()}`;
    return accountsHere ? 'Saves to My projects, where only you see it' : 'Uploads to Projects, as a private armature';
  };
  let librarySaving = false;
  const saveToLibrary = async (): Promise<ArmatureLink | null> => {
    const who =
      role ??
      (await Promise.race([roleKnown, new Promise<Role>((ok) => window.setTimeout(() => ok('guest'), ROLE_WAIT_MS))]));
    if (!uploads(who)) {
      downloadBlob(packArmature(currentFile()), armatureStamp());
      if (who === 'suspended') statusToast('').fail(`${suspension} The armature was saved as a .armature file instead.`);
      else studio.menus.file.note('Saved as a .armature file');
      return null;
    }
    const where = place();
    if (armature.rig.id === IMPORTED) {
      statusToast('').fail(`A model loaded from a file stays on this device: ${where} keeps the built-in figures. Save keeps a .armature file.`);
      return null;
    }
    if (librarySaving) {
      studio.menus.file.note(`Already saving to ${where}`);
      return null;
    }
    librarySaving = true;
    const status = statusToast(`Saving to ${where}...`);
    try {
      const at = edits;
      const picture = await capture(true);
      const bytes = await encodeArmatureProject(currentFile(), armature.symmetry);
      const target = link;
      const saved = await uploadArmature(
        { bytes, title: target?.title ?? defaultArmatureTitle(name), thumb: picture ?? undefined, projectId: target?.id, scope: target?.scope },
        (text) => status.set(text),
      );
      link = saved;
      name = saved.title;
      syncedAt = at;
      noteOpened();
      await flushSave();
      status.done(`Saved to ${where}: ${saved.title}`);
      return saved;
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        // Signed in again in the dialog, the save goes again by itself.
        const again = signInButton(
          '',
          (ok) => {
            if (!ok) return;
            roleKnown = probeRole().then((who) => {
              refreshFileMenu();
              return who;
            });
            void roleKnown.then(() => saveToLibrary());
          },
          'Sign in again',
          accountsHere ? 'session' : err.via,
        );
        status.fail('Your sign-in has expired. The armature is still here.', again);
      } else {
        status.fail(`Not saved to ${where}: ${failureText(err).replace(/\.$/, '')}. The armature is still here; Save keeps a .armature file.`);
      }
      return null;
    } finally {
      librarySaving = false;
    }
  };

  /** Give the armature a new name; a project's is renamed too, and saved with the next Save to library. */
  const rename = (next: string): void => {
    const n = next.trim().slice(0, 80);
    if (!n || n === name) return;
    name = n;
    if (link) link = { ...link, title: n };
    scheduleSave();
  };
  strip.onRename = rename;
  /** Save to library for anyone who has an account or the owner's access; for a guest, the way in where the site has accounts, and nothing where it has none. */
  const libraryItems = (): MenuItem[] => {
    // Until the sign-in has answered, nobody is known to be here: the menu shows what a guest's does.
    if (role === null || role === 'guest') {
      if (!accountsHere) return [];
      return [
        {
          label: 'Sign in to save to library',
          action: async () => {
            if (!(await signInAgain(undefined, 'Sign in to save to the library.'))) return;
            roleKnown = probeRole().then((who) => {
              refreshFileMenu();
              return who;
            });
            await roleKnown;
          },
        },
      ];
    }
    return [{ label: 'Save to library', hint: libraryHint, key: keyFor('arm.save'), action: () => void saveToLibrary() }];
  };
  /** The Save key (Ctrl+S), as Sculpt's: Save to library for whoever saves to one; for a guest the copy on this device, written at once. */
  const saveKey = async (): Promise<void> => {
    if (role !== null && role !== 'guest') {
      await saveToLibrary();
      return;
    }
    if (!mayStore()) {
      studio.menus.file.note('Saving on this device is off. File, Save file keeps this work.');
      return;
    }
    await flushSave();
    studio.menus.file.note('Kept on this device');
  };
  const fileItems = (): MenuItem[] =>
    fileMenuItems({
      start: [
        {
          label: 'New armature',
          action: async () => {
            if (
              undoStack.length &&
              !(await askWindow({
                title: 'Start a new armature?',
                text: 'The current pose and proportions go.',
                yes: 'Start new',
                danger: true,
              }))
            ) {
              return;
            }
            name = 'Armature';
            // A new armature is nobody's project, with a history of its own.
            link = null;
            syncedAt = -1;
            void newSceneName().then((fresh) => {
              name = fresh;
              return replaceFigure(armature.rig.id, undefined, true).then(() => {
                frame();
                clearHistory();
                scheduleSave();
              });
            });
          },
        },
        { label: 'Open…', action: () => openInput.click() },
        recentMenuItem(() => undoStack.length > 0),
      ],
      save: [
        {
          label: 'Rename…',
          action: async () => {
            const next = await askText({ title: 'Rename', label: 'Name', value: name, yes: 'Rename' });
            if (next !== null) rename(next);
          },
        },
        { label: 'Save file', action: () => downloadBlob(packArmature(currentFile()), armatureStamp()) },
        ...libraryItems(),
      ],
      transfer: [
        { label: 'Load model…', action: () => modelInput.click() },
        { label: 'Remesh to a figure', hint: 'Makes a figure from the posed mannequin, in this scene', action: () => void remesh(host.figure.resolution) },
      ],
      close: leaveForGallery,
    });
  const editItems = (): MenuItem[] =>
    editMenuItems({
      mode: 'armature',
      history: [
        { label: 'Undo', key: keyFor('arm.undo'), action: undo },
        { label: 'Redo', key: keyFor('arm.redo'), action: redo },
      ],
      own: [{ label: 'Paste picture', hint: 'Adds the clipboard\'s picture to the Reference panel', action: () => void pasteFromClipboard(referenceBoard) }],
    });
  const viewItems = (): MenuItem[] =>
    viewMenuItems({
      frameAll: frame,
      wireframe: {
        get: () => viewer.isWireframe(),
        toggle: () => {
          viewer.toggleWireframe();
          window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
        },
      },
      shadows: {
        get: () => viewer.lighting.getShadowsMaster(),
        toggle: () => {
          viewer.lighting.setShadowsMaster(!viewer.lighting.getShadowsMaster());
          window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
        },
      },
      details: true,
      referenceShow: { get: () => referenceView.isShown(), toggle: () => referenceView.setShown(!referenceView.isShown()) },
      referenceArrange: { get: () => referenceBoard.isArranging(), toggle: () => referenceBoard.setArranging(!referenceBoard.isArranging()) },
      panels: [
        ['armature', 'Armature'],
        ['material', 'Material'],
        ['reference', 'Reference'],
      ],
      moveLight: { get: () => lightArmed, toggle: () => armLight(!lightArmed) },
      hideInterface: () => studio.chrome.set(true),
      workspace: () => studio.way(),
      workspaceKeys: true,
    });
  /** The figure's facts for the details overlay. */
  const detailLines = (): DetailLine[] => {
    const lines: DetailLine[] = [{ id: 'name', value: link?.title ?? name }];
    lines.push({ id: 'height', key: 'Height', value: formatLength(armature.figureHeight()) });
    const index = armature.mesh.geometry.getIndex();
    if (index) lines.push({ id: 'tris', key: 'Tris', value: Math.round(index.count / 3).toLocaleString('en-US') });
    const handle = selectedHandle ? armature.chains().find((c) => c.id === selectedHandle) : undefined;
    if (selected) lines.push({ id: 'selected', key: 'Joint', value: prettyName(selected) });
    else if (handle) lines.push({ id: 'selected', key: 'Handle', value: handle.label });
    if (armature.symmetry) lines.push({ id: 'symmetry', key: 'Symmetry', value: 'on' });
    return lines;
  };
  // The workspace the page's shell hosts: it asks for the menus, the readout (the armature's
  // name and where its work is kept; the figure's numbers are the details overlay's), the
  // history (Armature's own steps, until there is one history), the details and the panels.
  // Its enter and leave are resume and suspend of its own things (the shell's own put away apart,
  // below). The path is the shell's: every other workspace is one `go` away.
  const workspace: Workspace = {
    id: 'armature',
    keyMode: 'armature',
    menus: () => ({ file: fileItems(), edit: editItems(), view: viewItems() }),
    path: () => ({}),
    panels: { left: [panel], right: [] },
    readout: () => ({
      name: link?.title ?? name,
      state: sceneStateWord({ linked: !!link, synced: !!link && syncedAt === edits }),
    }),
    details: detailLines,
    history: {
      undo,
      redo,
      canUndo: () => undoStack.length > 0 || pendingStep !== 0,
      canRedo: () => redoStack.length > 0,
    },
    // A handle or a gizmo in hand is let go of first: the switch waits for the drag to end.
    mayLeave: () => !dragUnderway(),
    enter: () => resumeOwn(),
    leave: () => suspendOwn({ figure: host.figureMade() ? 'hide' : 'show' }),
    // Signing in again and reloading onto an update leave the page and come back (ui/leaving):
    // the figure is saved and pictured first, as leaving for the gallery does.
    beforeLeavingPage: async () => {
      await snapshot();
      return true;
    },
  };
  // The pieces of the page the panel put there: what suspend takes out of sight.
  const ownedDom = addedToPage();

  // --- keys ------------------------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (document.body.classList.contains('has-modal')) return;
    if (isTextEntryTarget(e)) {
      // Save is the one key that also works from a text field: the browser's own answer to it is to save the page.
      if (keymap.actionFor(e, 'armature')?.id === 'arm.save') {
        e.preventDefault();
        e.stopPropagation();
        void saveKey();
      }
      return;
    }
    if (lightArmed && e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.bz-menuname.is-open')) {
      armLight(false);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const action = keymap.actionFor(e, 'armature');
    if (!action) return;
    // Tab (ui.chrome) is not Armature's: it falls through to the viewer's
    // handler, which closes the panels (this one and the others
    // alike), then hides the interface, then brings it back - as in Sculpt.
    switch (action.id) {
      case 'arm.symmetry':
        armature.symmetry = !armature.symmetry;
        panel.refresh(selected);
        commit();
        break;
      case 'arm.move':
        // On a selected handle: its move gizmo. Otherwise the figure's, on the pelvis.
        if (selectedHandle) {
          selectHandle(selectedHandle, true);
          break;
        }
        gizmoMode = 'translate';
        select(armature.root.name);
        break;
      case 'arm.rotate':
        gizmoMode = 'rotate';
        select(selected ?? armature.root.name);
        break;
      case 'arm.gizmo':
        gizmoMode = 'all';
        select(selected ?? armature.root.name);
        break;
      case 'arm.scale':
        // A part's own: with none selected (or a ball) it does nothing.
        if (!selected) break;
        gizmoMode = 'scale';
        select(selected);
        break;
      case 'arm.resetPose':
        armature.resetPose();
        select(selected);
        commit();
        break;
      case 'arm.deselect':
        select(null);
        // Esc is also the way back from a hidden interface (ui.show); claimed
        // here, it would never reach the toggle's own listener.
        if (isShowKey(e)) studio.chrome.set(false);
        break;
      case 'arm.save':
        void saveKey();
        break;
      case 'arm.undo':
        undo();
        break;
      case 'arm.redo':
        redo();
        break;
      case 'arm.send':
        void remesh(host.figure.resolution);
        break;
      case 'arm.light':
        lightHeld = true; // until its keyup (onKeyUp), or the window losing focus
        break;
      case 'view.frame':
      case 'view.frameAll':
        frame();
        break;
      default:
        return; // the viewer's own handler takes the rest
    }
    e.preventDefault();
    e.stopPropagation();
  };
  listen(window, 'keydown', onKey, true);
  // A held key ends on its own key, whatever the modifiers are doing now.
  const onKeyUp = (e: KeyboardEvent): void => {
    if (keymap.holdActionForKeyUp(e, 'armature')?.id === 'arm.light' && !lightArmed) lightHeld = false;
  };
  listen(window, 'keyup', onKeyUp, true);
  // Losing the window eats the keyup (an app switch with L down): without
  // this every press after it would still go to the light.
  const onBlur = (): void => {
    lightHeld = false;
    lightArmed = false;
  };
  listen(window, 'blur', onBlur);

  // --- suspend and resume ----------------------------------------------------------
  const hiddenDom = new Hidden();
  /** The scene things that are the tool's, not the figure's, in the state they should be in while shown. */
  const overlayShown = (): Array<[Object3D, boolean]> => [
    [handleGroup, handlesOn],
    [plantGroup, true],
    ...controls.map((tc): [Object3D, boolean] => [tc.getHelper(), attached.has(tc)]),
    ...(highlight ? ([[highlight, true]] as Array<[Object3D, boolean]>) : []),
  ];
  /**
   * Armature's own things out of sight and hearing, the viewer given back: what the workspace's
   * `leave` does. The shell's (strip, menus, edge column, details, the shared panels) is not
   * Armature's to put away while another workspace is in front, and stays.
   */
  const suspendOwn = (opts: SuspendOptions = {}, quiet = false): void => {
    figureShown = opts.figure === 'show';
    if (suspended) {
      armature.mesh.visible = figureShown;
      viewer.invalidate();
      return;
    }
    // What is in hand is let go: a drag that never gets its pointer-up, a held key.
    for (const tc of controls) {
      if (tc.dragging) (tc as unknown as { pointerUp(p: { button: number }): void }).pointerUp({ button: 0 });
    }
    if (reaching !== null || aiming !== null || moving !== null || looking) {
      reaching = aiming = moving = null;
      if (looking) {
        looking = false;
        armature.endLook();
      }
      viewer.setOrbitEnabled(true);
    }
    down.clear();
    tap = null;
    hovered = null;
    lightHeld = lightArmed = false;
    lightPointer = -1;
    // The timers' work is done now: a slider's step taken, the save written, the light's panel caught up.
    if (pendingStep) commit();
    if (saveTimer) void flushSave();
    if (lightSyncTimer) {
      clearTimeout(lightSyncTimer);
      lightSyncTimer = 0;
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    }
    for (const sub of subscriptions) sub.stop();
    suspended = true;
    for (const [o] of overlayShown()) o.visible = false;
    armature.mesh.visible = figureShown;
    hiddenDom.hide(ownedDom.filter((el) => el.isConnected));
    needs.undo();
    if (!quiet) announce('sculpt');
    viewer.invalidate();
  };
  /** Put its own things back as they were left: what the workspace's `enter` does. */
  const resumeOwn = (quiet = false): void => {
    if (!suspended) return;
    needs.apply();
    hiddenDom.show();
    suspended = false;
    armature.mesh.visible = true;
    for (const [o, shown] of overlayShown()) o.visible = shown;
    for (const sub of subscriptions) sub.start();
    // The canvas may have a different size than it had; the shaders measure their pixels against it.
    placeViewport();
    syncPlantMarks();
    fitStage();
    if (!quiet) announce('armature');
    viewer.invalidate();
  };
  /**
   * The whole page's Armature put away, the shell with it: the page has no other workspace to
   * show (the tests' hook, and what step B built). A page that hosts several switches by the
   * shell's `go`, which asks the workspaces' leave and enter and leaves the shell showing.
   */
  const suspend = (opts: SuspendOptions = {}): void => {
    suspendOwn(opts, true);
    studio.sleep();
  };
  const resume = (): void => {
    studio.wake();
    resumeOwn(true);
  };
  /** The figure was made (or its remesh undone): outside Armature the mannequin goes, or comes back. */
  const showOutside = (shown: boolean): void => {
    figureShown = shown;
    if (!suspended) return;
    armature.mesh.visible = shown;
    viewer.invalidate();
  };
  /**
   * The posed figure's box for the shadow fit, read once a frame while it is drawn: the bones' box
   * grown by how far the skin reaches past the bones, measured when the figure is built (the exact
   * box skins every vertex, which a frame cannot afford; the viewer's own fit does the same for a
   * skinned subject).
   */
  const bonesBox = new Box3();
  const bonePoint = new Vector3();
  let skinPad = 0;
  const readBones = (): boolean => {
    bonesBox.makeEmpty();
    const bones = armature.skeleton.bones;
    if (!bones.length) return false;
    armature.root.updateWorldMatrix(true, true);
    for (const bone of bones) bonesBox.expandByPoint(bonePoint.setFromMatrixPosition(bone.matrixWorld));
    return !bonesBox.isEmpty();
  };
  const measureSkinPad = (): void => {
    skinPad = 0;
    if (!readBones()) return;
    const exact = armature.bounds();
    skinPad = Math.max(0, exact.max.x - bonesBox.max.x, exact.max.y - bonesBox.max.y, exact.max.z - bonesBox.max.z, bonesBox.min.x - exact.min.x, bonesBox.min.y - exact.min.y, bonesBox.min.z - exact.min.z);
  };
  measureSkinPad();
  const shadowBox = (out: Box3): boolean => {
    if (!armature.mesh.visible || !readBones()) return false;
    out.union(bonesBox.expandByScalar(skinPad));
    return true;
  };

  // Console/test handle.
  const handle = {
    /** Take Armature out of sight and hearing (SuspendOptions), and give the viewer back; the test hook for suspend(). */
    suspend,
    /** Put it all back as it was left. */
    resume,
    /** The camera onto the figure (tests and the console). */
    frame,
    isSuspended: () => suspended,
    /** The page's shell (studio/Studio.ts), for the tests and the console. */
    studio,
    reference: { board: referenceBoard, view: referenceView, panel: studio.reference.panel },
    get armature() {
      return armature;
    },
    /** Drag an IK handle to a world point (tests and the console). */
    reach: (id: string, x: number, y: number, z: number) => {
      armature.reach(id, new Vector3(x, y, z));
      armature.repin(id);
      armature.applyPins(id);
      syncHandles();
      commit();
    },
    aim: (id: string, degrees: number) => {
      armature.aimChain(id, degrees);
      armature.applyPins();
      syncHandles();
      commit();
    },
    /** Turn a joint to pose Euler degrees, as its sliders do. */
    turn: (bone: string, x: number, y: number, z: number) => turnJoint(bone, [x, y, z]),
    /**
     * Move the pelvis by an offset, as a drag of its move gizmo does: in
     * `steps` equal moves, each followed by what the gizmo's own change
     * runs, and one undo step at the end.
     */
    moveRoot: (dx: number, dy: number, dz: number, steps = 1) => {
      const n = Math.max(1, Math.round(steps));
      for (let i = 0; i < n; i++) {
        armature.root.position.add(new Vector3(dx / n, dy / n, dz / n));
        afterGizmo(null);
      }
      commit();
    },
    /** Load a rigged .glb as the figure (the console and the tests). */
    loadModel,
    /** Swap to a preset or a mannequin by id, fetched if need be. */
    figure: (id: string) => replaceFigure(id),
    modelName: () => model?.name ?? null,
    /** What the gizmo is showing, for the console and the tests. */
    gizmo: () => ({
      mode: gizmoMode,
      attached: [...attached].map((tc) => tc.mode).sort(),
      /** Whether the centre still carries the free-rotate sphere. */
      freeRotateOn: freeRotate.length === 0,
      /** Where the move gizmo sits in the world, if it is up. */
      moveAt: attached.has(moveTc) && moveTc.object ? moveTc.object.getWorldPosition(new Vector3()).toArray() : null,
      /** Where the rotate gizmo sits in the world, if it is up. */
      rotateAt: attached.has(rotateTc) && rotateTc.object ? rotateTc.object.getWorldPosition(new Vector3()).toArray() : null,
    }),
    /** Which gizmo, and which of its handles, a press at this page point would take, as a press decides; null for none. */
    gizmoHit: (x: number, y: number): { mode: string; axis: string } | null => {
      for (const tc of controls) {
        if (!tc.enabled) continue;
        const t = tc as unknown as {
          _getPointer(ev: { clientX: number; clientY: number; button: number }): { x: number; y: number; button: number };
          pointerHover(p: { x: number; y: number; button: number }): void;
          axis: string | null;
        };
        t.pointerHover(t._getPointer({ clientX: x, clientY: y, button: 0 }));
        if (t.axis) return { mode: tc.mode, axis: t.axis };
      }
      return null;
    },
    /** The gizmo handle a press at this page point would take ('X', 'Y', 'XYZ'...), as a press decides; null for none. */
    gizmoAxis: (x: number, y: number): string | null => {
      for (const tc of controls) {
        if (!tc.enabled) continue;
        const t = tc as unknown as {
          _getPointer(ev: { clientX: number; clientY: number; button: number }): { x: number; y: number; button: number };
          pointerHover(p: { x: number; y: number; button: number }): void;
          axis: string | null;
        };
        t.pointerHover(t._getPointer({ clientX: x, clientY: y, button: 0 }));
        if (t.axis) return t.axis;
      }
      return null;
    },
    hingePosition: (id: string) => {
      const at = armature.hingeWorld(id, new Vector3());
      return at ? at.toArray() : null;
    },
    /** Where a chain's ring is drawn: the middle of its hand's or foot's own geometry (handlePosition is the effector point the reach holds). */
    ringPosition: (id: string) => armature.ringWorld(id, new Vector3()).toArray(),
    /** Where a chain's ball, or with 'root' the root's, sits in the world. */
    handlePosition: (id: string) => {
      if (id === ROOT_BALL) return armature.rootHandleWorld(new Vector3()).toArray();
      // The head has no chain: its place is the top of the head.
      if (id === LOOK_ID && armature.hasLook()) return armature.effectorWorld(armature.lookBone()!, new Vector3(), 1).toArray();
      const c = armature.chain(id);
      return c ? armature.effectorWorld(c.effector, new Vector3()).toArray() : null;
    },
    /**
     * Where a handle ('ik:<chain>', 'aim:<chain>', 'look:head' or 'root')
     * sits on the page: its centre and its drawn radius (the ring's, the
     * arrowhead's, the root frame's shorter half), in CSS pixels; null when
     * it is not shown.
     */
    ballOnScreen: (name: string): [number, number, number] | null => {
      const b = pickList.find((p) => ballName(p) === name);
      const at = b?.ball.visible && handlesOn ? ballOnScreen(b.ball) : null;
      if (!b || !at) return null;
      const r = b.kind === 'aim' || b.kind === 'look' ? ARROW_TIP : RING_RADIUS;
      return [at[0], at[1], r];
    },
    /**
     * What a handle is drawn as, read back from what its shader reads: its
     * shape, its state ('rest', 'hover' or 'hot'), stroke colour (hex, no
     * hash) and width in CSS pixels, whether it has the pinned dot, where
     * it is, the point it points at (an arrowhead) and its dashed line's
     * ends; null for no such handle. Also its pick circle's size in pixels.
     */
    handleLook: (name: string) => {
      const v = views.get(name);
      if (!v) return null;
      return {
        ...kit.look(v),
        visible: v.mesh.visible && handlesOn,
        position: v.mesh.position.toArray(),
        toward: v.shape === 'arrow' || v.shape === 'dash' ? v.toward.value.toArray() : null,
        from: v.shape === 'dash' ? v.from.value.toArray() : null,
        pick: v.shape === 'dash' || v.shape === 'floor' ? 0 : PICK_RADIUS * 2,
        edges: v.shape === 'box' ? v.mesh.geometry.getIndex()!.count / 6 : 0,
      };
    },
    /**
     * The root's box: its middle, its eight corners in the world (in the
     * order of the cube's bits) and its own x axis, which turns with the hips.
     */
    rootBox: () => {
      rootView.mesh.updateMatrixWorld(true);
      const m = rootView.mesh.matrixWorld;
      const corners: number[][] = [];
      for (let i = 0; i < 8; i++) corners.push(new Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).applyMatrix4(m).toArray());
      return { centre: rootView.mesh.position.toArray(), corners, x: new Vector3().setFromMatrixColumn(m, 0).normalize().toArray() };
    },
    /** The handle colours, hex without the hash: rest, hover, hot (orange) and the casing. */
    handlePalette: () => kit.palette(),
    /** Names of every handle drawn, for the tests. */
    handleNames: () => [...views.keys()],
    /** The plant rings under planted feet, by foot, as drawn (shape and colour). */
    plantLooks: () => [...plantMarks].map(([foot, v]) => ({ foot, visible: v.mesh.visible, ...kit.look(v) })),
    /** Put the pointer over a handle (or none), as a mouse hover does, for the tests. */
    hover: (name: string | null) => {
      hovered = name;
      paintHandles();
    },
    /** Drag the head's look-at target to a world point, as the pointer does (tests and the console). */
    look: (x: number, y: number, z: number) => {
      armature.beginLook();
      armature.lookAt(new Vector3(x, y, z));
      armature.endLook();
      armature.applyPins();
      syncHandles();
      commit();
    },
    /** Turn a knee or elbow toward a world point, as a drag of its pole target does (tests and the console). */
    pole: (id: string, x: number, y: number, z: number) => {
      if (!armature.placePole(id, new Vector3(x, y, z))) return;
      armature.applyPins();
      syncHandles();
      commit();
    },
    /** Where a world point falls on the page, in CSS pixels; null behind the camera. */
    onScreen: (x: number, y: number, z: number) => toPage(new Vector3(x, y, z)),
    /**
     * A page point over the canvas where the figure's surface in view is `bone`'s part, for the tests: one of
     * the part's own vertices, as posed, whose ray from the camera meets that part first; null if none is in
     * view. It reads the figure with bounds of its own and puts the mesh's stored ones back, so what a press
     * reads is left as it was.
     */
    partSpot: (bone: string): [number, number] | null => {
      const mesh = armature.mesh;
      // The typings say a skinned mesh always has its bounds; null is how three is told to work them out again.
      const bounds = mesh as unknown as { boundingSphere: Sphere | null; boundingBox: Box3 | null };
      const keep = { sphere: bounds.boundingSphere, box: bounds.boundingBox };
      bounds.boundingSphere = null;
      bounds.boundingBox = null;
      try {
        mesh.updateMatrixWorld(true);
        const count = mesh.geometry.getAttribute('position').count;
        const v = new Vector3();
        const ndc = new Vector2();
        const rc = new Raycaster();
        const r = canvas.getBoundingClientRect();
        let tried = 0;
        const step = Math.max(1, Math.floor(count / 3000));
        for (let i = 0; i < count && tried < 40; i += step) {
          if (armature.boneAt({ face: { a: i } } as unknown as Parameters<typeof armature.boneAt>[0]) !== bone) continue;
          mesh.getVertexPosition(i, v);
          v.applyMatrix4(mesh.matrixWorld);
          const p = toPage(v);
          if (!p || document.elementFromPoint(p[0], p[1]) !== canvas) continue;
          tried++;
          ndc.set(((p[0] - r.left) / r.width) * 2 - 1, -((p[1] - r.top) / r.height) * 2 + 1);
          rc.setFromCamera(ndc, viewer.camera);
          const hit = rc.intersectObject(mesh, false)[0];
          if (hit && armature.boneAt(hit) === bone) return p;
        }
        return null;
      } finally {
        bounds.boundingSphere = keep.sphere;
        bounds.boundingBox = keep.box;
      }
    },
    /** What the last press on the figure took: 'ik:<chain>', 'aim:<chain>', 'root', a bone, or null. */
    picked: () => picked,
    select,
    selected: () => selected,
    /** Select an IK ball by its chain, as a tap on it does; null for none. */
    selectHandle,
    /** The IK ball a tap selected, by its chain, if any. */
    selectedHandle: () => selectedHandle,
    state: () => armature.serialize(),
    undo,
    redo,
    commit,
    /** Remesh to a figure at a resolution, as the button does. */
    remesh,
    save: flushSave,
    /** Dispose the mode (the page's own disposer). */
    dispose: () => dispose(),
    /** Picture the figure for the gallery card and save, as leaving does. */
    snapshot,
    /** The .armature file File > Save would write, as text. */
    pack: () => packArmature(currentFile()).text(),
    open: openFile,
    panel,
    file: currentFile,
    /** Steps there are to undo and to redo; `resting` while a slider's step waits to be taken. */
    history: () => ({ undo: undoStack.length, redo: redoStack.length, resting: pendingStep !== 0, limit: HISTORY_LIMIT }),
    /** Save to library, as the File menu's item does; resolves to the project, or null for a download or a failure. */
    saveToLibrary,
    /** Who the page is for, by the sign-in probe; null until it has answered. */
    role: () => role,
    /** The library project Save to library writes to, or null. */
    link: () => (link ? { ...link } : null),
    /** The project file Save to library would send, as text (gzip undone). */
    projectText: async () => armatureText(await encodeArmatureProject(currentFile(), armature.symmetry)),
  };
  (window as unknown as { __armature?: object }).__armature = handle;

  const dispose = (): void => {
    void flushSave();
    clearTimeout(lightSyncTimer);
    clearTimeout(pendingStep);
    for (const sub of subscriptions) sub.stop();
    select(null);
    // What the mode set on the viewer goes back as the viewer had it (a no-op when suspended already).
    needs.undo();
    for (const tc of controls) {
      viewer.scene.remove(tc.getHelper());
      tc.dispose();
    }
    viewer.removeSculptExtra(armature.mesh);
    armature.dispose();
    wash.dispose();
    viewer.scene.remove(handleGroup);
    viewer.scene.remove(plantGroup);
    kit.dispose();
    panel.dispose();
    openInput.remove();
    modelInput.remove();
    delete (window as unknown as { __armature?: object }).__armature;
    // The page's own hotkey guide comes back.
    announce('sculpt');
  };
  return Object.assign(dispose, {
    workspace,
    suspend,
    resume,
    isSuspended: () => suspended,
    bake: () => armature.bakeWorld(),
    mesh: () => armature.mesh,
    outside: () => (suspended && figureShown ? armature.mesh : null),
    shadowBox,
    showOutside,
    armatureName: () => link?.title ?? name,
    frame,
    figureChanged: () => panel.setFigureMade(host.figureMade()),
  });
}

// The tests mount, dispose and mount again on one page (armatureSuspend).
if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.MODE === 'test')) {
  (window as unknown as { __armatureMount?: typeof mountArmatureMode }).__armatureMount = mountArmatureMode;
}

export type { Armature };
export { Box3 };
