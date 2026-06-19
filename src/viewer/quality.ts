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
  /** Ambient-occlusion technique at this tier (GTAO on capable, SSAO on mobile). */
  ao: 'gtao' | 'ssao' | 'none';
  /** GTAO sample count (AO quality vs cost). */
  aoSamples: number;
}

// A single small subject with a tight, subject-fit shadow frustum doesn't need
// 4k maps — 2k is plenty and far cheaper. Adaptive quality trims further at
// runtime when the measured FPS is low (mostly via pixel ratio).
export const SHADOW_TIERS: Record<Quality, ShadowTier> = {
  high: { key: 2048, fill: 1024, rim: 1024, blurSamples: 12, ao: 'gtao', aoSamples: 16 },
  medium: { key: 2048, fill: 1024, rim: 0, blurSamples: 8, ao: 'gtao', aoSamples: 8 },
  low: { key: 1024, fill: 0, rim: 0, blurSamples: 4, ao: 'ssao', aoSamples: 0 },
};

export function detectQuality(): Quality {
  const override = new URLSearchParams(location.search).get('q');
  if (override === 'high' || override === 'medium' || override === 'low') return override;

  // WebGPU mandates a maxTextureDimension2D of at least 8192, so the old
  // max-texture-size proxy for weak GPUs no longer discriminates; gate the low
  // tier on mobile alone (`medium` is reachable via ?q=medium).
  if (isMobile()) return 'low';
  return 'high';
}

function isMobile(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
