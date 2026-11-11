import { Viewer, type ToneMappingId } from './Viewer';
import type { AssetSource } from './AssetSource';
import type { Manifest } from '../types/manifest';
import { Panel } from '../ui/Panel';
import { Transport } from '../ui/Transport';
import { installShortcuts } from '../ui/shortcuts';
import { Help } from '../ui/Help';
import { FpsMeter } from '../ui/FpsMeter';
import { mountStallLog } from '../ui/diagnostics';
import { pageChrome } from '../ui/ChromeToggle';

/** What mountViewerParts leaves its caller holding, besides the viewer. */
export interface ViewerParts {
  viewer: Viewer;
  panel: Panel;
  /** The bottom bar; absent for a model, or a timelapse of one frame. */
  transport: Transport | null;
  help: Help;
}

export interface MountOptions {
  author?: string;
  /**
   * The owner's Present page (present/): the Render panel with the whole
   * look, and the transport as the shell's bar. Both are this page's own
   * parts in another dress, not copies.
   */
  shell?: boolean;
  /** The viewer needs the preserved drawing buffer (Save image reads the canvas). */
  preserveDrawingBuffer?: boolean;
}

/**
 * Boot a Viewer into `viewport` and wire up the full public UI (panel,
 * transport, help, frame meter, stall log, shortcuts, Tab's hide-the-
 * interface toggle), as the live entry (main.ts) presents it.
 */
export async function mountViewer(
  viewport: HTMLElement,
  manifest: Manifest,
  source: AssetSource,
  onStatus?: (msg: string) => void,
  opts: { author?: string } = {},
): Promise<Viewer> {
  return (await mountViewerParts(viewport, manifest, source, onStatus, opts)).viewer;
}

/** mountViewer, handing back the parts it built, for a page that dresses them itself. */
export async function mountViewerParts(
  viewport: HTMLElement,
  manifest: Manifest,
  source: AssetSource,
  onStatus?: (msg: string) => void,
  opts: MountOptions = {},
): Promise<ViewerParts> {
  const viewer = await Viewer.create(viewport, manifest, source, opts.preserveDrawingBuffer ? { preserveDrawingBuffer: true } : undefined);
  // Expose for debugging from the browser console, e.g.:
  //   __bozzetto.timeline.fps, __bozzetto.timeline.frameIndex()
  (window as unknown as { __bozzetto?: Viewer }).__bozzetto = viewer;
  viewer.onStatus = onStatus ?? null; // boot reports loading phases (env) through this
  await viewer.boot();
  // The grade a presented look was published under (Sculpt's Present
  // mode); setToneMapping ignores anything that is not one.
  const grade = manifest.defaults.toneMapping;
  if (grade) viewer.setToneMapping(grade as ToneMappingId);

  // Build the UI after boot so controls reflect the applied look.
  const help = new Help();
  // A member's work from the Community names its author under the title.
  const panel = new Panel(viewer, { onHotkeys: () => help.toggle(), author: opts.author, fullLook: opts.shell });
  viewer.onDofChange = () => panel.refreshControls(); // sync the DoF checkbox (hotkey / tap-to-focus)
  // The transport (scrubber + stage markers) only makes sense for a sequence;
  // a single-model project has nothing to scrub, so it gets no timeline.
  const transport =
    manifest.mode === 'timelapse' && manifest.config.frameCount > 1 ? new Transport(viewer, { shell: opts.shell }) : null;
  const fps = new FpsMeter(viewer);
  // The stall log lives here, not in one mode, so it reads the same over
  // the viewer, Sculpt and Armature (Preferences > Diagnostics, ?perfdebug=1).
  mountStallLog();
  // Tab hides the interface in stages, as in Sculpt (owner decision): the
  // page's one toggle, which Sculpt and Armature use too when they mount.
  const chrome = pageChrome();
  installShortcuts(viewer, {
    toggleChrome: () => chrome.handleTab(),
    toggleHelp: () => help.toggle(),
    toggleFps: () => fps.toggle(),
    refresh: () => panel.refreshControls(),
  });

  return { viewer, panel, transport, help };
}
