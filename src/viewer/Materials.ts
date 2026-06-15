import {
  Color,
  DoubleSide,
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

const CLAY = new Color('#b9b1a8');

/**
 * Material registry (design doc §8, §9).
 *
 * Owns one instance per mode. Switching mode reassigns `mesh.material`; per-frame
 * geometry swaps never touch materials, so the chosen mode persists across the
 * timeline. "Normals" is view-space (MeshNormalMaterial) — labelled honestly.
 */
export class Materials {
  private readonly registry = new Map<string, Material>();
  private readonly matcapTexture: Texture;

  readonly modes: MaterialModeInfo[] = [
    { id: 'lit', label: 'Lit (PBR)', lit: true },
    { id: 'matcap', label: 'Matcap (clay)', lit: false },
    { id: 'normals', label: 'Normals (view space)', lit: false },
    { id: 'wireframe', label: 'Wireframe', lit: false },
    { id: 'flat', label: 'Flat clay', lit: true },
  ];

  constructor(matcapUrl: string) {
    this.matcapTexture = new TextureLoader().load(matcapUrl);
    this.matcapTexture.colorSpace = SRGBColorSpace;

    // Lit PBR — the default mode and the reason lighting exists. Neutral mid
    // albedo, mid-high roughness, no metalness: a clay-like read.
    this.registry.set(
      'lit',
      new MeshStandardMaterial({ color: CLAY, roughness: 0.78, metalness: 0.0 }),
    );

    // Matcap — reproduces the ZBrush clay read, ignores scene lights.
    this.registry.set('matcap', new MeshMatcapMaterial({ matcap: this.matcapTexture }));

    // View-space normals — the classic shifting-rainbow visualization.
    this.registry.set('normals', new MeshNormalMaterial());

    // Flat wireframe (v1; shaded-plus-overlay is noted as a nice-to-have).
    this.registry.set(
      'wireframe',
      new MeshBasicMaterial({ color: 0x9fd0ff, wireframe: true }),
    );

    // Flat clay — uniform albedo with faceted shading to read big forms.
    this.registry.set(
      'flat',
      new MeshStandardMaterial({
        color: CLAY,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: true,
        side: DoubleSide,
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

  /** Swap the clay matcap texture at runtime. */
  setMatcap(url: string): void {
    new TextureLoader().load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      const mat = this.registry.get('matcap') as MeshMatcapMaterial;
      mat.matcap?.dispose();
      mat.matcap = tex;
      mat.needsUpdate = true;
    });
  }

  dispose(): void {
    this.matcapTexture.dispose();
    for (const mat of this.registry.values()) mat.dispose();
    this.registry.clear();
  }
}
