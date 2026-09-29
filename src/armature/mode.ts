import { Box3, Group, Mesh, Plane, Raycaster, SphereGeometry, Vector2, Vector3, type Object3D } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, normalLocal, positionLocal } from 'three/tsl';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer } from '../viewer/Viewer';
import { keymap } from '../ui/keymap';
import { isTextEntryTarget } from '../ui/dom';
import { showPreferences } from '../ui/Preferences';
import { downloadBlob } from '../ui/download';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { Armature, buildArmature, importArmature, type ArmatureState } from './Armature';
import { fetchFigure, figureById } from './figures';
import { rigFromGLTF } from './glbRig';
import { getGLTFLoader } from '../loaders/gltf';
import { ArmaturePanel } from './ArmaturePanel';
import { armatureStamp, packArmature, unpackArmature } from './file';
import { loadArmature, saveArmature, saveHandoff, type ArmatureFile } from './persist';

const HISTORY_LIMIT = 64;
const SAVE_GAP_MS = 400;
/** The preset id a figure read from a file goes under. */
const IMPORTED = 'imported';
/** The figure a new armature starts on (owner call): a mannequin, fetched on first use. */
const DEFAULT_FIGURE = 'mannequin-male-realistic';
/**
 * What stands in when a mannequin cannot be fetched or a saved model
 * cannot be read: the blocks are code, so they are always there.
 */
const FALLBACK_FIGURE = 'placeholder-male';

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
  // The Render panel, Help and Preferences all listen for this.
  window.dispatchEvent(
    new CustomEvent('bozzetto:sculptmode', { detail: { active: true, mode: 'armature' } }),
  );
  viewer.tapToFocus = false;

  const saved = await loadArmature();
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
  // fetched before anything is built; if that fails (offline, never seen)
  // the blocks stand in and a saved pose still applies, since every figure
  // shares the bone names.
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
  viewer.adoptMesh(armature.mesh);
  // The viewer boots on a synthetic one-frame manifest whose subject is a
  // placeholder cube; sculpt mode swaps its geometry, this mode brings its
  // own figure instead - so the cube has to be sent away, or it sits at the
  // origin as a tiny box (owner report).
  viewer.setSculptVisible(false);
  if (saved?.look) await viewer.applyLook(saved.look);

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
      if (!on) commit();
    });
    tc.addEventListener('objectChange', () => {
      afterGizmo(selected && armature.def(selected)?.kind !== 'root' ? selected : null);
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
    panel.refresh(selected);
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

  // --- IK handles ------------------------------------------------------------
  // A ball at each chain's far end. Drag one and the limb reaches for it;
  // pin one and it holds its ground while the rest of the figure moves.
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
  const HANDLE_RADIUS = 1.9;
  const AIM_RADIUS = 1.3;
  let handlesOn = true;
  const handles = new Map<string, Mesh>();
  const aims = new Map<string, Mesh>();
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
    handleGroup.visible = handlesOn;
    if (!handlesOn) return;
    const at = new Vector3();
    for (const [id, m] of handles) {
      const c = armature.chain(id);
      if (!c) continue;
      armature.effectorWorld(c.effector, at);
      m.position.copy(at);
      m.material = armature.isPinned(id) ? pinnedMat : freeMat;
    }
    for (const [id, m] of aims) {
      const where = armature.hingeWorld(id, at);
      m.visible = !!where;
      if (where) m.position.copy(where);
    }
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
  const dragPlane = new Plane();
  const dragPoint = new Vector3();
  /** What the last press took: 'ik:<chain>', 'aim:<chain>', a part's bone, or nothing. */
  let picked: string | null = null;
  /** How near a ball's centre a press has to land to take it, in CSS pixels. */
  const PICK_RADIUS = 18;
  const projected = new Vector3();
  /** Where a world point falls on the page, in CSS pixels; null behind the camera. */
  const toPage = (world: Vector3): [number, number] | null => {
    projected.copy(world).project(viewer.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const r = canvas.getBoundingClientRect();
    return [r.left + ((projected.x + 1) / 2) * r.width, r.top + ((1 - projected.y) / 2) * r.height];
  };
  const ballOnScreen = (ball: Mesh): [number, number] | null => toPage(ball.getWorldPosition(new Vector3()));
  /**
   * The ball a press takes: the nearest visible one whose centre lands
   * within PICK_RADIUS of the pointer on screen, however deep it sits
   * (owner call: the handles win over the parts). A ball is a few pixels
   * across, and a press that had to land on the ball itself, with a part
   * right behind it taking every near miss, made the knees and elbows the
   * hardest things on the figure to grab. On a tie the aim ball wins,
   * being the smaller.
   */
  const ballUnder = (e: PointerEvent): { kind: 'ik' | 'aim'; id: string; ball: Mesh } | null => {
    if (!handlesOn) return null;
    let best: { kind: 'ik' | 'aim'; id: string; ball: Mesh } | null = null;
    let nearest = Infinity;
    const sets: Array<['ik' | 'aim', Map<string, Mesh>]> = [
      ['aim', aims],
      ['ik', handles],
    ];
    for (const [kind, balls] of sets) {
      for (const [id, ball] of balls) {
        const at = ball.visible ? ballOnScreen(ball) : null;
        if (!at) continue;
        const d = Math.hypot(at[0] - e.clientX, at[1] - e.clientY);
        if (d <= PICK_RADIUS && d < nearest) {
          nearest = d;
          best = { kind, id, ball };
        }
      }
    }
    return best;
  };
  const onPointerDown = (e: PointerEvent): void => {
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
        return;
      }
    }
    aim(e);
    // The balls come before the parts: they are drawn over the figure, so
    // they are picked over it too, near misses included.
    const ball = ballUnder(e);
    if (ball) {
      picked = `${ball.kind}:${ball.id}`;
      if (ball.kind === 'aim') {
        aiming = ball.id;
      } else {
        reaching = ball.id;
        dragPlane.setFromNormalAndCoplanarPoint(
          viewer.camera.getWorldDirection(dragPoint).clone(),
          ball.ball.position,
        );
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
    select(picked);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (aiming) {
      // Where the pointer sits around the limb IS the aim. The plane it
      // reads on cuts across the limb at the joint, so the angle is the
      // one the solver wants and the hand or foot never moves.
      aim(e);
      const at = armature.hingeWorld(aiming, new Vector3());
      if (!at) return;
      dragPlane.setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(dragPoint).clone(), at);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      const angle = armature.aimFromPoint(aiming, dragPoint);
      if (angle !== null) {
        armature.aimChain(aiming, angle);
        armature.applyPins();
        syncHandles();
        placeControls();
        panel.refresh(selected);
        scheduleSave();
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!reaching) return;
    aim(e);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    armature.reach(reaching, dragPoint);
    armature.repin(reaching);
    armature.applyPins(reaching);
    syncHandles();
    placeControls();
    panel.refresh(selected);
    scheduleSave();
    e.preventDefault();
    e.stopPropagation();
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (!reaching && !aiming) return;
    reaching = null;
    aiming = null;
    viewer.setOrbitEnabled(true);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Never captured (synthetic events): nothing to release.
    }
    commit();
  };
  canvas.addEventListener('pointerdown', onPointerDown, true);
  canvas.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  // --- history + autosave ----------------------------------------------------
  const history: string[] = [];
  const future: string[] = [];
  let last = JSON.stringify(armature.serialize());
  const commit = (): void => {
    const now = JSON.stringify(armature.serialize());
    if (now === last) return;
    history.push(last);
    if (history.length > HISTORY_LIMIT) history.shift();
    future.length = 0;
    last = now;
    scheduleSave();
  };
  const applyState = (json: string): void => {
    armature.restore(JSON.parse(json) as ArmatureState);
    last = json;
    select(selected); // also syncs the handles and the panel
    scheduleSave();
  };
  const undo = (): void => {
    const prev = history.pop();
    if (prev === undefined) return;
    future.push(last);
    applyState(prev);
  };
  const redo = (): void => {
    const next = future.pop();
    if (next === undefined) return;
    history.push(last);
    applyState(next);
  };

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
  });
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
   * stay out of the picture: they are the tool, not the figure.
   */
  const snapshot = async (): Promise<void> => {
    const overlays: Object3D[] = [handleGroup, ...controls.map((tc) => tc.getHelper())];
    if (highlight) overlays.push(highlight);
    const shown = overlays.map((o) => o.visible);
    for (const o of overlays) o.visible = false;
    try {
      thumb = await viewer.captureThumbnail(320);
    } catch {
      // Never block leaving the page over a picture.
    } finally {
      overlays.forEach((o, i) => (o.visible = shown[i]));
    }
    await flushSave();
  };
  const onLookEdit = (): void => scheduleSave();
  document.addEventListener('input', onLookEdit);
  document.addEventListener('change', onLookEdit);
  // Leaving some other way - a reload, a closed tab: the record is saved at
  // once, and the picture follows if the page lives long enough to take it
  // (a page on its way out may never draw another frame).
  const onHidden = (): void => {
    void flushSave();
    void snapshot();
  };
  window.addEventListener('pagehide', onHidden);
  const galleryLink = document.querySelector<HTMLAnchorElement>('.viewer-back');
  const onLeave = (e: MouseEvent): void => {
    if (!galleryLink || e.defaultPrevented || e.button !== 0) return;
    e.preventDefault();
    void snapshot().finally(() => {
      window.location.href = galleryLink.href;
    });
  };
  galleryLink?.addEventListener('click', onLeave);

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
    armature.symmetry = symmetry;
    if (state) {
      armature.restore(state);
    } else if (fresh) {
      armature.pinFeet();
    } else {
      // The new figure stands where the old one stood, with the same
      // handles pinned - each taken where the new figure's hand or foot is,
      // now that it has been placed - and planting as it was.
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
  const openFile = async (file: File): Promise<void> => {
    let parsed: ArmatureFile;
    try {
      parsed = unpackArmature(await file.text());
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return;
    }
    name = parsed.name;
    await replaceFigure(parsed.state.preset, parsed.state);
    if (parsed.look) await viewer.applyLook(parsed.look);
    frame();
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
  const turnJoint = (bone: string, xyz: [number, number, number]): void => {
    armature.setPoseEuler(bone, xyz[0], xyz[1], xyz[2]);
    armature.followAims(bone);
    armature.applyPins(undefined, armature.plantFeet && !armature.isFoot(bone));
    placeControls();
    syncHandles();
    commit();
  };

  // --- the panel --------------------------------------------------------------------
  const panel = new ArmaturePanel(
    () => armature,
    {
      preset: (id) => void replaceFigure(id),
      symmetry: (on) => {
        armature.symmetry = on;
        scheduleSave();
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
      joint: turnJoint,
      proportions: (bone, p) => {
        armature.setProportions(bone, p);
        armature.applyPins();
        placeControls();
        syncHandles();
        commit();
      },
      handles: (on) => {
        handlesOn = on;
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
        commit();
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
  );

  // --- menus -------------------------------------------------------------------------
  const openInput = document.createElement('input');
  openInput.type = 'file';
  openInput.accept = '.armature,application/json';
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
  const fileMenu = new TopMenu(
    'File',
    [
      {
        label: 'New armature',
        action: () => {
          if (history.length && !confirm('Start a new armature? The current pose and proportions go.')) return;
          name = 'Armature';
          void replaceFigure(armature.rig.id, undefined, true);
          frame();
        },
      },
      { label: 'Open…', action: () => openInput.click() },
      { label: 'Load model…', action: () => modelInput.click() },
      { label: 'Save', action: () => downloadBlob(packArmature(currentFile()), armatureStamp()) },
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
        scheduleSave();
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
    handlePosition: (id: string) => {
      const c = armature.chain(id);
      return c ? armature.effectorWorld(c.effector, new Vector3()).toArray() : null;
    },
    /**
     * Where a ball ('ik:<chain>' or 'aim:<chain>') sits on the page: its
     * centre and its drawn radius, in CSS pixels; null when it is not shown.
     */
    ballOnScreen: (name: string): [number, number, number] | null => {
      const [kind, id] = [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)];
      const ball = (kind === 'aim' ? aims : kind === 'ik' ? handles : null)?.get(id);
      const at = ball?.visible && handlesOn ? ballOnScreen(ball) : null;
      if (!ball || !at) return null;
      const up = new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 1).normalize();
      const rim = toPage(ball.getWorldPosition(new Vector3()).addScaledVector(up, ball.scale.x));
      return [at[0], at[1], rim ? Math.hypot(rim[0] - at[0], rim[1] - at[1]) : 0];
    },
    /** What the last press on the figure took: 'ik:<chain>', 'aim:<chain>', a bone, or null. */
    picked: () => picked,
    select,
    selected: () => selected,
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
  };
  (window as unknown as { __armature?: object }).__armature = handle;

  return () => {
    void flushSave();
    window.removeEventListener('keydown', onKey, true);
    canvas.removeEventListener('pointerdown', onPointerDown, true);
    canvas.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    document.removeEventListener('input', onLookEdit);
    document.removeEventListener('change', onLookEdit);
    window.removeEventListener('pagehide', onHidden);
    galleryLink?.removeEventListener('click', onLeave);
    select(null);
    viewer.setSculptVisible(true);
    for (const tc of controls) {
      viewer.scene.remove(tc.getHelper());
      tc.dispose();
    }
    viewer.removeSculptExtra(armature.mesh);
    armature.dispose();
    viewer.scene.remove(handleGroup);
    handleGeometry.dispose();
    panel.dispose();
    fileMenu.dispose();
    editMenu.dispose();
    openInput.remove();
    modelInput.remove();
    delete (window as unknown as { __armature?: object }).__armature;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false, mode: 'view' } }));
  };
}

export type { Armature };
export { Box3 };
