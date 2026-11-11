// The public viewer (`/?tl=<id>`) in the app's frame (src/viewer/viewerFrame.ts,
// docs/ui-spec.md): the quiet title strip (View and Help only, the title and
// what it is in the middle, Close and the hide button at the right), Render as
// the one folder tab with the viewer's own panel under it, the transport as the
// bar at the foot with the one orange play button, and none of the old top row,
// sideways tab or transport. The same at 390px, where nothing overlaps. Then
// a model, the owner's Edit in Present, a member's work (by @handle in the
// readout, Star and Report in the strip) and review mode (Close back to Review,
// the state in the readout, the decisive action filled), the last two over
// answers the page is given for the account routes (the real ones run in the
// community suite). Each gets (page, base, t).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORANGE = 'rgb(255, 90, 31)';
const RED = 'rgb(255, 64, 96)';
const BLACK = 'rgb(0, 0, 0)';
const STRIP = 'rgb(27, 27, 27)';

const ready = (page) => page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });

/** The demo timelapse's manifest as an API names it: frames root-absolute, plus what the caller adds. */
function projectJson(id, extra = {}) {
  const raw = JSON.parse(readFileSync(resolve('dist/timelapses/demo/manifest.json'), 'utf8'));
  return {
    ...raw,
    id,
    title: 'Old bust',
    mode: 'timelapse',
    visibility: 'public',
    units: null,
    presentation: null,
    frames: raw.frames.map((f) => ({ ...f, sd: `/timelapses/demo/${f.sd}` })),
    ...extra,
  };
}

/** Answer these routes with JSON, by path; anything not listed goes on to the server. */
async function answer(page, table) {
  await page.route(
    (url) => Object.keys(table).some((p) => url.pathname === p),
    (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const hit = table[path];
      const body = typeof hit === 'function' ? hit(req) : hit;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
}

/** Where things are in the strip, and what they look like. */
const stripState = (page) =>
  page.evaluate(() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
    const box = (el) => {
      if (!el || !shown(el)) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const strip = document.querySelector('.bz-strip');
    const css = (el, p) => (el ? getComputedStyle(el)[p] : null);
    const name = document.querySelector('.bz-readout__name');
    return {
      strip: strip ? { ...box(strip), bg: css(strip, 'backgroundColor'), pos: css(strip, 'position') } : null,
      menus: [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].map((m) => m.textContent),
      path: shown(document.querySelector('.bz-ws')),
      left: box(document.querySelector('.bz-strip__menus')),
      readout: box(document.querySelector('.bz-readout')),
      // What the readout shows: its visible parts only (the pairs a mode does not use are there, hidden).
      readoutText: [...document.querySelectorAll('.bz-readout__name, .bz-readout__by, .bz-readout__item')]
        .filter(shown)
        .map((e) => [...e.children].length ? [...e.children].map((c) => c.textContent).filter(Boolean).join(' ') : e.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      right: box(document.querySelector('.bz-strip__right')),
      title: name?.textContent ?? '',
      titleWeight: css(name, 'fontWeight'),
      buttons: [...document.querySelectorAll('.bz-strip__right > *')].filter(shown).map((b) => ({ text: b.textContent.trim() || b.getAttribute('aria-label'), cls: b.className, tag: b.tagName, bg: css(b, 'backgroundColor'), color: css(b, 'color') })),
      oldRow: [...document.querySelectorAll('.topbar, .topchip, .help-toggle')].filter(shown).map((c) => c.className),
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vw: innerWidth,
      vh: innerHeight,
    };
  });

/** The folder tabs and the panel, and the transport. */
const frameState = (page) =>
  page.evaluate(() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
    const box = (el) => {
      if (!el || !shown(el)) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const panel = document.querySelector('.panel--render');
    const handle = panel?.querySelector(':scope > .panel__handle');
    const bar = document.querySelector('.transport');
    const play = document.querySelector('.transport__play');
    const tabs = [...document.querySelectorAll('.panel > .panel__handle')].filter(shown);
    return {
      tabs: tabs.map((h) => h.querySelector('.handle__label').textContent.trim()),
      tab: box(handle),
      tabWriting: handle ? getComputedStyle(handle.querySelector('.handle__label')).writingMode : null,
      open: !!panel && !panel.classList.contains('panel--collapsed'),
      panelShown: shown(panel),
      panel: box(panel),
      heading: panel?.querySelector('.panel__title')?.textContent ?? null,
      byline: !!panel?.querySelector('.panel__byline'),
      sections: [...(panel?.querySelectorAll('.section > h3') ?? [])].filter(shown).map((h) => h.textContent),
      bar: box(bar),
      barClass: bar?.className ?? null,
      barBorderTop: bar ? getComputedStyle(bar).borderTopWidth : null,
      play: play ? { bg: getComputedStyle(play).backgroundColor, color: getComputedStyle(play).color, icon: getComputedStyle(play.querySelector('i')).color, label: play.getAttribute('aria-label') } : null,
      stageName: shown(document.querySelector('.transport__stage-name')),
      ticks: document.querySelectorAll('.transport__tick').length,
      orangeButtons: [...document.querySelectorAll('button, a')].filter((b) => shown(b) && getComputedStyle(b).backgroundColor === 'rgb(255, 90, 31)').map((b) => b.className),
    };
  });

/** A menu's rows: label, and its hotkey where it has one. */
const menuRows = (page, cls) =>
  page.evaluate((c) => [...document.querySelectorAll(`.${c} .file-menu__item`)].map((b) => `${b.querySelector('.file-menu__label')?.textContent ?? b.textContent}${b.querySelector('.file-menu__key') ? ` [${b.querySelector('.file-menu__key').textContent}]` : ''}`), cls);

const noOverlap = (a, b) => !!a && !!b && a.r <= b.l;

export const suites = {
  async viewerFrame(page, base, t) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.evaluate(() => window.__bozzetto.pause());
    await page.evaluate(() => window.__bozzetto.scrubTo(10));
    await page.waitForTimeout(500);

    // --- the strip: View and Help, the readout, Close and hide --------------------
    let s = await stripState(page);
    t.ok(s.strip && s.strip.h === 24 && s.strip.t === 0 && s.strip.w === s.vw && s.strip.bg === STRIP && s.strip.pos === 'fixed', `a 24px strip across the top, on the strip colour (${JSON.stringify(s.strip)})`);
    t.eq(s.menus.join(), 'View,Help', 'two menus at its left, View and Help: no File, no Edit');
    t.ok(!s.path, 'and no workspace path after them');
    t.ok(s.left && s.readout && s.right && noOverlap(s.left, s.readout) && noOverlap(s.readout, s.right), 'the menus, the readout and the right group do not overlap');
    t.eq(s.title, 'Demo bust (synthetic)', "the readout starts with the project's title");
    t.ok(Number(s.titleWeight) >= 600, `in bold (${s.titleWeight})`);
    const at = await page.evaluate(() => window.__bozzetto.timeline.stageAt(10)?.name ?? null);
    t.ok(/Timelapse 24 frames/.test(s.readoutText) && !!at && s.readoutText.endsWith(`Stage ${at}`), `then Timelapse 24 frames and the stage the frame is in (${s.readoutText})`);
    t.ok(!/ by @/.test(s.readoutText), 'with no author: the project is not a member\'s');
    t.eq(s.buttons.map((b) => b.text).join(), 'Close,Hide the interface', 'Close and the hide button at the right, nothing else for a visitor');
    const close = s.buttons[0];
    t.ok(close.tag === 'A' && close.cls.includes('viewer-back') && close.cls.includes('bz-strip__btn') && close.bg === 'rgba(0, 0, 0, 0)', `Close is a quiet strip link (${close.cls})`);
    t.eq(await page.getAttribute('.viewer-back', 'href'), '/', 'to the gallery');
    t.eq(s.oldRow.join(), '', `the old top row, "?" chip and theme chip are gone (${s.oldRow})`);
    // The stage's name once: in the readout, not with the transport as well.
    let f = await frameState(page);
    t.ok(!f.stageName, "the stage's name is not shown again with the transport");
    await page.evaluate(() => window.__bozzetto.scrubTo(23));
    await page.waitForFunction(() => /Surface Detail/.test(document.querySelector('.bz-readout')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
    s = await stripState(page);
    const at0 = await page.evaluate(() => window.__bozzetto.timeline.stageAt(23)?.name ?? null);
    await page.evaluate(() => window.__bozzetto.scrubTo(10));
    t.ok(!!at0 && s.readoutText.endsWith(`Stage ${at0}`) && at0 !== at, `the readout follows the frame to the stage there (${s.readoutText})`);

    // --- Render: the one folder tab, the viewer's own panel under it --------------
    t.eq(f.tabs.join(), 'Render', 'one folder tab, Render');
    t.ok(f.tab && f.tab.r === s.vw && f.tab.t === 28 && f.tab.h === 28 && f.tabWriting === 'horizontal-tb', `at the right edge under the strip, horizontal, not a sideways tab (${JSON.stringify(f.tab)} ${f.tabWriting})`);
    t.ok(!f.open && !f.panelShown, 'the panel is shut, as the viewer has it');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    f = await frameState(page);
    t.ok(f.open && f.panel && f.panel.w === 304 && f.panel.r === s.vw && f.panel.t === 56, `a click opens it: 304px, flush right, under the tab (${JSON.stringify(f.panel)})`);
    t.eq(f.heading, 'Render', 'headed Render');
    t.ok(!f.byline, 'with no byline: whose it is, is the strip\'s to say');
    t.ok(f.sections.includes('Material') && f.sections.includes('Lighting') && f.sections.includes('Interface'), `with the viewer's sections (${f.sections})`);
    t.ok(!f.sections.some((n) => /camera|environment|ambient/i.test(n)), `and not the editor's whole look (${f.sections})`);
    await page.click('.panel--render .panel__hotkeys');
    t.ok(await page.evaluate(() => !document.querySelector('.help-guide').hidden), 'its Hotkeys button still opens the guide');
    await page.keyboard.press('h');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    t.ok(!(await frameState(page)).open, 'the tab shuts it again');

    // --- the transport: the bar at the foot, play the orange action ----------------
    t.ok(f.barClass.includes('transport--shell') && f.bar && f.bar.b === s.vh && Math.abs((f.bar.l + f.bar.r) / 2 - s.vw / 2) <= 1 && f.bar.w <= 752 && f.barBorderTop === '0px', `the transport is the shell's bar, flush at the bottom centre (${JSON.stringify(f.bar)})`);
    t.ok(f.play.bg === ORANGE && f.play.color === BLACK && f.play.icon === BLACK, `its play button is orange with a black icon (${JSON.stringify(f.play)})`);
    t.eq(f.orangeButtons.join(), 'transport__play', `and it is the only orange button on the screen (${f.orangeButtons})`);
    t.eq(f.ticks, await page.evaluate(() => window.__bozzetto.manifest.stages.length), 'a tick for each stage');
    await page.click('.transport__play');
    t.ok(await page.evaluate(() => window.__bozzetto.timeline.playing), 'play plays');
    t.eq((await frameState(page)).play.label, 'Pause', 'and says Pause');
    await page.click('.transport__play');
    t.ok(!(await page.evaluate(() => window.__bozzetto.timeline.playing)), 'and again pauses');
    await page.evaluate(() => {
      const r = document.querySelector('.transport__scrubber');
      r.value = '7';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    t.eq(await page.evaluate(() => window.__bozzetto.timeline.frameIndex()), 7, 'the scrubber seeks');

    // --- View: the commands, each with its key ----------------------------------------
    await page.click('.bz-menuname:has-text("View")');
    await page.waitForSelector('.file-menu--view:not([hidden])');
    const rows = await menuRows(page, 'file-menu--view');
    t.eq(rows.join(' | '), 'Frame model [F] | Frame all [A] | Wireframe [Shift + W] | Shadows [Shift + S] | Cycle ground [G] | Render panel | Hide interface [Tab]', 'View holds framing, the view toggles and Render, Hide interface, with their hotkeys');
    await page.evaluate(() => {
      window.__framed = 0;
      window.__bozzetto.focusSubject = () => void window.__framed++;
    });
    await page.click('.file-menu--view .file-menu__item:has-text("Frame all")');
    t.eq(await page.evaluate(() => window.__framed), 1, 'Frame all frames the subject');
    await page.click('.bz-menuname:has-text("View")');
    await page.click('.file-menu--view .file-menu__item:has-text("Frame model")');
    t.eq(await page.evaluate(() => window.__framed), 2, 'so does Frame model');
    await page.click('.bz-menuname:has-text("View")');
    await page.click('.file-menu--view .file-menu__item:has-text("Wireframe")');
    t.ok(await page.evaluate(() => window.__bozzetto.isWireframe()), 'Wireframe turns it on');
    t.eq(await page.getAttribute('.file-menu--view .file-menu__item:has-text("Wireframe")', 'aria-checked'), 'true', 'and shows a check');
    await page.click('.file-menu--view .file-menu__item:has-text("Wireframe")');
    t.ok(!(await page.evaluate(() => window.__bozzetto.isWireframe())), 'again, off');
    const ground = await page.evaluate(() => window.__bozzetto.getGround());
    await page.click('.file-menu--view .file-menu__item:has-text("Cycle ground")');
    t.ok((await page.evaluate(() => window.__bozzetto.getGround())) !== ground, 'Cycle ground moves the ground on');
    // A switch leaves the menu open, as Sculpt's does; a command closes it.
    await page.click('.bz-menuname:has-text("View")');
    await page.click('.file-menu--view .file-menu__item:has-text("Render panel")');
    await page.waitForTimeout(300);
    t.ok((await frameState(page)).open, 'Render panel opens the panel');
    await page.click('.file-menu--view .file-menu__item:has-text("Render panel")');
    await page.waitForTimeout(300);
    t.ok(!(await frameState(page)).open, 'and closes it');
    await page.click('.file-menu--view .file-menu__item:has-text("Hide interface")');
    await page.waitForTimeout(300);
    t.ok(await page.evaluate(() => document.body.classList.contains('chrome-hidden')), 'Hide interface hides it');
    s = await stripState(page);
    t.ok((await frameState(page)).bar !== null && s.buttons.some((b) => b.text === 'Hide the interface' || b.text === 'Show the interface'), 'the transport and the strip\'s button stay');
    await page.click('.bz-strip__hide');
    await page.waitForTimeout(300);
    t.ok(await page.evaluate(() => !document.body.classList.contains('chrome-hidden')), 'and the button brings it back');

    // --- Help: the hotkey guide, no topics window --------------------------------------
    await page.click('.bz-menuname:has-text("Help")');
    await page.waitForSelector('.file-menu--help:not([hidden])');
    t.eq((await menuRows(page, 'file-menu--help')).join(' | '), 'Hotkeys [H]', 'Help holds Hotkeys, as the "?" chip opened it, and no Help topics');
    await page.click('.file-menu--help .file-menu__item');
    t.ok(await page.evaluate(() => !document.querySelector('.help-guide').hidden && /Hotkeys/.test(document.querySelector('.help-guide__head').textContent)), 'it opens the hotkey guide');
    await page.keyboard.press('h');
    t.ok(await page.evaluate(() => document.querySelector('.help-guide').hidden), 'and H closes it');

    // --- the phone: nothing overlaps -------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    s = await stripState(page);
    f = await frameState(page);
    t.ok(s.strip.w === 390 && s.strip.h === 24 && s.scroll <= 0, `at 390px the strip is the width of the screen and nothing scrolls sideways (${s.scroll})`);
    t.ok(!s.readout, 'the readout gives way');
    t.ok(noOverlap(s.left, s.right) && s.right.r <= 390 && s.left.l >= 0, `the menus and Close and hide do not overlap (${JSON.stringify([s.left, s.right])})`);
    t.ok(f.tab && f.tab.r === 390 && f.tab.l >= 0, 'the Render tab is on the screen');
    t.ok(f.bar && f.bar.l === 0 && f.bar.r === 390 && f.bar.b === 844 && f.play.bg === ORANGE, `the transport spans it, flush at the bottom, play still orange (${JSON.stringify(f.bar)})`);
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    f = await frameState(page);
    t.ok(f.open && f.panel.w === 390 && f.panel.b <= f.bar.t, `the open panel is a sheet across the width, clear of the transport (${JSON.stringify([f.panel, f.bar])})`);
    await page.click('.panel--render > .panel__handle');
    await page.click('.bz-menuname:has-text("View")');
    const pop = await page.evaluate(() => {
      const r = document.querySelector('.file-menu--view').getBoundingClientRect();
      return { l: r.left, r: r.right };
    });
    t.ok(pop.l >= 0 && pop.r <= 390, 'and the View menu opens within it');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });

    // --- Close goes to the gallery -----------------------------------------------------------
    await Promise.all([page.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 30_000 }).catch(() => {}), page.click('.viewer-back')]);
    t.ok(new URL(page.url()).search === '', `Close leaves for the gallery (${page.url()})`);
  },

  async viewerModel(page, base, t) {
    // A model: no transport, the readout says Model, the rest of the frame is the same.
    await answer(page, { '/api/projects/a-model': projectJson('a-model', { mode: 'model', title: 'A model', frames: projectJson('a-model').frames.slice(0, 1), config: { ...projectJson('a-model').config, frameCount: 1 }, stages: [] }) });
    await page.goto(`${base}/?tl=a-model`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const s = await stripState(page);
    const f = await frameState(page);
    t.ok(f.bar === null, 'a model has no transport');
    t.eq(s.readoutText, 'A model Model', `its readout is its title and Model (${s.readoutText})`);
    t.eq(s.menus.join(), 'View,Help', 'with the same two menus');
    t.eq(f.tabs.join(), 'Render', 'and the Render tab');
    t.eq(s.oldRow.join(), '', 'and none of the old top row');
  },

  async viewerOwner(page, base, t) {
    // Edit in Present: quiet, at the right of the strip, for an owner already signed in on this device.
    await page.addInitScript(() => localStorage.setItem('bozzetto-signed-in', JSON.stringify({ at: Date.now() })));
    await answer(page, { '/api/config': { accounts: false }, '/admin/api/whoami': { email: 'owner@example.com' } });
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForSelector('.viewer-present', { timeout: 30_000 });
    const s = await stripState(page);
    t.eq(s.buttons.map((b) => b.text).join(), 'Edit in Present,Close,Hide the interface', 'the owner has Edit in Present before Close');
    const chip = s.buttons[0];
    t.ok(chip.tag === 'A' && chip.cls.includes('bz-strip__btn') && chip.bg === 'rgba(0, 0, 0, 0)' && chip.color !== BLACK, `quiet, not filled (${chip.bg})`);
    t.eq(await page.getAttribute('.viewer-present', 'href'), '/?tl=demo&present=1', 'to Present');
    t.ok(noOverlap(s.left, s.right), 'and it fits without touching the menus');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.right.r <= 390 && p.scroll <= 0, `also at 390px (${JSON.stringify([p.left, p.right])})`);
  },

  async viewerMember(page, base, t) {
    // A member's work from the Community: by @ada in the readout, a member's Star and Report in the strip.
    await answer(page, {
      '/api/config': { accounts: true },
      '/api/me': { id: 'u2', handle: 'bea', role: 'member', status: 'active', usage: { used: 0, reserved: 0, quota: 1e9 } },
      '/api/projects/ada-bust': projectJson('ada-bust', { title: 'Ada bust', community: true, author: { handle: 'ada' } }),
    });
    await page.goto(`${base}/?tl=ada-bust`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForSelector('.viewer-report', { timeout: 30_000 });
    const s = await stripState(page);
    t.ok(/^Ada bust by @ada Timelapse 24 frames/.test(s.readoutText), `the readout names the author after the title (${s.readoutText})`);
    const by = await page.evaluate(() => {
      const a = document.querySelector('.bz-readout .viewer-author');
      return { tag: a?.tagName, href: a?.getAttribute('href'), count: document.querySelectorAll('.viewer-author').length };
    });
    t.ok(by.tag === 'A' && by.href === '/?u=ada' && by.count === 1, `a link to her page, said once (${JSON.stringify(by)})`);
    t.eq(s.buttons.map((b) => b.text).join(), '☆,Report…,Close,Hide the interface', "Star and Report… stand before Close, quiet");
    t.ok(s.buttons.every((b) => b.bg === 'rgba(0, 0, 0, 0)'), 'none of them filled');
    t.eq(s.oldRow.join(), '', 'and no top row');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    t.ok(!(await frameState(page)).byline, 'the panel has no byline of its own');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.scroll <= 0, 'at 390px they fit beside the menus');
  },

  async viewerReview(runnerPage, base, t) {
    // Review mode, over the reviewers' route as the page is told it: Close back to Review, the state in the readout, the decisive action filled.
    // Its own context, with no service worker: a worker that has taken the page answers its fetches before the test's answers can.
    const ctx = await runnerPage.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => t.ok(false, `page error: ${e}`));
    let shared = 'pending';
    await answer(page, {
      '/api/config': { accounts: true },
      '/api/me': { id: 'u3', handle: 'mo', role: 'moderator', status: 'active', usage: { used: 0, reserved: 0, quota: 1e9 } },
      '/api/mod/reports': { items: [] },
      '/api/mod/projects/rv': () => ({ ...projectJson('rv', { title: 'Ada bust' }), shared, author: { handle: 'ada' } }),
      '/api/mod/projects/rv/review': (req) => {
        const { action } = JSON.parse(req.postData() ?? '{}');
        shared = action === 'approve' ? 'public' : shared;
        return { shared };
      },
    });
    const open = async (state, tab = '&from=gallery') => {
      shared = state;
      await page.goto(`${base}/?tl=rv&review=1${tab}`, { waitUntil: 'domcontentloaded' });
      await ready(page).catch(async (e) => {
        throw new Error(`${e.message} / ${await page.evaluate(() => document.querySelector('#overlay')?.textContent)}`);
      });
      await page.waitForSelector('.review-action', { timeout: 30_000 });
      return stripState(page);
    };
    let s = await open('pending');
    t.eq(s.menus.join(), 'View,Help', 'the same strip, View and Help');
    t.ok(/^Ada bust by @ada Timelapse 24 frames/.test(s.readoutText) && /Reviewing Pending review$/.test(s.readoutText), `the readout has the author and where it stands (${s.readoutText})`);
    t.eq(await page.getAttribute('.review-mode', 'data-shared'), 'pending', 'the state is on the review-mode hook');
    t.eq(s.buttons.map((b) => b.text).join(), 'Approve,Reject…,Close,Hide the interface', 'Approve and Reject… at the right, before Close');
    const [approve, reject, close] = s.buttons;
    t.ok(approve.bg === ORANGE && approve.color === BLACK, `Approve, the decisive one, is filled orange (${approve.bg})`);
    t.ok(reject.bg === 'rgba(0, 0, 0, 0)', `Reject… is quiet (${reject.bg})`);
    const play = await frameState(page);
    t.ok(play.play.bg !== ORANGE && play.orangeButtons.join() === 'bz-strip__btn bz-strip__btn--primary review-action', `play is grey in review mode, so Approve is the one orange action (${play.orangeButtons})`);
    t.ok(close.cls.includes('review-back'), 'Close is the review\'s own way back');
    t.eq(await page.getAttribute('.review-back', 'href'), '/?review&tab=gallery', 'to the tab it was opened from');
    t.eq(s.oldRow.join(), '', 'no top row');
    t.ok(noOverlap(s.left, s.readout) && noOverlap(s.readout, s.right), 'nothing in the strip overlaps');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.right.r <= 390 && p.scroll <= 0, `at 390px Approve, Reject…, Close and hide fit beside the menus (${JSON.stringify([p.left, p.right])})`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    await page.click('.review-action[data-action="approve"]');
    await page.waitForFunction(() => document.querySelector('.review-mode')?.dataset.shared === 'public', null, { timeout: 15_000 });
    s = await stripState(page);
    t.ok(s.buttons.map((b) => b.text).join() === 'Hide…,Close,Hide the interface' && /Reviewing Public$/.test(s.readoutText), `Approve works: it is public, and Hide… is what is offered (${s.readoutText})`);
    t.ok(s.buttons[0].bg === RED && s.buttons[0].color === BLACK, `Hide…, which takes it down, is filled red (${s.buttons[0].bg})`);
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.bz-strip button')].filter((b) => getComputedStyle(b).backgroundColor === 'rgb(255, 90, 31)').length), 0, 'and nothing is orange in the strip then');
    s = await open('hidden', '');
    t.eq(s.buttons.map((b) => b.text).join(), 'Unhide,Close,Hide the interface', 'a hidden work offers Unhide');
    t.eq(s.buttons[0].bg, ORANGE, 'filled orange');
    t.eq(await page.getAttribute('.review-back', 'href'), '/?review&tab=queue', 'and Close goes to the queue when no tab was named');
    await ctx.close();
  },
};
