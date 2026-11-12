// The pages suite (docs/ui-foundations.md; the boards of Owner tools, My
// projects, Community, Account and Review), against the real Functions
// (startAccountsServer) at http://localhost:<port>, with seeded accounts
// whose session cookies the browsers are handed, as the community suite does.
//
// The path: every page has the one navigation row - the logotype, then the
// links its person may see (a guest: Gallery and Community; a member adds
// My projects; a moderator Review, with its count; the owner Owner tools),
// the page one is on marked - and none of the corner chips; delete is a
// trash icon named "Delete <title>", grey at rest and red under the pointer
// or on focus, while the question after it keeps its filled red button and
// "Delete account…" is white text, red under the pointer; orange is the one main action of a page
// and nothing else; no element of these pages is set in the old fonts
// (Manrope, Instrument Serif, JetBrains Mono); and at 390px wide no page
// scrolls sideways. (The star's colours are the community suite's.)
import { resolve } from 'node:path';
import { startAccountsServer } from './lib.mjs';
import { DATA_ONE_FRAME, seedSession, seedUser, seededToken } from '../functions/lib.mjs';

const DAY = 24 * 60 * 60 * 1000;
const show = (o) => JSON.stringify(o);

const PEOPLE = {
  boss: { id: 'u-boss', handle: 'boss', email: 'owner@example.com', role: 'owner', ip: '203.0.113.60' },
  mo: { id: 'u-mo', handle: 'mo', email: 'mo@example.com', role: 'moderator', ip: '203.0.113.61' },
  ada: { id: 'u-ada', handle: 'ada', email: 'ada@example.com', ip: '203.0.113.62' },
};

const GREY_TEXT = 'rgb(179, 179, 179)';
const RED = 'rgb(171, 0, 0)';
const RED_TEXT = 'rgb(255, 107, 107)';
const ORANGE = 'rgb(255, 90, 31)';
const OLD_FONTS = /Manrope|Instrument Serif|JetBrains Mono/i;

function seed(now) {
  const rows = [];
  for (const [name, u] of Object.entries(PEOPLE)) {
    rows.push(seedUser({ id: u.id, handle: u.handle, email: u.email, role: u.role ?? 'member', at: now - DAY }));
    rows.push(seedSession({ name, id: `s-${name}`, user: u.id, created: now - 60_000 }));
  }
  const project = (id, title, owner, extra = '') =>
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at${extra ? ', shared, shared_at' : ''})
     VALUES ('${id}', '${title}', 'model', 4, '${DATA_ONE_FRAME}', 'private', 0, '${owner}', 'users/${owner}/projects/${id}/', ${now - DAY}, ${now - DAY}${extra});`;
  rows.push(
    project('p-bossbust00000000000000000', 'Boss bust', 'u-boss'),
    project('p-adabust000000000000000000', 'Ada bust', 'u-ada'),
    project('p-adashared0000000000000000', 'Ada shared', 'u-ada', `, 'public', ${now - DAY}`),
    project('p-adapending00000000000000', 'Ada pending', 'u-ada', `, 'pending', ${now - DAY}`),
    `INSERT INTO credentials (id, user_id, public_key, device_type, backed_up, name, created_at) VALUES ('c1', 'u-ada', x'00', 'multiDevice', 1, 'iPad', ${now - DAY}), ('c2', 'u-ada', x'00', 'singleDevice', 0, 'MacBook', ${now - DAY});`,
  );
  return rows.join('\n');
}

async function browserFor(browser, origin, who, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const person = who ? PEOPLE[who] : null;
  if (person) {
    await ctx.addCookies([{ name: '__Host-bz_session', value: seededToken(who), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  }
  await ctx.route(
    (url) => url.origin === origin && /^\/(api|admin\/api)\//.test(url.pathname),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const headers = { ...(await req.allHeaders()), 'cf-connecting-ip': person?.ip ?? '203.0.113.69' };
      if (person?.role === 'owner' && path.startsWith('/admin/api/')) headers['cf-access-authenticated-user-email'] = 'owner@example.com';
      await route.continue({ headers });
    },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.dismiss());
  return { ctx, page, errors, origin, who };
}

const waitFor = (p, fn, arg, timeout = 20_000) => p.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);

/** Open a page and wait until its navigation row has been filled for its person. */
async function open(b, path, ready) {
  await b.page.goto(`${b.origin}${path}`, { waitUntil: 'domcontentloaded' });
  await b.page.waitForSelector('.pagenav__links', { timeout: 30_000 });
  if (ready) await b.page.waitForSelector(ready, { timeout: 30_000 }).catch(() => {});
  // The row is drawn once the page knows who is signed in.
  await waitFor(b.page, () => document.querySelectorAll('.pagenav__account > *').length > 0 || document.querySelectorAll('.pagenav__link').length > 1);
}

/** The row, as drawn: its links, the current one, the logotype, and what the corner chips would have been. */
const navOf = (p) =>
  p.evaluate(() => {
    const nav = document.querySelector('.pagenav');
    const links = [...document.querySelectorAll('.pagenav__link')];
    const logo = document.querySelector('.pagenav__logo');
    const tops = new Set(links.map((l) => Math.round(l.getBoundingClientRect().top)));
    return {
      first: !!nav && (nav.parentElement?.firstElementChild === nav),
      logo: logo ? { text: logo.querySelector('img[src$="bozzetto-script-ink.svg"]')?.getAttribute('alt') ?? '', drawn: (logo.querySelector('img')?.naturalWidth ?? 0) > 0, href: logo.getAttribute('href'), left: logo.getBoundingClientRect().left } : null,
      links: links.map((l) => l.textContent.replace(/\d+$/, '')),
      current: links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent.replace(/\d+$/, '')),
      currentWeight: links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => getComputedStyle(l).fontWeight),
      restWeight: links.filter((l) => l.getAttribute('aria-current') !== 'page').map((l) => getComputedStyle(l).fontWeight),
      oneLine: tops.size === 1,
      count: document.querySelector('.pagenav .review-chip__count')?.textContent ?? null,
      account: [...document.querySelectorAll('.pagenav__account > *')].map((c) => c.textContent.trim()),
      chips: [...document.querySelectorAll('body > .topbar .topchip, #app .topbar .topchip')].map((c) => c.textContent),
      height: nav ? Math.round(nav.getBoundingClientRect().height) : null,
    };
  });

/** Every font family computed on the page, for the old ones. */
const fontsOf = (p) =>
  p.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('#app *, #admin *, .pagenav *')) {
      const f = getComputedStyle(el).fontFamily;
      if (!seen.has(f)) seen.set(f, el.className || el.tagName);
    }
    const h1 = document.querySelector('h1');
    const meta = document.querySelector('.admin-row__meta, .card__meta, .storage-meter__text, .account-section__title');
    return {
      families: [...seen.entries()],
      h1: h1 ? getComputedStyle(h1).fontFamily : null,
      meta: meta ? getComputedStyle(meta).fontFamily : null,
    };
  });

/**
 * The filled orange things on a page: the one main action may be, and the
 * two that are a state or an amount (the count on Review, the storage the
 * meter shows) - nothing else.
 */
const orangeOf = (p) =>
  p.evaluate(
    (orange) =>
      [...document.querySelectorAll('.page *, .pagenav *')]
        .filter((e) => getComputedStyle(e).backgroundColor === orange && e.getClientRects().length > 0 && !e.matches('.review-chip__count, .storage-meter__used'))
        .map((e) => e.textContent.trim().slice(0, 20) || e.className),
    ORANGE,
  );

const colour = (p, sel) => p.evaluate((s) => getComputedStyle(document.querySelector(s)).color, sel);
const overflowing = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function navRows(server, o, m, a, g, t) {
  await open(g, '/?community', '.card--community, .community__empty');
  let n = await navOf(g.page);
  t.ok(show(n.links) === show(['Gallery', 'Community']) && show(n.current) === show(['Community']) && n.account.includes('Sign in'), `a guest's row: Gallery and Community, Community marked, Sign in (${show(n)})`);
  t.ok(n.logo?.text === 'Bozzetto' && n.logo.drawn && n.logo.href === '/' && n.first && n.oneLine && n.height === 48, `the logotype at the left, one row of 48px, first on the page (${show(n)})`);
  t.ok(n.currentWeight.every((w) => Number(w) === 600) && n.restWeight.every((w) => Number(w) === 400), `the current page in weight 600, the others 400 (${show([n.currentWeight, n.restWeight])})`);
  t.ok(n.chips.length === 0, `and no corner chips (${show(n.chips)})`);

  await open(a, '/?me', '.card--mine, .my-projects__empty');
  n = await navOf(a.page);
  t.ok(show(n.links) === show(['Gallery', 'Community', 'My projects']) && show(n.current) === show(['My projects']) && n.account.some((c) => c.startsWith('@ada')), `a member's row adds My projects, marked, and the @handle menu (${show(n)})`);

  await open(m, '/?review', '.review-card, .review__empty');
  n = await navOf(m.page);
  t.ok(show(n.links) === show(['Gallery', 'Community', 'My projects', 'Review']) && show(n.current) === show(['Review']) && n.count === '1', `a moderator's row adds Review, with what waits (${show(n)})`);

  await open(o, '/admin/', '.admin-row');
  n = await navOf(o.page);
  t.ok(show(n.links) === show(['Gallery', 'Community', 'My projects', 'Review', 'Owner tools']) && show(n.current) === show(['Owner tools']), `the owner's row adds Owner tools, marked on /admin/ (${show(n)})`);
  for (const [tab, label] of [['invites', 'Invites'], ['users', 'Users'], ['audit', 'Audit']]) {
    await open(o, `/admin/?tab=${tab}`, '.admin-row, .admin__empty');
    n = await navOf(o.page);
    t.ok(show(n.current) === show(['Owner tools']) && n.first, `the ${label} tab keeps the row, Owner tools marked (${show(n.current)})`);
  }
  for (const [path, page] of [['/?community', 'Community'], ['/?me', 'My projects'], ['/?account', null]]) {
    await open(o, path, '.page');
    n = await navOf(o.page);
    t.ok(show(n.current) === show(page ? [page] : []) && n.first, `${path} marks ${page ?? 'nothing (the account is the menu at the right)'} (${show(n.current)})`);
  }
  await o.page.goto(`${o.origin}/?account`, { waitUntil: 'domcontentloaded' });
  await o.page.waitForSelector('.account-section', { timeout: 30_000 }).catch(() => {});
  t.ok(await o.page.evaluate(() => document.querySelector('.account-page')?.classList.contains('page--narrow')), 'the Account is the narrower column');
  // The link to a page goes there.
  await open(o, '/?community', '.card--community, .community__empty');
  await Promise.all([o.page.waitForURL((u) => u.search === '?me', { timeout: 20_000 }).catch(() => {}), o.page.click('.pagenav__link[data-page="mine"]')]);
  t.eq(new URL(o.page.url()).search, '?me', 'My projects in the row leads to My projects');
}

async function trash(o, a, t) {
  await open(o, '/admin/', '.admin-row');
  const first = await o.page.evaluate(() => {
    const row = document.querySelector('.admin-row[data-project="p-bossbust00000000000000000"]');
    const b = row?.querySelector('.admin-row__delete');
    return { label: b?.getAttribute('aria-label') ?? null, icon: b?.querySelector('i.fi.fi-ss-trash') !== null, text: b?.textContent ?? null, tag: b?.tagName };
  });
  t.ok(first.label === 'Delete Boss bust' && first.icon && first.text === '' && first.tag === 'BUTTON', `Projects: delete is a trash icon named "Delete Boss bust" (${show(first)})`);
  const sel = '.admin-row[data-project="p-bossbust00000000000000000"] .admin-row__delete';
  const rest = await colour(o.page, sel);
  await o.page.hover(sel);
  const hover = await colour(o.page, sel);
  await o.page.mouse.move(5, 5);
  await o.page.focus(sel);
  await o.page.keyboard.press('Shift+Tab');
  await o.page.keyboard.press('Tab');
  const focus = await colour(o.page, sel);
  t.ok(rest === GREY_TEXT && hover === RED_TEXT && focus === RED_TEXT, `grey at rest, the red of text under the pointer and on focus (${rest} / ${hover} / ${focus})`);

  await open(a, '/?me', '.card--mine');
  const mine = await a.page.evaluate(() => [...document.querySelectorAll('.card--mine .card__delete')].map((b) => ({ label: b.getAttribute('aria-label'), icon: !!b.querySelector('i.fi-ss-trash') })));
  t.ok(mine.length === 3 && mine.every((b) => /^Delete Ada /.test(b.label) && b.icon), `My projects: the same, a trash named for each card (${show(mine)})`);
  const mineSel = '.card--mine .card__delete';
  const mineRest = await colour(a.page, mineSel);
  await a.page.hover(mineSel);
  t.ok(mineRest === GREY_TEXT && (await colour(a.page, mineSel)) === RED_TEXT, 'grey at rest and red under the pointer there too');

  await open(a, '/?account', '.account-section');
  const keys = await a.page.evaluate(() => [...document.querySelectorAll('[data-section="passkeys"] .account-item__remove')].map((b) => ({ label: b.getAttribute('aria-label'), icon: !!b.querySelector('i.fi-ss-trash'), text: b.textContent })));
  t.ok(keys.length === 2 && keys.every((k) => /^Remove the passkey /.test(k.label) && k.icon && k.text === ''), `Account: removing a passkey is a trash icon with its name (${show(keys)})`);
  const del = await a.page.evaluate(() => {
    const b = document.querySelector('[data-item="delete"] button');
    const s = getComputedStyle(b);
    return { text: b.textContent, color: s.color, bg: s.backgroundColor };
  });
  t.ok(del.text === 'Delete account…' && del.color === 'rgb(242, 242, 242)' && del.bg === 'rgba(0, 0, 0, 0)', `"Delete account…" is white text with no fill at rest (${show(del)})`);
  await a.page.hover('[data-item="delete"] button');
  const delHover = await colour(a.page, '[data-item="delete"] button');
  t.ok(delHover === RED_TEXT, `and the red of text under the pointer (${delHover})`);
  await a.page.click('[data-item="delete"] button');
  await a.page.waitForSelector('.account-delete button.btn--danger', { timeout: 10_000 });
  const sure = await a.page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.account-delete button.btn--danger'));
    return { bg: s.backgroundColor, color: s.color };
  });
  t.ok(sure.bg === RED && sure.color === 'rgb(255, 255, 255)', `and the question keeps its filled red button (${show(sure)})`);
}

/** What the polish pass promises of a page: no dot in a meta line, words and values in their faces, the foot. */
const polishOf = (p) =>
  p.evaluate(() => {
    const lines = [...document.querySelectorAll('.meta, .admin-row__meta, .card__meta, .account-item__meta')].filter((e) => e.getClientRects().length);
    const family = (e) => getComputedStyle(e).fontFamily;
    return {
      dots: lines.filter((e) => e.textContent.includes('\u00b7')).length,
      words: [...document.querySelectorAll('.meta__t, .card__share-status, .card__share-hint')].filter((e) => e.getClientRects().length && !/Familjen Grotesk/.test(family(e))).length,
      values: [...document.querySelectorAll('.meta__v')].filter((e) => e.getClientRects().length && !/Martian Mono/.test(family(e))).length,
      foot: [...document.querySelectorAll('.landing__foot')].map((f) => ({
        links: [...f.querySelectorAll('a')].map((a) => a.textContent).join(),
        version: !!f.querySelector('.landing__version')?.textContent,
        last: f.closest('.page--foot') === document.querySelector('.page--foot') && !document.querySelector('.page--foot')?.nextElementSibling,
      })),
    };
  });

async function colourAndType(o, m, a, t) {
  const pages = [
    [o, '/admin/', '.admin-row', 1, 'Owner tools: Projects'],
    [o, '/admin/?tab=invites', '.admin-row', 1, 'Owner tools: Invites'],
    [o, '/admin/?tab=users', '.admin-user', 0, 'Owner tools: Users'],
    [o, '/admin/?tab=audit', '.admin-row, .admin__empty', 1, 'Owner tools: Audit'],
    [a, '/?me', '.card--mine', 0, 'My projects'],
    [a, '/?community', '.card--community', 0, 'Community'],
    [a, '/?account', '.account-section', 0, 'Account'],
    [m, '/?review', '.review-card', 0, 'Review: Queue'],
    [m, '/?review&tab=gallery', '.review-card', 0, 'Review: Gallery'],
    [m, '/?review&tab=reports', '.review-card, .review__empty', 0, 'Review: Reports'],
    [m, '/?review&tab=history', '.review-history__item, .review__empty', 0, 'Review: History'],
  ];
  for (const [b, path, ready, main, name] of pages) {
    await open(b, path, ready);
    await b.page.waitForTimeout(400);
    const fonts = await fontsOf(b.page);
    const old = fonts.families.filter(([f]) => OLD_FONTS.test(f));
    t.ok(old.length === 0 && /Familjen Grotesk/.test(fonts.h1 ?? ''), `${name}: no old font on the page, the title in Familjen Grotesk (${show(old)} ${fonts.h1})`);
    if (fonts.meta) t.ok(/Martian Mono/.test(fonts.meta), `${name}: its values are in Martian Mono (${fonts.meta})`);
    const pol = await polishOf(b.page);
    t.ok(pol.dots === 0 && pol.words === 0 && pol.values === 0, `${name}: meta lines have no dots, phrases are in Familjen Grotesk and values in Martian Mono (${show(pol)})`);
    t.ok(pol.foot.length === 1 && pol.foot[0].links === 'Privacy,Terms,Report content' && pol.foot[0].version && pol.foot[0].last, `${name}: the one shared foot closes the page (${show(pol.foot)})`);
    const orange = await orangeOf(b.page);
    t.ok(orange.length <= main, `${name}: orange is the one main action only (${show(orange)})`);
    t.ok(!b.errors.length, `${name}: no page errors${b.errors.length ? `: ${b.errors.join(' | ')}` : ''}`);
  }
}

async function phone(server, browser, t) {
  const o = await browserFor(browser, server.base, 'boss', { width: 390, height: 844 });
  try {
    for (const [path, ready, name] of [
      ['/admin/', '.admin-row', 'Owner tools'],
      ['/admin/?tab=users', '.admin-user', 'Users'],
      ['/?me', '.card--mine', 'My projects'],
      ['/?community', '.card--community', 'Community'],
      ['/?account', '.account-section', 'Account'],
      ['/?review', '.review-card', 'Review'],
    ]) {
      await open(o, path, ready);
      await o.page.waitForTimeout(400);
      const n = await navOf(o.page);
      const over = await overflowing(o.page);
      t.ok(over <= 0, `${name} at 390px: no sideways scroll (${over}px over)`);
      t.ok(n.logo?.left === 16 || n.logo?.left <= 16, `${name} at 390px: the row keeps the logotype at the left, 16px in (${show(n.logo)})`);
      if (name === 'Owner tools') {
        // The switches on one line, the actions and the trash together on the next, the trash at the right end.
        const rows = await o.page.evaluate(() =>
          [...document.querySelectorAll('.admin-row')].map((r) => {
            const top = (e) => Math.round(e.getBoundingClientRect().top);
            const sw = [...r.querySelectorAll('.admin-row__vis, .admin-row__tpl')];
            const bt = [...r.querySelectorAll('.admin-row__buttons > *')];
            const del = r.querySelector('.admin-row__delete');
            return {
              switchesOneLine: new Set(sw.map(top)).size === 1,
              buttonsOneLine: new Set(bt.map(top)).size === 1,
              below: top(bt[0]) > top(sw[0]),
              trashEnd: !!del && del.getBoundingClientRect().right >= r.querySelector('.admin-row__actions').getBoundingClientRect().right - 1,
            };
          }),
        );
        t.ok(rows.length > 0 && rows.every((r) => r.switchesOneLine && r.buttonsOneLine && r.below && r.trashEnd), `Owner tools at 390px: the switches on one line, the actions and the trash together below (${show(rows)})`);
      }
      if (name === 'Users') {
        const roles = await o.page.evaluate(() =>
          [...document.querySelectorAll('.admin-user')].map((u) => ({
            chip: u.querySelector('.admin-user__role')?.textContent ?? null,
            role: u.dataset.role,
            plain: [...u.querySelectorAll('.admin-row__actions > *')].filter((e) => e.tagName !== 'BUTTON').length,
          })),
        );
        t.ok(roles.length > 0 && roles.every((r) => r.plain === 0 && (r.role === 'member' ? r.chip === null : r.chip === r.role)), `Users at 390px: the role once, as a chip beside the handle, none for a member (${show(roles)})`);
      }
    }
  } finally {
    await o.ctx.close();
  }
}

export const suites = {
  async pages(page, base, t) {
    const browser = page.context().browser();
    let server = null;
    try {
      server = await startAccountsServer({ dist: resolve('dist'), seed: seed(Date.now()) });
    } catch (err) {
      t.ok(false, `the Functions did not start: ${err?.message ?? err}`);
      return;
    }
    const open2 = [];
    const as = async (who) => {
      const b = await browserFor(browser, server.base, who);
      open2.push(b);
      return b;
    };
    const part = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        t.ok(false, `${name} threw: ${e?.stack ?? e}`);
      }
    };
    try {
      const o = await as('boss');
      const m = await as('mo');
      const a = await as('ada');
      const g = await as(null);
      await part('the navigation row', () => navRows(server, o, m, a, g, t));
      await part('delete is a trash icon', () => trash(o, a, t));
      await part('orange and the fonts', () => colourAndType(o, m, a, t));
      await part('a phone', () => phone(server, browser, t));
    } finally {
      for (const x of open2) await x.ctx.close().catch(() => {});
      await server.close();
    }
  },
};
