import {
  Color,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { getTheme, onThemeChange, THEME_BG } from '../ui/theme';

export type BackgroundMode = 'theme' | 'color' | 'hdri';

/** Persisted environment state (stored in a project's `data.environment`). */
export interface EnvState {
  id: string | null;
  intensity: number;
  background: BackgroundMode;
  bgColor: string;
  bgBlur: number;
}

interface EnvConfig {
  id: string;
  label: string;
  file: string;
}

/** Available HDRIs (public/assets/env). Missing files just fail to load. */
export const ENVIRONMENTS: EnvConfig[] = [
  { id: 'studio-neutral', label: 'Neutral studio', file: '/assets/env/studio-neutral.hdr' },
  { id: 'studio-photo', label: 'Photo studio', file: '/assets/env/studio-photo.hdr' },
  { id: 'overcast', label: 'Soft overcast', file: '/assets/env/overcast.hdr' },
  { id: 'interior-warm', label: 'Warm interior', file: '/assets/env/interior-warm.hdr' },
  { id: 'garage', label: 'Garage', file: '/assets/env/garage.hdr' },
  { id: 'plaza', label: 'Outdoor plaza', file: '/assets/env/plaza.hdr' },
];

/**
 * Image-based lighting + scene background. Loads an equirectangular .hdr,
 * prefilters it with PMREM for `scene.environment` (PBR irradiance +
 * reflections), and owns `scene.background`: the theme colour, a solid colour,
 * or the blurred HDRI. Intensity drives the lit material's envMapIntensity
 * (r160 has no scene.environmentIntensity / environmentRotation).
 */
export class Environment {
  private readonly pmrem: PMREMGenerator;
  private readonly loader = new RGBELoader();
  private envMap: Texture | null = null;
  private equirect: Texture | null = null;
  private currentId: string | null = null;
  private intensity = 1;
  private bgMode: BackgroundMode = 'theme';
  private bgColor = '#1c1814';
  private bgBlur = 0.4;
  /** Guards against an earlier load resolving after a later selection. */
  private token = 0;
  private readonly disposeTheme: () => void;

  /** Fired while an HDRI is downloading/prefiltering (drives a loading hint). */
  onLoading: ((loading: boolean) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    renderer: WebGLRenderer,
    private readonly applyIntensity: (value: number) => void,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
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
      id: this.currentId,
      intensity: this.intensity,
      background: this.bgMode,
      bgColor: this.bgColor,
      bgBlur: this.bgBlur,
    };
  }

  async setEnvironment(id: string | null): Promise<void> {
    this.currentId = id;
    const myToken = ++this.token;
    this.disposeMaps();
    if (this.bgMode === 'hdri') this.updateBackground(); // fall back until loaded

    const cfg = id ? ENVIRONMENTS.find((e) => e.id === id) : undefined;
    if (!cfg) {
      this.scene.environment = null;
      return;
    }

    this.onLoading?.(true);
    try {
      const equirect = await this.loader.loadAsync(cfg.file);
      if (myToken !== this.token) {
        equirect.dispose();
        return; // superseded by a newer selection
      }
      equirect.mapping = EquirectangularReflectionMapping;
      this.equirect = equirect;
      this.envMap = this.pmrem.fromEquirectangular(equirect).texture;
      this.scene.environment = this.envMap;
      this.updateBackground();
    } catch (err) {
      console.error(`Environment "${id}" failed to load:`, err);
      this.scene.environment = null;
    } finally {
      if (myToken === this.token) this.onLoading?.(false);
    }
  }

  setIntensity(value: number): void {
    this.intensity = value;
    this.applyIntensity(value);
  }

  setBackgroundMode(mode: BackgroundMode): void {
    this.bgMode = mode;
    this.updateBackground();
  }

  setBackgroundColor(hex: string): void {
    this.bgColor = hex;
    if (this.bgMode === 'color') this.updateBackground();
  }

  setBackgroundBlur(value: number): void {
    this.bgBlur = value;
    if (this.bgMode === 'hdri') this.updateBackground();
  }

  async applyState(state: Partial<EnvState>): Promise<void> {
    if (typeof state.intensity === 'number') this.setIntensity(state.intensity);
    if (state.background) this.bgMode = state.background;
    if (typeof state.bgColor === 'string') this.bgColor = state.bgColor;
    if (typeof state.bgBlur === 'number') this.bgBlur = state.bgBlur;
    if ('id' in state) await this.setEnvironment(state.id ?? null);
    else this.updateBackground();
  }

  dispose(): void {
    this.disposeTheme();
    this.disposeMaps();
    this.pmrem.dispose();
  }

  private updateBackground(): void {
    if (this.bgMode === 'hdri' && this.equirect) {
      this.scene.background = this.equirect;
      this.scene.backgroundBlurriness = this.bgBlur;
    } else if (this.bgMode === 'color') {
      this.scene.background = new Color(this.bgColor);
      this.scene.backgroundBlurriness = 0;
    } else {
      // theme — also the fallback for "hdri" before the map has loaded.
      this.scene.background = new Color(THEME_BG[getTheme()]);
      this.scene.backgroundBlurriness = 0;
    }
  }

  private disposeMaps(): void {
    this.envMap?.dispose();
    this.envMap = null;
    this.equirect?.dispose();
    this.equirect = null;
  }
}
