import {
  Color,
  Material,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';

export interface MaterialModeInfo {
  id: string;
  label: string;
  /** Whether the mode responds to the lighting rig (drives the shadow pass). */
  lit: boolean;
}

export interface MatcapInfo {
  id: string;
  label: string;
}

/** Per-project material look, persisted to `data.material`. */
export interface MaterialState {
  albedo: string;
  roughness: number;
  metalness: number;
  flatShading: boolean;
  matcapIndex: number;
}

interface MatcapConfig {
  id: string;
  label: string;
  url: string;
  /** Blender 2-sphere preview format: crop the left sphere as the matcap. */
  blender?: boolean;
}

const DEFAULT_ALBEDO = '#b9b1a8';

// The project's matcaps. Blender 2-sphere PNGs are cropped to their left sphere
// at load time (set `blender: true`). Replace/extend as files are added.
const MATCAPS: MatcapConfig[] = [{ id: 'clay', label: 'Clay', url: '/assets/matcaps/clay.png' }];

/**
 * Material registry (design doc §8, §9).
 *
 * Owns one instance per mode; switching mode reassigns `mesh.material`. The Lit
 * (PBR) material's albedo/roughness/metalness and a global smooth/flat-shading
 * toggle are editable and persisted per project. "Normals" is view-space.
 */
export class Materials {
  private readonly registry = new Map<string, Material>();
  private readonly matcapTextures: Texture[];
  private matcapIndex = 0;
  private flatShading = false;

  readonly modes: MaterialModeInfo[] = [
    { id: 'lit', label: 'Lit (PBR)', lit: true },
    { id: 'matcap', label: 'Matcap', lit: false },
    { id: 'normals', label: 'Normals (view space)', lit: false },
    { id: 'wireframe', label: 'Wireframe', lit: false },
  ];

  constructor() {
    this.matcapTextures = MATCAPS.map((m) => loadMatcap(m.url, m.blender ?? false));

    // Lit PBR — the default mode and the reason lighting exists.
    this.registry.set(
      'lit',
      new MeshStandardMaterial({ color: new Color(DEFAULT_ALBEDO), roughness: 0.78, metalness: 0.0 }),
    );
    // Matcap — reproduces a sculpt clay read, ignoring scene lights.
    this.registry.set('matcap', new MeshMatcapMaterial({ matcap: this.matcapTextures[0] }));
    // View-space normals — the classic shifting-rainbow visualization.
    this.registry.set('normals', new MeshNormalMaterial());
    // Flat wireframe.
    this.registry.set('wireframe', new MeshBasicMaterial({ color: 0x9fd0ff, wireframe: true }));
  }

  has(mode: string): boolean {
    return this.registry.has(mode);
  }

  get(mode: string): Material {
    const mat = this.registry.get(mode);
    if (!mat) throw new Error(`Unknown material mode: ${mode}`);
    return mat;
  }

  /** Whether a mode is lit (so the viewer can skip the shadow pass otherwise). */
  isLit(mode: string): boolean {
    return this.modes.find((m) => m.id === mode)?.lit ?? false;
  }

  matcaps(): MatcapInfo[] {
    return MATCAPS.map((m) => ({ id: m.id, label: m.label }));
  }

  setMatcapIndex(index: number): void {
    if (index < 0 || index >= this.matcapTextures.length) return;
    this.matcapIndex = index;
    const mat = this.registry.get('matcap') as MeshMatcapMaterial;
    mat.matcap = this.matcapTextures[index];
    mat.needsUpdate = true;
  }

  setAlbedo(hex: string): void {
    (this.registry.get('lit') as MeshStandardMaterial).color = new Color(hex);
  }

  setRoughness(value: number): void {
    (this.registry.get('lit') as MeshStandardMaterial).roughness = value;
  }

  setMetalness(value: number): void {
    (this.registry.get('lit') as MeshStandardMaterial).metalness = value;
  }

  /** Smooth (interpolated) vs flat (faceted) shading across the shaded modes. */
  setFlatShading(flat: boolean): void {
    this.flatShading = flat;
    for (const id of ['lit', 'matcap', 'normals']) {
      const m = this.registry.get(id) as Material & { flatShading: boolean };
      m.flatShading = flat;
      m.needsUpdate = true; // toggling flatShading recompiles the shader
    }
  }

  getMaterialState(): MaterialState {
    const lit = this.registry.get('lit') as MeshStandardMaterial;
    return {
      albedo: `#${lit.color.getHexString()}`,
      roughness: lit.roughness,
      metalness: lit.metalness,
      flatShading: this.flatShading,
      matcapIndex: this.matcapIndex,
    };
  }

  applyMaterialState(state: Partial<MaterialState>): void {
    if (state.albedo) this.setAlbedo(state.albedo);
    if (typeof state.roughness === 'number') this.setRoughness(state.roughness);
    if (typeof state.metalness === 'number') this.setMetalness(state.metalness);
    if (typeof state.matcapIndex === 'number') this.setMatcapIndex(state.matcapIndex);
    if (typeof state.flatShading === 'boolean') this.setFlatShading(state.flatShading);
  }

  dispose(): void {
    for (const tex of this.matcapTextures) tex.dispose();
    for (const mat of this.registry.values()) mat.dispose();
    this.registry.clear();
  }
}

/** Load a matcap texture, cropping the left sphere out of Blender 2-sphere PNGs. */
function loadMatcap(url: string, blender: boolean): Texture {
  if (!blender) {
    const tex = new TextureLoader().load(url);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }

  const tex = new Texture();
  tex.colorSpace = SRGBColorSpace;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const size = Math.min(Math.floor(img.naturalWidth / 2), img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size, 0, 0, size, size);
    tex.image = canvas;
    tex.needsUpdate = true;
  };
  img.src = url;
  return tex;
}
