/**
 * Write a rigged .glb shaped like the one a Blender export will produce,
 * from the app's own rig numbers:
 *
 *   node tools/make-test-glb.mjs [out.glb] [preset]
 *
 * It exists so the glb reader can be built and tested before the real
 * model arrives, and so there is a known-good file to compare against when
 * something in the pipeline misbehaves.
 *
 * What it writes is the contract in tools/README.md: metres, Y up, facing
 * +Z, one skinned mesh over a bone tree, each part weighted to its bone,
 * a connector at each elbow and knee split 50/50 between the two bones it
 * spans, the joint limits as extras on the bone nodes, and the rig's own
 * facts as `bz_rig` on the mesh. Deliberately NOT built through the app's
 * Armature class: that would test the reader against the writer's own
 * habits (its private part bones among them) instead of against a file a
 * modeller would hand over.
 */
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--bare');
const BARE = process.argv.includes('--bare');
const OUT = args[0] ?? (BARE ? 'tools/test-figure-bare.glb' : 'tools/test-figure.glb');
const PRESET = args[1] ?? 'placeholder-male';

const dir = await mkdtemp(join(tmpdir(), 'bozz-glb-'));
const bundle = join(dir, 'bundle.mjs');
await build({
  stdin: {
    contents: `export * as THREE from 'three';
export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';`,
    resolveDir: process.cwd(),
    loader: 'js',
  },
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});
const { THREE, GLTFExporter } = await import(`file://${bundle}`);

// The exporter hands its Blob to a FileReader at the very end, which the
// browser has and node does not. A Blob can do the same job on its own.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

const { presets } = JSON.parse(await readFile('tools/rig.json', 'utf8'));
const rig = presets.find((p) => p.id === PRESET);
if (!rig) throw new Error(`no such preset: ${PRESET} (have ${presets.map((p) => p.id).join(', ')})`);

const { Bone, BoxGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, BufferGeometry } = THREE;

// --- the bones, in their rest frames ---------------------------------------
const bones = new Map();
const frames = new Map();
const worldQ = new Map();
const worldP = new Map();
for (const def of rig.bones) {
  const head = new Vector3().fromArray(def.head);
  const tail = new Vector3().fromArray(def.tail);
  const y = tail.clone().sub(head);
  const length = y.length();
  y.normalize();
  const hint = new Vector3(def.hint === 'x' ? 1 : 0, def.hint === 'y' ? 1 : 0, def.hint === 'z' ? 1 : 0);
  const x = hint.clone().sub(y.clone().multiplyScalar(hint.dot(y)));
  if (x.lengthSq() < 1e-8) x.set(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
  x.normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  worldQ.set(def.name, q);
  worldP.set(def.name, head);
  frames.set(def.name, { head, y, length, matrix: new Matrix4().compose(head, q, new Vector3(1, 1, 1)) });

  const bone = new Bone();
  bone.name = def.name;
  bone.position.copy(
    def.parent ? head.clone().sub(worldP.get(def.parent)).applyQuaternion(worldQ.get(def.parent).clone().invert()) : head,
  );
  bone.quaternion.copy(def.parent ? worldQ.get(def.parent).clone().invert().multiply(q) : q);
  // The extras a Blender export carries on each joint. --bare leaves them
  // out, which is the file someone gets by forgetting to tick Custom
  // Properties - the case the reader has to work the rig out for itself.
  if (!BARE) {
    bone.userData.bz_kind = def.kind;
    bone.userData.bz_hint = def.hint;
    bone.userData.bz_limit_x = def.limits.x;
    bone.userData.bz_limit_y = def.limits.y;
    bone.userData.bz_limit_z = def.limits.z;
    if (def.mirror) bone.userData.bz_mirror = def.mirror;
  }
  bones.set(def.name, bone);
  if (def.parent) bones.get(def.parent).add(bone);
}
const order = rig.bones.map((d) => d.name);
const root = bones.get(rig.bones.find((d) => !d.parent).name);
root.updateMatrixWorld(true);

// --- the geometry: a box per part, plus a connector at each hinge ----------
const positions = [];
const normals = [];
const indices = [];
const joints = [];
const weights = [];
const index = (name) => order.indexOf(name);

function addBox(size, matrix, bind) {
  const box = new BoxGeometry(size[0], size[1], size[2]);
  const pos = box.getAttribute('position');
  const nrm = box.getAttribute('normal');
  const base = positions.length / 3;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    positions.push(v.x, v.y, v.z);
    v.fromBufferAttribute(nrm, i).transformDirection(matrix);
    normals.push(v.x, v.y, v.z);
    joints.push(bind[0][0], bind[1] ? bind[1][0] : 0, 0, 0);
    weights.push(bind[0][1], bind[1] ? bind[1][1] : 0, 0, 0);
  }
  const idx = box.getIndex();
  for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
  box.dispose();
}

for (const def of rig.bones) {
  if (!def.part) continue;
  const f = frames.get(def.name);
  const len = def.part.length ?? f.length;
  const offset = def.part.length ? f.length / 2 : len / 2;
  addBox(
    [def.part.width, len, def.part.depth],
    f.matrix.clone().multiply(new Matrix4().makeTranslation(0, offset, 0)),
    [[index(def.name), 1]],
  );
}
// The connectors: a small block straddling each hinge, half its weight in
// the bone above and half in the bone below - the piece that makes a knee
// or an elbow read as a joint rather than a butt seam.
let connectors = 0;
for (const def of rig.bones) {
  if (def.kind !== 'hinge' || !def.parent || !def.part) continue;
  const f = frames.get(def.name);
  const size = def.part.width * 1.15;
  addBox(
    [size, size, def.part.depth * 1.15],
    new Matrix4().compose(f.head, new Quaternion().setFromRotationMatrix(f.matrix), new Vector3(1, 1, 1)),
    [[index(def.parent), 0.5], [index(def.name), 0.5]],
  );
  connectors++;
}

const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
geometry.setIndex(indices);

const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: 0xcccccc }));
mesh.name = `${rig.id}-figure`;
mesh.add(root);
mesh.bind(new Skeleton(order.map((n) => bones.get(n))));
if (!BARE) {
  mesh.userData.bz_rig = JSON.stringify({ id: rig.id, label: rig.label, height: rig.height, ik: rig.ik });
}

const scene = new Scene();
scene.add(mesh);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
await writeFile(OUT, Buffer.from(glb));
console.log(
  `${OUT}: ${(glb.byteLength / 1024).toFixed(1)} kB, ${order.length} bones, ` +
    `${positions.length / 3} vertices, ${connectors} split-weight connectors` +
    (BARE ? ', no extras' : ''),
);
void Mesh;
