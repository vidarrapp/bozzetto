// The title strip's menus are one shape in every place (docs/ui-spec.md, section 5):
// File, Edit, View, Moderation (the viewer, when it has an item), Help; the same
// three Help items; Edit ending in Preferences…; File and View in their groups.
// `readMenus` and `checkShape` are shared with the viewer and Present workspace
// suites (viewerFrame.mjs, framePresent.mjs); the suite here walks Sculpt,
// Present from Sculpt and Armature.
import { openArmature, openSculpt } from './lib.mjs';

const HELP = ['Help topics', 'Hotkeys', 'About and credits'];

/** Where each File label sits in the order of its groups. */
const FILE_RANK = new Map([
  ['New sculpt', 0], ['New armature', 0], ['Open…', 0], ['Open recent', 0],
  ['Save file', 1], ['Save to library', 1], ['Keep on this device', 1], ['Save', 1],
  ['Import OBJ…', 2], ['Z-up OBJ import', 2], ['Load model…', 2], ['Export OBJ', 2], ['Send to Sculpt', 2], ['New sculpt from this', 2], ['Edit in Present', 2],
  ['Publish…', 3],
  ['Close', 4],
]);

const viewRank = (label) => {
  if (label === 'Frame selected' || label === 'Frame all') return 0;
  if (['Wireframe', 'Shadows', 'Poly group colours', 'Hotkeys on tools'].includes(label)) return 1;
  if (/ panel$/.test(label) || label === 'Hide interface') return 2;
  if (['Armature', 'Sculpt', 'Present'].includes(label)) return 3;
  return -1;
};

/** Open each menu of the strip in turn and read its rows: { File: [{ label, key, hint, disabled } | { sep: true }], ... } in the strip's order. */
export async function readMenus(page, place = '') {
  // MENU_SHOTS=<dir>: a picture of each File and View menu at 1180x820, named by place.
  const shots = process.env.MENU_SHOTS && place ? process.env.MENU_SHOTS : '';
  const was = page.viewportSize();
  if (shots) await page.setViewportSize({ width: 1180, height: 820 });
  const names = await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].filter((b) => !b.hidden).map((b) => b.textContent));
  const menus = {};
  for (const name of names) {
    await page.evaluate((n) => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === n)?.click(), name);
    await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
    menus[name] = await page.evaluate(() => {
      const pop = [...document.querySelectorAll('.file-menu')].find((p) => !p.hidden);
      return [...pop.children]
        .filter((c) => c.classList.contains('file-menu__sep') || (c.classList.contains('file-menu__item') && !c.classList.contains('file-menu__choice')))
        .map((c) =>
          c.classList.contains('file-menu__sep')
            ? { sep: true }
            : {
                label: c.querySelector('.file-menu__label')?.textContent ?? c.textContent.trim(),
                key: c.querySelector('.file-menu__key')?.textContent ?? '',
                hint: c.querySelector('.file-menu__hint')?.textContent ?? '',
                disabled: !!c.disabled,
              },
        );
    });
    if (shots && (name === 'File' || name === 'View')) await page.screenshot({ path: `${shots}/${place.toLowerCase().replace(/ /g, '-')}-${name.toLowerCase()}.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  }
  if (shots && was) await page.setViewportSize(was);
  return menus;
}

const labels = (rows) => rows.filter((r) => !r.sep).map((r) => r.label);

/** Check ranks never go down and that a line sits exactly where the rank changes. */
function grouped(rows, rankOf) {
  let last = -1;
  let sep = false;
  let ok = true;
  for (const r of rows) {
    if (r.sep) {
      sep = true;
      continue;
    }
    const rank = rankOf(r.label);
    if (rank < 0 || rank < last) ok = false;
    if (last >= 0 && (rank !== last) !== sep) ok = false;
    last = rank;
    sep = false;
  }
  return ok && !sep;
}

/**
 * The shape checks for one place. `want` has the strip's menu names in order
 * (`names`), and may have the exact File and View labels (`file`, `view`).
 */
export function checkShape(t, place, menus, want) {
  t.eq(Object.keys(menus).join(','), want.names, `${place}: the menus are ${want.names.split(',').join(', ')}, in that order`);
  t.eq(labels(menus.Help).join('|'), HELP.join('|'), `${place}: Help has the same three items`);
  t.eq(labels(menus.Edit).at(-1), 'Preferences…', `${place}: Edit ends with Preferences…`);
  t.ok(grouped(menus.File, (l) => FILE_RANK.get(l) ?? (/^Save to /.test(l) ? 1 : -1)), `${place}: File comes in its groups, Close last (${labels(menus.File).join('|')})`);
  t.eq(labels(menus.File).at(-1), 'Close', `${place}: File ends with Close`);
  t.ok(grouped(menus.View, viewRank), `${place}: View comes in its groups: framing, looks, panels and Hide interface, workspaces (${labels(menus.View).join('|')})`);
  t.ok(!labels(menus.View).some((l) => /^Frame model$|^Cycle ground$/.test(l)), `${place}: View has no Frame model or Cycle ground`);
  if (want.file) t.eq(labels(menus.File).join('|'), want.file, `${place}: File has its items`);
  if (want.view) t.eq(labels(menus.View).join('|'), want.view, `${place}: View has its items`);
  if (want.edit) t.eq(labels(menus.Edit).join('|'), want.edit, `${place}: Edit has its items`);
}

export const suites = {
  /** Sculpt, Present from Sculpt and Armature: one shape. */
  async menuShape(page, base, t) {
    await openSculpt(page, base);
    const sculptFile = 'New sculpt|Open…|Open recent|Save file|Save to library|Keep on this device|Import OBJ…|Z-up OBJ import|Export OBJ|Publish…|Close';
    const sculptView = 'Frame selected|Frame all|Wireframe|Shadows|Poly group colours|Hotkeys on tools|Scene panel|Model panel|Material panel|Tool panel|Render panel|Hide interface|Armature|Sculpt|Present';
    const sculpt = await readMenus(page, 'Sculpt');
    checkShape(t, 'Sculpt', sculpt, { names: 'File,Edit,View,Help', file: sculptFile, view: sculptView });
    const ws = (menus) => Object.fromEntries(menus.View.filter((r) => ['Armature', 'Sculpt', 'Present'].includes(r.label)).map((r) => [r.label, r.disabled]));
    t.eq(JSON.stringify(ws(sculpt)), JSON.stringify({ Armature: false, Sculpt: true, Present: false }), 'Sculpt: the workspace you are in is greyed out');

    await page.keyboard.press('Shift+P');
    await page.waitForFunction(() => document.querySelector('.bz-ws__step--on')?.textContent?.includes('Present'), null, { timeout: 8000 });
    const present = await readMenus(page, 'Present from Sculpt');
    checkShape(t, 'Present from Sculpt', present, { names: 'File,Edit,View,Help', file: sculptFile, view: sculptView });
    t.eq(JSON.stringify(ws(present)), JSON.stringify({ Armature: false, Sculpt: false, Present: true }), 'Present from Sculpt: Present is greyed out and Sculpt is the way back');

    await openArmature(page, base);
    const armature = await readMenus(page, 'Armature');
    checkShape(t, 'Armature', armature, {
      names: 'File,Edit,View,Help',
      file: 'New armature|Open…|Open recent|Save file|Save to library|Load model…|Send to Sculpt|Close',
      view: 'Frame all|Wireframe|Shadows|Armature panel|Material panel|Render panel|Hide interface|Armature|Sculpt|Present',
      edit: 'Undo|Redo|Preferences…',
    });
    const a = armature.View.filter((r) => ['Armature', 'Sculpt', 'Present'].includes(r.label));
    t.ok(a[0].disabled && !a[1].disabled && a[2].disabled && a[2].hint.length > 0, `Armature: Armature is where you are, Sculpt goes, Present is greyed out with its reason ("${a[2].hint}")`);
    const key = (menus, menu, label) => menus[menu].find((r) => r.label === label)?.key;
    t.ok(/Shift/.test(key(sculpt, 'View', 'Shadows')) && key(sculpt, 'View', 'Shadows') === key(armature, 'View', 'Shadows'), 'Shadows has the same key in Sculpt and Armature');
  },
};
