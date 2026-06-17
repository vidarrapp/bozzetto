import { Viewer } from './Viewer';
import type { AssetSource } from './AssetSource';
import type { Manifest } from '../types/manifest';
import { Panel } from '../ui/Panel';
import { Transport } from '../ui/Transport';
import { installShortcuts } from '../ui/shortcuts';
import { Help } from '../ui/Help';
import { FpsMeter } from '../ui/FpsMeter';

/**
 * Boot a Viewer into `viewport` and wire up the full public UI (panel,
 * transport, help, FPS meter, shortcuts). Shared by the live entry (main.ts)
 * and the embedded single-file entry so both present an identical viewer.
 */
export async function mountViewer(
  viewport: HTMLElement,
  manifest: Manifest,
  source: AssetSource,
): Promise<Viewer> {
  const viewer = new Viewer(viewport, manifest, source);
  // Expose for debugging from the browser console, e.g.:
  //   __bozzetto.timeline.fps, __bozzetto.timeline.frameIndex()
  (window as unknown as { __bozzetto?: Viewer }).__bozzetto = viewer;
  await viewer.boot();

  // Build the UI after boot so controls reflect the applied look.
  const panel = new Panel(viewer);
  new Transport(viewer);
  const help = new Help();
  const fps = new FpsMeter(viewer);
  installShortcuts(viewer, {
    togglePanel: () => panel.toggleCollapsed(),
    toggleHelp: () => help.toggle(),
    toggleFps: () => fps.toggle(),
    refresh: () => panel.refreshControls(),
  });

  return viewer;
}
