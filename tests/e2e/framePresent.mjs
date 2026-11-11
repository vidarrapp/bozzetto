// The owner's Present of a published frame project (src/present/): the route
// /?tl=<id>&present=1, against the real Functions (wrangler pages dev over the
// test build, a local D1 and R2, accounts off, as startAccountsServer runs
// them) with Cloudflare Access's header standing for the owner on /admin/.
//
// The gate: a guest, and a member signed in, get the ordinary viewer with the
// param dropped; the owner gets the page. The strip (menus, the path with
// Present lit and the others dim, the readout, the one orange Save), the
// Project tab (title, visibility, frames a second, the stages, the card
// picture), the Output tab (the reel's controls and what they say, Record
// reel to a file, Cancel, Save image), the Render tab, the transport; one
// Save writing the look with the settings and a stage, "Edited" coming and
// going, a refused Save losing nothing; Close asking when edited; the
// Projects list's action and the viewer's "Edit in Present"; the old editor
// as it was; and the public bundle without the page in it.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startAccountsServer } from './lib.mjs';

const OWNER = 'owner@example.com';
const VIEWPORT = { width: 1440, height: 900 };
const FRAMES = 8;

/** The owner's calls from Node, to seed and to read back what the page saved. */
function ownerApi(ipBase) {
  const call = async (method, path, { json, body, type } = {}) => {
    const res = await fetch(`${ipBase}${path}`, {
      method,
      headers: {
        'cf-access-authenticated-user-email': OWNER,
        ...(json !== undefined ? { 'content-type': 'application/json' } : type ? { 'content-type': type } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed };
  };
  return call;
}

/** A timelapse of the sample's first frames, or a model of its first one, on the server. */
async function seed(call, id, { mode, title, stages = [] }) {
  const dir = resolve('dist/timelapses/demo/frames/sd');
  const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort().slice(0, mode === 'model' ? 1 : FRAMES);
  let r = await call('POST', '/admin/api/projects', { json: { id, title, mode, fps: 8, visibility: 'public' } });
  if (r.status >= 300) throw new Error(`could not create ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  const frames = [];
  for (const [index, f] of files.entries()) {
    r = await call('POST', `/admin/api/projects/${id}/frames?index=${index}`, { body: readFileSync(resolve(dir, f)), type: 'application/octet-stream' });
    if (r.status >= 300) throw new Error(`could not upload frame ${index}: ${r.status}`);
    frames.push({ index, tris: 320 });
  }
  r = await call('PUT', `/admin/api/projects/${id}`, { json: { title, mode, fps: 8, visibility: 'public', frames, stages } });
  if (r.status >= 300) throw new Error(`could not set up ${id}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** A browser on the server: the owner's (Access's header on /admin/), or a guest's. */
async function contextFor(browser, origin, { owner }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', acceptDownloads: true });
  if (owner) {
    await ctx.route(
      (url) => url.origin === origin && url.pathname.startsWith('/admin/'),
      async (route) => route.continue({ headers: { ...(await route.request().allHeaders()), 'cf-access-authenticated-user-email': OWNER } }),
    );
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('request', (r) => console.log('req', r.method(), r.url().replace(origin, '')));
  if (process.env.E2E_DEBUG) page.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url()));
  if (process.env.E2E_DEBUG) page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
  return { ctx, page, errors };
}

/** The strip's readout as it reads, and whether it says Edited. */
const readout = (page) =>
  page.evaluate(() => ({
    text: (() => {
      const clone = document.querySelector('.bz-readout')?.cloneNode(true);
      clone?.querySelectorAll('[hidden]').forEach((e) => e.remove());
      return [...(clone?.querySelectorAll('.bz-readout__name, .bz-readout__item') ?? [])]
        .map((e) => (e.children.length ? [...e.children].map((c) => c.textContent.trim()).join(' ') : e.textContent.trim()))
        .join(' ');
    })(),
    edited: !!document.querySelector('.bz-readout__edited') && !document.querySelector('.bz-readout__edited').hidden,
  }));

/** Wait for the Present page to be up: strip, panels and the first frames drawn. */
async function presentReady(page) {
  await page.waitForFunction(
    () => !!document.querySelector('.bz-strip') && !!document.querySelector('.panel--project') && !!window.__bozzetto?.pipeline && !document.getElementById('overlay'),
    null,
    { timeout: 90_000 },
  ).catch(async (e) => {
    const state = await page.evaluate(() => ({ strip: !!document.querySelector('.bz-strip'), project: !!document.querySelector('.panel--project'), viewer: !!window.__bozzetto, pipeline: !!window.__bozzetto?.pipeline, overlay: document.getElementById('overlay')?.textContent, url: location.href }));
    throw new Error(`the Present page did not come up: ${JSON.stringify(state)} (${e.message.split('\n')[0]})`);
  });
  await page.waitForTimeout(400);
}

const settle = (page, ms = 400) => page.waitForTimeout(ms);

/** A range input moved the way a hand would: its value, then the input event. */
const slide = (page, selector, value) =>
  page.evaluate(
    ([sel, v]) => {
      const el = document.querySelector(sel);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [selector, value],
  );

/** Wait until `fn` is true in the page, or say it was not. */
async function until(page, fn, arg, ms = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

export const suites = {
  async framePresent(page, base, t) {
    const browser = page.context().browser();
    let server = null;
    const contexts = [];
    try {
      server = await startAccountsServer({ dist: resolve('dist'), vars: { ACCOUNTS_ENABLED: 'false' } });
      const origin = server.ipBase;
      const call = ownerApi(origin);
      await seed(call, 'tl-demo', {
        mode: 'timelapse',
        title: 'Demo timelapse',
        stages: [
          { name: 'Blockout', frame: 0, desc: 'First masses' },
          { name: 'Forms', frame: 4, desc: '' },
        ],
      });
      await seed(call, 'model-demo', { mode: 'model', title: 'Demo model' });
      const made = await call('POST', '/admin/api/projects', { json: { title: 'A scene', mode: 'scene' } });
      const sceneId = made.body?.id;

      const open = async (who, path) => {
        const c = await contextFor(browser, origin, who);
        contexts.push(c.ctx);
        await c.page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        return c;
      };

      // --- the public bundle does not carry the page --------------------------
      {
        const html = await (await fetch(`${origin}/`)).text();
        const entry = html.match(/src="(\/assets\/main-[^"]+\.js)"/)?.[1];
        const js = entry ? await (await fetch(`${origin}${entry}`)).text() : '';
        t.ok(!!entry && js.includes('Edit in Present'), `the public entry bundle has the quiet "Edit in Present" link (${entry})`);
        t.ok(!js.includes('Close without saving?') && !js.includes('Card picture'), 'but not the Present page itself, which is a chunk loaded when asked for');
      }

      // --- the gate: a guest ------------------------------------------------------
      {
        const g = await open({ owner: false }, '/?tl=tl-demo&present=1');
        await g.page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
        const s = await g.page.evaluate(() => ({
          // The viewer has a strip of its own now, with View and Help only: Present's has File.
          menus: [...document.querySelectorAll('.bz-menuname')].map((m) => m.textContent).join(),
          project: !!document.querySelector('.panel--project'),
          search: location.search,
          chip: !!document.querySelector('.viewer-present'),
          error: document.querySelector('.overlay__msg')?.textContent ?? '',
        }));
        t.ok(s.menus === 'View,Help' && !s.project && s.error === '', `a guest gets the ordinary viewer (its strip has View and Help only), with no error page (${JSON.stringify(s)})`);
        t.ok(s.search === '?tl=tl-demo', `and the param is dropped from the address (${s.search})`);
        t.ok(!s.chip, 'the viewer offers a guest no Edit in Present');
        await g.ctx.close(); // software GL: a page left open starves the next
      }

      // --- the gate: a member signed in, not the owner ---------------------------------
      {
        const m = await contextFor(browser, origin, { owner: false });
        contexts.push(m.ctx);
        await m.ctx.route(
          (url) => url.origin === origin && (url.pathname === '/api/config' || url.pathname === '/api/me'),
          (route) => {
            const path = new URL(route.request().url()).pathname;
            const json = path === '/api/me' ? { id: 'u1', handle: 'someone', role: 'member', status: 'active', usage: { used: 0, reserved: 0, quota: 1e9 } } : { accounts: true };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
          },
        );
        await m.page.goto(`${origin}/?tl=tl-demo&present=1`, { waitUntil: 'domcontentloaded' });
        await m.page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
        const s = await m.page.evaluate(() => ({ present: !!document.querySelector('.bz-ws, .panel--project'), search: location.search }));
        t.ok(!s.present && s.search === '?tl=tl-demo', `a member signed in, who is not the owner, gets the viewer and the param is dropped (${JSON.stringify(s)})`);
        await m.ctx.close();
      }

      // --- the gate: the owner, and what is not a frame project --------------------------
      if (sceneId) {
        const sc = await open({ owner: true }, `/?tl=${encodeURIComponent(sceneId)}&present=1`);
        await sc.page.waitForFunction(() => /scene|Could not/.test(document.querySelector('.overlay__msg')?.textContent ?? ''), null, { timeout: 60_000 });
        const s = await sc.page.evaluate(() => ({ strip: !!document.querySelector('.bz-strip'), words: document.querySelector('.overlay__msg')?.textContent ?? '' }));
        t.ok(!s.strip && /scene saved from Sculpt/.test(s.words), `a scene is not opened in Present: the viewer says where it opens (${s.words})`);
        await sc.ctx.close();
      }

      // --- the owner ------------------------------------------------------------------------
      const { page: p, ctx: ownerCtx } = await open({ owner: true }, '/?tl=tl-demo&present=1');
      void ownerCtx;
      const dialogs = [];
      p.on('dialog', (d) => {
        dialogs.push(d.type());
        void d.accept();
      });
      const puts = [];
      p.on('request', (r) => {
        if (r.method() === 'PUT' && r.url().includes('/admin/api/projects/tl-demo')) puts.push(JSON.parse(r.postData() ?? '{}'));
      });
      await presentReady(p);
      await p.evaluate(() => window.__bozzetto.pause());
      if (process.env.E2E_DEBUG) {
        const d = await p.evaluate(() => {
          const a = JSON.parse(window.__presentPage.saved.look);
          const b = JSON.parse(window.__presentPage.lookKey());
          const diff = (x, y, path = '') => (typeof x === 'object' && x && y ? Object.keys({ ...x, ...y }).flatMap((k) => diff(x[k], y[k], `${path}.${k}`)) : JSON.stringify(x) === JSON.stringify(y) ? [] : [`${path}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`]);
          return diff(a, b);
        });
        console.log('look drift:', d);
      }

      // The strip and the path.
      const strip = await p.evaluate(() => ({
        menus: [...document.querySelectorAll('.bz-menuname')].map((b) => b.textContent),
        steps: [...document.querySelectorAll('.bz-ws__step')].map((b) => ({ text: b.textContent, current: b.getAttribute('aria-current'), disabled: b.getAttribute('aria-disabled'), title: b.title })),
        save: (() => {
          const b = document.querySelector('.bz-strip__right .bz-strip__btn--primary');
          return b ? { text: b.textContent, bg: getComputedStyle(b).backgroundColor } : null;
        })(),
        hide: !!document.querySelector('.bz-strip__hide'),
        old: getComputedStyle(document.querySelector('body > .topbar') ?? document.body).display,
      }));
      t.ok(JSON.stringify(strip.menus) === JSON.stringify(['File', 'View', 'Help']), `the strip has File, View and Help (${strip.menus})`);
      t.ok(
        strip.steps.map((s) => s.text).join() === 'Armature,Sculpt,Present' && strip.steps[2].current === 'step',
        `the path reads Armature, Sculpt, Present with Present current (${JSON.stringify(strip.steps.map((s) => [s.text, s.current]))})`,
      );
      t.ok(
        strip.steps.slice(0, 2).every((s) => s.disabled === 'true' && s.title === 'This project has no sculpt scene'),
        `Armature and Sculpt are dim, and say why in their title (${JSON.stringify(strip.steps.slice(0, 2).map((s) => s.title))})`,
      );
      t.ok(strip.save?.text === 'Save' && strip.save.bg === 'rgb(255, 90, 31)' && strip.hide, `the one orange Save and the hide button are at the right (${JSON.stringify(strip.save)})`);
      let r = await readout(p);
      t.ok(/Demo timelapse\s+Timelapse\s+8 frames\s+Stage\s+Blockout/.test(r.text) && !r.edited, `the readout: the title, Timelapse 8 frames, the stage (${r.text})`);
      await p.evaluate(() => window.__bozzetto.scrubTo(5));
      await until(p, () => /Forms/.test(document.querySelector('.bz-readout')?.textContent ?? ''), null, 15_000);
      r = await readout(p);
      t.ok(/Stage\s+Forms/.test(r.text), `and follows the playhead to the next stage (${r.text})`);
      // Tabs: Project and Output stand open; Render is a tab away.
      const tabs = await p.evaluate(() => {
        const open = (s) => !document.querySelector(s)?.classList.contains('panel--collapsed');
        return {
          project: open('.panel--project'),
          output: open('.panel--output'),
          render: open('.panel--render'),
          names: [...document.querySelectorAll('.panel > .panel__handle')].filter((h) => h.getClientRects().length).map((h) => h.querySelector('.handle__label').textContent),
        };
      });
      t.ok(tabs.project && tabs.output && !tabs.render, `Project (left) and Output (right) are open, Render is closed (${JSON.stringify(tabs)})`);
      t.ok(tabs.names.sort().join() === 'Output,Project,Render', `the tabs are Project, Render and Output (${tabs.names})`);

      // Hide the interface and back, by the strip's button.
      await p.click('.bz-strip__hide');
      await settle(p, 300);
      let hidden = await p.evaluate(() => document.body.classList.contains('chrome-hidden'));
      await p.click('.bz-strip__hide');
      await settle(p, 300);
      t.ok(hidden && !(await p.evaluate(() => document.body.classList.contains('chrome-hidden'))), 'the hide button hides the interface and brings it back');
      // View menu: the panels and Hide interface.
      await p.click('.bz-menuname:has-text("View")');
      const view = await p.evaluate(() => [...document.querySelectorAll('.file-menu--view:not([hidden]) .file-menu__item')].map((i) => i.textContent.replace(/\s+/g, ' ').trim()));
      t.ok(['Project panel', 'Render panel', 'Output panel', 'Hide interface'].every((w) => view.some((v) => v.startsWith(w))), `View has the three panels and Hide interface (${JSON.stringify(view)})`);
      await p.keyboard.press('Escape');
      // Hiding put the panels away (Tab's rule everywhere): the tabs bring them back.
      await p.click('.panel--project > .panel__handle');
      await p.click('.panel--output > .panel__handle');
      await settle(p, 300);

      // --- Project: the stages --------------------------------------------------------------
      const stageRows = () => p.evaluate(() => [...document.querySelectorAll('.bz-stage')].map((r) => ({ name: r.firstChild.textContent, frame: r.lastChild.textContent, on: r.classList.contains('bz-stage--on') })));
      let rows = await stageRows();
      t.ok(rows.length === 2 && rows[1].on && !rows[0].on && rows[1].name === 'Forms' && rows[1].frame === '4', `the stages are listed, the one at the playhead marked (${JSON.stringify(rows)})`);
      await p.click('.bz-stage:first-child');
      await until(p, () => document.querySelector('.bz-stage')?.classList.contains('bz-stage--on'), null, 15_000);
      rows = await stageRows();
      t.ok(rows[0].on && (await p.evaluate(() => window.__bozzetto.timeline.frameIndex())) === 0, 'a stage row goes to its frame');
      // Add stage here at frame 6, name it; Remove; rename one.
      await p.evaluate(() => window.__bozzetto.scrubTo(6));
      await until(p, () => !document.querySelector('.bz-stage--on') || document.querySelector('.bz-stage--on').lastChild.textContent === '4', null, 15_000);
      await until(p, () => window.__bozzetto.timeline.frameIndex() === 6, null, 15_000);
      await settle(p, 300);
      t.ok(!(await p.locator('button:has-text("Add stage here")').isDisabled()), 'Add stage here is offered where no stage starts');
      await p.click('button:has-text("Add stage here")');
      await settle(p);
      rows = await stageRows();
      t.ok(rows.length === 3 && rows[2].on && rows[2].frame === '6', `Add stage here makes a stage at the frame on show (${JSON.stringify(rows)})`);
      t.ok(await p.locator('button:has-text("Add stage here")').isDisabled(), 'and is not offered again on that frame');
      const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      t.ok(focused === 'Stage name', 'the new stage\'s name is ready to type');
      await p.fill('input[aria-label="Stage name"]', 'Detail');
      r = await readout(p);
      t.ok(r.edited && /Stage\s+Detail/.test(r.text), `renaming shows in the strip, which says Edited (${r.text})`);
      rows = await stageRows();
      t.ok(rows[2].name === 'Detail', 'and in the list');
      const ticks = await p.evaluate(() => document.querySelectorAll('.transport--shell .transport__tick').length);
      t.ok(ticks === 3, `the transport has a tick for each stage (${ticks})`);
      await p.click('button:has-text("Remove")');
      await settle(p);
      rows = await stageRows();
      t.ok(rows.length === 2 && !rows.some((x) => x.name === 'Detail'), 'Remove takes away the stage at the playhead');
      r = await readout(p);
      t.ok(!r.edited, `and with the list as saved again, the strip is not Edited (${r.text})`);
      // Left as it will be saved: Detail at 6.
      await p.click('button:has-text("Add stage here")');
      await p.fill('input[aria-label="Stage name"]', 'Detail');
      await p.fill('input[aria-label="Stage note"]', 'Surface work');

      // --- Project: settings ------------------------------------------------------------------
      await p.fill('.panel--project input[placeholder="Title"]', 'Demo timelapse 2');
      const heading = await p.evaluate(() => document.querySelector('.panel--project .panel__title').textContent);
      t.ok(heading === 'Demo timelapse 2', `the title is the panel's heading as it is typed (${heading})`);
      await p.selectOption('.panel--project select[aria-label="Visibility"]', 'private');
      await slide(p, '.panel--project input[aria-label="Frames per second"]', 12);
      const fpsNow = await p.evaluate(() => window.__bozzetto.timeline.fps);
      t.ok(fpsNow === 12, `frames a second plays at once (${fpsNow})`);

      // --- Render: the look -------------------------------------------------------------------
      await p.click('.panel--render > .panel__handle');
      await settle(p, 500);
      const render = await p.evaluate(() => ({
        output: document.querySelector('.panel--output').classList.contains('panel--collapsed'),
        heading: document.querySelector('.panel--render .panel__title')?.textContent,
        sections: [...document.querySelectorAll('.panel--render .section > h3')].map((h) => h.textContent),
      }));
      t.ok(render.output && render.heading === 'Render', `the Render tab opens in Output's place (${render.heading})`);
      t.ok(['Material', 'Lighting', 'Camera', 'Environment'].every((s) => render.sections.includes(s)), `with the whole look, as the editor has it (${render.sections})`);
      const lightBefore = await p.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize()));
      // The key light's intensity, by its slider.
      const moved = await p.evaluate(() => {
        const row = [...document.querySelectorAll('.panel--render label.compact')].find((l) => l.firstElementChild?.textContent === 'Intensity');
        const input = row?.querySelector('input[type=range]');
        if (!input) return false;
        input.value = String(Number(input.value) + 0.7);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      await settle(p, 500);
      const lightAfter = await p.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize()));
      t.ok(moved && lightAfter !== lightBefore, 'a light slider in the Render tab changes the look');

      // --- Output ------------------------------------------------------------------------------------
      await p.click('.panel--output > .panel__handle');
      await settle(p, 400);
      const out = await p.evaluate(() => {
        const sel = (l) => document.querySelector(`.panel--output select[aria-label="${l}"]`);
        const vals = (s) => [...(s?.options ?? [])].map((o) => o.value);
        return {
          headings: [...document.querySelectorAll('.panel--output .section > h3')].map((h) => h.textContent),
          motion: vals(sel('Motion')),
          aspect: sel('Aspect')?.value,
          guide: window.__bozzetto.getCaptureAspect(),
          formats: vals(sel('Format')),
          sizes: vals(sel('Size')),
          info: document.querySelector('.reel-info')?.textContent,
          record: document.querySelector('.reel-record')?.textContent,
          save: !!document.querySelector('.present-out__save'),
          spinShown: !!document.querySelector('.reel-turntable') && !document.querySelector('.reel-turntable').hidden,
        };
      });
      t.ok(out.headings.join() === 'Reel,Image', `Output has Reel and Image (${out.headings})`);
      t.ok(out.motion.join() === 'timeline,turntable' && out.aspect === '4:5' && out.guide === '4:5' && out.formats.includes('gif'), `the reel offers motion, aspect with its guide on the view, and format (${JSON.stringify({ m: out.motion, a: out.aspect, g: out.guide, f: out.formats })})`);
      t.ok(/^8 frames, [\d.]+ seconds? at 24 fps\.$/.test(out.info ?? ''), `a line says the frame count and duration (${out.info})`);
      t.ok(!out.spinShown, 'the spin options wait for the turntable');
      await p.selectOption('.panel--output select[aria-label="Motion"]', 'turntable');
      let info = await p.evaluate(() => ({ line: document.querySelector('.reel-info').textContent, spin: !document.querySelector('.reel-turntable').hidden }));
      t.ok(info.spin && info.line === '96 frames, 4 seconds at 24 fps.', `the turntable shows its spin options and the line follows (${info.line})`);
      await p.selectOption('.panel--output select[aria-label="Spin"]', '2');
      await p.selectOption('.panel--output select[aria-label="FPS"]', '12');
      info = await p.evaluate(() => document.querySelector('.reel-info').textContent);
      t.ok(info === '24 frames, 2 seconds at 12 fps.', `and the spin and frame rate (${info})`);
      await p.selectOption('.panel--output select[aria-label="Aspect"]', '1:1');
      t.ok((await p.evaluate(() => window.__bozzetto.getCaptureAspect())) === '1:1', 'a new aspect moves the guide on the view');
      await p.selectOption('.panel--output select[aria-label="Motion"]', 'timeline');
      await p.selectOption('.panel--output select[aria-label="Aspect"]', '4:5');

      // Cancel: a long turntable, stopped part-way, saves nothing.
      let downloads = 0;
      p.on('download', () => void downloads++);
      await p.selectOption('.panel--output select[aria-label="Motion"]', 'turntable');
      await p.selectOption('.panel--output select[aria-label="Spin"]', '8');
      await p.selectOption('.panel--output select[aria-label="FPS"]', '30');
      await p.selectOption('.panel--output select[aria-label="Format"]', 'gif');
      await p.selectOption('.panel--output select[aria-label="Size"]', '360');
      await p.click('.reel-record');
      const running = await until(p, () => !!document.querySelector('.reel-running') && !document.querySelector('.reel-running').hidden && /Rendering \d+ \/ 240/.test(document.querySelector('.reel-status')?.textContent ?? ''), null, 60_000);
      t.ok(running, 'Record reel shows its progress, with Cancel in the button\'s place');
      await p.click('.reel-cancel');
      const cancelled = await until(p, () => /Cancelled/.test(document.querySelector('.reel-status')?.textContent ?? '') && !document.querySelector('.reel-record').hidden, null, 30_000);
      await settle(p, 500);
      t.ok(cancelled && downloads === 0, `Cancel stops it, with nothing saved (status ${await p.textContent('.reel-status')})`);
      t.ok(!(await p.evaluate(() => document.querySelector('.panel--output select[aria-label="Motion"]').disabled)), 'and the controls are back');

      // Record reel to a GIF: the timelapse, 8 frames, small.
      await p.selectOption('.panel--output select[aria-label="Motion"]', 'timeline');
      await p.selectOption('.panel--output select[aria-label="FPS"]', '12');
      const gif = p.waitForEvent('download', { timeout: 120_000 });
      await p.click('.reel-record');
      const file = await gif;
      const gifBytes = readFileSync(await file.path());
      t.ok(gifBytes.subarray(0, 4).toString('latin1') === 'GIF8' && gifBytes.length > 500, `Record reel makes a GIF of the timelapse (${file.suggestedFilename()}, ${gifBytes.length} bytes)`);
      t.ok(/^demo-timelapse-2_4x5\.gif$/.test(file.suggestedFilename()), `named for the title as it stands now (${file.suggestedFilename()})`);
      const done = await until(p, () => /^Saved/.test(document.querySelector('.reel-status')?.textContent ?? ''), null, 10_000);
      t.ok(done, 'and says it is saved');
      // MP4, where this browser can encode it: asked for, and either a file or its own words.
      const hasMp4 = await p.evaluate(() => [...document.querySelectorAll('.panel--output select[aria-label="Format"] option')].some((o) => o.value === 'mp4'));
      if (hasMp4) {
        await p.selectOption('.panel--output select[aria-label="Format"]', 'mp4');
        await p.selectOption('.panel--output select[aria-label="Size"]', '720');
        const mp4 = p.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
        await p.click('.reel-record');
        const f = await mp4;
        const words = await p.textContent('.reel-status');
        if (f) {
          const bytes = readFileSync(await f.path());
          t.ok(bytes.subarray(4, 8).toString('latin1') === 'ftyp', `MP4 records too (${f.suggestedFilename()}, ${bytes.length} bytes)`);
        } else {
          t.ok(/encode|H\.264|GIF/i.test(words), `where the browser cannot encode H.264, the reel says so and points to GIF (${words})`);
        }
      }
      // Save image.
      const png = p.waitForEvent('download', { timeout: 60_000 });
      await p.click('.present-out__save');
      const image = await png;
      const pngBytes = readFileSync(await image.path());
      t.ok(pngBytes.subarray(1, 4).toString('latin1') === 'PNG' && /\.png$/.test(image.suggestedFilename()), `Save image saves a PNG (${image.suggestedFilename()}, ${pngBytes.length} bytes)`);

      // --- Edited, a refused Save, a Save --------------------------------------------------------
      r = await readout(p);
      t.ok(r.edited && /Demo timelapse 2/.test(r.text), `all of it is Edited, under the new title (${r.text})`);
      const cardPost = p.waitForResponse((res) => res.url().includes('/admin/api/projects/tl-demo/thumb') && res.request().method() === 'POST', { timeout: 30_000 });
      await p.evaluate(() => window.__bozzetto.scrubTo(3));
      await settle(p, 400);
      await p.click('.panel--project button:has-text("Use this frame")');
      const card = await cardPost;
      t.ok(card.status() === 201 || card.status() === 200, `Use this frame sends the card picture (${card.status()})`);

      let refuse = true;
      await p.route('**/admin/api/projects/tl-demo', async (route) => {
        if (route.request().method() === 'PUT' && refuse) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The save failed' }) });
        return route.fallback();
      });
      puts.length = 0;
      await p.click('.bz-strip__right .bz-strip__btn--primary');
      const failed = await until(p, () => /Could not save/.test(document.querySelector('.sculpt-toast[data-state="failed"]')?.textContent ?? ''), null, 15_000);
      r = await readout(p);
      const kept = await p.evaluate(() => ({
        title: document.querySelector('.panel--project input[placeholder="Title"]').value,
        stages: document.querySelectorAll('.bz-stage').length,
        fps: document.querySelector('.panel--project input[aria-label="Frames per second"]').value,
      }));
      t.ok(failed && r.edited && kept.title === 'Demo timelapse 2' && kept.stages === 3 && kept.fps === '12', `a refused Save says so, in the app's notice, and loses nothing (${JSON.stringify(kept)})`);
      const before = (await call('GET', '/admin/api/projects/tl-demo')).body;
      t.ok(before.title === 'Demo timelapse' && before.stages.length === 2, 'and nothing reached the server');

      refuse = false;
      puts.length = 0;
      // Notices last a couple of seconds, and a frame can take longer than that here: note what is said.
      await p.evaluate(() => {
        window.__said = [];
        new MutationObserver(() => {
          for (const e of document.querySelectorAll('.sculpt-toast')) if (!window.__said.includes(e.textContent)) window.__said.push(e.textContent);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await p.click('.bz-strip__right .bz-strip__btn--primary');
      const saved = await until(p, () => !document.querySelector('.bz-readout__edited') || document.querySelector('.bz-readout__edited').hidden, null, 15_000);
      t.ok(saved, 'Save clears Edited');
      const said = await p.evaluate(() => window.__said);
      t.ok(said.includes('Saved'), `with "Saved" said (${JSON.stringify(said)})`);
      t.ok(puts.length === 1, `in one write (${puts.length})`);
      const sent = puts[0] ?? {};
      t.ok(
        !!sent.lighting && !!sent.material && !!sent.camera && sent.title === 'Demo timelapse 2' && sent.visibility === 'private' && sent.fps === 12 && sent.stages?.length === 3 && !('mode' in sent),
        `it carries the look, and the title, visibility, frames a second and stages that changed (${Object.keys(sent).join()})`,
      );
      const after = (await call('GET', '/admin/api/projects/tl-demo')).body;
      const detail = after.stages?.find((s) => s.name === 'Detail');
      t.ok(after.title === 'Demo timelapse 2' && after.visibility === 'private' && after.config.fps === 12, `the server has the settings (${after.title}, ${after.visibility}, ${after.config?.fps} fps)`);
      t.ok(detail?.frame === 6 && detail?.desc === 'Surface work' && after.stages.length === 3, `and the new stage (${JSON.stringify(after.stages)})`);
      t.ok(JSON.stringify(after.lighting) === lightAfter, 'and the look the Render tab set, as the viewer has it');
      // Nothing changes by itself while it stands.
      await settle(p, 2500);
      r = await readout(p);
      t.ok(!r.edited, 'it stays saved, however long it stands');

      // A reload: what was saved is what comes back (the owner reads a private project through /admin).
      await p.goto(`${origin}/?tl=tl-demo&present=1`, { waitUntil: 'domcontentloaded' });
      await presentReady(p);
      r = await readout(p);
      const back = await p.evaluate(() => ({
        title: document.querySelector('.panel--project input[placeholder="Title"]').value,
        vis: document.querySelector('.panel--project select[aria-label="Visibility"]').value,
        fps: document.querySelector('.panel--project input[aria-label="Frames per second"]').value,
        stages: [...document.querySelectorAll('.bz-stage')].map((x) => x.firstChild.textContent),
        light: JSON.stringify(window.__bozzetto.lighting.serialize()),
      }));
      t.ok(back.title === 'Demo timelapse 2' && back.vis === 'private' && back.fps === '12' && back.stages.join() === 'Blockout,Forms,Detail', `reopened, it has all of it (${JSON.stringify({ ...back, light: undefined })})`);
      t.ok(!r.edited, 'and is not Edited');

      // --- Close ---------------------------------------------------------------------------------------------
      await p.fill('.panel--project input[placeholder="Title"]', 'Unsaved');
      await p.click('.bz-menuname:has-text("File")');
      await p.click('.file-menu--file .file-menu__item:has-text("Close")');
      const asked = await p.waitForSelector('.bz-ask', { timeout: 5000 }).then(() => true, () => false);
      t.ok(asked, 'Close asks when there are unsaved changes');
      await p.click('.bz-ask-cancel');
      await settle(p, 300);
      t.ok(new URL(p.url()).pathname === '/' && new URL(p.url()).search.includes('present=1'), 'Cancel stays where it was');
      await p.click('.bz-menuname:has-text("File")');
      await p.click('.file-menu--file .file-menu__item:has-text("Close")');
      await p.waitForSelector('.bz-ask');
      await p.click('.bz-ask-yes');
      await p.waitForURL((u) => u.pathname === '/' && !u.search.includes('tl='), { timeout: 20_000 }).catch(() => {});
      t.ok(new URL(p.url()).search === '', `Close without saving goes to the gallery (${p.url()})`);
      // Not edited: no question.
      await p.goto(`${origin}/?tl=model-demo&present=1`, { waitUntil: 'domcontentloaded' });
      await presentReady(p);
      await p.click('.bz-menuname:has-text("File")');
      await p.click('.file-menu--file .file-menu__item:has-text("Close")');
      await p.waitForURL((u) => !u.search.includes('tl='), { timeout: 20_000 }).catch(() => {});
      t.ok(new URL(p.url()).search === '' && (await p.locator('.bz-ask').count()) === 0, 'Close with nothing edited just goes');

      // --- a model --------------------------------------------------------------------------------------------
      await p.goto(`${origin}/?tl=model-demo&present=1`, { waitUntil: 'domcontentloaded' });
      await presentReady(p);
      await settle(p, 600);
      const model = await p.evaluate(() => ({
        transport: !!document.querySelector('.transport'),
        project: [...document.querySelectorAll('.panel--project .section > h3')].map((h) => h.textContent),
        fps: !!document.querySelector('.panel--project input[aria-label="Frames per second"]'),
        motion: [...document.querySelector('.panel--output select[aria-label="Motion"]').options].map((o) => o.value),
        image: !!document.querySelector('.present-out__save'),
      }));
      model.readout = (await readout(p)).text.trim();
      t.ok(/^Demo model Model$/.test(model.readout), `a model's readout is its title and Model (${model.readout})`);
      t.ok(!model.transport, 'a model has no bottom bar');
      t.ok(model.project.join() === 'Settings,Card picture' && !model.fps, `its Project tab has Settings (no frame rate) and the card picture, no stages (${model.project})`);
      t.ok(model.motion.join() === 'turntable' && model.image, `its reel is the turntable, and it has Save image (${model.motion})`);
      await p.fill('.panel--project input[placeholder="Title"]', 'Demo model 2');
      puts.length = 0;
      const modelPut = p.waitForRequest((q) => q.method() === 'PUT' && q.url().includes('/model-demo'), { timeout: 15_000 });
      await p.click('.bz-strip__right .bz-strip__btn--primary');
      const mp = JSON.parse((await modelPut).postData() ?? '{}');
      t.ok(mp.title === 'Demo model 2' && !!mp.lighting && !('stages' in mp) && !('fps' in mp), `a model's Save writes the look and its title only (${Object.keys(mp).join()})`);
      await until(p, () => !document.querySelector('.bz-readout__edited') || document.querySelector('.bz-readout__edited').hidden, null, 10_000);

      // --- the ways in -------------------------------------------------------------------------------------------
      await p.goto(`${origin}/admin/`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.admin-row[data-project="tl-demo"]', { timeout: 30_000 });
      const links = await p.evaluate((scene) => {
        const href = (id) => document.querySelector(`.admin-row[data-project="${id}"] .admin-row__present`)?.getAttribute('href') ?? null;
        return {
          tl: href('tl-demo'),
          model: href('model-demo'),
          scene: scene ? href(scene) : null,
          text: document.querySelector('.admin-row[data-project="tl-demo"] .admin-row__present')?.textContent,
          edit: document.querySelector('.admin-row[data-project="tl-demo"] .admin-row__edit')?.getAttribute('href'),
        };
      }, sceneId);
      t.ok(links.tl === '/?tl=tl-demo&present=1' && links.model === '/?tl=model-demo&present=1' && links.text === 'Open in Present', `each frame project's row has Open in Present (${JSON.stringify(links)})`);
      t.ok(links.scene === null && links.edit === '?p=tl-demo', 'a scene\'s row has none, and Edit is still there');
      await p.click('.admin-row[data-project="tl-demo"] .admin-row__present');
      await presentReady(p);
      t.ok(new URL(p.url()).searchParams.get('tl') === 'tl-demo', 'it opens the project in Present');

      // The viewer: Edit in Present, quiet, for the owner already signed in on this device.
      await p.goto(`${origin}/?tl=model-demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.viewer-present', { timeout: 30_000 });
      const chip = await p.evaluate(() => ({ text: document.querySelector('.viewer-present').textContent, href: document.querySelector('.viewer-present').getAttribute('href'), cls: document.querySelector('.viewer-present').className, inStrip: !!document.querySelector('.viewer-present').closest('.bz-strip__right') }));
      t.ok(chip.text === 'Edit in Present' && chip.href === '/?tl=model-demo&present=1' && chip.cls.includes('bz-strip__btn') && chip.inStrip, `the viewer shows the owner Edit in Present, quiet at the right of its strip (${JSON.stringify(chip)})`);

      // The old editor, as it was.
      await p.goto(`${origin}/admin/?p=tl-demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!document.querySelector('.panel--editor') && !!document.querySelector('#reel-mount')?.firstElementChild, null, { timeout: 90_000 });
      const ed = await p.evaluate(() => ({
        title: document.querySelector('#f-title').value,
        stages: document.querySelectorAll('.stage-row').length,
        upload: !!document.querySelector('#drop'),
        reel: [...document.querySelectorAll('#reel-mount label')].map((l) => l.firstChild.textContent.trim()),
      }));
      t.ok(ed.title === 'Demo timelapse 2' && ed.stages === 3 && ed.upload, `the editor still opens the project, with its stages and its frame upload (${JSON.stringify({ ...ed, reel: undefined })})`);
      t.ok(ed.reel.join() === 'Aspect,Motion,Spin,Direction,Format,Size,FPS', `and its reel controls are as they were (${ed.reel})`);
      puts.length = 0;
      await p.click('#save-stages');
      await until(p, () => true, null, 100);
      for (let i = 0; i < 40 && !puts.length; i++) await p.waitForTimeout(100);
      t.ok(puts.length === 1 && puts[0].stages?.length === 3 && Object.keys(puts[0]).join() === 'stages', `Save stages still writes the stages alone (${JSON.stringify(Object.keys(puts[0] ?? {}))})`);
      t.ok(dialogs.length === 0, 'with no alert on the way');
    } finally {
      for (const c of contexts) await c.close().catch(() => {});
      await server?.close();
    }
  },
};
