// The community suite (docs/accounts.md §13), against the real Functions
// (startAccountsServer, as the accounts suite runs them) at
// http://localhost:<port>. The accounts are seeded, each with a session
// whose cookie its browser is handed (seedSession / seededToken), so no
// sign-in is played here: the accounts suite plays those.
//
// The path: the owner makes @mo a moderator from the Users tab (Make
// moderator, asked first; the owner's own row offers none); @ada makes a
// model with the uploader and shares it from My projects (the first-share
// note, Continue) - Pending review; @mo's Review chip counts 1, the Queue
// has the card, Open shows it in the viewer in review mode, Approve; the
// Community and @ada's page list it, the viewer says "by @ada", and for
// @bea Report…; @bea reports (reason and note) and is thanked; @cy's report
// hides it - Hidden in @ada's My projects, gone from the Community; the
// Reports tab has both reports, Unhide brings it back; a guest sees no
// Report and no Share; @mo's viewer has a Review chip beside the credit,
// @bea's and a guest's none; the owner shares their own model (public at
// once, no queue), finds it in the Gallery tab (the search narrows the
// list, the address and a reload keep it), hides and unhides it; @ada
// renames hers - Pending again; unticking the one Share switch takes it
// out everywhere and the Queue is empty; the History tab has what was
// done; a plain member opening /?review is sent to the gallery.
import { resolve } from 'node:path';
import { startAccountsServer } from './lib.mjs';
import { DATA_ONE_FRAME, seedSession, seedUser, seededToken } from '../functions/lib.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const DAY = 24 * 60 * 60 * 1000;
const show = (o) => JSON.stringify(o);

const PEOPLE = {
  boss: { id: 'u-boss', handle: 'boss', email: 'owner@example.com', role: 'owner', ip: '203.0.113.40' },
  ada: { id: 'u-ada', handle: 'ada', email: 'ada@example.com', ip: '203.0.113.41' },
  bea: { id: 'u-bea', handle: 'bea', email: 'bea@example.com', ip: '203.0.113.42' },
  cy: { id: 'u-cy', handle: 'cy', email: 'cy@example.com', ip: '203.0.113.43' },
  mo: { id: 'u-mo', handle: 'mo', email: 'mo@example.com', ip: '203.0.113.44' },
};

/** The owner's own model, seeded. */
const BOSS_WORK = 'p-bossbust00000000000000000';

function seed(now) {
  const rows = [];
  for (const [name, u] of Object.entries(PEOPLE)) {
    rows.push(seedUser({ id: u.id, handle: u.handle, email: u.email, role: u.role ?? 'member', at: now - DAY }));
    rows.push(seedSession({ name, id: `s-${name}`, user: u.id, created: now - 60_000 }));
  }
  // The owner's own model, not shared yet: the owner shares it from My projects.
  rows.push(
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
     VALUES ('${BOSS_WORK}', 'Boss bust', 'model', 4, '${DATA_ONE_FRAME}', 'private', 0, 'u-boss', 'users/u-boss/projects/${BOSS_WORK}/', ${now - DAY}, ${now - DAY});`,
  );
  return rows.join('\n');
}

/**
 * A browser for one of PEOPLE (or a guest, `who` null): its session's
 * cookie, its own address for the rate limits, and for the owner the
 * header Cloudflare Access adds on /admin/. Confirmations are accepted.
 */
async function browserFor(browser, origin, who) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  const person = who ? PEOPLE[who] : null;
  if (person) {
    await ctx.addCookies([
      { name: '__Host-bz_session', value: seededToken(who), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    ]);
  }
  await ctx.route(
    (url) => url.origin === origin && /^\/(api|admin\/api)\//.test(url.pathname),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const headers = { ...(await req.allHeaders()), 'cf-connecting-ip': person?.ip ?? '203.0.113.49' };
      if (person?.role === 'owner' && path.startsWith('/admin/api/')) headers['cf-access-authenticated-user-email'] = 'owner@example.com';
      await route.continue({ headers });
    },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  return { ctx, page, errors, origin, who };
}

const go = (b, query) => b.page.goto(`${b.origin}/${query}`, { waitUntil: 'domcontentloaded' });
const waitFor = (p, fn, arg, timeout = 20_000) => p.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);

/** The Community's cards, as drawn: [{id, author, title}]. */
async function communityCards(b, query = '?community') {
  await go(b, query);
  await b.page.waitForSelector('.card--community, .community__empty, .community__missing', { timeout: 30_000 }).catch(() => {});
  return b.page.evaluate(() =>
    [...document.querySelectorAll('.card--community')].map((c) => ({ id: c.dataset.project, author: c.dataset.author, title: c.querySelector('.card__title')?.textContent })),
  );
}

/** My projects, drawn, and one card's share line. */
async function myCard(b, id) {
  await go(b, '?me');
  await b.page.waitForSelector(`.card--mine[data-project="${id}"] .card__share`, { timeout: 30_000 }).catch(() => {});
  return shareOf(b, id);
}

const shareOf = (b, id) =>
  b.page.evaluate((pid) => {
    const s = document.querySelector(`.card--mine[data-project="${pid}"] .card__share`);
    return s ? { shared: s.dataset.shared, status: s.querySelector('.card__share-status')?.textContent ?? '', on: s.querySelector('.card__share-switch input')?.checked } : null;
  }, id);

/** The Review chip, once the page has drawn its chips: {shown, count}. */
async function reviewChip(b, query = '') {
  await go(b, query);
  const shown = await waitFor(b.page, () => !!document.querySelector('.topbar--right .review-chip'));
  if (shown) await b.page.waitForSelector('.review-chip__count', { timeout: 5000 }).catch(() => {});
  return b.page.evaluate(() => ({ shown: !!document.querySelector('.review-chip'), count: document.querySelector('.review-chip__count')?.textContent ?? null }));
}

/** A Review tab, drawn: its cards [{id, shared, state, actions}] (or, on History, its lines). */
async function reviewTab(b, tab) {
  await go(b, `?review&tab=${tab}`);
  await b.page.waitForSelector('.review-card, .review__empty, .review-history__item, .review__say:not(:empty)', { timeout: 30_000 }).catch(() => {});
  return b.page.evaluate(() => ({
    current: document.querySelector('.review-tab[aria-current=page]')?.dataset.tab ?? null,
    cards: [...document.querySelectorAll('.review-card')].map((c) => ({
      id: c.dataset.project,
      shared: c.dataset.shared,
      state: c.querySelector('.review-card__state')?.textContent ?? '',
      author: c.querySelector('.card__author')?.textContent ?? '',
      reports: c.querySelector('.review-card__reports')?.textContent ?? '',
      lines: [...c.querySelectorAll('.review-report')].map((r) => r.textContent),
      actions: [...c.querySelectorAll('.review-action')].map((x) => x.textContent),
    })),
    history: [...document.querySelectorAll('.review-history__item')].map((li) => ({ action: li.dataset.action, text: li.textContent })),
    empty: document.querySelector('.review__empty')?.textContent ?? null,
  }));
}

/** The viewer's top row, left: what its chips say. */
const viewerRow = (p) =>
  p.evaluate(() => ({
    chips: [...document.querySelectorAll('.topbar--left .topchip')].map((c) => c.textContent.trim()),
    author: document.querySelector('.viewer-author')?.textContent ?? null,
    authorHref: document.querySelector('.viewer-author')?.getAttribute('href') ?? null,
    report: !!document.querySelector('.viewer-report'),
    mode: document.querySelector('.review-mode')?.dataset.shared ?? null,
    actions: [...document.querySelectorAll('.review-action')].map((c) => c.dataset.action),
    back: document.querySelector('.review-back')?.getAttribute('href') ?? null,
  }));

/** The viewer on a project, drawn (the canvas up and the overlay gone). */
async function viewer(b, id, extra = '') {
  const t0 = Date.now();
  await go(b, `?tl=${id}${extra}`);
  const ok = await b.page.waitForFunction(() => !document.querySelector('#overlay') || document.querySelector('#overlay.overlay--error'), null, { timeout: 60_000 }).then(() => true, () => false);
  const msg = await b.page.evaluate(() => document.querySelector('#overlay .overlay__msg')?.textContent ?? null);
  if (process.env.E2E_DEBUG) console.log(`viewer ${b.who} ${extra}: ${ok} ${Date.now() - t0} ms, ${msg}, ${await b.page.evaluate(() => document.querySelector('.topbar--left')?.textContent)}`);
  return msg;
}

// --- the parts --------------------------------------------------------------------------

/** The owner makes @mo a moderator from the Users tab. */
async function makeModerator(o, t) {
  const p = o.page;
  await go(o, 'admin/?tab=users');
  await p.waitForSelector('.admin-user[data-user="u-mo"]', { timeout: 30_000 }).catch(() => {});
  const row = (id) =>
    p.evaluate((uid) => {
      const r = document.querySelector(`.admin-user[data-user="${uid}"]`);
      const b = r?.querySelector('.admin-user__setrole');
      return r ? { role: r.dataset.role, col: r.querySelector('.admin-user__rolecol')?.textContent, action: b && !b.hidden ? b.textContent : null, said: r.querySelector('.admin-user__rolesay')?.textContent ?? '' } : null;
    }, id);
  const before = await row('u-mo');
  const own = await row('u-boss');
  t.ok(before?.col === 'Member' && before.action === 'Make moderator', `the Users tab has a role column, and Make moderator for a member (${show(before)})`);
  t.ok(own?.col === 'Owner' && own.action === null, `the owner's own row offers no role action (${show(own)})`);
  await p.click('.admin-user[data-user="u-mo"] .admin-user__setrole');
  await waitFor(p, () => document.querySelector('.admin-user[data-user="u-mo"]')?.dataset.role === 'moderator');
  const after = await row('u-mo');
  t.ok(after?.col === 'Moderator' && after.action === 'Make member' && /is a moderator now/.test(after.said), `Make moderator, confirmed, makes @mo a moderator, and offers Make member (${show(after)})`);
}

/** @ada makes a one-frame model with the uploader; its id. */
async function makeModel(a, t) {
  const p = a.page;
  await go(a, 'create/');
  await p.waitForSelector('#save-project', { timeout: 30_000 });
  await p.fill('#f-title', 'Ada torso');
  await p.selectOption('#f-mode', 'model');
  await p.setInputFiles('#files', [resolve('dist/timelapses/demo/frames/sd/0000.glb')]);
  await p.waitForFunction(() => !document.querySelector('#save-project').disabled, null, { timeout: 90_000 });
  await Promise.all([p.waitForURL((u) => u.searchParams.has('me'), { timeout: 90_000 }).catch(() => {}), p.click('#save-project')]);
  const list = await p.evaluate(async () => (await fetch('/api/me/projects')).json());
  const made = list.find((x) => x.title === 'Ada torso');
  t.ok(!!made && made.mode === 'model' && made.shared === 'none', `@ada has a model in My projects, not shared (${show(made && { id: made.id, mode: made.mode, shared: made.shared })})`);
  return made?.id ?? '';
}

/** Share it from My projects: the first-share note, Continue, Pending review. */
async function share(a, id, t) {
  const p = a.page;
  const before = await myCard(a, id);
  t.ok(before?.shared === 'none' && before.on === false, `its card has Share to Community, off (${show(before)})`);
  await p.click(`.card--mine[data-project="${id}"] .card__share-switch input`);
  t.ok(await waitFor(p, () => !!document.querySelector('.share-note-overlay')), 'the first share shows the note');
  await p.click('.share-note-continue');
  await waitFor(p, (pid) => document.querySelector(`.card--mine[data-project="${pid}"] .card__share`)?.dataset.shared === 'pending', id);
  const now = await shareOf(a, id);
  t.ok(now?.shared === 'pending' && now.status === 'Pending review' && now.on, `Continue shares it: Pending review (${show(now)})`);
}

/** @mo: the chip counts it, the Queue has it, Open is review mode, Approve. */
async function approve(m, id, t) {
  const p = m.page;
  const chip = await reviewChip(m);
  t.ok(chip.shown && chip.count === '1', `@mo's top row has Review, counting 1 (${show(chip)})`);
  const q = await reviewTab(m, 'queue');
  const card = q.cards.find((c) => c.id === id);
  t.ok(
    q.current === 'queue' && q.cards.length === 1 && card?.shared === 'pending' && card.author === '@ada' && show(card.actions) === show(['Approve', 'Reject…']),
    `the Queue has it, by @ada, with Approve and Reject… (${show(q)})`,
  );
  await Promise.all([p.waitForURL((u) => u.searchParams.get('review') === '1', { timeout: 30_000 }).catch(() => {}), p.click(`.review-card[data-project="${id}"] .review-open`)]);
  await viewer(m, id, '&review=1');
  await waitFor(p, () => !!document.querySelector('.review-action'));
  let row = await viewerRow(p);
  t.ok(
    row.mode === 'pending' && row.author === 'by @ada' && show(row.actions) === show(['approve', 'reject']) && row.back === '/?review&tab=queue' && !row.report,
    `Open shows it in the viewer in review mode: Reviewing, by @ada, Approve and Reject…, ← Review (${show(row)})`,
  );
  await p.click('.review-action[data-action="approve"]');
  await waitFor(p, () => document.querySelector('.review-mode')?.dataset.shared === 'public');
  row = await viewerRow(p);
  t.ok(row.mode === 'public' && show(row.actions) === show(['hide']), `Approve makes it public; Hide… is offered now (${show(row)})`);
  await rest(m);
}

/** Off the viewer: a software renderer drawing in one page slows every other. */
const rest = (b) => b.page.goto('about:blank');

/** The Community, @ada's page and the viewer show it; @bea gets Report… and reports. */
async function listedAndReported(server, b, g, id, t) {
  const cards = await communityCards(g);
  t.ok(cards.some((c) => c.id === id && c.author === 'ada' && c.title === 'Ada torso'), `the Community lists it with @ada (${show(cards)})`);
  const author = await communityCards(g, '?u=ada');
  t.ok(author.some((c) => c.id === id), `and @ada's page (${show(author)})`);
  await viewer(g, id);
  await waitFor(g.page, () => !!document.querySelector('.viewer-author'));
  let row = await viewerRow(g.page);
  await rest(g);
  t.ok(row.author === 'by @ada' && row.authorHref === '/?u=ada' && !row.report, `a guest's viewer says by @ada, and offers no Report (${show(row)})`);
  await go(g, '?me');
  await g.page.waitForSelector('.my-projects__body button, .my-projects__body p', { timeout: 30_000 }).catch(() => {});
  t.ok(await g.page.evaluate(() => !document.querySelector('.card__share')), 'nor Share: a guest has no projects to share');

  const p = b.page;
  await viewer(b, id);
  await waitFor(p, () => !!document.querySelector('.viewer-report'));
  row = await viewerRow(p);
  t.ok(row.author === 'by @ada' && row.report, `@bea's viewer says by @ada and offers Report… (${show(row)})`);
  await p.click('.viewer-report');
  await p.waitForSelector('.report-overlay', { timeout: 10_000 });
  const reasons = await p.evaluate(() => {
    const sel = document.querySelector('.report-overlay select[name=reason]');
    return { value: sel?.value, labels: [...(sel?.options ?? [])].map((o) => o.textContent) };
  });
  t.ok(
    reasons.value === 'other' &&
      show(reasons.labels) === show(["Someone else's work", 'Spam or advertising', 'Sexual or pornographic content', 'Involves a minor', 'Something else']),
    `the dialog starts at Something else, the reasons in order (${show(reasons)})`,
  );
  await p.selectOption('.report-overlay select[name=reason]', 'stolen');
  await p.fill('.report-overlay textarea[name=note]', 'This is from a museum catalogue');
  await p.click('.report-send');
  await waitFor(p, () => /Thank you/.test(document.querySelector('.report-say')?.textContent ?? ''));
  const said = await p.evaluate(() => document.querySelector('.report-say')?.textContent ?? '');
  t.eq(said, 'Thank you. A reviewer will look at it.', '@bea reports it, and is thanked');
  await rest(b);
}

/** @cy's report hides it: Hidden in @ada's My projects, gone from the Community. */
async function hiddenByReports(server, a, c, g, id, t) {
  // Through the route, as the page's dialog sends it: @bea's played the dialog.
  await go(c, '');
  const reported = await c.page.evaluate(
    (pid) => fetch(`/api/community/${pid}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'spam' }) }).then((r) => r.status),
    id,
  );
  t.eq(reported, 204, "@cy's report is taken");
  const mine = await myCard(a, id);
  t.ok(mine?.shared === 'hidden' && mine.status === 'Hidden, under review', `two reports hide it: Hidden in @ada's My projects (${show(mine)})`);
  const cards = await communityCards(g);
  t.ok(!cards.some((x) => x.id === id), `and it is gone from the Community (${show(cards)})`);
}

/** @mo: the Reports tab has it, hidden, with both reports; Unhide brings it back. */
async function unhide(m, g, id, t) {
  const chip = await reviewChip(m);
  t.eq(chip.count, '1', "the chip counts the project with open reports");
  const r = await reviewTab(m, 'reports');
  const card = r.cards.find((c) => c.id === id);
  t.ok(
    r.current === 'reports' &&
      card?.shared === 'hidden' &&
      /^Hidden/.test(card.state) &&
      card.reports === '2 open reports' &&
      card.lines.some((l) => /Someone else's work · @bea/.test(l) && /museum catalogue/.test(l)) &&
      card.lines.some((l) => /Spam or advertising · @cy/.test(l)) &&
      show(card.actions) === show(['Unhide']),
    `the Reports tab has it, hidden, with both reports, who made them and the note, and Unhide (${show(card)})`,
  );
  await m.page.click(`.review-card[data-project="${id}"] .review-action[data-action="unhide"]`);
  await waitFor(m.page, (pid) => document.querySelector(`.review-card[data-project="${pid}"]`)?.dataset.shared === 'public', id);
  const after = await m.page.evaluate((pid) => {
    const c = document.querySelector(`.review-card[data-project="${pid}"]`);
    return { shared: c?.dataset.shared, said: c?.querySelector('.review-card__say')?.textContent, reports: c?.querySelector('.review-card__reports')?.textContent, actions: [...(c?.querySelectorAll('.review-action') ?? [])].map((x) => x.textContent) };
  }, id);
  t.ok(after.shared === 'public' && /back in the Community/.test(after.said ?? '') && after.reports === 'No open reports now.' && show(after.actions) === show(['Hide…']), `Unhide redraws the card from the answer (${show(after)})`);
  const cards = await communityCards(g);
  t.ok(cards.some((x) => x.id === id), 'and it is back in the Community');
}

/** @ada renames it (Pending again), then withdraws it (gone everywhere); the Queue empties. */
async function renameAndWithdraw(a, m, g, id, t) {
  const p = a.page;
  await myCard(a, id);
  await p.click(`.card--mine[data-project="${id}"] .card__rename`);
  await p.fill(`.card--mine[data-project="${id}"] .my-rename input[name=title]`, 'Ada torso, reworked');
  await p.click(`.card--mine[data-project="${id}"] .card__save`);
  await waitFor(p, (pid) => document.querySelector(`.card--mine[data-project="${pid}"] .card__share`)?.dataset.shared === 'pending', id);
  const renamed = await shareOf(a, id);
  t.ok(renamed?.shared === 'pending' && renamed.status === 'Pending review', `a rename sends it back for review (${show(renamed)})`);
  const cards = await communityCards(g);
  t.ok(!cards.some((x) => x.id === id), 'and out of the Community meanwhile');
  const q = await reviewTab(m, 'queue');
  t.ok(q.cards.some((c) => c.id === id && c.shared === 'pending'), `it is in the Queue again (${show(q.cards)})`);

  await myCard(a, id);
  const one = await p.evaluate((pid) => {
    const c = document.querySelector(`.card--mine[data-project="${pid}"]`);
    return { withdraw: !!c?.querySelector('.card__share-withdraw'), again: !!c?.querySelector('.card__share-again'), switches: c?.querySelectorAll('.card__share-switch input').length };
  }, id);
  t.ok(!one.withdraw && !one.again && one.switches === 1, `the card has the one switch, no Withdraw or Share again (${show(one)})`);
  // Unticking the switch withdraws it.
  await p.click(`.card--mine[data-project="${id}"] .card__share-switch input`);
  await waitFor(p, (pid) => document.querySelector(`.card--mine[data-project="${pid}"] .card__share`)?.dataset.shared === 'none', id);
  const out = await shareOf(a, id);
  t.ok(out?.shared === 'none' && out.on === false, `unticking Share to Community takes it out (${show(out)})`);
  const empty = await reviewTab(m, 'queue');
  t.ok(empty.cards.length === 0 && empty.empty === 'Nothing is waiting for review.', `the Queue is empty (${show(empty)})`);
  const chip = await reviewChip(m);
  t.ok(chip.shown && chip.count === null, `the chip counts nothing (${show(chip)})`);
  // Not found: the test build looks for a bundled copy next, which the
  // server answers with the app's page, so the words vary; nothing opens.
  const nothing = async (b, extra) => {
    const msg = await viewer(b, id, extra);
    const seen = await viewerRow(b.page);
    await rest(b);
    return { msg, ok: /^Could not load project/.test(msg ?? '') && !seen.author && !seen.mode };
  };
  const guest = await nothing(g, '');
  t.ok(guest.ok, `a guest's viewer opens nothing (${guest.msg})`);
  const reviewing = await nothing(m, '&review=1');
  t.ok(reviewing.ok, `nor review mode, once it is not shared (${reviewing.msg})`);
  const h = await reviewTab(m, 'history');
  const actions = h.history.map((x) => x.action);
  t.ok(
    h.current === 'history' && actions[0] === 'withdraw' && actions.includes('unhide') && actions.includes('hide') && actions.includes('approve') &&
      h.history.some((x) => x.action === 'approve' && /by @mo/.test(x.text) && /by @ada/.test(x.text)) &&
      h.history.some((x) => x.action === 'hide' && /members' reports/.test(x.text)),
    `the History tab has what was done, newest first (${show(actions)})`,
  );
}

/** The viewer's Review chip: a reviewer has it beside the credit, a member and a guest do not. */
async function viewerReviewChip(m, b, g, id, t) {
  await viewer(m, id);
  const shown = await waitFor(m.page, () => !!document.querySelector('.viewer-review'));
  const seen = await m.page.evaluate(() => {
    const chip = document.querySelector('.viewer-review');
    return { href: chip?.getAttribute('href') ?? null, after: chip?.previousElementSibling?.classList.contains('viewer-author') ?? false };
  });
  await rest(m);
  t.ok(shown && seen.href === `/?tl=${id}&review=1&from=gallery` && seen.after, `@mo's viewer has Review beside the credit, to review mode from the Gallery (${show(seen)})`);
  for (const x of [b, g]) {
    await viewer(x, id);
    await waitFor(x.page, () => !!document.querySelector('.viewer-author'));
    // The credit's own checks (accounts on, /api/me) come after the credit: give them their time.
    if (x.who) await waitFor(x.page, () => !!document.querySelector('.viewer-report'));
    const none = await x.page.evaluate(() => !document.querySelector('.viewer-review'));
    await rest(x);
    t.ok(none, `${x.who ? `@${x.who}, a member,` : 'a guest'} has no Review chip in the viewer`);
  }
}

/** The owner shares their own work (public at once), then hides and unhides it from the Gallery tab; the search narrows it. */
async function ownerGallery(o, m, g, t) {
  const p = o.page;
  const before = await myCard(o, BOSS_WORK);
  t.ok(before?.shared === 'none' && before.on === false, `the owner's model, not shared (${show(before)})`);
  await p.click(`.card--mine[data-project="${BOSS_WORK}"] .card__share-switch input`);
  await waitFor(p, () => !!document.querySelector('.share-note-overlay'));
  const note = await p.evaluate(() => document.querySelector('.share-note-overlay')?.textContent ?? '');
  t.ok(/goes public in the Community at once/.test(note), `the owner's first-share note says it goes public at once (${note.slice(0, 80)}…)`);
  await p.click('.share-note-continue');
  await waitFor(p, (pid) => document.querySelector(`.card--mine[data-project="${pid}"] .card__share`)?.dataset.shared === 'public', BOSS_WORK);
  const now = await shareOf(o, BOSS_WORK);
  t.ok(now?.shared === 'public' && now.status === 'Public · Community' && now.on, `the owner's share is public at once, no queue (${show(now)})`);
  const listed = await communityCards(g);
  t.ok(listed.some((c) => c.id === BOSS_WORK && c.author === 'boss'), `and in the Community (${show(listed)})`);

  const tab = await reviewTab(o, 'gallery');
  const own = tab.cards.find((c) => c.id === BOSS_WORK);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.review-tab')].map((a) => a.dataset.tab));
  t.ok(show(tabs) === show(['queue', 'gallery', 'reports', 'history']) && tab.current === 'gallery', `the Gallery tab, after Queue (${show(tabs)})`);
  t.ok(tab.cards.length === 2 && own?.shared === 'public' && own.author === '@boss' && show(own.actions) === show(['Hide…']), `it lists the Community, the owner's own work with Hide… (${show(tab.cards)})`);
  const intro = await p.evaluate(() => document.querySelector('.landing__tagline')?.textContent ?? '');
  t.ok(/the owner reviews everything/.test(intro), `the page says the owner reviews everything (${intro})`);

  await p.fill('.review-search', 'boss');
  await waitFor(p, () => document.querySelectorAll('.review-card').length === 1 && /[?&]q=boss/.test(location.search));
  let seen = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.review-card')].map((c) => c.dataset.project), search: location.search }));
  t.ok(show(seen.cards) === show([BOSS_WORK]) && seen.search === '?review&tab=gallery&q=boss', `the search narrows it, and the address keeps it (${show(seen)})`);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.review-card', { timeout: 30_000 }).catch(() => {});
  seen = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.review-card')].map((c) => c.dataset.project), q: document.querySelector('.review-search')?.value }));
  t.ok(show(seen.cards) === show([BOSS_WORK]) && seen.q === 'boss', `a reload keeps the search (${show(seen)})`);
  await p.fill('.review-search', '@ada');
  await waitFor(p, (bw) => document.querySelectorAll('.review-card').length === 1 && !document.querySelector(`.review-card[data-project="${bw}"]`), BOSS_WORK);
  seen = await p.evaluate(() => [...document.querySelectorAll('.review-card .card__author')].map((a) => a.textContent));
  t.ok(show(seen) === show(['@ada']), `@ada: her work alone (${show(seen)})`);
  await p.fill('.review-search', '');
  await waitFor(p, () => document.querySelectorAll('.review-card').length === 2);

  await p.click(`.review-card[data-project="${BOSS_WORK}"] .review-action[data-action="hide"]`);
  await p.waitForSelector('.review-reason-overlay', { timeout: 10_000 });
  await p.fill('.review-reason-overlay textarea[name=reason]', 'A test of my own');
  await p.click('.review-reason-send');
  await waitFor(p, (bw) => document.querySelector(`.review-card[data-project="${bw}"]`)?.dataset.shared === 'hidden', BOSS_WORK);
  let card = await p.evaluate((bw) => {
    const c = document.querySelector(`.review-card[data-project="${bw}"]`);
    return { shared: c?.dataset.shared, state: c?.querySelector('.review-card__state')?.textContent, actions: [...(c?.querySelectorAll('.review-action') ?? [])].map((x) => x.textContent), own: !!c?.querySelector('.review-card__own') };
  }, BOSS_WORK);
  t.ok(card.shared === 'hidden' && card.state === 'Hidden: A test of my own' && show(card.actions) === show(['Unhide']) && !card.own, `the owner hides their own work, marked hidden, with Unhide (${show(card)})`);
  await p.selectOption('.review-filter', 'hidden');
  await waitFor(p, () => document.querySelectorAll('.review-card').length === 1 && /state=hidden/.test(location.search));
  const hiddenOnly = await p.evaluate(() => [...document.querySelectorAll('.review-card')].map((c) => c.dataset.project));
  t.eq(show(hiddenOnly), show([BOSS_WORK]), 'the Hidden filter lists it alone');
  await p.click(`.review-card[data-project="${BOSS_WORK}"] .review-action[data-action="unhide"]`);
  await waitFor(p, (bw) => document.querySelector(`.review-card[data-project="${bw}"]`)?.dataset.shared === 'public', BOSS_WORK);
  card = await p.evaluate((bw) => document.querySelector(`.review-card[data-project="${bw}"]`)?.dataset.shared, BOSS_WORK);
  t.eq(card, 'public', 'and unhides it');

  // A moderator's Gallery: the owner's work is not theirs, so they may act on it.
  const mt = await reviewTab(m, 'gallery');
  const forMo = mt.cards.find((c) => c.id === BOSS_WORK);
  t.ok(forMo?.shared === 'public' && show(forMo.actions) === show(['Hide…']), `@mo's Gallery lists it too, with Hide… (${show(forMo)})`);
}

/** A plain member opening /?review is sent to the gallery, which says why; no Review chip. */
async function notAReviewer(b, t) {
  await go(b, '?review');
  await b.page.waitForSelector('.review-refused', { timeout: 30_000 }).catch(() => {});
  const seen = await b.page.evaluate(() => ({
    search: location.search,
    note: document.querySelector('.review-refused')?.textContent ?? null,
    grid: !!document.querySelector('#landing-grid'),
    chip: !!document.querySelector('.review-chip'),
  }));
  t.ok(seen.search === '' && seen.grid && !!seen.note && !seen.chip, `a member opening /?review gets the gallery, with a note, and has no Review chip (${show(seen)})`);
}

export const suites = {
  async community(page, base, t) {
    const browser = page.context().browser();
    let server = null;
    try {
      server = await startAccountsServer({ dist: resolve('dist'), seed: seed(Date.now()) });
    } catch (err) {
      t.ok(false, `the accounts server started: ${err?.message ?? err}`);
      return;
    }
    const part = async (name, fn) => {
      const t0 = Date.now();
      try {
        await fn();
        if (process.env.E2E_DEBUG) console.log(`${name}: ${Date.now() - t0} ms`);
      } catch (e) {
        t.ok(false, `${name} threw: ${e?.stack ?? e}`);
      }
    };
    const open = [];
    const as = async (who) => {
      const b = await browserFor(browser, server.base, who);
      open.push(b);
      return b;
    };
    try {
      const o = await as('boss');
      const a = await as('ada');
      const b = await as('bea');
      const c = await as('cy');
      const m = await as('mo');
      const g = await as(null);
      let id = '';
      await part('make a moderator', () => makeModerator(o, t));
      await part('a model', async () => {
        id = await makeModel(a, t);
      });
      await part('share', () => share(a, id, t));
      await part('approve', () => approve(m, id, t));
      await part('listed and reported', () => listedAndReported(server, b, g, id, t));
      await part('the viewer\'s Review chip', () => viewerReviewChip(m, b, g, id, t));
      await part('hidden by reports', () => hiddenByReports(server, a, c, g, id, t));
      await part('unhide', () => unhide(m, g, id, t));
      await part('the owner reviews their own, from the Gallery tab', () => ownerGallery(o, m, g, t));
      await part('rename and withdraw', () => renameAndWithdraw(a, m, g, id, t));
      await part('not a reviewer', () => notAReviewer(b, t));
      await part('the owner reviews too', async () => {
        const chip = await reviewChip(o);
        t.ok(chip.shown, `the owner's top row has Review too (${show(chip)})`);
      });
      for (const x of open) t.ok(!x.errors.length, `no page errors in ${x.who ?? 'the guest'}'s browser${x.errors.length ? `: ${x.errors.join(' | ')}` : ''}`);
    } finally {
      for (const x of open) await x.ctx.close().catch(() => {});
      const log = server.log();
      await server.close();
      if (process.env.E2E_ACCOUNTS_LOG) console.log(log.split('\n').slice(-80).join('\n'));
    }
  },
};
