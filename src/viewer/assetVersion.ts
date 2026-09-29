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

/**
 * The same for the models fetched on demand - the base-mesh library's .bzm
 * files and the Armature mode's mannequins - carried on their URLs as ?r=.
 * The service worker keeps those cache-first for 180 days by URL, so a file
 * replaced under its old name never reaches a browser that already holds
 * it: bumping this is how a changed one gets there, its new URL a cache
 * miss that fetches the new bytes. The entries under the old URLs are never
 * asked for again and fall out through the caches' expiry. The base-mesh
 * thumbnails stay unversioned: they precache with the shell under their
 * plain URLs, which a query would miss, taking them offline.
 *
 *   1 - unversioned URLs
 *   2 - the mirrored right-hand lumps turned right side out
 */
export const MODEL_REVISION = 2;
