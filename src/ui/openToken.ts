/**
 * "This tab asked to open that scene": what a gallery card or the Projects
 * page leaves behind when it sends the tab to `/?sculpt=1&lib=<id>` or
 * `&project=<id>`.
 *
 * Opening a scene replaces the work on this device - the autosave is
 * written over seconds later and the captured frames go - and the card
 * asks first. But the address is a link like any other, and any page can
 * send one. So Sculpt asks again at boot when the work in progress is at
 * stake, unless it finds this: written by the page that asked, in this
 * tab's sessionStorage, which no other site can write, naming the same
 * scene, and taken the first time it is read.
 */

const KEY = 'bozzetto-open';
/** Long enough for the tab to get there; a card clicked and left behind does not count later. */
const FRESH_MS = 2 * 60 * 1000;

export type OpenKind = 'lib' | 'project';

/** Note that this tab is about to open the scene, having asked (or found nothing to lose). */
export function markOpen(kind: OpenKind, id: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ open: `${kind}:${id}`, at: Date.now() }));
  } catch {
    // Storage refused: Sculpt asks at boot instead, which is only a second question.
  }
}

/** The scene this tab was sent to open, if one was (`kind:id`), read once. */
export function takeOpen(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const rec = raw ? (JSON.parse(raw) as { open?: unknown; at?: unknown }) : null;
    if (typeof rec?.open !== 'string' || typeof rec.at !== 'number') return null;
    return Date.now() - rec.at < FRESH_MS ? rec.open : null;
  } catch {
    return null;
  }
}

/**
 * markOpen for a link to Sculpt, read off its address, on a plain click:
 * a modified one opens another tab, whose own storage this cannot reach,
 * and which asks at boot instead.
 */
export function markOpenOnClick(ev: MouseEvent, link: HTMLAnchorElement): void {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const q = new URL(link.href, window.location.href).searchParams;
  const project = q.get('project');
  const lib = q.get('lib');
  if (project) markOpen('project', project);
  else if (lib) markOpen('lib', lib);
}
