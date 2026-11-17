/**
 * The shape both layer models share: a flat list, oldest (bottom) first,
 * holding layers and groups, a layer optionally inside a group (one level of
 * nesting: no group inside a group). Kept canonical: each top-level entry is
 * followed by its members, so a group's place in the stack is its place in
 * the list and its members stand right after it, oldest first.
 *
 * Pure functions, so the sculpt layers, the paint layers and the list that
 * draws them agree on what a stack is.
 */

export interface TreeItem<T> {
  kind: 'layer' | 'fill' | 'group';
  parent: T | null;
}

/** The entries that stand in the stack itself: layers and groups outside any group. */
export function topLevel<T extends TreeItem<T>>(list: readonly T[]): T[] {
  return list.filter((x) => x.parent === null);
}

/** A group's layers, oldest first. */
export function membersOf<T extends TreeItem<T>>(list: readonly T[], group: T): T[] {
  return list.filter((x) => x.parent === group);
}

/** The list in the canonical layout, from the top-level entries and each group's members. */
export function canonical<T extends TreeItem<T>>(top: readonly T[], members: (g: T) => T[]): T[] {
  const out: T[] = [];
  for (const t of top) {
    out.push(t);
    if (t.kind === 'group') out.push(...members(t));
  }
  return out;
}

/** The rows as drawn: newest first, a group's members under it (when `open`), indented one level. */
export function displayRows<T extends TreeItem<T>>(list: readonly T[], open: (g: T) => boolean): Array<{ item: T; depth: 0 | 1 }> {
  const rows: Array<{ item: T; depth: 0 | 1 }> = [];
  for (const t of topLevel(list).reverse()) {
    rows.push({ item: t, depth: 0 });
    if (t.kind === 'group' && open(t)) for (const m of membersOf(list, t).reverse()) rows.push({ item: m, depth: 1 });
  }
  return rows;
}

/**
 * Put `item` in a container (`parent` null is the stack itself, a group is
 * that group) at `index` counted from the bottom of the container. A group
 * cannot go into a group. Returns the new list; `item.parent` is set.
 */
export function moveItem<T extends TreeItem<T>>(list: readonly T[], item: T, parent: T | null, index: number): T[] {
  if (item.kind === 'group') parent = null;
  if (parent && parent.kind !== 'group') parent = null;
  const top = topLevel(list).filter((x) => x !== item);
  const mem = new Map<T, T[]>();
  for (const g of top) if (g.kind === 'group') mem.set(g, membersOf(list, g).filter((x) => x !== item));
  item.parent = parent;
  if (parent === null) {
    top.splice(Math.max(0, Math.min(top.length, index)), 0, item);
    if (item.kind === 'group') mem.set(item, membersOf(list, item));
  } else {
    const m = mem.get(parent) ?? [];
    m.splice(Math.max(0, Math.min(m.length, index)), 0, item);
    mem.set(parent, m);
  }
  return canonical(top, (g) => mem.get(g) ?? []);
}

/** Where an item stands in its container, counted from the bottom. */
export function indexIn<T extends TreeItem<T>>(list: readonly T[], item: T): number {
  const peers = item.parent === null ? topLevel(list) : membersOf(list, item.parent);
  return peers.indexOf(item);
}

/**
 * Where a row dropped on another row lands, as the container and the index
 * counted from the bottom that `moveItem` takes. "Above" and "below" are as
 * the list is drawn (newest on top); "into" puts the item at the top of the
 * group dropped on. A group dropped on a member lands beside that member's group.
 */
export function resolveDrop<T extends TreeItem<T>>(
  list: readonly T[],
  item: T,
  onto: T,
  place: 'above' | 'below' | 'into',
): { parent: T | null; index: number } {
  if (place === 'into' && onto.kind === 'group' && item.kind !== 'group') {
    return { parent: onto, index: membersOf(list, onto).filter((x) => x !== item).length };
  }
  let anchor = onto;
  let parent: T | null = onto.parent;
  if (item.kind === 'group' && parent) {
    anchor = parent;
    parent = null;
  }
  const peers = (parent === null ? topLevel(list) : membersOf(list, parent)).filter((x) => x !== item);
  const at = peers.indexOf(anchor);
  return { parent, index: place === 'below' ? at : at + 1 };
}
