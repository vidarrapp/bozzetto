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

/*
 * The models fetched by name - the base-mesh library's .bzm files and the
 * Armature mode's mannequins - have no version of their own any more. They
 * carried one as ?r= while the service worker kept them cache-first by URL
 * after first use, where a file replaced under its old name never reached
 * a browser that already held it. They are precached now, from the first
 * install (owner request: the library and the mannequin a new armature
 * starts on are there offline without ever having been fetched; the
 * install grows from about 4.6 MB to about 20 MB for it), and the precache
 * revisions them by content hash (vite.config.ts): a re-exported file
 * changes the worker, and every install fetches the new bytes with its
 * next update. Without a worker - the desktop app, or a browser that has
 * none - the plain name is fresh anyway: public/_headers gives these files
 * no long cache, so the browser revalidates them.
 */
