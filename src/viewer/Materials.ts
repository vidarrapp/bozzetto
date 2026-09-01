import { Color, Material, SRGBColorSpace, Texture } from 'three';
import { MeshMatcapNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, materialColor, mix, uniform, vec3 } from 'three/tsl';
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

/** Fully masked vertices drop to this brightness (sculpt mask tint, WS3;
    live-adjustable from the WS4 palette through a uniform, no recompile). */
const MASK_DARKEN_DEFAULT = 0.45;

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
    // Node variants (behavior-identical to the classic materials) so sculpt
    // mode can splice the TSL mask tint into the color path.
    this.registry.set(
      'lit',
      new MeshStandardNodeMaterial({
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
      new MeshMatcapNodeMaterial({
        matcap: this.matcapTextures[0],
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
  }

  /**
   * Sculpt mask visibility (WS3): masked vertices darken. The mesh carries
   * masking in materialsPBR.z (1 = free, 0 = fully masked, verified in
   * WS2), so the tint is a per-vertex darkening of the material color -
   * which multiplies the matcap sample too, covering both modes. Only
   * active in sculpt mode: viewer subjects have no materialsPBR attribute.
   */
  private readonly maskDarkenU = uniform(MASK_DARKEN_DEFAULT);
  private maskTintOn = false;
  /** Sculpt mode reads albedo from the painted `color` attribute. */
  private sculptVertexColor = false;

  /** Whether masked areas are currently drawn darkened (ctrl+h toggles). */
  getSculptMaskTint(): boolean {
    return this.maskTintOn;
  }

  setSculptMaskTint(on: boolean): void {
    this.maskTintOn = on;
    this.rebuildSculptColor();
  }

  /**
   * Sculpt mode paints per-vertex, so albedo comes from the `color`
   * attribute rather than the material uniform. Vertex colours start white
   * and are filled from the material albedo when an object is created or
   * recoloured, so an unpainted object reads as its material exactly; once
   * painted, the attribute IS the colour, which is why it replaces the
   * uniform here instead of multiplying it (a multiply would tint every
   * painted stroke by the material underneath it).
   *
   * The mask tint composes on top either way, and off sculpt mode both
   * drop away - a viewer subject has neither attribute.
   */
  setSculptVertexColor(on: boolean): void {
    this.sculptVertexColor = on;
    this.rebuildSculptColor();
  }

  private rebuildSculptColor(): void {
    for (const id of ['lit', 'matcap']) {
      const m = this.registry.get(id) as MeshStandardNodeMaterial;
      // Roughness and metalness are per-vertex too - SculptGL keeps them in
      // materialsPBR.x and .y, beside the mask in .z - so reading them here
      // is what lets one object be matte clay and the next one polished
      // without a second three.js material. Lit only: a matcap bakes its
      // own shading and has nothing to do with either.
      if (id === 'lit') {
        type FloatNode = ReturnType<typeof float>;
        const pbr = attribute('materialsPBR', 'vec3') as unknown as {
          x: FloatNode;
          y: FloatNode;
        };
        const on = this.sculptVertexColor;
        m.roughnessNode = (on ? pbr.x : null) as MeshStandardNodeMaterial['roughnessNode'];
        m.metalnessNode = (on ? pbr.y : null) as MeshStandardNodeMaterial['metalnessNode'];
      }
      // The TSL runtime hands back fluent proxies; the published typings
      // for attribute()/materialColor lag behind, hence the casts.
      type Vec3Node = ReturnType<typeof vec3>;
      // Held as unknown while it is composed: the node types returned by
      // attribute() and .mul() differ, and only the final assignment needs
      // to name a type.
      let node: unknown = this.sculptVertexColor ? attribute('color', 'vec3') : null;
      if (this.maskTintOn) {
        const materialsPBR = attribute('materialsPBR', 'vec3') as unknown as Vec3Node;
        const masked = materialsPBR.z.clamp(0, 1).oneMinus();
        const base = (node ?? materialColor) as unknown as Vec3Node;
        node = base.mul(mix(float(1), this.maskDarkenU, masked));
      }
      // Same cast rationale as above: the published node typings are
      // narrower than what the TSL runtime actually accepts here.
      m.colorNode = node as unknown as MeshStandardNodeMaterial['colorNode'];
      m.needsUpdate = true;
    }
  }

  /** Brightness floor of fully masked areas (0 = black, 1 = no tint). */
  setMaskDarken(v: number): void {
    this.maskDarkenU.value = Math.min(1, Math.max(0, v));
  }

  getMaskDarken(): number {
    return this.maskDarkenU.value;
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
    const mat = this.registry.get('matcap') as MeshMatcapNodeMaterial;
    mat.matcap = this.matcapTextures[index];
    mat.needsUpdate = true;
  }

  /** Fired after the Lit albedo changes (sculpt writes it to the object). */
  onAlbedoChange: (() => void) | null = null;
  /** Fired after roughness or metalness changes, for the same reason. */
  onPbrChange: (() => void) | null = null;

  setAlbedo(hex: string): void {
    (this.registry.get('lit') as MeshStandardNodeMaterial).color = new Color(hex);
    this.onAlbedoChange?.();
  }

  setRoughness(value: number): void {
    (this.registry.get('lit') as MeshStandardNodeMaterial).roughness = value;
    this.onPbrChange?.();
  }

  setMetalness(value: number): void {
    (this.registry.get('lit') as MeshStandardNodeMaterial).metalness = value;
    this.onPbrChange?.();
  }

  /** Perceptual luminance of the Lit albedo (0..1) — picks the wire overlay colour. */
  albedoLuminance(): number {
    // getHexString() yields sRGB regardless of the renderer's working colour
    // space, so this matches how the albedo actually reads on screen.
    const hex = (this.registry.get('lit') as MeshStandardNodeMaterial).color.getHexString();
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
    const lit = this.registry.get('lit') as MeshStandardNodeMaterial;
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
