// Armature mode's panel on the left, its undo and redo, and armature
// projects in the library (docs/accounts.md §4-5). The `armatureProjects`
// suite runs the panel, the history and the project file's format on the
// static build; the panel's side runs again in `panelSides`, on its
// screens; the library runs inside the `accounts` suite, against the real
// Functions.

const meets = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

/** Boot Armature mode at /?armature=1, on this page. */
async function boot(page, base, query = '') {
  await page.goto(`${base}/?armature=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__armature || !!document.querySelector('.overlay--error'), null, { timeout: 90_000 });
  const failed = await page.evaluate(() => (window.__armature ? null : document.querySelector('#overlay .overlay__msg')?.textContent ?? 'no overlay'));
  if (failed) throw new Error(`Armature mode did not boot: ${failed}`);
  await page.waitForTimeout(250);
}

/** Where the Armature panel, its tab, the Render panel's tab, the undo chips and the top row are. */
const layout = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const tabOf = (p) => {
      const handle = p?.querySelector('.panel__handle');
      if (!handle) return null;
      const hs = getComputedStyle(handle);
      return hs.display === 'none' || hs.visibility === 'hidden' ? null : box(handle);
    };
    const arm = document.querySelector('.panel--armature');
    const render = [...document.querySelectorAll('.panel')].find((p) => p.querySelector('.panel__title')?.textContent === 'Render');
    return {
      left: arm?.classList.contains('panel--left') ?? false,
      open: arm ? !arm.classList.contains('panel--collapsed') : false,
      body: box(arm),
      tab: tabOf(arm),
      renderLeft: render?.classList.contains('panel--left') ?? null,
      renderOpen: render ? !render.classList.contains('panel--collapsed') : false,
      renderTab: tabOf(render),
      renderBody: box(render),
      hist: [...document.querySelectorAll('.armature-hist .sculpt-histbtn')].map(box),
      topbar: [...document.querySelectorAll('.topbar .topchip')].filter((c) => !c.hidden).map(box),
    };
  });

const setOpen = (page, which, open) =>
  page.evaluate(
    ([w, o]) => {
      const p =
        w === 'Armature'
          ? document.querySelector('.panel--armature')
          : [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === w);
      if (p.classList.contains('panel--collapsed') === o) p.querySelector(o ? '.panel__handle' : '.panel__close').click();
    },
    [which, open],
  );

/**
 * The Armature panel docks on the left edge (owner request), as Sculpt's
 * Scene and Model do, with the same tab: at its edge, on the screen, clear
 * of the top row and of the undo chips below it, and open, clear of both
 * too; the Render panel keeps the right edge, and the two open together.
 */
export async function armaturePanelSide(page, base, t, sizes = [[1024, 768], [744, 1133]]) {
  const problems = [];
  const seen = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await boot(page, base);
    await page.addStyleTag({ content: '.panel { transition: none !important; }' });
    const at = `${w}x${h}`;
    let l = await layout(page);
    seen.push(`${at}: tab ${Math.round(l.tab?.l ?? -1)},${Math.round(l.tab?.t ?? -1)}`);
    if (!l.left) problems.push(`${at}: the Armature panel is not on the left`);
    if (l.renderLeft !== false) problems.push(`${at}: Render left its right edge`);
    if (!l.tab) problems.push(`${at}: the Armature panel has no tab`);
    else {
      if (Math.abs(l.tab.l) > 1) problems.push(`${at}: its tab is not at the left edge (${l.tab.l})`);
      if (l.tab.t < 0 || l.tab.b > h || l.tab.r > w) problems.push(`${at}: its tab leaves the screen`);
      if (l.topbar.some((x) => meets(l.tab, x))) problems.push(`${at}: its tab runs into the top row`);
      if (l.hist.some((x) => meets(l.tab, x))) problems.push(`${at}: its tab runs into the undo chips`);
      if (meets(l.tab, l.renderTab)) problems.push(`${at}: its tab meets Render's`);
    }
    if (l.hist.length !== 2 || l.hist.some((x) => x.l < 0 || x.b > h)) problems.push(`${at}: the undo chips are not both on the screen`);
    await setOpen(page, 'Armature', true);
    await setOpen(page, 'Render', true);
    l = await layout(page);
    if (!l.open || !l.renderOpen) problems.push(`${at}: Armature and Render do not open together (${l.open}, ${l.renderOpen})`);
    if (l.body && (l.body.l < 0 || l.body.r > w || l.body.b > h)) problems.push(`${at}: the open panel leaves the screen`);
    if (l.topbar.some((x) => meets(l.body, x))) problems.push(`${at}: the open panel runs into the top row`);
    if (l.hist.some((x) => meets(l.body, x))) problems.push(`${at}: the open panel covers the undo chips`);
    if (meets(l.body, l.renderBody)) problems.push(`${at}: the open Armature and Render panels overlap`);
    await setOpen(page, 'Armature', false);
    l = await layout(page);
    if (l.open || !l.tab) problems.push(`${at}: closed, its tab does not come back`);
  }
  t.ok(!problems.length, `the Armature panel docks left, clear of the top row, the undo chips and Render (${seen.join('; ')})${problems.length ? `: ${problems.join('; ')}` : ''}`);
}

/**
 * Undo and redo in Armature mode (owner request): Sculpt's keys (the same
 * keymap actions, so a rebinding in Preferences covers both) and two chips
 * where Sculpt has them. Every pose change is a step - a drag of a ball one
 * step however many frames it took, a slider one step however far it ran,
 * symmetry, a change of figure - at most 100 kept, and New starts over.
 */
export async function armatureHistory(page, base, t) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page, base);
  const st = () => page.evaluate(() => ({ ...window.__armature.history(), state: JSON.stringify(window.__armature.state()), symmetry: window.__armature.armature.symmetry, figure: window.__armature.armature.rig.id }));
  const chips = () =>
    page.evaluate(() => ({
      undo: document.querySelector('.armature-hist [data-hist="undo"]')?.disabled ?? null,
      redo: document.querySelector('.armature-hist [data-hist="redo"]')?.disabled ?? null,
    }));
  const s0 = await st();
  t.ok(s0.undo === 0 && s0.redo === 0 && s0.limit === 100, `a booted armature has no history, and keeps up to 100 steps (${JSON.stringify({ undo: s0.undo, limit: s0.limit })})`);
  let c = await chips();
  t.ok(c.undo === true && c.redo === true, `both chips start disabled, at the foot of the left edge (${JSON.stringify(c)})`);

  // Keys: a turn, Ctrl+Z puts it back, Ctrl+Shift+Z puts it on again.
  await page.evaluate(() => window.__armature.turn('upperarm.L', 25, 0, -20));
  const s1 = await st();
  await page.keyboard.press('Control+z');
  const undone = await st();
  await page.keyboard.press('Control+Shift+z');
  const redone = await st();
  t.ok(s1.undo === 1 && s1.state !== s0.state, `a turn is one step (${s1.undo})`);
  t.ok(undone.state === s0.state && undone.redo === 1, 'Ctrl+Z puts the pose back as it was');
  t.ok(redone.state === s1.state && redone.redo === 0, 'Ctrl+Shift+Z puts the turn on again');

  // The chips do the same.
  c = await chips();
  t.ok(c.undo === false && c.redo === true, `with a step to undo, Undo is enabled and Redo not (${JSON.stringify(c)})`);
  await page.click('.armature-hist [data-hist="undo"]');
  const byChip = await st();
  c = await chips();
  t.ok(byChip.state === s0.state && c.redo === false && c.undo === true, `the Undo chip undoes it, and Redo lights (${JSON.stringify(c)})`);
  await page.click('.armature-hist [data-hist="redo"]');
  t.eq((await st()).state, s1.state, 'and the Redo chip redoes it');

  // A real drag of a reach ball: many frames, one step.
  const ball = await page.evaluate(() => window.__armature.ballOnScreen('ik:hand.R'));
  const before = await st();
  await page.mouse.move(ball[0], ball[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(ball[0] + i * 6, ball[1] - i * 5);
  await page.mouse.up();
  const dragged = await st();
  t.ok(dragged.undo === before.undo + 1 && dragged.state !== before.state, `a drag of a hand's ball over twelve moves is one step (${before.undo} → ${dragged.undo})`);
  await page.keyboard.press('Control+z');
  t.eq((await st()).state, before.state, 'and one undo puts the hand back');
  await page.keyboard.press('Control+Shift+z');

  // A slider run through several values is one step, taken when it is let go.
  const slid = await page.evaluate(async () => {
    const a = window.__armature;
    a.select('forearm.L');
    const n0 = a.history().undo;
    const input = [...document.querySelectorAll('.panel--armature input[type=range]')][0];
    for (const v of [10, 20, 35, 50, 65]) {
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const resting = a.history().resting;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    a.select(null);
    return { n0, n1: a.history().undo, resting };
  });
  t.ok(slid.resting && slid.n1 === slid.n0 + 1, `a joint slider through five values is one step once let go (${slid.n0} → ${slid.n1}, resting ${slid.resting})`);

  // Symmetry and a change of figure are steps, and come back on undo.
  const sym0 = await st();
  await page.evaluate(() => [...document.querySelectorAll('.panel--armature label.checkbox')].find((l) => l.textContent.trim().startsWith('Symmetry')).querySelector('input').click());
  const sym1 = await st();
  await page.keyboard.press('Control+z');
  const sym2 = await st();
  t.ok(sym1.symmetry === !sym0.symmetry && sym1.undo === sym0.undo + 1 && sym2.symmetry === sym0.symmetry, `Symmetry is a step, and undone (${sym0.symmetry} → ${sym1.symmetry} → ${sym2.symmetry})`);
  const fig0 = await st();
  await page.evaluate(() => window.__armature.figure('placeholder-female'));
  const fig1 = await st();
  await page.keyboard.press('Control+z');
  await page.waitForFunction((id) => window.__armature.armature.rig.id === id, fig0.figure, { timeout: 30_000 }).catch(() => {});
  const fig2 = await st();
  t.ok(fig1.figure === 'placeholder-female' && fig2.figure === fig0.figure && fig2.state === fig0.state, `a change of figure is a step, and undo brings the figure back as it stood (${fig0.figure} → ${fig1.figure} → ${fig2.figure})`);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() => window.__armature.armature.rig.id === 'placeholder-female', null, { timeout: 30_000 }).catch(() => {});
  t.eq((await st()).figure, 'placeholder-female', 'and redo takes it again');

  // The cap.
  const capped = await page.evaluate(() => {
    const a = window.__armature;
    for (let i = 0; i < 120; i++) a.turn('upperarm.R', (i % 60) - 30, 0, i % 2 ? 10 : -10);
    return a.history();
  });
  t.eq(capped.undo, 100, '120 turns keep the last 100 steps');
  const walked = await page.evaluate(() => {
    const a = window.__armature;
    let n = 0;
    while (a.history().undo > 0 && n < 200) {
      a.undo();
      n++;
    }
    return { n, redo: a.history().redo };
  });
  t.ok(walked.n === 100 && walked.redo === 100, `and 100 undos walk them all back (${JSON.stringify(walked)})`);

  // New starts the history over.
  await page.evaluate(() => window.__armature.turn('upperarm.R', 15, 0, 0));
  page.once('dialog', (d) => void d.accept());
  await page.click('.file-menu--file__chip');
  await page.click('.file-menu--file button:has-text("New armature")');
  await page.waitForFunction(() => window.__armature.history().undo === 0 && window.__armature.history().redo === 0, null, { timeout: 30_000 }).catch(() => {});
  const fresh = await st();
  t.ok(fresh.undo === 0 && fresh.redo === 0, `New armature starts the history over (${fresh.undo}, ${fresh.redo})`);

  // One keymap: Sculpt's undo rebound in Preferences is Armature's undo too.
  await page.evaluate(() => localStorage.setItem('bozzetto-keymap', JSON.stringify({ 'edit.undo': 'ctrl+u' })));
  await boot(page, base);
  const r0 = await st();
  await page.evaluate(() => window.__armature.turn('upperarm.L', -15, 0, 0));
  await page.keyboard.press('Control+z');
  const notUndone = await st();
  await page.keyboard.press('Control+u');
  const reb = await st();
  t.ok(notUndone.undo === 1 && reb.state === r0.state, `with Sculpt's Undo rebound to Ctrl+U, Ctrl+U undoes here and Ctrl+Z no longer does (${notUndone.undo}, ${reb.undo})`);
  await page.evaluate(() => localStorage.removeItem('bozzetto-keymap'));
}

// --- the library (inside the accounts suite) ------------------------------------------------

/**
 * Armature projects in the library, against the real Functions: the
 * member's Save to library makes a project in My projects - created once,
 * then updated in place - whose card says Armature and opens Armature mode;
 * opened back, the figure is as saved; the owner's, made a template and
 * public, is in the gallery as an Armature template a guest opens as a copy.
 */
export async function armatureLibrary(server, o, a, t, { show, r2 }) {
  const p = a.page;
  const base = server.base;
  const kinds = (b) => b.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
  await boot(p, base);
  await p.waitForFunction(() => window.__armature.role() !== null, null, { timeout: 30_000 }).catch(() => {});
  const hint = await p.evaluate(async () => {
    document.querySelector('.file-menu--file__chip').click();
    await new Promise((r) => setTimeout(r, 100));
    const item = [...document.querySelectorAll('.file-menu--file .file-menu__item, .file-menu--file button')].find((b) => /Save to library/.test(b.textContent));
    const text = item?.textContent ?? '';
    document.querySelector('.file-menu--file__chip').click();
    return text;
  });
  t.ok(/Saves to My projects/.test(hint), `Armature mode's File menu has Save to library, to My projects ("${hint}")`);
  await p.evaluate(() => {
    const arm = window.__armature;
    arm.turn('upperarm.L', 30, 0, -40);
    arm.turn('thigh.R', -25, 0, 5);
    arm.armature.symmetry = true;
    arm.commit();
  });
  const mark = a.requests.length;
  const saved = await p.evaluate(() => window.__armature.saveToLibrary());
  const sent = a.requests.slice(mark).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
  t.ok(
    !!saved?.id && sent.includes('POST /api/me/projects') && sent.includes(`POST /api/me/projects/${saved.id}/armature`) && sent.includes(`POST /api/me/projects/${saved.id}/thumb`),
    `Save to library makes a project, sends armature.json and the thumbnail (${show(sent)})`,
  );
  const toast = await p.evaluate(() => [...document.querySelectorAll('.file-menu__progress')].map((n) => `${n.dataset.state}: ${n.textContent}`).at(-1) ?? '');
  t.ok(/^done: Saved to My projects: /.test(toast), `and says so ("${toast}")`);
  const posed = await p.evaluate(() => window.__armature.state());
  // Saved again: the same project, updated in place.
  await p.evaluate(() => window.__armature.turn('forearm.L', 40, 0, 0));
  const again = a.requests.length;
  const resaved = await p.evaluate(() => window.__armature.saveToLibrary());
  const sent2 = a.requests.slice(again).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
  t.ok(resaved?.id === saved?.id && !sent2.includes('POST /api/me/projects') && sent2.includes(`POST /api/me/projects/${saved?.id}/armature`), `saved again, it updates the same project (${show(sent2)})`);
  const posed2 = await p.evaluate(() => window.__armature.state());
  const files = await r2(server, 'users/');
  const stored = Object.keys(files).filter((k) => k.endsWith(`/${saved?.id}/armature.json`) || k.endsWith(`/${saved?.id}/thumb.jpg`));
  t.eq(stored.length, 2, `R2 holds its armature.json and thumb.jpg (${show(stored)})`);

  // My projects: the card, its badge and Open.
  await p.goto(`${base}/?me`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector(`.card--mine[data-project="${saved?.id}"]`, { timeout: 30_000 }).catch(() => {});
  const card = await p.evaluate((id) => {
    const c = document.querySelector(`.card--mine[data-project="${id}"]`);
    return {
      badge: c?.querySelector('.card__badge')?.textContent ?? null,
      meta: c?.querySelector('.card__meta')?.textContent ?? '',
      open: c?.querySelector('.card__open')?.getAttribute('href') ?? null,
    };
  }, saved?.id);
  t.ok(card.badge === 'Armature' && /^Armature · /.test(card.meta), `My projects shows it badged Armature (${show(card)})`);
  t.eq(card.open, `/?armature=1&project=${saved?.id}`, 'and Open goes to Armature mode');
  // Opened back over the armature in progress: the card asks (the
  // browser's dialogs are accepted), and the figure is as saved.
  await Promise.all([p.waitForURL((u) => u.searchParams.get('armature') === '1', { timeout: 30_000 }), p.click(`.card--mine[data-project="${saved?.id}"] .card__open`)]);
  await p.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
  await p.waitForTimeout(300);
  const back = await p.evaluate(() => ({ state: window.__armature.state(), symmetry: window.__armature.armature.symmetry, link: window.__armature.link(), search: location.search, history: window.__armature.history() }));
  const sameState = JSON.stringify(back.state.pose) === JSON.stringify(posed2.pose) && back.state.preset === posed2.preset;
  t.ok(sameState && back.symmetry === true, `opened back, the figure is as saved, symmetry and all (${back.state.preset}, ${Object.keys(back.state.pose).length} joints)`);
  t.ok(back.link?.id === saved?.id && back.search === '?armature=1' && back.history.undo === 0, `linked to its project, the address cleaned, the history fresh (${show(back.link)} ${back.search})`);
  void posed;

  // The owner's: made a template and public, a gallery card a guest opens as a copy.
  const op = o.page;
  await boot(op, base);
  await op.evaluate(() => {
    window.__armature.turn('upperarm.R', -30, 0, 35);
    window.__armature.commit();
  });
  const tpl = await op.evaluate(() => window.__armature.saveToLibrary());
  const switched = await op.evaluate(async (id) => {
    const tr = await fetch(`/admin/api/projects/${id}/template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: true }) });
    const pub = await fetch(`/admin/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'public' }) });
    return { template: tr.status, visibility: pub.status, row: await pub.json().catch(() => null) };
  }, tpl?.id);
  t.ok(!!tpl?.id && switched.template === 200 && switched.visibility === 200 && switched.row?.template === true && switched.row?.mode === 'armature', `the owner's armature takes the Template switch and goes public (${show({ id: tpl?.id, ...switched, row: undefined })})`);
  const ownerState = await op.evaluate(() => window.__armature.state());
  const guest = await a.ctx.browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const g = await guest.newPage();
  try {
    await g.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await g.waitForSelector(`.card--armature-project[data-project="${tpl?.id}"]`, { timeout: 30_000 }).catch(() => {});
    const gcard = await g.evaluate((id) => {
      const c = document.querySelector(`.card--armature-project[data-project="${id}"]`);
      return {
        badges: [...(c?.querySelectorAll('.card__badge') ?? [])].map((b) => b.textContent),
        href: c?.querySelector('.card__thumb')?.getAttribute('href') ?? null,
        meta: c?.querySelector('.card__meta')?.textContent ?? '',
      };
    }, tpl?.id);
    t.ok(gcard.badges.join(',') === 'Armature,Template' && /Armature mode/.test(gcard.meta), `a guest's gallery shows it badged Armature and Template, saying it opens in Armature mode (${show(gcard)})`);
    t.eq(gcard.href, `/?armature=1&template=${tpl?.id}`, 'and it opens as a copy');
    await Promise.all([g.waitForURL((u) => u.searchParams.get('armature') === '1', { timeout: 30_000 }), g.click(`.card--armature-project[data-project="${tpl?.id}"] .card__thumb`)]);
    await g.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
    await g.waitForTimeout(300);
    const copy = await g.evaluate(() => ({ state: window.__armature.state(), link: window.__armature.link() }));
    t.ok(JSON.stringify(copy.state.pose) === JSON.stringify(ownerState.pose) && copy.link === null, `the copy is the template's figure, linked to no project (${Object.keys(copy.state.pose).length} joints, link ${show(copy.link)})`);
    // A guest's Save to library is the .armature file, as it was.
    const [download] = await Promise.all([g.waitForEvent('download', { timeout: 30_000 }).catch(() => null), g.evaluate(() => window.__armature.saveToLibrary())]);
    t.ok(!!download && /\.armature$/.test(download.suggestedFilename()), `a guest's Save to library downloads a .armature file (${download?.suggestedFilename()})`);
    // The viewer does not play one: its address says where it opens.
    await g.goto(`${base}/?tl=${tpl?.id}`, { waitUntil: 'domcontentloaded' });
    await g.waitForSelector('.overlay--error', { timeout: 30_000 }).catch(() => {});
    const refused = await g.evaluate(() => document.querySelector('#overlay .overlay__msg')?.textContent ?? '');
    t.ok(/opens in Armature mode/.test(refused), `the viewer does not play an armature ("${refused}")`);
  } finally {
    await guest.close();
  }
  // The member's goes again, so the parts after this one find the account as they left it.
  const gone = await p.evaluate(async (id) => (await fetch(`/api/me/projects/${id}`, { method: 'DELETE' })).status, saved?.id);
  t.eq(gone, 200, "the member's armature project is deleted again");
  void kinds;
}

/**
 * The project file Save to library sends (shared/armature.ts), as the app
 * writes it and reads it back: the figure on top, the state without its
 * preset; opened as a file, the figure comes back as saved; a figure
 * Bozzetto does not have stands on the realistic male mannequin, saying
 * so; and a file with a `__proto__` key is refused, the figure untouched.
 */
export async function armatureProjectFile(page, base, t) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page, base);
  const written = await page.evaluate(async () => {
    const a = window.__armature;
    a.turn('upperarm.L', 20, 0, -30);
    a.armature.symmetry = true;
    a.commit();
    const text = await a.projectText();
    return { text, state: a.state() };
  });
  const rec = JSON.parse(written.text);
  t.ok(
    rec.kind === 'bozzetto-armature-project' && rec.v === 1 && rec.figure === written.state.preset && rec.state && !('preset' in rec.state) && rec.symmetry === true,
    `the project file names its figure on top, the state without its preset, and symmetry (${rec.kind} v${rec.v} ${rec.figure})`,
  );
  const open = (text) =>
    page.evaluate(async (body) => {
      const a = window.__armature;
      let said = null;
      const was = window.alert;
      window.alert = (m) => {
        said = String(m);
      };
      try {
        await a.open(new File([body], 'figure.json', { type: 'application/json' }));
      } finally {
        window.alert = was;
      }
      return {
        said,
        figure: a.armature.rig.id,
        pose: JSON.stringify(a.state().pose),
        symmetry: a.armature.symmetry,
        note: document.querySelector('.panel--armature .sculpt-panel__note')?.textContent ?? '',
        history: a.history(),
      };
    }, text);
  // Something else on screen first, so the open is seen to bring it back.
  await page.evaluate(() => {
    window.__armature.armature.symmetry = false;
    window.__armature.turn('upperarm.L', -40, 0, 10);
  });
  const back = await open(written.text);
  t.ok(
    back.said === null && back.figure === written.state.preset && back.pose === JSON.stringify(written.state.pose) && back.symmetry === true && back.history.undo === 0,
    `opened as a file, the project comes back as saved, with a history of its own (${back.figure}, symmetry ${back.symmetry}${back.said ? `, said "${back.said}"` : ''})`,
  );
  const stranger = await open(JSON.stringify({ ...rec, figure: 'robot-9000' }));
  t.ok(
    stranger.said === null && stranger.figure === 'mannequin-male-realistic' && /does not have/.test(stranger.note),
    `a figure Bozzetto does not have stands on the realistic male mannequin, saying so ("${stranger.note}")`,
  );
  const before = await page.evaluate(() => JSON.stringify(window.__armature.state()));
  const poisoned = await open(`{"kind":"bozzetto-armature-project","v":1,"figure":"placeholder-female","state":{"pose":{"__proto__":{"x":1}}}}`);
  const after = await page.evaluate(() => JSON.stringify(window.__armature.state()));
  t.ok(/__proto__/.test(poisoned.said ?? '') && after === before, `a file with a __proto__ key is refused, the figure untouched ("${poisoned.said}")`);
}

export const suites = {
  async armatureProjects(page, base, t) {
    await armaturePanelSide(page, base, t);
    await armatureHistory(page, base, t);
    await armatureProjectFile(page, base, t);
  },
};
