/**
 * Service worker registration.
 *
 * The worker precaches the app shell so an installed Bozzetto opens with no
 * network at all - which is the point of installing it on an iPad. Assets
 * too big or too rarely wanted to precache (the HDRIs) are cached the first
 * time they are used, and the gallery's project list is stale-while-
 * revalidate so its cards still draw offline.
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
 *             rescues nothing.
 *   ?sw       undo that and register again.
 *
 * That turns a bricked install into a URL the owner can send someone,
 * instead of "delete the app and reinstall it".
 */

const SW_URL = '/sw.js';
const OPT_OUT = 'bozzetto-no-sw';

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
  const params = new URLSearchParams(window.location.search);

  if (params.has('nosw')) {
    setOptOut(true);
    void unregisterAll().then(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('nosw');
      window.location.replace(url.href);
    });
    return;
  }

  if (params.has('sw')) setOptOut(false);
  if (optedOut()) return;

  // After load: registration competes with the first frames for bandwidth
  // and main-thread time, and the app is more useful than its cache.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL).catch((err) => {
      // Never fatal. Without a worker the app is exactly what it was
      // before: online-only.
      console.warn('service worker registration failed:', err);
    });
  });
}
