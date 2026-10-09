import {
  Box3,
  Color,
  DirectionalLight,
  Frustum,
  Group,
  HemisphereLight,
  MathUtils,
  Matrix4,
  type PerspectiveCamera,
  type Plane,
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

/**
 * The lighting record's version. 2: the rim's Casts shadow box is ticked by
 * default. A record without it was written while the box was unticked by
 * default, and applyState ticks it (see there).
 */
export const LIGHTING_STATE_VERSION = 2;

/** Persisted rig state (stored in a project's `data.lighting`). */
export interface LightingState {
  /** The record's version (LIGHTING_STATE_VERSION); none on records from before it. */
  v?: number;
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
    rim: { enabled: true, intensity: 2.4, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: true, softness: 6 },
    ambient: { intensity: 0.35, sky: '#c4d4ff', ground: '#4a3b2f' },
  },
  {
    id: 'raking_key',
    label: 'Raking key (form study)',
    key: { enabled: true, intensity: 4.2, color: '#ffffff', azimuth: 70, elevation: 8, castShadow: true, softness: 3 },
    fill: { enabled: false, intensity: 0.0, color: '#e6f0ff', azimuth: -55, elevation: 12, castShadow: false, softness: 6 },
    rim: { enabled: false, intensity: 0.0, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: true, softness: 6 },
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
  /** Distance of lights from the subject centre; set by fitToBounds and setSubjectBounds. */
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
    this.userBias = bias;
    for (const id of ALL) this.applyBlur(id);
    this.onChange?.();
  }

  setNormalBias(normalBias: number): void {
    for (const id of ALL) this.lights[id].shadow.normalBias = normalBias;
    this.onChange?.();
  }

  getBias(): number {
    return this.userBias;
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
      v: LIGHTING_STATE_VERSION,
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
    // A record from before version 2 has the rim's box unticked because
    // that was the default then, not because anyone chose it, and the rim
    // lit the far side straight through the model: it casts now, as a new
    // look's does. Every saved look comes through here - the autosave and
    // sculpt's kept look, .bozz files, armatures, published looks and the
    // viewer's manifests - and one written since is taken as saved.
    if (!(finite(state.v) && state.v >= LIGHTING_STATE_VERSION)) this.config.rim.castShadow = true;
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

  /**
   * The subject the shadows are fitted to, and where the lights aim: a
   * mode's subject (Viewer.fitSubjectBounds), then its live bounds once a
   * frame (setSubjectBounds). The light distance and the aim follow it.
   */
  fitToBounds(box: Box3): void {
    this.takeSubject(box);
    this.refresh(this.aimCenter);
    this.updateShadowFit(this.fitView, this.fitFocus);
  }

  /**
   * The subject's bounds as they are now (Viewer.refitShadows, once a
   * frame): an object added, moved or scaled, a remesh, a stroke that grew
   * the bound. The next updateShadowFit covers them.
   */
  setSubjectBounds(box: Box3): void {
    if (box.isEmpty()) return;
    const tol = this.subjectRadius * 1e-3;
    const a = this.subjectBox;
    if (
      !a.isEmpty() &&
      Math.abs(a.min.x - box.min.x) <= tol && Math.abs(a.min.y - box.min.y) <= tol && Math.abs(a.min.z - box.min.z) <= tol &&
      Math.abs(a.max.x - box.max.x) <= tol && Math.abs(a.max.y - box.max.y) <= tol && Math.abs(a.max.z - box.max.z) <= tol
    ) {
      return;
    }
    // A change the lights' aim still holds (a stroke growing the bound, an
    // object nudged) only changes what the frusta must cover, and they are
    // refitted only if it leaves them; a large one also re-aims the rig.
    // The scale softness and the margins are measured in is the subject's
    // as it is, so one subject fits alike whatever came before it.
    const sphere = box.getBoundingSphere(this.sphereScratch);
    const reach = sphere.center.distanceTo(this.aimCenter) + sphere.radius;
    if (a.isEmpty() || reach > 0.6 * this.distance || sphere.radius < 0.5 * this.subjectRadius) {
      this.takeSubject(box);
      for (const id of ALL) this.place(id, this.aimCenter);
    } else {
      this.subjectBox.copy(box);
      this.subjectRadius = Math.max(sphere.radius, 1e-3);
    }
  }

  /**
   * The height of the plane that catches the subject's shadow (the ground
   * or the pedestal's top), or null when there is none: the frusta reach
   * along each light far enough to cover the shadow it throws there.
   */
  setReceiverY(y: number | null): void {
    if (y === this.receiverY) return;
    this.receiverY = y;
    this.fitDirty = true;
  }

  /** Test and meter hook: how the shadows are fitted right now. */
  fitInfo(): {
    closeUp: boolean;
    refits: number;
    subjectRadius: number;
    lights: Record<LightId, { width: number; texel: number; near: number; far: number; radius: number; casts: boolean }>;
  } {
    const lights = {} as Record<LightId, { width: number; texel: number; near: number; far: number; radius: number; casts: boolean }>;
    for (const id of ALL) {
      const shadow = this.lights[id].shadow;
      const cam = shadow.camera;
      const width = cam.right - cam.left;
      lights[id] = { width, texel: width / shadow.mapSize.x, near: cam.near, far: cam.far, radius: shadow.radius, casts: this.lights[id].castShadow };
    }
    return { closeUp: this.closeUp, refits: this.refits, subjectRadius: this.subjectRadius, lights };
  }

  private takeSubject(box: Box3): void {
    this.subjectBox.copy(box);
    const sphere = box.getBoundingSphere(this.sphereScratch);
    this.subjectRadius = Math.max(sphere.radius, 1e-3);
    // Far enough out that the whole subject is in front of every light.
    this.distance = this.subjectRadius * 4;
    this.aimCenter.copy(sphere.center);
    this.fitDirty = true;
  }

  /**
   * Fit each shadow camera's orthographic frustum to what it has to cover,
   * once a frame (Viewer.refitShadows) and on any change to the subject.
   *
   * Across the light: the subject's bounds as the light sees them, or, in
   * a close-up (the view showing a small part of the subject), only the
   * part of them in view, so the map's texels go where the eye is. Casters
   * outside the view still shade what is in it: a receiver and whatever
   * shades it share a texel, so covering the receivers is enough. Along
   * the light: the whole subject, and the shadow it throws on the ground.
   *
   * A fit leaves some room (FIT_SLACK) and is redone only when what is
   * needed leaves it, shrinks well inside it, or the light turns; close-up
   * engages and releases at two different ratios. All of it is the shadow
   * cameras' projections, which reach the GPU as a uniform at the map's
   * next draw: no shader is built and no map reallocated.
   *
   * Returns whether a casting light's fit changed (the picture changes).
   */
  updateShadowFit(view: PerspectiveCamera | null, focus: number | null = null): boolean {
    this.fitView = view;
    this.fitFocus = focus;
    if (this.subjectBox.isEmpty()) return false;
    this.rig.updateMatrixWorld(true);
    const box = this.subjectBox;
    const R = this.subjectRadius;
    const ids = ALL.filter((id) => this.sizes[id] > 0);

    // Each light's frame, as three sets the shadow camera at its next draw
    // (LightShadow.updateMatrices), and the box as that light sees it.
    for (const id of ids) {
      const light = this.lights[id];
      const cam = light.shadow.camera;
      const need = this.needs[id];
      need.pos.setFromMatrixPosition(light.matrixWorld);
      need.target.setFromMatrixPosition(light.target.matrixWorld);
      cam.position.copy(need.pos);
      cam.lookAt(need.target);
      cam.updateMatrixWorld();
      need.dir.subVectors(need.pos, need.target).normalize();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, d0 = Infinity, d1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const c = corner(box, i, this.p0);
        const p = this.p1.copy(c).applyMatrix4(cam.matrixWorldInverse);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        const depth = -p.z;
        d0 = Math.min(d0, depth);
        d1 = Math.max(d1, depth);
        // The shadow this corner throws on the ground lies further along
        // the same ray: the same texel, deeper.
        if (this.receiverY !== null && need.dir.y > 1e-3 && c.y > this.receiverY) {
          d1 = Math.max(d1, depth + Math.min((c.y - this.receiverY) / need.dir.y, GROUND_REACH * R));
        }
      }
      need.s.set(x0, x1, y0, y1);
      need.v.set(x0, x1, y0, y1);
      need.d0 = d0;
      need.d1 = d1;
    }

    // The part of the subject in view (slab), as each light sees it,
    // against the subject's own extent there.
    if (view && this.slab(view, focus, ids)) {
      for (const id of ids) {
        const need = this.needs[id];
        const m = this.lights[id].shadow.camera.matrixWorldInverse;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < this.visCount; k++) {
          const p = this.p1.copy(this.visPts[k]).applyMatrix4(m);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        const s = need.s;
        const v = need.v.set(Math.max(s.x0, x0), Math.min(s.x1, x1), Math.max(s.y0, y0), Math.min(s.y1, y1));
        // Nothing of the subject in view: the plain fit.
        if (v.x0 >= v.x1 || v.y0 >= v.y1) v.set(s.x0, s.x1, s.y0, s.y1);
      }
    }

    // Close-up is one decision for the rig, made on the key light, with
    // room between engaging and releasing so it does not flicker.
    const key = this.needs[ids.includes('key') ? 'key' : ids[0]];
    if (key) {
      const ratio = key.v.half() / Math.max(key.s.half(), 1e-9);
      if (this.closeUp ? ratio > CLOSE_UP_RELEASE : ratio < CLOSE_UP_ENGAGE) {
        this.closeUp = !this.closeUp;
        this.fitDirty = true;
      }
    }

    let changed = false;
    for (const id of ids) if (this.fitLight(id) && this.lights[id].castShadow) changed = true;
    this.fitDirty = false;
    if (changed) this.refits++;
    return changed;
  }

  /**
   * What of the subject is in view, as world points in visPts (visCount of
   * them): the view's frustum across the subject's depth, cut off a little
   * past the orbit target (what a close-up is of: the subject's far side
   * is behind its near one), and the stretch of ground under its shadow
   * that the view takes in. False when none of it is in front of the camera.
   */
  private slab(view: PerspectiveCamera, focus: number | null, ids: LightId[]): boolean {
    view.updateMatrixWorld();
    const inv = view.matrixWorldInverse;
    const R = this.subjectRadius;
    let near = Infinity;
    let far = -Infinity;
    for (let i = 0; i < 8; i++) {
      const z = -corner(this.subjectBox, i, this.p0).applyMatrix4(inv).z;
      near = Math.min(near, z);
      far = Math.max(far, z);
    }
    near = Math.max(near, view.near);
    if (focus !== null) far = Math.min(far, Math.max(focus, near) + FOCUS_DEPTH * R);
    this.visCount = 0;
    if (far > near) {
      for (let k = 0; k < 4; k++) {
        // A point on this corner's ray, in view space, then along it to each depth.
        const ray = this.p0.set(k & 1 ? 1 : -1, k & 2 ? 1 : -1, 0.5).applyMatrix4(view.projectionMatrixInverse);
        this.visPts[this.visCount++].copy(ray).multiplyScalar(near / -ray.z).applyMatrix4(view.matrixWorld);
        this.visPts[this.visCount++].copy(ray).multiplyScalar(far / -ray.z).applyMatrix4(view.matrixWorld);
      }
    }

    // The ground under the shadow: the rectangle the subject's footprint
    // and its shadows span on it, clipped to the view's frustum.
    if (this.receiverY !== null) {
      const y = this.receiverY;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const c = corner(this.subjectBox, i, this.p0);
        x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z);
        if (c.y <= y) continue;
        for (const id of ids) {
          const dir = this.needs[id].dir;
          if (dir.y <= 1e-3) continue;
          const t = Math.min((c.y - y) / dir.y, GROUND_REACH * R);
          const gx = c.x - dir.x * t;
          const gz = c.z - dir.z * t;
          x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); z0 = Math.min(z0, gz); z1 = Math.max(z1, gz);
        }
      }
      this.viewProj.multiplyMatrices(view.projectionMatrix, inv);
      this.viewFrustum.setFromProjectionMatrix(this.viewProj, view.coordinateSystem);
      let poly = [this.g0.set(x0, y, z0), this.g1.set(x1, y, z0), this.g2.set(x1, y, z1), this.g3.set(x0, y, z1)];
      // The four side planes (three's order: right, left, bottom, top);
      // between them they hold only what is in front of the camera.
      for (let k = 0; k < 4 && poly.length; k++) poly = clipPolygon(poly, this.viewFrustum.planes[k]);
      for (const p of poly) if (this.visCount < this.visPts.length) this.visPts[this.visCount++].copy(p);
    }
    return this.visCount > 0;
  }

  /** Refit one light's frustum when its needed region asks for it; true when it did. */
  private fitLight(id: LightId): boolean {
    const need = this.needs[id];
    const fit = this.fits[id];
    const R = this.subjectRadius;
    const r = this.closeUp ? need.v : need.s;
    // Room for the blur's reach past the last texel, and a hair more.
    const pad = 0.03 * R + this.blurWorld(id);
    const half = Math.max(r.half() + pad, this.minHalf(id));
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const depthPad = 0.05 * R;
    const d0 = need.d0 - depthPad;
    const d1 = need.d1 + depthPad;
    const turned = !fit.valid || fit.pos.distanceToSquared(need.pos) > (R * 1e-5) ** 2 || fit.target.distanceToSquared(need.target) > (R * 1e-5) ** 2;
    const tooBig = fit.valid && half * FIT_SLACK < FIT_SHRINK * fit.half;
    const inside =
      fit.valid &&
      cx - half >= fit.cx - fit.half && cx + half <= fit.cx + fit.half &&
      cy - half >= fit.cy - fit.half && cy + half <= fit.cy + fit.half &&
      d0 >= fit.near && d1 <= fit.far;
    if (!this.fitDirty && !turned && inside && !tooBig) return false;

    // A turning light keeps its size while that still covers (no breathing
    // as the rig follows an orbit); otherwise a fresh fit, with room.
    const h = turned && fit.valid && !this.fitDirty && half <= fit.half && !tooBig ? fit.half : half * FIT_SLACK;
    // Whole texels: a fit that only slides does not crawl.
    const texel = (2 * h) / Math.max(this.lights[id].shadow.mapSize.x, 1);
    fit.cx = Math.round(cx / texel) * texel;
    fit.cy = Math.round(cy / texel) * texel;
    fit.half = h;
    const span = d1 - d0;
    fit.near = d0 - span * (FIT_SLACK - 1);
    fit.far = d1 + span * (FIT_SLACK - 1);
    fit.pos.copy(need.pos);
    fit.target.copy(need.target);
    fit.valid = true;

    const cam = this.lights[id].shadow.camera;
    cam.left = fit.cx - h;
    cam.right = fit.cx + h;
    cam.bottom = fit.cy - h;
    cam.top = fit.cy + h;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    this.applyBlur(id);
    return true;
  }

  /**
   * The width softness was authored against: the old fixed frustum, three
   * subject radii either side. The blur radius is in texels; scaled by
   * this over the fitted width, a softness reads the same at any fit.
   */
  private softnessRef(): number {
    return SOFTNESS_REF_RADII * this.subjectRadius;
  }

  /** Softness in texels at the old fit (as before: halved maps blur half as many). */
  private baseBlur(id: LightId): number {
    return (this.config[id].softness ?? DEFAULT_SOFTNESS) * this.mapScale;
  }

  /** The blur's reach in world units (the same at any fit). */
  private blurWorld(id: LightId): number {
    return (this.baseBlur(id) * this.softnessRef()) / Math.max(this.lights[id].shadow.mapSize.x, 1);
  }

  /**
   * The smallest half-width a fit takes for this light's softness: the
   * blur's samples spread over twice its radius, and past about two texels
   * apart they show as steps. A soft shadow does not need fine texels; a
   * hard one (softness 0) fits as tight as it likes.
   */
  private minHalf(id: LightId): number {
    const base = this.baseBlur(id);
    if (base <= 0) return 0;
    const samples = this.lights[id].shadow.blurSamples;
    const cap = Math.max(base, 2 * Math.max(samples - 1, 1));
    return (base * this.softnessRef()) / (2 * cap);
  }

  /** Blur radius and depth bias for the fit in force, so both keep their world size. */
  private applyBlur(id: LightId): void {
    if (this.sizes[id] === 0) return;
    const shadow = this.lights[id].shadow;
    const cam = shadow.camera;
    const width = cam.right - cam.left;
    const ref = this.softnessRef();
    shadow.radius = width > 0 ? (this.baseBlur(id) * ref) / width : this.baseBlur(id);
    // The bias is in the frustum's depth range; the old range was the same
    // six radii, so a tighter one keeps its bias in world terms.
    const range = cam.far - cam.near;
    shadow.bias = range > 0 ? (this.userBias * ref) / range : this.userBias;
  }

  private shadowsMaster = true;
  /** Where the lights aim: the fitted subject centre, until the next fit. */
  private readonly aimCenter = new Vector3();
  /** The subject the shadows fit to (world). */
  private readonly subjectBox = new Box3();
  /** The plane catching the subject's shadow, if any (setReceiverY). */
  private receiverY: number | null = null;
  /** The view the last fit was for, and its orbit target's distance, reused by fitToBounds. */
  private fitView: PerspectiveCamera | null = null;
  private fitFocus: number | null = null;
  /** Whether the close-up fit is engaged. */
  private closeUp = false;
  /** Fits applied since boot (a counter for the tests). */
  private refits = 0;
  /** The next updateShadowFit refits every light. */
  private fitDirty = true;
  /** The depth bias as set (setBias), before it is scaled to the fit's depth range. */
  private userBias = -0.0005;
  private readonly fits: Record<LightId, ShadowFit> = { key: newFit(), fill: newFit(), rim: newFit() };
  private readonly needs: Record<LightId, ShadowNeed> = { key: newNeed(), fill: newNeed(), rim: newNeed() };
  /** What of the subject is in view (slab), as world points. */
  private readonly visPts = Array.from({ length: 16 }, () => new Vector3());
  private visCount = 0;
  private readonly viewProj = new Matrix4();
  private readonly viewFrustum = new Frustum();
  private readonly g0 = new Vector3();
  private readonly g1 = new Vector3();
  private readonly g2 = new Vector3();
  private readonly g3 = new Vector3();
  private readonly sphereScratch = new Sphere();
  private readonly p0 = new Vector3();
  private readonly p1 = new Vector3();

  private refresh(center?: Vector3): void {
    // Every slider-driven refresh used to re-aim at the origin, throwing
    // away the centre fitToBounds computed a moment earlier.
    if (center) this.aimCenter.copy(center);
    // Softness and map sizes set the smallest fit: the next one starts fresh.
    this.fitDirty = true;
    for (const id of ALL) this.apply(id, this.aimCenter);
    this.onChange?.();
  }

  /** A light's position and aim, from its angles. */
  private place(id: LightId, target: Vector3): void {
    const light = this.lights[id];
    const cfg = this.config[id];
    const az = MathUtils.degToRad(cfg.azimuth);
    const el = MathUtils.degToRad(cfg.elevation);
    light.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    light.position.multiplyScalar(this.distance).add(target);
    light.target.position.copy(target);
    light.target.updateMatrixWorld();
  }

  private apply(id: LightId, target: Vector3): void {
    const light = this.lights[id];
    const cfg = this.config[id];

    light.intensity = cfg.intensity;
    light.color = new Color(cfg.color);
    this.place(id, target);

    // A light casts only if the tier gives it a map, it's configured to, and
    // it's on. Softness drives the VSM blur. The rim casts by default, on
    // every tier (owner call: without its shadow it lit the far side
    // straight through the model); its box in the panel still turns it off.
    const canCast = this.sizes[id] > 0;
    light.visible = cfg.enabled;
    light.castShadow = canCast && cfg.castShadow && cfg.enabled && this.shadowsMaster;
    this.applyBlur(id);
  }
}

/** A fit leaves this much room around what it covers. */
const FIT_SLACK = 1.15;
/** A fit is redone smaller once what it covers, with room, is under this share of it. */
const FIT_SHRINK = 0.75;
/** Close-up engages when the part in view needs under this share of the whole subject's width... */
const CLOSE_UP_ENGAGE = 0.75;
/** ...and releases once it needs over this share. */
const CLOSE_UP_RELEASE = 0.9;
/** A close-up covers the subject to this many radii past the orbit target (the near side of it). */
const FOCUS_DEPTH = 0.3;
/** The ground shadow is covered out to this many subject radii along the light. */
const GROUND_REACH = 4;
/** The frustum width, in subject radii, softness was authored against (the old fixed fit). */
const SOFTNESS_REF_RADII = 6;

/** A light-space rectangle. */
class Rect {
  x0 = 0;
  x1 = 0;
  y0 = 0;
  y1 = 0;
  set(x0: number, x1: number, y0: number, y1: number): this {
    this.x0 = x0;
    this.x1 = x1;
    this.y0 = y0;
    this.y1 = y1;
    return this;
  }
  /** Half the larger side: the half-width of a square map covering it. */
  half(): number {
    return Math.max(this.x1 - this.x0, this.y1 - this.y0) / 2;
  }
}

/** What a light's frustum has to cover this frame. */
interface ShadowNeed {
  pos: Vector3;
  target: Vector3;
  /** Towards the light. */
  dir: Vector3;
  /** The whole subject, across the light. */
  s: Rect;
  /** The part of it in view (the whole, without a view). */
  v: Rect;
  /** Depth range along the light: the subject, and its shadow on the ground. */
  d0: number;
  d1: number;
}

/** The fit in force for a light, in its light space at the time. */
interface ShadowFit {
  valid: boolean;
  pos: Vector3;
  target: Vector3;
  cx: number;
  cy: number;
  half: number;
  near: number;
  far: number;
}

const newNeed = (): ShadowNeed => ({ pos: new Vector3(), target: new Vector3(), dir: new Vector3(), s: new Rect(), v: new Rect(), d0: 0, d1: 0 });
const newFit = (): ShadowFit => ({ valid: false, pos: new Vector3(), target: new Vector3(), cx: 0, cy: 0, half: 1, near: 0.1, far: 10 });

/** A convex polygon cut by a plane, keeping the side the normal points to (Sutherland-Hodgman). */
function clipPolygon(poly: Vector3[], plane: Plane): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = plane.distanceToPoint(a);
    const db = plane.distanceToPoint(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}

/** Corner i (bits x, y, z) of a box, into out. */
function corner(box: Box3, i: number, out: Vector3): Vector3 {
  return out.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
}
