import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Shared GLTFLoader configured with the meshopt decoder (design doc §2, §5).
 *
 * One instance is reused for every frame so the meshopt WASM module is
 * initialised once. Uncompressed .glb files load through the same loader
 * unchanged, so the demo assets (which ship uncompressed) work as-is.
 */
let loader: GLTFLoader | null = null;

export function getGLTFLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}
