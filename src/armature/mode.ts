import { Box3, Group, Mesh, Plane, Raycaster, Sphere, Vector2, Vector3, Object3D } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, normalLocal, positionLocal } from 'three/tsl';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer } from '../viewer/Viewer';
import { KEY_DRAG_DEG_PER_PX } from '../viewer/Lighting';
import { STUDIO_BG } from '../viewer/Environment';
import { keymap } from '../ui/keymap';
import { isTextEntryTarget } from '../ui/dom';
import { isShowKey, pageChrome } from '../ui/ChromeToggle';
import { helpMenuItems } from '../help/menu';
import { settings } from '../ui/settings';
import { mayStore, onDeviceChoice } from '../ui/deviceStorage';
import { requireSaving } from '../ui/deviceChoice';
import { beforeLeaving } from '../ui/leaving';
import { downloadBlob } from '../ui/download';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { TitleStrip } from '../sculpt/ui/TitleStrip';
import { mountAccountHandle } from '../ui/account/menu';
import { keyFor, viewMenuItems } from '../sculpt/ui/viewMenu';
import { editMenuItems, fileMenuItems } from '../sculpt/ui/menuShape';
import type { MenuItem } from '../sculpt/ui/TopMenu';
import { recentMenuItem } from '../sculpt/ui/recentMenu';
import { recordRecent } from '../ui/recent';
import type { PathStep, Workspace } from '../sculpt/ui/TitleStrip';
import { rememberPanels } from '../sculpt/ui/panelMemory';
import '../sculpt/ui/shell.css';
import { Armature, buildArmature, importArmature, SCENE_SCALE, type ArmatureState } from './Armature';
import { HandleKit, RECT_MIN_HALF, RING_RADIUS, setHandleViewport, type HandleShape, type HandleState, type HandleView } from './handleViews';
import { onCentimetres } from './units';
import { UNITS } from '../viewer/units';
import { fetchFigure, figureById, tuneRig } from './figures';
import { rigFromGLTF } from './glbRig';
import { getGLTFLoader } from '../loaders/gltf';
import { ArmaturePanel, prettyName } from './ArmaturePanel';
import { MaterialPanel } from '../ui/MaterialPanel';
import { ReferenceBoard } from '../reference/board';
import { ReferencePanel } from '../reference/ReferencePanel';
import { ReferenceView } from '../reference/ReferenceView';
import { installIntake, pasteFromClipboard } from '../reference/intake';
import { CONTROLS_REFRESH_EVENT } from '../ui/Panel';
import { boxOfPositions, checkRemesh, RemeshTooLarge } from '../sculpt/bridge/remeshBudget';
import { statusToast } from '../sculpt/ui/statusToast';
import { armatureStamp, packArmature, unpackArmature } from './file';
import { loadArmature, saveArmature, saveHandoff, type ArmatureFile } from './persist';
import { HistoryButtons } from '../sculpt/ui/BrushSliders';
import { AuthExpiredError, checkSignIn, failureText, roleOf, type Role } from '../admin/api';
import { suspensionText } from '../net/account';
import { isProjectId } from '../net/ids';
import { originOf } from '../ui/origin';
import { takeOpen } from '../ui/openToken';
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
let pending: { bytes: ArrayBuffer; read: ReturnType<typeof rigFromGLTF> } | null = null;

/**
 * The rig of a loaded model. Parsing a glTF is asynchronous and building a
 * figure is not, so the bytes are read once, up front, and the result is
 * kept for the rebuilds that follow.
 */
function readModel(bytes: ArrayBuffer): ReturnType<typeof rigFromGLTF> {
  const held = parsed.get(bytes) ?? (pending?.bytes === bytes ? pending.read : null);
  if (!held) throw new Error('that model has not been read yet');
  parsed.set(bytes, held);
  return held;
}

/** Parse a .glb and derive its rig, before anything is built from it. */
async function parseModel(bytes: ArrayBuffer): Promise<ReturnType<typeof rigFromGLTF>> {
  const gltf = await getGLTFLoader().parseAsync(bytes.slice(0), '');
  const read = rigFromGLTF(gltf, IMPORTED, 'Model');
  read.rig.id = IMPORTED;
  pending = { bytes, read };
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

/**
 * Armature mode (owner design): a posable block figure as a subject of
 * its own - an art-reference tool with the full Render panel, and the
 * first step of a sculpt through Send to Sculpt. Mounted over a booted
 * Viewer at /?armature=1, the way sculpt mode is.
 *
 * Interaction is one idea: click a part and its joint's rotate gizmo
 * appears, clamped to that joint's limits and mirrored to the other side
 * while symmetry is on; the pelvis is the root and gets a move gizmo too.
 * Everything else - dragging off the figure, the wheel, the panels - is
 * the viewer as it always was.
 */
export async function mountArmatureMode(viewer: Viewer): Promise<() => void> {
  // The floor is fixed where the figure stands (owner call), as it is in
  // a sculpt on real units, so the Render panel built on the event below
  // offers no pedestal; its height comes once the figure is built
  // (holdFloor), and the look's Floor offset raises or lowers it.
  const savedFloorOffset = viewer.getFloorOffset();
  viewer.lockFloor(0);
  // Only the key light casts by default in Armature mode (owner call); the
  // fill's and the rim's Casts shadow boxes still tick them on, and a look
  // saved before the rim cast by default keeps its rim as it was saved
  // (Lighting.keyOnlyShadows). Sculpt and the viewer keep all three.
  const lighting = viewer.lighting;
  const casts = (id: 'fill' | 'rim'): boolean => lighting.state().find((l) => l.id === id)?.castShadow ?? true;
  const castsBefore = { fill: casts('fill'), rim: casts('rim') };
  lighting.setShadow('fill', false);
  lighting.setShadow('rim', false);
  lighting.keyOnlyShadows = true;
  // The Render panel, Help and Preferences all listen for this.
  window.dispatchEvent(
    new CustomEvent('bozzetto:sculptmode', { detail: { active: true, mode: 'armature' } }),
  );
  viewer.tapToFocus = false;

  // An armature project opened by its address (docs/accounts.md §4-5): one's
  // own (`&project=<id>`, from My projects or the owner's gallery, saved back
  // there) or a template's copy (`&template=<id>`, nobody's project, so Save
  // to library makes one of your own). Read through the sanitiser
  // (project.ts) before anything is replaced; the address is cleaned at once,
  // so a reload does not open it again over the work done since.
  const query = new URLSearchParams(window.location.search);
  const projectParam = query.get('project');
  const templateParam = query.get('template');
  const projectId = isProjectId(projectParam) ? projectParam : null;
  const templateId = isProjectId(templateParam) ? templateParam : null;
  const projectScope = query.get('scope') === 'admin' ? ('admin' as const) : undefined;
  const sentHere = takeOpen();
  if (projectParam !== null || templateParam !== null) {
    const url = new URL(window.location.href);
    for (const k of ['project', 'template', 'scope']) url.searchParams.delete(k);
    history.replaceState(history.state, '', url);
  }
  let saved = await loadArmature();
  // Sculpt's path, Armature step, asked "Make a new armature for this scene?"
  // and was told yes (&scene=1): a new figure, whatever the autosave held,
  // that Send to Sculpt adds to the scene as a new object. The autosave
  // keeps the mark (ArmatureFile.forScene), so a reload still knows.
  const forSceneParam = query.get('scene') === '1';
  let forScene = forSceneParam || saved?.forScene === true;
  if (forSceneParam) {
    saved = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('scene');
    history.replaceState(history.state, '', url);
  }
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
  const holdFloor = (): void => viewer.lockFloor(armature.bounds().min.y);
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
  // The viewer boots on a synthetic one-frame manifest whose subject is a
  // placeholder cube; sculpt mode swaps its geometry, this mode brings its
  // own figure instead - so the cube has to be sent away, or it sits at the
  // origin as a tiny box (owner report).
  viewer.setSculptVisible(false);
  // A neutral grey backdrop (STUDIO_BG), as Sculpt's, until a saved look says otherwise.
  viewer.environment.setBackgroundMode('color');
  viewer.environment.setBackgroundColor(STUDIO_BG);
  // What the Render panel's Reset look goes back to: the look as the mode
  // starts it, grey backdrop and all, before a saved one lands on top.
  const defaultLook = viewer.getLook();
  if (saved?.look) {
    await viewer.applyLook(saved.look);
    // The Render panel was built on the mode's event, before this look
    // landed; its sliders read their values once, so it rebuilds.
    window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
  }

  const frame = (): void => {
    const box = armature.bounds();
    // Sizes the ground, the pedestal and the shadow to the figure as well,
    // which the placeholder cube would otherwise still be setting.
    if (!box.isEmpty()) viewer.fitSubject(box);
  };
  frame();

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

  const rotateTc = new TransformControls(viewer.camera, canvas);
  rotateTc.mode = 'rotate';
  rotateTc.space = 'local';
  rotateTc.setSize(0.75);
  const moveTc = new TransformControls(viewer.camera, canvas);
  moveTc.mode = 'translate';
  moveTc.space = 'world';
  moveTc.setSize(0.9);
  /**
   * The part's proportions (R): the handle along the bone is its length,
   * the two across it its size. It drives a stand-in on the bone rather
   * than the part itself, whose scale is the proportions' to set; the
   * stand-in's scale is read as a factor on the part as the drag found it.
   */
  const scaleTc = new TransformControls(viewer.camera, canvas);
  scaleTc.mode = 'scale';
  scaleTc.space = 'local';
  scaleTc.setSize(0.75);
  const scaleProxy = new Object3D();
  scaleProxy.name = 'armature-scale';
  /** The part's proportions as the drag began. */
  let scaleFrom: { size: number; length: number } | null = null;
  const controls = [rotateTc, moveTc, scaleTc];
  const attached = new Set<TransformControls>();
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
      else if (selectedHandle) handleMoved(selectedHandle);
      else afterGizmo(selected && armature.def(selected)?.kind !== 'root' ? selected : null);
    });
  }
  /**
   * After a gizmo moved something: the root, or `joint` turned by hand. A
   * joint is clamped to its limits and becomes its limb's aim, so the pin
   * re-solve that follows keeps the knee or elbow where it was turned to.
   */
  const afterGizmo = (joint: string | null): void => {
    if (joint) {
      armature.clampPose(joint);
      armature.followAims(joint);
    }
    // Pinned hands and feet hold their ground while the rest moves; this
    // is what lets the pelvis drop into a crouch with the feet planted. A
    // foot being turned by hand is not stood flat again under the gizmo,
    // or no drag of it would show.
    armature.applyPins(undefined, armature.plantFeet && !(joint && armature.isFoot(joint)));
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
        tc.attach(tc === scaleTc ? scaleProxy : target);
        tc.enabled = true;
        tc.getHelper().visible = true;
        attached.add(tc);
      }
      placeControls();
      highlight = armature.partHighlight(selected, wash);
      if (highlight) armature.partBones.get(selected)!.add(highlight);
    }
    syncHandles();
    panel.refresh(selected);
  };

  /** A tap on an IK ball: that ball selected, and the move gizmo on it. */
  const selectHandle = (id: string | null): void => {
    select(null);
    const ball = id ? handleMesh(id) : undefined;
    if (!id || !ball || !handlesOn) return;
    selectedHandle = id;
    trimFreeRotate(false);
    moveTc.attach(ball);
    moveTc.enabled = true;
    moveTc.getHelper().visible = true;
    attached.add(moveTc);
    syncHandles();
    placeControls();
  };
  /** The mesh of a selectable handle: a reach ring by its chain, or the look-at by LOOK_ID. */
  const handleMesh = (id: string): Mesh | undefined => (id === LOOK_ID ? views.get(LOOK_NAME)?.mesh : handles.get(id));
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
    } else {
      armature.reach(id, ball.getWorldPosition(dragPoint));
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
    setHandleViewport(r.width, r.height);
  };
  placeViewport();
  const viewportObserver = new ResizeObserver(placeViewport);
  viewportObserver.observe(canvas);
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
  const rootView = kit.create('rect', ROOT_BALL);
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
      const state = stateOf(name, id === aiming);
      kit.paint(views.get(name)!, state);
      kit.paint(views.get(`dash:${id}`)!, state);
    }
    const lookArrow = views.get(LOOK_NAME);
    if (lookArrow) {
      const state = stateOf(LOOK_NAME, looking || selectedHandle === LOOK_ID);
      kit.paint(lookArrow, state);
      kit.paint(views.get(LOOK_DASH)!, state);
    }
    kit.paint(rootView, stateOf(ROOT_BALL, moving !== null || selected === armature.root.name));
  };
  const at = new Vector3();
  const joint = new Vector3();
  const hipA = new Vector3();
  const hipB = new Vector3();
  const syncHandles = (): void => {
    // Every pose change, selection and figure swap comes through here: the
    // picture changed, so a still frame's smoothing starts over.
    viewer.invalidate();
    syncPlantMarks();
    handleGroup.visible = handlesOn;
    if (!handlesOn) return;
    placeViewport();
    for (const [id, m] of handles) {
      const c = armature.chain(id);
      if (!c) continue;
      armature.effectorWorld(c.effector, at);
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
    rootView.mesh.position.copy(armature.rootHandleWorld(at));
    // The frame round the hips: as wide as the hip joints are apart, plus
    // the block they sit in, in the proportion of a pelvis.
    const left = armature.jointWorld('thigh.L', hipA);
    const right = armature.jointWorld('thigh.R', hipB);
    const span = left && right ? left.distanceTo(right) : 0.2 * armature.scale;
    rootView.half.value.set(span * 0.85, span * 0.85 * 0.75);
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
  // for itself, while the view moves): Viewer.updateFrameMode. The AO is
  // drawn through the drag.
  viewer.fastFrames = true;
  viewer.interactionProbe = () => (dragUnderway() ? 'move' : null);
  // Anti-aliasing as Preferences says, as in Sculpt (the viewer's own is 4x MSAA).
  const applyAntialias = (): void => viewer.setAntialias(settings.get('antialias'));
  applyAntialias();
  const offAntialias = settings.onChange(applyAntialias);
  const dragPlane = new Plane();
  const dragPoint = new Vector3();
  // Scratch for the aim and look drags, which run on every move.
  const dragNormal = new Vector3();
  const lookSphere = new Sphere();
  const lookPoint = new Vector3();
  /** Where a press landed on the look-at handle, from its middle, so the drag does not jump by it. */
  const lookGrab = { x: 0, y: 0 };
  /** What the last press took: 'ik:<chain>', 'aim:<chain>', 'look:head', 'root', a part's bone, or nothing. */
  let picked: string | null = null;
  /**
   * How near a handle's centre a press has to land to take it, in CSS
   * pixels: a 44 px circle, the least a finger needs. The root's frame also
   * takes a press within PICK_EDGE of its outline.
   */
  const PICK_RADIUS = 22;
  const PICK_EDGE = 14;
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
  let tap: { id: number; x: number; y: number; target: string | null; ball: string | null; before: string | null } | null = null;
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
  const rimPage = { x: 0, y: 0 };
  const camSide = new Vector3();
  /**
   * The root's frame on the page: its half width and half height in CSS
   * pixels, as drawn (never under RECT_MIN_HALF). False when it is off the page.
   */
  const rootFrame = (out: { hx: number; hy: number }): boolean => {
    if (!pagePoint(rootView.mesh.position, handlePage)) return false;
    const half = rootView.half.value;
    out.hx = out.hy = 0;
    camSide.setFromMatrixColumn(viewer.camera.matrixWorld, 0).normalize();
    if (pagePoint(rimAt.copy(rootView.mesh.position).addScaledVector(camSide, half.x), rimPage)) {
      out.hx = Math.abs(rimPage.x - handlePage.x);
    }
    camSide.setFromMatrixColumn(viewer.camera.matrixWorld, 1).normalize();
    if (pagePoint(rimAt.copy(rootView.mesh.position).addScaledVector(camSide, half.y), rimPage)) {
      out.hy = Math.abs(rimPage.y - handlePage.y);
    }
    // Drawn no smaller than the shader's own floor.
    const grow = Math.max(1, RECT_MIN_HALF / Math.max(0.001, Math.min(out.hx, out.hy)));
    out.hx *= grow;
    out.hy *= grow;
    return true;
  };
  const rootBox = { hx: 0, hy: 0 };
  /**
   * How far a press at (x, y) is from a handle's centre, in CSS pixels, if
   * it lands on the handle's pick shape - a 44 px circle round the centre,
   * and for the root also a band along the outline of its frame - else
   * Infinity.
   */
  const pickDistance = (b: Ball, x: number, y: number): number => {
    if (!b.ball.visible || !pagePoint(b.ball.getWorldPosition(rimAt), handlePage)) return Infinity;
    const d = Math.hypot(handlePage.x - x, handlePage.y - y);
    if (d <= PICK_RADIUS) return d;
    if (b.kind !== 'root' || !rootFrame(rootBox)) return Infinity;
    const dx = Math.abs(x - handlePage.x) - rootBox.hx;
    const dy = Math.abs(y - handlePage.y) - rootBox.hy;
    const off = dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : -Math.max(dx, dy);
    return off <= PICK_EDGE ? d : Infinity;
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

  const onPointerDown = (e: PointerEvent): void => {
    down.add(e.pointerId);
    // A second finger: a pinch or a two-finger pan, whatever the first was.
    if (down.size > 1) tap = null;
    if (lightHeld) {
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
      } else if (ball.kind === 'look') {
        // Where on the handle the press landed, kept so the drag starts
        // from where the head already faces; the chain's poses now are
        // what every move of the drag turns from.
        looking = true;
        if (ballOnScreen(ball.ball)) {
          const [hx, hy] = ballOnScreen(ball.ball)!;
          lookGrab.x = hx - e.clientX;
          lookGrab.y = hy - e.clientY;
        }
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
        } else {
          reaching = ball.id;
          if (down.size === 1) {
            tap = { id: e.pointerId, x: e.clientX, y: e.clientY, target: null, ball: ball.id, before: null };
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
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (lightHeld) {
      if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
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
      // Where the pointer sits around the limb IS the aim: the plane it
      // reads on faces the camera through the pole target, so the target
      // follows the pointer round the limb, the angle is the one the solver
      // wants and the hand or foot never moves.
      aim(e);
      const target = aims.get(aiming)?.position;
      if (!target) return;
      dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragNormal), target);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      const angle = armature.aimFromPoint(aiming, dragPoint);
      if (angle !== null) {
        armature.aimChain(aiming, angle);
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
      // The pointer's ray meets the sphere the target sits on, round the
      // head: the head turns to face where it lands, with the handle under
      // the pointer. Past the silhouette the nearest point of the sphere
      // stands in, and past the limits the head holds at them.
      if (tap?.ball && tap.before === null) tap.before = JSON.stringify(armature.serialize());
      aimAt(e.clientX + lookGrab.x, e.clientY + lookGrab.y);
      if (armature.lookFromWorld(joint)) {
        lookSphere.center.copy(joint);
        lookSphere.radius = armature.lookDistance();
        if (!raycaster.ray.intersectSphere(lookSphere, lookPoint)) {
          raycaster.ray.closestPointToPoint(joint, lookPoint);
          lookPoint.sub(joint).setLength(lookSphere.radius).add(joint);
        }
        armature.lookAt(lookPoint);
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
    if (moving) {
      aim(e);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
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
    armature.reach(reaching, dragPoint);
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
      selectHandle(tapped.ball);
    } else {
      commit();
    }
    // Back to neutral: the handle is no longer in hand.
    paintHandles();
    viewer.invalidate();
    flushPanel();
  };
  canvas.addEventListener('pointerdown', onPointerDown, true);
  canvas.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

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
    if (selectedHandle) selectHandle(selectedHandle);
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
  // The title strip, and the undo and redo buttons where Sculpt has them,
  // at the foot of the left edge.
  const strip = new TitleStrip();
  mountAccountHandle(strip);
  const chrome = pageChrome();
  strip.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => strip.setChromeHidden(hidden);
  const histButtons = new HistoryButtons({
    undo,
    redo,
    canUndo: () => undoStack.length > 0 || pendingStep !== 0,
    canRedo: () => redoStack.length > 0,
  });
  histButtons.el.classList.add('armature-hist');
  const edge = document.createElement('div');
  edge.className = 'bz-edge';
  edge.appendChild(histButtons.el);
  document.body.appendChild(edge);

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
    await saveArmature({ ...currentFile(), ...(forScene ? { forScene: true } : {}) });
  };
  const scheduleSave = (edit = true): void => {
    if (edit) edits++;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), SAVE_GAP_MS);
  };
  // Turned on from Preferences: the figure as it stands is kept straight away.
  onDeviceChoice((c) => {
    if (c === 'keep') scheduleSave(false);
  });
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
  document.addEventListener('input', onLookEdit);
  document.addEventListener('change', onLookEdit);
  // The Render panel's Reset look (it only asks; the mode owns the defaults).
  const onLookReset = (): void => {
    void viewer.applyLook(defaultLook).then(() => {
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
      scheduleSave();
    });
  };
  window.addEventListener('bozzetto:look-reset', onLookReset);
  // Leaving some other way - a reload, a closed tab: the record is saved at
  // once, and the picture follows if the page lives long enough to take it
  // (a page on its way out may never draw another frame).
  const onHidden = (): void => {
    void flushSave();
    void snapshot(false);
  };
  window.addEventListener('pagehide', onHidden);
  // File > Close, which the "← Gallery" chip used to be.
  const leaveForGallery = (): void => {
    void snapshot().finally(() => {
      // The site's root, whatever the address says (main.ts addGalleryLink).
      window.location.href = originOf().href;
    });
  };
  // Signing in again and reloading onto an update leave the page and come
  // back (ui/leaving): the figure is saved and pictured first, as leaving
  // for the gallery does.
  const offLeaving = beforeLeaving(async () => {
    await snapshot();
    return true;
  });

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
    }
    viewer.adoptMesh(armature.mesh);
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
    void referenceBoard.clear();
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
    void referenceBoard.clear();
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

  const send = async (resolution: number): Promise<void> => {
    const bake = armature.bakeWorld();
    // Priced here, on the figure Sculpt will voxelise, before leaving: a
    // grid this device cannot spare is refused with the reason, and the
    // figure stays where it is to try a lower resolution.
    try {
      checkRemesh(boxOfPositions(bake.positions), resolution);
    } catch (err) {
      if (!(err instanceof RemeshTooLarge)) throw err;
      statusToast('Sending to Sculpt...').fail(err.message);
      return;
    }
    // The figure crosses to Sculpt through the device's storage, so it needs saving on.
    if (!(await requireSaving('Send to Sculpt needs to keep the figure on this device.'))) return;
    await saveHandoff({
      v: 1,
      name: 'Figure',
      positions: bake.positions,
      indices: bake.indices,
      resolution,
      look: viewer.getLook(),
      savedAt: Date.now(),
      units: UNITS,
      floor: viewer.floorHeight() ?? 0,
      ...(forScene ? { addToScene: true } : {}),
    });
    // The figure is on its way: a send from here again is an ordinary one.
    forScene = false;
    // The card this armature leaves in the gallery gets its picture of the
    // figure as sent, taken while the canvas is still up (a record saved
    // without one shows the placeholder, and an older one a stale pose).
    await snapshot();
    window.location.href = '/?sculpt=1&handoff=1';
  };

  /**
   * Turn a joint by hand, as its sliders do: clamped, taken as its limb's
   * aim, the pins re-solved around it - all but a foot's own planting,
   * since standing it flat again would undo the turn.
   */
  const turnJoint = (bone: string, xyz: [number, number, number], slider = false): void => {
    armature.setPoseEuler(bone, xyz[0], xyz[1], xyz[2]);
    armature.followAims(bone);
    armature.applyPins(undefined, armature.plantFeet && !armature.isFoot(bone));
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
      send: (resolution) => void send(resolution),
    },
    viewer,
  );
  // How the figure is drawn (mode, matcap, shading, wireframe): the Material tab beside Armature's.
  const materialPanel = new MaterialPanel(viewer, { sculpting: true });
  // The reference pictures: on this device only (reference/board.ts), and not in the .armature file.
  const referenceBoard = new ReferenceBoard('armature');
  if (openedProject) {
    if (bootLink) void referenceBoard.restore({ project: bootLink.id });
    else void referenceBoard.clear();
  } else {
    void referenceBoard.restore({ current: true }).then(() => referenceBoard.bindProject(bootLink?.id ?? null));
  }
  const referencePanel = new ReferencePanel(referenceBoard);
  referencePanel.setLinked(() => !!link);
  const referenceView = new ReferenceView(referenceBoard, viewer);
  const offIntake = installIntake(referenceBoard, () => referencePanel.isOpen());
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
  /** The File menu's rows depend on who is here (set once the menu exists). */
  let refreshFileMenu: () => void = () => undefined;
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
      else fileMenu.note('Saved as a .armature file');
      return null;
    }
    const where = place();
    if (armature.rig.id === IMPORTED) {
      statusToast('').fail(`A model loaded from a file stays on this device: ${where} keeps the built-in figures. Save keeps a .armature file.`);
      return null;
    }
    if (librarySaving) {
      fileMenu.note(`Already saving to ${where}`);
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
      referenceBoard.bindProject(saved.id);
      referencePanel.setLinked(() => true);
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

  // The workspace path as the strip and the View menu both read it: Sculpt is
  // File > Send to Sculpt; Present waits for a figure to be sent.
  const workspaceNow = (): { current: Workspace; steps: Partial<Record<Workspace, PathStep>> } => ({
    current: 'armature',
    steps: {
      sculpt: { action: () => void send(panel.resolution) },
      paint: { unavailable: 'A figure is sent to Sculpt first' },
      present: { unavailable: 'A figure is sent to Sculpt first' },
    },
  });
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
    if (role === 'guest') {
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
    return [{ label: 'Save to library', hint: libraryHint, action: () => void saveToLibrary() }];
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
            void referenceBoard.clear();
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
        { label: 'Send to Sculpt', action: () => void send(panel.resolution) },
      ],
      close: leaveForGallery,
    });
  const fileMenu = new TopMenu('File', fileItems(), 'file-menu--file', strip.menus, true);
  refreshFileMenu = () => fileMenu.setItems(fileItems());
  const editMenu = new TopMenu(
    'Edit',
    editMenuItems({
      mode: 'armature',
      history: [
        { label: 'Undo', key: keyFor('arm.undo'), action: undo },
        { label: 'Redo', key: keyFor('arm.redo'), action: redo },
      ],
      own: [{ label: 'Paste picture', hint: 'Adds the clipboard\'s picture to the Reference panel', action: () => void pasteFromClipboard(referenceBoard) }],
    }),
    'file-menu--edit',
    strip.menus,
    true,
  );
  const viewMenu = new TopMenu(
    'View',
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
      referenceOver: {
        get: () => referenceView.isOverEnabled(),
        toggle: () => referenceView.setOverEnabled(!referenceView.isOverEnabled()),
      },
      panels: [
        ['armature', 'Armature'],
        ['material', 'Material'],
        ['reference', 'Reference'],
        ['settings', 'Render'],
      ],
      hideInterface: () => chrome.set(true),
      workspace: workspaceNow,
    }),
    'file-menu--view',
    strip.menus,
    true,
  );
  const helpMenu = new TopMenu('Help', helpMenuItems(), 'file-menu--help', strip.menus, true);
  strip.setWorkspace(workspaceNow().current, workspaceNow().steps);
  // Which panel was open on each side last time, open again; kept from here on.
  const offPanelMemory = rememberPanels('armature');
  // The readout: the project's name when it has one, the part in hand, the figure's triangles.
  const paintReadout = (): void => {
    const tris = armature.mesh.geometry.getIndex();
    strip.setReadout({
      name: link?.title ?? name,
      state: sceneStateWord({ linked: !!link, synced: !!link && syncedAt === edits }),
      object: selected ? prettyName(selected) : null,
      tris: tris ? Math.round(tris.count / 3) : null,
    });
  };
  paintReadout();
  const readoutTimer = window.setInterval(paintReadout, 500);

  // --- keys ------------------------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (isTextEntryTarget(e) || document.body.classList.contains('has-modal')) return;
    const action = keymap.actionFor(e, 'armature');
    if (!action) return;
    // Tab (ui.chrome) is not Armature's: it falls through to the viewer's
    // handler, which closes the panels (this one and the Render panel
    // alike), then hides the interface, then brings it back - as in Sculpt.
    switch (action.id) {
      case 'arm.symmetry':
        armature.symmetry = !armature.symmetry;
        panel.refresh(selected);
        commit();
        break;
      case 'arm.move':
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
        if (isShowKey(e)) pageChrome().set(false);
        break;
      case 'arm.undo':
        undo();
        break;
      case 'arm.redo':
        redo();
        break;
      case 'arm.send':
        void send(panel.resolution);
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
  window.addEventListener('keydown', onKey, true);
  // A held key ends on its own key, whatever the modifiers are doing now.
  const onKeyUp = (e: KeyboardEvent): void => {
    if (keymap.holdActionForKeyUp(e, 'armature')?.id === 'arm.light') lightHeld = false;
  };
  window.addEventListener('keyup', onKeyUp, true);
  // Losing the window eats the keyup (an app switch with L down): without
  // this every press after it would still go to the light.
  const onBlur = (): void => {
    lightHeld = false;
  };
  window.addEventListener('blur', onBlur);

  // Console/test handle.
  const handle = {
    reference: { board: referenceBoard, view: referenceView, panel: referencePanel },
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
    }),
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
      const r = b.kind === 'root' ? (rootFrame(rootBox) ? Math.min(rootBox.hx, rootBox.hy) : 0) : RING_RADIUS;
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
      };
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
      const angle = armature.aimFromPoint(id, new Vector3(x, y, z));
      if (angle === null) return;
      armature.aimChain(id, angle);
      armature.applyPins();
      syncHandles();
      commit();
    },
    /** Where a world point falls on the page, in CSS pixels; null behind the camera. */
    onScreen: (x: number, y: number, z: number) => toPage(new Vector3(x, y, z)),
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
    send,
    save: flushSave,
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

  return () => {
    void flushSave();
    clearTimeout(lightSyncTimer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown, true);
    canvas.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    document.removeEventListener('input', onLookEdit);
    document.removeEventListener('change', onLookEdit);
    window.removeEventListener('bozzetto:look-reset', onLookReset);
    window.removeEventListener('pagehide', onHidden);
    offLeaving();
    select(null);
    viewer.fastFrames = false;
    viewer.interactionProbe = null;
    offAntialias();
    viewer.setAntialias('always');
    viewer.setSculptVisible(true);
    // The lights' boxes as the mode found them, for whatever comes next.
    lighting.keyOnlyShadows = false;
    lighting.setShadow('fill', castsBefore.fill);
    lighting.setShadow('rim', castsBefore.rim);
    for (const tc of controls) {
      viewer.scene.remove(tc.getHelper());
      tc.dispose();
    }
    viewer.removeSculptExtra(armature.mesh);
    armature.dispose();
    viewer.scene.remove(handleGroup);
    viewer.scene.remove(plantGroup);
    kit.dispose();
    viewportObserver.disconnect();
    // The floor goes back to what the project under the mode asks for.
    viewer.setFloorOffset(savedFloorOffset);
    viewer.lockFloor(viewer.manifestFloor());
    panel.dispose();
    materialPanel.dispose();
    offIntake();
    referenceView.dispose();
    referencePanel.dispose();
    referenceBoard.dispose();
    clearInterval(readoutTimer);
    offPanelMemory();
    fileMenu.dispose();
    editMenu.dispose();
    viewMenu.dispose();
    helpMenu.dispose();
    if (pendingStep) clearTimeout(pendingStep);
    histButtons.dispose();
    edge.remove();
    chrome.onChange = null;
    strip.dispose();
    openInput.remove();
    modelInput.remove();
    delete (window as unknown as { __armature?: object }).__armature;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false, mode: 'view' } }));
  };
}

export type { Armature };
export { Box3 };
