import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Scene,
  Sphere,
  Vector3,
  VSMShadowMap,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { detectQuality, SHADOW_TIERS, type ShadowTier } from './quality';

export type LightId = 'key' | 'fill' | 'rim';

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
   * Legacy shadow-filter selector. Kept only so older saves parse; the WebGPU
   * renderer uses VSM soft shadows exclusively, so any persisted value is ignored.
   */
  shadowMode?: 'vsm' | 'pcss';
}

const DEFAULT_SOFTNESS = 5;

const LIGHT_LABELS: Record<LightId, string> = {
  key: 'Key',
  fill: 'Fill',
  rim: 'Rim / Back',
};

const ALL: LightId[] = ['key', 'fill', 'rim'];

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
  /** Master gate: false in unlit material modes so no shadow pass runs. */
  private shadowsAllowed = true;
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
    this.config[id].color = hex;
    this.refresh();
  }

  setAngles(id: LightId, azimuth: number, elevation: number): void {
    this.config[id].azimuth = azimuth;
    this.config[id].elevation = elevation;
    this.refresh();
  }

  setShadow(id: LightId, castShadow: boolean): void {
    this.config[id].castShadow = castShadow;
    this.refresh();
  }

  setSoftness(id: LightId, softness: number): void {
    this.config[id].softness = softness;
    this.refresh();
  }

  /** Developer: shadow depth bias / normal bias across all casters. */
  setBias(bias: number): void {
    for (const id of ALL) this.lights[id].shadow.bias = bias;
  }

  setNormalBias(normalBias: number): void {
    for (const id of ALL) this.lights[id].shadow.normalBias = normalBias;
  }

  getBias(): number {
    return this.key.shadow.bias;
  }

  getNormalBias(): number {
    return this.key.shadow.normalBias;
  }

  /**
   * Gate the shadow pass. Unlit modes (matcap/wireframe) call this with false so
   * the lights stop casting and no shadow map is rendered.
   */
  setShadowsEnabled(enabled: boolean): void {
    this.shadowsAllowed = enabled;
    this.refresh();
  }

  /** Rotate the whole rig around the subject (degrees). */
  setRigRotation(deg: number): void {
    this.rigRotationDeg = deg;
    this.rig.rotation.y = MathUtils.degToRad(deg);
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
    };
  }

  /** Apply a persisted rig state, defensively (data may be partial or old). */
  applyState(state: Partial<LightingState>): void {
    if (state.key) this.config.key = { ...this.config.key, ...state.key };
    if (state.fill) this.config.fill = { ...this.config.fill, ...state.fill };
    if (state.rim) this.config.rim = { ...this.config.rim, ...state.rim };
    if (state.ambient) {
      if (typeof state.ambient.intensity === 'number') this.hemi.intensity = state.ambient.intensity;
      if (state.ambient.sky) this.hemi.color = new Color(state.ambient.sky);
      if (state.ambient.ground) this.hemi.groundColor = new Color(state.ambient.ground);
    }
    if (typeof state.rigRotation === 'number') this.setRigRotation(state.rigRotation);
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

  private refresh(center?: Vector3): void {
    const target = center ?? this.rig.position; // rig sits at world origin
    for (const id of ALL) this.apply(id, target);
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

    // A light casts only if the tier gives it a map, it's configured to, it's
    // on, and shadows are allowed (lit modes). Softness drives the VSM blur.
    const canCast = this.sizes[id] > 0;
    light.castShadow = canCast && cfg.castShadow && cfg.enabled && this.shadowsAllowed;
    if (canCast) light.shadow.radius = cfg.softness ?? DEFAULT_SOFTNESS;
  }
}
