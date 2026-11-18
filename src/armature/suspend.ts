import { PANEL_CLOSE_ALL_EVENT } from '../ui/ChromeToggle';

/**
 * Small tools for suspending Armature mode (mode.ts): taking its pieces of
 * the page out of sight and out of hearing without disposing them.
 */

/**
 * Remember what is in `hosts` now, and later (the returned function) list
 * what has been added to them since, in order: the elements a stretch of
 * code put on the page, when it keeps no list of them itself.
 */
export function watchAdditions(hosts: Array<Element | null | undefined>): () => HTMLElement[] {
  const watched = hosts.filter((h): h is Element => !!h);
  const before = watched.map((h) => new Set<Element>(h.children));
  return () =>
    watched.flatMap((h, i) => [...h.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !before[i].has(c)));
}

/**
 * Elements taken out of sight with `display: none` (important, so a rule of
 * a stylesheet cannot bring them back), each with its own inline display put
 * back by `show`. An element already hidden by its `hidden` attribute stays
 * as it was.
 */
export class Hidden {
  private readonly held = new Map<HTMLElement, { value: string; priority: string }>();

  hide(els: Iterable<HTMLElement>): void {
    for (const el of els) {
      if (this.held.has(el)) continue;
      this.held.set(el, { value: el.style.getPropertyValue('display'), priority: el.style.getPropertyPriority('display') });
      el.style.setProperty('display', 'none', 'important');
    }
  }

  show(): void {
    for (const [el, was] of this.held) {
      if (was.value) el.style.setProperty('display', was.value, was.priority);
      else el.style.removeProperty('display');
    }
    this.held.clear();
  }

  isHidden(): boolean {
    return this.held.size > 0;
  }
}

/**
 * A side panel's own listeners on the window (the one-panel-per-side
 * protocol, a panel opened by id, the Tab key's close-all), taken off and
 * put back. A panel that is out of sight must not open, close or collapse
 * another one when some other workspace's panels, which may carry the same
 * ids, speak on the same events. SidePanel keeps its handlers to itself, so
 * they are found by name; a name that is gone is reported, and the test of
 * suspending (armatureSuspend) fails with it.
 */
const PANEL_EVENTS: Array<[type: string, handler: string]> = [
  ['bozzetto:panel-open', 'onOtherPanelOpen'],
  ['bozzetto:panel-set', 'onPanelSet'],
  [PANEL_CLOSE_ALL_EVENT, 'onCloseAll'],
];

export function panelListeners(panel: object): { start(): void; stop(): void } {
  const handlers = PANEL_EVENTS.flatMap(([type, name]) => {
    const fn = (panel as Record<string, unknown>)[name];
    if (typeof fn !== 'function') {
      console.warn(`armature: a panel has no ${name}; suspending cannot silence it`);
      return [];
    }
    return [[type, fn as EventListener] as const];
  });
  return {
    start: () => handlers.forEach(([type, fn]) => window.addEventListener(type, fn)),
    stop: () => handlers.forEach(([type, fn]) => window.removeEventListener(type, fn)),
  };
}
