/**
 * The top row every page shares: page actions on the left, global ones on
 * the right, all the same chip. Before this, the gallery link was a bare
 * text link in the viewer, a chip in the admin editor, and the landing
 * page's nav lived in the document flow while the theme toggle floated
 * above it - three different treatments of the same idea.
 *
 * Both groups are created on demand, so a page only gets the row it uses.
 * Order within the right group is set in CSS rather than by insertion, since
 * the theme toggle mounts before anything else knows what to put beside it.
 */

function group(cls: string): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`.${cls}`);
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = `topbar ${cls}`;
  document.body.appendChild(el);
  return el;
}

export function topbarLeft(): HTMLElement {
  return group('topbar--left');
}

export function topbarRight(): HTMLElement {
  return group('topbar--right');
}

/** A chip: the shared look for every top-row control, link or button. */
export function topChip(label: string, href?: string): HTMLElement {
  const el = document.createElement(href ? 'a' : 'button');
  el.className = 'topchip';
  el.textContent = label;
  if (href) (el as HTMLAnchorElement).href = href;
  else (el as HTMLButtonElement).type = 'button';
  return el;
}
