import {
  Color,
  Material,
  MeshMatcapMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from 'three';
import type { AssetSource } from './AssetSource';
import { ASSET_VERSION } from './assetVersion';

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
}

const DEFAULT_ALBEDO = '#b9b1a8';

// The project's matcaps: single-sphere PNGs loaded as-is.
const MATCAPS: MatcapConfig[] = [
  { id: 'warm-clay', label: 'Warm clay', url: '/assets/matcaps/warm-clay.png' },
  { id: 'blue-grey', label: 'Blue grey', url: '/assets/matcaps/blue-grey.png' },
  { id: 'terracotta', label: 'Terracotta', url: '/assets/matcaps/terracotta.png' },
  { id: 'silver', label: 'Silver', url: '/assets/matcaps/silver.png' },
];

/** A matcap's request URL, version-tagged so an updated PNG isn't served stale. */
function matcapUrl(url: string): string {
  return `${url}?v=${ASSET_VERSION}`;
}

/** Asset paths the matcap modes need embedded in a self-contained export. */
export function matcapAssetUrls(): string[] {
  return MATCAPS.map((m) => matcapUrl(m.url));
}

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
  ];

  constructor(source: AssetSource) {
    this.matcapTextures = MATCAPS.map((m) => loadMatcap(source, matcapUrl(m.url)));

    // Lit PBR — the default mode and the reason lighting exists. polygonOffset
    // pushes the surface back a touch so the wireframe overlay reads on top.
    this.registry.set(
      'lit',
      new MeshStandardMaterial({
        color: new Color(DEFAULT_ALBEDO),
        roughness: 0.78,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    // Matcap — reproduces a sculpt clay read, ignoring scene lights.
    this.registry.set(
      'matcap',
      new MeshMatcapMaterial({
        matcap: this.matcapTextures[0],
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
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

  /** Strength of image-based-lighting reflections/irradiance on the Lit material. */
  setEnvIntensity(value: number): void {
    (this.registry.get('lit') as MeshStandardMaterial).envMapIntensity = value;
  }

  /** Perceptual luminance of the Lit albedo (0..1) — picks the wire overlay colour. */
  albedoLuminance(): number {
    // getHexString() yields sRGB regardless of the renderer's working colour
    // space, so this matches how the albedo actually reads on screen.
    const hex = (this.registry.get('lit') as MeshStandardMaterial).color.getHexString();
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Smooth (interpolated) vs flat (faceted) shading across the shaded modes. */
  setFlatShading(flat: boolean): void {
    this.flatShading = flat;
    for (const id of ['lit', 'matcap']) {
      const m = this.registry.get(id) as Material & { flatShading: boolean };
      m.flatShading = flat;
      m.needsUpdate = true; // toggling flatShading recompiles the shader
    }
  }

  toggleFlatShading(): boolean {
    this.setFlatShading(!this.flatShading);
    return this.flatShading;
  }

  isFlatShading(): boolean {
    return this.flatShading;
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

/**
 * Load a matcap texture through the asset source. Returns an empty texture
 * immediately and fills it once the bytes arrive (decoded via a blob URL, so it
 * works over the network and from an embedded base64 registry alike).
 */
function loadMatcap(source: AssetSource, path: string): Texture {
  const tex = new Texture();
  tex.colorSpace = SRGBColorSpace;
  void source
    .getBytes(path)
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const img = new Image();
      img.onload = () => {
        tex.image = img;
        tex.needsUpdate = true;
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    })
    .catch((err) => console.error(`Matcap "${path}" failed to load:`, err));
  return tex;
}
