/**
 * The meta lines of the pages (rows and cards of Owner tools, My projects,
 * Community, Account and Review): a line is a few parts, each its own inline
 * item, with one gap between them and no dot. A part wraps to the next line
 * whole. Real values (counts, sizes, dates, ids, handles, emails, kind
 * labels) are Martian Mono 11px; a phrase (words that say something, such as
 * "submitted 9 Nov" or "Pending review") is Familjen Grotesk 13px. Both are
 * in the second text colour. The parts are parted by a space in the text
 * too, so the line reads, and is copied, as a sentence would be.
 */

/** A real value: a count, a size, a date, an id, a handle. */
export function metaValue(text: string | Node, className = ''): HTMLSpanElement {
  const part = document.createElement('span');
  part.className = `meta__v${className ? ` ${className}` : ''}`;
  part.append(text);
  return part;
}

/** A kind label (Timelapse, Model): the value's face, in capitals. */
export const metaKind = (text: string): HTMLSpanElement => metaValue(text, 'meta__kind');

/** Words: a status, or a date with the word that goes with it. */
export function metaPhrase(...content: (string | Node)[]): HTMLSpanElement {
  const part = document.createElement('span');
  part.className = 'meta__t';
  part.append(...content);
  return part;
}

/** Fill `host` with the parts, a space between each (kept in the text, not drawn). */
export function fillMeta(host: HTMLElement, parts: Array<Node | null | false | undefined>, append = false): HTMLElement {
  host.classList.add('meta');
  const nodes: Node[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (nodes.length) nodes.push(document.createTextNode(' '));
    nodes.push(part);
  }
  if (append) {
    if (host.childNodes.length && nodes.length) host.append(document.createTextNode(' '));
    host.append(...nodes);
  } else host.replaceChildren(...nodes);
  return host;
}

/** "12 views" and "1 star": a work's counts, a line of two values. */
export function statsLine(views: number, stars: number, className = 'card__stats'): HTMLElement {
  const n = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;
  const line = document.createElement('span');
  line.className = className;
  return fillMeta(line, [metaValue(n(views, 'view')), metaValue(n(stars, 'star'))]);
}
