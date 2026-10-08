import { Box3, Group, Mesh, Plane, Raycaster, RingGeometry, SphereGeometry, Vector2, Vector3, type Object3D } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, normalLocal, positionLocal } from 'three/tsl';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer } from '../viewer/Viewer';
import { KEY_DRAG_DEG_PER_PX } from '../viewer/Lighting';
import { STUDIO_BG } from '../viewer/Environment';
import { keymap } from '../ui/keymap';
import { isTextEntryTarget } from '../ui/dom';
import { showPreferences } from '../ui/Preferences';
import { settings } from '../ui/settings';
import { beforeLeaving } from '../ui/leaving';
import { downloadBlob } from '../ui/download';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { Armature, buildArmature, importArmature, type ArmatureState } from './Armature';
import { fetchFigure, figureById } from './figures';
import { rigFromGLTF } from './glbRig';
import { getGLTFLoader } from '../loaders/gltf';
import { ArmaturePanel } from './ArmaturePanel';
import { boxOfPositions, checkRemesh, RemeshTooLarge } from '../sculpt/bridge/remeshBudget';
import { statusToast } from '../sculpt/ui/statusToast';
import { armatureStamp, packArmature, unpackArmature } from './file';
import { loadArmature, saveArmature, saveHandoff, type ArmatureFile } from './persist';
import { HistoryButtons } from '../sculpt/ui/BrushSliders';
import { AuthExpiredError, checkSignIn, failureText, roleOf, type Role } from '../admin/api';
import { suspensionText } from '../net/account';
import { isProjectId } from '../net/ids';
import { takeOpen } from '../ui/openToken';
import { signInButton } from '../ui/signIn';
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
/** What a press on the root's ball records, and the ball's name in the scene. */
const ROOT_BALL = 'root';

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
  // The floor is held where the figure stands (owner call), so the Render
  // panel built on the event below offers no pedestal; its height comes
  // once the figure is built (holdFloor).
  viewer.lockFloor(0);
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
  /** The project Save to library writes to: the autosave's, or the one just opened. */
  let bootLink: ArmatureLink | null = saved?.project ?? null;
  let bootSymmetry: boolean | null = null;
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
      if (!saved || sentHere === key || window.confirm(`Open ${what}? The armature in progress on this device will be replaced.`)) {
        saved = got.file;
        bootLink = got.link ?? null;
        bootSymmetry = got.symmetry;
        if (got.notice) bootNotes.push(got.notice);
      }
    } catch (err) {
      console.warn('armature: the project could not be opened', err);
      bootNotes.push(`That armature could not be opened: ${failureText(err)}`);
    }
  }
  if (saved?.model) {
    try {
      await parseModel(saved.model);
    } catch (err) {
      console.warn('armature: the saved model could not be read', err);
      saved.model = undefined;
      saved.state.preset = FALLBACK_FIGURE;
    }
  }
  let name = saved?.name ?? 'Armature';
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
   * The ground, held at the floor a figure stands on as it is built: the
   * lowest point of its feet in the rest pose, which is the height its
   * planting stands feet at too. The four mannequins rest with their soles
   * at 0, so the floor stays put as one replaces another. Called on a
   * figure fresh from figureFor, before any pose or placement lands.
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
  wash.positionNode = positionLocal.add(normalLocal.mul(float(0.4)));
  let highlight: Mesh | null = null;

  const rotateTc = new TransformControls(viewer.camera, canvas);
  rotateTc.mode = 'rotate';
  rotateTc.space = 'local';
  rotateTc.setSize(0.75);
  const moveTc = new TransformControls(viewer.camera, canvas);
  moveTc.mode = 'translate';
  moveTc.space = 'world';
  moveTc.setSize(0.9);
  const controls = [rotateTc, moveTc];
  const attached = new Set<TransformControls>();
  let dragging = false;
  /** Which handles the selection gets, as in sculpt mode: t, w, e. */
  let gizmoMode: 'all' | 'translate' | 'rotate' = 'all';

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
      // One control at a time on the root, where both are attached.
      for (const other of controls) if (other !== tc) other.enabled = !on && attached.has(other);
      if (!on) {
        commit();
        flushPanel();
      }
    });
    tc.addEventListener('objectChange', () => {
      if (selectedHandle) handleMoved(selectedHandle);
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
      const wanted =
        def.kind === 'root'
          ? gizmoMode === 'translate'
            ? [moveTc]
            : gizmoMode === 'rotate'
              ? [rotateTc]
              : controls
          : [rotateTc];
      trimFreeRotate(wanted.length > 1);
      const use = wanted;
      for (const tc of use) {
        tc.attach(target);
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
    const ball = id ? handles.get(id) : undefined;
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
  /** The selected ball moved by its gizmo: the limb reaches for it, as a drag of the ball reaches. */
  const handleMoved = (id: string): void => {
    const ball = handles.get(id);
    if (!ball) return;
    armature.reach(id, ball.getWorldPosition(dragPoint));
    armature.repin(id);
    armature.applyPins(id);
    // Back where the hand or foot got to, which the gizmo then follows.
    syncHandles();
    placeControls();
    refreshPanel();
    scheduleSave();
  };

  // --- IK handles ------------------------------------------------------------
  // A ball at each chain's far end. Drag one and the limb reaches for it;
  // pin one and it holds its ground while the rest of the figure moves.
  // One more sits in the hips for the root: drag it and the whole figure
  // moves, as the pelvis gizmo's centre moves it, without the gizmo.
  // Drawn over everything (depth test off): a handle you cannot click
  // because the figure's own arm is in front of it is no handle at all.
  const handleGroup = new Group();
  handleGroup.name = 'ik-handles';
  viewer.scene.add(handleGroup);
  const handleGeometry = new SphereGeometry(1, 16, 12);
  const freeMat = new MeshBasicNodeMaterial();
  freeMat.color.set('#c87049');
  freeMat.depthTest = false;
  freeMat.depthWrite = false;
  freeMat.transparent = true;
  freeMat.opacity = 0.85;
  const pinnedMat = new MeshBasicNodeMaterial();
  pinnedMat.color.set('#f0d9a8');
  pinnedMat.depthTest = false;
  pinnedMat.depthWrite = false;
  // The aim balls at the knees and elbows: smaller, and a cool grey so
  // they read as a different job from the warm reach balls.
  const aimMat = new MeshBasicNodeMaterial();
  aimMat.color.set('#9ab6c8');
  aimMat.depthTest = false;
  aimMat.depthWrite = false;
  aimMat.transparent = true;
  aimMat.opacity = 0.85;
  // The root's ball: a deep violet, apart from the warm reach balls and the
  // pale aim balls for everyone. A green, the obvious colour for the
  // ground, is the rust's twin to red-green colour blindness.
  const rootMat = new MeshBasicNodeMaterial();
  rootMat.color.set('#7a5cc0');
  rootMat.depthTest = false;
  rootMat.depthWrite = false;
  rootMat.transparent = true;
  rootMat.opacity = 0.85;
  // A ball selected by a tap: lit up, and a size larger.
  const selectedMat = new MeshBasicNodeMaterial();
  selectedMat.color.set('#ffb070');
  selectedMat.depthTest = false;
  selectedMat.depthWrite = false;
  // A ring on the floor under each foot planting holds flat (owner report:
  // the box seemed to do nothing, since pins - not planting - hold a foot
  // in place, and a foot standing flat looks much as one at rest).
  const plantGroup = new Group();
  plantGroup.name = 'plant-marks';
  viewer.scene.add(plantGroup);
  const plantMat = new MeshBasicNodeMaterial();
  plantMat.color.set('#c87049');
  plantMat.transparent = true;
  plantMat.opacity = 0.7;
  plantMat.depthWrite = false;
  const plantGeometry = new RingGeometry(0.72, 1, 40);
  plantGeometry.rotateX(-Math.PI / 2);
  const plantMarks = new Map<string, Mesh>();
  const markAt = new Vector3();
  const syncPlantMarks = (): void => {
    const planted = new Set(armature.plantedFeet());
    const floor = viewer.lockedFloor() ?? 0;
    for (const [foot, ring] of plantMarks) {
      if (!planted.has(foot)) ring.visible = false;
    }
    for (const foot of planted) {
      let ring = plantMarks.get(foot);
      if (!ring) {
        ring = new Mesh(plantGeometry, plantMat);
        ring.name = `plant:${foot}`;
        ring.renderOrder = 20;
        plantGroup.add(ring);
        plantMarks.set(foot, ring);
      }
      armature.effectorWorld(foot, markAt, 0.5);
      // About a foot's length across, a hair above the floor.
      ring.scale.setScalar(0.13 * armature.scale);
      ring.position.set(markAt.x, floor + 0.002 * armature.scale, markAt.z);
      ring.visible = true;
    }
  };
  const HANDLE_RADIUS = 1.9;
  const SELECTED_SCALE = 1.35;
  const AIM_RADIUS = 1.3;
  let handlesOn = true;
  const handles = new Map<string, Mesh>();
  const aims = new Map<string, Mesh>();
  // Every figure has one root, so one ball serves them all and is kept
  // through a change of figure.
  const rootBall = new Mesh(handleGeometry, rootMat);
  rootBall.name = ROOT_BALL;
  rootBall.scale.setScalar(HANDLE_RADIUS);
  rootBall.renderOrder = 30;
  rootBall.frustumCulled = false;
  handleGroup.add(rootBall);
  const buildHandles = (): void => {
    for (const m of [...handles.values(), ...aims.values()]) m.removeFromParent();
    handles.clear();
    aims.clear();
    for (const c of armature.chains()) {
      const m = new Mesh(handleGeometry, freeMat);
      m.name = `ik:${c.id}`;
      m.scale.setScalar(HANDLE_RADIUS);
      m.renderOrder = 30;
      m.frustumCulled = false;
      handleGroup.add(m);
      handles.set(c.id, m);
      if (!c.poleRef) continue;
      const a = new Mesh(handleGeometry, aimMat);
      a.name = `aim:${c.id}`;
      a.scale.setScalar(AIM_RADIUS);
      a.renderOrder = 30;
      a.frustumCulled = false;
      handleGroup.add(a);
      aims.set(c.id, a);
    }
  };
  const syncHandles = (): void => {
    // Every pose change, selection and figure swap comes through here: the
    // picture changed, so a still frame's smoothing starts over.
    viewer.invalidate();
    syncPlantMarks();
    handleGroup.visible = handlesOn;
    if (!handlesOn) return;
    const at = new Vector3();
    for (const [id, m] of handles) {
      const c = armature.chain(id);
      if (!c) continue;
      armature.effectorWorld(c.effector, at);
      m.position.copy(at);
      m.material = id === selectedHandle ? selectedMat : armature.isPinned(id) ? pinnedMat : freeMat;
      m.scale.setScalar(id === selectedHandle ? HANDLE_RADIUS * SELECTED_SCALE : HANDLE_RADIUS);
    }
    for (const [id, m] of aims) {
      const where = armature.hingeWorld(id, at);
      m.visible = !!where;
      if (where) m.position.copy(where);
    }
    rootBall.position.copy(armature.rootHandleWorld(at));
  };
  buildHandles();
  // Placed now, not on the first interaction: until then every ball sat at
  // the origin, between the feet, where a press could take the wrong one.
  syncHandles();

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const aim = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, viewer.camera);
  };
  // The handle being dragged, and the plane it slides on: through where it
  // was grabbed, facing the camera, so the drag follows the pointer.
  let reaching: string | null = null;
  /** The knee or elbow being aimed, if any. */
  let aiming: string | null = null;
  /**
   * The root being moved by its ball: where the press met the ball's plane
   * and where the root stood then, in the world. The root goes by what the
   * pointer has moved since, as the gizmo's centre moves it, so a press
   * that landed off the ball's centre does not make the figure jump.
   */
  let moving: { from: Vector3; root: Vector3 } | null = null;
  /** A ball or a gizmo is being dragged: the figure is moving under the pointer. */
  const dragUnderway = (): boolean => dragging || reaching !== null || aiming !== null || moving !== null;
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
  // for itself, while the view moves): Viewer.updateFrameMode.
  viewer.fastFrames = true;
  viewer.interactionProbe = () => (dragUnderway() ? 'move' : null);
  // Anti-aliasing as Preferences says, as in Sculpt (the viewer's own is 4x MSAA).
  const applyAntialias = (): void => viewer.setAntialias(settings.get('antialias'));
  applyAntialias();
  const offAntialias = settings.onChange(applyAntialias);
  const dragPlane = new Plane();
  const dragPoint = new Vector3();
  // Scratch for the aim drag, which runs on every move.
  const dragNormal = new Vector3();
  const hingeAt = new Vector3();
  /** What the last press took: 'ik:<chain>', 'aim:<chain>', 'root', a part's bone, or nothing. */
  let picked: string | null = null;
  /** How near a ball's centre a press has to land to take it, in CSS pixels. */
  const PICK_RADIUS = 18;
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
  const ballOnScreen = (ball: Mesh): [number, number] | null => toPage(ball.getWorldPosition(new Vector3()));
  interface Ball {
    kind: 'ik' | 'aim' | 'root';
    /** The chain, or for the root its bone. */
    id: string;
    ball: Mesh;
  }
  /** Every ball, the aim balls first and the root's last. */
  const balls = (): Ball[] => [
    ...[...aims].map(([id, ball]): Ball => ({ kind: 'aim', id, ball })),
    ...[...handles].map(([id, ball]): Ball => ({ kind: 'ik', id, ball })),
    { kind: 'root', id: armature.root.name, ball: rootBall },
  ];
  /** What a press on a ball records: 'aim:<chain>', 'ik:<chain>' or 'root'. */
  const ballName = (b: Ball): string => (b.kind === 'root' ? ROOT_BALL : `${b.kind}:${b.id}`);
  /**
   * The ball a press takes: the nearest visible one whose centre lands
   * within PICK_RADIUS of the pointer on screen, however deep it sits
   * (owner call: the handles win over the parts). A ball is a few pixels
   * across, and a press that had to land on the ball itself, with a part
   * right behind it taking every near miss, made the knees and elbows the
   * hardest things on the figure to grab. On a tie the aim ball wins,
   * being the smaller, and the root's loses, being the one that moves
   * everything.
   */
  const ballUnder = (e: PointerEvent): Ball | null => {
    if (!handlesOn) return null;
    let best: Ball | null = null;
    let nearest = Infinity;
    for (const b of balls()) {
      const at = b.ball.visible ? ballOnScreen(b.ball) : null;
      if (!at) continue;
      const d = Math.hypot(at[0] - e.clientX, at[1] - e.clientY);
      if (d <= PICK_RADIUS && d < nearest) {
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
    if (aiming) {
      // Where the pointer sits around the limb IS the aim. The plane it
      // reads on cuts across the limb at the joint, so the angle is the
      // one the solver wants and the hand or foot never moves.
      aim(e);
      const at = armature.hingeWorld(aiming, hingeAt);
      if (!at) return;
      dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragNormal), at);
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
    if (!reaching && !aiming && !moving) return;
    reaching = null;
    aiming = null;
    moving = null;
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
  // The chips where Sculpt has them, at the foot of the left edge.
  const histButtons = new HistoryButtons({
    undo,
    redo,
    canUndo: () => undoStack.length > 0 || pendingStep !== 0,
    canRedo: () => redoStack.length > 0,
  });
  histButtons.el.classList.add('armature-hist');
  document.body.appendChild(histButtons.el);

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
    symmetry: armature.symmetry,
  });
  /** The library project Save to library writes to (project.ts), kept in the autosave record. */
  let link: ArmatureLink | null = bootLink;
  let saveTimer = 0;
  const flushSave = async (): Promise<void> => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    await saveArmature(currentFile());
  };
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), SAVE_GAP_MS);
  };
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
      thumb = await viewer.captureThumbnail(320, smooth);
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
  const galleryLink = document.querySelector<HTMLAnchorElement>('.viewer-back');
  const onLeave = (e: MouseEvent): void => {
    if (!galleryLink || e.defaultPrevented || e.button !== 0) return;
    e.preventDefault();
    void snapshot().finally(() => {
      // The site's root, never the link's own address (main.ts addGalleryLink).
      window.location.href = '/';
    });
  };
  galleryLink?.addEventListener('click', onLeave);
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
    } catch (err) {
      alert(err instanceof ArmatureFileError || err instanceof Error ? err.message : String(err));
      return;
    }
    name = parsed.name;
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
      alert(`That model could not be read: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    model = { bytes, name: file.name };
    name = file.name.replace(/\.(glb|gltf)$/i, '') || 'Model';
    await replaceFigure(IMPORTED, undefined, true);
    frame();
    // Another figure altogether: its own history, and no project yet (the
    // library keeps the built-in figures; a model stays on this device).
    link = null;
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
    await saveHandoff({
      v: 1,
      name: 'Figure',
      positions: bake.positions,
      indices: bake.indices,
      resolution,
      look: viewer.getLook(),
      savedAt: Date.now(),
    });
    await flushSave();
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
  // What an opened project needed mending, or why it did not open: said
  // now that there is a page to say it on.
  for (const note of bootNotes) {
    panel.setNote(note);
    statusToast('').fail(note);
  }
  // An opened project is the work on this device now: the autosave says so at once.
  if (bootSymmetry !== null) scheduleSave();

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
  let roleKnown = probeRole();
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
      const picture = await capture(true);
      const bytes = await encodeArmatureProject(currentFile(), armature.symmetry);
      const target = link;
      const saved = await uploadArmature(
        { bytes, title: target?.title ?? defaultArmatureTitle(name), thumb: picture ?? undefined, projectId: target?.id, scope: target?.scope },
        (text) => status.set(text),
      );
      link = saved;
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
            roleKnown = probeRole();
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

  const fileMenu = new TopMenu(
    'File',
    [
      {
        label: 'New armature',
        action: () => {
          if (undoStack.length && !confirm('Start a new armature? The current pose and proportions go.')) return;
          name = 'Armature';
          // A new armature is nobody's project, with a history of its own.
          link = null;
          void replaceFigure(armature.rig.id, undefined, true).then(() => {
            frame();
            clearHistory();
          });
        },
      },
      { label: 'Open…', action: () => openInput.click() },
      { label: 'Load model…', action: () => modelInput.click() },
      { label: 'Save', action: () => downloadBlob(packArmature(currentFile()), armatureStamp()) },
      { label: 'Save to library', hint: libraryHint, action: () => void saveToLibrary() },
      { separator: true },
      { label: 'Send to Sculpt', action: () => void send(panel.resolution) },
    ],
    'file-menu--file',
  );
  const editMenu = new TopMenu(
    'Edit',
    [
      { label: 'Undo', action: undo },
      { label: 'Redo', action: redo },
      { separator: true },
      { label: 'Preferences…', action: () => showPreferences('armature') },
    ],
    'file-menu--edit',
  );

  // --- keys ------------------------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (isTextEntryTarget(e) || document.body.classList.contains('has-modal')) return;
    const action = keymap.actionFor(e, 'armature');
    if (!action) return;
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
      case 'arm.resetPose':
        armature.resetPose();
        select(selected);
        commit();
        break;
      case 'arm.deselect':
        select(null);
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
    hingePosition: (id: string) => {
      const at = armature.hingeWorld(id, new Vector3());
      return at ? at.toArray() : null;
    },
    /** Where a chain's ball, or with 'root' the root's, sits in the world. */
    handlePosition: (id: string) => {
      if (id === ROOT_BALL) return armature.rootHandleWorld(new Vector3()).toArray();
      const c = armature.chain(id);
      return c ? armature.effectorWorld(c.effector, new Vector3()).toArray() : null;
    },
    /**
     * Where a ball ('ik:<chain>', 'aim:<chain>' or 'root') sits on the page:
     * its centre and its drawn radius, in CSS pixels; null when it is not
     * shown.
     */
    ballOnScreen: (name: string): [number, number, number] | null => {
      const ball = balls().find((b) => ballName(b) === name)?.ball;
      const at = ball?.visible && handlesOn ? ballOnScreen(ball) : null;
      if (!ball || !at) return null;
      const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1).normalize();
      const rim = toPage(ball.getWorldPosition(new Vector3()).addScaledVector(up, ball.scale.x));
      return [at[0], at[1], rim ? Math.hypot(rim[0] - at[0], rim[1] - at[1]) : 0];
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
    galleryLink?.removeEventListener('click', onLeave);
    select(null);
    viewer.fastFrames = false;
    viewer.interactionProbe = null;
    offAntialias();
    viewer.setAntialias('always');
    viewer.setSculptVisible(true);
    for (const tc of controls) {
      viewer.scene.remove(tc.getHelper());
      tc.dispose();
    }
    viewer.removeSculptExtra(armature.mesh);
    armature.dispose();
    viewer.scene.remove(handleGroup);
    viewer.scene.remove(plantGroup);
    plantGeometry.dispose();
    plantMat.dispose();
    viewer.lockFloor(null);
    handleGeometry.dispose();
    panel.dispose();
    fileMenu.dispose();
    editMenu.dispose();
    if (pendingStep) clearTimeout(pendingStep);
    histButtons.dispose();
    openInput.remove();
    modelInput.remove();
    delete (window as unknown as { __armature?: object }).__armature;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false, mode: 'view' } }));
  };
}

export type { Armature };
export { Box3 };
