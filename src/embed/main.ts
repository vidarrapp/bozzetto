import { EmbeddedSource, type EmbeddedRegistry } from '../viewer/AssetSource';
import { mountViewer } from '../viewer/mountViewer';
import { initTheme, mountThemeToggle } from '../ui/theme';
import '../style.css';

/**
 * Entry for the self-contained single-file export. Built as a classic IIFE
 * (not an ES module) so it runs from a file:// page, and reads everything —
 * manifest, frames, HDRI, matcaps — from the inlined `window.__BOZZETTO__`
 * registry. No network access of any kind.
 */
async function main(): Promise<void> {
  initTheme();
  mountThemeToggle();

  const viewport = document.getElementById('viewport');
  const overlay = document.getElementById('overlay');
  if (!viewport) throw new Error('#viewport element not found');

  const registry = (window as unknown as { __BOZZETTO__?: EmbeddedRegistry }).__BOZZETTO__;
  if (!registry) throw new Error('No embedded data (window.__BOZZETTO__ missing)');

  const setStatus = (msg: string): void => {
    const box = overlay?.querySelector<HTMLElement>('.overlay__msg');
    if (box) box.textContent = msg;
  };

  try {
    const source = new EmbeddedSource(registry);
    const manifest = await source.getManifest();
    setStatus(manifest.mode === 'model' ? 'Loading model…' : 'Loading timelapse…');
    await mountViewer(viewport, manifest, source, setStatus);
    overlay?.remove();
  } catch (err) {
    console.error(err);
    if (overlay) {
      overlay.classList.add('overlay--error');
      overlay.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'overlay__msg';
      box.textContent = `Could not load project: ${err instanceof Error ? err.message : String(err)}`;
      overlay.appendChild(box);
    }
  }
}

void main();
