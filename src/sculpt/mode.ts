import { Box3, Matrix4, Mesh, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Viewer } from '../viewer/Viewer';
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
 * WS0 scope: the default sphere, Brush/Smooth/Drag on keys 1/2/3, a fixed
 * standard material (the look-panel material bridge lands in WS3), and no
 * capture yet (WS5).
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

  const input = new InputShell(session, container);
  input.install();

  // Console/debug handle, mirroring window.__bozzetto:
  //   __sculpt.session.getMesh().getNbVertices(), etc.
  (window as unknown as { __sculpt?: object }).__sculpt = { session, sync, subject };

  return () => {
    delete (window as unknown as { __sculpt?: object }).__sculpt;
    input.dispose();
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
