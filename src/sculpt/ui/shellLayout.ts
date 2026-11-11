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

/** Height of the title strip and the tab row under it: where a panel starts. */
export const PANEL_TOP = 56;
export const PANEL_WIDTH = 304;
const GAP = 16;

/** Something the layout depends on changed that no observer sees (the brush fields showing or hiding). */
export const SHELL_LAYOUT_EVENT = 'bozzetto:shell-layout';

/** The tabs, left to right on each side: the panel's variant class gives its place. */
const LEFT_ORDER = ['panel--scene', 'panel--model', 'panel--armature'];
const RIGHT_ORDER = ['panel--sculpt', 'panel--render'];

function tabsOf(order: string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const cls of order) {
    const handle = document.querySelector<HTMLElement>(`.panel.${cls} > .panel__handle`);
    if (handle) out.push(handle);
  }
  return out;
}

/** Lay the tabs along their edges and set the panels' height limits. */
export function layoutShell(): void {
  if (!document.body.classList.contains('bz-shell')) return;
  let x = 0;
  for (const tab of tabsOf(LEFT_ORDER)) {
    tab.style.left = `${x}px`;
    tab.style.right = 'auto';
    x += tab.getBoundingClientRect().width + 1;
  }
  x = 0;
  for (const tab of tabsOf(RIGHT_ORDER).reverse()) {
    tab.style.right = `${x}px`;
    tab.style.left = 'auto';
    x += tab.getBoundingClientRect().width + 1;
  }

  const root = document.documentElement.style;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const panelW = Math.min(PANEL_WIDTH, vw);
  const bar = document.querySelector<HTMLElement>('.sculpt-toolbar__brushes');
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
    return Math.max(48, Math.floor(bottom - PANEL_TOP));
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
    const now = document.querySelectorAll('.panel > .panel__handle, .bz-edge, .sculpt-toolbar__brushes');
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
  window.addEventListener('resize', soon);
  window.addEventListener(SHELL_LAYOUT_EVENT, soon);
  void document.fonts?.ready.then(soon);
  soon();
  return () => {
    clearTimeout(timer);
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener('resize', soon);
    window.removeEventListener(SHELL_LAYOUT_EVENT, soon);
    const root = document.documentElement.style;
    root.removeProperty('--bz-max-left');
    root.removeProperty('--bz-max-right');
  };
}
