/**
 * Service worker registration.
 *
 * The worker precaches the app shell, the base-mesh library, the mannequins
 * and the default environment, so an installed Bozzetto opens, sculpts and
 * poses with no network at all - which is the point of installing it on an
 * iPad. The other HDRIs, too big to precache for how rarely each is wanted,
 * are cached the first time they are used, and the gallery's project list
 * is stale-while-revalidate so its cards still draw offline.
 *
 * Registration is deliberately late and deliberately escapable. A service
 * worker is the one piece of a web app that can outlive a bad deploy: a
 * broken one keeps serving its broken precache to everyone who already has
 * it, and the usual fix (ship a new one) only reaches people whose browser
 * checks for an update. So:
 *
 *   ?nosw     unregister, drop the caches, and STAY off until told
 *             otherwise. The opt-out has to outlive the reload: without
 *             it, unregistering and reloading just runs this function
 *             again and registers a fresh worker, which is a rescue that
 *             rescues nothing. It asks first: any page can link here
 *             with it, and the app would stop working offline on the
 *             strength of a click somewhere else.
 *   ?sw       undo that and register again.
 *
 * That turns a bricked install into a URL the owner can send someone,
 * instead of "delete the app and reinstall it".
 *
 * Updates - a newer build found, downloaded, taken and said on screen - are
 * ui/updates' business once the worker is registered.
 */
import { announceUpdate, watchUpdates } from './updates';

const SW_URL = '/sw.js';
const OPT_OUT = 'bozzetto-no-sw';
/**
 * Runtime caches no route writes to any more. Only a route's own expiry
 * ever empties one, so they would sit in storage for good: the base meshes
 * and mannequins were kept in these until they moved into the precache
 * (0.5.0), and an install that had used them would hold them twice.
 */
const RETIRED_CACHES = ['bozzetto-basemeshes', 'bozzetto-figures'];

/** localStorage throws in some privacy modes; an unreadable flag is "off". */
function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT) === '1';
  } catch {
    return false;
  }
}

function setOptOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPT_OUT, '1');
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // Nothing to do: the query parameter still governs this page load.
  }
}

/** Tear the worker out and drop its caches. The ?nosw escape hatch. */
async function unregisterAll(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('bozzetto') || n.startsWith('workbox')).map((n) => caches.delete(n)));
  }
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // The desktop shell serves the app off a custom protocol, which cannot
  // host a worker - and does not need one, since it already ships its
  // bytes on disk. Attempting it only logs a failure at every launch.
  if ((window as { bozzettoDesktop?: unknown }).bozzettoDesktop) return;
  const params = new URLSearchParams(window.location.search);
  // Nor in the desktop app's sign-in window (/?signin=desktop,
  // docs/accounts.md §2): a page of the site in a session of the app's,
  // there to sign in and close, with nothing to keep for offline use.
  if (params.get('signin') === 'desktop') return;
  // Nor on the files host: it serves templates' files and sends every
  // other path to the gallery, and a worker registered there (by someone
  // opening the host's root before the redirect existed) would answer the
  // root with the app shell from its cache, in front of the redirect. One
  // found there is removed.
  if (__BOZZETTO_MEDIA_ORIGIN__ && window.location.origin === __BOZZETTO_MEDIA_ORIGIN__) {
    void unregisterAll();
    return;
  }

  if (params.has('nosw')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('nosw');
    if (
      window.confirm(
        'Switch off offline use on this device? The copy of the app kept for working offline is removed, ' +
          'and it stays off until a link with ?sw turns it back on.',
      )
    ) {
      setOptOut(true);
      void unregisterAll().then(() => window.location.replace(url.href));
      return;
    }
    // Declined: nothing changes, and the switch leaves the address so a
    // reload does not ask again.
    history.replaceState(history.state, '', url);
  }

  if (params.has('sw')) setOptOut(false);
  if (optedOut()) return;

  // "Updated to <version>", when this is the first run of a new build.
  announceUpdate();

  // After load: registration competes with the first frames for bandwidth
  // and main-thread time, and the app is more useful than its cache.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then(watchUpdates)
      .catch((err) => {
        // Never fatal. Without a worker the app is exactly what it was
        // before: online-only.
        console.warn('service worker registration failed:', err);
      });
    // The worker serving this bundle has no route for them; a tab still on
    // the worker before it only misses and fetches afresh.
    if ('caches' in window) {
      for (const name of RETIRED_CACHES) void caches.delete(name).catch(() => {});
    }
  });
}
