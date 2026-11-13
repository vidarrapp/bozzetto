import '../sculpt/ui/shell.css';
import type { Manifest } from '../types/manifest';
import type { AssetSource } from './AssetSource';
import type { Viewer } from './Viewer';
import { mountViewerParts } from './mountViewer';
import { pageChrome } from '../ui/ChromeToggle';
import { toggleHotkeyGuide } from '../help/menu';
import { authorHref } from '../net/community';
import { TitleStrip } from '../sculpt/ui/TitleStrip';
import { TopMenu, type MenuItem } from '../sculpt/ui/TopMenu';
import { originOf, type Origin } from '../ui/origin';
import { keyFor, viewMenuItems } from '../sculpt/ui/viewMenu';
import { layoutShell } from '../sculpt/ui/shellLayout';

/**
 * The public viewer (`/?tl=<id>`) in the app's frame (docs/ui-spec.md): the
 * quiet version of the shell Sculpt, Armature and Present use. A visitor
 * looks and nothing here edits, so there is no Edit menu and no workspace
 * path. The strip has File (New sculpt from this, for a template; Edit in
 * Present, for the owner; Close, back to where the person came from, ui/origin),
 * View, Moderation (Report, and the review actions; only when it has one)
 * and Help; the project's name and what it is in the middle; the Star for a
 * member and the hide-interface button at the right; the Render panel under
 * its one tab at the right edge, shut until it is opened; and the transport
 * at the foot, with its white play button.
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

/** What the viewer's File menu may offer beside Close, each only when it applies. */
export interface ViewerFileItems {
  /** New sculpt from this: a template only; starts a Sculpt scene from the frame on screen. */
  newSculpt?: () => void | Promise<void>;
  /** Edit in Present: the owner only. */
  present?: () => void | Promise<void>;
}

export interface ViewerFrame {
  readonly strip: TitleStrip;
  /** Where File > Close goes now, and what its hint says. */
  readonly origin: () => Origin;
  /** Close goes here (review mode names the Review page); the hint follows. */
  setOrigin(origin: Origin): void;
  /** The File menu's items besides Close; the menu is redrawn. */
  setFileItems(items: ViewerFileItems): void;
  /**
   * The Moderation menu's items (Report, and the review actions): the menu
   * shows only while it has one, and is redrawn each time this is called.
   */
  setModeration(items: MenuItem[]): void;
  /** Put a control at the right of the strip, before the hide button (the Star). */
  addAction(el: HTMLElement): void;
  /** File > Close: to where the person came from. */
  close(): void;
}

export async function mountPublicViewer(
  viewport: HTMLElement,
  manifest: Manifest,
  source: AssetSource,
  onStatus?: (msg: string) => void,
  opts: { author?: string; origin?: Origin } = {},
): Promise<{ viewer: Viewer; frame: ViewerFrame }> {
  const parts = await mountViewerParts(viewport, manifest, source, onStatus, { author: opts.author, shell: true, frame: true });
  const { viewer, panel, transport } = parts;
  const timelapse = manifest.mode === 'timelapse';
  const frames = manifest.config.frameCount;

  const strip = new TitleStrip({ path: false });
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

  // --- the menus: File, View, Moderation (when it has something), Help ---------
  let origin: Origin = opts.origin ?? originOf();
  let extras: ViewerFileItems = {};
  const close = (): void => window.location.assign(origin.href);
  const fileItems = (): MenuItem[] => {
    const rows: MenuItem[] = [];
    if (extras.newSculpt) rows.push({ label: 'New sculpt from this', hint: 'Starts a new sculpt from the frame on screen', action: extras.newSculpt });
    if (extras.present) rows.push({ label: 'Edit in Present', action: extras.present });
    if (rows.length) rows.push({ separator: true });
    rows.push({ label: 'Close', hint: origin.hint, action: close });
    return rows;
  };
  const file = new TopMenu('File', fileItems(), 'file-menu--file', strip.menus, true);
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
  const moderation = new TopMenu('Moderation', [], 'file-menu--moderation', strip.menus, true);
  moderation.setShown(false);
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

  // The frame hands the strip its place in the layout once the controls are up.
  layoutShell();
  return {
    viewer,
    frame: {
      strip,
      origin: () => origin,
      setOrigin: (o) => {
        origin = o;
        file.setItems(fileItems());
      },
      setFileItems: (items) => {
        extras = items;
        file.setItems(fileItems());
      },
      setModeration: (items) => {
        moderation.setItems(items);
        moderation.setShown(items.length > 0);
      },
      addAction: (el) => strip.addAction(el),
      close,
    },
  };
}
