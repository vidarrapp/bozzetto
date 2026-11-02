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
  /** VSM blur sample count (soft-shadow quality): the fewest a light takes. */
  blurSamples: number;
  /**
   * The most a light's blur takes as its softness grows (Lighting.applyBlur):
   * enough to keep the samples about two texels apart, up to this.
   */
  maxBlurSamples: number;
  /** GTAO sample count (AO quality vs cost). */
  aoSamples: number;
  /** GTAO render-target scale (1 = full-res; <1 trims AO cost on weaker GPUs). */
  aoResolutionScale: number;
}

// A single small subject with a tight, subject-fit shadow frustum doesn't need
// 4k maps — 2k is plenty and far cheaper (Lighting.updateShadowFit fits each
// frustum to the subject, or to the part of it in view). Adaptive quality
// trims further at runtime when the measured FPS is low (mostly via pixel
// ratio). A soft shadow's blur takes more samples as its radius grows, from
// blurSamples up to maxBlurSamples, so they stay about two texels apart. Every tier gives the rim a map, so its shadow (on by default)
// keeps it from lighting the far side through the model; low's is small.
export const SHADOW_TIERS: Record<Quality, ShadowTier> = {
  high: { key: 2048, fill: 1024, rim: 1024, blurSamples: 12, maxBlurSamples: 32, aoSamples: 16, aoResolutionScale: 1 },
  medium: { key: 2048, fill: 1024, rim: 1024, blurSamples: 8, maxBlurSamples: 24, aoSamples: 8, aoResolutionScale: 1 },
  low: { key: 1024, fill: 0, rim: 512, blurSamples: 4, maxBlurSamples: 12, aoSamples: 8, aoResolutionScale: 0.5 },
};

/** The tier the page's `?q=` asks for, if it names one. */
export function qualityOverride(): Quality | null {
  const override = new URLSearchParams(location.search).get('q');
  return override === 'high' || override === 'medium' || override === 'low' ? override : null;
}

/** Whether a renderer description names a software rasterizer (SwiftShader, llvmpipe, WARP...). */
export function isSoftwareRenderer(description: string): boolean {
  return /swiftshader|software|basic render|llvmpipe|warp\b/i.test(description);
}

export function detectQuality(): Quality {
  const override = qualityOverride();
  if (override) return override;

  // WebGPU mandates a maxTextureDimension2D of at least 8192, so the old
  // max-texture-size proxy for weak GPUs no longer discriminates; gate the low
  // tier on mobile alone (`medium` is reachable via ?q=medium).
  if (isMobile()) return 'low';
  return 'high';
}

function isMobile(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // iPadOS Safari reports a Macintosh UA; the touch points give it away.
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}
