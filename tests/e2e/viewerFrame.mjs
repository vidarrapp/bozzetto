// The public viewer (`/?tl=<id>`) in the app's frame (src/viewer/viewerFrame.ts,
// docs/ui-spec.md): the quiet title strip (File, View and Help, the title and
// what it is in the middle, the hide button at the right), Render as
// the one folder tab with the viewer's own panel under it, the transport as the
// bar at the foot with the white play button, and none of the old top row,
// sideways tab or transport. The same at 390px, where nothing overlaps. Then
// a model, the owner's Edit in Present (File), a member's work (by @handle in the
// readout, Star at the right, Report in Moderation) and review mode (File > Close back to
// Review, the state in the readout, the actions in Moderation), the last two over
// answers the page is given for the account routes (the real ones run in the
// community suite). Each gets (page, base, t).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderShape, shapeChecks } from './renderMatch.mjs';

const ORANGE = 'rgb(255, 90, 31)';
const WHITE = 'rgb(255, 255, 255)';
const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/viewer-menus';
const RED = 'rgb(171, 0, 0)';
const BLACK = 'rgb(0, 0, 0)';
const CONTROL = 'rgb(58, 58, 58)';
const GREY_ICON = 'rgb(179, 179, 179)';
/** Play's icon: light grey at rest, white while playing. */
const playIconOk = (play) => play.icon === (play.label === 'Pause' ? WHITE : GREY_ICON);
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
      menus: [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].filter((m) => !m.hidden).map((m) => m.textContent),
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

/** A page of its own with no service worker: one that has taken the page answers its fetches before the test's answers can. */
const freshPage = async (runnerPage, t) => {
  const ctx = await runnerPage.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => t.ok(false, `page error: ${e}`));
  return { ctx, page };
};

const noOverlap = (a, b) => !!a && !!b && a.r <= b.l;

/** Open a strip menu by its name; its list is shown. */
const openStripMenu = async (page, name) => {
  await page.click(`.bz-menuname:has-text("${name}")`);
  await page.waitForSelector('.file-menu:not([hidden])');
};

/** A menu's rows with their hint lines: "Close (Back to the gallery)". */
const rowsWithHints = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].map((b) => {
      const label = b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim();
      const hint = b.querySelector('.file-menu__hint')?.textContent;
      return `${label}${b.disabled ? ' [off]' : ''}${hint ? ` (${hint})` : ''}`;
    }),
  );

/** Press one row of the open menu. */
const pickRow = (page, label) => page.click(`.file-menu:not([hidden]) .file-menu__item:has-text("${label}")`);

/** The viewer's menus, in order, as the strip names them. */
const menuNames = (page) => page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].filter((m) => !m.hidden && m.getClientRects().length).map((m) => m.textContent));

export const suites = {
  async viewerFrame(page, base, t) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.evaluate(() => window.__bozzetto.pause());
    await page.evaluate(() => window.__bozzetto.scrubTo(10));
    await page.waitForTimeout(500);

    // --- the strip: File, View and Help, the readout, hide --------------------
    let s = await stripState(page);
    t.ok(s.strip && s.strip.h === 24 && s.strip.t === 0 && s.strip.w === s.vw && s.strip.bg === STRIP && s.strip.pos === 'fixed', `a 24px strip across the top, on the strip colour (${JSON.stringify(s.strip)})`);
    t.eq(s.menus.join(), 'File,View,Help', 'three menus at its left, File, View and Help, as in the workspaces: no Edit, and no Moderation for a guest');
    t.ok(!s.path, 'and no workspace path after them');
    t.ok(s.left && s.readout && s.right && noOverlap(s.left, s.readout) && noOverlap(s.readout, s.right), 'the menus, the readout and the right group do not overlap');
    t.eq(s.title, 'Demo bust (synthetic)', "the readout starts with the project's title");
    t.ok(Number(s.titleWeight) >= 600, `in bold (${s.titleWeight})`);
    const at = await page.evaluate(() => window.__bozzetto.timeline.stageAt(10)?.name ?? null);
    t.ok(/Timelapse 24 frames/.test(s.readoutText) && !!at && s.readoutText.endsWith(`Stage ${at}`), `then Timelapse 24 frames and the stage the frame is in (${s.readoutText})`);
    t.ok(!/ by @/.test(s.readoutText), 'with no author: the project is not a member\'s');
    t.eq(s.buttons.map((b) => b.text).join(), 'Hide the interface', 'only the hide button at the right for a visitor');
    await openStripMenu(page, 'File');
    t.eq((await rowsWithHints(page)).join(' | '), 'New sculpt from this (Starts a new sculpt from the frame on screen) | Close (Back to the gallery)', 'File holds New sculpt from this (the demo stands in for a template) and Close, with where it goes');
    t.ok(await page.evaluate(() => !!document.querySelector('.file-menu--file.file-menu')), 'the File list is the same menu component the workspaces use');
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/viewer-guest-file.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Escape');
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

    // --- Render: its folder tab at the right, Material's at the left --------------
    t.eq([...f.tabs].sort().join(), 'Material,Render', 'two folder tabs: Material at the left, Render at the right');
    t.ok(f.tab && f.tab.r === s.vw && f.tab.t === 28 && f.tab.h === 28 && f.tabWriting === 'horizontal-tb', `at the right edge under the strip, horizontal, not a sideways tab (${JSON.stringify(f.tab)} ${f.tabWriting})`);
    t.ok(!f.open && !f.panelShown, 'the panel is shut, as the viewer has it');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    f = await frameState(page);
    t.ok(f.open && f.panel && f.panel.w === 304 && f.panel.r === s.vw && f.panel.t === 56, `a click opens it: 304px, flush right, under the tab (${JSON.stringify(f.panel)})`);
    t.eq(f.heading, 'Render', 'headed Render');
    t.ok(!f.byline, 'with no byline: whose it is, is the strip\'s to say');
    t.ok(f.sections.join() === 'Lighting,Camera,Environment,Ambient occlusion', `with the same sections as everywhere else, Material being the left tab's (${f.sections})`);
    t.ok(!(await page.$('.panel--render .panel__hotkeys')), 'and no Hotkeys button: the Help menu and H open the guide');
    await page.keyboard.press('h');
    t.ok(await page.evaluate(() => !document.querySelector('.help-guide').hidden), 'H opens the guide');
    await page.keyboard.press('h');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    t.ok(!(await frameState(page)).open, 'the tab shuts it again');

    // --- the transport: the bar at the foot, play a regular button with a white icon ----------------
    t.ok(f.barClass.includes('transport--shell') && f.bar && f.bar.b === s.vh && Math.abs((f.bar.l + f.bar.r) / 2 - s.vw / 2) <= 1 && f.bar.w <= 752 && f.barBorderTop === '0px', `the transport is the shell's bar, flush at the bottom centre (${JSON.stringify(f.bar)})`);
    t.ok(f.play.bg === CONTROL && playIconOk(f.play), `its play button is a regular button, its icon grey at rest and white while playing (${JSON.stringify(f.play)})`);
    t.eq(f.orangeButtons.join(), '', `and nothing on the screen is an orange button (${f.orangeButtons})`);
    t.eq(f.ticks, await page.evaluate(() => window.__bozzetto.manifest.stages.length), 'a tick for each stage');
    await page.click('.transport__play');
    t.ok(await page.evaluate(() => window.__bozzetto.timeline.playing), 'play plays');
    t.eq((await frameState(page)).play.label, 'Pause', 'and says Pause');
    t.eq((await frameState(page)).play.icon, WHITE, 'and its icon is white while playing');
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
    t.eq(rows.join(' | '), 'Frame model [F] | Frame all [A] | Wireframe [Shift + W] | Shadows [Shift + S] | Cycle ground [G] | Material panel | Render panel | Hide interface [Tab]', 'View holds framing, the view toggles and Render, Hide interface, with their hotkeys');
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
    t.ok(noOverlap(s.left, s.right) && s.right.r <= 390 && s.left.l >= 0, `the menus and the hide button do not overlap (${JSON.stringify([s.left, s.right])})`);
    t.ok(f.tab && f.tab.r === 390 && f.tab.l >= 0, 'the Render tab is on the screen');
    t.ok(f.bar && f.bar.l === 0 && f.bar.r === 390 && f.bar.b === 844 && f.play.bg === CONTROL, `the transport spans it, flush at the bottom, play still a regular button (${JSON.stringify(f.bar)})`);
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

    // --- File > Close goes to the gallery, opened cold ---------------------------------------
    await openStripMenu(page, 'File');
    await Promise.all([page.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 30_000 }).catch(() => {}), pickRow(page, 'Close')]);
    t.ok(new URL(page.url()).search === '', `File > Close leaves for the gallery (${page.url()})`);
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
    t.eq(s.menus.join(), 'File,View,Help', 'with the same three menus');
    t.eq([...f.tabs].sort().join(), 'Material,Render', 'and the Material and Render tabs');
    t.eq(s.oldRow.join(), '', 'and none of the old top row');
  },

  async viewerOwner(runnerPage, base, t) {
    const { ctx, page } = await freshPage(runnerPage, t);
    await page.setViewportSize({ width: 1180, height: 820 });
    // Edit in Present: in File, for an owner already signed in on this device; nothing else in the strip.
    await page.addInitScript(() => localStorage.setItem('bozzetto-signed-in', JSON.stringify({ at: Date.now() })));
    await answer(page, { '/api/config': { accounts: false }, '/admin/api/whoami': { email: 'owner@example.com' } });
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForFunction(() => !!document.querySelector('.bz-menuname') && document.querySelector('.file-menu--file')?.textContent.includes('Edit in Present'), null, { timeout: 30_000 });
    const s = await stripState(page);
    t.eq(s.buttons.map((b) => b.text).join(), 'Hide the interface', 'the owner has no Edit at the right of the strip any more');
    t.eq(s.menus.join(), 'File,View,Help', 'and the same three menus');
    await openStripMenu(page, 'File');
    t.eq((await rowsWithHints(page)).join(' | '), 'New sculpt from this (Starts a new sculpt from the frame on screen) | Edit in Present | Close (Back to the gallery)', 'File holds New sculpt from this, Edit in Present, then Close');
    await page.screenshot({ path: `${SHOTS}/viewer-owner-file.png` });
    await Promise.all([page.waitForURL((u) => u.search === '?tl=demo&present=1', { timeout: 30_000, waitUntil: 'commit' }), pickRow(page, 'Edit in Present')]);
    t.ok(true, 'Edit in Present goes to Present (/?tl=demo&present=1)');
    await page.goto(`${base}/?tl=demo&from=me`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForFunction(() => document.querySelector('.file-menu--file')?.textContent.includes('Edit in Present'), null, { timeout: 30_000 });
    await openStripMenu(page, 'File');
    await Promise.all([page.waitForURL((u) => u.search === '?tl=demo&present=1&from=me', { timeout: 30_000, waitUntil: 'commit' }), pickRow(page, 'Edit in Present')]);
    t.ok(true, 'and carries where the viewer was opened from, so Present closes back there');
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.right.r <= 390 && p.scroll <= 0, `also at 390px (${JSON.stringify([p.left, p.right])})`);
    await ctx.close();
  },

  async viewerGuestOnly(page, base, t) {
    // Edit in Present is the owner's: a guest, and a member, are not offered it.
    await answer(page, { '/api/config': { accounts: false } });
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForTimeout(800);
    await openStripMenu(page, 'File');
    t.ok(!(await rowsWithHints(page)).some((r) => /Edit in Present/.test(r)), 'a guest is not offered Edit in Present');
  },

  async viewerOrigin(page, base, t) {
    // File > Close goes back to where the viewer was opened from, with the hint to match; cold it is the gallery.
    const cases = [
      ['', 'Back to the gallery', (u) => u.pathname === '/' && u.search === ''],
      ['&from=community', 'Back to Community', (u) => u.pathname === '/' && u.search === '?community'],
      ['&from=u:ada', 'Back to Community', (u) => u.pathname === '/' && u.search === '?u=ada'],
      ['&from=me', 'Back to My projects', (u) => u.pathname === '/' && u.search === '?me'],
      ['&from=//elsewhere.example', 'Back to the gallery', (u) => u.pathname === '/' && u.search === ''],
    ];
    for (const [q, hint, where] of cases) {
      await page.goto(`${base}/?tl=demo${q}`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await openStripMenu(page, 'File');
      const rows = await rowsWithHints(page);
      t.eq(rows.at(-1), `Close (${hint})`, `${q || 'opened cold'}: Close says "${hint}"`);
      await Promise.all([page.waitForURL((u) => where(new URL(u)), { timeout: 30_000, waitUntil: 'commit' }), pickRow(page, 'Close')]);
      t.ok(where(new URL(page.url())), `and goes to ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
    }
  },

  async viewerNewSculpt(runnerPage, base, t) {
    const { ctx, page } = await freshPage(runnerPage, t);
    // New sculpt from this: a template's frame on screen becomes the one object of a new sculpt, at its size, on the floor.
    // A project on real units (the answer says cm) and not a member's.
    await answer(page, { '/api/projects/tpl': projectJson('tpl', { title: 'A template', units: 'cm' }) });
    await page.goto(`${base}/?tl=tpl`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.evaluate(() => window.__bozzetto.pause());
    await page.evaluate(() => window.__bozzetto.scrubTo(12));
    await page.waitForTimeout(600);
    const want = await page.evaluate(() => {
      const b = window.__bozzetto.frameLocalBounds();
      return { size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z], lowest: b.min.y };
    });
    await openStripMenu(page, 'File');
    t.ok((await rowsWithHints(page)).some((r) => r.startsWith('New sculpt from this')), 'a template offers New sculpt from this');
    await Promise.all([page.waitForURL((u) => u.search.includes('sculpt=1'), { timeout: 60_000, waitUntil: 'commit' }), pickRow(page, 'New sculpt from this')]);
    await page.waitForFunction(() => !!window.__sculpt?.session?.getMeshes().length, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    const got = await page.evaluate(() => {
      const meshes = window.__sculpt.session.getMeshes();
      const w = window.__sculpt.worldBox(meshes[0]);
      return { n: meshes.length, size: [0, 1, 2].map((k) => w.max[k] - w.min[k]), lowest: w.min[1], units: window.__sculpt.session.getUnits(), banner: !!document.querySelector('.scale-banner:not([hidden])') };
    });
    t.eq(got.n, 1, 'Sculpt opens with one object');
    t.ok(got.size.every((v, k) => Math.abs(v - want.size[k]) <= 0.08 * want.size[k]), `at the frame's real size, give or take the smoothing of the object's finest level, as an imported OBJ has it (${got.size.map((v) => v.toFixed(2))} vs ${want.size.map((v) => v.toFixed(2))} cm)`);
    t.ok(Math.abs(got.lowest - want.lowest) <= 0.08 * want.size[1], `standing where the frame stood on the floor (${got.lowest.toFixed(2)} vs ${want.lowest.toFixed(2)})`);
    t.eq(got.units, 'cm', 'in a scene on real units');
    t.ok(!got.banner, 'with no Set scale question');
    // Not for a member's shared work, and not for a project that is the owner's or a member's own.
    await answer(page, { '/api/config': { accounts: true }, '/api/projects/ada-bust': projectJson('ada-bust', { title: 'Ada bust', community: true, author: { handle: 'ada' } }) });
    await page.goto(`${base}/?tl=ada-bust`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForTimeout(500);
    await openStripMenu(page, 'File');
    t.eq((await rowsWithHints(page)).join(' | '), 'Close (Back to the gallery)', "a member's Community work is to look at only: File holds Close alone");
    await ctx.close();
  },

  async viewerMember(page, base, t) {
    // A member's work from the Community: by @ada in the readout, the Star at the right, Report… in Moderation.
    await page.setViewportSize({ width: 1180, height: 820 });
    await answer(page, {
      '/api/config': { accounts: true },
      '/api/me': { id: 'u2', handle: 'bea', role: 'member', status: 'active', usage: { used: 0, reserved: 0, quota: 1e9 } },
      '/api/projects/ada-bust': projectJson('ada-bust', { title: 'Ada bust', community: true, author: { handle: 'ada' } }),
      '/api/me/stars/ada-bust': { starred: false },
    });
    await page.goto(`${base}/?tl=ada-bust&from=community`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.bz-menuname')].some((m) => m.textContent === 'Moderation' && !m.hidden), null, { timeout: 30_000 });
    const s = await stripState(page);
    t.ok(/^Ada bust by @ada Timelapse 24 frames/.test(s.readoutText), `the readout names the author after the title (${s.readoutText})`);
    const by = await page.evaluate(() => {
      const a = document.querySelector('.bz-readout .viewer-author');
      return { tag: a?.tagName, href: a?.getAttribute('href'), count: document.querySelectorAll('.viewer-author').length };
    });
    t.ok(by.tag === 'A' && by.href === '/?u=ada' && by.count === 1, `a link to her page, said once (${JSON.stringify(by)})`);
    t.eq(s.menus.join(), 'File,View,Moderation,Help', 'a member has File, View, Moderation and Help');
    t.eq(s.buttons.map((b) => b.text).join(), 'Star,Hide the interface', 'the right of the strip holds the Star (an icon, named for a screen reader) and the hide button, nothing else');
    t.ok(s.buttons.every((b) => b.bg === 'rgba(0, 0, 0, 0)'), 'neither filled');
    t.eq(s.oldRow.join(), '', 'and no top row');
    await openStripMenu(page, 'File');
    t.eq((await rowsWithHints(page)).join(' | '), 'Close (Back to Community)', "File holds Close alone (Community work is to look at only), going back to Community");
    await page.screenshot({ path: `${SHOTS}/viewer-member-file.png` });
    await page.keyboard.press('Escape');
    await openStripMenu(page, 'Moderation');
    t.eq((await rowsWithHints(page)).join(' | '), 'Report…', 'Moderation holds Report…');
    await page.screenshot({ path: `${SHOTS}/viewer-member-moderation.png` });
    await pickRow(page, 'Report');
    await page.waitForSelector('.report-overlay select[name=reason]', { timeout: 10_000 });
    t.ok(true, 'Report… opens the report window');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.report-overlay'));
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(300);
    t.ok(!(await frameState(page)).byline, 'the panel has no byline of its own');
    await page.click('.panel--render > .panel__handle');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.scroll <= 0 && p.right.r <= 390, `at 390px File, View, Moderation, Help, the Star and the hide button fit without overlap (${JSON.stringify([p.left, p.right])})`);
    await page.screenshot({ path: `${SHOTS}/viewer-member-390.png` });
  },

  async viewerReview(runnerPage, base, t) {
    // Review mode, over the reviewers' route as the page is told it: Close back to Review, the state in the readout, the decisive action filled.
    // Its own context, with no service worker: a worker that has taken the page answers its fetches before the test's answers can.
    const ctx = await runnerPage.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1180, height: 820 });
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
      await page.waitForFunction(() => [...document.querySelectorAll('.bz-menuname')].some((m) => m.textContent === 'Moderation' && !m.hidden), null, { timeout: 30_000 });
      return stripState(page);
    };
    const actions = async () => {
      await openStripMenu(page, 'Moderation');
      const rows = await rowsWithHints(page);
      await page.keyboard.press('Escape');
      return rows.join(' | ');
    };
    let s = await open('pending');
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(400);
    shapeChecks(t, await renderShape(page), 'Review mode');
    await page.click('.panel--render > .panel__handle');
    t.eq(s.menus.join(), 'File,View,Moderation,Help', 'the same strip: File, View, Moderation and Help');
    t.ok(/^Ada bust by @ada Timelapse 24 frames/.test(s.readoutText) && /Reviewing Pending review$/.test(s.readoutText), `the readout has the author and where it stands (${s.readoutText})`);
    t.eq(await page.getAttribute('.review-mode', 'data-shared'), 'pending', 'the state is on the review-mode hook');
    t.eq(s.buttons.map((b) => b.text).join(), 'Hide the interface', 'only the hide button at the right: the review actions are in Moderation');
    t.eq(await actions(), 'Approve | Reject…', 'Moderation holds Approve and Reject… for pending work');
    await openStripMenu(page, 'Moderation');
    await page.screenshot({ path: `${SHOTS}/viewer-reviewer-moderation.png` });
    await page.keyboard.press('Escape');
    const play = await frameState(page);
    t.ok(play.play.bg === CONTROL && playIconOk(play.play) && play.orangeButtons.join() === '', `play is the same regular button in review mode too, and nothing is orange (${play.play.bg} ${play.orangeButtons})`);
    await openStripMenu(page, 'File');
    t.eq((await rowsWithHints(page)).join(' | '), 'Close (Back to Review)', 'File holds Close, saying it goes back to Review');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${SHOTS}/viewer-reviewer-play.png` });
    t.eq(s.oldRow.join(), '', 'no top row');
    t.ok(noOverlap(s.left, s.readout) && noOverlap(s.readout, s.right), 'nothing in the strip overlaps');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const p = await stripState(page);
    t.ok(noOverlap(p.left, p.right) && p.right.r <= 390 && p.scroll <= 0, `at 390px the four menus and the hide button fit (${JSON.stringify([p.left, p.right])})`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    await openStripMenu(page, 'Moderation');
    await pickRow(page, 'Approve');
    await page.waitForFunction(() => document.querySelector('.review-mode')?.dataset.shared === 'public', null, { timeout: 15_000 });
    s = await stripState(page);
    t.ok((await actions()) === 'Hide…' && /Reviewing Public$/.test(s.readoutText), `Approve works from the menu: it is public, and Hide… is what is offered (${s.readoutText})`);
    // Hide… asks first, with the destructive confirm red (the question window's own treatment).
    await openStripMenu(page, 'Moderation');
    await pickRow(page, 'Hide…');
    await page.waitForSelector('.review-reason-overlay', { timeout: 10_000 });
    t.ok(true, 'Hide… asks for a reason first, as the strip button did');
    await page.keyboard.press('Escape');
    s = await open('hidden', '');
    t.eq(await actions(), 'Unhide', 'a hidden work offers Unhide');
    await openStripMenu(page, 'File');
    await Promise.all([page.waitForURL((u) => u.search === '?review&tab=queue', { timeout: 30_000, waitUntil: 'commit' }), pickRow(page, 'Close')]);
    t.ok(true, 'and File > Close goes to the queue when no tab was named');
    await open('pending', '&from=gallery');
    await openStripMenu(page, 'File');
    await Promise.all([page.waitForURL((u) => u.search === '?review&tab=gallery', { timeout: 30_000, waitUntil: 'commit' }), pickRow(page, 'Close')]);
    t.ok(true, 'and to the tab it was opened from');
    await ctx.close();
  },
};
