import { Color, EquirectangularReflectionMapping, type Scene, type Texture } from 'three';
import { PMREMGenerator, type WebGPURenderer } from 'three/webgpu';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { getTheme, onThemeChange, THEME_BG } from '../ui/theme';
import { loadViaBlob, type AssetSource } from './AssetSource';
import { hexColor } from './color';

export type BackgroundMode = 'theme' | 'color' | 'hdri';
/**
 * Sculpt's and Armature's background for a new scene or figure and their
 * fresh-start look (owner call): a neutral grey, 20 % on the colour
 * picker's V scale. The viewer itself keeps following the theme.
 */
export const STUDIO_BG = '#333333';

const BACKGROUND_MODES: readonly BackgroundMode[] = ['theme', 'color', 'hdri'];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Persisted environment state (stored in a project's `data.environment`). */
export interface EnvState {
  /**
   * The scale the record is on (ENV_STATE_VERSION). Records written before
   * the rescale have none, and applyState reads them on the old one.
   */
  v?: number;
  id: string | null;
  /** The environment's light, in slider units: 1 is ENV_INTENSITY_SCALE to the renderer. */
  intensity: number;
  background: BackgroundMode;
  bgColor: string;
  /** HDRI rotation offset in degrees (on top of the shared rig rotation). */
  rotation: number;
  /** Background blur (scene.backgroundBlurriness, 0..1); softens an HDRI plate. */
  blur: number;
  /** The HDRI plate's brightness (scene.backgroundIntensity), apart from its light. */
  bgBrightness: number;
}

interface EnvConfig {
  id: string;
  label: string;
  file: string;
}

/**
 * What 1 on the Intensity slider is to the renderer (owner call). At the
 * renderer's 1 the Neutral studio map adds about as much light as sculpt
 * mode's key light and fills the shadow side in (the key's modelling drops
 * by a quarter, measured), and the owner works at about 0.1, so nearly all
 * of the slider's travel sat above anything in use. Scaled, the slider's
 * 0..2 is the renderer's 0..0.4.
 */
export const ENV_INTENSITY_SCALE = 0.2;

/**
 * Where an environment starts when a look has none of its own: 0.2 to the
 * renderer, which fills without flattening the key light's modelling.
 */
export const DEFAULT_ENV_INTENSITY = 1;

/** The HDRI plate's starting brightness: the map as the renderer shows it at 1. */
export const DEFAULT_BG_BRIGHTNESS = 1;

/**
 * The scale an environment record is written on. A record without it is
 * from before the rescale: its intensity is in the renderer's own units,
 * and its plate was as bright as its light (see applyState).
 */
export const ENV_STATE_VERSION = 2;

/** Available HDRIs (public/assets/env). Missing files just fail to load. */
export const ENVIRONMENTS: EnvConfig[] = [
  { id: 'studio-neutral', label: 'Neutral studio', file: '/assets/env/studio-neutral.hdr' },
  { id: 'studio-photo', label: 'Photo studio', file: '/assets/env/studio-photo.hdr' },
  { id: 'overcast', label: 'Soft overcast', file: '/assets/env/overcast.hdr' },
  { id: 'interior-warm', label: 'Warm interior', file: '/assets/env/interior-warm.hdr' },
  { id: 'garage', label: 'Garage', file: '/assets/env/garage.hdr' },
  { id: 'plaza', label: 'Outdoor plaza', file: '/assets/env/plaza.hdr' },
];

/** Asset path of an HDRI by id, for embedding in a self-contained export. */
export function envAssetUrl(id: string): string | null {
  return ENVIRONMENTS.find((e) => e.id === id)?.file ?? null;
}

/**
 * Image-based lighting + scene background. Loads an equirectangular .hdr,
 * prefilters it with PMREM for `scene.environment` (PBR irradiance +
 * reflections), and owns `scene.background`: the theme colour, a solid colour,
 * or the blurred HDRI. Intensity, scaled by ENV_INTENSITY_SCALE, drives
 * `scene.environmentIntensity`: for a standard material lit by
 * `scene.environment` (no own envMap), the renderer overrides
 * `material.envMapIntensity` with it, so that is the only knob that takes
 * effect. The plate shown as the background has its own brightness, so
 * the light can be set without the backdrop going dim or blowing out.
 */
export class Environment {
  private readonly pmrem: PMREMGenerator;
  private readonly loader = new HDRLoader();
  private envMap: Texture | null = null;
  private equirect: Texture | null = null;
  private currentId: string | null = null;
  private intensity = DEFAULT_ENV_INTENSITY;
  private bgBrightness = DEFAULT_BG_BRIGHTNESS;
  private bgMode: BackgroundMode = 'theme';
  private bgColor = '#1c1814';
  private rigRotation = 0;
  private offset = 0;
  private blur = 0;
  /** Guards against an earlier load resolving after a later selection. */
  private token = 0;
  private readonly disposeTheme: () => void;

  /** Fired while an HDRI is downloading/prefiltering (drives a loading hint). */
  onLoading: ((loading: boolean) => void) | null = null;
  /**
   * Fired after anything that changes the picture, an HDRI landing after
   * its download included: a still frame starts smoothing over.
   */
  onChange: (() => void) | null = null;

  constructor(
    private readonly scene: Scene,
    renderer: WebGPURenderer,
    private readonly source: AssetSource,
  ) {
    // The node renderer's own PMREM (three/webgpu), not the WebGL one from
    // 'three': that one happened to work on the WebGL2 backend (measured -
    // a Lit sphere lit by the HDRI alone), but it renders GLSL passes the
    // WebGPU backend cannot run, so the two backends would not prefilter
    // alike. The node generator is built for both.
    this.pmrem = new PMREMGenerator(renderer);
    this.scene.environmentIntensity = this.intensity * ENV_INTENSITY_SCALE;
    this.scene.backgroundIntensity = this.bgBrightness;
    this.updateBackground();
    this.disposeTheme = onThemeChange(() => {
      if (this.bgMode === 'theme') this.updateBackground();
    });
  }

  list(): { id: string; label: string }[] {
    return ENVIRONMENTS.map((e) => ({ id: e.id, label: e.label }));
  }

  getState(): EnvState {
    return {
      v: ENV_STATE_VERSION,
      id: this.currentId,
      intensity: this.intensity,
      background: this.bgMode,
      bgColor: this.bgColor,
      rotation: this.offset,
      blur: this.blur,
      bgBrightness: this.bgBrightness,
    };
  }

  async setEnvironment(id: string | null): Promise<void> {
    const cfg = id ? ENVIRONMENTS.find((e) => e.id === id) : undefined;
    // An id that names no environment (a file's, say) is none, not kept.
    this.currentId = cfg ? cfg.id : null;
    const myToken = ++this.token;
    this.disposeMaps();
    this.scene.environment = null; // never point the scene at a disposed map
    if (this.bgMode === 'hdri') this.updateBackground(); // fall back until loaded

    if (!cfg) {
      this.scene.environment = null;
      return;
    }

    this.onLoading?.(true);
    try {
      const equirect = await loadViaBlob(this.source, cfg.file, 'image/vnd.radiance', (url) =>
        this.loader.loadAsync(url),
      );
      if (myToken !== this.token) {
        equirect.dispose();
        return; // superseded by a newer selection
      }
      equirect.mapping = EquirectangularReflectionMapping;
      this.equirect = equirect;
      this.envMap = this.pmrem.fromEquirectangular(equirect).texture;
      this.scene.environment = this.envMap;
      this.updateBackground();
      this.onChange?.();
    } catch (err) {
      console.error(`Environment "${id}" failed to load:`, err);
      this.scene.environment = null;
    } finally {
      if (myToken === this.token) this.onLoading?.(false);
    }
  }

  /** The environment's light, in slider units (see ENV_INTENSITY_SCALE). */
  setIntensity(value: number): void {
    this.intensity = value;
    this.scene.environmentIntensity = value * ENV_INTENSITY_SCALE;
    this.onChange?.();
  }

  /**
   * The HDRI plate's brightness. It only scales a texture background, so
   * the theme and solid-colour backgrounds are untouched. It used to be
   * the light's own intensity, which dimmed the plate to near black at the
   * light levels in use.
   */
  setBackgroundBrightness(value: number): void {
    this.bgBrightness = value;
    this.scene.backgroundIntensity = value;
    this.onChange?.();
  }

  setBackgroundMode(mode: BackgroundMode): void {
    this.bgMode = mode;
    this.updateBackground();
  }

  setBackgroundColor(hex: string): void {
    this.bgColor = hexColor(hex, this.bgColor);
    if (this.bgMode === 'color') this.updateBackground();
  }

  /** Shared rig rotation (degrees) — set by the viewer's Rotate-rig slider. */
  setRotation(deg: number): void {
    this.rigRotation = deg;
    this.applyRotation();
  }

  /** Independent HDRI offset (degrees) — editor slider, on top of the rig. */
  setOffset(deg: number): void {
    this.offset = deg;
    this.applyRotation();
  }

  /** Background blur (0..1). Softens a texture (HDRI) background; no effect on a
   *  solid/theme colour, which has nothing to blur. */
  setBackgroundBlur(value: number): void {
    this.blur = value;
    this.scene.backgroundBlurriness = value;
    this.onChange?.();
  }

  private applyRotation(): void {
    const rad = ((this.rigRotation + this.offset) * Math.PI) / 180;
    this.scene.environmentRotation.set(0, rad, 0);
    this.scene.backgroundRotation.set(0, rad, 0);
    this.onChange?.();
  }

  /**
   * Every saved environment comes back through here - a project's manifest
   * at boot (published, and the single-file export's), and every look
   * through Viewer.applyLook (sculpt's, kept between visits beside the
   * autosave; .bozz files and gallery scenes; armatures and their files) -
   * so this is where the rescale is undone for records written before it. One without the version mark has its intensity in
   * the renderer's units and showed its plate as bright as its light: the
   * intensity is divided by the scale and the plate takes the old value,
   * so it renders exactly as it did. The renderer gets the stored number
   * itself, since dividing and multiplying back can move the last bit; the
   * slider's value is rounded past the ninth decimal, so 0.6 is saved
   * again as 3 rather than 2.9999999999999996.
   */
  async applyState(state: Partial<EnvState>): Promise<void> {
    // Each value only when it is what it says it is: these records come
    // from files and manifests as well as from this app, and the colour
    // ends up in a panel swatch's style (see color.ts).
    const rescaled = finite(state.v) && state.v >= ENV_STATE_VERSION;
    if (finite(state.intensity) && state.intensity >= 0) {
      if (rescaled) {
        this.setIntensity(state.intensity);
      } else {
        this.setIntensity(Math.round((state.intensity / ENV_INTENSITY_SCALE) * 1e9) / 1e9);
        this.scene.environmentIntensity = state.intensity;
        this.setBackgroundBrightness(state.intensity);
      }
    }
    if (rescaled && finite(state.bgBrightness) && state.bgBrightness >= 0) {
      this.setBackgroundBrightness(state.bgBrightness);
    }
    if (BACKGROUND_MODES.includes(state.background as BackgroundMode)) this.bgMode = state.background!;
    if (state.bgColor !== undefined) this.bgColor = hexColor(state.bgColor, this.bgColor);
    if (finite(state.rotation)) this.offset = state.rotation;
    if (finite(state.blur)) this.blur = Math.min(1, Math.max(0, state.blur));
    this.applyRotation();
    if ('id' in state) await this.setEnvironment(typeof state.id === 'string' ? state.id : null);
    // Always: with no HDRI, setEnvironment returns before touching the
    // background, and a saved solid colour came back as the theme.
    this.updateBackground();
  }

  dispose(): void {
    this.disposeTheme();
    this.disposeMaps();
    this.pmrem.dispose();
  }

  private updateBackground(): void {
    // The theme switching counts as a change too: the theme background follows it.
    this.onChange?.();
    // Background softening: the editor's Bg blur slider plus the camera's
    // depth-of-field bokeh both contribute (this is the always-on plate blur).
    this.scene.backgroundBlurriness = this.blur;
    if (this.bgMode === 'hdri' && this.equirect) {
      this.scene.background = this.equirect;
    } else if (this.bgMode === 'color') {
      this.scene.background = new Color(this.bgColor);
    } else {
      // theme — also the fallback for "hdri" before the map has loaded.
      this.scene.background = new Color(THEME_BG[getTheme()]);
    }
  }

  private disposeMaps(): void {
    this.envMap?.dispose();
    this.envMap = null;
    this.equirect?.dispose();
    this.equirect = null;
  }
}
