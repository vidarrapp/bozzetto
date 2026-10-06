// The desktop app itself, under Electron, on a virtual display:
//
//   npm run build:desktop && xvfb-run -a node tests/e2e/desktop.mjs
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
// Electron's binary is fetched by `node node_modules/electron/install.js`;
// without it this exits 2 and says so.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checks, playwright } from './lib.mjs';

const root = resolve('.');
if (!existsSync(join(root, 'dist-desktop', 'index.html'))) {
  console.error('dist-desktop/index.html missing - run `npm run build:desktop` first');
  process.exit(2);
}
let electron;
try {
  electron = createRequire(import.meta.url)('electron');
} catch (e) {
  console.error(`no Electron binary (${e.message}) - run \`node node_modules/electron/install.js\``);
  process.exit(2);
}
if (!process.env.DISPLAY) {
  console.error('no display - run under `xvfb-run -a`');
  process.exit(2);
}

const show = (o) => JSON.stringify(o);
// Its own settings folder, so neither a real install's launch.json nor its
// single-instance lock is touched.
const home = mkdtempSync(join(tmpdir(), 'bozzetto-desktop-'));

/**
 * The app, started as a user would, with software GL on the virtual
 * display. The GPU watchdog is off: compiling the sculpt shaders in
 * software holds the GPU process past it, which then kills the context.
 */
async function start() {
  const app = await playwright()._electron.launch({
    executablePath: electron,
    args: [root, '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
    env: { ...process.env, XDG_CONFIG_HOME: home },
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
  return { app, win, errors, going };
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
let run = null;
try {
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
} catch (e) {
  t.ok(false, `threw: ${e?.stack ?? e}`);
} finally {
  await run?.app.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
const failed = t.report();
console.log(failed ? `${failed} check(s) failed` : 'all suites passed');
process.exit(failed ? 1 : 0);
