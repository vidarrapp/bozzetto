// A WebGPU that never answers (owner-approved fix, 2026-11-02): in a fresh
// headless context on a software-rendered machine, Chromium's
// navigator.gpu.requestAdapter was seen never to settle, and three's
// WebGPURenderer.init() waited on it forever, so the page sat on its boot
// overlay. The viewer now gives WebGPU WEBGPU_INIT_TIMEOUT_MS (10 s) and
// boots on WebGL 2 after it.
//
// webgpuHang:
// - with requestAdapter made to never settle, Armature mode still boots,
//   on the WebGL2 backend, no sooner than the limit and well within it
//   plus a margin;
// - the console says WebGPU did not answer in 10 s and the viewer fell
//   back to WebGL 2, once; the adapter was asked for once;
// - the frame meter's rows say why (no answer) and still name the GPU.
const LIMIT_S = 10;

export const suites = {
  async webgpuHang(page, base, t) {
    await page.addInitScript(() => {
      const w = window;
      w.__gpuAsks = 0;
      const never = () => {
        w.__gpuAsks++;
        return new Promise(() => {});
      };
      if (navigator.gpu) {
        navigator.gpu.requestAdapter = never;
      } else {
        Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => ({ requestAdapter: never, getPreferredCanvasFormat: () => 'bgra8unorm' }) });
      }
    });
    const warnings = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    const t0 = Date.now();
    await page.goto(`${base}/?armature=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto || !!document.querySelector('.overlay--error'), null, { timeout: (LIMIT_S + 60) * 1000 }).catch(() => {});
    const viewerAfter = (Date.now() - t0) / 1000;
    await page.waitForFunction(() => !!window.__armature || !!document.querySelector('.overlay--error'), null, { timeout: 90_000 }).catch(() => {});
    const state = await page.evaluate(() => {
      const v = window.__bozzetto;
      const be = v?.renderer?.backend;
      return {
        armature: !!window.__armature,
        overlay: document.querySelector('#overlay .overlay__msg')?.textContent ?? null,
        backend: be ? (be.isWebGPUBackend ? 'WebGPU' : be.isWebGLBackend ? 'WebGL2' : 'other') : null,
        engines: [...document.querySelectorAll('canvas[data-engine]')].map((c) => (c === v?.renderer?.domElement ? 'viewer' : 'other')),
        asks: window.__gpuAsks,
        rows: v ? Object.fromEntries(v.debugInfo()) : null,
      };
    });
    t.ok(state.armature && state.backend === 'WebGL2', `with WebGPU never answering, Armature mode boots on WebGL 2 (${JSON.stringify({ armature: state.armature, backend: state.backend, overlay: state.overlay })})`);
    t.ok(viewerAfter >= LIMIT_S - 0.5 && viewerAfter <= LIMIT_S + 60, `the viewer came after the ${LIMIT_S} s limit and well within a minute of it (${viewerAfter.toFixed(1)} s)`);
    t.eq(state.engines.join(','), 'viewer', 'the page holds one three.js canvas, the viewer\'s: the abandoned renderer attached nothing');
    t.eq(state.asks, 1, 'the adapter was asked for once (the WebGL 2 renderer does not ask)');
    const said = warnings.filter((w) => /WebGPU did not answer/.test(w));
    t.ok(said.length === 1 && said[0].includes(`in ${LIMIT_S} s`) && /fell back to WebGL 2/.test(said[0]), `the console says so, once (${JSON.stringify(said)})`);
    t.ok(/no answer in 10 s/.test(state.rows?.webgpu ?? '') && !!state.rows?.gpu && state.rows.gpu !== '?', `the frame meter says why and still names the GPU (${JSON.stringify({ webgpu: state.rows?.webgpu, gpu: state.rows?.gpu, backend: state.rows?.backend })})`);
  },
};
