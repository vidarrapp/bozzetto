/**
 * Will this model work in Armature mode?
 *
 *   node tools/inspect-glb.mjs [file.glb]
 *
 * It runs the app's own reader over the file and prints the rig it got:
 * the bones and what each joint is, the reach chains, and - the part worth
 * reading - everything the file did not say that had to be worked out.
 */
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2] ?? 'tools/test-figure.glb';
const dir = await mkdtemp(join(tmpdir(), 'bozz-glb-'));
const bundle = join(dir, 'b.mjs');
await build({
  stdin: {
    contents: `export * as THREE from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { rigFromGLTF, canonicalName } from './src/armature/glbRig.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});
const { THREE, GLTFLoader, rigFromGLTF } = await import(`file://${bundle}`);

const bytes = await readFile(file);
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);

let read;
try {
  read = rigFromGLTF(gltf, 'imported', 'Imported figure');
} catch (err) {
  console.log(`${file}\n  UNUSABLE: ${err.message}`);
  process.exit(1);
}
const { rig, mesh, sourceNames, inferred } = read;
const box = new THREE.Box3().setFromObject(mesh);
const weights = mesh.geometry.getAttribute('skinWeight');
let split = 0;
for (let i = 0; i < weights.count; i++) if (weights.getY(i) > 1e-4) split++;

console.log(file);
console.log(`  mesh "${mesh.name}": ${mesh.geometry.getAttribute('position').count} vertices, ${split} of them shared between bones`);
console.log(`  height ${(box.max.y - box.min.y).toFixed(3)} (metres, if the file is in metres); the rig says ${rig.height}`);
console.log(`  preset: ${rig.id} - ${rig.label}`);
console.log(`  ${rig.bones.length} bones:`);
for (const b of rig.bones) {
  const src = sourceNames[b.name];
  const renamed = src === b.name ? '' : `  (from "${src}")`;
  const lim =
    b.kind === 'root'
      ? ''
      : `  x ${b.limits.x[0]}..${b.limits.x[1]}  y ${b.limits.y[0]}..${b.limits.y[1]}  z ${b.limits.z[0]}..${b.limits.z[1]}`;
  console.log(`    ${b.name.padEnd(14)} ${b.kind.padEnd(6)} parent ${String(b.parent).padEnd(12)}${lim}${renamed}`);
}
console.log(`  ${rig.ik.length} reach chains:`);
for (const c of rig.ik) {
  console.log(`    ${c.id.padEnd(10)} ${c.label.padEnd(12)} bends ${c.links.join(' -> ')}${c.poleRef ? `  aim zero [${c.poleRef}]` : ''}`);
}
if (inferred.length) {
  console.log('  worked out, not stated in the file:');
  for (const line of inferred) console.log(`    - ${line}`);
} else {
  console.log('  nothing had to be guessed: the file said it all.');
}
