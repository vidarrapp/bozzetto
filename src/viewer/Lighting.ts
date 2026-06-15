import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  PCFSoftShadowMap,
  Scene,
  Sphere,
  Vector3,
  type WebGLRenderer,
} from 'three';

export type LightId = 'key' | 'fill' | 'rim';

interface DirLightConfig {
  enabled: boolean;
  intensity: number;
  color: string;
  /** Azimuth in degrees (around the vertical axis). */
  azimuth: number;
  /** Elevation in degrees (above the horizon). */
  elevation: number;
  castShadow: boolean;
}

interface AmbientConfig {
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
}

const LIGHT_LABELS: Record<LightId, string> = {
  key: 'Key',
  fill: 'Fill',
  rim: 'Rim / Back',
};

/** Default three-point rig and a raking-key preset for form study (§6). */
export const PRESETS: LightingPreset[] = [
  {
    id: 'three_point',
    label: 'Three-point',
    key: { enabled: true, intensity: 3.0, color: '#fff3e6', azimuth: 35, elevation: 38, castShadow: true },
    fill: { enabled: true, intensity: 1.1, color: '#e6f0ff', azimuth: -55, elevation: 12, castShadow: false },
    rim: { enabled: true, intensity: 2.4, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: false },
    ambient: { intensity: 0.35, sky: '#c4d4ff', ground: '#4a3b2f' },
  },
  {
    id: 'raking_key',
    label: 'Raking key (form study)',
    key: { enabled: true, intensity: 4.2, color: '#ffffff', azimuth: 70, elevation: 8, castShadow: true },
    fill: { enabled: false, intensity: 0.0, color: '#e6f0ff', azimuth: -55, elevation: 12, castShadow: false },
    rim: { enabled: false, intensity: 0.0, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: false },
    ambient: { intensity: 0.12, sky: '#aab6c8', ground: '#3a342c' },
  },
];

/**
 * Three-point lighting rig with dynamic shadows (design doc §6).
 *
 * The three directional lights live in a group that can be rotated around the
 * subject for form study. Light directions are driven by azimuth/elevation
 * angles rather than raw XYZ. Only the key casts shadows by default.
 */
export class Lighting {
  private readonly rig = new Group();
  private readonly key: DirectionalLight;
  private readonly fill: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly hemi: HemisphereLight;

  private readonly config: Record<LightId, DirLightConfig>;
  /** Master gate: false in unlit material modes so no shadow pass runs. */
  private shadowsAllowed = true;
  private rigRotationDeg = 0;
  /** Distance of lights from the subject centre; set by fitToBounds. */
  private distance = 5;
  private subjectRadius = 1;

  constructor(scene: Scene, renderer: WebGLRenderer) {
    renderer.shadowMap.type = PCFSoftShadowMap;

    const preset = PRESETS[0];
    this.config = {
      key: { ...preset.key },
      fill: { ...preset.fill },
      rim: { ...preset.rim },
    };

    this.key = new DirectionalLight();
    this.fill = new DirectionalLight();
    this.rim = new DirectionalLight();
    this.hemi = new HemisphereLight();

    // Key shadow setup; frustum is fitted to the subject in fitToBounds.
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;

    for (const light of [this.key, this.fill, this.rim]) {
      this.rig.add(light);
      this.rig.add(light.target);
    }
    scene.add(this.rig);
    scene.add(this.hemi);

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

  /**
   * Gate the shadow pass. Unlit modes (matcap/normals/wireframe) call this with
   * false so the key light stops casting and no shadow map is rendered.
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
    return (['key', 'fill', 'rim'] as LightId[]).map((id) => ({
      id,
      label: LIGHT_LABELS[id],
      enabled: this.config[id].enabled,
      intensity: this.config[id].intensity,
      color: this.config[id].color,
      azimuth: this.config[id].azimuth,
      elevation: this.config[id].elevation,
    }));
  }

  /** Fit light distance and the key's shadow frustum to the subject bounds. */
  fitToBounds(box: Box3): void {
    const sphere = box.getBoundingSphere(new Sphere());
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    this.distance = this.subjectRadius * 4;

    const shadowCam = this.key.shadow.camera;
    const extent = this.subjectRadius * 1.5;
    shadowCam.left = -extent;
    shadowCam.right = extent;
    shadowCam.top = extent;
    shadowCam.bottom = -extent;
    shadowCam.near = Math.max(this.distance - this.subjectRadius * 2, 0.01);
    shadowCam.far = this.distance + this.subjectRadius * 2;
    shadowCam.updateProjectionMatrix();

    this.refresh(sphere.center);
  }

  private refresh(center?: Vector3): void {
    const target = center ?? this.rig.position; // rig sits at world origin
    this.apply(this.key, this.config.key, target);
    this.apply(this.fill, this.config.fill, target);
    this.apply(this.rim, this.config.rim, target);
  }

  private apply(light: DirectionalLight, cfg: DirLightConfig, target: Vector3): void {
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

    // Only the configured shadow caster pays for a shadow pass, and only when
    // shadows are allowed (lit modes).
    light.castShadow = cfg.castShadow && cfg.enabled && this.shadowsAllowed;
  }
}
