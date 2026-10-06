// The desktop app itself, under Electron, on a virtual display:
//
//   npm run build:desktop && xvfb-run -a node tests/e2e/desktop.mjs
//   xvfb-run -a node tests/e2e/desktop.mjs --app release/Bozzetto-<version>.AppImage
//
// The launch switches take effect (v-sync off by default: frames run free
// while you work, well past any display, and drop back to the display's
// rate a second after everything stops); on battery the app stays paced
// while you work too (powerMonitor's own event, as the OS raises it);
// launch.json is read before the app is ready, written from Preferences'
// Desktop group, which only the app has, and read back, so V-sync on holds
// every frame for the display at the next start. The browser side of the
// pacing is latency.mjs's `pacing` suite.
//
// Then what a page in the app can make the main process do, which is
// nothing it should not. It never names the file Save writes to - a path
// it passes is ignored, a ref it was never given changes nothing - and it
// reads only files the user opened or has in recents, refused without the
// path said back. Links reach the OS only as https:, mailto: and http:
// to this machine, from the app window and the sign-in window alike: a
// stand-in xdg-open on PATH counts what does. bozzetto:// serves its own host and no other. Calls
// through the server proxy carry no Origin and Sec-Fetch-Site none, and
// the Access cookie, SameSite=Lax, set by a real sign-in window (a local
// server stands in for the deployment); signing in and out in Server
// settings tells the page, which asks again who it is for.
//
// With --app, those checks run against a packaged build (an AppImage is
// extracted and started through its own AppRun), after its fuse wire is
// read back from the binary and ELECTRON_RUN_AS_NODE and --inspect are
// seen to do nothing. The fuses take Node's inspector away, so the app is
// driven over Chromium's remote debugging with no way into its main
// process: the pacing checks and the few that stub a dialog run in
// development only.
//
// Electron's binary is fetched by `node node_modules/electron/install.js`;
// without it this exits 2 and says so.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checks, playwright } from './lib.mjs';

const require = createRequire(import.meta.url);
const root = resolve('.');
const appAt = process.argv.indexOf('--app');
/** The packaged build under test, or null for the app as it stands in this checkout. */
const packaged = appAt > 0 && process.argv[appAt + 1] ? resolve(process.argv[appAt + 1]) : null;
if (packaged && !existsSync(packaged)) {
  console.error(`no packaged app at ${packaged}`);
  process.exit(2);
}
if (!packaged && !existsSync(join(root, 'dist-desktop', 'index.html'))) {
  console.error('dist-desktop/index.html missing - run `npm run build:desktop` first');
  process.exit(2);
}
let electron;
try {
  electron = require('electron');
} catch (e) {
  console.error(`no Electron binary (${e.message}) - run \`node node_modules/electron/install.js\``);
  process.exit(2);
}
if (!process.env.DISPLAY) {
  console.error('no display - run under `xvfb-run -a`');
  process.exit(2);
}

const show = (o) => JSON.stringify(o);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Its own settings folder, so neither a real install's launch.json nor its
// single-instance lock is touched.
const home = mkdtempSync(join(tmpdir(), 'bozzetto-desktop-'));
/** Software GL on the virtual display; see start(). */
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'];

/**
 * What the app hands the OS. Electron opens links on Linux with xdg-open
 * (xdg-email for mailto:), found on PATH; these stand-ins only write down
 * what they were given. Only those two: Chromium runs other desktop tools
 * on its own account (a stand-in gio stalls the start-up), and a link sent
 * any other way would show as a missing https: one below.
 */
const fakeBin = join(home, 'bin');
const handedToOs = join(home, 'handed-to-os.log');
mkdirSync(fakeBin);
for (const tool of ['xdg-open', 'xdg-email']) {
  writeFileSync(join(fakeBin, tool), `#!/bin/sh\necho "${tool} $*" >> '${handedToOs}'\n`);
  chmodSync(join(fakeBin, tool), 0o755);
}
const osLog = () => (existsSync(handedToOs) ? readFileSync(handedToOs, 'utf8').trim().split('\n').filter(Boolean) : []);
const env = { ...process.env, XDG_CONFIG_HOME: home, PATH: `${fakeBin}:${process.env.PATH}` };
delete env.ELECTRON_RUN_AS_NODE;

/**
 * The app, started as a user would, with software GL on the virtual
 * display. The GPU watchdog is off: compiling the sculpt shaders in
 * software holds the GPU process past it, which then kills the context.
 */
async function start() {
  const app = await playwright()._electron.launch({
    executablePath: electron,
    args: [root, '--no-sandbox', ...GL],
    env,
    timeout: 120_000,
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  await win.waitForFunction(() => !!window.__sculpt && !!window.__bozzetto && !document.getElementById('overlay'), null, { timeout: 120_000, polling: 100 });
  // The loop runs and paces as ever but draws nothing: the software
  // renderer's frames would otherwise set the rate, not the pacing. A
  // speck in the corner changes every frame instead, as the canvas does
  // while you work: Chromium only draws past the display's rate for a
  // page that has something new to show, v-sync off or not (measured: a
  // page that changes nothing gets 60 frames a second, one that does,
  // thousands).
  await win.evaluate(() => {
    window.__bozzetto.debugSkipRender = true;
    const speck = document.createElement('div');
    speck.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;z-index:99999;pointer-events:none';
    document.body.appendChild(speck);
    let n = 0;
    const tick = () => {
      speck.style.background = n++ % 2 ? '#010101' : '#020202';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Shown, and the loop up to speed for three seconds running: the GPU
  // process works through the software renderer's first frames (shader
  // compiles among them) for a while, holding frames back until it has,
  // and a burst of frames can come before that.
  let going = false;
  for (let steady = 0, until = Date.now() + 180_000; !going && Date.now() < until; ) {
    const n = await win.evaluate(
      () =>
        new Promise((ok) => {
          const f0 = window.__bozzetto.frameNo;
          setTimeout(() => ok(document.visibilityState === 'visible' ? window.__bozzetto.frameNo - f0 : 0), 1000);
        }),
    );
    steady = n >= 30 ? steady + 1 : 0;
    going = steady >= 3;
  }
  return { app, win, errors, going, close: () => app.close() };
}

/** Frames the loop ran per second over `ms`, woken every 40 ms if `working`, as input wakes it. */
const loopRate = (win, ms, working) =>
  win.evaluate(
    ([d, w]) =>
      new Promise((ok) => {
        const v = window.__bozzetto;
        const f0 = v.frameNo;
        const poke = w ? setInterval(() => v.wake(), 40) : 0;
        setTimeout(() => {
          clearInterval(poke);
          ok(Math.round(((v.frameNo - f0) * 1000) / d));
        }, d);
      }),
    [ms, working],
  );
/**
 * The best of three such windows: the software renderer still stalls the
 * GPU process now and then (an autosave's smooth thumbnail is sixteen real
 * renders), and a window caught in one says nothing about the pacing.
 */
const steadyRate = async (win, ms, working) => {
  let best = 0;
  for (let i = 0; i < 3; i++) best = Math.max(best, await loopRate(win, ms, working));
  return best;
};
/** Wait until the loop says it is paced (or is not), as the viewer decides it. */
const pacedNow = (win, want, timeout = 15_000) =>
  win
    .waitForFunction((w) => window.__bozzetto.isPaced() === w, want, { timeout })
    .then(() => true)
    .catch(() => false);
/** Preferences, opened the way the Edit menu opens it. */
const openPrefs = async (app, win) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'edit:preferences'));
  await win.waitForFunction(() => !!document.querySelector('.prefs__desktop') && !document.querySelector('.prefs__desktop').closest('[hidden]'), null, { timeout: 10_000 }).catch(() => {});
};
const desktopRows = (win) =>
  win.evaluate(() => {
    const group = document.querySelector('.prefs__desktop');
    if (!group) return null;
    return {
      head: group.querySelector('.prefs__group')?.textContent ?? null,
      rows: [...group.querySelectorAll('.prefs__toggle')].map((r) => ({
        title: r.querySelector('.prefs__choice-title').textContent,
        hint: r.querySelector('.prefs__choice-hint').textContent,
        on: r.querySelector('input').checked,
        shown: !r.hidden,
      })),
      restart: !group.querySelector('.prefs__restart').hidden,
    };
  });

const t = checks('desktop');
/** The app being checked, whichever kind it is: { app, win, errors, close }. */
let run = null;

// --- a packaged build, and what a page can make the main process do --------

const freePort = () =>
  new Promise((ok) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

/** Kill a detached child and everything it started (Chromium's helpers). */
const killGroup = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Gone already.
  }
};

/**
 * The packaged app, started as a user would. Its fuses leave no inspector
 * for Playwright's Electron launcher to attach to, so it is driven over
 * Chromium's remote debugging port instead; --inspect=0 is passed so its
 * log can show the inspector stayed shut.
 */
async function startPackaged(exe) {
  const port = await freePort();
  const child = spawn(exe, ['--no-sandbox', `--remote-debugging-port=${port}`, '--inspect=0', ...GL], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  let up = false;
  for (let i = 0; i < 240 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false);
    if (!up) await sleep(500);
  }
  if (!up) {
    killGroup(child);
    throw new Error(`the packaged app opened no debugging port:\n${log.slice(-1500)}`);
  }
  const browser = await playwright().chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let win = null;
  for (let i = 0; i < 240 && !win; i++) {
    win = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('bozzetto://app/')) ?? null;
    if (!win) await sleep(500);
  }
  if (!win) throw new Error(`no bozzetto://app page:\n${log.slice(-1500)}`);
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  await win.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 120_000, polling: 100 });
  return {
    app: null,
    win,
    errors,
    log: () => log,
    close: async () => {
      await browser.close().catch(() => {});
      killGroup(child);
    },
  };
}

/** How a packaged build is started: its AppRun, for an AppImage (set by packagedRun). */
let packagedExe = null;

/** Hand a file to the app as the OS does: a second copy starts with it, passes it over and leaves. */
function openFromOs(file) {
  const [cmd, args] = packagedExe ? [packagedExe, [file, '--no-sandbox', ...GL]] : [electron, [root, file, '--no-sandbox', ...GL]];
  return new Promise((ok) => {
    const child = spawn(cmd, args, { env, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      ok(false);
    }, 60_000);
    child.on('exit', () => {
      clearTimeout(timer);
      ok(true);
    });
  });
}

/** What a binary prints when asked to be Node with ELECTRON_RUN_AS_NODE. */
function runAsNode(bin) {
  return new Promise((ok) => {
    const child = spawn(bin, ['-e', 'process.stdout.write("ran as node")'], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', XDG_CONFIG_HOME: join(home, 'as-node') },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    // Not Node, it is the app: as root it refuses to start without
    // --no-sandbox, and anywhere else it is stopped here.
    const timer = setTimeout(() => killGroup(child), 15_000);
    child.on('exit', () => {
      clearTimeout(timer);
      killGroup(child);
      ok(out.trim());
    });
  });
}

/**
 * A stand-in for the Cloudflare deployment, on loopback (where the app
 * takes http). It writes down every request; sets Access's cookie -
 * SameSite=Lax, as the owner has it - on the page the sign-in window
 * loads; and answers the API as Access would, with a redirect to its login
 * when the cookie is missing. Its sign-in page also tries what a hostile
 * page would: an smb: window, a navigation to one, and an https: help link.
 */
function deployment() {
  const seen = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const path = new URL(req.url, 'http://stand-in').pathname;
      const signedIn = /(^|;\s*)CF_Authorization=/.test(req.headers.cookie ?? '');
      seen.push({ method: req.method, path, headers: req.headers });
      if (path === '/admin/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'CF_Authorization=signed-in; Path=/; HttpOnly; SameSite=Lax',
        });
        res.end(`<!doctype html><title>Signed in</title><script>
          window.open('smb://example.invalid/from-sign-in');
          window.open('https://example.com/sign-in-help');
          setTimeout(() => { location.href = 'smb://example.invalid/sign-in-navigation'; }, 20);
        </script>`);
      } else if (path.startsWith('/admin/api/') && !signedIn) {
        res.writeHead(302, { location: 'https://example.cloudflareaccess.com/cdn-cgi/access/login/127.0.0.1' }).end();
      } else if (path === '/admin/api/whoami') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"email":"owner@example.com"}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      }
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })),
  );
}
let deploy = null;
/** Where a page asks Save to write that is not the document; nothing may ever be there. */
const outside = join(tmpdir(), `bozzetto-outside-${process.pid}.bozz`);

/**
 * What a page can make the main process do, described at the top. With
 * `run.app` (development) a few more go straight to the main process: the
 * IPC handlers without the preload, a stubbed save dialog, the sign-in
 * window's settings, the cookie jar. Signing in and out goes through
 * Server settings there, and through the bridge for a packaged build,
 * whose menus a test cannot reach.
 */
async function security(run) {
  const { app, win } = run;
  const ask = (fn, arg, ms = 20_000) =>
    Promise.race([
      win.evaluate(fn, arg),
      sleep(ms).then(() => {
        throw new Error(`no answer in ${ms / 1000} s: a dialog waiting?`);
      }),
    ]);
  const want = require('electron/package.json').version;
  await win.keyboard.press('Escape'); // Preferences, if a check above left it open
  const version = await win.evaluate(() => window.bozzettoDesktop.version);
  t.eq(version, want, 'the app runs the Electron this checkout names');

  // --- links: to the OS as https: and mailto: only --------------------------
  /** Links in the page, to click; `blank` ones open a new window. */
  const addLinks = (list) =>
    win.evaluate((items) => {
      document.querySelectorAll('a[id^="link-"]').forEach((a) => a.remove());
      items.forEach(([id, href, blank], i) => {
        const a = document.createElement('a');
        a.id = `link-${id}`;
        a.href = href;
        if (blank) a.target = '_blank';
        a.textContent = id;
        a.style.cssText = `position:fixed;left:8px;top:${8 + i * 26}px;z-index:2147483647;background:#fff;color:#000;font:14px sans-serif;padding:2px 6px`;
        document.body.appendChild(a);
      });
    }, list);
  const beforeLinks = osLog().length;
  const windows = [
    ['smb', 'smb://example.invalid/share', true],
    ['file', 'file:///etc/hosts', true],
    ['lookalike', 'bozzetto://app.example/', true],
    ['http', 'http://example.com/plain', true],
    ['https', 'https://example.com/bozzetto-link', true],
    // A server on this machine, as after publishing to a local one; and a
    // name that only resolves to it, which is not this machine's.
    ['local', 'http://localhost:8788/published', true],
    ['local-lookalike', 'http://127.0.0.1.nip.io/published', true],
  ];
  await addLinks(windows);
  // Real clicks, so each link has the user's gesture behind it.
  for (const [id] of windows) await win.click(`#link-${id}`);
  await win.evaluate(() => {
    window.open('smb://example.invalid/scripted');
    window.open('file:///etc/passwd');
  });
  await sleep(1500);
  t.eq(
    show(osLog().slice(beforeLinks).sort()),
    show(['xdg-open http://localhost:8788/published', 'xdg-open https://example.com/bozzetto-link']),
    'of the links and window.opens the page tries, only https: and http: to this machine reach the OS',
  );
  await win.evaluate(() => document.querySelectorAll('a[id^="link-"]').forEach((a) => a.remove()));

  // --- the server, through the main process ----------------------------------
  const base = deploy.base;
  const formsShow = (owner) =>
    win
      .waitForFunction(
        (o) => {
          const fields = [...document.querySelectorAll('.gallery-form__fields')];
          return fields.length > 0 && fields.every((f) => f.hidden === !o);
        },
        owner,
        { timeout: 15_000 },
      )
      .then(() => true, () => false);
  const probesSince = (mark) => deploy.seen.slice(mark).filter((r) => r.path === '/admin/api/whoami');
  const withCookie = (r) => /(^|;\s*)CF_Authorization=/.test(r?.headers.cookie ?? '');
  const beforeSignIn = osLog().length;
  const markIn = deploy.seen.length;
  if (app) {
    await app.evaluate(({ app: a }) => {
      globalThis.__opened = [];
      a.on('browser-window-created', (_e, w) =>
        w.webContents.once('did-finish-load', () => {
          const p = w.webContents.getLastWebPreferences() ?? {};
          globalThis.__opened.push({ sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, preload: p.preload ?? null });
        }),
      );
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().startsWith('bozzetto://'))
        ?.webContents.send('menu:command', 'server:settings'),
    );
    // Preferences is built from the same parts, so everything is found
    // inside the Server settings dialog.
    const panel = win.getByRole('dialog', { name: 'Server settings' });
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
    await panel.locator('.dsettings__input').fill(base);
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await win.waitForFunction((u) => document.querySelector('[aria-label="Server settings"] .dsettings__status')?.textContent?.startsWith(u), base, { timeout: 10_000 });
    await panel.getByRole('button', { name: 'Sign in', exact: true }).click();
    const signedIn = await win
      .waitForFunction((u) => document.querySelector('[aria-label="Server settings"] .dsettings__status')?.textContent === `Signed in to ${u}.`, base, { timeout: 60_000 })
      .then(() => true, () => false);
    const owner = await formsShow(true);
    t.ok(
      signedIn && owner && probesSince(markIn).some(withCookie),
      `signed in from Server settings, the page is told: it asks the server again and offers the owner publishing (${show({ signedIn, owner })})`,
    );
    const prefs = await app.evaluate(() => globalThis.__opened);
    t.ok(
      prefs.length === 1 && prefs[0].sandbox === true && prefs[0].contextIsolation === true && prefs[0].nodeIntegration === false && !prefs[0].preload,
      `the sign-in window is sandboxed, isolated, with no Node and no preload (${show(prefs)})`,
    );
  } else {
    await ask((u) => window.bozzettoDesktop.setServer(u), base);
    const signedIn = await ask(() => window.bozzettoDesktop.signIn(), undefined, 60_000);
    t.ok(signedIn?.signedIn === true, `the sign-in window signs in (${show(signedIn)})`);
  }
  await sleep(500);
  t.eq(
    show(osLog().slice(beforeSignIn)),
    show(['xdg-open https://example.com/sign-in-help']),
    'the sign-in window hands the OS its https: link, and not its smb: window or its navigation to one',
  );
  const markPost = deploy.seen.length;
  const posted = await ask(() =>
    window.bozzettoDesktop.api({
      pathname: '/admin/api/projects',
      method: 'POST',
      body: new TextEncoder().encode('{"title":"check"}').buffer,
      contentType: 'application/json',
    }),
  );
  const post = deploy.seen.slice(markPost).find((r) => r.method === 'POST');
  const h = post?.headers ?? {};
  t.ok(
    posted.status === 200 && !!post && !('origin' in h) && (h['sec-fetch-site'] ?? 'none') === 'none',
    `6a: a POST through the proxy carries no Origin, and Sec-Fetch-Site ${h['sec-fetch-site'] ?? 'not at all'}, which the server lets write (${show({ status: posted.status, origin: h.origin ?? null, site: h['sec-fetch-site'] ?? null, mode: h['sec-fetch-mode'] ?? null, dest: h['sec-fetch-dest'] ?? null })})`,
  );
  t.ok(withCookie(post), `6b: and the Access cookie, set SameSite=Lax by the sign-in window, goes with it (Cookie: ${h.cookie ?? 'none'})`);
  if (app) {
    const jar = await app.evaluate(async ({ session }) =>
      (await session.fromPartition('persist:bozzetto-server').cookies.get({ name: 'CF_Authorization' })).map((c) => ({ sameSite: c.sameSite, httpOnly: c.httpOnly })),
    );
    t.ok(jar.length === 1 && jar[0].sameSite === 'lax', `the cookie in the app's jar is the Lax one the deployment set (${show(jar)})`);
  }

  const markOut = deploy.seen.length;
  if (app) {
    await win.getByRole('dialog', { name: 'Server settings' }).getByRole('button', { name: 'Sign out', exact: true }).click();
    const settled = await win
      .waitForFunction((u) => document.querySelector('[aria-label="Server settings"] .dsettings__status')?.textContent?.startsWith(`${u} — not signed in`), base, { timeout: 15_000 })
      .then(() => true, () => false);
    const guest = await formsShow(false);
    const probes = probesSince(markOut);
    t.ok(
      settled && guest && probes.length > 0 && !probes.some(withCookie),
      `signed out in Server settings, the page is told: it asks again, without the cookie, and the publish forms go back to their gate (${show({ settled, guest, probes: probes.length })})`,
    );
    await win.keyboard.press('Escape');
  } else {
    await ask(() => window.bozzettoDesktop.signOut());
  }
  const markAfter = deploy.seen.length;
  await ask(() => window.bozzettoDesktop.api({ pathname: '/admin/api/projects', method: 'POST', body: new TextEncoder().encode('{}').buffer, contentType: 'application/json' }));
  const status = await ask(() => window.bozzettoDesktop.getServer());
  const afterOut = deploy.seen.slice(markAfter).find((r) => r.method === 'POST');
  t.ok(!!afterOut && !withCookie(afterOut) && status.signedIn === false, `and the cookie is gone from the proxy too (${show({ cookie: afterOut?.headers.cookie ?? null, status })})`);

  // --- files: the page never names where Save writes ------------------------
  const docs = join(home, 'docs');
  mkdirSync(docs);
  const docPath = join(docs, 'scene.bozz');
  const made = await win.evaluate(async () => {
    const s = window.__sculpt;
    const before = await s.file.pack();
    await s.session.addBaseMesh('hand-stylized');
    const doc = await s.file.pack();
    // Back to the clean boot scene, so opening the file asks nothing.
    await s.file.open(before);
    let bin = '';
    const u = new Uint8Array(doc);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  writeFileSync(docPath, Buffer.from(made, 'base64'));
  // Real scenes the page may not read: one never opened, one reached by
  // climbing out of the folder of one that was.
  copyFileSync(docPath, join(home, 'other.bozz'));
  copyFileSync(docPath, join(home, 'escape.bozz'));
  await win.evaluate(() => {
    window.__opened = [];
    window.bozzettoDesktop.onOpenPath((p) => window.__opened.push({ keys: Object.keys(p).sort(), ref: p.ref, name: p.name }));
  });
  const handedOver = await openFromOs(docPath);
  const built = await win
    .waitForFunction(() => window.__sculpt.session.getMeshes().length === 2, null, { timeout: 60_000 })
    .then(() => true, () => false);
  await sleep(500); // the page names its document once the scene is built
  const opened = await win.evaluate(() => window.__opened);
  t.ok(handedOver && built && opened.length === 1, `a .bozz double-clicked while the app runs opens in it (${show({ handedOver, built, opened })})`);
  t.eq(show(opened[0]?.keys), show(['bytes', 'name', 'ref']), 'and the page is given its name and a ref, never its path');
  const docRef = opened[0]?.ref;
  if (app) {
    const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('bozzetto://'))?.getTitle());
    t.eq(title, 'scene.bozz - Bozzetto', 'the title names it, from the path only the main process holds');
  }

  const reads = await ask(
    async ([doc, other, climbed]) => {
      const b = window.bozzettoDesktop;
      const attempt = async (p) => {
        try {
          const r = await b.readScene(p);
          return { ok: true, keys: Object.keys(r).sort(), size: r.bytes.byteLength };
        } catch (e) {
          return { ok: false, message: String(e?.message ?? e) };
        }
      };
      return {
        recents: await b.recentFiles(),
        doc: await attempt(doc),
        refused: [await attempt('/etc/passwd'), await attempt(other), await attempt(climbed), await attempt('../escape.bozz')],
      };
    },
    [docPath, join(home, 'other.bozz'), `${docs}/../escape.bozz`],
  );
  t.ok(
    reads.recents.includes(docPath) && reads.doc.ok && reads.doc.size === statSync(docPath).size && show(reads.doc.keys) === show(['bytes', 'name', 'ref']),
    `a file in recents can be read by its path, and comes back without it (${show(reads.doc)})`,
  );
  t.ok(reads.refused.every((r) => !r.ok), `any other path is refused: /etc/passwd, a scene never opened, one reached through .., a relative one (${show(reads.refused.map((r) => r.ok))})`);
  const leaks = reads.refused.filter((r) => /passwd|escape|other\.bozz|\/tmp\/|\/etc\//.test(r.message ?? '') || (r.message ?? '').includes(home));
  t.ok(leaks.length === 0, `and the refusal names no path: "${reads.refused[0].message}"`);

  const said = (n) => `bozzetto save check ${n}`;
  const docSays = () => readFileSync(docPath, 'utf8');
  const save = (n, ...extra) => ask(([text, more]) => window.bozzettoDesktop.saveScene(new TextEncoder().encode(text).buffer, ...more), [said(n), extra]);
  const climbedTo = `${docs}/../climbed.bozz`;
  rmSync(outside, { force: true });
  const first = await save(1, outside);
  t.ok(docSays() === said(1) && !existsSync(outside), `Save writes the document, not a path the page names (${outside})`);
  await save(2, climbedTo);
  t.ok(docSays() === said(2) && !existsSync(resolve(climbedTo)), `nor one that climbs out of its folder (${climbedTo})`);
  t.ok(show(Object.keys(first ?? {}).sort()) === show(['name', 'ref']) && first.name === 'scene.bozz' && first.ref === docRef, `and it says what it saved by name and ref (${show(first)})`);
  await win.evaluate(() => window.bozzettoDesktop.setDocument({ ref: 987654321, dirty: false }));
  await save(3);
  t.ok(docSays() === said(3), 'a ref the window was never given changes nothing: Save still writes the document');

  if (app) {
    // A page that reached IPC itself, past the preload: a path in every
    // field Save or the document could have read.
    const raw = await app.evaluate(async ({ ipcMain, BrowserWindow }, target) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('bozzetto://'));
      const event = { sender: w.webContents };
      ipcMain.emit('file:document', event, { ref: 987654321, path: target, filePath: target, dirty: false });
      const handler = ipcMain._invokeHandlers?.get('file:save');
      if (!handler) return 'no handler map in this Electron';
      const bytes = new TextEncoder().encode('bozzetto save check 4').buffer;
      return handler(event, { bytes, filePath: target, path: target });
    }, outside);
    t.ok(docSays() === said(4) && !existsSync(outside), `straight to the handlers too, the path in the call is never read (${show(raw)})`);

    // Save As and an untitled Save keep their dialog, stubbed here: what
    // it was asked to start at, and what it answers.
    await app.evaluate(({ dialog }) => {
      globalThis.__asked = [];
      globalThis.__realSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async (_w, opts) => {
        globalThis.__asked.push(opts?.defaultPath ?? null);
        return globalThis.__answer ?? { canceled: true, filePath: '' };
      };
    });
    const savedAs = join(docs, 'saved-as.bozz');
    await app.evaluate((_e, p) => {
      globalThis.__answer = { canceled: false, filePath: p };
    }, savedAs);
    const as = await ask(() => window.bozzettoDesktop.saveSceneAs(new TextEncoder().encode('bozzetto save check 5').buffer, '../../etc/cron.d/evil.bozz'));
    await save(6);
    const askedAs = await app.evaluate(() => globalThis.__asked.splice(0));
    t.ok(
      as?.name === 'saved-as.bozz' && readFileSync(savedAs, 'utf8') === said(6) && docSays() === said(4) && show(askedAs) === show([docPath]),
      `Save As asks, starting at the document, writes where the dialog says, and Save follows it there (${show({ as, askedAs })})`,
    );
    await app.evaluate(() => {
      globalThis.__answer = { canceled: true, filePath: '' };
    });
    await win.evaluate(() => window.bozzettoDesktop.setDocument({ ref: null, dirty: true }));
    const untitled = await save(7, outside);
    const suggested = await ask(() => window.bozzettoDesktop.saveSceneAs(new TextEncoder().encode('x').buffer, '/etc/cron.d/evil.bozz'));
    const askedUntitled = await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = globalThis.__realSaveDialog;
      return globalThis.__asked.splice(0);
    });
    t.ok(
      untitled === null && suggested === null && !existsSync(outside) && show(askedUntitled) === show(['sculpt.bozz', 'evil.bozz']),
      `untitled, Save asks rather than take the page's path, and a suggestion is a name, never a folder (${show({ untitled, askedUntitled })})`,
    );
  }
  await win.evaluate((ref) => window.bozzettoDesktop.setDocument({ ref, dirty: false }), docRef);
  await save(8);
  t.ok(docSays() === said(8), 'and the page can name a file it was given again: Save writes it');

  // --- navigations the page starts, last of the page's own checks -----------
  const beforeNav = osLog().length;
  const navigations = [
    ['nav-smb', 'smb://example.invalid/navigation', false],
    ['nav-lookalike', 'bozzetto://app.example/navigation', false],
    ['nav-mail', 'mailto:someone@example.com', false],
  ];
  await addLinks(navigations);
  for (const [id] of navigations) await win.evaluate((x) => document.getElementById(`link-${x}`).click(), id);
  await sleep(1500);
  const stayed = await win.evaluate(() => {
    document.querySelectorAll('a[id^="link-"]').forEach((a) => a.remove());
    // Playwright counts a navigation the app refused as still under way,
    // and only a navigation within the page tells it otherwise.
    history.replaceState(history.state, '', location.href);
    return { url: location.href, sculpt: !!window.__sculpt };
  });
  t.eq(show(osLog().slice(beforeNav)), show(['xdg-email mailto:someone@example.com']), 'a page navigating to a mailto: hands it to the mail program, and to smb: or a look-alike of the app, nothing');
  t.ok(stayed.sculpt && stayed.url.startsWith('bozzetto://app/'), `and the app stays where it is (${show(stayed)})`);
  t.ok(run.errors.length === 0, `no page errors${run.errors.length ? `: ${run.errors.join(' | ')}` : ''}`);

  // --- bozzetto:// serves the app's own host only ------------------------------
  // Last: it takes the window off the app. A navigation from here is the
  // browser's own, not the page's, so it reaches the protocol handler.
  const statusOf = (u) => win.goto(u).then((r) => r?.status() ?? null, (e) => `threw ${String(e.message).split('\n')[0]}`);
  const hosts = {
    evil: await statusOf('bozzetto://evil/index.html'),
    lookalike: await statusOf('bozzetto://app.example/index.html'),
    app: await statusOf('bozzetto://app/index.html'),
  };
  t.ok(hosts.evil === 404 && hosts.lookalike === 404 && hosts.app === 200, `bozzetto:// answers its own host and 404s any other (${show(hosts)})`);
}

/**
 * A packaged build: the fuse wire read back from its binary, the two
 * fuses that matter most seen at work, then the checks above.
 */
async function packagedRun() {
  let binary = packaged;
  packagedExe = packaged;
  if (/\.AppImage$/i.test(packaged)) {
    // No FUSE needed: the AppImage's own files, started through its AppRun.
    execFileSync(packaged, ['--appimage-extract'], { cwd: home, stdio: 'ignore' });
    packagedExe = join(home, 'squashfs-root', 'AppRun');
    const bin = /BIN="\$APPDIR\/([^"]+)"/.exec(readFileSync(packagedExe, 'utf8'))?.[1] ?? 'bozzetto';
    binary = join(home, 'squashfs-root', bin);
  }
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(binary);
  const STATE = { 48: 'off', 49: 'on', 114: 'removed' };
  const fuses = Object.fromEntries(
    Object.entries(wire)
      .filter(([k]) => k !== 'version')
      .map(([k, v]) => [FuseV1Options[k] ?? `fuse ${k}`, STATE[v] ?? String(v)]),
  );
  const wanted = {
    RunAsNode: 'off',
    EnableCookieEncryption: 'on',
    EnableNodeOptionsEnvironmentVariable: 'off',
    EnableNodeCliInspectArguments: 'off',
    EnableEmbeddedAsarIntegrityValidation: 'on',
    OnlyLoadAppFromAsar: 'on',
    GrantFileProtocolExtraPrivileges: 'off',
  };
  const wrong = Object.keys(wanted).filter((k) => fuses[k] !== wanted[k]);
  t.ok(wrong.length === 0, `the packaged binary's fuses are as package.json sets them${wrong.length ? `, except ${wrong.join(', ')}` : ''} (${show(fuses)})`);
  const asNode = await runAsNode(binary);
  t.ok(!asNode.includes('ran as node'), `ELECTRON_RUN_AS_NODE does not make it Node (it said: ${show(asNode.slice(0, 100))})`);
  // V-sync on for this run, unlike a new install. Known issue, open: with
  // --disable-frame-rate-limit (v-sync off) the main process's UI thread
  // blocks, in a wait inside Chromium, once the sign-in window is destroyed
  // after input or a second copy's file handoff has reached the app - for a
  // minute and a half to over four - and DevTools, which this test drives
  // the app through, blocks with it; the page itself carries on and has its
  // answer. Reproduced only under Xvfb with SwiftShader; 0.5.4 does the
  // same. What would confirm it on hardware: v-sync off, a .bozz
  // double-clicked into the running app, then Server > Sign In: the app
  // stops answering (menus, Save) once the sign-in window has closed, and
  // the same steps with V-sync on in Preferences > Desktop do not.
  mkdirSync(join(home, 'bozzetto'), { recursive: true });
  writeFileSync(join(home, 'bozzetto', 'launch.json'), JSON.stringify({ vsync: true, highPerformanceGpu: false }));
  run = await startPackaged(packagedExe);
  t.ok(!!run.win, 'the packaged app is up, from its asar, serving its own pages');
  t.ok(await run.win.evaluate(() => window.bozzettoDesktop.launch.vsync), 'with v-sync on, from its launch.json');
  t.ok(!/Debugger listening/.test(run.log()), 'and --inspect opened no debugger in its main process');
  await security(run);
}


/** The app as it stands in this checkout: launch settings and pacing, then the checks above. */
async function development() {
  // What the fuses of a packaged build turn off, working here, where
  // nothing is fused: the check of a packaged build means something.
  t.ok((await runAsNode(electron)).includes('ran as node'), 'the stock Electron binary runs as Node when ELECTRON_RUN_AS_NODE says so');

  // --- first start: no launch.json, so v-sync is off -----------------------
  run = await start();
  const { app, win } = run;
  t.ok(run.going, 'the app is up, its window shown and its loop running');
  const main = await app.evaluate(({ app: a, screen }) => ({
    frameRateLimit: a.commandLine.hasSwitch('disable-frame-rate-limit'),
    gpuVsync: a.commandLine.hasSwitch('disable-gpu-vsync'),
    hpGpu: a.commandLine.hasSwitch('force_high_performance_gpu'),
    displayHz: Math.round(screen.getPrimaryDisplay().displayFrequency || 0),
    userData: a.getPath('userData'),
    platform: process.platform,
  }));
  t.ok(main.frameRateLimit && main.gpuVsync, `with no launch.json, v-sync is off: the frame-rate limit and GPU v-sync switches are set (${show(main)})`);
  t.ok(!main.hpGpu, `the high-performance GPU switch is left off on ${main.platform}, where it does nothing`);
  const launch = await win.evaluate(() => ({ launch: window.bozzettoDesktop.launch, pacing: window.__bozzetto.getPacing() }));
  t.ok(
    launch.launch.vsync === false && launch.launch.displayHz === main.displayHz && launch.launch.onBattery === false && launch.pacing.uncapped === true,
    `the page is told at load, through its arguments, and paces itself (${show(launch)})`,
  );
  const now = await win.evaluate(() => window.bozzettoDesktop.powerNow());
  t.ok(now.onBattery === false && now.displayHz === main.displayHz, `and can ask how things stand now, as a reloaded page does (${show(now)})`);

  const free = await steadyRate(win, 2000, true);
  t.ok(free > 180, `while you work, frames are not held for the display: ${free} a second`);
  t.ok(await pacedNow(win, true), 'a second after everything stops, the loop paces itself');
  const idle = await steadyRate(win, 2000, false);
  const hz = main.displayHz || 60;
  t.ok(idle >= hz * 0.6 && idle <= hz * 1.15, `and runs at the display's rate: ${idle} a second against ${hz} Hz${main.displayHz ? '' : ' (no rate reported here; 60 assumed)'}`);
  // Input wakes it at once.
  const woke = await win.evaluate(() => {
    const v = window.__bozzetto;
    const r = v.captureCanvas.getBoundingClientRect();
    v.captureCanvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 30, clientY: r.top + 30, bubbles: true }));
    return !v.isPaced();
  });
  const again = await loopRate(win, 1000, true);
  t.ok(woke && again > 180, `input wakes it, and it runs free again: ${again} a second`);

  // --- on battery: paced while working too -----------------------------------
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('on-battery'));
  t.ok(await pacedNow(win, true, 5000), 'the OS saying the machine is on battery reaches the page');
  const battery = await steadyRate(win, 2000, true);
  t.ok(battery <= hz * 1.15, `on battery it stays at the display's rate while you work: ${battery} a second`);
  await win.keyboard.press('p');
  await win.waitForTimeout(600);
  const rows = await win.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.fps-meter__row')].map((r) => [r.children[0].textContent, r.children[1].textContent])),
  );
  t.eq(rows.pacing, `v-sync off · paced to ${hz} Hz (battery)`, 'the meter says so');
  t.ok(
    rows.fps?.includes(`refresh ${hz} Hz (${main.displayHz ? 'display' : 'assumed'})`),
    `and budgets by the display's rate as Electron reports it, not by the frames' (${rows.fps})`,
  );
  await win.keyboard.press('p');
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('on-ac'));
  const mains = await steadyRate(win, 2000, true);
  t.ok(mains > 180, `back on mains, it runs free again: ${mains} a second`);

  // --- Preferences: the Desktop group, and launch.json ----------------------
  await openPrefs(app, win);
  let prefs = await desktopRows(win);
  const vsyncRow = prefs?.rows.find((r) => r.title === 'V-sync');
  const gpuRow = prefs?.rows.find((r) => r.title === 'Use the high-performance GPU');
  t.ok(prefs?.head === 'Desktop' && vsyncRow && !vsyncRow.on && vsyncRow.shown, `the app's Preferences have a Desktop group, V-sync off (${show(prefs)})`);
  t.ok(/Takes effect when Bozzetto next starts\./.test(vsyncRow?.hint ?? ''), `and say when it applies: "${vsyncRow?.hint}"`);
  t.ok(gpuRow && !gpuRow.shown, 'the high-performance GPU row is not shown where the switch does nothing');
  t.ok(!prefs?.restart, 'nothing to restart for yet');
  await win.evaluate(() => {
    const row = [...document.querySelectorAll('.prefs__desktop .prefs__toggle')].find((r) => r.querySelector('.prefs__choice-title').textContent === 'V-sync');
    row.querySelector('input').click();
  });
  await win.waitForFunction(() => !document.querySelector('.prefs__desktop .prefs__restart').hidden, null, { timeout: 10_000 }).catch(() => {});
  prefs = await desktopRows(win);
  const file = join(main.userData, 'launch.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  t.ok(prefs.restart && prefs.rows[0].on, 'ticked, it says a restart applies it');
  t.eq(show(saved), '{"vsync":true,"highPerformanceGpu":false}', 'and launch.json has it');
  const read = await win.evaluate(() => window.bozzettoDesktop.getLaunchOptions());
  t.ok(read.saved.vsync === true && read.active.vsync === false, `read back: saved on, running off until the next start (${show(read)})`);
  t.ok(run.errors.length === 0, `no page errors${run.errors.length ? `: ${run.errors.join(' | ')}` : ''}`);
  await app.close();
  run = null;

  // --- second start: launch.json says v-sync on -------------------------------
  run = await start();
  t.ok(run.going, 'restarted, the window is shown and the loop running');
  const second = await run.app.evaluate(({ app: a }) => ({
    frameRateLimit: a.commandLine.hasSwitch('disable-frame-rate-limit'),
    gpuVsync: a.commandLine.hasSwitch('disable-gpu-vsync'),
  }));
  t.ok(!second.frameRateLimit && !second.gpuVsync, `restarted with V-sync on, neither switch is set (${show(second)})`);
  const page2 = await run.win.evaluate(() => ({ vsync: window.bozzettoDesktop.launch.vsync, pacing: window.__bozzetto.getPacing() }));
  t.ok(page2.vsync === true && page2.pacing.uncapped === false, `and the page holds each frame for the display (${show(page2)})`);
  const held = await steadyRate(run.win, 2000, true);
  t.ok(held >= 30 && held <= 75, `while you work, frames come at the display's rate: ${held} a second`);
  await openPrefs(run.app, run.win);
  prefs = await desktopRows(run.win);
  t.ok(prefs?.rows[0].on && !prefs.restart, `Preferences show V-sync on, with nothing to restart for (${show(prefs)})`);
  // Back off through the bridge, as the checkbox does.
  const back = await run.win.evaluate(() => window.bozzettoDesktop.setLaunchOptions({ vsync: false }));
  t.eq(show(back), '{"vsync":false,"highPerformanceGpu":false}', 'and turned off again, launch.json says so');
  t.ok(run.errors.length === 0, `no page errors${run.errors.length ? `: ${run.errors.join(' | ')}` : ''}`);

  await security(run);
}

try {
  deploy = await deployment();
  if (packaged) {
    await packagedRun();
  } else {
    await development();
  }
} catch (e) {
  t.ok(false, `threw: ${e?.stack ?? e}`);
  // A packaged app's own log is not on this console; what it and the
  // stand-in deployment saw is most of what there is to go on.
  if (run?.log) {
    const tail = run.log().split('\n').filter((l) => l.trim() && !/dbus\/|ssl_client_socket/.test(l)).slice(-30);
    console.log(`--- the app's log ---\n${tail.join('\n')}`);
  }
  if (deploy?.seen.length) console.log(`--- the deployment saw ---\n${deploy.seen.map((r) => `${r.method} ${r.path}`).join('\n')}`);
} finally {
  await run?.close().catch(() => {});
  deploy?.close();
  rmSync(outside, { force: true });
  rmSync(home, { recursive: true, force: true });
}
const failed = t.report();
console.log(failed ? `${failed} check(s) failed` : 'all suites passed');
process.exit(failed ? 1 : 0);
