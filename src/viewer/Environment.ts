import {
  EquirectangularReflectionMapping,
  PMREMGenerator,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/** Persisted environment state (stored in a project's `data.environment`). */
export interface EnvState {
  id: string | null;
  intensity: number;
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
 * Image-based lighting from an HDRI (Phase B). Loads an equirectangular .hdr,
 * prefilters it with PMREM, and sets it as `scene.environment` so the Lit (PBR)
 * material picks up irradiance + reflections. Intensity is applied to the lit
 * material's envMapIntensity (r160 has no scene.environmentIntensity).
 */
export class Environment {
  private readonly pmrem: PMREMGenerator;
  private readonly loader = new RGBELoader();
  private envMap: Texture | null = null;
  private currentId: string | null = null;
  private intensity = 1;
  /** Guards against an earlier load resolving after a later selection. */
  private token = 0;

  constructor(
    private readonly scene: Scene,
    renderer: WebGLRenderer,
    private readonly applyIntensity: (value: number) => void,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  list(): { id: string; label: string }[] {
    return ENVIRONMENTS.map((e) => ({ id: e.id, label: e.label }));
  }

  getState(): EnvState {
    return { id: this.currentId, intensity: this.intensity };
  }

  async setEnvironment(id: string | null): Promise<void> {
    this.currentId = id;
    const myToken = ++this.token;
    this.disposeMap();

    const cfg = id ? ENVIRONMENTS.find((e) => e.id === id) : undefined;
    if (!cfg) {
      this.scene.environment = null;
      return;
    }

    try {
      const equirect = await this.loader.loadAsync(cfg.file);
      if (myToken !== this.token) {
        equirect.dispose();
        return; // superseded by a newer selection
      }
      equirect.mapping = EquirectangularReflectionMapping;
      this.envMap = this.pmrem.fromEquirectangular(equirect).texture;
      equirect.dispose();
      this.scene.environment = this.envMap;
    } catch (err) {
      console.error(`Environment "${id}" failed to load:`, err);
      this.scene.environment = null;
    }
  }

  setIntensity(value: number): void {
    this.intensity = value;
    this.applyIntensity(value);
  }

  async applyState(state: Partial<EnvState>): Promise<void> {
    if (typeof state.intensity === 'number') this.setIntensity(state.intensity);
    if ('id' in state) await this.setEnvironment(state.id ?? null);
  }

  dispose(): void {
    this.disposeMap();
    this.pmrem.dispose();
  }

  private disposeMap(): void {
    this.envMap?.dispose();
    this.envMap = null;
  }
}
