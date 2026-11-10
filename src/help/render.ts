import { CREDIT_GROUPS } from './credits';
import type { Block } from './types';

/**
 * Draws help blocks into an element. Built with createElement and
 * textContent only, so text can never become markup. Inline, text may hold
 * **bold** and [a link](https://example.org); links open in a new tab and
 * only http and https ones are made.
 */
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function inline(into: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) into.append(text.slice(last, at));
    if (m[1] !== undefined) {
      const b = document.createElement('strong');
      b.textContent = m[1];
      into.append(b);
    } else {
      into.append(link(m[2], m[3]));
    }
    last = at + m[0].length;
  }
  if (last < text.length) into.append(text.slice(last));
}

export function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function renderBlocks(into: HTMLElement, blocks: Block[]): void {
  for (const b of blocks) {
    switch (b.kind) {
      case 'p': {
        const p = el('p', 'help-win__p');
        inline(p, b.text);
        into.append(p);
        break;
      }
      case 'h': {
        const h = el('h4', 'help-win__h');
        h.textContent = b.text;
        into.append(h);
        break;
      }
      case 'list': {
        const ul = el('ul', 'help-win__list');
        for (const item of b.items) {
          const li = el('li');
          inline(li, item);
          ul.append(li);
        }
        into.append(ul);
        break;
      }
      case 'options': {
        const dl = el('dl', 'help-win__options');
        for (const [label, text] of b.items) {
          const dt = el('dt');
          dt.textContent = label;
          const dd = el('dd');
          inline(dd, text);
          dl.append(dt, dd);
        }
        into.append(dl);
        break;
      }
      case 'credits':
        renderCredits(into);
        break;
    }
  }
}

function renderCredits(into: HTMLElement): void {
  for (const group of CREDIT_GROUPS) {
    const gh = el('h4', 'help-win__h');
    gh.textContent = group.title;
    into.append(gh);
    for (const c of group.credits) {
      const box = el('div', 'help-win__credit');
      const name = el('h5', 'help-win__credit-name');
      name.textContent = c.name;
      const use = el('p', 'help-win__p');
      use.textContent = c.use;
      const meta = el('p', 'help-win__p help-win__meta');
      meta.append(`Licence: ${c.licence}.`);
      if (c.url) meta.append(' ', link(c.url.replace(/^https?:\/\//, ''), c.url));
      box.append(name, use, meta);
      if (c.note) {
        const note = el('p', 'help-win__p');
        note.textContent = c.note;
        box.append(note);
      }
      into.append(box);
    }
  }
}
