import '../sculpt/ui/shell.css';
import type { Manifest } from '../types/manifest';
import type { AssetSource } from './AssetSource';
import type { Viewer } from './Viewer';
import { mountViewerParts } from './mountViewer';
import { pageChrome } from '../ui/ChromeToggle';
import { toggleHotkeyGuide } from '../help/menu';
import { authorHref } from '../net/community';
import { TitleStrip, stripButton, stripLink } from '../sculpt/ui/TitleStrip';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { keyFor, viewMenuItems } from '../sculpt/ui/viewMenu';
import { layoutShell } from '../sculpt/ui/shellLayout';

/**
 * The public viewer (`/?tl=<id>`) in the app's frame (docs/ui-spec.md): the
 * quiet version of the shell Sculpt, Armature and Present use. A visitor
 * looks and nothing here edits, so the strip has two menus only (View and
 * Help), no File, no Edit and no workspace path; the project's name and
 * what it is in the middle; Close, "Edit" for the owner and the
 * hide-interface button at the right; the Render panel under its one tab at
 * the right edge, shut until it is opened; and the transport at the foot,
 * where play is the one orange action of the screen.
 *
 * It dresses the parts mountViewerParts builds (the viewer, the Render
 * panel, the transport, the guide), as Present does, and changes none of
 * their behaviour: every key, the touch controls, the frame meter, the
 * stall log and Tab's staged hiding are the viewer's own. Opt-in: only the
 * public viewer's entry (main.ts) asks for it, so the Create page and the
 * editor's preview, which build the viewer themselves, are as they were.
 *
 * `body.bz-viewer` marks it for shell.css (the orange play, the stage's
 * note over the transport).
 */

/** Where the gallery is, whatever the address says (as main.ts's own link). */
const GALLERY = '/';

export interface ViewerFrame {
  readonly strip: TitleStrip;
  /** Close: to the gallery, or where a mode that opens the viewer says (review). */
  readonly close: HTMLAnchorElement;
  /**
   * A quiet control in the strip's right group, before Close: a link with
   * an address, else a button. `kind` fills it - the main action orange,
   * one that cannot be undone red.
   */
  control(label: string, href?: string, kind?: 'primary' | 'danger'): HTMLElement;
  /** Put a control there; in order of arrival, the newest nearest Close. */
  addAction(el: HTMLElement): void;
}

export async function mountPublicViewer(
  viewport: HTMLElement,
  manifest: Manifest,
  source: AssetSource,
  onStatus?: (msg: string) => void,
  opts: { author?: string } = {},
): Promise<{ viewer: Viewer; frame: ViewerFrame }> {
  const parts = await mountViewerParts(viewport, manifest, source, onStatus, { author: opts.author, shell: true, frame: true });
  const { viewer, panel, transport } = parts;
  const timelapse = manifest.mode === 'timelapse';
  const frames = manifest.config.frameCount;

  const strip = new TitleStrip({ path: false, savingNote: false });
  document.body.classList.add('bz-viewer');
  const chrome = pageChrome();

  // --- the readout: title, author, what it is, the stage ---------------------
  const by = opts.author ? { text: `by @${opts.author}`, href: authorHref(opts.author) } : null;
  const refreshReadout = (frame = viewer.timeline.frameIndex()): void => {
    const at = timelapse && transport ? viewer.timeline.stageAt(frame) : null;
    strip.setReadout({
      name: viewer.manifest.title || 'Bozzetto',
      by,
      extras: [
        timelapse ? { key: 'Timelapse', value: `${frames} frame${frames === 1 ? '' : 's'}` } : { key: 'Model', value: '' },
        ...(timelapse && transport ? [{ key: 'Stage', value: at?.name || null }] : []),
      ],
    });
  };
  // The transport has the viewer's frame hook: the readout rides on it.
  const frameHook = viewer.onFrame;
  viewer.onFrame = (n) => {
    frameHook?.(n);
    refreshReadout(n);
  };
  refreshReadout();

  // --- the menus: View and Help, nothing else -------------------------------
  const refresh = (): void => panel.refreshControls();
  new TopMenu(
    'View',
    viewMenuItems({
      frameSelected: () => viewer.focusSubject(),
      frameSelectedLabel: 'Frame model',
      frameAll: () => viewer.focusSubject(),
      wireframe: {
        get: () => viewer.isWireframe(),
        toggle: () => {
          viewer.toggleWireframe();
          refresh();
        },
      },
      shadows: {
        get: () => viewer.lighting.getShadowsMaster(),
        toggle: () => {
          viewer.lighting.setShadowsMaster(!viewer.lighting.getShadowsMaster());
          refresh();
        },
      },
      cycleGround: () => {
        viewer.cycleGround();
        refresh();
      },
      panels: [['settings', 'Render']],
      hideInterface: () => chrome.set(true),
    }),
    'file-menu--view',
    strip.menus,
    true,
  );
  // The viewer has no Help topics window: its Help is the hotkey guide.
  new TopMenu(
    'Help',
    [{ label: 'Hotkeys', key: keyFor('ui.help'), action: () => toggleHotkeyGuide() }],
    'file-menu--help',
    strip.menus,
    true,
  );
  strip.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => strip.setChromeHidden(hidden);

  // --- the right of the strip: Close, and what is added before it -------------
  const close = stripLink('Close', GALLERY);
  close.classList.add('viewer-back');
  close.title = 'Back to the gallery';
  strip.addAction(close);

  const control = (label: string, href?: string, kind?: 'primary' | 'danger'): HTMLElement => {
    const el = href !== undefined ? stripLink(label, href) : stripButton(label);
    if (kind) el.classList.add(`bz-strip__btn--${kind}`);
    return el;
  };

  // The frame hands the strip its place in the layout once the controls are up.
  layoutShell();
  return {
    viewer,
    frame: { strip, close, control, addAction: (el) => strip.addAction(el, close) },
  };
}
