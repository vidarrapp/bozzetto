import { meshToGLB } from '../admin/glb';
import { MemorySource } from '../viewer/AssetSource';
import type { Manifest } from '../types/manifest';

/**
 * A project-less entry for sculpt mode (/?sculpt=1): a synthetic single-frame
 * "model" manifest backed by an in-memory source, so the viewer boots without
 * touching the API or any timelapse (no transport bar, no frame streaming,
 * no environment load). The one frame is a placeholder cube that sculpt mode
 * replaces with the live sphere the moment it mounts; shared assets (matcaps)
 * still fetch from the site through MemorySource's fallback.
 */
export function sculptStandaloneProject(): { manifest: Manifest; source: MemorySource } {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5,
    0.5, -0.5, -0.5,
    0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5,
    0.5, -0.5, 0.5,
    0.5, 0.5, 0.5,
    -0.5, 0.5, 0.5,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // back
    4, 5, 6, 4, 6, 7, // front
    0, 1, 5, 0, 5, 4, // bottom
    3, 7, 6, 3, 6, 2, // top
    0, 4, 7, 0, 7, 3, // left
    1, 2, 6, 1, 6, 5, // right
  ]);
  const glb = meshToGLB(positions, indices);

  const manifest: Manifest = {
    id: 'sculpt',
    title: 'Sculpt',
    mode: 'model',
    lighting: null,
    material: null,
    environment: null,
    ao: null,
    presentation: null,
    config: { frameCount: 1, fps: 1, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
    defaults: { frame: 0, playing: false, material: 'lit', lightingPreset: 'three_point' },
    camera: { autoFrame: true },
    frames: [{ index: 0, sd: 'frames/sd/0000.glb', hd: null, tris: 12 }],
    stages: [],
  };

  const source = new MemorySource();
  source.setManifest(manifest);
  source.putFrame('frames/sd/0000.glb', glb);
  return { manifest, source };
}
