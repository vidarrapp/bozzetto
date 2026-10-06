// The latency suites: the frame meter and what it reads; fast frames while
// a stroke, a pose drag or the view moves (the AO held under a stroke and
// dropped while things move, the fill and rim shadows held or staggered,
// and not one build, compile or allocation from pen-down to pen-up); the
// anti-aliasing that waits for a still view; adaptive quality's ladder;
// the desktop app's frame pacing as the viewer runs it (desktop.mjs runs
// it in the app); the Preferences that steer them and the diagnostic
// overlays they keep on; the damping's feel at any frame rate; and the
// measurements behind the work, printed with each run (stroke steps per
// mesh size, stroke ends, encode time full and fast, the canvas without
// MSAA against with, and a still frame smoothed against 4x MSAA).
// Each gets (page, base, t), as the smoke suites do.
import { openArmature, openSculpt } from './lib.mjs';
import { camera, devices, emptySpot, line, openForInput, screenOf, settle } from './smoke.mjs';

/** n frames of the page's own, after the viewer's. */
const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((ok) => {
        let i = 0;
        const f = () => (++i >= k ? ok() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

const frameMode = (page) => page.evaluate(() => window.__bozzetto.frameMode());
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const passes = (page) => page.evaluate(() => window.__bozzetto.passCounts());
/** What changed between two counter snapshots, as { key: delta } (empty when nothing did). */
const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
const show = (o) => JSON.stringify(o);

/**
 * Every frame's mode, as the viewer decided it, from here on: the kind of
 * interaction, the AO and the shadows' schedule. Read with `modesSeen`.
 */
const recordModes = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    window.__modes = [];
    window.__drops = [];
    if (!v.__recording) {
      const decide = v.updateFrameMode.bind(v);
      v.updateFrameMode = (now, dt) => {
        decide(now, dt);
        const m = v.frameMode();
        window.__modes?.push(`${m.kind ?? 'still'}/${m.ao}/${m.shadows}`);
        // The AO's drop from the frame the view stopped on.
        if (m.kind === null && (window.__drops.length || m.aoDrop > 0)) window.__drops.push(m.aoDrop);
      };
      v.__recording = true;
    }
  });
const modesSeen = (page) => page.evaluate(() => [...new Set(window.__modes ?? [])]);

/** The Render panel's AO model, picked the way a user picks it. */
const aoModel = (page, value) =>
  page.evaluate((m) => {
    const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
    const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model').querySelector('select');
    sel.value = m;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value;
  }, value);

/**
 * The canvas as the viewer last drew it, kept in the page under `key`: read
 * in a frame callback queued after the viewer's own, so the drawing buffer
 * still holds that frame.
 */
const snapshot = (page, key) =>
  page.evaluate(
    (k) =>
      new Promise((ok) =>
        requestAnimationFrame(() => {
          const src = window.__bozzetto.captureCanvas;
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(src, 0, 0);
          (window.__shots ??= {})[k] = ctx.getImageData(0, 0, c.width, c.height).data;
          ok([c.width, c.height]);
        }),
      ),
    key,
  );

/**
 * Two kept frames against each other, outside `ex` (device px, inclusive):
 * the largest channel difference, the mean, and how many pixels differ.
 */
const compareShots = (page, a, b, ex = null) =>
  page.evaluate(
    ([ka, kb, box]) => {
      const A = window.__shots[ka];
      const B = window.__shots[kb];
      const w = window.__bozzetto.captureCanvas.width;
      let max = 0;
      let sum = 0;
      let n = 0;
      let changed = 0;
      for (let i = 0; i < A.length; i += 4) {
        const p = i / 4;
        const x = p % w;
        const y = (p - x) / w;
        if (box && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d > max) max = d;
        sum += d;
        n++;
        if (d > 0) changed++;
      }
      return { max, mean: sum / n, changed, n };
    },
    [a, b, ex],
  );

/** The page's settings store, as Preferences writes it. */
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bozzetto-settings') ?? '{}'));

/** Edit > Preferences, open; a row's checkbox by its title. */
const openPrefs = (page) => page.keyboard.press('Control+Comma');
/** One of a radio group's choices in Preferences, picked by its title, and the window closed. */
const openPrefsChoice = async (page, setting, title) => {
  await openPrefs(page);
  await page.locator(`[data-setting="${setting}"] .prefs__choice`, { hasText: title }).click();
  await page.keyboard.press('Escape');
};
/** A point of bare canvas in the viewer, with no panel or button over it. */
const emptySpotViewer = (page) =>
  page.evaluate(() => {
    const canvas = window.__bozzetto.captureCanvas;
    const r = canvas.getBoundingClientRect();
    for (let y = r.top + r.height * 0.3; y < r.bottom - 160; y += 23) {
      for (let x = r.left + r.width * 0.2; x < r.right - r.width * 0.4; x += 29) {
        if (document.elementFromPoint(x, y) === canvas) return [x, y];
      }
    }
    return null;
  });
const prefToggle = (page, title) =>
  page.evaluate((name) => {
    const row = [...document.querySelectorAll('.prefs__toggle')].find((r) => r.querySelector('.prefs__choice-title')?.textContent === name);
    row.querySelector('input').click();
    return row.querySelector('input').checked;
  }, title);

/**
 * A stroke run straight through InputShell's handlers, with no frame in
 * between: pointer events dispatched at the canvas, so the timing is the
 * stroke step's own and nothing waits on a software-rendered frame. The
 * path crosses the active object's middle, 12 px a move, a dab or two a
 * move at the default brush size, as a brisk real stroke does. Returns the
 * vendored step's times (the median, p90 and the slowest) and the stroke
 * end's, with the triangle count, and whether the press started a stroke.
 */
const timedStroke = (page, moves = 17) =>
  page.evaluate((n) => {
    const { input, session, viewer } = window.__sculpt;
    const canvas = viewer.captureCanvas;
    const r = canvas.getBoundingClientRect();
    const b = session.getMesh().computeWorldBound();
    const [px, py] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
    const pr = session.getPixelRatio();
    const cx = r.left + px / pr;
    const cy = r.top + py / pr;
    const steps = [];
    const prev = input.onWork;
    input.onWork = (ms, at, step) => {
      if (step > 0) steps.push(step);
      prev?.(ms, at, step);
    };
    const send = (type, x, y) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 77,
          pointerType: 'pen',
          isPrimary: true,
          clientX: x,
          clientY: y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.6,
          bubbles: true,
          cancelable: true,
        }),
      );
    const x0 = cx - (n * 12) / 2;
    const strokes = input.strokeCount();
    send('pointerdown', x0, cy);
    const started = input.strokeCount() === strokes + 1;
    // A press that missed would go on to orbit, and the orbit's pointer
    // capture fails for a synthetic pointer: stop there instead.
    if (!started) return { started, steps: 0, median: 0, p90: 0, max: 0, end: 0, tris: session.getMesh().getNbTriangles() };
    for (let i = 1; i <= n; i++) send('pointermove', x0 + i * 12, cy + 10 * Math.sin(i / 5));
    send('pointerup', x0 + n * 12, cy);
    input.onWork = prev;
    const sorted = [...steps].sort((p, q) => p - q);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    return {
      started,
      steps: sorted.length,
      median: at(0.5),
      p90: at(0.9),
      max: sorted[sorted.length - 1] ?? 0,
      end: input.lastEndMs,
      tris: session.getMesh().getNbTriangles(),
    };
  }, moves);

const fmt = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1));

/** The meter's rows, label to value. */
const meterRows = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.fps-meter__row')].map((r) => [r.children[0].textContent, r.children[1].textContent]),
    ),
  );
const meterUp = (page) => page.evaluate(() => !!document.querySelector('.fps-meter') && !document.querySelector('.fps-meter').hidden);

/**
 * Means over the last `n` frames the viewer kept (frameStats' own rings):
 * the loop's share and the encode, in ms, and how many frames that was.
 */
const recentFrames = (page, n) =>
  page.evaluate((k) => {
    const s = window.__bozzetto.frameStats;
    const N = s.encode.length;
    const m = Math.min(k, s.count);
    let loop = 0;
    let encode = 0;
    for (let j = 1; j <= m; j++) {
      const i = (s.head - j + N) % N;
      loop += s.loop[i];
      encode += s.encode[i];
    }
    return { frames: m, loop: m ? loop / m : 0, encode: m ? encode / m : 0 };
  }, n);

/**
 * Where a path's strokes can reach on the canvas, in device pixels: its
 * bounds grown by the brush radius and `margin` (the shadow a raised
 * stroke casts lands a little way off it).
 */
const reachOf = (page, path, margin) =>
  page.evaluate(
    ([pts, extra]) => {
      const { session, viewer } = window.__sculpt;
      const r = viewer.captureCanvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      const radius = session.getSculptManager().getCurrentTool()._radius ?? 50;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const grow = radius + extra;
      return {
        x0: Math.floor((Math.min(...xs) - grow - r.left) * pr),
        x1: Math.ceil((Math.max(...xs) + grow - r.left) * pr),
        y0: Math.floor((Math.min(...ys) - grow - r.top) * pr),
        y1: Math.ceil((Math.max(...ys) + grow - r.top) * pr),
      };
    },
    [path, margin],
  );

/** Wait out the view's settling: no camera move for a while, the AO back. */
const stillAgain = (page, timeout = 20_000) =>
  page
    .waitForFunction(
      () => {
        const m = window.__bozzetto.frameMode();
        return m.kind === null && m.aoDrop === 0;
      },
      null,
      { timeout },
    )
    .catch(() => {});

/**
 * The anti-aliasing in force: the mode, the meter's words for it, the
 * scene pass's MSAA, what the still frame's sum is doing and how many
 * times it has been drawn.
 */
const aaState = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    return {
      mode: v.getAntialias(),
      state: v.antialiasState(),
      samples: v.scenePass?.options.samples ?? null,
      sum: v.accumulate?.mode ?? null,
      renders: v.accumulate?.renders ?? 0,
    };
  });
/** Wait for the still frame to be smoothed and held. */
const heldAA = (page, timeout = 120_000) =>
  page.waitForFunction(() => window.__bozzetto.antialiasState() === '16/16 held', null, { timeout }).catch(() => {});
/** Wait for the still frame to be part-way through its smoothing. */
const smoothingAA = (page, timeout = 60_000) =>
  page.waitForFunction(() => /^([2-9]|1[0-5])\/16$/.test(window.__bozzetto.antialiasState()), null, { timeout }).catch(() => {});
/**
 * Count, from here on, each time a smoothed or part-smoothed frame is
 * sent back to the plain one; returns the count so far.
 */
const watchResets = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    if (!v.__resetWatch) {
      const reset = v.resetStill.bind(v);
      v.resetStill = () => {
        if (v.aaSamples > 0) window.__aaResets = (window.__aaResets ?? 0) + 1;
        reset();
      };
      v.__resetWatch = true;
    }
    return window.__aaResets ?? 0;
  });
/**
 * Let the still frame get part-way through its smoothing, do `fn`, and
 * say whether that sent it back to the plain frame (and from where).
 */
const resetBy = async (page, fn) => {
  await smoothingAA(page);
  const from = await page.evaluate(() => ({ n: window.__aaResets ?? 0, state: window.__bozzetto.antialiasState() }));
  await fn();
  const reset = await page
    .waitForFunction((n) => (window.__aaResets ?? 0) > n, from.n, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  return { reset, from: from.state };
};
/**
 * The next thumbnail's source frame, kept under `key` as captureThumbnail
 * reads it: drawImage watched for the viewer's canvas.
 */
const grabNextReadback = (page, key) =>
  page.evaluate((k) => {
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__grab) {
      const draw = proto.drawImage;
      proto.drawImage = function (src, ...rest) {
        const want = window.__grabKey;
        if (want && src === window.__bozzetto?.captureCanvas) {
          window.__grabKey = null;
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          draw.call(ctx, src, 0, 0);
          (window.__shots ??= {})[want] = ctx.getImageData(0, 0, c.width, c.height).data;
        }
        return draw.call(this, src, ...rest);
      };
      proto.__grab = true;
    }
    window.__grabKey = k;
  }, key);

/**
 * Adaptive quality, on, with the harness's own windows left unjudged (its
 * software frames miss every refresh): the test hands windows over itself,
 * a second apart on a clock of its own. `__judge(kind, n)` judges n of a
 * kind and returns the level asked for and the one in force.
 */
const adaptiveUnderTest = (page) =>
  page.evaluate(() => {
    delete window.__bozzettoAdaptiveOff;
    const v = window.__bozzetto;
    const a = v.adaptive;
    a.setEnabled(true);
    a.lastWindow = Infinity;
    const P = 1000 / 60;
    const win = (missed, cpu, gpu) => ({
      frames: 50,
      fps: 50,
      periodMs: P,
      refreshHz: 60,
      missed: Math.round(missed * 60),
      refreshes: 60,
      cpuMs: cpu,
      inputMs: 0,
      stepMs: 0,
      loopMs: 0,
      encodeMs: cpu,
      movesPerFrame: 0,
      gpuMs: gpu,
      gpuSource: 'timestamps',
      inputToSubmitMs: null,
      inputToReadyMs: null,
      verdict: missed > 0.05 ? 'GPU short' : 'within budget',
    });
    // Missing two refreshes in five with the GPU over budget; keeping up
    // with half the budget spare; missing as many with the CPU over it.
    window.__windows = { bad: win(0.4, 4, 25), good: win(0, 3, 5), cpuShort: win(0.4, 16, 5) };
    window.__clock ??= 1e6;
    window.__judge = (kind, n = 1) => {
      for (let i = 0; i < n; i++) {
        window.__clock += 1000;
        a.judge(window.__clock, window.__windows[kind]);
      }
      return { target: a.target, level: a.level };
    };
  });
/** The quality in force: the level, the knobs as set, and the anti-aliasing beside them. */
const quality = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const key = v.lighting.lights.key.shadow;
    return {
      level: v.adaptive.level,
      target: v.adaptive.target,
      text: v.adaptive.describe(),
      aoSamples: v.aoNode?.samples.value ?? null,
      aoScale: v.aoNode?.resolutionScale ?? null,
      blur: key.blurSamples,
      map: key.mapSize.x,
      ratio: v.renderer.getPixelRatio(),
      aa: `${v.getAntialias()}/${v.scenePass?.options.samples}`,
    };
  });

/** Frames the loop ran per second over `ms`, waking it every 40 ms if `working` (as input does). */
const loopRate = (page, ms, working) =>
  page.evaluate(
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

export const suites = {
  // The frame meter (P): it starts hidden, P shows it and the choice is
  // kept across a reload; it names the refresh it measured, splits the
  // CPU's time into the stroke, the loop and the encode, times the GPU
  // only while it is up, says which side is short, and reports what the
  // last stroke built and allocated (nothing).
  async meter(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    t.ok(!(await meterUp(page)), 'the meter starts hidden');
    t.ok(!(await page.evaluate(() => window.__bozzetto.gpuTiming)), 'and the GPU is not timed while it is');
    await page.keyboard.press('p');
    // The refresh needs about thirty frames, and the verdict a few more.
    await page
      .waitForFunction(
        () => {
          const text = document.querySelector('.fps-meter')?.textContent ?? '';
          return /refresh \d+ Hz/.test(text) && !/verdictmeasuring/.test(text);
        },
        null,
        { timeout: 60_000 },
      )
      .catch(() => {});
    let r = await meterRows(page);
    t.ok(await meterUp(page), 'P shows it');
    t.eq((await stored(page)).meter, 'on', 'and the choice is kept in this browser');
    t.ok(await page.evaluate(() => window.__bozzetto.gpuTiming), 'while it is up the GPU is timed');
    t.ok(/^\d+ · refresh \d+ Hz · missed \d+\/\d+$/.test(r.fps ?? ''), `the fps row names the refresh it measured: "${r.fps}"`);
    t.ok(/^CPU [\d.]+ · GPU (–|≈?[\d.]+) · budget [\d.]+ ms$/.test(r.frame ?? ''), `the frame row sets CPU and GPU against the budget: "${r.frame}"`);
    t.ok(!!r.verdict && r.verdict !== 'measuring', `and says which side is short: "${r.verdict}"`);
    t.ok(/^input [\d.]+ \(step [\d.]+\) · loop [\d.]+ · encode [\d.]+ ms$/.test(r.cpu ?? ''), `the CPU row splits the time: "${r.cpu}"`);
    const source = await page.evaluate(() => window.__bozzetto.gpuTimingSource());
    if (source === null) {
      t.eq(r['gpu time'], 'not available', 'with no way to time the GPU, it says so');
    } else {
      await page
        .waitForFunction(() => /ms/.test([...document.querySelectorAll('.fps-meter__row')].find((x) => x.children[0].textContent === 'gpu time')?.children[1].textContent ?? ''), null, { timeout: 30_000 })
        .catch(() => {});
      r = await meterRows(page);
      t.ok(/^≈? ?[\d.]+ ms/.test(r['gpu time'] ?? ''), `the GPU is timed (${source}): "${r['gpu time']}"`);
    }
    t.ok(/^\d+ · [\d.]+[kM]? tris$/.test(r.draws ?? ''), `draw calls and triangles: "${r.draws}"`);
    t.eq(r.frames, 'still', 'nothing moving, the frames are still ones');
    t.eq(r.builds, 'no stroke or drag yet', 'and no stroke has been bracketed yet');
    t.eq(
      await page.evaluate(() => window.__bozzetto.constructor.describeAdapter({ vendor: '', architecture: '', description: '' })),
      'not reported by this browser',
      'an adapter that reports nothing reads as the browser not reporting it',
    );
    t.eq(
      await page.evaluate(() => window.__bozzetto.constructor.describeAdapter({ vendor: 'nvidia', architecture: 'ampere' })),
      'nvidia · ampere',
      'one that does is named',
    );

    // A stroke, read while it is under way.
    await page.keyboard.press('3');
    await page.keyboard.press('f');
    await settle(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const during = await dev.penDrag(line([cx - 80, cy], [cx + 80, cy + 20], 6), async () => {
      await frames(page, 2);
      return meterRows(page);
    });
    t.ok(/^stroke/.test(during.frames ?? ''), `mid-stroke the frames row says so: "${during.frames}"`);
    const input = Number((during.cpu ?? '').match(/^input ([\d.]+)/)?.[1] ?? 0);
    t.ok(input > 0, `and the CPU row carries the stroke's own work: "${during.cpu}"`);
    t.ok(/^[\d.]+ per frame$/.test(during.moves ?? ''), `the moves handled per frame: "${during.moves}"`);
    t.ok(/^input to submit [\d.]+/.test(during.latency ?? ''), `and the input-to-frame time: "${during.latency}"`);
    await frames(page, 3);
    r = await meterRows(page);
    t.eq(r.builds, 'last stroke or drag: 0 builds · 0 allocations', 'after the stroke the meter reports what it built: nothing');

    // Kept across a reload, and P puts it away for good.
    await openForInput(page, base);
    t.ok(await meterUp(page), 'after a reload the meter is still up');
    await page.keyboard.press('p');
    t.ok(!(await meterUp(page)), 'P hides it');
    t.eq((await stored(page)).meter, undefined, 'and forgets it (off is the default, so nothing is stored)');
    t.ok(
      await page.evaluate(() => !window.__bozzetto.gpuTiming && !window.__bozzetto.renderer.backend.trackTimestamp),
      'hidden, the GPU is no longer timed and no pass writes timestamps',
    );
  },

  // Fast frames under a stroke: GTAO and its denoise are skipped and the
  // AO from the frame before pen-down stays, the fill and rim shadows
  // hold while the key's redraws, and from the frame before pen-down to
  // the frames after pen-up nothing is built, compiled or allocated.
  // Outside the stroke's reach the frame is the one before pen-down's to
  // the pixel; dropping the AO instead changes those same pixels.
  async fastStroke(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    // Plain frames throughout: the pixel checks below compare a frame from
    // before pen-down with one during the stroke, and a view left still
    // would otherwise have been smoothed in between (stillAA covers that).
    await openPrefsChoice(page, 'antialias', 'Off');
    await page.keyboard.press('3');
    await page.keyboard.press('f');
    t.eq(await aoModel(page, 'gtao'), 'gtao', 'GTAO picked in the Render panel');
    await page.evaluate(() => window.__bozzetto.setGround('floor'));
    await settle(page);
    await frames(page, 4);
    await stillAgain(page);
    await recordModes(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 70, cy + 30], [cx + 50, cy - 10], 5);
    const before = { c: await counters(page), p: await passes(page) };
    await snapshot(page, 'before');
    const mid = await dev.penDrag(path, async () => {
      const m = { mode: await frameMode(page), p: await passes(page) };
      await snapshot(page, 'during');
      m.p2 = await passes(page);
      return m;
    });
    await frames(page, 4);
    const after = { c: await counters(page), p: await passes(page), mode: await frameMode(page) };
    t.ok(
      mid.mode.kind === 'stroke' && mid.mode.ao === 'held' && mid.mode.shadows === 'hold' && mid.mode.fast,
      `mid-stroke the frame holds its AO and the fill and rim shadows (${show(mid.mode)})`,
    );
    t.eq(show(grew(before.c, after.c)), '{}', 'not one build, compile or allocation from the frame before pen-down to the frames after pen-up');
    const last = after.mode.lastInteraction;
    t.ok(!!last && Object.values(last).every((v) => v === 0), `and the meter's own bracket over the stroke says the same (${show(last)})`);
    t.ok(mid.p2.gtao === mid.p.gtao && mid.p2.denoise === mid.p.denoise, `mid-stroke the GTAO and denoise passes are skipped (${mid.p.gtao} then ${mid.p2.gtao})`);
    t.ok(mid.p2.shadows.key > mid.p.shadows.key, `while the key light's shadow redraws every frame (${mid.p.shadows.key} then ${mid.p2.shadows.key})`);
    t.ok(after.p.gtao > mid.p2.gtao && after.p.denoise > mid.p2.denoise, 'and once the pen lifts the AO is drawn again');
    const reach = await reachOf(page, path, 90);
    const held = await compareShots(page, 'before', 'during', reach);
    t.ok(held.max <= 2, `outside the stroke's reach, mid-stroke frames are the frame before pen-down's (max ${held.max}, mean ${held.mean.toFixed(4)}, ${held.changed} of ${held.n} pixels differ)`);

    // The comparison can see AO: dropped instead of held, the same view
    // changes where the occlusion was.
    await snapshot(page, 'full');
    await page.evaluate(() => {
      window.__bozzetto.debugInteraction = 'move';
    });
    await frames(page, 2);
    await snapshot(page, 'dropped');
    await page.evaluate(() => {
      window.__bozzetto.debugInteraction = undefined;
    });
    const dropped = await compareShots(page, 'full', 'dropped');
    t.ok(dropped.changed > 200 && dropped.max > 4, `whereas dropping the AO changes them (${dropped.changed} pixels, max ${dropped.max})`);
    t.ok((await modesSeen(page)).includes('stroke/held/hold'), `the frames went stroke/held/hold (${(await modesSeen(page)).join(', ')})`);

    // Full look: the same stroke draws every frame in full.
    await openPrefsChoice(page, 'interactionLook', 'Full look');
    t.eq((await stored(page)).interactionLook, 'full', 'Full look picked in Preferences, and kept');
    await stillAgain(page);
    const full = await dev.penDrag(line([cx - 40, cy - 40], [cx + 40, cy - 60], 5), async () => {
      const m = { mode: await frameMode(page), p: await passes(page) };
      await frames(page, 2);
      m.p2 = await passes(page);
      return m;
    });
    t.ok(!full.mode.fast && full.mode.ao === 'full' && full.mode.shadows === 'all', `with Full look a stroke draws full frames (${show(full.mode)})`);
    t.ok(full.p2.gtao > full.p.gtao, `GTAO included (${full.p.gtao} then ${full.p2.gtao})`);
  },

  // Fast frames while the view moves: a mouse orbit, a finger and the
  // wheel each count as moving; the AO is dropped and comes back, faded
  // in, once the view stops (after its coast); the fill and rim are
  // staggered; nothing is built or allocated. The viewer itself (?tl=)
  // keeps full frames.
  async fastMove(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    t.eq(await aoModel(page, 'gtao'), 'gtao', 'GTAO picked');
    await settle(page);
    await stillAgain(page);
    await recordModes(page);
    const before = await counters(page);
    const spot = (await emptySpot(page)) ?? [200, 400];
    await page.mouse.move(spot[0], spot[1]);
    await page.mouse.down();
    await page.mouse.move(spot[0] + 50, spot[1] + 8, { steps: 3 });
    await frames(page, 1);
    const mid = await frameMode(page);
    await page.mouse.move(spot[0] + 90, spot[1] + 14, { steps: 3 });
    await page.mouse.up();
    const c0 = await camera(page);
    await frames(page, 2);
    const c1 = await camera(page);
    t.ok(mid.kind === 'move' && mid.ao === 'off' && mid.aoDrop === 1 && mid.shadows === 'stagger', `orbiting, the AO is dropped and the fill and rim staggered (${show(mid)})`);
    t.ok(Math.hypot(...c0.position.map((p, i) => p - c1.position[i])) > 1e-6, 'let go, the view coasts on');
    await stillAgain(page);
    const end = await frameMode(page);
    t.ok(end.kind === null && end.ao === 'full' && end.aoDrop === 0, `stopped, the AO is back (${show(end)})`);
    t.eq(show(grew(before, await counters(page))), '{}', 'no build or allocation from the press to the end of the coast');
    const fade = await page.evaluate(() => window.__drops ?? []);
    t.ok(fade.every((d, i) => i === 0 || d <= fade[i - 1] + 1e-9), `and it fades back in, never up again (${fade.map((d) => d.toFixed(2)).join(' ')})`);

    // A finger, as fingers navigate.
    const finger = await dev.finger(line(spot, [spot[0] + 40, spot[1] + 5], 3), () => frameMode(page));
    t.ok(finger.kind === 'move' && finger.ao === 'off', `a finger orbiting counts as moving (${show(finger)})`);
    await settle(page);
    await stillAgain(page);

    // The wheel: no pointer held, the camera moves.
    await recordModes(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -240);
    await frames(page, 3);
    const seen = await modesSeen(page);
    t.ok(seen.some((m) => m.startsWith('move/off')), `a wheel zoom counts as moving the view (${seen.join(', ')})`);
    await settle(page);
    await stillAgain(page);

    // The viewer keeps full frames whatever moves.
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await frames(page, 3);
    const p0 = await passes(page);
    const vs = (await emptySpotViewer(page)) ?? [200, 300];
    await page.mouse.move(vs[0], vs[1]);
    await page.mouse.down();
    await page.mouse.move(vs[0] + 60, vs[1] + 5, { steps: 3 });
    await frames(page, 2);
    const viewerMode = await frameMode(page);
    const p1 = await passes(page);
    await page.mouse.up();
    t.ok(viewerMode.kind === 'move' && !viewerMode.fast && viewerMode.ao === 'full', `in the viewer an orbit keeps full frames (${show(viewerMode)})`);
    t.ok(p1.gtao > p0.gtao, `GTAO drawn while it turns (${p0.gtao} then ${p1.gtao})`);
  },

  // Armature mode: a pose drag (an IK ball) counts as moving, so the AO
  // (GTAO, Armature's default) is dropped while it goes and nothing is
  // built or allocated; the panel is rebuilt once when it ends, not on
  // every move.
  async fastArmature(page, base, t) {
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await page.evaluate(() => window.__bozzetto.haltOrbit());
    await frames(page, 3);
    await stillAgain(page);
    const ball = await page.evaluate(() => window.__armature.ballOnScreen('ik:hand.L'));
    t.ok(!!ball, `the left hand's ball is on screen (${show(ball)})`);
    const hand0 = await page.evaluate(() => window.__armature.handlePosition('hand.L'));
    await page.evaluate(() => {
      const panel = window.__armature.panel;
      const refresh = panel.refresh.bind(panel);
      window.__refreshes = 0;
      panel.refresh = (...a) => {
        window.__refreshes++;
        return refresh(...a);
      };
    });
    const before = await counters(page);
    await page.mouse.move(ball[0], ball[1]);
    await page.mouse.down();
    await page.mouse.move(ball[0] + 30, ball[1] - 25, { steps: 4 });
    await frames(page, 1);
    const mid = { mode: await frameMode(page), refreshes: await page.evaluate(() => window.__refreshes) };
    await page.mouse.move(ball[0] + 45, ball[1] - 35, { steps: 2 });
    await page.mouse.up();
    await frames(page, 4);
    const hand1 = await page.evaluate(() => window.__armature.handlePosition('hand.L'));
    t.ok(Math.hypot(...hand0.map((v, i) => v - hand1[i])) > 1e-3, 'the drag moved the hand');
    t.ok(mid.mode.kind === 'move' && mid.mode.ao === 'off' && mid.mode.fast, `mid-drag the AO is dropped (${show(mid.mode)})`);
    t.eq(mid.refreshes, 0, 'the panel is not rebuilt during the drag');
    t.eq(await page.evaluate(() => window.__refreshes), 1, 'and is rebuilt once when it ends');
    t.eq(show(grew(before, await counters(page))), '{}', 'no build or allocation from the press to the frames after the release');
  },

  // Anti-aliasing when still (Preferences > Performance), Sculpt and
  // Armature's default: the scene pass draws without MSAA, and a view left
  // still for a second is smoothed by sixteen jittered samples summed into
  // a target made up front, then held, the same image every frame. Input
  // over the view, a key, a panel's control, a Viewer setter, the lights,
  // the materials, the environment, a stroke and the camera moving each
  // send it back to the plain frame at once, and not one build, compile or
  // allocation comes of going still, smoothing, holding, moving again or a
  // stroke. Thumbnails are smooth in every mode; Always is the 4x MSAA
  // scene pass; the frame clock is the viewer's own; Armature smooths too
  // and the viewer keeps its MSAA.
  async stillAA(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    let a = await aaState(page);
    t.ok(a.mode === 'still' && a.samples === 0, `Sculpt anti-aliases a still view by default, its scene pass without MSAA (${show(a)})`);
    const clock = await page.evaluate(async () => {
      const v = window.__bozzetto;
      const f0 = v.clock.frameId();
      const n0 = v.frameNo;
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(ok))));
      return { owned: v.clock.owned, threeLoop: v.renderer._animation._requestId, frames: v.clock.frameId() - f0, renders: v.frameNo - n0 };
    });
    t.ok(
      clock.owned && clock.threeLoop === null && clock.frames > 0 && clock.frames === clock.renders,
      `the viewer owns the frame clock: three's own loop is stopped and every render is a frame (${show(clock)})`,
    );

    await page.keyboard.press('p');
    await settle(page);
    await stillAgain(page);
    await watchResets(page);
    const before = { c: await counters(page) };
    // The plain frame of this view, then the same view smoothed and held.
    await page.evaluate(() => window.__bozzetto.invalidate());
    await snapshot(page, 'plain');
    await page
      .waitForFunction(
        () => /^\d+\/16$/.test([...document.querySelectorAll('.fps-meter__row')].find((r) => r.children[0].textContent === 'AA')?.children[1].textContent ?? ''),
        null,
        { timeout: 60_000 },
      )
      .catch(() => {});
    const midway = (await meterRows(page)).AA;
    await heldAA(page);
    a = await aaState(page);
    t.eq(a.state, '16/16 held', 'left still, the view is smoothed over sixteen samples and held');
    t.ok(/^\d+\/16$/.test(midway ?? ''), `the meter shows the smoothing as it goes ("AA ${midway}")`);
    await frames(page, 2);
    t.eq((await meterRows(page)).AA, '16/16 held', 'and when it is done');
    await snapshot(page, 'smooth');
    const held0 = await aaState(page);
    await frames(page, 3);
    await snapshot(page, 'smooth2');
    const held1 = await aaState(page);
    t.ok(held1.renders === held0.renders && held1.sum === 'hold', `held, the sum is not drawn again (${held0.renders} draws, then ${held1.renders})`);
    const steady = await compareShots(page, 'smooth', 'smooth2');
    t.eq(steady.max, 0, `and the held image is the same every frame: no shimmer (${steady.changed} pixels differ)`);
    const edges = await compareShots(page, 'plain', 'smooth');
    t.ok(
      edges.changed > 50 && edges.max >= 16 && edges.mean < 1 && edges.changed < edges.n / 4,
      `smoothed, the edges differ from the plain frame's and little else does, the brightness kept (${edges.changed} of ${edges.n} pixels, max ${edges.max}, mean ${edges.mean.toFixed(4)})`,
    );

    // Again from the start, the same view comes to the same image.
    await page.evaluate(() => window.__bozzetto.invalidate());
    await heldAA(page);
    await snapshot(page, 'smooth3');
    const again = await compareShots(page, 'smooth', 'smooth3');
    t.ok(again.max <= 1, `smoothed again, the same view comes to the same image (max ${again.max}, ${again.changed} pixels differ)`);

    // Everything that changes the picture goes back to the plain frame.
    const spot = (await emptySpot(page)) ?? [200, 400];
    const triggers = [
      ['the pointer moving over the view', () => page.mouse.move(spot[0] + 3, spot[1] + 2)],
      ['a key', () => page.keyboard.press('F10')],
      ["a panel's control", () => page.evaluate(() => document.querySelector('.panel input[type="range"]').dispatchEvent(new Event('input', { bubbles: true })))],
      ['a Viewer setter (the cavity)', () => page.evaluate(() => window.__bozzetto.setSculptAO({ strength: window.__bozzetto.getSculptAO().strength }))],
      ['the lights (the shadow bias)', () => page.evaluate(() => window.__bozzetto.lighting.setBias(window.__bozzetto.lighting.getBias()))],
      ['the materials (the mask tint)', () => page.evaluate(() => window.__bozzetto.materials.setMaskDarken(window.__bozzetto.materials.getMaskDarken()))],
      ['the environment (its light)', () => page.evaluate(() => window.__bozzetto.environment.setIntensity(window.__bozzetto.environment.getState().intensity))],
      ['the camera moved by code', () => page.evaluate(() => window.__bozzetto.camera.position.multiplyScalar(1.001))],
      ['a Viewer camera call (orbit)', () => page.evaluate(() => window.__bozzetto.orbitAzimuth(2))],
    ];
    for (const [what, fn] of triggers) {
      const r = await resetBy(page, fn);
      t.ok(r.reset, `${what} sends the smoothing frame (${r.from}) back to the plain one`);
    }
    await settle(page);
    await stillAgain(page);
    // A stroke: plain while it goes.
    const [cx, cy] = await screenOf(page, 'Sphere');
    await smoothingAA(page);
    const n0 = await watchResets(page);
    const during = await dev.penDrag(line([cx - 40, cy + 10], [cx + 40, cy - 10], 5), () => aaState(page));
    t.ok((await watchResets(page)) > n0 && during.state.startsWith('plain') && during.sum === 'replace', `a stroke goes back to the plain frame and stays there while it lasts (${during.state})`);
    await heldAA(page);
    t.eq((await aaState(page)).state, '16/16 held', 'and the view smooths once it is over');
    const after = { c: await counters(page) };
    t.eq(
      show(grew(before.c, after.c)),
      '{}',
      'not one build, compile or allocation going still, smoothing, holding, moving again, or at pen-down or pen-up',
    );

    // Off: plain on screen, thumbnails smoothed anyway.
    await snapshot(page, 'smoothHere');
    await openPrefsChoice(page, 'antialias', 'Off');
    a = await aaState(page);
    t.ok(a.mode === 'off' && a.samples === 0 && a.state.startsWith('off'), `Off in Preferences: no smoothing on screen (${show(a)})`);
    t.eq((await stored(page)).antialias, 'off', 'and the choice is kept');
    await frames(page, 3);
    await snapshot(page, 'offPlain');
    await grabNextReadback(page, 'thumb');
    const thumb = await page.evaluate(async () => {
      const v = window.__bozzetto;
      const r0 = v.accumulate.renders;
      const blob = await v.captureThumbnail();
      return { draws: v.accumulate.renders - r0, bytes: blob.size, grabbed: !!window.__shots.thumb };
    });
    t.ok(thumb.grabbed && thumb.draws >= 16 && thumb.bytes > 1000, `a thumbnail is smoothed whatever the screen shows: ${thumb.draws} samples drawn for it (${thumb.bytes} bytes)`);
    const tsmooth = await compareShots(page, 'smoothHere', 'thumb');
    const tplain = await compareShots(page, 'offPlain', 'thumb');
    t.ok(
      tsmooth.max <= 1 && tplain.changed > 50 && tplain.mean < 1,
      `it reads the smoothed image (max ${tsmooth.max} from it) and not the plain one on screen (${tplain.changed} pixels differ, mean ${tplain.mean.toFixed(4)})`,
    );
    await frames(page, 3);
    await snapshot(page, 'offAfter');
    a = await aaState(page);
    const back = await compareShots(page, 'offPlain', 'offAfter');
    t.ok(a.sum === 'replace' && back.max === 0, `after it the screen is plain again (${a.state}, ${back.changed} pixels differ)`);

    // Always: the 4x MSAA scene pass on every frame.
    await openPrefsChoice(page, 'antialias', 'Always');
    a = await aaState(page);
    t.ok(a.mode === 'always' && a.samples === 4 && a.state === '4× MSAA', `Always: every frame through the 4x MSAA scene pass (${show(a)})`);
    await frames(page, 2);
    t.eq((await meterRows(page)).AA, '4× MSAA', 'as the meter says');
    await openPrefsChoice(page, 'antialias', 'When still');
    t.eq((await stored(page)).antialias, undefined, 'When still again, the default, nothing is stored');
    t.eq((await aaState(page)).samples, 0, 'and the scene pass is without MSAA again');

    // Armature smooths a still view too; the viewer keeps its MSAA.
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await page.evaluate(() => window.__bozzetto.haltOrbit());
    await heldAA(page);
    a = await aaState(page);
    t.ok(a.mode === 'still' && a.samples === 0 && a.state === '16/16 held', `Armature smooths a still view the same way (${show(a)})`);
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    a = await aaState(page);
    t.ok(a.mode === 'always' && a.samples === 4 && a.state === '4× MSAA', `the viewer keeps its 4x MSAA (${show(a)})`);
  },

  // Adaptive quality: windows that keep missing the display step the
  // frames down a level at a time, applied only with nothing under way and
  // the view still; where GTAO is not drawn its two steps are skipped; a
  // CPU-short window steps nothing (lighter GPU work would not help); eight
  // good windows step back up, and a level that fails again straight away
  // waits, longer each time, before it is tried again. Off in Preferences
  // it goes back to the tier. It never touches the anti-aliasing, and no
  // step rebuilds a shader.
  async adaptive(page, base, t) {
    await openForInput(page, base);
    t.ok(!(await page.evaluate(() => window.__bozzetto.adaptive.enabled)), 'the harness runs with adaptive quality held off (its software frames miss every refresh)');
    await adaptiveUnderTest(page);
    await settle(page);
    await stillAgain(page);
    const tier = await quality(page);
    t.ok(tier.level === 0 && tier.blur === 4 && tier.map === 1024 && tier.text === 'full quality', `on, at the low tier's own quality (${show(tier)})`);

    // Mid-stroke a step waits; with the stroke over it lands.
    await page.evaluate(() => {
      window.__bozzetto.debugInteraction = 'stroke';
    });
    let r = await page.evaluate(() => window.__judge('bad'));
    t.eq(r.target, 0, 'one window missing two refreshes in five asks for nothing yet');
    r = await page.evaluate(() => window.__judge('bad'));
    t.eq(r.target, 3, 'two in a row ask for a step down, past the AO\'s two (the cavity look draws no GTAO) to the shadows');
    await frames(page, 3);
    t.eq((await quality(page)).level, 0, 'mid-stroke nothing changes');
    const c0 = await counters(page);
    await page.evaluate(() => {
      window.__bozzetto.debugInteraction = undefined;
    });
    await frames(page, 3);
    let q = await quality(page);
    t.ok(q.level === 3 && q.blur === 2 && q.text === 'softer shadows', `the stroke over, the step lands: half the shadow blur samples (${show(q)})`);
    t.eq(show(grew(c0, await counters(page))), '{}', 'with nothing built or allocated');
    t.eq(q.aa, 'still/0', 'and the anti-aliasing as it was');

    r = await page.evaluate(() => window.__judge('cpuShort', 4));
    t.eq(r.target, 3, 'windows short of CPU step nothing down');
    const c1 = await counters(page);
    await page.evaluate(() => window.__judge('bad', 2));
    await frames(page, 3);
    q = await quality(page);
    t.ok(q.level === 4 && q.map === 512 && q.text === 'softer shadows · shadow maps ½', `two more and the shadow maps halve (${show(q)})`);
    const g1 = grew(c1, await counters(page));
    t.ok(!g1.nodeBuilds && !g1.programs && !g1.pipelines, `resized, not rebuilt (${show(g1)})`);
    r = await page.evaluate(() => window.__judge('bad', 4));
    t.eq(r.target, 4, 'and that is the bottom of the ladder here (no pixel ratio above 1 to lower)');

    r = await page.evaluate(() => window.__judge('good', 7));
    t.eq(r.target, 4, 'seven good windows are not yet enough to step up');
    r = await page.evaluate(() => window.__judge('good'));
    t.eq(r.target, 3, 'the eighth steps back up');
    await frames(page, 3);
    q = await quality(page);
    t.ok(q.level === 3 && q.map === 1024, `the maps back at full size (${show(q)})`);
    // Straight back down from there: that level waits before another try.
    r = await page.evaluate(() => window.__judge('bad', 2));
    t.eq(r.target, 4, 'failing again at once, it steps back down');
    r = await page.evaluate(() => window.__judge('good', 8));
    t.eq(r.target, 4, 'and eight good windows later it does not step up: the level just failed waits');
    r = await page.evaluate(() => window.__judge('good', 24));
    t.eq(r.target, 3, 'half a minute on, it is tried again');
    const wait = await page.evaluate(() => {
      window.__judge('bad', 2);
      const a = window.__bozzetto.adaptive;
      return a.heldUntil.get(3) - window.__clock;
    });
    t.eq(wait, 60_000, 'failing again, the wait doubles');

    // Off in Preferences: back to the tier at the next still moment.
    await openPrefs(page);
    await prefToggle(page, 'Adaptive quality');
    await page.keyboard.press('Escape');
    await frames(page, 3);
    q = await quality(page);
    t.ok(q.level === 0 && q.blur === 4 && q.map === 1024 && q.text === 'off', `off in Preferences, the tier's own quality comes back (${show(q)})`);
    t.eq((await stored(page)).adaptive, 'off', 'and the choice is kept');
    await openPrefs(page);
    await prefToggle(page, 'Adaptive quality');
    await page.keyboard.press('Escape');
    t.eq((await stored(page)).adaptive, undefined, 'on again, the default, nothing is stored');

    // GTAO drawn: its two steps come first.
    await aoModel(page, 'gtao');
    await adaptiveUnderTest(page);
    await frames(page, 3);
    const ao = await quality(page);
    await page.evaluate(() => window.__judge('bad', 2));
    await frames(page, 3);
    q = await quality(page);
    t.ok(q.level === 1 && q.aoSamples === ao.aoSamples / 2 && q.text === 'AO samples ½', `with GTAO the first step halves its samples (${ao.aoSamples} to ${q.aoSamples})`);
    await page.evaluate(() => window.__judge('bad', 2));
    await frames(page, 3);
    q = await quality(page);
    t.ok(q.level === 2 && q.aoScale === ao.aoScale / 2 && q.text === 'AO samples ½ · AO ½ res', `and the next its resolution (${ao.aoScale} to ${q.aoScale})`);

    // A denser screen: the pixel ratio steps down a quarter at a time.
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    try {
      const p2 = await ctx.newPage();
      await openForInput(p2, base);
      await adaptiveUnderTest(p2);
      await p2.evaluate(() => window.__judge('bad', 4));
      await frames(p2, 3);
      q = await quality(p2);
      const size = await p2.evaluate(() => [window.__bozzetto.captureCanvas.width, window.__bozzetto.captureCanvas.clientWidth]);
      t.ok(q.level === 4 && q.ratio === 1.75 && size[0] === Math.floor(size[1] * 1.75), `at a pixel ratio of 2, the step after the shadows draws at 1.75 (${show(q)}, canvas ${size[0]} for ${size[1]} px)`);
      t.eq(q.aa, 'still/0', 'the anti-aliasing untouched');
      await p2.evaluate(() => window.__bozzetto.adaptive.setEnabled(false));
      await frames(p2, 3);
      t.eq((await quality(p2)).ratio, 2, 'and off, back to 2');
    } finally {
      await ctx.close();
    }
  },

  // The desktop app's frame pacing, as the viewer runs it (desktop.mjs
  // runs it in the app): a browser is never paced. With v-sync off the
  // loop runs free while anything happens and paces itself to the display
  // a second after everything stops; input wakes it at once; on battery it
  // stays paced while working too. The meter says which. Nothing is drawn
  // here (the test hook), so the rates are the loop's own.
  async pacing(page, base, t) {
    await openForInput(page, base);
    const state = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        return { pacing: v.getPacing(), paced: v.isPaced(), timer: v.pacer !== 0 };
      });
    let s = await state();
    t.ok(!s.pacing.uncapped && !s.paced, `in a browser the loop is never paced: the browser holds each frame for the display (${show(s.pacing)})`);
    await page.keyboard.press('p');
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.debugSkipRender = true;
      v.setPacing({ uncapped: true, displayHz: 20, onBattery: false });
    });
    // A second first for the software renderer's backlog of frames to drain.
    await loopRate(page, 1000, true);
    const free = await loopRate(page, 1500, true);
    s = await state();
    t.ok(!s.paced, 'v-sync off and working, the loop is not paced');
    await page.waitForFunction(() => window.__bozzetto.isPaced(), null, { timeout: 10_000 }).catch(() => {});
    const idle = await loopRate(page, 1500, false);
    t.ok(idle <= 22 && free >= idle * 1.8, `a second after everything stops it paces itself to the display: ${idle} frames a second at 20 Hz, against ${free} working`);
    let rows = await meterRows(page);
    t.eq(rows.pacing, 'v-sync off · paced to 20 Hz (idle)', 'the meter says it is paced, and why');
    t.ok(/refresh 20 Hz \(display\)/.test(rows.fps ?? ''), `and measures against the display's own rate (${rows.fps})`);

    // Input wakes it at once, not on its timer (200 ms at 5 Hz).
    await page.evaluate(() => window.__bozzetto.setPacing({ displayHz: 5 }));
    await page.waitForFunction(() => window.__bozzetto.isPaced() && window.__bozzetto.pacer !== 0, null, { timeout: 10_000 }).catch(() => {});
    const woke = await page.evaluate(
      () =>
        new Promise((ok) => {
          const v = window.__bozzetto;
          const f0 = v.frameNo;
          const t0 = performance.now();
          const canvas = v.captureCanvas;
          const r = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 20, clientY: r.top + 20, bubbles: true }));
          const unpaced = !v.isPaced();
          const check = () => (v.frameNo > f0 ? ok({ ms: Math.round(performance.now() - t0), unpaced }) : setTimeout(check, 1));
          check();
        }),
    );
    t.ok(woke.unpaced && woke.ms < 120, `input wakes it at once: the next frame ${woke.ms} ms after a pointer move, not on its 200 ms timer`);

    // On battery: paced while working too.
    await page.evaluate(() => window.__bozzetto.setPacing({ displayHz: 20, onBattery: true }));
    const battery = await loopRate(page, 1500, true);
    s = await state();
    t.ok(s.paced && battery <= 22, `on battery it stays paced while working: ${battery} frames a second at 20 Hz`);
    await frames(page, 2);
    rows = await meterRows(page);
    t.eq(rows.pacing, 'v-sync off · paced to 20 Hz (battery)', 'as the meter says');
    await page.evaluate(() => window.__bozzetto.setPacing({ onBattery: false }));
    const mains = await loopRate(page, 1500, true);
    t.ok(mains >= battery * 1.8, `back on mains it runs free again (${mains} frames a second)`);
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.setPacing({ uncapped: false, displayHz: 0, onBattery: false });
      v.debugSkipRender = false;
    });
    s = await state();
    t.ok(!s.paced && !s.timer, 'v-sync on again (as a browser is), nothing paces');
  },

  // The damping, scaled by the time a frame takes: any frame rate covers
  // the same ground in the same time as 60 Hz always did; a held drag
  // follows closely (30% a 60 Hz frame, 8% before); and letting go owes
  // the view the coast the old damping left owed at that speed.
  async damping(page, base, t) {
    await openForInput(page, base);
    await settle(page);
    const r = await page.evaluate(() => {
      const c = window.__bozzetto.controls;
      const oc = c.controls;
      const home = { p: oc.object.position.clone(), t: oc.target.clone() };
      const reset = () => {
        c.halt();
        oc.state = -1;
        oc.object.position.copy(home.p);
        oc.target.copy(home.t);
        oc.update();
      };
      const run = (hz, seconds, held) => {
        reset();
        oc.state = held ? 0 : -1;
        const a0 = oc.getAzimuthalAngle();
        oc._sphericalDelta.theta = 0.3;
        for (let i = 0; i < Math.round(hz * seconds); i++) c.update(1 / hz);
        const moved = oc.getAzimuthalAngle() - a0;
        reset();
        return moved;
      };
      const out = {
        first60: run(60, 1 / 60, false),
        coast30: run(30, 0.5, false),
        coast60: run(60, 0.5, false),
        coast144: run(144, 0.5, false),
        held60: run(60, 1 / 60, true),
        held30: run(30, 1 / 30, true),
      };
      // A steady drag, held, then let go: what the view is owed to coast.
      reset();
      oc.state = 0;
      for (let i = 0; i < 30; i++) {
        oc._sphericalDelta.theta += 0.01;
        c.update(1 / 60);
      }
      oc.state = -1;
      c.update(1 / 60);
      out.owed = oc._sphericalDelta.theta;
      reset();
      return out;
    });
    t.near(r.first60 / 0.3, 0.08, 1e-6, 'at 60 Hz a coasting frame applies 8% of what is owed, as before');
    t.near(r.coast30 / 0.3, 1 - 0.92 ** 30, 1e-6, 'half a second of coast at 30 Hz covers what 60 Hz does');
    t.near(r.coast60 / 0.3, 1 - 0.92 ** 30, 1e-6, 'at 60 Hz');
    t.near(r.coast144 / 0.3, 1 - 0.92 ** 30, 1e-6, 'and at 144 Hz');
    t.near(r.held60 / 0.3, 0.3, 1e-6, 'held, a 60 Hz frame applies 30%');
    t.near(r.held30 / 0.3, 1 - 0.7 ** 2, 1e-6, 'and a 30 Hz frame what two of those do');
    // The old damping, at 0.01 a frame, left 0.01 x 0.92 / 0.08 owed, of
    // which the release frame applies 8%.
    t.near(r.owed, 0.01 * (0.92 / 0.08) * 0.92, 0.004, `let go, the view is owed the coast it always had (${r.owed.toFixed(4)})`);
  },

  // Preferences: Appearance (Panel opacity, a slider from 60 to 100% that
  // the panels follow while it is dragged, nothing behind any of them
  // blurred at any setting), Performance (how frames are drawn while things
  // move) and Diagnostics (the meter, the stall log and the input log):
  // each live and kept across reloads, the overlays up in every mode, and
  // the URL parameters still forcing theirs on.
  async diagnostics(page, base, t) {
    await openSculpt(page, base, '&q=low');
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    // The twenty surfaces that blurred the view behind them, those on screen.
    const surfaces = () =>
      page.evaluate(() => {
        const all = [
          '.panel', '.panel__handle', '.mcpick__pop', '.transport', '.transport__buffering', '.theme-toggle',
          '.help-hint', '.help-guide', '.fps-meter', '.env-loading', '.editor__sidebar', '.editor__sidebar-handle',
          '.sculpt-toolbar__group', '.outliner__menu', '.update-notice', '.topchip', '.file-menu', '.cpick__pop',
          '.install-overlay', '.float-window',
        ];
        const els = all.flatMap((sel) => [...document.querySelectorAll(sel)]);
        return {
          present: els.length,
          blurred: els.filter((el) => getComputedStyle(el).backdropFilter !== 'none').map((el) => el.className),
          panel: getComputedStyle(document.querySelector('.panel')).backgroundColor,
          chip: getComputedStyle(document.querySelector('.topchip')).backgroundColor,
        };
      });
    let look = await surfaces();
    t.ok(look.present >= 4 && look.blurred.length === 0, `no panel blurs the view behind it (${look.present} on screen; blurred: ${look.blurred.join(', ') || 'none'})`);
    t.ok(/, 0\.95\)$/.test(look.panel) && look.chip === look.panel, `every panel starts 95% opaque, from one property (${look.panel}, ${look.chip})`);

    await openPrefs(page);
    const layout = await page.evaluate(() => {
      const slider = document.querySelector('[data-setting="panelOpacity"] input');
      return {
        groups: [...document.querySelectorAll('.prefs__group')].map((g) => g.textContent),
        slider: `${slider.min} to ${slider.max}, at ${slider.value} (${document.querySelector('[data-setting="panelOpacity"] .prefs__slider-value').textContent})`,
        question: document.querySelector('.prefs__question')?.textContent ?? null,
        looks: [...document.querySelectorAll('[data-setting="interactionLook"] .prefs__choice')].map(
          (c) => `${c.querySelector('.prefs__choice-title').textContent}${c.querySelector('input').checked ? ' (on)' : ''}`,
        ),
        toggles: [...document.querySelectorAll('.prefs__toggle')].map(
          (c) => `${c.querySelector('.prefs__choice-title').textContent}${c.querySelector('input').checked ? ' (on)' : ''}`,
        ),
        desktop: !!document.querySelector('.prefs__desktop'),
      };
    });
    t.ok(
      ['Touch (Sculpt)', 'Appearance', 'Performance', 'Diagnostics', 'Hotkeys'].every((g) => layout.groups.includes(g)),
      `Preferences has Touch, Appearance, Performance, Diagnostics and Hotkeys (${layout.groups.join(', ')})`,
    );
    t.eq(layout.slider, '60 to 100, at 95 (95%)', 'Panel opacity runs 60 to 100%, at 95%');
    t.eq(layout.question, 'While sculpting, posing or moving the view', 'the frames choice says when it applies');
    t.eq(layout.looks.join(', '), 'Fast frames (on), Full look', 'Fast frames by default, or Full look');
    t.eq(layout.toggles.join(', '), 'Adaptive quality (on), Frame meter, Stall log, Input log', 'Adaptive quality on, and the three diagnostic boxes off');
    t.eq(layout.desktop, false, 'and no Desktop group: that is the desktop app\'s alone');

    // Dragged, the panels follow each value as the slider passes it.
    const dragged = await page.evaluate(() => {
      const input = document.querySelector('[data-setting="panelOpacity"] input');
      const seen = [];
      for (const v of [90, 75, 60]) {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        seen.push(getComputedStyle(document.querySelector('.panel')).backgroundColor);
      }
      return { seen, readout: document.querySelector('[data-setting="panelOpacity"] .prefs__slider-value').textContent };
    });
    t.ok(
      ['0.9', '0.75', '0.6'].every((a, i) => dragged.seen[i].endsWith(`, ${a})`)) && dragged.readout === '60%',
      `while it is dragged the panels follow it (${dragged.seen.join(' then ')}; reads ${dragged.readout})`,
    );
    t.eq((await stored(page)).panelOpacity, 60, 'and the value is kept');
    await page.evaluate(() => {
      const input = document.querySelector('[data-setting="panelOpacity"] input');
      input.value = '100';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    look = await surfaces();
    t.ok(/^rgb\(\d+, \d+, \d+\)$/.test(look.panel) && look.blurred.length === 0, `at 100% the panels are solid (${look.panel})`);

    for (const name of ['Frame meter', 'Stall log', 'Input log']) await prefToggle(page, name);
    await page.keyboard.press('Escape');
    const shown = () =>
      page.evaluate(() => ({
        stall: !!document.querySelector('.perf-debug'),
        input: !!document.querySelector('.input-debug'),
        meter: !!document.querySelector('.fps-meter') && !document.querySelector('.fps-meter').hidden,
        bg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
      }));
    let s = await shown();
    t.ok(s.stall && s.input && s.meter, `ticked, the stall log, the input log and the meter come up at once (${show(s)})`);
    t.eq(show(await stored(page)), '{"panelOpacity":100,"meter":"on","stallLog":"on","inputLog":"on"}', 'all of it kept in this browser');

    await openSculpt(page, base, '&q=low');
    s = await shown();
    t.ok(s.stall && s.input && s.meter && /^rgb\(/.test(s.bg), `after a reload it all still holds, the panels solid (${show(s)})`);
    const boxes = await page.evaluate(() => {
      const rect = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      };
      return [rect('.perf-debug'), rect('.input-debug'), rect('.fps-meter')];
    });
    const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
    t.ok(apart(boxes[0], boxes[1]) && apart(boxes[0], boxes[2]) && apart(boxes[1], boxes[2]), `the three overlays sit apart (${show(boxes)})`);

    // Every mode: Armature, and the viewer.
    await openArmature(page, base);
    s = await shown();
    t.ok(s.stall && s.meter && !s.input && /^rgb\(/.test(s.bg), `in Armature mode the stall log and the meter are up and the panels solid too (no input log: it is Sculpt's) (${show(s)})`);
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    s = await page.evaluate(() => ({ stall: !!document.querySelector('.perf-debug'), meter: !document.querySelector('.fps-meter')?.hidden }));
    t.ok(s.stall && s.meter, `and over the viewer (${show(s)})`);

    // Back to the defaults, everything goes; the URL parameters still force theirs on.
    await openSculpt(page, base, '&q=low');
    await openPrefs(page);
    await page.evaluate(() => {
      const input = document.querySelector('[data-setting="panelOpacity"] input');
      input.value = '95';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const name of ['Frame meter', 'Stall log', 'Input log']) await prefToggle(page, name);
    await page.keyboard.press('Escape');
    s = await shown();
    t.ok(!s.stall && !s.input && !s.meter && /, 0\.95\)$/.test(s.bg), `unticked they all go, and the panels are back at 95% (${show(s)})`);
    t.eq(show(await stored(page)), '{}', 'with nothing stored');
    await openSculpt(page, base, '&q=low&perfdebug=1&inputdebug=1');
    s = await shown();
    t.ok(s.stall && s.input && !s.meter, `?perfdebug=1&inputdebug=1 still put their overlays up, the settings off (${show(s)})`);
  },

  // The numbers behind the latency work, printed with each run: the
  // stroke step and the stroke end at the default sphere's three levels
  // (49k, 196k and 786k triangles), the autosave at the largest, the
  // encode time of full and fast frames, and the same still frame with
  // the canvas's own MSAA and without it. The harness renders in software,
  // so these are CPU-side measures; the checks are only sanity bounds.
  async latencyNumbers(page, base, t) {
    await openForInput(page, base);
    await page.keyboard.press('3');
    for (let level = 0; level < 3; level++) {
      if (level) {
        await page.evaluate(() => window.__sculpt.session.subdivide());
        await settle(page);
      }
      await page.keyboard.press('f');
      await settle(page);
      await timedStroke(page); // the first one warms the JIT up
      await settle(page);
      const r = await timedStroke(page);
      t.ok(
        r.started && r.steps >= 10 && r.median > 0,
        `measure: stroke step at ${r.tris} triangles: median ${fmt(r.median)} ms, p90 ${fmt(r.p90)}, slowest ${fmt(r.max)} (${r.steps} steps); stroke end ${fmt(r.end)} ms${r.started ? '' : ' (the press missed the object)'}`,
      );
    }
    const save = await page.evaluate(async () => {
      const { persist } = window.__sculpt;
      // The stroke's own autosave may be under way (the first change after
      // a quiet spell is saved five seconds on): let it land first, or the
      // flush below finds a write in flight and has nothing to time.
      await persist.settle();
      window.__bozzettoPerf.clear();
      persist.markDirty();
      await persist.flush();
      return window.__bozzettoPerf
        .recent()
        .filter((e) => e.what.startsWith('autosave'))
        .map((e) => `${e.what} ${e.ms.toFixed(0)} ms${e.note ? ` (${e.note})` : ''}`);
    });
    t.ok(save.length > 0, `measure: the autosave at that size: ${save.join(', ')}`);

    // Encode, full and fast: GTAO, the floor, key and fill casting.
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const p2 = await ctx.newPage();
      await openSculpt(p2, base, '&q=medium');
      await p2.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
      await aoModel(p2, 'gtao');
      await p2.evaluate(() => {
        const v = window.__bozzetto;
        v.setGround('floor');
        v.lighting.setEnabled('fill', true);
        v.lighting.setShadow('fill', true);
      });
      await frames(p2, 4);
      const out = {};
      // Only frames drawn in each mode count: a frame here can take
      // seconds, so a fixed wait would average in the mode before.
      const FRAMES = 5;
      for (const kind of [null, 'stroke', 'move']) {
        const from = await p2.evaluate((k) => {
          window.__bozzetto.debugInteraction = k;
          return window.__bozzetto.frameNo;
        }, kind);
        await p2.waitForFunction(([f, n]) => window.__bozzetto.frameNo >= f + n + 1, [from, FRAMES], { timeout: 120_000 }).catch(() => {});
        out[kind ?? 'full'] = await recentFrames(p2, FRAMES);
      }
      await p2.evaluate(() => {
        window.__bozzetto.debugInteraction = undefined;
      });
      t.ok(
        out.full.frames > 2 && out.move.encode < out.full.encode,
        `measure: encode ${fmt(out.full.encode)} ms full, ${fmt(out.stroke.encode)} ms under a stroke, ${fmt(out.move.encode)} ms moving (loop ${fmt(out.full.loop)} / ${fmt(out.stroke.loop)} / ${fmt(out.move.loop)} ms; medium tier, GTAO, floor, key and fill casting; ${out.full.frames}, ${out.stroke.frames}, ${out.move.frames} frames)`,
      );
    } finally {
      await ctx.close();
    }

    // The canvas MSAA: the same still frame built the old way
    // (?canvasmsaa=1) and the new, on the cavity and on GTAO with a floor.
    // The denoise's noise is drawn from Math.random at every load, which
    // alone moves a few thousand AO pixels by a few levels between two
    // loads of the same build; both pages get the same seeded generator,
    // so what is left is the change.
    for (const look of ['cavity', 'gtao']) {
      const shots = [];
      for (const query of ['&canvasmsaa=1', '']) {
        const c = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
        await c.addInitScript(() => {
          let seed = 20261005;
          Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
          // MSAA in the scene pass in both builds: this compares the canvas's own.
          localStorage.setItem('bozzetto-settings', JSON.stringify({ antialias: 'always' }));
        });
        try {
          const p = await c.newPage();
          await openSculpt(p, base, `&q=low${query}`);
          await p.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
          if (look === 'gtao') {
            await aoModel(p, 'gtao');
            await p.evaluate(() => window.__bozzetto.setGround('floor'));
          }
          await settle(p);
          await stillAgain(p);
          await frames(p, 3);
          await snapshot(p, 'x');
          shots.push(
            await p.evaluate(() => {
              const A = window.__shots.x;
              let s = '';
              for (let i = 0; i < A.length; i += 0x8000) s += String.fromCharCode.apply(null, A.subarray(i, i + 0x8000));
              return btoa(s);
            }),
          );
          if (shots.length === 2) {
            await p.evaluate((b64) => {
              const bin = atob(b64);
              const u = new Uint8ClampedArray(bin.length);
              for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
              window.__shots.old = u;
            }, shots[0]);
            const d = await compareShots(p, 'old', 'x');
            t.ok(d.max <= 2, `measure: canvas MSAA on (old) against off (new), ${look}: max difference ${d.max}, mean ${d.mean.toFixed(4)}, ${d.changed} of ${d.n} pixels differ`);
          }
        } finally {
          await c.close();
        }
      }
    }

    // Anti-aliasing when still against 4x MSAA: what a frame costs the CPU
    // plain (no MSAA), held once smoothed (the sum's average only, nothing
    // else drawn) and through the MSAA scene pass; and the same still view
    // smoothed against the MSAA one, GTAO and a floor in it.
    const c = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => {
      let seed = 20261005;
      Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    });
    try {
      const p = await c.newPage();
      await openSculpt(p, base, '&q=low');
      await p.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
      await aoModel(p, 'gtao');
      await p.evaluate(() => window.__bozzetto.setGround('floor'));
      await settle(p);
      await stillAgain(p);
      const FRAMES = 5;
      const costOf = async (mode) => {
        const from = await p.evaluate((m) => {
          window.__bozzetto.setAntialias(m);
          return window.__bozzetto.frameNo;
        }, mode);
        if (mode === 'still') {
          await heldAA(p);
          const at = await p.evaluate(() => window.__bozzetto.frameNo);
          await p.waitForFunction((f) => window.__bozzetto.frameNo >= f, at + FRAMES + 1, { timeout: 60_000 }).catch(() => {});
        } else {
          await p.waitForFunction((f) => window.__bozzetto.frameNo >= f, from + FRAMES + 2, { timeout: 120_000 }).catch(() => {});
        }
        return recentFrames(p, FRAMES);
      };
      const plain = await costOf('off');
      const held = await costOf('still');
      await snapshot(p, 'still');
      const msaa = await costOf('always');
      await snapshot(p, 'msaa');
      t.ok(
        held.frames > 2 && held.encode < plain.encode,
        `measure: a frame's encode ${fmt(plain.encode)} ms plain, ${fmt(held.encode)} ms held once smoothed, ${fmt(msaa.encode)} ms through 4x MSAA (GTAO, floor; ${plain.frames}, ${held.frames}, ${msaa.frames} frames)`,
      );
      const d = await compareShots(p, 'still', 'msaa');
      t.ok(d.mean < 2, `measure: the still view smoothed against 4x MSAA: max difference ${d.max}, mean ${d.mean.toFixed(4)}, ${d.changed} of ${d.n} pixels differ`);
      const thumb = await p.evaluate(async () => {
        const v = window.__bozzetto;
        v.setAntialias('still');
        v.invalidate();
        window.__bozzettoPerf.clear();
        await v.captureThumbnail();
        return window.__bozzettoPerf.recent().filter((e) => e.what === 'thumbnail').map((e) => `${e.ms.toFixed(0)} ms (${e.note})`);
      });
      t.ok(thumb.length === 1, `measure: a smooth thumbnail from a plain frame, sixteen renders in software: ${thumb.join(', ')}`);
    } finally {
      await c.close();
    }
  },
};
