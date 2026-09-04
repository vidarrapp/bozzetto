import { validateManifest } from './types/manifest';
import type { Manifest } from './types/manifest';
import { HttpSource } from './viewer/AssetSource';
import { mountViewer } from './viewer/mountViewer';
import { renderLanding } from './ui/Landing';
import { initTheme, mountThemeToggle } from './ui/theme';
import { topChip, topbarLeft } from './ui/topbar';

/**
 * App entry. `?tl=<id>` opens the viewer for that project; with no id we show
 * the landing gallery. Projects load from the API (`/api/projects/:id`); the
 * bundled static demo still works via a fallback so it never depends on the db.
 */
async function main(): Promise<void> {
  initTheme();
  mountThemeToggle();
  const app = document.getElementById('app');
  if (!app) throw new Error('#app element not found');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('tl');
  if (!id && params.get('sculpt') === '1') {
    await bootSculpt();
    return;
  }
  if (!id) {
    await renderLanding(app);
    return;
  }
  await bootViewer(id);
}

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
  const apiUrl = new URL(`/api/projects/${encodeURIComponent(id)}`, window.location.href).href;
  const res = await fetch(apiUrl);
  const servedHtml = (res.headers.get('content-type') ?? '').includes('text/html');
  if (res.ok && !servedHtml) {
    return { manifest: validateManifest(await res.json()), manifestUrl: apiUrl };
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to load project (${res.status}) at ${apiUrl}`);
  }

  const staticUrl = new URL(`${base}timelapses/${id}/manifest.json`, window.location.href).href;
  const sres = await fetch(staticUrl);
  if (!sres.ok) throw new Error(`Project "${id}" not found`);
  return { manifest: validateManifest(await sres.json()), manifestUrl: staticUrl };
}

function addGalleryLink(): void {
  const a = topChip('← Gallery', window.location.pathname);
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
