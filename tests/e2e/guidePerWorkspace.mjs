// The hotkey guide per workspace (package presentkeys): Armature, Sculpt, Paint
// and Present each show their own title and table, and the guide redraws when
// the workspace changes while it is open. Present's table is the same
// entered from Sculpt, from Paint and from Armature, lists only keys that do
// something there, and is drawn from the keymap (a rebind of a Present key
// shows in it). A key that means different things in two workspaces (1, 2, 3,
// L) is listed in each with what it does there.
//
// guidePerWorkspace: all of that.
import { openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/presentkeys';

/** The guide as drawn now, hidden or not: its title, and each row as "keys: words". */
const guide = (page) =>
  page.evaluate(() => ({
    head: document.querySelector('.help-guide__head')?.firstChild?.textContent?.trim() ?? '',
    open: !document.querySelector('.help-guide')?.hidden,
    groups: [...document.querySelectorAll('.help-guide__title')].map((g) => g.textContent),
    rows: [...document.querySelectorAll('.help-guide .help-row')].map((r) => `${[...r.querySelectorAll('kbd, .help-key')].map((k) => k.textContent).join('+')}: ${r.lastElementChild.textContent}`),
  }));

const where = (page) => page.evaluate(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent ?? '');
async function go(page, to, name) {
  await page.evaluate((w) => window.__sculpt.studio.go(w), to);
  await page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 90_000 });
  if (to === 'armature') await page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended(), null, { timeout: 90_000 });
  if (to === 'present') await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
  await page.waitForTimeout(300);
}

/** What the keys of Present are by default: the keys that did something there before, and the light keys. */
const PRESENT_DEFAULT_KEYS = ['Space', 'Shift+1', 'Shift+2', 'Shift+3', 'Shift+4', 'Ctrl+S', 'Tab', 'Esc', 'H', 'P', 'Ctrl+,', 'F', 'A', '←', '→', 'Shift+S', 'Shift+W', 'L', '1', '2', '3'];

export const suites = {
  async guidePerWorkspace(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&nosplash=1');
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 60_000 });

    // --- Sculpt, then open: it follows the workspace while it is open ---------------------
    const sculpt = await guide(page);
    t.eq(sculpt.head, 'Sculpt hotkeys', 'Sculpt shows "Sculpt hotkeys"');
    t.ok(sculpt.rows.some((r) => r.startsWith('1: Tool bar, place 1')) && sculpt.rows.some((r) => r === 'L: Move the key light (hold + drag: across / up; View > Move light does it with one drag)'), 'with 1 a tool place and L the key light');
    await page.keyboard.press('h');
    await page.screenshot({ path: `${SHOTS}/guide-sculpt.png` });
    t.ok((await guide(page)).open, 'H opens it');
    await go(page, 'paint', 'Paint');
    let g = await guide(page);
    t.ok(g.open && g.head === 'Paint hotkeys', `open in Sculpt, going to Paint redraws it as "${g.head}" and leaves it open`);
    await go(page, 'armature', 'Armature');
    g = await guide(page);
    t.ok(g.open && g.head === 'Armature hotkeys', `going to Armature redraws it as "${g.head}"`);
    t.ok(g.rows.some((r) => r.startsWith('L: Move the key light')), 'Armature lists L for the key light');
    await go(page, 'present', 'Present');
    const fromArmature = await guide(page);
    t.ok(fromArmature.open && fromArmature.head === 'Present hotkeys', `going to Present from Armature redraws it as "${fromArmature.head}"`);
    await page.screenshot({ path: `${SHOTS}/guide-present.png` });
    await go(page, 'sculpt', 'Sculpt');
    g = await guide(page);
    t.ok(g.open && g.head === 'Sculpt hotkeys', `and back to Sculpt as "${g.head}"`);
    await page.keyboard.press('h');
    t.ok(!(await guide(page)).open, 'H closes it');

    // --- Present's guide is its own, whichever workspace it was entered from ------------------
    await go(page, 'present', 'Present');
    const fromSculpt = await guide(page);
    await go(page, 'paint', 'Paint');
    await go(page, 'present', 'Present');
    const fromPaint = await guide(page);
    t.eq(fromSculpt.head, 'Present hotkeys', 'Present from Sculpt shows "Present hotkeys"');
    t.ok(JSON.stringify(fromSculpt) === JSON.stringify({ ...fromPaint, open: fromSculpt.open }) && JSON.stringify(fromSculpt.rows) === JSON.stringify(fromArmature.rows), 'and the same table entered from Sculpt, from Paint and from Armature');
    const keys = fromSculpt.rows.map((r) => r.split(': ')[0]).filter((k) => !/^(Drag|Cmd|Scroll)/.test(k));
    t.eq([...keys].sort().join(' '), [...PRESENT_DEFAULT_KEYS].sort().join(' '), `it lists the keys that work in Present and no others (${keys.join(' ')})`);
    t.ok(fromSculpt.rows.some((r) => /^Drag: Orbit/.test(r)) && fromSculpt.rows.some((r) => /^Scroll \/ pinch: Zoom/.test(r)), 'with the navigation gestures');
    t.ok(fromSculpt.rows.includes('Space: Turntable: start and stop') && fromSculpt.rows.some((r) => r.startsWith('L: Move the picked light')), 'Space is the turntable and L moves the picked light there');
    t.ok(['1: Pick the key light for L', '2: Pick the fill light for L', '3: Pick the rim light for L'].every((r) => fromSculpt.rows.includes(r)), '1, 2 and 3 pick the lights there');
    t.ok(!fromSculpt.rows.some((r) => /Tool bar|Brush|Mask|Undo|gizmo/i.test(r)), 'and no tool, brush, mask, undo or gizmo row');

    // --- a rebind shows ----------------------------------------------------------------------
    await page.keyboard.press('Control+Comma');
    await page.waitForSelector('.prefs__row', { timeout: 5000 });
    const tab = await page.evaluate(() => document.querySelector('.prefs__tab--on')?.textContent);
    t.eq(tab, 'Present', 'Preferences opens on its Present tab from Present');
    const labels = await page.evaluate(() => [...document.querySelectorAll('.prefs__row .prefs__label')].map((l) => l.textContent));
    t.ok(['Pick the key light for L', 'Pick the fill light for L', 'Pick the rim light for L'].every((l) => labels.includes(l)), `with the light keys listed (${labels.length} rows)`);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.prefs__row')].find((r) => r.querySelector('.prefs__label')?.textContent === 'Pick the fill light for L');
      row.querySelector('.prefs__key').click();
    });
    await page.keyboard.press('v');
    await page.waitForTimeout(150);
    await page.evaluate(() => [...document.querySelectorAll('.prefs button')].find((b) => b.textContent === 'Close')?.click());
    await page.waitForTimeout(150);
    const rebound = await guide(page);
    t.ok(rebound.rows.includes('V: Pick the fill light for L') && !rebound.rows.includes('2: Pick the fill light for L'), 'a rebind of a Present light key shows in Present\'s guide');
    // The key works, and Sculpt's own 2 and V are not touched by it.
    await page.keyboard.press('v');
    await page.waitForFunction(() => [...document.querySelectorAll('.sculpt-toast')].some((e) => /^Fill (light|is off)$/.test(e.textContent)), null, { timeout: 5000 });
    t.ok(true, 'and the new key picks the fill light (Sculpt\'s rig has it off, which the line says)');
    await go(page, 'sculpt', 'Sculpt');
    const back = await guide(page);
    t.ok(back.rows.some((r) => r.startsWith('2: Tool bar, place 2')), 'while Sculpt still has 2 for its tool place');
    await page.evaluate(() => localStorage.removeItem('bozzetto-keymap'));
    t.eq(await where(page), 'Sculpt', 'and the page is in Sculpt');
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
