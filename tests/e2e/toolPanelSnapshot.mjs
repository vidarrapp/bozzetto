// What the Tool panel shows for each tool, read from the live page: the
// heading, then every element of the panel's body in order (its kind, the
// classes that name it, its text, and for a control its type, range, step,
// value and whether it is hidden). Used twice: once on the code from before
// the tool registry (tests/e2e/recordToolPanel.mjs wrote
// fixtures/tool-panel.json from it) and again by the toolNames suite, which
// must read the same rows from the registry-built panel.
//
// Tools are put in hand by their engine number, which the page knows before
// and after the registry; the keys of the snapshot are the tools' word ids.

/** Word id, engine number and workspace, for the tools whose panel is read. */
export const SNAPSHOT_TOOLS = [
  ['bz.crease', 6, 'sculpt'],
  ['bz.move', 9, 'sculpt'],
  ['bz.clay', 0, 'sculpt'],
  ['bz.inflate', 1, 'sculpt'],
  ['bz.pinch', 5, 'sculpt'],
  ['bz.flatten', 4, 'sculpt'],
  ['bz.rake', 13, 'sculpt'],
  ['bz.drag', 7, 'sculpt'],
  ['bz.polish', 2, 'sculpt'],
  ['bz.smooth', 3, 'sculpt'],
  ['bz.mask', 10, 'sculpt'],
  ['bz.local-scale', 11, 'sculpt'],
  ['bz.paint', 8, 'paint'],
  ['bz.erase', 15, 'paint'],
  ['bz.blur', 16, 'paint'],
  ['bz.fill', 17, 'paint'],
  ['bz.pick', 18, 'paint'],
  ['bz.project', 19, 'paint'],
];

/** In the page: the Tool panel's rows as one array of lines. */
export function readPanel() {
  const panel = document.querySelector('.panel--sculpt');
  const body = panel.querySelector('.panel__body') ?? panel;
  const lines = [];
  const heading = panel.querySelector('.panel__title');
  lines.push(`heading ${heading?.textContent ?? ''}`);
  const keepClass = (c) => /^(sculpt-panel__|bz-section|checkbox|bz-row|bz-range|bz-label|measure-|compact|slider|row|muted)/.test(c);
  const walk = (el, depth) => {
    const hidden = !!el.closest('[hidden]');
    const cls = [...el.classList].filter(keepClass).join('.');
    let line = `${'  '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    if (hidden) line += ' [hidden]';
    if (el instanceof HTMLInputElement) {
      line += ` type=${el.type}`;
      if (el.type === 'range' || el.type === 'number') line += ` min=${el.min} max=${el.max} step=${el.step}`;
      line += el.type === 'checkbox' ? ` checked=${el.checked}` : ` value=${el.value}`;
      for (const a of ['aria-label', 'data-unit', 'data-scale', 'data-limit-min', 'data-limit-max']) if (el.hasAttribute(a)) line += ` ${a}=${el.getAttribute(a)}`;
    }
    if (el instanceof HTMLSelectElement) line += ` value=${el.value} options=${[...el.options].map((o) => `${o.value}:${o.textContent}`).join('|')}`;
    if (el instanceof HTMLButtonElement) line += ` disabled=${el.disabled}`;
    for (const a of ['aria-label', 'title']) if (el.hasAttribute(a) && !(el instanceof HTMLInputElement)) line += ` ${a}=${el.getAttribute(a)}`;
    for (const [k, v] of Object.entries(el.dataset)) line += ` data-${k}=${v}`;
    if (el.tagName.toLowerCase() === 'svg' || el.tagName.toLowerCase() === 'canvas') {
      lines.push(`${line} (drawing)`);
      return;
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    if (own) line += ` "${own}"`;
    lines.push(line);
    for (const c of el.children) walk(c, depth + 1);
  };
  for (const c of body.children) walk(c, 0);
  return lines;
}

/** Put each tool in hand and read the panel; Select, Transform and Calipers too. Run on a booted Sculpt page. */
export async function snapshotToolPanels(page) {
  const out = {};
  const settle = () => page.waitForTimeout(120);
  const read = () => page.evaluate(readPanel);
  await page.evaluate(() => window.__sculpt.sculptPanel.setCollapsed(false));
  for (const [id, n] of SNAPSHOT_TOOLS.filter((x) => x[2] === 'sculpt')) {
    await page.evaluate((i) => window.__sculpt.input.selectBrush(i), n);
    await settle();
    out[id] = await read();
  }
  await page.evaluate(() => window.__sculpt.input.selectBrush(0));
  await page.evaluate(() => window.__sculpt.input.toggleSelect());
  await settle();
  out['bz.select'] = await read();
  await page.evaluate(() => window.__sculpt.input.toggleSelect());
  await page.evaluate(() => window.__sculpt.input.toggleMeasure());
  await settle();
  out['bz.calipers'] = await read();
  await page.evaluate(() => window.__sculpt.input.toggleMeasure());
  await page.evaluate(() => window.__sculpt.input.selectBrush(0));
  await page.evaluate(() => window.__sculpt.viewMenu && document.querySelector('.sculpt-toolbar__btn[aria-label^="Transform"]').click());
  await settle();
  out['bz.transform'] = await read();
  await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn[aria-label^="Transform"]').click());
  await page.evaluate(() => window.__sculpt.input.selectBrush(0));
  await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
  await settle();
  for (const [id, n] of SNAPSHOT_TOOLS.filter((x) => x[2] === 'paint')) {
    await page.evaluate((i) => window.__sculpt.input.selectBrush(i), n);
    await settle();
    out[id] = await read();
  }
  await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
  return out;
}
