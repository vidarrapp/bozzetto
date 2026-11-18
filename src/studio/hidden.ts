/**
 * Small tools for putting pieces of the page away without disposing them
 * (a workspace suspended, the shell asleep): out of sight, and a way to
 * find what a stretch of code put on the page.
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
