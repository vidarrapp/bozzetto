import { readyToLeave } from './leaving';
import { revealUpdateNotice, showUpdateNotice } from './updateNotice';
import { APP_VERSION } from './version';

/**
 * Updates to the installed app, and saying so.
 *
 * serviceWorker.ts registers the worker; this follows what happens once the
 * site has a newer build than the one running. Its worker installs in the
 * background - only the files that changed are fetched - and then WAITS
 * (vite.config: registerType 'prompt'). Taking over at once (skipWaiting +
 * clientsClaim) would swap the precache under a running page, and this app
 * loads sculpt mode and the library by dynamic import: the old page's next
 * import() asks for a chunk hash the new cache no longer holds and Pages no
 * longer serves, and the feature fails until a reload. So an update is
 * taken where a reload costs nothing, on the gallery, and anywhere else
 * only when asked: Reload stores the work first, as leaving for the gallery
 * does, then has the waiting worker take over and reloads the moment it
 * has. The page and the worker are one build again, and the old bundle
 * never runs against the new precache.
 *
 * All of this used to happen in silence, and an iPad could sit on an old
 * build for days with nothing to say so. Each step is said now, in a
 * notice in the corner (ui/updateNotice): Downloading update... with how
 * much has arrived, Update ready with Reload, Updating... on the way to
 * the reload, Update failed with Try again, and once, after the reload,
 * Updated to <version>.
 */

type Status = 'none' | 'downloading' | 'ready' | 'applying' | 'failed';

interface State {
  status: Status;
  /** Downloading: the share of the update's files that have arrived, or null when that cannot be measured. */
  progress: number | null;
  /** Failed: what is known about why, for the console and a hovering pointer. */
  reason?: string;
}

let state: State = { status: 'none', progress: null };
let registration: ServiceWorkerRegistration | null = null;
const listeners = new Set<() => void>();
/** The installing worker being followed, so a second sighting is not a second download. */
let following: ServiceWorker | null = null;
/** This page asked for the takeover, so the takeover reloads it. */
let reloading = false;
let reloadStarted = false;

/** Move on: the notice says where to, and the guide hears it. */
function set(next: State): void {
  state = next;
  paint();
  for (const fn of listeners) fn();
}

function paint(): void {
  switch (state.status) {
    case 'none':
      showUpdateNotice(null);
      break;
    case 'downloading':
      showUpdateNotice({ state: 'downloading', text: 'Downloading update…', progress: state.progress, dismissable: true });
      break;
    case 'ready':
      showUpdateNotice({
        state: 'ready',
        text: 'Update ready',
        action: { label: 'Reload', run: () => void reloadForUpdate() },
        dismissable: true,
      });
      break;
    case 'applying':
      showUpdateNotice({ state: 'applying', text: 'Updating…', progress: null });
      break;
    case 'failed':
      showUpdateNotice({
        state: 'failed',
        text: 'Update failed',
        action: { label: 'Try again', run: () => void tryAgain() },
        dismissable: true,
        detail: state.reason,
      });
      break;
  }
}

/** Whether this page can look for updates: a worker is registered, which it never is in the desktop app. */
export function updatesAvailable(): boolean {
  return registration !== null;
}

/** Where an update stands: none known, downloading, ready, applying or failed. */
export function updateStatus(): Status {
  return state.status;
}

/** Hear every change of state, and the registration arriving. Returns the undo. */
export function onUpdates(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Where a reload costs nothing: the gallery. Sculpt mode, Armature mode and
 * the viewer are left alone - a page mid-stroke, mid-pose or mid-playback
 * is not reloaded under anyone, and it keeps the worker it started with
 * (whose precache still holds every chunk it might yet import) until it is
 * closed or Reload is pressed. Armature mode lives at / too, and was taken
 * for the gallery.
 */
function reloadIsFree(): boolean {
  const params = new URLSearchParams(window.location.search);
  return (
    window.location.pathname === '/' &&
    !params.has('sculpt') &&
    !params.has('armature') &&
    !params.has('tl')
  );
}

/** Follow the registration's updates from now on (serviceWorker.ts, once it is registered). */
export function watchUpdates(reg: ServiceWorkerRegistration): void {
  registration = reg;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The new worker owns the page now; its bundle is not the one that is
    // running. No worker claimed this page on first install (no
    // clientsClaim), so this only ever fires for a real update.
    if (reloading || reloadIsFree()) {
      reloadNow();
      return;
    }
    // Taken over without this page asking: another tab took the update.
    // This page still runs the build before it, so it reloads too, when
    // the person on it says so.
    set({ status: 'ready', progress: null });
  });
  reg.addEventListener('updatefound', () => {
    if (reg.installing) follow(reg, reg.installing);
  });
  if (reg.installing) follow(reg, reg.installing);
  // One already waiting, from an earlier visit.
  else if (reg.waiting) arrived();
  for (const fn of listeners) fn();
}

/**
 * Follow a new worker from installing on. A first install is not an
 * update and says nothing: nothing ran before it, and the page it came
 * with is the site as it is now, straight from the network.
 */
function follow(reg: ServiceWorkerRegistration, worker: ServiceWorker): void {
  if (!reg.active || following === worker) return;
  following = worker;
  set({ status: 'downloading', progress: null });
  const meter = new DownloadMeter(reg, worker, (progress) => {
    if (following === worker && state.status === 'downloading') set({ status: 'downloading', progress });
  });
  let installed = false;
  const onState = (): void => {
    switch (worker.state) {
      case 'installed':
        installed = true;
        meter.stop();
        if (reg.waiting === worker) arrived();
        break;
      case 'activated':
        meter.stop();
        // Asked for here, it reloads the page. Otherwise another tab took
        // it, or no page was using the old worker at all (this one came
        // from the network): either way the build running here is the one
        // before, and it is ready for a reload.
        if (reloading) reloadNow();
        else arrived();
        break;
      case 'redundant': {
        meter.stop();
        worker.removeEventListener('statechange', onState);
        const current = following === worker;
        if (current) following = null;
        // Replaced by one newer still, which says the rest: this one did
        // not fail, it was overtaken.
        if (reg.installing && reg.installing !== worker) follow(reg, reg.installing);
        if (!current || following) return;
        if (!installed) void failed(worker, meter);
        else if (!reg.waiting && state.status !== 'none') set({ status: 'none', progress: null });
        break;
      }
      default:
        break;
    }
  };
  worker.addEventListener('statechange', onState);
  onState(); // it may have moved on before anyone was listening
}

/** A newer build is in: take it now where that costs nothing, or say it is ready. */
function arrived(): void {
  if (reloadIsFree()) apply();
  else set({ status: 'ready', progress: null });
}

/**
 * Have the waiting worker take over and reload onto it. The reload comes
 * from the takeover itself (controllerchange, or the worker reaching
 * activated where this page has no controller to change), so the page is
 * never left running one build against the other's precache.
 */
function apply(): void {
  reloading = true;
  set({ status: 'applying', progress: null });
  const waiting = registration?.waiting;
  if (!waiting) {
    // Already active: the reload is all that is left.
    reloadNow();
    return;
  }
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated') reloadNow();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function reloadNow(): void {
  if (reloadStarted) return;
  reloadStarted = true;
  window.location.reload();
}

/**
 * Reload, from the notice. The work is stored first, as it is for leaving
 * to sign in (ui/leaving: Sculpt's autosave, Armature's save), and when it
 * cannot be, the reload is asked about first.
 */
async function reloadForUpdate(): Promise<void> {
  if (state.status === 'applying') return;
  set({ status: 'applying', progress: null });
  if (!(await readyToLeave('updating reloads the page. Reload anyway?'))) {
    set({ status: 'ready', progress: null });
    return;
  }
  apply();
  // A takeover that never comes (the worker gone meanwhile): reload all
  // the same, since a reload is what was asked for.
  window.setTimeout(reloadNow, 10_000);
}

/** An install that ended without getting there: say so, and log where it stopped. */
async function failed(worker: ServiceWorker, meter: DownloadMeter): Promise<void> {
  let reason = 'the new version did not install';
  const stall = await meter.stalledAt().catch(() => null);
  if (stall) {
    // What the server answers for it now: a 404, or a redirect such as
    // Cloudflare Access's (one failed entry fails the whole install).
    const answer = await fetch(stall.url, { method: 'HEAD', cache: 'no-store', redirect: 'manual' }).then(
      (r) => (r.type === 'opaqueredirect' ? 'a redirect' : `${r.status}`),
      () => 'no answer',
    );
    reason = `the new version stopped installing at ${new URL(stall.url).pathname} (the server answers ${answer}), ${stall.got} of ${stall.total} files in`;
  }
  console.warn(`Update failed: ${reason} (${worker.scriptURL}).`);
  // Unless another attempt has started meanwhile, which says the rest.
  if (!following) set({ status: 'failed', progress: null, reason });
}

/** Try again, from the notice: ask the server for the new worker afresh. */
async function tryAgain(): Promise<void> {
  const reg = registration;
  if (!reg) return;
  set({ status: 'downloading', progress: null });
  try {
    await reg.update();
  } catch (err) {
    console.warn('Update check failed:', err);
    set({ status: 'failed', progress: null, reason: 'the server could not be reached' });
    return;
  }
  await settle();
  // Nothing newer than what is running: the failed build was withdrawn.
  if (!following && !reg.installing && !reg.waiting) {
    set({ status: 'none', progress: null });
    showUpdateNotice({ state: 'current', text: 'Up to date', hideAfterMs: 2400 });
  }
}

/** A moment for the events a finished update check queued (updatefound) to arrive. */
const settle = (): Promise<void> => new Promise((ok) => window.setTimeout(ok, 50));

export type CheckResult = 'current' | 'found' | 'ready' | 'unreachable';

/**
 * Check for updates, from the hotkey guide. A newer build found starts its
 * download, and the notice takes it from there.
 */
export async function checkForUpdates(): Promise<CheckResult> {
  const reg = registration;
  if (!reg) return 'unreachable';
  revealUpdateNotice();
  if (reg.waiting && state.status !== 'applying') {
    arrived();
    return 'ready';
  }
  if (reg.installing && reg.active) return 'found';
  try {
    await reg.update();
  } catch {
    return 'unreachable';
  }
  await settle();
  // An install with nothing active before it is the first, not an update.
  return reg.active && (reg.installing || reg.waiting) ? 'found' : 'current';
}

/** Where the last run's version is kept, to tell an update from a launch. */
const VERSION_KEY = 'bozzetto-version';

/**
 * Updated to <version>, once, on the first run of a new build. Anything
 * that changed the version counts - a Reload, the gallery's update, or a
 * relaunch that found a waiting worker activated meanwhile. A first visit
 * has nothing to compare with and says nothing; a page a worker serves
 * with no version kept had a visit before it, by a build from before the
 * version was kept, and this is the update from it.
 */
export function announceUpdate(): void {
  let last: string | null = null;
  try {
    last = localStorage.getItem(VERSION_KEY);
    localStorage.setItem(VERSION_KEY, APP_VERSION);
  } catch {
    return; // no storage, no telling a launch from an update
  }
  if (last === APP_VERSION || (last === null && !navigator.serviceWorker.controller)) return;
  // After the boot curtain lifts, or the few seconds the notice stays
  // would be spent under Sculpt's splash.
  const shown = Date.now();
  const tick = (): void => {
    const curtain = document.getElementById('overlay');
    if (curtain && !curtain.classList.contains('overlay--done') && Date.now() - shown < 30_000) {
      window.setTimeout(tick, 250);
      return;
    }
    // An update already on its way since says more than this one.
    if (state.status === 'none') showUpdateNotice({ state: 'updated', text: `Updated to ${APP_VERSION}`, hideAfterMs: 6000 });
  };
  tick();
}

/**
 * How much of a new build has arrived, by counting. The worker's script
 * lists its precache - the build writes every {url, revision} entry into
 * sw.js - and Workbox installs by fetching those entries one at a time, in
 * that order, into its precache cache, keyed by the URL (with the revision
 * as a parameter, where there is one) and skipping the ones it already
 * holds. So the entries present, counted from when the download was first
 * seen, are the share of this update's files that have arrived: only the
 * changed ones download, and those are the ones missing at the start.
 *
 * Read from the page, so the worker stays exactly as the build makes it.
 * When the script cannot be read or its list cannot be found, the bar has
 * no measure and says only that something is under way; the install goes
 * on regardless.
 */
class DownloadMeter {
  private readonly entries: Promise<PrecacheEntry[] | null>;
  private readonly cacheName: string;
  private baseline: number | null = null;
  private timer = 0;
  private stopped = false;

  constructor(
    reg: ServiceWorkerRegistration,
    worker: ServiceWorker,
    private readonly report: (progress: number) => void,
  ) {
    // Workbox's own name for it: its prefix, the precache, and the scope.
    this.cacheName = `workbox-precache-v2-${reg.scope}`;
    this.entries = precacheEntries(worker.scriptURL).catch(() => null);
    void this.tick();
  }

  private async tick(): Promise<void> {
    const entries = await this.entries;
    if (!entries || this.stopped) return;
    const have = await this.cached().catch(() => null);
    if (have && !this.stopped) {
      const got = entries.filter((e) => have.has(e.key)).length;
      this.baseline ??= got;
      const todo = entries.length - this.baseline;
      this.report(todo > 0 ? (got - this.baseline) / todo : 1);
    }
    if (!this.stopped) this.timer = window.setTimeout(() => void this.tick(), 300);
  }

  private async cached(): Promise<Set<string>> {
    if (!(await caches.has(this.cacheName))) return new Set();
    const cache = await caches.open(this.cacheName);
    return new Set((await cache.keys()).map((r) => r.url));
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }

  /**
   * Where an install that failed stopped: the first entry, in the order
   * Workbox fetches them, that never reached the cache.
   */
  async stalledAt(): Promise<{ url: string; got: number; total: number } | null> {
    const entries = await this.entries;
    if (!entries) return null;
    const have = await this.cached();
    const missing = entries.find((e) => !have.has(e.key));
    if (!missing) return null;
    return { url: missing.url, got: entries.filter((e) => have.has(e.key)).length, total: entries.length };
  }
}

interface PrecacheEntry {
  /** What the worker fetches. */
  url: string;
  /** What it stores the answer under. */
  key: string;
}

/** The precache list in a worker's script, as Workbox keys it; null when it cannot be found. */
async function precacheEntries(scriptURL: string): Promise<PrecacheEntry[] | null> {
  const res = await fetch(scriptURL, { cache: 'no-store' });
  if (!res.ok) return null;
  const text = await res.text();
  const out: PrecacheEntry[] = [];
  // {url:"assets/main-Ab12.js",revision:null}, minified or not.
  const entry = /\{\s*"?url"?\s*:\s*"([^"]+)"\s*,\s*"?revision"?\s*:\s*(?:"([^"]*)"|null)\s*\}/g;
  for (const m of text.matchAll(entry)) {
    const url = new URL(m[1], scriptURL);
    const key = new URL(url.href);
    if (m[2]) key.searchParams.set('__WB_REVISION__', m[2]);
    out.push({ url: url.href, key: key.href });
  }
  return out.length ? out : null;
}
