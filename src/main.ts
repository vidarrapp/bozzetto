import { validateManifest } from './types/manifest';
import type { Manifest } from './types/manifest';
import { Viewer } from './viewer/Viewer';
import { Panel } from './ui/Panel';
import { Transport } from './ui/Transport';
import { installShortcuts } from './ui/shortcuts';
import { renderLanding } from './ui/Landing';
import { getTheme, initTheme, THEME_BG } from './ui/theme';

/**
 * App entry. `?tl=<id>` opens the viewer for that project; with no id we show
 * the landing gallery. Projects load from the API (`/api/projects/:id`); the
 * bundled static demo still works via a fallback so it never depends on the db.
 */
async function main(): Promise<void> {
  initTheme();
  const app = document.getElementById('app');
  if (!app) throw new Error('#app element not found');

  const id = new URLSearchParams(window.location.search).get('tl');
  if (!id) {
    await renderLanding(app);
    return;
  }
  await bootViewer(id);
}

async function bootViewer(id: string): Promise<void> {
  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');

  const base = import.meta.env.BASE_URL; // "/" in production

  try {
    const { manifest, manifestUrl } = await loadProject(id, base);

    const viewer = new Viewer(viewport, manifest, manifestUrl);
    viewer.setBackground(THEME_BG[getTheme()]);
    // Expose for debugging from the browser console, e.g.:
    //   __bozzetto.timeline.fps, __bozzetto.timeline.frameIndex()
    (window as unknown as { __bozzetto?: Viewer }).__bozzetto = viewer;
    await viewer.boot();

    // Build the UI after boot so controls reflect the applied look.
    new Panel(viewer);
    new Transport(viewer);
    installShortcuts(viewer);

    overlay?.remove();
    addGalleryLink();
  } catch (err) {
    console.error(err);
    showError(overlay, err);
  }
}

/**
 * Load a project's manifest. Tries the API first; a 404 falls back to a bundled
 * static timelapse (e.g. `?tl=demo`). Frame paths resolve against `manifestUrl`,
 * so API manifests (absolute `/media/...`) and static ones (relative) both work.
 */
async function loadProject(
  id: string,
  base: string,
): Promise<{ manifest: Manifest; manifestUrl: string }> {
  const apiUrl = new URL(`/api/projects/${encodeURIComponent(id)}`, window.location.href).href;
  const res = await fetch(apiUrl);
  if (res.ok) {
    return { manifest: validateManifest(await res.json()), manifestUrl: apiUrl };
  }
  if (res.status !== 404) {
    throw new Error(`Failed to load project (${res.status}) at ${apiUrl}`);
  }

  const staticUrl = new URL(`${base}timelapses/${id}/manifest.json`, window.location.href).href;
  const sres = await fetch(staticUrl);
  if (!sres.ok) throw new Error(`Project "${id}" not found`);
  return { manifest: validateManifest(await sres.json()), manifestUrl: staticUrl };
}

function addGalleryLink(): void {
  const a = document.createElement('a');
  a.className = 'viewer-back';
  a.href = window.location.pathname; // back to the gallery (no ?tl)
  a.textContent = '← Gallery';
  document.getElementById('app')?.appendChild(a);
}

function showError(overlay: HTMLElement | null, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (overlay) {
    overlay.classList.add('overlay--error');
    overlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'overlay__msg';
    box.textContent = `Could not load timelapse: ${message}`;
    overlay.appendChild(box);
  }
}

void main();
