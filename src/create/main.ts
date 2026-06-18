import { frameFromFile, runPool } from '../admin/convert';
import { Viewer } from '../viewer/Viewer';
import { MemorySource } from '../viewer/AssetSource';
import { Panel } from '../ui/Panel';
import { EditorLayout } from '../ui/editorLayout';
import { FpsMeter } from '../ui/FpsMeter';
import { installShortcuts } from '../ui/shortcuts';
import { initTheme, mountThemeToggle } from '../ui/theme';
import { validateManifest, type Manifest } from '../types/manifest';
import { buildExportManifest, buildExportHtml, downloadBlob } from '../export/exportClient';

/**
 * Public, backend-free editor (`/create`). Drop a sculpt sequence, set up the
 * look in the real viewer, and download one self-contained .html. Frames are
 * converted in the browser and kept in memory (a MemorySource feeds the live
 * preview); nothing is uploaded, saved, or gated. The only output is the file.
 */

interface Stage {
  name: string;
  frame: number;
  desc: string;
}

interface FrameMeta {
  tris: number;
  bytes: number;
}

const naturalSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const framePath = (i: number): string => `frames/sd/${String(i).padStart(4, '0')}.glb`;

/** Button feedback for the export action: disable, flash done, alert on error. */
async function runAction(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  btn.dataset.idle ??= btn.textContent ?? '';
  const idle = btn.dataset.idle;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    await fn();
    btn.textContent = 'Exported ✓';
    window.clearTimeout(Number(btn.dataset.timer));
    btn.dataset.timer = String(window.setTimeout(() => (btn.textContent = idle), 1800));
  } catch (err) {
    btn.textContent = idle;
    alert(`Export failed: ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

function main(): void {
  initTheme();
  mountThemeToggle();

  const host = document.getElementById('create');
  if (!host) throw new Error('#create element not found');

  host.innerHTML = `
    <div class="editor">
      <div id="preview" class="editor__preview"></div>
      <a class="editor__home" href="/">← Gallery</a>

      <aside class="editor__sidebar">
        <button class="editor__sidebar-handle" type="button" title="Hide / show (Tab)">‹</button>
        <div class="editor__sidebar-body">
          <h1 class="editor__title">Create</h1>
          <p class="editor__id muted">Build a timelapse and export it as one self-contained file. Nothing is uploaded.</p>

          <section class="editor__section">
            <h3>Project</h3>
            <div class="editor__settings">
              <label>Title <input id="f-title" type="text" placeholder="My sculpt" /></label>
              <label>Mode
                <select id="f-mode">
                  <option value="timelapse">Timelapse</option>
                  <option value="model">Model</option>
                </select>
              </label>
              <label>FPS <input id="f-fps" type="number" min="1" max="30" step="1" value="4" /></label>
            </div>
          </section>

          <section class="editor__section">
            <h3>Frames <span id="frame-count" class="muted">· none yet</span></h3>
            <div id="drop" class="dropzone">
              <p>Drop a sequence of <strong>.obj</strong> or <strong>.glb</strong> files, or pick them:</p>
              <input id="files" type="file" accept=".obj,.glb" multiple />
              <label class="checkbox dropzone__zup"><input id="zup" type="checkbox" /> OBJ files are Z-up</label>
            </div>
            <div id="progress" class="progress" hidden>
              <div class="progress__track"><div class="progress__bar" id="bar"></div></div>
              <span id="progress-label" class="muted"></span>
            </div>
            <p id="mem-warn" class="editor__hint editor__warn" hidden></p>
          </section>

          <section class="editor__section">
            <h3>Stages</h3>
            <div id="stages"></div>
            <button id="add-stage" class="btn" type="button">Add stage</button>
          </section>

          <section class="editor__section">
            <h3>Export</h3>
            <p class="muted editor__hint">Set up the look in the right-hand panel, then download a self-contained <strong>.html</strong> that opens offline, straight from disk.</p>
            <button id="export-html" class="btn btn--primary" type="button" disabled>Export .html</button>
          </section>
        </div>
      </aside>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  const sidebarEl = $('.editor__sidebar');
  const sidebarHandle = $<HTMLButtonElement>('.editor__sidebar-handle');
  const previewBox = $('#preview');
  const titleInput = $<HTMLInputElement>('#f-title');
  const modeSelect = $<HTMLSelectElement>('#f-mode');
  const fpsInput = $<HTMLInputElement>('#f-fps');
  const frameCountEl = $('#frame-count');
  const progress = $('#progress');
  const bar = $('#bar');
  const progressLabel = $('#progress-label');
  const memWarn = $('#mem-warn');
  const zup = $<HTMLInputElement>('#zup');
  const stagesHost = $('#stages');
  const exportBtn = $<HTMLButtonElement>('#export-html');

  const memorySource = new MemorySource();
  let frames: FrameMeta[] = [];

  let preview: Viewer | null = null;
  let panel: Panel | null = null;
  let fpsMeter: FpsMeter | null = null;
  let disposeShortcuts: (() => void) | null = null;
  const disposePreview = (): void => {
    disposeShortcuts?.();
    disposeShortcuts = null;
    fpsMeter?.dispose();
    fpsMeter = null;
    panel?.dispose();
    panel = null;
    preview?.dispose();
    preview = null;
  };

  // Coordinate the two slide-out panels (persisted state, no overlap on mobile).
  const layout = new EditorLayout(sidebarEl, sidebarHandle, 'Project');

  const setFrameCount = (n: number): void => {
    frameCountEl.textContent = n > 0 ? `· ${n} frame${n === 1 ? '' : 's'}` : '· none yet';
  };

  // --- stages -------------------------------------------------------------
  const addStageRow = (stage: Stage): void => {
    const row = document.createElement('div');
    row.className = 'stage-row';
    row.innerHTML = `
      <input class="stage-name" placeholder="Stage name" />
      <input class="stage-frame" type="number" min="0" placeholder="frame" />
      <input class="stage-desc" placeholder="Description" />
      <button class="btn btn--danger stage-remove" type="button" title="Remove">✕</button>`;
    row.querySelector<HTMLInputElement>('.stage-name')!.value = stage.name;
    row.querySelector<HTMLInputElement>('.stage-frame')!.value = String(stage.frame);
    row.querySelector<HTMLInputElement>('.stage-desc')!.value = stage.desc;
    row.querySelector<HTMLButtonElement>('.stage-remove')!.addEventListener('click', () => row.remove());
    stagesHost.appendChild(row);
  };
  const collectStages = (): Stage[] =>
    [...stagesHost.querySelectorAll<HTMLElement>('.stage-row')]
      .map((r) => ({
        name: r.querySelector<HTMLInputElement>('.stage-name')!.value.trim(),
        frame: Number(r.querySelector<HTMLInputElement>('.stage-frame')!.value) || 0,
        desc: r.querySelector<HTMLInputElement>('.stage-desc')!.value.trim(),
      }))
      .filter((s) => s.name)
      .sort((a, b) => a.frame - b.frame);
  $('#add-stage').addEventListener('click', () => addStageRow({ name: '', frame: 0, desc: '' }));

  // --- manifest -----------------------------------------------------------
  const buildManifest = (): Manifest =>
    validateManifest({
      id: slug(titleInput.value) || 'timelapse',
      title: titleInput.value.trim() || 'Untitled',
      mode: modeSelect.value,
      config: {
        frameCount: frames.length,
        fps: Number(fpsInput.value) || 4,
        ext: 'glb',
        tiers: ['sd'],
        frameStartIndex: 0,
      },
      defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' },
      camera: { autoFrame: true },
      frames: frames.map((f, i) => ({ index: i, sd: framePath(i), hd: null, tris: f.tris })),
      stages: collectStages(),
    });

  // --- preview ------------------------------------------------------------
  async function mountPreview(): Promise<void> {
    disposePreview();
    exportBtn.disabled = true;
    previewBox.innerHTML = '';
    if (frames.length === 0) {
      previewBox.innerHTML = '<p class="muted preview__hint">Drop frames to preview.</p>';
      return;
    }
    const manifest = buildManifest();
    memorySource.setManifest(manifest);
    // preserveDrawingBuffer lets the panel read the canvas back for reel/thumbnail capture.
    preview = new Viewer(previewBox, manifest, memorySource, { preserveDrawingBuffer: true });
    await preview.boot();
    panel = new Panel(preview, { editor: true });
    layout.attach(panel);
    fpsMeter = new FpsMeter(preview);
    disposeShortcuts = installShortcuts(preview, {
      togglePanel: () => layout.toggle(),
      toggleFps: () => fpsMeter?.toggle(),
      refresh: () => panel?.refreshControls(),
    });
    exportBtn.disabled = false;
  }

  // Live FPS tweak without a remount; title/mode/stages are read at export.
  fpsInput.addEventListener('change', () => preview?.setFps(Number(fpsInput.value) || 4));

  // --- frame upload pipeline ---------------------------------------------
  const warnMemory = (): void => {
    const mb = frames.reduce((s, f) => s + f.bytes, 0) / 1e6;
    if (mb > 300) {
      memWarn.hidden = false;
      memWarn.textContent = `Heads up: ~${mb.toFixed(0)} MB of frames are held in memory. Very large sequences may strain the browser tab.`;
    } else {
      memWarn.hidden = true;
    }
  };

  async function handleFiles(fileList: File[]): Promise<void> {
    const files = fileList
      .filter((f) => /\.(obj|glb)$/i.test(f.name))
      .sort((a, b) => naturalSort(a.name, b.name));
    if (files.length === 0) {
      alert('No .obj or .glb files found.');
      return;
    }

    progress.hidden = false;
    bar.style.width = '0%';
    let done = 0;
    progressLabel.textContent = `0 / ${files.length}`;
    const tick = (): void => {
      done += 1;
      bar.style.width = `${Math.round((done / files.length) * 100)}%`;
      progressLabel.textContent = `${done} / ${files.length}`;
    };

    const zUp = zup.checked;
    memorySource.clearFrames();
    frames = [];
    try {
      const tasks = files.map((file, index) => async () => {
        const { glb, tris } = await frameFromFile(file, zUp);
        memorySource.putFrame(framePath(index), glb);
        tick();
        return { index, tris, bytes: glb.byteLength };
      });
      const results = (await runPool(tasks, 4)).sort((a, b) => a.index - b.index);
      frames = results.map((r) => ({ tris: r.tris, bytes: r.bytes }));
      setFrameCount(frames.length);
      progressLabel.textContent = `Done — ${frames.length} frame${frames.length === 1 ? '' : 's'}`;
      warnMemory();
      await mountPreview();
    } catch (err) {
      progressLabel.textContent = `Failed: ${(err as Error).message}`;
    }
  }

  $<HTMLInputElement>('#files').addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files) void handleFiles([...input.files]);
  });

  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dropzone--over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dropzone--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dropzone--over');
    if (e.dataTransfer?.files) void handleFiles([...e.dataTransfer.files]);
  });

  // --- export -------------------------------------------------------------
  exportBtn.addEventListener('click', () => {
    if (!preview) return;
    const p = preview;
    void runAction(exportBtn, async () => {
      const manifest = buildExportManifest(buildManifest(), p);
      const html = await buildExportHtml(manifest, memorySource);
      downloadBlob(new Blob([html], { type: 'text/html' }), `${slug(titleInput.value) || 'timelapse'}.html`);
    });
  });
}

main();
