import { Color, Material, SRGBColorSpace, Texture } from 'three';
import { MeshMatcapNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, materialColor, mix, uniform, userData, varying, vec3 } from 'three/tsl';
import type { AssetSource } from './AssetSource';
import { ASSET_VERSION } from './assetVersion';
import { hexColor } from './color';
import { MATCAP_ASSETS } from '../library/assets';

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
  /**
   * A model that carries painted vertex colours (a sculpt published from
   * Sculpt mode) shows them - "Sculpt colours", true - or the albedo over
   * the whole of it - "Plain colour", false. Absent from looks saved
   * before the choice existed, which mean the model's own colours.
   * Written alongside `colourSource`: true for Albedo and paint and for Paint
   * only, false for Albedo only, so a build from before the third choice reads
   * a look sensibly (it has two: the paint, or the albedo alone).
   */
  vertexColors?: boolean;
  /**
   * What an object in Sculpt shows: the albedo times the paint ('both', the
   * default), the albedo alone ('albedo') or the paint alone ('paint', as
   * under a white albedo, with the albedo unchanged). A look without it takes
   * it from `vertexColors` (true is 'both', false is 'albedo').
   */
  colourSource?: ColourSource;
}

/** What a sculpt shows: albedo times paint, the albedo alone, the paint alone. */
export type ColourSource = 'both' | 'albedo' | 'paint';
export const isColourSource = (v: unknown): v is ColourSource => v === 'both' || v === 'albedo' || v === 'paint';

const DEFAULT_ALBEDO = '#b9b1a8';

/** Fully masked vertices drop to this brightness (sculpt mask tint, WS3;
    live-adjustable from the WS4 palette through a uniform, no recompile). */
const MASK_DARKEN_DEFAULT = 0.45;

// The project's matcaps are the Asset library's list (library/assets.ts): single-sphere PNGs loaded as-is, each with
// a 64px thumbnail for the pickers. The source PNGs carry a transparent surround, flattened at import time by radial
// edge bleed so a grazing normal never samples white; labels keep the pack's own numbering.

/** A matcap's request URL, version-tagged so an updated PNG isn't served stale. */
function matcapUrl(url: string): string {
  return `${url}?v=${ASSET_VERSION}`;
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
    // A matcap arriving changes the picture after the fact, with nothing
    // else to say so: a still frame smoothed before it would hold the old one.
    this.matcapTextures = MATCAP_ASSETS.map((m) => loadMatcap(source, matcapUrl(m.url), () => this.onChange?.()));

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
  /**
   * The mask tint's switch as a value (1 on, 0 off) the colour node multiplies the mask by,
   * so turning the tint on or off is a uniform and not a different shader: Present puts it
   * away and brings it back at every switch, and a rebuilt shader there was a stall each way.
   */
  private readonly maskTintU = uniform(0);
  /**
   * What a sculpt shows, as values the colour node mixes by: the albedo's share (0 under
   * 'paint') and the paint's (0 under 'albedo'), so the Colour choice is a value and not a
   * different shader; and whether the poly group colours show (never in Present). A look that
   * comes back is the shader it was, with nothing to build.
   */
  private readonly albedoU = uniform(1);
  private readonly paintU = uniform(1);
  private readonly groupU = uniform(0);
  /** Read albedo from the painted `color` attribute while sculpting. */
  private sculptVertexColor = false;
  /** The viewer's model carries painted colours (a published sculpt's COLOR_0). */
  private modelVertexColor = false;
  /**
   * The look's Plain colour: a painted model shows the albedo instead of
   * its paint. Never while sculpting, where the paint is the work.
   */
  private source: ColourSource = 'both';
  /** Read roughness/metalness from materialsPBR.x/.y - sculpt only: a
      published model has a colour attribute but no materialsPBR, and a
      shader reading a missing attribute is not an error you get to see. */
  private sculptVertexPBR = false;

  /**
   * Sculpt's poly group colours (Shift+F): the colour comes from the
   * `groupColor` attribute GeometrySync fills while they show, in place of
   * the paint in Lit and under the matcap's shading, the mask's darkening
   * still on top. Every sculpt geometry has the attribute while this is on.
   */
  private groupColorsOn = false;

  getSculptGroupColors(): boolean {
    return this.groupColorsOn;
  }

  setSculptGroupColors(on: boolean): void {
    if (on === this.groupColorsOn) return;
    this.groupColorsOn = on;
    this.rebuildSculptColor();
  }

  /** Whether masked areas are currently drawn darkened (ctrl+h toggles). */
  getSculptMaskTint(): boolean {
    return this.maskTintOn;
  }

  setSculptMaskTint(on: boolean): void {
    this.maskTintOn = on;
    this.maskTintU.value = on ? 1 : 0;
    this.rebuildSculptColor();
  }

  /** Fired after anything that changes the picture: a still frame starts smoothing over. */
  onChange: (() => void) | null = null;

  /**
   * Sculpt mode shows the object's albedo times its paint: the `color`
   * attribute holds the paint exactly as picked (white until painted) and the
   * albedo is the object's own, per display mesh (`userData.albedo`, see
   * Viewer.setSculptAlbedo). White paint under an albedo is that albedo, so an
   * unpainted object reads as its material, and a white albedo shows paint as
   * picked.
   *
   * The mask tint composes on top either way, and off sculpt mode both
   * drop away - a viewer subject has no mask, and only a painted one has
   * colours (setModelVertexColors).
   */
  setSculptVertexColor(on: boolean): void {
    this.sculptVertexColor = on;
    this.rebuildSculptColor();
  }

  setSculptVertexPBR(on: boolean): void {
    this.sculptVertexPBR = on;
    this.rebuildSculptColor();
  }

  /**
   * The viewer's model came with painted colours (a published sculpt): its
   * albedo is the paint, exactly as it was in Sculpt mode, unless the look
   * asks for a plain colour. Apart from the sculpt switch above, so that
   * leaving Sculpt mode does not take a published model's paint with it.
   */
  setModelVertexColors(on: boolean): void {
    this.modelVertexColor = on;
    this.rebuildSculptColor();
  }

  /** Whether the viewer's model has painted colours to show (the Render panel's switch). */
  hasModelVertexColors(): boolean {
    return this.modelVertexColor;
  }

  /**
   * Sculpt's Present mode: the look's Plain colour shows on the sculpt too,
   * as the published model will show it. Otherwise the paint is the work
   * while sculpting, whatever the look says.
   */
  private presenting = false;

  setPresenting(on: boolean): void {
    if (on === this.presenting) return;
    this.presenting = on;
    this.rebuildSculptColor();
  }

  /**
   * Several colour-state changes as one: the colour node is composed once, for
   * where they end, not once for each step on the way (Present's entry turns
   * the mask tint off and presenting on, and a state in between is a shader
   * nobody sees).
   */
  batch(change: () => void): void {
    this.batching++;
    try {
      change();
    } finally {
      this.batching--;
      if (!this.batching && this.batchDirty) {
        this.batchDirty = false;
        this.rebuildSculptColor();
      }
    }
  }
  private batching = 0;
  private batchDirty = false;

  /**
   * What a sculpt shows (see MaterialState.colourSource): which of the two
   * factors, the albedo and the paint, the shader uses. Nothing is rewritten.
   * A published model has two choices, its colours or its albedo alone
   * ('albedo'); 'paint' is its colours too.
   */
  setColourSource(source: ColourSource): void {
    if (source === this.source) return;
    this.source = source;
    this.rebuildSculptColor();
  }

  getColourSource(): ColourSource {
    return this.source;
  }

  /** Plain colour (true) or the model's own paint (false): the viewer's two choices. */
  setPlainColor(plain: boolean): void {
    this.setColourSource(plain ? 'albedo' : 'both');
  }

  /** Whether the Lit colour reads the `color` attribute (the albedo alone does not). */
  private readsVertexColor(): boolean {
    if (this.sculptVertexColor) return this.source !== 'albedo';
    return this.modelVertexColor && this.source !== 'albedo';
  }

  /**
   * The colour nodes composed for each state (see rebuildSculptColor), kept so
   * a state that comes back is the same graph and the renderer finds its
   * shader again instead of building one: Present and back is two states, not
   * a rebuild each way.
   */
  private readonly colorGraphs = new Map<string, { color: unknown; rough: unknown; metal: unknown }>();

  /** The state key each colour material was last composed for. */
  private readonly appliedKey = new Map<string, string>();

  private rebuildSculptColor(): void {
    this.albedoU.value = this.source === 'paint' ? 0 : 1;
    this.paintU.value = this.source === 'albedo' ? 0 : 1;
    this.groupU.value = this.groupColorsOn && this.sculptVertexColor && !this.presenting ? 1 : 0;
    if (this.batching) {
      this.batchDirty = true;
      return;
    }
    let changed = false;
    for (const id of ['lit', 'matcap']) {
      const m = this.registry.get(id) as MeshStandardNodeMaterial;
      // Roughness and metalness are per-vertex too - SculptGL keeps them in
      // materialsPBR.x and .y, beside the mask in .z - so reading them here
      // is what lets one object be matte clay and the next one polished
      // without a second three.js material. Lit only: a matcap bakes its
      // own shading and has nothing to do with either.
      const stateKey = [id, this.sculptVertexColor, this.sculptVertexColor ? '' : this.readsVertexColor(), this.sculptVertexColor ? '' : this.source, this.sculptVertexPBR, this.groupColorsOn && this.sculptVertexColor, this.sculptVertexPBR || this.maskTintOn].join('|');
      // The state this material already shows: nothing to rebuild (a rebuild is a shader, and a switch of workspace must not cost one).
      if (this.appliedKey.get(id) === stateKey) continue;
      this.appliedKey.set(id, stateKey);
      changed = true;
      const kept = this.colorGraphs.get(stateKey);
      if (kept) {
        if (id === 'lit') {
          m.roughnessNode = kept.rough as MeshStandardNodeMaterial['roughnessNode'];
          m.metalnessNode = kept.metal as MeshStandardNodeMaterial['metalnessNode'];
        }
        m.colorNode = kept.color as MeshStandardNodeMaterial['colorNode'];
        m.needsUpdate = true;
        continue;
      }
      let rough: unknown = null;
      let metal: unknown = null;
      if (id === 'lit') {
        type FloatNode = ReturnType<typeof float>;
        const pbr = attribute('materialsPBR', 'vec3') as unknown as {
          x: FloatNode;
          y: FloatNode;
        };
        const on = this.sculptVertexPBR;
        rough = on ? pbr.x : null;
        metal = on ? pbr.y : null;
        m.roughnessNode = rough as MeshStandardNodeMaterial['roughnessNode'];
        m.metalnessNode = metal as MeshStandardNodeMaterial['metalnessNode'];
      }
      // The TSL runtime hands back fluent proxies; the published typings
      // for attribute()/materialColor lag behind, hence the casts.
      type Vec3Node = ReturnType<typeof vec3>;
      // Held as unknown while it is composed: the node types returned by
      // attribute() and .mul() differ, and only the final assignment needs
      // to name a type.
      // Owner call: a matcap renders PURE. Paint and albedo fills stay in
      // the vertex colours for the Lit material, but never tint a matcap -
      // it exists to read form, and multiplying it by the default warm-clay
      // fill rendered the blue-grey matcap brown (measured against the
      // source PNGs). The mask darken below still applies in both modes:
      // masks must stay visible while sculpting.
      // Lit while sculpting: the shown colour is the object's albedo times its
      // paint (the `color` attribute, white until painted). The albedo is the
      // object's own, read off each display mesh's userData (the scene can hold
      // objects with different materials), so a change of it is a value, never
      // a rewrite of the colours. A published model (no sculpt) carries the
      // product already: its colours replace the albedo, as they always did.
      let node: unknown = null;
      if (id === 'lit') {
        if (this.sculptVertexColor) {
          const albedo = userData('albedo', 'color') as unknown as Vec3Node;
          // Both factors always, each mixed to white by its value (see albedoU): Albedo, Paint and Both are one shader.
          node = mix(vec3(1, 1, 1), albedo, this.albedoU).mul(mix(vec3(1, 1, 1), attribute('color', 'vec3'), this.paintU));
        } else if (this.readsVertexColor()) {
          node = attribute('color', 'vec3');
        }
      }
      // The poly group colours, while they show (never in Present, which
      // shows the model as it will be published).
      // Flat: each triangle takes its provoking corner's colour, which
      // GeometrySync turns the triangles to make its face's group's, so a
      // border between groups is crisp along the face edges.
      if (this.groupColorsOn && this.sculptVertexColor) {
        const flat = varying(attribute('groupColor', 'vec3')).setInterpolation('flat', 'first');
        node = mix((node ?? materialColor) as unknown as Vec3Node, flat as unknown as Vec3Node, this.groupU);
      }
      // How much of the surface counts as masked: the vertex mask when the
      // tint is on, and the whole object when it is locked (owner call: a
      // locked object draws as if fully masked, so the padlock shows in
      // the viewport). The lock is per object, read off the display
      // mesh's userData - the one material serves every sculpt object.
      type FloatNode = ReturnType<typeof float>;
      let covered: FloatNode | null = null;
      if (this.sculptVertexPBR || this.maskTintOn) {
        const materialsPBR = attribute('materialsPBR', 'vec3') as unknown as Vec3Node;
        covered = materialsPBR.z.clamp(0, 1).oneMinus().mul(this.maskTintU) as unknown as FloatNode;
      }
      if (this.sculptVertexPBR) {
        const locked = userData('locked', 'float') as unknown as FloatNode;
        covered = (covered ? covered.max(locked) : locked) as unknown as FloatNode;
      }
      if (covered) {
        const base = (node ?? materialColor) as unknown as Vec3Node;
        node = base.mul(mix(float(1), this.maskDarkenU, covered));
      }
      // Same cast rationale as above: the published node typings are
      // narrower than what the TSL runtime actually accepts here.
      m.colorNode = node as unknown as MeshStandardNodeMaterial['colorNode'];
      this.colorGraphs.set(stateKey, { color: node, rough, metal });
      m.needsUpdate = true;
    }
    if (changed) this.onColorNodeChange?.();
    this.onChange?.();
  }

  /**
   * Fired when the sculpt colour node is rebuilt (paint, mask tint, lock,
   * poly group colours). The shadow pass reads that node too (three's
   * shadow material takes the source's colorNode alpha), but caches its
   * build per object under its own material, which this rebuild does not
   * touch: the viewer has it rebuilt (Viewer.refreshShadowPasses).
   */
  onColorNodeChange: (() => void) | null = null;

  /** Brightness floor of fully masked areas (0 = black, 1 = no tint). */
  setMaskDarken(v: number): void {
    this.maskDarkenU.value = Math.min(1, Math.max(0, v));
    this.onChange?.();
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
    return MATCAP_ASSETS.map((m) => ({ id: m.id, label: m.label }));
  }

  setMatcapIndex(index: number): void {
    // Clamp rather than ignore: a look saved before the house matcaps were
    // retired carries an index past the end, and silently keeping whatever
    // was showing made a restored look wrong in a way nothing explained.
    index = Math.min(this.matcapTextures.length - 1, Math.max(0, Math.round(index)));
    if (!Number.isFinite(index)) return;
    this.matcapIndex = index;
    const mat = this.registry.get('matcap') as MeshMatcapNodeMaterial;
    mat.matcap = this.matcapTextures[index];
    mat.needsUpdate = true;
    this.onChange?.();
  }

  /** Fired after the Lit albedo changes (sculpt writes it to the object). */
  onAlbedoChange: (() => void) | null = null;
  /** Fired after roughness or metalness changes, for the same reason. */
  onPbrChange: (() => void) | null = null;

  setAlbedo(hex: string): void {
    const lit = this.registry.get('lit') as MeshStandardNodeMaterial;
    lit.color = new Color(hexColor(hex, `#${lit.color.getHexString()}`));
    this.onAlbedoChange?.();
    this.onChange?.();
  }

  setRoughness(value: number): void {
    (this.registry.get('lit') as MeshStandardNodeMaterial).roughness = value;
    this.onPbrChange?.();
    this.onChange?.();
  }

  setMetalness(value: number): void {
    (this.registry.get('lit') as MeshStandardNodeMaterial).metalness = value;
    this.onPbrChange?.();
    this.onChange?.();
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
    this.onChange?.();
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
      vertexColors: this.source !== 'albedo',
      colourSource: this.source,
    };
  }

  applyMaterialState(state: Partial<MaterialState>): void {
    // Each value only when it is what it says: material records come from
    // files and manifests as well as from this app.
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (state.albedo) this.setAlbedo(state.albedo);
    if (finite(state.roughness)) this.setRoughness(Math.min(1, Math.max(0, state.roughness)));
    if (finite(state.metalness)) this.setMetalness(Math.min(1, Math.max(0, state.metalness)));
    if (typeof state.matcapIndex === 'number') this.setMatcapIndex(state.matcapIndex);
    if (typeof state.flatShading === 'boolean') this.setFlatShading(state.flatShading);
    // The third choice where the look has it; an older look has the boolean alone.
    if (isColourSource(state.colourSource)) this.setColourSource(state.colourSource);
    else if (typeof state.vertexColors === 'boolean') this.setPlainColor(!state.vertexColors);
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
 * works over the network and from memory alike).
 */
function loadMatcap(source: AssetSource, path: string, onLoad: () => void): Texture {
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
        onLoad();
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    })
    .catch((err) => console.error(`Matcap "${path}" failed to load:`, err));
  return tex;
}
