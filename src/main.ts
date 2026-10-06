import { validateManifest } from './types/manifest';
import type { Manifest } from './types/manifest';
import { HttpSource } from './viewer/AssetSource';
import { mountViewer } from './viewer/mountViewer';
import { renderLanding } from './ui/Landing';
import { initTheme, mountThemeToggle } from './ui/theme';
import { installSliderBubble } from './ui/sliderBubble';
import { installTouchGuards } from './ui/touchGuards';
import { topChip, topbarLeft } from './ui/topbar';
import { apiFetch, apiManifestUrl } from './net/origin';
import { isProjectId } from './net/ids';
import { registerServiceWorker } from './ui/serviceWorker';
import { followPanelOpacity } from './ui/appearance';

/**
 * App entry. `?tl=<id>` opens the viewer for that project; with no id we show
 * the landing gallery. Projects load from the API (`/api/projects/:id`); the
 * bundled static demo still works via a fallback so it never depends on the db.
 */
async function main(): Promise<void> {
  initTheme();
  followPanelOpacity();
  mountThemeToggle();
  installSliderBubble();
  installTouchGuards();
  registerServiceWorker();
  const app = document.getElementById('app');
  if (!app) throw new Error('#app element not found');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('tl');
  if (!id && params.get('sculpt') === '1') {
    await bootSculpt();
    return;
  }
  if (!id && params.get('armature') === '1') {
    await bootArmature();
    return;
  }
  if (!id) {
    await renderLanding(app);
    return;
  }
  // The id goes into request paths: `?tl=../media/x/f.json%23` reached the
  // bundled-demo fallback as a path to any JSON on the site. Not an id
  // (net/ids), not a project.
  if (!isProjectId(id)) {
    showError(document.getElementById('overlay'), new Error('That is not a project link'));
    return;
  }
  await bootViewer(id);
}

/**
 * The bundled demo timelapse ships in the dev server and the test build
 * only (vite.config.ts drops it everywhere else), so only those look for
 * it: elsewhere the fallback could never find a project, only answer for
 * whatever JSON a path happened to reach.
 */
const BUNDLED_DEMO = import.meta.env.DEV || import.meta.env.MODE === 'test';

/**
 * Project-less sculpt entry (/?sculpt=1): boot the viewer on a synthetic
 * one-frame manifest (no API, no timelapse, no transport bar) and mount
 * sculpt mode over it.
 */
async function bootSculpt(): Promise<void> {
  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');
  const setStatus = (msg: string): void => {
    const box = overlay?.querySelector<HTMLElement>('.overlay__msg');
    if (box) box.textContent = msg;
  };

  // The logo animation plays over the boot, so the wait is the branding;
  // it can only ever ADD time (2.5s, tap to skip), never wedge the boot.
  const { mountSculptSplash } = await import('./ui/SculptSplash');
  const splash = mountSculptSplash(overlay);
  try {
    setStatus('Entering sculpt mode…');
    const { sculptStandaloneProject } = await import('./sculpt/standalone');
    const { manifest, source } = sculptStandaloneProject();
    const viewer = await mountViewer(viewport, manifest, source, setStatus);
    addGalleryLink();
    const { mountSculptMode } = await import('./sculpt/mode');
    await mountSculptMode(viewer);
    // Only now: the synthetic manifest's frame is a placeholder cube, and
    // dropping the overlay before sculpt mode swapped in the live subject
    // showed it as an ugly splash (owner report) - for however long the
    // module import, the autosave read and the subdivision build take. It
    // also left showError printing into a removed overlay if the mount
    // threw. The first visible frame is the real scene - after the logo
    // has finished writing itself, faded rather than yanked.
    await splash.finished;
    if (overlay) {
      overlay.classList.add('overlay--done');
      window.setTimeout(() => overlay.remove(), 450);
    }
  } catch (err) {
    console.error(err);
    splash.dispose(); // the error text needs the plain overlay back
    showError(overlay, err);
  }
}

async function bootViewer(id: string): Promise<void> {
  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');

  const base = import.meta.env.BASE_URL; // "/" in production
  const setStatus = (msg: string): void => {
    const box = overlay?.querySelector<HTMLElement>('.overlay__msg');
    if (box) box.textContent = msg;
  };

  try {
    const { manifest, manifestUrl } = await loadProject(id, base);
    setStatus(manifest.mode === 'model' ? 'Loading model…' : 'Loading timelapse…');
    const viewer = await mountViewer(viewport, manifest, new HttpSource(manifestUrl), setStatus);
    overlay?.remove();
    addGalleryLink();
    // WS0 spike entry (dev-only): ?sculpt=1 mounts sculpt mode on the default
    // sphere over this project's stage/lighting. The real entry point ships
    // with WS5 (see docs/sculpt-mode-implementation.md).
    if (new URLSearchParams(window.location.search).get('sculpt') === '1') {
      const { mountSculptMode } = await import('./sculpt/mode');
      await mountSculptMode(viewer);
    }
  } catch (err) {
    console.error(err);
    showError(overlay, err);
  }
}

/**
 * Load a project's manifest. Tries the API first, and falls back to a bundled
 * static timelapse (e.g. `?tl=demo`) when there is no API answering. Frame
 * paths resolve against `manifestUrl`, so API manifests (absolute
 * `/media/...`) and static ones (relative) both work.
 *
 * "No API answering" is not only a 404. A host that serves the app with an
 * SPA fallback answers an unknown /api/ path with 200 and index.html, and
 * parsing that as JSON fails with "Unexpected token '<'" - which is both
 * useless to read and, worse, thrown before the static fallback is ever
 * reached. An HTML answer means no API, so it falls through like a 404
 * does. A JSON answer that will not parse is a real fault and still throws.
 */
async function loadProject(
  id: string,
  base: string,
): Promise<{ manifest: Manifest; manifestUrl: string }> {
  const apiPath = `/api/projects/${encodeURIComponent(id)}`;
  const res = await apiFetch(apiPath);
  const servedHtml = res.contentType.includes('text/html');
  if (res.ok && !servedHtml && res.bytes) {
    const manifest = viewerManifest(JSON.parse(new TextDecoder().decode(res.bytes)));
    // Frame paths in an API manifest are root-absolute (/media/...), so they
    // must resolve against the SERVER, not the app. apiBaseUrl is that
    // origin on the desktop and the site's own on the web.
    return { manifest, manifestUrl: await apiManifestUrl(apiPath) };
  }
  // status 0 is "no server configured" on the desktop - the same as a 404
  // here: nothing is answering, so try the bundled copy.
  if (!res.ok && res.status !== 404 && res.status !== 0) {
    throw new Error(`Failed to load project (${res.status})`);
  }
  // A private project is a 404 publicly. Its owner, signed in, reads it
  // through the Access-gated route, whose manifest points the frames at
  // the gated media route as well.
  const owned = await ownerManifest(id);
  if (owned) return owned;

  if (!BUNDLED_DEMO) throw new Error(`Project "${id}" not found`);
  const staticUrl = new URL(`${base}timelapses/${encodeURIComponent(id)}/manifest.json`, window.location.href).href;
  const sres = await fetch(staticUrl);
  if (!sres.ok) throw new Error(`Project "${id}" not found`);
  return { manifest: validateManifest(await sres.json()), manifestUrl: staticUrl };
}

/**
 * The owner's manifest for a project the public API does not show, or null.
 * For anyone else Access answers with its login page (a redirect, which
 * apiFetch reports as signed out rather than following, or HTML), all of
 * which read as "not here" so the bundled fallback still gets its turn.
 */
async function ownerManifest(id: string): Promise<{ manifest: Manifest; manifestUrl: string } | null> {
  const path = `/admin/api/projects/${encodeURIComponent(id)}`;
  try {
    const res = await apiFetch(path);
    if (!res.ok || !res.bytes || !res.contentType.includes('application/json')) return null;
    const manifest = viewerManifest(JSON.parse(new TextDecoder().decode(res.bytes)));
    return { manifest, manifestUrl: await apiManifestUrl(path) };
  } catch (err) {
    if (err instanceof SceneProjectError) throw err;
    return null;
  }
}

class SceneProjectError extends Error {}

/**
 * A manifest the viewer can play. A scene project has a file and no frames:
 * it opens in Sculpt, and saying so beats "frames must be a non-empty array".
 */
function viewerManifest(raw: unknown): Manifest {
  const r = raw as { mode?: string; title?: string };
  if (r?.mode === 'scene') {
    throw new SceneProjectError(`"${r.title ?? 'This'}" is a scene saved from Sculpt: open it from the gallery`);
  }
  return validateManifest(raw);
}

/**
 * Armature entry (/?armature=1): the same viewer boot as sculpt, with the
 * armature mode mounted over it instead.
 */
async function bootArmature(): Promise<void> {
  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');
  const setStatus = (msg: string): void => {
    const box = overlay?.querySelector<HTMLElement>('.overlay__msg');
    if (box) box.textContent = msg;
  };
  const { mountSculptSplash } = await import('./ui/SculptSplash');
  const splash = mountSculptSplash(overlay);
  try {
    setStatus('Entering armature mode…');
    const { sculptStandaloneProject } = await import('./sculpt/standalone');
    const { manifest, source } = sculptStandaloneProject();
    const viewer = await mountViewer(viewport, manifest, source, setStatus);
    addGalleryLink();
    const { mountArmatureMode } = await import('./armature/mode');
    await mountArmatureMode(viewer);
    await splash.finished;
    if (overlay) {
      overlay.classList.add('overlay--done');
      window.setTimeout(() => overlay.remove(), 450);
    }
  } catch (err) {
    console.error(err);
    splash.dispose();
    showError(overlay, err);
  }
}

function addGalleryLink(): void {
  // The gallery is the site's root, whatever the address says: a path such
  // as `//elsewhere.example/` reaches this page through the host's own
  // fallback for unknown paths (the worker's answered it too, before it
  // took a list), and used as a link it is another site.
  const a = topChip('← Gallery', '/');
  a.classList.add('viewer-back');
  topbarLeft().appendChild(a);
}

function showError(overlay: HTMLElement | null, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (overlay) {
    overlay.classList.add('overlay--error');
    overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'overlay__msg';
    box.textContent = `Could not load project: ${message}`;
    overlay.appendChild(box);
  }
}

void main();
