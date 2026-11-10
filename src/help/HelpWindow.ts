import { div } from '../ui/dom';
import { renderBlocks } from './render';
import { blocksOf, searchText, TOPICS, type Topic } from './topics';

/**
 * The Help window: the topics in a list and the chosen one beside it (on a
 * narrow screen, above it), with a text filter over titles and bodies.
 * Built on the Preferences window's chrome (`.dsettings`), so it is a
 * modal in the same way: while it is up the body carries `has-modal` and
 * the key handlers stand down. Esc closes it; Tab stays inside it; the
 * Up and Down arrow keys walk the list.
 *
 * `showHelp(id)` opens it on a topic from anywhere. With no id it opens on
 * the topic it was last on, or the first.
 */
export const DEFAULT_TOPIC = TOPICS[0].id;

interface Mounted {
  root: HTMLElement;
  open: (id?: string) => void;
  close: () => void;
  isOpen: () => boolean;
}

let mounted: Mounted | null = null;

export function showHelp(topicId?: string): void {
  if (!mounted) {
    mounted = build();
    document.body.appendChild(mounted.root);
  }
  mounted.open(topicId);
}

export function hideHelp(): void {
  mounted?.close();
}

export function isHelpOpen(): boolean {
  return !!mounted?.isOpen();
}

/** The id the About and credits topic has, for the menus. */
export const ABOUT_TOPIC = 'about';

function build(): Mounted {
  const root = div('dsettings help-win');
  root.hidden = true;
  const card = div('dsettings__card help-win__card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Help');

  const head = div('help-win__head');
  const title = document.createElement('h2');
  title.className = 'dsettings__title';
  title.textContent = 'Help';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sculpt-panel__btn help-win__close';
  closeBtn.textContent = 'Close';
  closeBtn.setAttribute('aria-label', 'Close the help window');
  head.append(title, closeBtn);

  const filter = document.createElement('input');
  filter.type = 'search';
  filter.className = 'help-win__filter';
  filter.placeholder = 'Filter topics';
  filter.setAttribute('aria-label', 'Filter topics');
  filter.autocomplete = 'off';
  filter.spellcheck = false;

  const status = div('help-win__status dsettings__hint');
  status.setAttribute('role', 'status');

  const body = div('help-win__body');
  const nav = document.createElement('nav');
  nav.className = 'help-win__nav';
  nav.setAttribute('aria-label', 'Help topics');
  const article = document.createElement('article');
  article.className = 'help-win__topic';
  article.tabIndex = -1;
  body.append(nav, article);

  card.append(head, filter, status, body);
  root.appendChild(card);

  // --- the list ---------------------------------------------------------
  const items = new Map<string, HTMLButtonElement>();
  const headings: Array<{ el: HTMLElement; ids: string[] }> = [];
  let group: { el: HTMLElement; ids: string[] } | null = null;
  for (const topic of TOPICS) {
    if (!group || group.el.dataset.group !== topic.group) {
      const h = div('help-win__group');
      h.dataset.group = topic.group;
      h.textContent = topic.group;
      nav.appendChild(h);
      group = { el: h, ids: [] };
      headings.push(group);
    }
    group.ids.push(topic.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'help-win__item';
    b.dataset.topic = topic.id;
    if (topic.tools) b.dataset.tools = topic.tools.join('|');
    b.textContent = topic.title;
    b.addEventListener('click', () => select(topic.id));
    nav.appendChild(b);
    items.set(topic.id, b);
  }

  // --- the filter -------------------------------------------------------
  const index = new Map<string, string>();
  const haystack = (t: Topic): string => {
    // The About topic holds the version, which cannot change in a session,
    // but is built on demand: indexed on first use, not at load.
    let s = index.get(t.id);
    if (s === undefined) {
      s = searchText(t);
      index.set(t.id, s);
    }
    return s;
  };
  let current = DEFAULT_TOPIC;

  const visibleIds = (): string[] => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return TOPICS.map((t) => t.id);
    const words = q.split(/\s+/);
    return TOPICS.filter((t) => {
      const text = haystack(t);
      return words.every((w) => text.includes(w));
    }).map((t) => t.id);
  };

  const applyFilter = (): void => {
    const shown = new Set(visibleIds());
    for (const [id, b] of items) b.hidden = !shown.has(id);
    for (const g of headings) g.el.hidden = !g.ids.some((id) => shown.has(id));
    const q = filter.value.trim();
    status.textContent = q ? (shown.size === 1 ? '1 topic' : `${shown.size} topics`) : '';
    if (shown.size === 0) {
      article.replaceChildren(message(`No topic matches "${q}".`));
      for (const b of items.values()) b.removeAttribute('aria-current');
      return;
    }
    if (!shown.has(current)) select([...shown][0], false);
    else if (!article.firstChild || article.querySelector('.help-win__none')) select(current, false);
  };

  function message(text: string): HTMLElement {
    const m = div('help-win__none');
    m.textContent = text;
    return m;
  }

  // --- the topic --------------------------------------------------------
  function select(id: string, focus = true): void {
    const topic = TOPICS.find((t) => t.id === id);
    if (!topic) return;
    current = id;
    for (const [tid, b] of items) {
      if (tid === id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    const h = document.createElement('h3');
    h.className = 'help-win__title';
    h.textContent = topic.title;
    article.dataset.topic = id;
    article.setAttribute('aria-label', topic.title);
    article.replaceChildren(h);
    renderBlocks(article, blocksOf(topic));
    article.scrollTop = 0;
    items.get(id)?.scrollIntoView?.({ block: 'nearest' });
    if (focus) items.get(id)?.focus({ preventScroll: true });
  }

  // --- opening and closing ----------------------------------------------
  let opened = false;
  let returnTo: HTMLElement | null = null;

  const open = (id?: string): void => {
    if (!opened) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      opened = true;
      root.hidden = false;
      document.body.classList.add('has-modal');
      window.addEventListener('keydown', onKey, true);
    }
    if (id && TOPICS.some((t) => t.id === id)) {
      // A topic the filter hides would open to nothing: clear the filter.
      if (!visibleIds().includes(id)) filter.value = '';
      current = id;
    }
    applyFilter();
    select(current);
  };

  const close = (): void => {
    if (!opened) return;
    opened = false;
    root.hidden = true;
    document.body.classList.remove('has-modal');
    window.removeEventListener('keydown', onKey, true);
    const back = returnTo;
    returnTo = null;
    // Not a text field: handing the focus back to one would let Tab and
    // the hotkeys behave as if still typing.
    if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
  };

  const focusables = (): HTMLElement[] =>
    [...card.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex="0"]')].filter(
      (e) => !(e as HTMLButtonElement).disabled && !e.closest('[hidden]') && e.getClientRects().length > 0,
    );

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement;
      if (!card.contains(at)) {
        first.focus();
        e.preventDefault();
      } else if (e.shiftKey && at === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && at === last) {
        first.focus();
        e.preventDefault();
      }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && nav.contains(document.activeElement)) {
      const shown = [...items.values()].filter((b) => !b.hidden);
      const i = shown.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      const next = shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)];
      select(next.dataset.topic!);
      e.preventDefault();
    }
  }

  filter.addEventListener('input', applyFilter);
  closeBtn.addEventListener('click', close);
  // The backdrop closes, as it does for Preferences.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });

  return { root, open, close, isOpen: () => opened };
}
