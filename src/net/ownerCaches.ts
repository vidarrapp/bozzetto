/**
 * The service worker's copies of the owner's private answers: the sign-in
 * probe, the owner's project list and manifests (private projects and
 * scenes included), and - kept by mistake under the thumbnail rule until it
 * was anchored to the public route - the gated media route's thumbnails.
 * The names are the cacheName of each rule in vite.config.ts.
 *
 * Kept so an installed app still shows its owner their work offline; the
 * worker's own expiry is thirty days. A sign-in that has gone - signed out,
 * expired, or refused - drops them at once, so a device the owner has
 * left does not go on showing their private list to whoever picks it up.
 */
const OWNER_CACHES = ['bozzetto-whoami', 'bozzetto-owner-projects'];
/** Where the public thumbnails are kept, which held some private ones too. */
const THUMB_CACHE = 'bozzetto-thumbs';

/** Delete the owner's cached answers. Never throws: storage refusing is nothing left to delete. */
export async function forgetOwnerCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await Promise.all(OWNER_CACHES.map((name) => caches.delete(name)));
    if (!(await caches.has(THUMB_CACHE))) return;
    const thumbs = await caches.open(THUMB_CACHE);
    const gated = (await thumbs.keys()).filter((req) => new URL(req.url).pathname.startsWith('/admin/'));
    await Promise.all(gated.map((req) => thumbs.delete(req)));
  } catch {
    // Storage blocked (a private window): nothing was kept to delete.
  }
}
