// The shell of Sculpt and Armature (docs/ui-spec.md sections 5 and 6): the
// title strip with its four menus, its readout, Publish and the hide
// button; the folder tabs and one open panel a side; the tool bar; and the
// edge controls with the brush fields. Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

/** Open a strip menu by its name and return its item labels (hotkeys and hints left out). */
const openMenu = async (page, name) => {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === n)?.click(), name);
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  return page.evaluate(() => {
    const pop = [...document.querySelectorAll('.file-menu')].find((p) => !p.hidden);
    const items = [...pop.querySelectorAll('.file-menu__item:not(.file-menu__choice), .file-menu__choices')].map(
      (b) => b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim(),
    );
    const r = pop.getBoundingClientRect();
    const open = document.querySelector('.bz-menuname.is-open').getBoundingClientRect();
    return { items, left: r.left, top: r.top, nameLeft: open.left, nameBottom: open.bottom };
  });
};

const closeMenu = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
};

/** A menu item by its label, clicked as a person would (the menu must be open). */
const pick = (page, label) =>
  page.evaluate((l) => {
    const item = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find(
      (b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim()) === l,
    );
    item?.click();
    return !!item;
  }, label);

const isOpen = (page, cls) => page.evaluate((c) => !document.querySelector(`.${c}`).classList.contains('panel--collapsed'), cls);
const tab = (page, cls) => page.evaluate((c) => document.querySelector(`.${c} .panel__handle`).click(), cls);
const shown = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, sel);
const box = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, sel);

export const suites = {
  /** The strip: four menus in order, each with its items, the readout, Publish and the hide button. */
  async shellStrip(page, base, t) {
    await openSculpt(page, base);
    const strip = await box(page, '.bz-strip');
    t.ok(strip.top === 0 && strip.left === 0 && Math.round(strip.width) === 1280 && strip.height === 24, `the strip is 24px tall and runs edge to edge (${JSON.stringify(strip)})`);
    const names = await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].map((b) => b.textContent));
    t.eq(names.join(','), 'File,Edit,View,Help', 'the menus are File, Edit, View and Help, in that order');
    const first = await box(page, '.bz-menuname');
    const textLeft = await page.evaluate(() => {
      const b = document.querySelector('.bz-menuname');
      const r = document.createRange();
      r.selectNodeContents(b);
      return r.getBoundingClientRect().left;
    });
    t.near(textLeft, 16, 1, `the first name starts 16px in (${first.left} for its box)`);

    const file = await openMenu(page, 'File');
    t.eq(
      file.items.join('|'),
      'New sculpt|Open…|Save file|Save to library|Keep on this device|Import OBJ…|Z-up OBJ import|Export OBJ|Publish…|Close',
      'File: New and Open, the three saves, OBJ in and out, Publish and Close, regrouped',
    );
    t.near(file.left, file.nameLeft, 1, 'an open menu hangs with its left edge under its name');
    t.near(file.top, file.nameBottom, 1, 'from the strip\'s lower edge');
    const hint = await page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__hint')].map((h) => h.textContent));
    t.ok(hint.some((h) => /device only/i.test(h)) && hint.some((h) => /gallery/i.test(h)), 'and keeps its sub-lines');
    const fill = await page.evaluate(() => getComputedStyle(document.querySelector('.bz-menuname.is-open')).backgroundColor);
    t.ok(/75, 75, 75/.test(fill), `the open menu's name has the hover fill (${fill})`);
    await closeMenu(page);

    const edit = await openMenu(page, 'Edit');
    t.ok(edit.items[0] === 'Undo' && edit.items[1] === 'Redo' && edit.items[2] === 'Duplicate' && edit.items[3] === 'Delete' && edit.items[4] === 'Merge' && edit.items.includes('Mirror') && edit.items.at(-1) === 'Preferences…', `Edit keeps its items (${edit.items.join('|')})`);
    await closeMenu(page);

    const view = await openMenu(page, 'View');
    t.eq(
      view.items.join('|'),
      'Frame selected|Frame all|Wireframe|Poly group colours|Hotkeys on tools|Scene panel|Model panel|Tool panel|Render panel|Hide interface|Armature|Sculpt|Present',
      'View: framing, the switches, the four panels, Hide interface and the three workspaces',
    );
    const keys = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('.file-menu--view .file-menu__item')].map((b) => [b.querySelector('.file-menu__label')?.textContent, b.querySelector('.file-menu__key')?.textContent ?? ''])),
    );
    t.ok(keys['Frame selected'] === 'F' && keys['Frame all'] === 'A' && /Shift/.test(keys.Wireframe) && keys['Hide interface'] === 'Tab' && /Shift/.test(keys.Present), `each item shows its hotkey (${JSON.stringify(keys)})`);
    await closeMenu(page);

    const help = await openMenu(page, 'Help');
    t.eq(help.items.join('|'), 'Help topics|Hotkeys|About and credits', 'Help is as it was');
    await closeMenu(page);

    // The readout stands in the middle of the strip and replaced the corner's.
    const readout = await page.evaluate(() => ({
      keys: [...document.querySelectorAll('.bz-readout__item:not([hidden]) .bz-readout__key')].map((k) => k.textContent),
      object: document.querySelector('.bz-readout__object')?.textContent,
      tris: document.querySelector('.bz-readout__tris')?.textContent,
      level: document.querySelector('.bz-readout__level')?.textContent,
      name: !document.querySelector('.bz-readout__name')?.hidden,
      corner: !!document.querySelector('.sculpt-stats'),
      keyColour: getComputedStyle(document.querySelector('.bz-readout__key')).color,
      valueWeight: getComputedStyle(document.querySelector('.bz-readout__val')).fontWeight,
      real: window.__sculpt.session.getMesh().getNbTriangles(),
      centre: (() => {
        const r = document.querySelector('.bz-readout').getBoundingClientRect();
        return (r.left + r.right) / 2;
      })(),
    }));
    t.eq(readout.keys.join(','), 'Object,Tris,Level', 'the readout says Object, Tris and Level');
    t.ok(readout.object === 'Sphere' && readout.tris === readout.real.toLocaleString('en-US') && /^\d+\/\d+$/.test(readout.level), `with the object, its triangles and its level (${readout.object}, ${readout.tris}, ${readout.level})`);
    t.ok(!readout.corner, 'and the corner at the top left of the view is gone');
    t.ok(!readout.name, 'a scene with no name shows none');
    t.ok(/179, 179, 179/.test(readout.keyColour) && Number(readout.valueWeight) >= 600, `keys are secondary and regular, values bold (${readout.keyColour}, ${readout.valueWeight})`);
    t.near(readout.centre, 640, 2, 'and it is centred');
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
    await page.waitForFunction(() => document.querySelector('.bz-readout__object')?.textContent === 'Cube', null, { timeout: 4000 });
    t.ok(true, 'the readout follows the active object');

    // The old top row is gone, and what moved is in the strip.
    const gone = await page.evaluate(() => ({
      topbar: [...document.querySelectorAll('.topbar .topchip, .topbar .help-toggle, .topbar .theme-toggle')].filter((c) => c.getClientRects().length > 0).map((c) => c.textContent),
      present: !!document.querySelector('.present__chip'),
      right: !!document.querySelector('.sculpt-toolbar__right'),
      eyeIn: !!document.querySelector('.bz-strip .bz-strip__hide'),
      publishIn: !!document.querySelector('.bz-strip__right .publish-window__chip'),
      theme: !!document.querySelector('.bz-strip .theme-toggle'),
    }));
    t.eq(gone.topbar.join(','), '', 'no Gallery, Help, Present or theme chip is left showing at the top');
    t.ok(!gone.present && !gone.right && gone.eyeIn && gone.publishIn && !gone.theme, `Present is a View item, the eye button and Publish are in the strip (${JSON.stringify(gone)})`);
    const pub = await page.evaluate(() => document.querySelector('.publish-window__chip').hidden);
    t.ok(pub, 'Publish stays out of sight until a sign-in is found');

    // The hide button, in the strip: it hides the interface, and stays to bring it back.
    await page.click('.bz-strip__hide');
    await page.waitForFunction(() => document.body.classList.contains('chrome-hidden'), null, { timeout: 4000 });
    t.ok(await shown(page, '.bz-strip__hide'), 'with the interface hidden the strip\'s button stays');
    // The old rule fades the names out over a moment before they go.
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bz-menuname')).visibility === 'hidden', null, { timeout: 4000 }).catch(() => {});
    t.ok(!(await shown(page, '.bz-menuname')) && !(await shown(page, '.bz-readout')), 'and the menus and the readout go');
    await page.click('.bz-strip__hide');
    await page.waitForFunction(() => !document.body.classList.contains('chrome-hidden'), null, { timeout: 4000 });
    t.ok(await shown(page, '.bz-menuname'), 'it brings them back');
  },

  /** View: each switch acts and carries a check; the panels and Hide interface and Present are the old commands. */
  async shellView(page, base, t) {
    await openSculpt(page, base);
    const checked = (label) =>
      page.evaluate((l) => {
        const item = [...document.querySelectorAll('.file-menu--view .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === l);
        return item?.getAttribute('aria-checked');
      }, label);

    await openMenu(page, 'View');
    t.eq(await checked('Wireframe'), 'false', 'Wireframe starts unchecked');
    await pick(page, 'Wireframe');
    t.eq(await page.evaluate(() => window.__sculpt.viewer.isWireframe()), true, 'Wireframe turns the wireframe on');
    t.eq(await checked('Wireframe'), 'true', 'and shows its check');
    await pick(page, 'Wireframe');
    t.eq(await page.evaluate(() => window.__sculpt.viewer.isWireframe()), false, 'again, off');
    t.eq(await checked('Wireframe'), 'false', 'and the check goes');

    await pick(page, 'Poly group colours');
    t.eq(await page.evaluate(() => window.__sculpt.session.groups.isShowing()), true, 'Poly group colours shows them');
    t.eq(await checked('Poly group colours'), 'true', 'with a check');
    await pick(page, 'Poly group colours');
    t.eq(await page.evaluate(() => window.__sculpt.session.groups.isShowing()), false, 'and hides them again');

    // Hotkeys on tools: the digits on the bar.
    const digits = () => shown(page, '.sculpt-toolbar__brushes .sculpt-toolbar__key');
    const was = await digits();
    t.eq(await checked('Hotkeys on tools'), String(was), `Hotkeys on tools is ${was ? 'on' : 'off'}, as the pointer here decides (a mouse: on)`);
    await pick(page, 'Hotkeys on tools');
    t.eq(await digits(), !was, 'its switch hides or shows the digits on the tool bar');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bozzetto-settings') ?? '{}').toolKeys ?? 'default');
    t.eq(stored, was ? 'off' : 'default', 'and is stored');
    await pick(page, 'Hotkeys on tools');
    t.eq(await digits(), was, 'the same item puts them back');
    await closeMenu(page);

    // The panels: a check while open, and the item opens or closes it.
    for (const [label, cls] of [['Scene panel', 'panel--scene'], ['Model panel', 'panel--model'], ['Tool panel', 'panel--sculpt'], ['Render panel', 'panel--render']]) {
      await openMenu(page, 'View');
      t.eq(await checked(label), 'false', `${label}: unchecked while closed`);
      await pick(page, label);
      t.eq(await isOpen(page, cls), true, `${label}: the item opens it`);
      t.eq(await checked(label), 'true', `${label}: and is checked`);
      await pick(page, label);
      t.eq(await isOpen(page, cls), false, `${label}: the item again closes it`);
      await closeMenu(page);
    }

    // Frame all and Frame selected run the commands F and A run.
    await page.evaluate(() => {
      window.__sculpt.viewer.camera.position.set(0, 0, 900);
    });
    const before = await page.evaluate(() => window.__sculpt.viewer.camera.position.length());
    await openMenu(page, 'View');
    await pick(page, 'Frame selected');
    const after = await page.evaluate(() => window.__sculpt.viewer.camera.position.length());
    t.ok(Math.abs(after - before) > 1, `Frame selected moves the view (${before.toFixed(0)} to ${after.toFixed(0)})`);

    // Present, from the menu; the path's Sculpt step leaves.
    await openMenu(page, 'View');
    await pick(page, 'Present');
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    t.ok(await shown(page, '.bz-strip'), 'Present, from View: the strip stays');
    t.ok(await shown(page, '.present-bar'), 'and its bar is up');
    await page.click('.bz-ws__step[data-workspace="sculpt"]');
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });

    // Hide interface, from the menu.
    await openMenu(page, 'View');
    await pick(page, 'Hide interface');
    await page.waitForFunction(() => document.body.classList.contains('chrome-hidden'), null, { timeout: 4000 });
    t.ok(true, 'Hide interface hides the interface');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('chrome-hidden'), null, { timeout: 4000 });
  },

  /** File > Close does what the Gallery chip did. */
  async shellClose(page, base, t) {
    await openSculpt(page, base);
    await openMenu(page, 'File');
    await Promise.all([page.waitForURL((u) => u.pathname === '/' && !u.search.includes('sculpt'), { timeout: 60_000, waitUntil: 'commit' }), pick(page, 'Close')]);
    t.ok(true, 'Close leaves Sculpt for the gallery');
    await page.waitForFunction(() => !window.__sculpt, null, { timeout: 30_000 });

    await openArmature(page, base);
    await openMenu(page, 'File');
    const items = await page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].map((b) => b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim()));
    t.eq(items.at(-1), 'Close', 'Armature\'s File menu ends in Close too');
    await Promise.all([page.waitForURL((u) => u.pathname === '/' && !u.search.includes('armature'), { timeout: 60_000, waitUntil: 'commit' }), pick(page, 'Close')]);
    t.ok(true, 'and it returns to the gallery');
  },

  /**
   * The workspace path (Armature > Sculpt > Present) in each workspace, Present as a
   * workspace (its bar, its Output tab, Publish only there), and the Armature step's ask.
   */
  async shellWorkspaces(page, base, t) {
    const path = () =>
      page.evaluate(() => [...document.querySelectorAll('.bz-ws__step')].map((b) => `${b.textContent}${b.getAttribute('aria-current') === 'step' ? '*' : ''}${b.getAttribute('aria-disabled') === 'true' ? '(dim)' : ''}`).join(' > '));
    const step = (id) => page.click(`.bz-ws__step[data-workspace="${id}"]`);

    // --- Sculpt -------------------------------------------------------------
    await openSculpt(page, base);
    await page.addStyleTag({ content: '.panel { transition: none !important; }' });
    t.eq(await path(), 'Armature > Sculpt* > Present', 'Sculpt: the path reads Armature, Sculpt, Present with Sculpt current');
    const look = await page.evaluate(() => {
      const css = (el) => getComputedStyle(el);
      const r = (el) => el.getBoundingClientRect();
      const cur = document.querySelector('.bz-ws__step[aria-current="step"]');
      const other = document.querySelector('.bz-ws__step[data-workspace="present"]');
      const sep = document.querySelector('.bz-strip__sep');
      const arrow = document.querySelector('.bz-ws__sep');
      return {
        curBg: css(cur).backgroundColor, curColor: css(cur).color, curWeight: css(cur).fontWeight, size: css(cur).fontSize,
        h: r(cur).height, pad: css(cur).paddingLeft, otherColor: css(other).color, otherWeight: css(other).fontWeight,
        sepW: r(sep).width, sepH: r(sep).height, sepBg: css(sep).backgroundColor, arrowColor: css(arrow).color, arrows: document.querySelectorAll('.bz-ws__sep').length,
        after: r(document.querySelector('.bz-ws')).left >= r(document.querySelector('.bz-strip__menus')).right,
      };
    });
    t.ok(look.curBg === 'rgb(34, 34, 34)' && look.curColor === 'rgb(242, 242, 242)' && look.curWeight === '600' && look.size === '13px', `the current step: the viewport's fill, text colour, weight 600, 13px (${JSON.stringify(look)})`);
    t.ok(look.h === 24 && look.pad === '10px' && look.otherColor === 'rgb(179, 179, 179)' && look.otherWeight === '400', 'steps are 24px tall with 10px sides; the others are secondary text');
    t.ok(look.sepW === 1 && look.sepH === 12 && look.sepBg === 'rgb(68, 68, 68)' && look.arrowColor === 'rgb(125, 125, 125)' && look.arrows === 2 && look.after, 'a 1x12 separator after the menus, and a dim arrow between the steps');
    await page.hover('.bz-ws__step[data-workspace="present"]');
    const hov = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.bz-ws__step[data-workspace="present"]'));
      return [s.backgroundColor, s.color];
    });
    t.eq(hov.join('|'), 'rgb(75, 75, 75)|rgb(242, 242, 242)', 'a hovered step takes the hover fill and full text');

    // Publish is not in the strip in Sculpt, signed in or not.
    const chip = () => shown(page, '.publish-window__chip');
    await page.evaluate(() => window.__sculpt.publishWindow.setAvailable(true));
    t.ok(!(await chip()), 'Sculpt: no Publish button in the strip, even signed in');
    await openMenu(page, 'File');
    t.ok(await pick(page, 'Publish…'), 'File has Publish…');
    t.ok(await page.evaluate(() => window.__sculpt.publishWindow.isOpen()), 'and File > Publish… opens the window in Sculpt');
    await page.evaluate(() => window.__sculpt.publishWindow.close());

    // --- Present: pressing the step ------------------------------------------
    await step('present');
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    t.eq(await path(), 'Armature > Sculpt > Present*', 'pressing Present enters it, Present current');
    t.ok(await chip(), 'Present: Publish shows in the strip, signed in');
    const pub = await page.evaluate(() => {
      const el = document.querySelector('.publish-window__chip');
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, h: el.getBoundingClientRect().height, text: el.textContent };
    });
    t.ok(pub.bg === 'rgb(255, 90, 31)' && pub.color === 'rgb(0, 0, 0)' && pub.h === 24 && pub.text === 'Publish', `filled orange with black text, 24px (${JSON.stringify(pub)})`);
    const ro = await page.evaluate(() => ({
      keys: [...document.querySelectorAll('.bz-readout__item:not([hidden]) .bz-readout__key')].map((k) => k.textContent),
      frame: document.querySelector('.bz-readout__frame')?.textContent,
      view: window.__sculpt.viewer.viewportSize(),
    }));
    t.ok(ro.keys.join() === 'Frame' && ro.frame === `${ro.view.w} × ${ro.view.h}`, `the readout is Frame W × H (${JSON.stringify(ro)})`);
    const ws = await page.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
      const tabs = [...document.querySelectorAll('.panel > .panel__handle')].filter((h) => h.getClientRects().length > 0).map((h) => ({ n: h.querySelector('.handle__label').textContent, l: h.getBoundingClientRect().left }));
      return { toolbar: vis('.sculpt-toolbar__brushes'), edge: vis('.bz-edge'), tabs: tabs.sort((a, b) => a.l - b.l).map((x) => x.n).join(), done: !!document.querySelector('.present-bar__done') };
    });
    t.ok(!ws.toolbar && !ws.edge && ws.tabs === 'Render,Output' && !ws.done, `no tool bar, no edge controls, no left tabs; the tabs are Render, Output, and there is no Done (${JSON.stringify(ws)})`);

    // The bar: bottom centre, flush, the panel's colour.
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.present-bar');
      const r = el.getBoundingClientRect();
      return {
        bottom: r.bottom, h: innerHeight, centre: r.left + r.width / 2, w: innerWidth, bg: getComputedStyle(el).backgroundColor,
        kids: [...el.querySelectorAll('button, .compact')].map((k) => k.className.split(' ').find((c) => c.startsWith('present-bar__') && c !== 'present-bar__btn') ?? k.className),
        play: el.querySelector('.present-bar__play .fi')?.className,
      };
    });
    t.ok(bar.bottom === bar.h && Math.abs(bar.centre - bar.w / 2) < 1 && bar.bg === 'rgb(44, 44, 44)', `the bar is at the bottom centre, flush, on the panel colour (${JSON.stringify(bar)})`);
    t.ok(bar.kids.join() === 'present-bar__play,present-bar__speed,present-bar__save' && /fi-ss-play/.test(bar.play), 'it holds the play button (fi-ss-play), the Speed field and Save image');
    await page.click('.present-bar__play');
    t.ok(await page.evaluate(() => /fi-ss-pause/.test(document.querySelector('.present-bar__play .fi').className) && window.__sculpt.present.isTurning()), 'play turns the turntable and the glyph becomes pause (fi-ss-pause)');
    await page.click('.present-bar__play');

    // The Output panel: the existing controls, moved.
    const out = await page.evaluate(() => {
      const p = document.querySelector('.panel--output');
      return {
        open: !p.classList.contains('panel--collapsed'),
        heading: p.querySelector('.panel__title').textContent,
        sections: [...p.querySelectorAll('.section h3')].map((h) => h.textContent).join(),
        buttons: [...p.querySelectorAll('button:not(.panel__handle)')].filter((b) => b.getClientRects().length > 0).map((b) => b.textContent).join(),
        selects: [...p.querySelectorAll('select')].map((x) => [...x.options].map((o) => o.textContent).join('/')).join(' | '),
      };
    });
    t.ok(out.open && out.heading === 'Output' && out.sections === 'Image,Turntable', `Output is open with the heading and sections Image and Turntable (${JSON.stringify(out)})`);
    t.ok(out.buttons === 'Save image,Save turntable' && out.selects === 'MP4/GIF | Window, 1x/Window, 2x', `with Save image, the format and size choices and Save turntable (${out.buttons}; ${out.selects})`);
    await page.selectOption('.present-out__format', 'gif');
    await page.selectOption('.present-out__size', '2');
    t.ok(await page.evaluate(() => window.__sculpt.present.getClipFormat() === 'gif' && window.__sculpt.present.getClipScale() === 2), 'the format and size selects set the clip');
    await page.selectOption('.present-out__format', 'mp4');
    await page.selectOption('.present-out__size', '1');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('.present-out__save')]);
    t.eq(dl.suggestedFilename(), 'Sculpt.png', 'Save image in the Output panel saves the PNG');
    // Render is the other tab; opening it closes Output.
    await tab(page, 'panel--render');
    t.ok((await isOpen(page, 'panel--render')) && !(await isOpen(page, 'panel--output')), 'the Render tab opens Render and closes Output');
    await tab(page, 'panel--output');
    t.ok((await isOpen(page, 'panel--output')) && !(await isOpen(page, 'panel--render')), 'and Output takes it back');

    // --- Present > Sculpt, and Esc --------------------------------------------
    await step('sculpt');
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
    t.eq(await path(), 'Armature > Sculpt* > Present', 'the Sculpt step leaves Present');
    t.ok(!(await chip()) && !(await shown(page, '.panel--output .panel__handle')), 'Publish and the Output tab are gone with it');
    await page.keyboard.press('Shift+P');
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
    t.eq(await path(), 'Armature > Sculpt* > Present', 'Esc leaves too');

    // --- the Armature step asks ------------------------------------------------
    await step('armature');
    await page.waitForSelector('.bz-ask');
    const ask = await page.evaluate(() => ({
      title: document.querySelector('.bz-ask h2').textContent,
      primary: [...document.querySelectorAll('.bz-ask .btn--primary')].map((b) => b.textContent),
      buttons: [...document.querySelectorAll('.bz-ask button')].map((b) => b.textContent),
    }));
    t.ok(ask.title === 'Make a new armature for this scene?' && ask.primary.join() === 'New armature' && ask.buttons.join() === 'New armature,Cancel', `Sculpt's Armature step asks "Make a new armature for this scene?", one orange choice and Cancel (${JSON.stringify(ask)})`);
    await page.click('.bz-ask-cancel');
    t.ok(!(await page.evaluate(() => !!document.querySelector('.bz-ask'))) && new URL(page.url()).searchParams.get('sculpt') === '1', 'Cancel closes it and stays in Sculpt');
    await step('armature');
    await page.waitForSelector('.bz-ask');
    await page.keyboard.press('Escape');
    t.ok(!(await page.evaluate(() => !!document.querySelector('.bz-ask'))), 'Esc says no too');
    // Yes, twice: first from a scene nothing was done to (a plain send would make
    // way for the figure there), then from one that has the figure already.
    for (const round of [1, 2]) {
      const before = await page.evaluate(() => window.__sculpt.session.getMeshes().length);
      await step('armature');
      await page.waitForSelector('.bz-ask');
      await Promise.all([page.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 }), page.click('.bz-ask-yes')]);
      await page.waitForTimeout(300);
      if (round === 1) {
        t.eq(await path(), 'Armature* > Sculpt > Present(dim)', 'Armature: the path has Armature current and Present dim');
        const dim = await page.evaluate(() => {
          const el = document.querySelector('.bz-ws__step[data-workspace="present"]');
          return { color: getComputedStyle(el).color, title: el.title, disabled: el.getAttribute('aria-disabled') };
        });
        t.ok(dim.color === 'rgb(125, 125, 125)' && /sent to Sculpt first/.test(dim.title) && dim.disabled === 'true', `Present is dim, with a title saying a figure is sent to Sculpt first (${JSON.stringify(dim)})`);
        await page.click('.bz-ws__step[data-workspace="present"]', { force: true });
        t.ok(!!(await page.evaluate(() => window.__armature)) && new URL(page.url()).searchParams.get('armature') === '1', 'pressing it does nothing');
        t.eq(await page.evaluate(() => !!document.querySelector('.bz-strip .publish-window__chip')), false, 'Armature: no Publish button in the strip');
      }
      // Sculpt step = File > Send to Sculpt: the figure is added to the scene it came from.
      await Promise.all([page.waitForURL(/sculpt=1/, { timeout: 60_000 }), step('sculpt')]);
      await page.waitForFunction((n) => !!window.__sculpt && window.__sculpt.session.getMeshes().length === n + 1, before, { timeout: 180_000 });
      const arrived = await page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));
      t.ok(arrived.length === before + 1 && arrived.includes('Sphere') && arrived.filter((n) => /^Figure/.test(n)).length === round, `round ${round}: the Sculpt step sends the figure, added to the scene as a new object, replacing nothing (${arrived.join(', ')})`);
    }
  },

  /** One panel a side under folder tabs; the heading; remembered per mode. */
  async shellPanels(page, base, t) {
    await openSculpt(page, base);
    await page.addStyleTag({ content: '.panel, .panel * { transition: none !important; }' });
    const rows = () => page.evaluate(() => ['scene', 'model', 'sculpt', 'render'].map((c) => !document.querySelector(`.panel--${c}`).classList.contains('panel--collapsed')));
    t.eq((await rows()).join(), 'false,false,false,false', 'all four start closed');

    // The tabs: two a side, 1px apart, 28px tall, 4px under the strip, at the edge.
    const tabs = await page.evaluate(() =>
      Object.fromEntries(
        ['scene', 'model', 'sculpt', 'render'].map((c) => {
          const r = document.querySelector(`.panel--${c} .panel__handle`).getBoundingClientRect();
          const s = getComputedStyle(document.querySelector(`.panel--${c} .panel__handle`));
          return [c, { l: r.left, r: r.right, t: r.top, h: r.height, bg: s.backgroundColor, color: s.color, weight: s.fontWeight, size: s.fontSize, mode: s.writingMode }];
        }),
      ),
    );
    t.ok(tabs.scene.l === 0 && tabs.render.r === 1280, 'the outer tabs are flush to the screen\'s edges');
    t.near(tabs.model.l - tabs.scene.r, 1, 0.5, 'Scene and Model are 1px apart');
    t.near(tabs.render.l - tabs.sculpt.r, 1, 0.5, 'Tool and Render are 1px apart');
    t.ok(Object.values(tabs).every((x) => x.t === 28 && x.h === 28 && x.size === '13px' && x.mode === 'horizontal-tb'), 'each is 28px tall, 4px under the strip, 13px, set horizontally');
    t.ok(/27, 27, 27/.test(tabs.scene.bg) && /179, 179, 179/.test(tabs.scene.color), `a closed tab: the strip's colour, secondary text (${tabs.scene.bg}, ${tabs.scene.color})`);

    // Pressing a closed tab opens its panel and closes the other of the side.
    await tab(page, 'panel--scene');
    t.eq((await rows()).join(), 'true,false,false,false', 'Scene opens');
    await tab(page, 'panel--model');
    t.eq((await rows()).join(), 'false,true,false,false', 'Model opens and Scene closes');
    await tab(page, 'panel--sculpt');
    await tab(page, 'panel--render');
    t.eq((await rows()).join(), 'false,true,false,true', 'on the right, Render opens and Tool closes, and the left stays');
    await tab(page, 'panel--render');
    t.eq((await rows()).join(), 'false,true,false,false', 'pressing the open tab closes its panel');

    // The open tab and its panel are one: the panel's fill, bold, no gap, 304px, no close button.
    const open = await page.evaluate(() => {
      const p = document.querySelector('.panel--model');
      const h = p.querySelector('.panel__handle');
      const pr = p.getBoundingClientRect();
      const hr = h.getBoundingClientRect();
      const hs = getComputedStyle(h);
      const ps = getComputedStyle(p);
      return {
        w: pr.width,
        top: pr.top,
        gap: pr.top - hr.bottom,
        sameFill: hs.backgroundColor === ps.backgroundColor,
        weight: hs.fontWeight,
        color: hs.color,
        close: p.querySelector('.panel__close') ? getComputedStyle(p.querySelector('.panel__close')).display : 'none',
        heading: p.querySelector('.panel__title').textContent,
        headingSize: getComputedStyle(p.querySelector('.panel__title')).fontSize,
        headingWeight: getComputedStyle(p.querySelector('.panel__title')).fontWeight,
        arrow: p.querySelector('.handle__arrow') ? getComputedStyle(p.querySelector('.handle__arrow')).display : 'none',
      };
    });
    t.ok(open.w === 304 && open.top === 56 && open.gap === 0, `the panel is 304px wide under the tab row, joined to its tab (${open.w}, ${open.top}, gap ${open.gap})`);
    t.ok(open.sameFill && Number(open.weight) >= 600 && /242, 242, 242/.test(open.color), 'the open tab is the panel\'s fill, bold, in the text colour');
    t.ok(open.close === 'none' && open.arrow === 'none', 'there is no close button and no chevron');
    t.ok(open.heading === 'Sphere' && open.headingSize === '20px' && Number(open.headingWeight) >= 600, `the Model heading is the object's name (${open.heading}, ${open.headingSize})`);

    // The headings of the others.
    await tab(page, 'panel--scene');
    await tab(page, 'panel--sculpt');
    const heads = await page.evaluate(() => ({ scene: document.querySelector('.panel--scene .panel__title').textContent, tool: document.querySelector('.panel--sculpt .panel__title').textContent }));
    t.eq(heads.scene, 'Scene', 'the Scene heading');
    t.eq(heads.tool, 'Standard clay', 'the Tool heading is the tool in hand');
    await page.keyboard.press('4');
    await page.waitForFunction(() => document.querySelector('.panel--sculpt .panel__title').textContent === 'Inflate', null, { timeout: 4000 });
    t.ok(true, 'and follows the tool (hotkey 4: Inflate)');
    await tab(page, 'panel--render');
    t.eq(await page.evaluate(() => document.querySelector('.panel--render .panel__title').textContent), 'Render', 'the Render heading');
    await tab(page, 'panel--render');

    // Its name, as the model is renamed.
    await tab(page, 'panel--model');
    await page.evaluate(() => {
      const s = window.__sculpt.session;
      s.setMeshName(s.getMesh(), 'Egg');
    });
    await page.waitForFunction(() => document.querySelector('.panel--model .panel__title').textContent === 'Egg', null, { timeout: 4000 });
    t.ok(true, 'and follows its rename');

    // The height: as tall as the content up to 16px above what is below; then it scrolls.
    const lim = await page.evaluate(() => {
      const p = document.querySelector('.panel--model');
      const e = document.querySelector('.bz-edge').getBoundingClientRect();
      const b = p.querySelector('.panel__body');
      return { bottom: p.getBoundingClientRect().bottom, edge: e.top, scrolls: b.scrollHeight > b.clientHeight, sb: getComputedStyle(b).scrollbarWidth };
    });
    t.ok(lim.bottom <= lim.edge - 16 + 1, `Model stops 16px above the edge controls (${lim.bottom} against ${lim.edge})`);
    t.ok(lim.scrolls, 'and scrolls inside when it needs more');
    const right = await page.evaluate(() => {
      const p = document.querySelector('.panel--sculpt');
      return { bottom: p.getBoundingClientRect().bottom, vh: window.innerHeight };
    });
    t.ok(right.bottom <= right.vh - 16 + 1, `the right panel stops 16px above the bottom (${right.bottom} of ${right.vh})`);
    // A shorter window: the limit follows the resize.
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.waitForFunction(() => document.querySelector('.panel--sculpt').getBoundingClientRect().bottom <= 600 - 16 + 1, null, { timeout: 5000 });
    t.ok(true, 'and follows a resize');
    await page.setViewportSize({ width: 1280, height: 800 });

    // Remembered: what is open comes back after a reload.
    await tab(page, 'panel--sculpt');
    await tab(page, 'panel--render');
    const stored = await page.evaluate(() => localStorage.getItem('bz.panels.sculpt'));
    t.ok(/model/.test(stored ?? '') && /settings/.test(stored ?? ''), `the open panels are kept (${stored})`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    t.eq((await rows()).join(), 'false,true,false,true', 'and open again on the next visit');
    // A stored state with two on one side opens the first only.
    await page.evaluate(() => localStorage.setItem('bz.panels.sculpt', JSON.stringify(['scene', 'model', 'sculpt', 'settings'])));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    t.eq((await rows()).join(), 'true,false,true,false', 'a store with two on one side opens the first only');
    // Tab closes them all, as before.
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    t.eq((await rows()).join(), 'false,false,false,false', 'Tab still closes every panel');
  },

  /** The tool bar, the edge controls and the brush fields. */
  async shellEdge(page, base, t) {
    await openSculpt(page, base);
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.sculpt-toolbar__brushes').getBoundingClientRect();
      const tools = [...document.querySelectorAll('.sculpt-toolbar__brushes .sculpt-toolbar__btn')].map((b) => {
        const q = b.getBoundingClientRect();
        return { w: q.width, h: q.height, left: q.left, icon: getComputedStyle(b.querySelector('.fi, .sculpt-toolbar__svg')).fontSize + '/' + getComputedStyle(b.querySelector('.fi, .sculpt-toolbar__svg')).width };
      });
      const digit = getComputedStyle(document.querySelector('.sculpt-toolbar__key'));
      return { l: r.left, r: r.right, b: r.bottom, w: r.width, vh: window.innerHeight, tools, digit: { font: digit.fontFamily, size: digit.fontSize, color: digit.color }, pad: getComputedStyle(document.querySelector('.sculpt-toolbar__brushes')).padding };
    });
    t.eq(bar.b, bar.vh, 'the tool bar is flush to the bottom edge');
    t.near((bar.l + bar.r) / 2, 640, 1, 'and centred');
    t.eq(bar.tools.length, 12, 'twelve tools');
    t.ok(bar.tools.every((x) => x.w === 44 && x.h === 44), 'each a 44px square');
    t.near(bar.w, 12 * 44 + 11 * 4 + 24, 1, 'in one box only as wide as its tools: 4px between, 12px at the sides');
    t.ok(bar.pad === '8px 12px', `padding 8px 12px (${bar.pad})`);
    t.ok(/Martian/.test(bar.digit.font) && bar.digit.size === '11px' && /179, 179, 179/.test(bar.digit.color), `the digit is mono 11px, secondary (${bar.digit.font}, ${bar.digit.size})`);
    const active = await page.evaluate(() => {
      const b = document.querySelector('.sculpt-toolbar__brushes .sculpt-toolbar__btn--active');
      return { bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, digit: getComputedStyle(b.querySelector('.sculpt-toolbar__key')).color };
    });
    t.ok(/255, 90, 31/.test(active.bg) && /0, 0, 0/.test(active.color) && /0, 0, 0/.test(active.digit), `the tool in hand is orange with a black icon and digit (${active.bg})`);

    // The tooltip: the tool's name and hotkey in a box above it.
    await page.hover('.sculpt-toolbar__brushes .sculpt-toolbar__btn:nth-child(5)');
    const tip = await page.evaluate(() => {
      const b = document.querySelector('.sculpt-toolbar__brushes .sculpt-toolbar__btn:nth-child(5)');
      const tipEl = b.querySelector('.bz-tip');
      const r = tipEl.getBoundingClientRect();
      return { shown: getComputedStyle(tipEl).display, text: tipEl.querySelector('.bz-tip__name').textContent, key: tipEl.querySelector('.bz-tip__key').textContent, above: r.bottom <= b.getBoundingClientRect().top, native: b.title };
    });
    t.ok(tip.shown !== 'none' && tip.text === 'Inflate' && tip.key === '4' && tip.above && tip.native === '', `hovering a tool names it above, with its hotkey (${JSON.stringify(tip)})`);
    await page.mouse.move(640, 300);

    // Edge controls, bottom up: Negative, Undo, Redo, Solo, then the fields.
    const edge = await page.evaluate(() => {
      const q = (s) => {
        const e = document.querySelector(s);
        const r = e.getBoundingClientRect();
        return { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, box: getComputedStyle(e).boxShadow + getComputedStyle(e).borderTopWidth };
      };
      return {
        neg: q('.bz-edge .sculpt-toolbar__btn'),
        undo: q('.bz-edge [data-hist="undo"]'),
        redo: q('.bz-edge [data-hist="redo"]'),
        solo: q('.bz-edge .sculpt-solobtn'),
        size: q('.sculpt-slider[data-kind="size"]'),
        strength: q('.sculpt-slider[data-kind="strength"]'),
        vh: window.innerHeight,
      };
    });
    t.ok(edge.neg.t > edge.undo.t && edge.undo.t > edge.redo.t && edge.redo.t > edge.solo.t && edge.solo.t > edge.strength.t && edge.strength.t > edge.size.t, 'the column is, bottom up: Negative, Undo, Redo, Solo, Strength, Size');
    t.ok([edge.neg, edge.undo, edge.redo, edge.solo].every((b) => b.w === 40 && b.h === 40 && Math.round(b.l) === 16), 'the four buttons are 40px squares, 16px in');
    t.eq(edge.neg.b, edge.vh - 16, 'and the column stands 16px up from the bottom');
    t.ok([edge.neg, edge.undo].every((b) => /0, 0, 0, 0/.test(b.bg) || b.bg === 'transparent'), 'with no box behind them');
    t.ok(/125, 125, 125/.test(edge.undo.color) && /125, 125, 125/.test(edge.redo.color), `Undo and Redo with nothing to do are dim (${edge.undo.color})`);
    t.ok(edge.size.w === 44 && edge.size.h === 160 && edge.strength.h === 160, 'the fields are 44px wide zones, 160px tall');
    const field = await page.evaluate(() => {
      const el = document.querySelector('.sculpt-slider[data-kind="size"]');
      const track = getComputedStyle(el.querySelector('.sculpt-slider__track'));
      const fill = getComputedStyle(el, '::after');
      const val = getComputedStyle(el.querySelector('.sculpt-slider__val'));
      return { track: track.width + ' ' + track.backgroundColor, fill: fill.width + ' ' + fill.backgroundColor, val: val.fontFamily + ' ' + val.fontSize, text: el.querySelector('.sculpt-slider__val').textContent };
    });
    t.ok(/^1px/.test(field.track) && /92, 92, 92/.test(field.track), `a 1px line (${field.track})`);
    t.ok(/^3px/.test(field.fill) && /255, 90, 31/.test(field.fill), `the amount in orange, 3px wide (${field.fill})`);
    t.ok(/Martian/.test(field.val) && /11px/.test(field.val) && field.text !== '', `the value above it in mono 11px ("${field.text}")`);

    // They drag as ever.
    const r = await box(page, '.sculpt-slider[data-kind="strength"]');
    const before = await page.evaluate(() => window.__sculpt.input.getBrushIntensity());
    await page.mouse.move(r.left + 22, r.bottom - 10);
    await page.mouse.down();
    await page.mouse.move(r.left + 22, r.top + 40, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.__sculpt.input.getBrushIntensity());
    t.ok(after > before, `dragging up in the zone raises the strength (${before} to ${after})`);

    // They show with the Tool panel closed, and not while it is open.
    t.ok(await shown(page, '.bz-edge__fields'), 'the fields show with the Tool panel closed');
    await tab(page, 'panel--sculpt');
    await page.waitForFunction(() => document.querySelector('.bz-edge__fields').hidden, null, { timeout: 4000 });
    t.ok(true, 'and go while it is open');
    t.ok((await shown(page, '.bz-edge .sculpt-solobtn')) && (await shown(page, '.bz-edge [data-hist="undo"]')) && (await shown(page, '.bz-edge .sculpt-toolbar__btn')), 'Undo, Redo, Solo and Negative always show');
    await page.keyboard.press(']');
    await page.waitForFunction(() => !document.querySelector('.bz-edge__fields').hidden, null, { timeout: 4000 });
    t.ok(true, 'a size change by hotkey brings them up for a moment');
    await page.waitForFunction(() => document.querySelector('.bz-edge__fields').hidden, null, { timeout: 5000 });
    t.ok(true, 'and they go again');
    await tab(page, 'panel--sculpt');
    await page.waitForFunction(() => !document.querySelector('.bz-edge__fields').hidden, null, { timeout: 4000 });
    t.ok(true, 'closing the Tool panel brings them back');
    // An open left panel has the edge to itself.
    await tab(page, 'panel--model');
    await page.waitForFunction(() => document.querySelector('.bz-edge__fields').hidden, null, { timeout: 4000 });
    t.ok(true, 'they go while a left panel is open');
    await tab(page, 'panel--model');
    await page.waitForFunction(() => !document.querySelector('.bz-edge__fields').hidden, null, { timeout: 4000 });
    t.ok(true, 'and come back when it closes');
  },

  /** Armature: the same strip and tabs, with the panels it has. */
  async shellArmature(page, base, t) {
    await openArmature(page, base);
    const names = await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].map((b) => b.textContent));
    t.eq(names.join(','), 'File,Edit,View,Help', 'Armature has the four menus');
    const view = await openMenu(page, 'View');
    t.eq(view.items.join('|'), 'Frame all|Wireframe|Armature panel|Render panel|Hide interface|Sculpt', 'its View menu has what applies');
    await closeMenu(page);
    t.ok(await shown(page, '.bz-strip__hide'), 'the eye button is in the strip');
    const tabs = await page.evaluate(() => ['armature', 'render'].map((c) => document.querySelector(`.panel--${c} .panel__handle`).getBoundingClientRect()).map((r) => [r.left, r.right, r.top, r.height]));
    t.ok(tabs[0][0] === 0 && tabs[1][1] === 1280 && tabs[0][2] === 28 && tabs[0][3] === 28, 'its Armature tab is at the left edge and Render at the right');
    await tab(page, 'panel--armature');
    await tab(page, 'panel--render');
    const state = await page.evaluate(() => ({
      a: !document.querySelector('.panel--armature').classList.contains('panel--collapsed'),
      r: !document.querySelector('.panel--render').classList.contains('panel--collapsed'),
      title: document.querySelector('.panel--armature .panel__title').textContent,
      w: document.querySelector('.panel--armature').getBoundingClientRect().width,
      bottom: document.querySelector('.panel--armature').getBoundingClientRect().bottom,
      edge: document.querySelector('.bz-edge').getBoundingClientRect().top,
    }));
    t.ok(state.a && state.r && state.title === 'Armature' && state.w === 304, `one panel open a side, 304px wide (${JSON.stringify(state)})`);
    t.ok(state.bottom <= state.edge - 16 + 1, 'the left one stops above the undo and redo buttons');
    await tab(page, 'panel--armature');
    t.eq(await isOpen(page, 'panel--armature'), false, 'pressing the open tab closes it');
  },
};
