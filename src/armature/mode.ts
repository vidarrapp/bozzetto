import { Box3, Group, Mesh, Plane, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, normalLocal, positionLocal } from 'three/tsl';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Viewer } from '../viewer/Viewer';
import { keymap } from '../ui/keymap';
import { isTextEntryTarget } from '../ui/dom';
import { showPreferences } from '../ui/Preferences';
import { downloadBlob } from '../ui/download';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { Armature, buildArmature, type ArmatureState } from './Armature';
import { ArmaturePanel } from './ArmaturePanel';
import { armatureStamp, packArmature, unpackArmature } from './file';
import { loadArmature, saveArmature, saveHandoff, type ArmatureFile } from './persist';

const HISTORY_LIMIT = 64;
const SAVE_GAP_MS = 400;

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
  let name = saved?.name ?? 'Armature';
  let armature = buildArmature(saved?.state.preset ?? 'placeholder-male', viewer.materials.get(viewer.getMaterial()));
  if (saved) {
    try {
      armature.restore(saved.state);
    } catch (err) {
      console.warn('armature: saved state ignored', err);
    }
  }
  viewer.adoptMesh(armature.mesh);
  if (saved?.look) await viewer.applyLook(saved.look);

  const frame = (): void => {
    const box = armature.bounds();
    if (!box.isEmpty()) viewer.frameBounds(box);
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
      if (selected && armature.def(selected)?.kind !== 'root') armature.clampPose(selected);
      // Pinned hands and feet hold their ground while the rest moves; this
      // is what lets the pelvis drop into a crouch with the feet planted.
      armature.applyPins();
      syncHandles();
      panel.refresh(selected);
      scheduleSave();
    });
  }
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
      const use = def.kind === 'root' ? controls : [rotateTc];
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
  const HANDLE_RADIUS = 1.9;
  let handlesOn = true;
  const handles = new Map<string, Mesh>();
  const buildHandles = (): void => {
    for (const m of handles.values()) m.removeFromParent();
    handles.clear();
    for (const c of armature.chains()) {
      const m = new Mesh(handleGeometry, freeMat);
      m.name = `ik:${c.id}`;
      m.scale.setScalar(HANDLE_RADIUS);
      m.renderOrder = 30;
      m.frustumCulled = false;
      handleGroup.add(m);
      handles.set(c.id, m);
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
  };
  buildHandles();

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
  const dragPlane = new Plane();
  const dragPoint = new Vector3();
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
      if (t.axis) return;
    }
    aim(e);
    // The IK balls come first: they are drawn over the figure, so they
    // must be picked over it too.
    if (handlesOn) {
      const ball = raycaster.intersectObjects([...handles.values()], false)[0];
      if (ball) {
        reaching = ball.object.name.slice(3);
        dragPlane.setFromNormalAndCoplanarPoint(
          viewer.camera.getWorldDirection(dragPoint).clone(),
          ball.object.position,
        );
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
    }
    const hit = raycaster.intersectObject(armature.mesh, false)[0];
    select(hit ? armature.boneAt(hit) : null);
  };
  const onPointerMove = (e: PointerEvent): void => {
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
    if (!reaching) return;
    reaching = null;
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

  const currentFile = (): ArmatureFile => ({
    kind: 'bozzetto-armature',
    v: 1,
    name,
    state: armature.serialize(),
    look: viewer.getLook(),
    savedAt: Date.now(),
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
  const onLookEdit = (): void => scheduleSave();
  document.addEventListener('input', onLookEdit);
  document.addEventListener('change', onLookEdit);
  const onHidden = (): void => void flushSave();
  window.addEventListener('pagehide', onHidden);

  // --- the figure: presets and files ----------------------------------------------
  /**
   * Swap the figure: a different preset, a file being opened, or a fresh
   * start. Without a state the new figure keeps where the old one stood -
   * changing preset should not move it - unless `fresh`, which leaves it
   * standing on the rig's own rest position, feet on the ground.
   */
  const replaceFigure = (preset: string, state?: ArmatureState, fresh = false): void => {
    select(null);
    viewer.removeSculptExtra(armature.mesh);
    const root = { position: armature.root.position.clone(), quaternion: armature.root.quaternion.clone() };
    const symmetry = armature.symmetry;
    armature.dispose();
    armature = buildArmature(preset, viewer.materials.get(viewer.getMaterial()));
    armature.symmetry = symmetry;
    if (state) armature.restore(state);
    else if (!fresh) {
      armature.root.position.copy(root.position);
      armature.root.quaternion.copy(root.quaternion);
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
    replaceFigure(parsed.state.preset, parsed.state);
    if (parsed.look) await viewer.applyLook(parsed.look);
    frame();
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

  // --- the panel --------------------------------------------------------------------
  const panel = new ArmaturePanel(
    () => armature,
    {
      preset: (id) => replaceFigure(id),
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
      joint: (bone, xyz) => {
        armature.setPoseEuler(bone, xyz[0], xyz[1], xyz[2]);
        armature.applyPins();
        placeControls();
        syncHandles();
        commit();
      },
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
  const fileMenu = new TopMenu(
    'File',
    [
      {
        label: 'New armature',
        action: () => {
          if (history.length && !confirm('Start a new armature? The current pose and proportions go.')) return;
          name = 'Armature';
          replaceFigure(armature.rig.id, undefined, true);
          frame();
        },
      },
      { label: 'Open…', action: () => openInput.click() },
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
        select(armature.root.name);
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
    handlePosition: (id: string) => {
      const c = armature.chain(id);
      return c ? armature.effectorWorld(c.effector, new Vector3()).toArray() : null;
    },
    select,
    selected: () => selected,
    state: () => armature.serialize(),
    undo,
    redo,
    commit,
    send,
    save: flushSave,
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
    select(null);
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
    delete (window as unknown as { __armature?: object }).__armature;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false, mode: 'view' } }));
  };
}

export type { Armature };
export { Box3 };
