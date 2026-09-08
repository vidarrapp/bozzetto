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
  // The desktop shell serves the app off a custom protocol, which cannot
  // host a worker - and does not need one, since it already ships its
  // bytes on disk. Attempting it only logs a failure at every launch.
  if ((window as { bozzettoDesktop?: unknown }).bozzettoDesktop) return;
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
    navigator.serviceWorker
      .register(SW_URL)
      .then(adoptUpdates)
      .catch((err) => {
        // Never fatal. Without a worker the app is exactly what it was
        // before: online-only.
        console.warn('service worker registration failed:', err);
      });
  });
}

/**
 * Where a reload costs nothing: the gallery. Sculpt mode and the viewer
 * are left alone - a page mid-stroke or mid-playback is not reloaded
 * under anyone, and it keeps the worker it started with (whose precache
 * still holds every chunk it might yet import) until it is closed.
 */
function reloadIsFree(): boolean {
  const params = new URLSearchParams(window.location.search);
  return window.location.pathname === '/' && !params.has('sculpt') && !params.has('tl');
}

/**
 * A new worker installs and WAITS (vite.config: registerType 'prompt');
 * nothing on this page promotes it while the page might still import a
 * chunk only the old precache has. On the gallery, though, the update is
 * taken at once: the waiting worker is told to activate, and the page
 * reloads onto it the moment it takes over. Anywhere else the worker
 * waits for the next launch - or for the walk back to the gallery.
 */
function adoptUpdates(reg: ServiceWorkerRegistration): void {
  const promote = (): void => {
    if (reg.waiting && reloadIsFree()) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The new worker owns the page now; its bundle is not the one that is
    // running. No worker claimed this page on first install (no
    // clientsClaim), so this only ever fires for a real update.
    if (reloadIsFree()) window.location.reload();
  });
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) promote();
    });
  });
  promote(); // one was already waiting from an earlier visit
}
