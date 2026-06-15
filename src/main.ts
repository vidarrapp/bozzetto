import { validateManifest } from './types/manifest';
import { Viewer } from './viewer/Viewer';
import { Panel } from './ui/Panel';

/**
 * App entry (design doc §4). Reads `?tl=<id>`, loads the manifest, boots the
 * Viewer, and builds the control panel. Fully static — no backend.
 */
async function main(): Promise<void> {
  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');

  const params = new URLSearchParams(window.location.search);
  const id = params.get('tl') ?? 'demo';

  const base = import.meta.env.BASE_URL; // e.g. "./" or "/"
  const manifestUrl = new URL(
    `${base}timelapses/${id}/manifest.json`,
    window.location.href,
  ).href;
  const matcapUrl = new URL(`${base}assets/matcaps/clay.png`, window.location.href)
    .href;

  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      throw new Error(`Failed to load manifest (${res.status}) at ${manifestUrl}`);
    }
    const manifest = validateManifest(await res.json());

    const viewer = new Viewer(viewport, manifest, manifestUrl, matcapUrl);
    // Expose for debugging from the browser console, e.g.:
    //   __bozzetto.timeline.fps, __bozzetto.timeline.frameIndex()
    (window as unknown as { __bozzetto?: Viewer }).__bozzetto = viewer;
    new Panel(viewer);
    await viewer.boot();

    overlay?.remove();
  } catch (err) {
    console.error(err);
    showError(overlay, err);
  }
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
