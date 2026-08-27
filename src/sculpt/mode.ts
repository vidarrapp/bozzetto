import { Box3, Matrix4, Mesh, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Viewer } from '../viewer/Viewer';
import { BrushCursor } from './bridge/BrushCursor';
import { CameraAdapter } from './bridge/CameraAdapter';
import { GeometrySync } from './bridge/GeometrySync';
import { InputShell } from './bridge/InputShell';
import { SculptSession } from './bridge/SculptSession';
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
export function mountSculptMode(viewer: Viewer): () => void {
  const canvas = viewer.captureCanvas;
  const container = canvas.parentElement as HTMLElement;

  const camera = new CameraAdapter(viewer.camera, canvas);
  const session = new SculptSession(camera, canvas, () => {});
  const multimesh = session.addSphere();

  const sync = new GeometrySync();
  sync.bind(multimesh as unknown as SculptMesh);

  const subject = new Mesh(
    sync.geometry,
    new MeshStandardNodeMaterial({ color: 0xc9c4bb, roughness: 0.85, metalness: 0.0 }),
  );
  // The vendor keeps vertices in local space with the mesh's own matrix (its
  // normalizeSize scales by matrix, not by baking); mirror that transform.
  subject.matrixAutoUpdate = false;
  subject.matrix.fromArray(multimesh.getMatrix());
  // Bounds of the over-allocated backing arrays are meaningless; never cull.
  subject.frustumCulled = false;
  subject.castShadow = true;
  subject.receiveShadow = true;

  viewer.enterSculpt(subject, liveWorldBox(multimesh as unknown as SculptMesh));

  // Performance defaults (plan 7.5): one light, no shadows, no DoF. Saved
  // and restored around the session.
  const lighting = viewer.lighting;
  const savedLights = lighting.serialize();
  const savedDof = viewer.getDoFState();
  lighting.setEnabled('fill', false);
  lighting.setEnabled('rim', false);
  let shadowsOn = false;
  lighting.setShadow('key', shadowsOn);
  if (savedDof.enabled) viewer.setDoF({ enabled: false });
  viewer.onDofChange?.();

  // Dyntopo, undo and subdivision can swap the active mesh instance; follow it.
  session.onActiveMeshChange = () => {
    const active = session.getMesh();
    if (!active) return;
    sync.bind(active);
    subject.matrix.fromArray(active.getMatrix());
  };

  const cursor = new BrushCursor(container);
  const input = new InputShell(session, container, cursor, {
    frameAt: (point) => viewer.orbitAt(point),
    toggleShadows: () => {
      shadowsOn = !shadowsOn;
      lighting.setShadow('key', shadowsOn);
    },
    rotateLightRig: (deltaDeg) => {
      const deg = lighting.getRigRotation() + deltaDeg;
      lighting.setRigRotation(deg);
      viewer.environment.setRotation(lighting.getRigRotation());
    },
  });
  input.install();

  // Console/debug handle, mirroring window.__bozzetto:
  //   __sculpt.session.getMesh().getNbVertices(), __sculpt.sync.stats, etc.
  (window as unknown as { __sculpt?: object }).__sculpt = { session, sync, subject };

  return () => {
    delete (window as unknown as { __sculpt?: object }).__sculpt;
    input.dispose();
    cursor.dispose();
    session.onActiveMeshChange = null;
    lighting.applyState(savedLights);
    viewer.environment.setRotation(lighting.getRigRotation());
    viewer.setDoF(savedDof);
    viewer.onDofChange?.();
    viewer.exitSculpt(subject);
    sync.dispose();
  };
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
