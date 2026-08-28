import { Box3, Matrix4, Vector3 } from 'three';
import type { Viewer } from '../viewer/Viewer';
import { BrushCursor } from './bridge/BrushCursor';
import { CameraAdapter } from './bridge/CameraAdapter';
import { GeometrySync } from './bridge/GeometrySync';
import { InputShell } from './bridge/InputShell';
import Tablet from '@sculpt-vendor/misc/Tablet';
import { SculptSession } from './bridge/SculptSession';
import { ScenePersist, clearSavedScene, loadSavedScene } from './bridge/ScenePersist';
import { SculptToolbar } from './ui/SculptToolbar';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Mount sculpt mode into a running Viewer (plan section 5): build the vendored
 * editing session around Bozzetto's camera and canvas, adopt the sculpt mesh
 * as the scene subject, and arbitrate input ahead of OrbitControls.
 *
 * Mount defaults (plan 7.5, chosen for GPU cost): key light only, shadows
 * off, DoF off; the previous viewer state is restored on unmount. The default
 * sphere is ~50k triangles with its multiresolution stack available on
 * d / shift+d / ctrl+d.
 */
export async function mountSculptMode(viewer: Viewer): Promise<() => void> {
  const canvas = viewer.captureCanvas;
  const container = canvas.parentElement as HTMLElement;

  const camera = new CameraAdapter(viewer.camera, canvas);
  const session = new SculptSession(camera, canvas, () => {});
  // Reload safety: a saved session takes the sphere's place (ScenePersist).
  let saved = await loadSavedScene();
  let multimesh;
  try {
    multimesh = saved ? session.addRestoredMesh(saved) : session.addSphere();
  } catch (err) {
    // A malformed record must never brick sculpt entry: drop it, start clean.
    console.warn('sculpt restore failed, starting fresh:', err);
    void clearSavedScene();
    saved = null;
    multimesh = session.addSphere();
  }

  const sync = new GeometrySync();
  sync.bind(multimesh as unknown as SculptMesh);

  // The display mesh adopts the sculpt geometry (with the vendor mesh's
  // matrix: its normalizeSize scales by matrix, not by baking), so the whole
  // settings panel - material mode, albedo/roughness, matcaps, smooth/flat,
  // wireframe - drives the sculpt subject through the existing machinery.
  viewer.enterSculpt(
    sync.geometry,
    new Matrix4().fromArray(multimesh.getMatrix()),
    liveWorldBox(multimesh as unknown as SculptMesh),
  );

  // Performance defaults (plan 7.5): one light, no shadows, no DoF, no HDRI
  // environment sampling (the hemisphere ambient carries the fill; cheapest
  // possible IBL is none), and the cavity composite instead of GTAO. All
  // saved and restored around the session.
  const lighting = viewer.lighting;
  const savedLights = lighting.serialize();
  const savedDof = viewer.getDoFState();
  const savedEnv = viewer.scene.environment;
  const savedMaterial = viewer.materials.getMaterialState();
  const savedShadowsMaster = lighting.getShadowsMaster();
  const savedGround = viewer.getGround();
  lighting.setEnabled('fill', false);
  lighting.setEnabled('rim', false);
  lighting.setShadowsMaster(false);
  if (savedDof.enabled) viewer.setDoF({ enabled: false });
  viewer.onDofChange?.();
  viewer.scene.environment = null;
  viewer.setSculptShading(true);
  // Flat shading is the sculpt default; the panel checkbox drives it live.
  viewer.materials.setFlatShading(true);
  // No stage under a work in progress: the floor/pedestal hid the sculpt's
  // underside. g (or the panel) cycles it back on when wanted.
  viewer.setGround('off');

  // Dyntopo, undo and subdivision can swap the active mesh instance; follow it.
  session.onActiveMeshChange = () => {
    const active = session.getMesh();
    if (!active) return;
    sync.bind(active);
    viewer.setSculptMatrix(new Matrix4().fromArray(active.getMatrix()));
  };

  // A small transient pill announces level moves ("Subdiv 2/4"): steps,
  // ctrl+d, and undo/redo that land on another level.
  const levelToast = makeLevelToast();
  session.onLevelChange = (sel, levels) => levelToast.show(sel + 1, levels);

  // Top-left stats: active object name + live triangle count (the name
  // column becomes the scene graph/outliner entry point later).
  const stats = makeStatsCorner(session);

  const cursor = new BrushCursor(container, viewer.scene);
  const input = new InputShell(session, container, cursor, {
    frameModel: () => {
      const active = session.getMesh();
      if (active) viewer.frameBounds(liveWorldBox(active));
    },
    focusEdit: (point) => viewer.orbitAt(point),
    toggleShadows: () => {
      lighting.setShadowsMaster(!lighting.getShadowsMaster());
    },
    rotateLightRig: (deltaDeg) => {
      const deg = lighting.getRigRotation() + deltaDeg;
      lighting.setRigRotation(deg);
      viewer.environment.setRotation(lighting.getRigRotation());
    },
  });
  input.install();
  const toolbar = new SculptToolbar(input);

  // Autosave from here on; if a session was restored, say so and offer a
  // way back to a clean sphere.
  const persist = new ScenePersist(session);
  persist.install();
  const toast = saved
    ? restoredToast(() => {
        persist.disable();
        void clearSavedScene().then(() => location.reload());
      })
    : null;

  // Console/debug handle, mirroring window.__bozzetto:
  //   __sculpt.session.getMesh().getNbVertices(), __sculpt.sync.stats, etc.
  (window as unknown as { __sculpt?: object }).__sculpt = {
    session,
    sync,
    input,
    persist,
    cursor,
    tablet: Tablet,
  };

  // The hotkey guide (H) swaps to the sculpt table while the mode is active.
  window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: true } }));

  return () => {
    delete (window as unknown as { __sculpt?: object }).__sculpt;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false } }));
    toast?.remove();
    session.onLevelChange = null;
    levelToast.dispose();
    stats.dispose();
    persist.dispose();
    toolbar.dispose();
    input.dispose();
    cursor.dispose();
    session.onActiveMeshChange = null;
    lighting.applyState(savedLights);
    lighting.setShadowsMaster(savedShadowsMaster);
    viewer.setGround(savedGround);
    viewer.environment.setRotation(lighting.getRigRotation());
    viewer.scene.environment = savedEnv;
    viewer.setSculptShading(false);
    viewer.materials.applyMaterialState(savedMaterial);
    viewer.setDoF(savedDof);
    viewer.onDofChange?.();
    viewer.exitSculpt();
    sync.dispose();
  };
}

/** Top-left corner stats: object name + live poly count (polled, cheap). */
function makeStatsCorner(session: SculptSession): { dispose(): void } {
  const el = document.createElement('div');
  el.className = 'sculpt-stats';
  const name = document.createElement('div');
  name.className = 'sculpt-stats__name';
  const tris = document.createElement('div');
  tris.className = 'sculpt-stats__tris';
  el.append(name, tris);
  document.body.appendChild(el);
  const update = (): void => {
    const mesh = session.getMesh();
    name.textContent = session.activeName();
    tris.textContent = mesh ? `${mesh.getNbTriangles().toLocaleString('en-US')} tris` : '';
  };
  update();
  const timer = window.setInterval(update, 500);
  return {
    dispose() {
      clearInterval(timer);
      el.remove();
    },
  };
}

/** Transient "Subdiv 2/4" pill; repeated steps reuse it and reset the fade. */
function makeLevelToast(): { show(at: number, total: number): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'sculpt-leveltoast';
  document.body.appendChild(el);
  let timer = 0;
  return {
    show(at, total) {
      el.textContent = `Subdiv ${at}/${total}`;
      el.classList.add('is-visible');
      clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove('is-visible'), 1200);
    },
    dispose() {
      clearTimeout(timer);
      el.remove();
    },
  };
}

/** "Restored your sculpt" notice with a start-fresh escape hatch. */
function restoredToast(onFresh: () => void): HTMLDivElement {
  const toast = document.createElement('div');
  toast.className = 'sculpt-toast';
  const label = document.createElement('span');
  label.textContent = 'Restored your last sculpt';
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'sculpt-toast__btn';
  fresh.textContent = 'Start fresh';
  fresh.addEventListener('click', onFresh);
  toast.append(label, fresh);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 10000);
  return toast;
}

/** World-space box of the live vertex region (over-allocated tail excluded). */
function liveWorldBox(mesh: SculptMesh): Box3 {
  const v = mesh.getVertices();
  const n = mesh.getNbVertices() * 3;
  const box = new Box3();
  const p = new Vector3();
  for (let i = 0; i < n; i += 3) {
    box.expandByPoint(p.set(v[i], v[i + 1], v[i + 2]));
  }
  return box.applyMatrix4(new Matrix4().fromArray(mesh.getMatrix()));
}
