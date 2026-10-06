import { LoadingManager } from 'three';
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

/**
 * Whether a glTF may fetch `url` for a buffer or an image it names. Every
 * file the app parses carries what it needs inside itself (a .glb's own
 * buffer, an embedded image's blob: or data: URL), but a glTF may name
 * anything as a buffer's or an image's `uri`, and the loader would fetch
 * it: a timelapse frame or a figure saying "https://elsewhere/p.bin" had
 * every viewer's browser ask that server for it. Paths on this site stay
 * allowed; nothing else is fetched. A page whose origin is opaque (a
 * single-file export opened from disk) has no paths of its own.
 */
export function allowedGltfUrl(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  try {
    const at = new URL(url, window.location.href);
    return at.origin !== 'null' && at.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function getGLTFLoader(): GLTFLoader {
  if (!loader) {
    // Every fetch the loader makes asks the manager for its URL first, so
    // a refusal here happens before any request: the load of that buffer
    // or image fails with this message (a missing image leaves the model
    // without it, a missing buffer fails the parse).
    const manager = new LoadingManager();
    manager.setURLModifier((url) => {
      if (allowedGltfUrl(url)) return url;
      throw new Error(`A model asked for "${url.slice(0, 120)}", which is not loaded: models carry their own data`);
    });
    loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}
