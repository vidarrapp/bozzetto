/**
 * Cache-busting version for the stable-named static assets (the matcaps). Their
 * URLs are identical across content changes and served with a long cache, so
 * without a fresh query the browser and CDN keep serving the previous bytes.
 * Bump this whenever a matcap PNG in public/assets/matcaps is replaced.
 *
 *   1 - initial Blender 2-sphere previews (1024x512)
 *   2 - single-sphere matcaps (512x512)
 */
export const ASSET_VERSION = '2';
