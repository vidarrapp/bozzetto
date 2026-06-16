import type { WebGLRenderer } from 'three';

/**
 * Render quality tiers for the shadow system. The public viewer runs on
 * visitors' devices, so shadow-map sizes (and which lights cast at all) scale
 * down on weaker GPUs / mobile. Override with `?q=high|medium|low`.
 */
export type Quality = 'high' | 'medium' | 'low';

export interface ShadowTier {
  /** Shadow-map size per light id; 0 disables that light's shadow entirely. */
  key: number;
  fill: number;
  rim: number;
  /** VSM blur sample count (soft-shadow quality). */
  blurSamples: number;
}

export const SHADOW_TIERS: Record<Quality, ShadowTier> = {
  high: { key: 4096, fill: 2048, rim: 2048, blurSamples: 16 },
  medium: { key: 2048, fill: 1024, rim: 0, blurSamples: 8 },
  low: { key: 1024, fill: 0, rim: 0, blurSamples: 4 },
};

export function detectQuality(renderer: WebGLRenderer): Quality {
  const override = new URLSearchParams(location.search).get('q');
  if (override === 'high' || override === 'medium' || override === 'low') return override;

  if (isMobile() || renderer.capabilities.maxTextureSize < 4096) return 'low';
  return 'high'; // `medium` is reachable via ?q=medium
}

function isMobile(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
