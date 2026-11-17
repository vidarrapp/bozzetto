/**
 * The geometry of the app shell that CSS cannot say alone (shell.css has
 * the rest): where each folder tab sits along its edge, and how tall an
 * open panel may grow.
 *
 * Tabs: a side's tabs stand in a row at the edge, 1px apart, each as wide
 * as its name. Each tab is the child of its own panel (so a panel and its
 * tab stay one thing for the code that opens and closes them) and is fixed
 * to the screen, so the row is laid out here, from the tabs' own widths.
 *
 * Height: a panel is as tall as its content, up to 16px above whatever
 * stands below it on its edge. On the left that is the edge controls, on
 * the right the bottom of the screen - or the tool bar, where this window
 * is narrow enough for the two to meet. Both limits go to CSS as
 * variables (--bz-max-left, --bz-max-right).
 */

/**
 * Height of the title strip and the tab row under it: where a panel starts.
 * 56px with the 24px strip; a phone's taller strip (shell.css,
 * --bz-strip-h) moves it by the same amount, so it is read from where the
 * panels stand rather than kept here.
 */
export const PANEL_TOP_DEFAULT = 56;
export function panelTop(): number {
  // Read from a probe that stands where the panels start (a phone's panels are docked
  // at the bottom, so a panel's own top says nothing there).
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;top:var(--bz-panel-top)';
  // In the strip, not the body: the layout watches the body's children and would run again.
  (document.querySelector('.bz-strip') ?? document.body).appendChild(probe);
  const top = parseFloat(getComputedStyle(probe).top);
  probe.remove();
  return Number.isFinite(top) ? top : PANEL_TOP_DEFAULT;
}

/** A phone-sized window. Phones are not a target: panels open there as they do everywhere (owner, 2026-11-17). */
export function isPhone(): boolean {
  return window.matchMedia('(max-width: 599px)').matches;
}

const cued = new WeakSet<HTMLElement>();
/**
 * The tool bar scrolls sideways where it does not fit; say so with a fade at
 * each edge that has more behind it (data-scroll-cue: none, start, end, both).
 */
function paintScrollCue(bar: HTMLElement): void {
  if (!cued.has(bar)) {
    cued.add(bar);
    // Also once the scroll has settled: a snap can end the move without one last scroll event.
    let settle = 0;
    bar.addEventListener(
      'scroll',
      () => {
        paintScrollCue(bar);
        clearTimeout(settle);
        settle = window.setTimeout(() => paintScrollCue(bar), 120);
      },
      { passive: true },
    );
    bar.addEventListener('scrollend', () => paintScrollCue(bar));
  }
  const max = bar.scrollWidth - bar.clientWidth;
  const at = bar.scrollLeft;
  const more = max > 1;
  const start = more && at > 1;
  const end = more && at < max - 1;
  const cue = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
  if (bar.dataset.scrollCue !== cue) bar.dataset.scrollCue = cue;
}
export const PANEL_WIDTH = 304;

/**
 * Whether a left and a right panel would cover each other here (a phone):
 * then opening a panel on one side closes the other side's too.
 */
export function sidesOverlap(): boolean {
  return window.innerWidth < PANEL_WIDTH * 2 + 1;
}
const GAP = 16;

/** Something the layout depends on changed that no observer sees (the brush fields showing or hiding). */
export const SHELL_LAYOUT_EVENT = 'bozzetto:shell-layout';

/** The tabs, left to right on each side: the panel's variant class gives its place. */
// Layers and Reference are built elsewhere; their places are kept here.
const LEFT_ORDER = ['panel--scene', 'panel--model', 'panel--layers', 'panel--armature', 'panel--frames', 'panel--project'];
const RIGHT_ORDER = ['panel--sculpt', 'panel--material', 'panel--reference', 'panel--render', 'panel--output'];

function tabsOf(order: string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const cls of order) {
    const handle = document.querySelector<HTMLElement>(`.panel.${cls} > .panel__handle`);
    // A tab that is not shown (display none: Present puts some away) takes no place in the row.
    if (handle && handle.getClientRects().length > 0) out.push(handle);
  }
  return out;
}

/** Lay the tabs along their edges and set the panels' height limits. */
export function layoutShell(): void {
  if (!document.body.classList.contains('bz-shell')) return;
  const html = document.documentElement;
  // A phone with a full row of tabs: the tight set when the roomier one would overlap.
  html.removeAttribute('data-tabs-tight');
  if (!placeTabs() && isPhone()) {
    html.setAttribute('data-tabs-tight', '');
    placeTabs();
  }
  setLimits();
}

/** Put the tabs along their edges; false when the left row and the right row would meet. */
function placeTabs(): boolean {
  let x = 0;
  for (const tab of tabsOf(LEFT_ORDER)) {
    tab.style.left = `${x}px`;
    tab.style.right = 'auto';
    x += tab.getBoundingClientRect().width + 1;
  }
  // How far the whole row travels when the interface is hidden (see shell.css).
  document.documentElement.style.setProperty('--bz-tabs-left', `${x}px`);
  const leftWidth = x;
  x = 0;
  for (const tab of tabsOf(RIGHT_ORDER).reverse()) {
    tab.style.right = `${x}px`;
    tab.style.left = 'auto';
    x += tab.getBoundingClientRect().width + 1;
  }
  document.documentElement.style.setProperty('--bz-tabs-right', `${x}px`);
  return leftWidth + x <= window.innerWidth;
}

/** The panels' height limits. */
function setLimits(): void {
  const brushes = document.querySelector<HTMLElement>('.sculpt-toolbar__brushes');
  if (brushes) paintScrollCue(brushes);

  // The slid-away bars are measured where they are not: leave the limits as they were.
  if (document.body.classList.contains('chrome-hidden')) return;
  const root = document.documentElement.style;
  const top = panelTop();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const panelW = Math.min(PANEL_WIDTH, vw);
  // What stands at the foot of the screen: the tool bar, or in Present the turntable bar,
  // or on the owner's Present of a published project, and in the public viewer, its transport.
  const body = document.body.classList;
  const bar = document.querySelector<HTMLElement>(
    body.contains('bz-frames') || body.contains('bz-viewer') ? '.transport--shell' : body.contains('presenting') ? '.present-bar' : '.sculpt-toolbar__brushes',
  );
  const barBox = bar && bar.getClientRects().length > 0 ? bar.getBoundingClientRect() : null;
  const edge = document.querySelector<HTMLElement>('.bz-edge');
  const edgeBox = edge && edge.getClientRects().length > 0 ? edge.getBoundingClientRect() : null;

  // The bottom limit of a panel docked on one side: the edge controls (left
  // only), and the tool bar when it reaches under the panel's columns.
  const limit = (side: 'left' | 'right'): number => {
    let bottom = vh - GAP;
    const from = side === 'left' ? 0 : vw - panelW;
    const to = from + panelW;
    if (side === 'left' && edgeBox) bottom = Math.min(bottom, edgeBox.top - GAP);
    if (barBox && barBox.left < to && barBox.right > from) bottom = Math.min(bottom, barBox.top - GAP);
    return Math.max(48, Math.floor(bottom - top));
  };
  root.setProperty('--bz-max-left', `${limit('left')}px`);
  root.setProperty('--bz-max-right', `${limit('right')}px`);
}

/**
 * Keep the layout current: on resize and font loads, and whenever a tab,
 * the edge controls or the tool bar changes size. Returns the way out.
 */
export function startShellLayout(): () => void {
  let timer = 0;
  const soon = (): void => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      layoutShell();
    }, 0);
  };
  const watched = new Set<Element>();
  const ro = new ResizeObserver(soon);
  const watch = (): void => {
    const now = document.querySelectorAll('.panel > .panel__handle, .bz-edge, .sculpt-toolbar__brushes, .present-bar, .transport--shell');
    for (const e of now) {
      if (watched.has(e)) continue;
      watched.add(e);
      ro.observe(e);
    }
  };
  // Panels and the controls appear a little after the strip (each part of
  // the shell is built in turn): the document's own changes are watched
  // for new things to measure, lightly - childList on the body only.
  const mo = new MutationObserver(() => {
    watch();
    soon();
  });
  mo.observe(document.body, { childList: true });
  watch();
  // A resize can flip the phone rules (tab size) a moment after the event: measure once more when it has settled.
  let late = 0;
  const afterResize = (): void => {
    soon();
    clearTimeout(late);
    late = window.setTimeout(soon, 400);
  };
  window.addEventListener('resize', afterResize);
  const phoneRules = window.matchMedia('(max-width: 599px)');
  phoneRules.addEventListener('change', afterResize);
  window.addEventListener(SHELL_LAYOUT_EVENT, soon);
  // A panel sliding in or out moves its tab while it goes (the tab is fixed inside it): measure again once it has stopped.
  document.addEventListener('transitionend', soon, true);
  void document.fonts?.ready.then(soon);
  soon();
  return () => {
    clearTimeout(timer);
    clearTimeout(late);
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener('resize', afterResize);
    phoneRules.removeEventListener('change', afterResize);
    window.removeEventListener(SHELL_LAYOUT_EVENT, soon);
    document.removeEventListener('transitionend', soon, true);
    const root = document.documentElement.style;
    root.removeProperty('--bz-max-left');
    root.removeProperty('--bz-max-right');
  };
}
