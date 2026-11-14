import { legalFoot } from './legalFoot';
import { fillMeta, metaPhrase } from './metaLine';
import { pageNav, type PageId, type PageNav } from './pageNav';

/**
 * The frame the pages share (the boards' Owner tools, My projects,
 * Community, Account and Review): the title strip (ui/pageNav) fixed at the
 * top, and under it the page's own scroller (the host) holding a column with
 * the title, a line under the title, and then whatever the page puts below.
 * The document itself never scrolls (style.css, `html.is-page`). The column
 * is 1040px wide, 800px for a page of plain sections (the Account).
 *
 * The foot (ui/legalFoot) closes the column on every page.
 *
 * The caller fills the strip, `shell.nav.fill`, once it knows who is signed
 * in. `name` is what the strip's middle says (the title unless told otherwise).
 */
export interface PageShell {
  nav: PageNav;
  page: HTMLElement;
  head: HTMLElement;
  title: HTMLElement;
  tagline: HTMLElement;
}

export function pageShell(
  host: HTMLElement,
  opts: { current: PageId | null; title: string; name?: string; tagline?: string; className?: string; narrow?: boolean },
): PageShell {
  document.documentElement.classList.add('is-page');
  host.classList.add('page-scroll');
  const nav = pageNav(opts.current, opts.name ?? opts.title);
  const page = document.createElement('div');
  page.className = `page${opts.narrow ? ' page--narrow' : ''}${opts.className ? ` ${opts.className}` : ''}`;
  const head = document.createElement('header');
  head.className = 'page__head';
  const title = document.createElement('h1');
  title.className = 'page__title';
  title.textContent = opts.title;
  const tagline = document.createElement('p');
  tagline.className = 'page__tag';
  tagline.textContent = opts.tagline ?? '';
  tagline.hidden = !opts.tagline;
  head.append(title, tagline);
  page.appendChild(head);
  // The same foot on every page, after whatever the page puts in its column.
  const foot = document.createElement('div');
  foot.className = `page page--foot${opts.narrow ? ' page--narrow' : ''}`;
  foot.appendChild(legalFoot());
  host.replaceChildren(page, foot);
  host.scrollTop = 0;
  return { nav, page, head, title, tagline };
}

/** Say something under the title, or nothing. */
export function setTagline(shell: Pick<PageShell, 'tagline'>, text: string | string[]): void {
  if (typeof text === 'string') {
    shell.tagline.classList.remove('meta');
    shell.tagline.textContent = text;
  } else {
    // Parts, a gap between them and no dot (ui/metaLine).
    shell.tagline.replaceChildren();
    fillMeta(shell.tagline, text.map((t) => metaPhrase(t)));
  }
  shell.tagline.hidden = text.length === 0 || text === '';
}
