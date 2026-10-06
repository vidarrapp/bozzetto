import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Quaternion,
  Scene,
  Sphere,
  Vector3,
  VSMShadowMap,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { detectQuality, SHADOW_TIERS, type ShadowTier } from './quality';
import { hexColor } from './color';

export type LightId = 'key' | 'fill' | 'rim';

/** How often the fill and rim shadows redraw; see Lighting.scheduleShadows. */
export type ShadowSchedule = 'all' | 'hold' | 'stagger';

export interface DirLightConfig {
  enabled: boolean;
  intensity: number;
  color: string;
  /** Azimuth in degrees (around the vertical axis). */
  azimuth: number;
  /** Elevation in degrees (above the horizon). */
  elevation: number;
  castShadow: boolean;
  /** Shadow penumbra blur radius (VSM). Larger = softer. */
  softness?: number;
}

export interface AmbientConfig {
  intensity: number;
  sky: string;
  ground: string;
}

export interface LightingPreset {
  id: string;
  label: string;
  key: DirLightConfig;
  fill: DirLightConfig;
  rim: DirLightConfig;
  ambient: AmbientConfig;
}

export interface LightStateView {
  id: LightId;
  label: string;
  enabled: boolean;
  intensity: number;
  color: string;
  azimuth: number;
  elevation: number;
  castShadow: boolean;
  softness: number;
  /** Whether this light can cast a shadow at the current quality tier. */
  canShadow: boolean;
}

/** Persisted rig state (stored in a project's `data.lighting`). */
export interface LightingState {
  key: DirLightConfig;
  fill: DirLightConfig;
  rim: DirLightConfig;
  ambient: AmbientConfig;
  rigRotation: number;
  /**
   * Master shadow switch (shift+S, and the panel checkbox). Optional so
   * saves written before it existed still parse; without it a saved look
   * came back with shadows however the mode happened to default them.
   */
  shadowsMaster?: boolean;
  /**
   * Legacy shadow-filter selector. Kept only so older saves parse; the WebGPU
   * renderer uses VSM soft shadows exclusively, so any persisted value is ignored.
   */
  shadowMode?: 'vsm' | 'pcss';
}

const DEFAULT_SOFTNESS = 5;

/**
 * Degrees the key light turns per pixel of a hold-L drag (nudgeKey): half
 * a degree, so a drag across a tablet's screen is a turn and a half.
 */
export const KEY_DRAG_DEG_PER_PX = 0.5;

const LIGHT_LABELS: Record<LightId, string> = {
  key: 'Key',
  fill: 'Fill',
  rim: 'Rim / Back',
};

const ALL: LightId[] = ['key', 'fill', 'rim'];

const UP_AXIS = new Vector3(0, 1, 0);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A saved light over the one it replaces, field by field: each value only
 * when it is what it says it is, and only the fields a light has. Saved
 * lights come from files, manifests and looks, and were spread in whole:
 * a colour that was a CSS url() reached the panel's swatch, and a number
 * that was a string reached the renderer.
 */
function mergeLight(base: DirLightConfig, saved: unknown): DirLightConfig {
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Record<string, unknown>;
  const softness = finite(s.softness) ? Math.max(0, s.softness) : base.softness;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : base.enabled,
    intensity: finite(s.intensity) ? Math.max(0, s.intensity) : base.intensity,
    color: hexColor(s.color, base.color),
    azimuth: finite(s.azimuth) ? s.azimuth : base.azimuth,
    elevation: finite(s.elevation) ? s.elevation : base.elevation,
    castShadow: typeof s.castShadow === 'boolean' ? s.castShadow : base.castShadow,
    ...(softness === undefined ? {} : { softness }),
  };
}

/** Default three-point rig and a raking-key preset for form study (§6). */
export const PRESETS: LightingPreset[] = [
  {
    id: 'three_point',
    label: 'Three-point',
    key: { enabled: true, intensity: 3.0, color: '#fff3e6', azimuth: 35, elevation: 38, castShadow: true, softness: 5 },
    fill: { enabled: true, intensity: 1.1, color: '#e6f0ff', azimuth: -55, elevation: 12, castShadow: true, softness: 9 },
    rim: { enabled: true, intensity: 2.4, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: false, softness: 6 },
    ambient: { intensity: 0.35, sky: '#c4d4ff', ground: '#4a3b2f' },
  },
  {
    id: 'raking_key',
    label: 'Raking key (form study)',
    key: { enabled: true, intensity: 4.2, color: '#ffffff', azimuth: 70, elevation: 8, castShadow: true, softness: 3 },
    fill: { enabled: false, intensity: 0.0, color: '#e6f0ff', azimuth: -55, elevation: 12, castShadow: false, softness: 6 },
    rim: { enabled: false, intensity: 0.0, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: false, softness: 6 },
    ambient: { intensity: 0.12, sky: '#aab6c8', ground: '#3a342c' },
  },
];

/**
 * Three-point lighting rig with soft (VSM) shadows (design doc §6).
 *
 * The three directional lights live in a group that can be rotated around the
 * subject. Each can be a configurable shadow caster with an adjustable penumbra
 * (softness); which lights cast — and at what map size — is bounded by the
 * device quality tier so the public viewer stays performant on mobile.
 */
export class Lighting {
  private readonly rig = new Group();
  private readonly key = new DirectionalLight();
  private readonly fill = new DirectionalLight();
  private readonly rim = new DirectionalLight();
  private readonly hemi = new HemisphereLight();
  private readonly lights: Record<LightId, DirectionalLight>;

  private readonly tier: ShadowTier;
  private readonly sizes: Record<LightId, number>;

  private readonly config: Record<LightId, DirLightConfig>;
  private rigRotationDeg = 0;
  /** Distance of lights from the subject centre; set by fitToBounds. */
  private distance = 5;
  private subjectRadius = 1;

  constructor(
    scene: Scene,
    private readonly renderer: WebGPURenderer,
  ) {
    this.tier = SHADOW_TIERS[detectQuality()];
    this.sizes = { key: this.tier.key, fill: this.tier.fill, rim: this.tier.rim };
    // Soft, variance-based (VSM) shadows — the renderer's only shadow filter.
    this.renderer.shadowMap.type = VSMShadowMap;

    const preset = PRESETS[0];
    this.config = { key: { ...preset.key }, fill: { ...preset.fill }, rim: { ...preset.rim } };
    this.lights = { key: this.key, fill: this.fill, rim: this.rim };

    for (const id of ALL) {
      const light = this.lights[id];
      const size = this.sizes[id];
      if (size > 0) {
        light.shadow.mapSize.set(size, size);
        light.shadow.blurSamples = this.tier.blurSamples;
        light.shadow.bias = -0.0005;
        // A generous normal bias keeps the contact shadow tight to the base of
        // the subject (matches the dev-tools max that reads best).
        light.shadow.normalBias = 0.1;
      }
      this.rig.add(light, light.target);
    }
    scene.add(this.rig, this.hemi);

    this.applyPreset(preset.id);
  }

  presets(): { id: string; label: string }[] {
    return PRESETS.map((p) => ({ id: p.id, label: p.label }));
  }

  applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
    this.config.key = { ...preset.key };
    this.config.fill = { ...preset.fill };
    this.config.rim = { ...preset.rim };
    this.hemi.intensity = preset.ambient.intensity;
    this.hemi.color = new Color(preset.ambient.sky);
    this.hemi.groundColor = new Color(preset.ambient.ground);
    this.refresh();
  }

  setEnabled(id: LightId, enabled: boolean): void {
    this.config[id].enabled = enabled;
    this.refresh();
  }

  setIntensity(id: LightId, intensity: number): void {
    this.config[id].intensity = intensity;
    this.refresh();
  }

  setColor(id: LightId, hex: string): void {
    this.config[id].color = hexColor(hex, this.config[id].color);
    this.refresh();
  }

  setAngles(id: LightId, azimuth: number, elevation: number): void {
    this.config[id].azimuth = azimuth;
    this.config[id].elevation = elevation;
    this.refresh();
  }

  /**
   * Turn the key light by degrees, as a hold-L drag does in sculpt and
   * Armature mode: sideways swings it around the subject, wrapping round,
   * and up and down raises and lowers it between a little below the
   * horizon and straight overhead. Past overhead, azimuth would stop
   * meaning anything and the light would appear to stick.
   */
  nudgeKey(deltaAzimuth: number, deltaElevation: number): void {
    const key = this.config.key;
    let az = (key.azimuth + deltaAzimuth) % 360;
    if (az > 180) az -= 360;
    if (az < -180) az += 360;
    const el = Math.max(-20, Math.min(90, key.elevation + deltaElevation));
    this.setAngles('key', az, el);
  }

  setShadow(id: LightId, castShadow: boolean): void {
    this.config[id].castShadow = castShadow;
    this.refresh();
  }

  /**
   * Master shadow switch (panel checkbox + sculpt shift+s): off suppresses
   * every light's shadow without touching the per-light config, so turning
   * it back on restores the configured rig. Saved with the look (serialize
   * / applyState carry it), so a session comes back the way it was left.
   */
  setShadowsMaster(on: boolean): void {
    this.shadowsMaster = on;
    this.refresh();
  }

  getShadowsMaster(): boolean {
    return this.shadowsMaster;
  }

  setSoftness(id: LightId, softness: number): void {
    this.config[id].softness = softness;
    this.refresh();
  }

  /**
   * How often the fill and rim shadows are redrawn (Viewer.updateFrameMode).
   * 'all', every frame, is how a still frame is drawn. 'hold' keeps the
   * maps as they are, for a stroke: the camera and the lights stand still,
   * and the fill and rim are soft enough that the stroked area catching up
   * on release does not show. 'stagger' redraws each one every third frame
   * on a frame of its own, so no frame pays for both, for a moving view or
   * figure (in Sculpt the lights turn with the camera). The key light always
   * redraws: its shadow is the one that reads the form.
   *
   * Through each shadow's own autoUpdate/needsUpdate, which r184's shadow
   * node honours; castShadow is never touched, because flipping it rebuilds
   * the shadow targets (see Viewer.updateStage).
   */
  scheduleShadows(mode: ShadowSchedule, frame: number): void {
    this.key.shadow.autoUpdate = true;
    const secondary = [this.fill, this.rim];
    for (let i = 0; i < secondary.length; i++) {
      const shadow = secondary[i].shadow;
      // Adaptive quality's economy: still frames redraw the fill and rim
      // every other frame, one each, rather than both every frame.
      const every = mode === 'all' && this.economy ? 2 : mode === 'stagger' ? 3 : 1;
      shadow.autoUpdate = every === 1 && mode === 'all';
      if (every > 1 && frame % every === i) shadow.needsUpdate = true;
    }
  }

  /** Fired after anything that changes the picture: a still frame starts smoothing over. */
  onChange: (() => void) | null = null;
  /** Adaptive quality's shadow economy: fewer blur samples, fill and rim every other frame. */
  private economy = false;
  /** Adaptive quality's map scale: shadow maps as a share of the tier's size. */
  private mapScale = 1;

  /**
   * Cheaper shadows for adaptive quality (adaptive.ts): with `economy`, half
   * the blur samples; with `mapScale` below 1, smaller maps whose blur
   * radius shrinks with them, so the shadows stay as soft in the scene.
   * Uniforms and map sizes only: no shader is rebuilt, and a resized map
   * is reallocated at its next draw.
   */
  setShadowQuality(economy: boolean, mapScale: number): void {
    if (economy === this.economy && mapScale === this.mapScale) return;
    this.economy = economy;
    this.mapScale = mapScale;
    for (const id of ALL) {
      const size = this.sizes[id];
      if (size === 0) continue;
      const shadow = this.lights[id].shadow;
      shadow.blurSamples = Math.max(2, Math.round(this.tier.blurSamples * (economy ? 0.5 : 1)));
      shadow.mapSize.set(Math.round(size * mapScale), Math.round(size * mapScale));
    }
    this.refresh();
  }

  /** Which light each shadow camera belongs to, for counting shadow passes. */
  shadowCameras(): Array<[object, LightId]> {
    return ALL.map((id) => [this.lights[id].shadow.camera, id]);
  }

  /** Whether a light casts a shadow right now (it is on, configured to, and the tier allows it). */
  casts(id: LightId): boolean {
    return this.lights[id].castShadow;
  }

  /** Developer: shadow depth bias / normal bias across all casters. */
  setBias(bias: number): void {
    for (const id of ALL) this.lights[id].shadow.bias = bias;
    this.onChange?.();
  }

  setNormalBias(normalBias: number): void {
    for (const id of ALL) this.lights[id].shadow.normalBias = normalBias;
    this.onChange?.();
  }

  getBias(): number {
    return this.key.shadow.bias;
  }

  getNormalBias(): number {
    return this.key.shadow.normalBias;
  }

  /** Rotate the whole rig around the subject (degrees). */
  setRigRotation(deg: number): void {
    this.rigRotationDeg = deg;
    this.onChange?.();
    if (this.followQuat) {
      this.applyRigFollow();
      return;
    }
    this.rig.rotation.y = MathUtils.degToRad(deg);
  }

  private followQuat: Quaternion | null = null;
  private readonly followScratch = new Quaternion();

  /**
   * Sculpt-mode view follow: the whole rig rides a camera-derived delta
   * rotation (so the light stays put relative to the VIEWER, like turning
   * the model in your hand), composed with the user's L-drag rig rotation.
   * Pass null to restore the plain world-fixed Y rotation.
   */
  setRigFollow(q: Quaternion | null): void {
    this.onChange?.();
    this.followQuat = q ? (this.followQuat ?? new Quaternion()).copy(q) : null;
    if (this.followQuat) this.applyRigFollow();
    else this.rig.rotation.set(0, MathUtils.degToRad(this.rigRotationDeg), 0);
  }

  private applyRigFollow(): void {
    if (!this.followQuat) return;
    this.followScratch.setFromAxisAngle(UP_AXIS, MathUtils.degToRad(this.rigRotationDeg));
    this.rig.quaternion.copy(this.followQuat).multiply(this.followScratch);
  }

  getRigRotation(): number {
    return this.rigRotationDeg;
  }

  state(): LightStateView[] {
    return ALL.map((id) => ({
      id,
      label: LIGHT_LABELS[id],
      enabled: this.config[id].enabled,
      intensity: this.config[id].intensity,
      color: this.config[id].color,
      azimuth: this.config[id].azimuth,
      elevation: this.config[id].elevation,
      castShadow: this.config[id].castShadow,
      softness: this.config[id].softness ?? DEFAULT_SOFTNESS,
      canShadow: this.sizes[id] > 0,
    }));
  }

  /** Full rig state for persistence into a project's `data.lighting`. */
  serialize(): LightingState {
    return {
      key: { ...this.config.key },
      fill: { ...this.config.fill },
      rim: { ...this.config.rim },
      ambient: {
        intensity: this.hemi.intensity,
        sky: `#${this.hemi.color.getHexString()}`,
        ground: `#${this.hemi.groundColor.getHexString()}`,
      },
      rigRotation: this.rigRotationDeg,
      shadowsMaster: this.shadowsMaster,
    };
  }

  /** Apply a persisted rig state, defensively (data may be partial or old). */
  applyState(state: Partial<LightingState>): void {
    for (const id of ALL) this.config[id] = mergeLight(this.config[id], state[id]);
    const ambient = state.ambient as Partial<Record<keyof AmbientConfig, unknown>> | undefined;
    if (ambient && typeof ambient === 'object') {
      if (finite(ambient.intensity)) this.hemi.intensity = Math.max(0, ambient.intensity);
      const sky = `#${this.hemi.color.getHexString()}`;
      const ground = `#${this.hemi.groundColor.getHexString()}`;
      if (ambient.sky) this.hemi.color = new Color(hexColor(ambient.sky, sky));
      if (ambient.ground) this.hemi.groundColor = new Color(hexColor(ambient.ground, ground));
    }
    if (finite(state.rigRotation)) this.setRigRotation(state.rigRotation);
    if (typeof state.shadowsMaster === 'boolean') this.shadowsMaster = state.shadowsMaster;
    this.refresh();
  }

  /** Fit light distance and every caster's shadow frustum to the subject bounds. */
  fitToBounds(box: Box3): void {
    const sphere = box.getBoundingSphere(new Sphere());
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    this.distance = this.subjectRadius * 4;

    // Roughly double the old frustum (extent was 1.5R, depth pad 2R): a long,
    // low shadow on the floor was clipping to a hard rectangular edge.
    const extent = this.subjectRadius * 3;
    for (const id of ALL) {
      if (this.sizes[id] === 0) continue;
      const cam = this.lights[id].shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = Math.max(this.distance - extent, 0.01);
      cam.far = this.distance + extent;
      cam.updateProjectionMatrix();
    }

    this.refresh(sphere.center);
  }

  private shadowsMaster = true;
  /** Where the lights aim: the fitted subject centre, until the next fit. */
  private readonly aimCenter = new Vector3();

  private refresh(center?: Vector3): void {
    // Every slider-driven refresh used to re-aim at the origin, throwing
    // away the centre fitToBounds computed a moment earlier.
    if (center) this.aimCenter.copy(center);
    for (const id of ALL) this.apply(id, this.aimCenter);
    this.onChange?.();
  }

  private apply(id: LightId, target: Vector3): void {
    const light = this.lights[id];
    const cfg = this.config[id];

    light.visible = cfg.enabled;
    light.intensity = cfg.intensity;
    light.color = new Color(cfg.color);

    const az = MathUtils.degToRad(cfg.azimuth);
    const el = MathUtils.degToRad(cfg.elevation);
    const dir = new Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    light.position.copy(target).addScaledVector(dir, this.distance);
    light.target.position.copy(target);
    light.target.updateMatrixWorld();

    // A light casts only if the tier gives it a map, it's configured to, and
    // it's on. Softness drives the VSM blur.
    const canCast = this.sizes[id] > 0;
    light.castShadow = canCast && cfg.castShadow && cfg.enabled && this.shadowsMaster;
    if (canCast) light.shadow.radius = (cfg.softness ?? DEFAULT_SOFTNESS) * this.mapScale;
  }
}
