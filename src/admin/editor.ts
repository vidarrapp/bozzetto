import { api } from './api';
import { frameFromFile, runPool } from './convert';
import { Viewer } from '../viewer/Viewer';
import { Panel } from '../ui/Panel';
import { installShortcuts } from '../ui/shortcuts';
import { FpsMeter } from '../ui/FpsMeter';
import { validateManifest } from '../types/manifest';

interface Stage {
  name: string;
  frame: number;
  desc: string;
}

/** The manifest-shaped fields the editor reads from /api/projects/:id. */
interface EditorProject {
  id: string;
  title: string;
  mode: string;
  config: { fps: number; frameCount: number };
  frames: { index: number; tris: number }[];
  stages: Stage[];
}

const naturalSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Run a save action with consistent button feedback: disable while in-flight,
 * flash "Saved ✓" on success then revert, alert on failure. The idle label is
 * captured once so repeated saves always revert to the right text.
 */
async function runSave(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  btn.dataset.idle ??= btn.textContent ?? '';
  const idle = btn.dataset.idle;
  btn.disabled = true;
  try {
    await fn();
    btn.textContent = 'Saved ✓';
    window.clearTimeout(Number(btn.dataset.savedTimer));
    btn.dataset.savedTimer = String(
      window.setTimeout(() => {
        btn.textContent = idle;
      }, 1500),
    );
  } catch (err) {
    alert(`${idle} failed: ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

let preview: Viewer | null = null;
let panel: Panel | null = null;
let fpsMeter: FpsMeter | null = null;
let disposeShortcuts: (() => void) | null = null;
function disposePreview(): void {
  disposeShortcuts?.();
  disposeShortcuts = null;
  fpsMeter?.dispose();
  fpsMeter = null;
  panel?.dispose();
  panel = null;
  preview?.dispose();
  preview = null;
}

export async function renderEditor(host: HTMLElement, id: string): Promise<void> {
  disposePreview();
  document.documentElement.classList.remove('is-page'); // full-viewport editor
  host.innerHTML = '<div class="admin"><p class="muted">Loading…</p></div>';

  let project: EditorProject;
  try {
    project = (await api.get(id)) as EditorProject;
  } catch (err) {
    host.innerHTML = `<div class="admin"><a class="admin__home" href="/admin/">← Projects</a>
      <p>Could not load “${id}”: ${(err as Error).message}</p></div>`;
    return;
  }

  host.innerHTML = `
    <div class="editor">
      <div id="preview" class="editor__preview"></div>

      <aside class="editor__sidebar">
        <button class="editor__sidebar-handle" type="button" title="Hide / show (Tab)">‹</button>
        <div class="editor__sidebar-body">
          <a class="editor__back" href="/admin/">← Projects</a>
          <h1 class="editor__title"></h1>
          <p class="editor__id muted"></p>

          <section class="editor__section">
            <h3>Settings</h3>
            <div class="editor__settings">
              <label>Title <input id="f-title" type="text" /></label>
              <label>Mode
                <select id="f-mode">
                  <option value="timelapse">Timelapse</option>
                  <option value="model">Model</option>
                </select>
              </label>
              <label>FPS <input id="f-fps" type="number" min="1" max="30" step="1" /></label>
              <button id="save" class="btn btn--primary" type="button">Save settings</button>
            </div>
          </section>

          <section class="editor__section">
            <h3>Frames <span id="frame-count" class="muted"></span></h3>
            <div id="drop" class="dropzone">
              <p>Drop a sequence of <strong>.obj</strong> or <strong>.glb</strong> files, or pick them:</p>
              <input id="files" type="file" accept=".obj,.glb" multiple />
              <label class="checkbox dropzone__zup"><input id="zup" type="checkbox" /> OBJ files are Z-up</label>
            </div>
            <div id="progress" class="progress" hidden>
              <div class="progress__track"><div class="progress__bar" id="bar"></div></div>
              <span id="progress-label" class="muted"></span>
            </div>
          </section>

          <section class="editor__section">
            <h3>Stages</h3>
            <div id="stages"></div>
            <div class="editor__row">
              <button id="add-stage" class="btn" type="button">Add stage</button>
              <button id="save-stages" class="btn btn--primary" type="button">Save stages</button>
            </div>
          </section>

          <section class="editor__section">
            <h3>Look</h3>
            <p class="muted editor__hint">Lighting, material &amp; camera live in the right-hand panel. Save the current look, or grab the frame as the thumbnail.</p>
            <div class="editor__row">
              <button id="save-look" class="btn btn--primary" type="button" disabled>Save look</button>
              <button id="save-thumb" class="btn" type="button" disabled>Save thumbnail</button>
            </div>
          </section>
        </div>
      </aside>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  const sidebarEl = $('.editor__sidebar');
  const sidebarHandle = $<HTMLButtonElement>('.editor__sidebar-handle');
  const titleHeading = $('.editor__title');
  const titleInput = $<HTMLInputElement>('#f-title');
  const modeSelect = $<HTMLSelectElement>('#f-mode');
  const fpsInput = $<HTMLInputElement>('#f-fps');
  const frameCountEl = $('#frame-count');

  // The left sidebar slides out like the right control panel; its handle and
  // Tab both drive this. (Arrow points the way it will travel: ‹ out, › in.)
  let sidebarCollapsed = false;
  const setSidebarCollapsed = (collapsed: boolean): void => {
    sidebarCollapsed = collapsed;
    sidebarEl.classList.toggle('editor__sidebar--collapsed', collapsed);
    sidebarHandle.textContent = collapsed ? '›' : '‹';
  };
  sidebarHandle.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));

  titleHeading.textContent = project.title || id;
  $('.editor__id').textContent = `id: ${id}`;
  titleInput.value = project.title || id;
  modeSelect.value = project.mode === 'model' ? 'model' : 'timelapse';
  fpsInput.value = String(project.config?.fps ?? 4);

  const setFrameCount = (n: number): void => {
    frameCountEl.textContent = n > 0 ? `· ${n} frame${n === 1 ? '' : 's'}` : '· none yet';
  };
  setFrameCount(project.frames?.length ?? 0);

  const settings = () => ({
    title: titleInput.value.trim(),
    mode: modeSelect.value,
    fps: Number(fpsInput.value) || 4,
  });

  $<HTMLButtonElement>('#save').addEventListener('click', (e) => {
    void runSave(e.currentTarget as HTMLButtonElement, async () => {
      await api.update(id, settings());
      titleHeading.textContent = settings().title || id;
    });
  });

  // --- frame upload pipeline ---------------------------------------------
  const progress = $('#progress');
  const bar = $('#bar');
  const progressLabel = $('#progress-label');
  const zup = $<HTMLInputElement>('#zup');

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
    try {
      const tasks = files.map((file, index) => async () => {
        const { glb, tris } = await frameFromFile(file, zUp);
        await api.uploadFrame(id, index, glb);
        tick();
        return { index, tris };
      });
      const frames = (await runPool(tasks, 4)).sort((a, b) => a.index - b.index);
      await api.update(id, { ...settings(), frames });
      setFrameCount(frames.length);
      progressLabel.textContent = `Done — ${frames.length} frame${frames.length === 1 ? '' : 's'}`;
      await mountPreview();
      await captureDefaultThumb();
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

  // --- stages editor ------------------------------------------------------
  const stagesHost = $('#stages');
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
  (project.stages ?? []).forEach(addStageRow);

  $('#add-stage').addEventListener('click', () => addStageRow({ name: '', frame: 0, desc: '' }));
  $<HTMLButtonElement>('#save-stages').addEventListener('click', (e) => {
    const stages: Stage[] = [...stagesHost.querySelectorAll<HTMLElement>('.stage-row')]
      .map((r) => ({
        name: r.querySelector<HTMLInputElement>('.stage-name')!.value.trim(),
        frame: Number(r.querySelector<HTMLInputElement>('.stage-frame')!.value) || 0,
        desc: r.querySelector<HTMLInputElement>('.stage-desc')!.value.trim(),
      }))
      .filter((s) => s.name)
      .sort((a, b) => a.frame - b.frame);
    void runSave(e.currentTarget as HTMLButtonElement, async () => {
      await api.update(id, { stages });
    });
  });

  // --- preview + lighting -------------------------------------------------
  const saveLook = $<HTMLButtonElement>('#save-look');
  saveLook.addEventListener('click', () => {
    if (!preview) return;
    const p = preview;
    void runSave(saveLook, async () => {
      await api.update(id, {
        lighting: p.lighting.serialize(),
        material: p.materials.getMaterialState(),
        environment: p.environment.getState(),
        ao: p.getAOState(),
        camera: p.getCameraState(),
        defaults: { material: p.getMaterial() },
      });
    });
  });

  const saveThumb = $<HTMLButtonElement>('#save-thumb');
  saveThumb.addEventListener('click', () => {
    if (!preview) return;
    const p = preview;
    void runSave(saveThumb, async () => {
      await api.uploadThumb(id, await p.captureThumbnail());
    });
  });

  /** Grab frame 0 as the default gallery thumbnail (best-effort) after upload. */
  async function captureDefaultThumb(): Promise<void> {
    if (!preview) return;
    preview.pause();
    preview.jumpTo(0);
    // Let the render loop swap to frame 0 before we read the canvas.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    try {
      await api.uploadThumb(id, await preview.captureThumbnail());
    } catch {
      /* non-fatal: the user can still Save thumbnail manually */
    }
    preview.play();
  }

  async function mountPreview(): Promise<void> {
    disposePreview();
    saveLook.disabled = true;
    saveThumb.disabled = true;
    const box = $('#preview');
    box.innerHTML = '';
    let raw: unknown;
    try {
      raw = await api.get(id);
    } catch {
      box.innerHTML = '<p class="muted preview__hint">Preview unavailable.</p>';
      return;
    }
    if (!(raw as EditorProject).frames?.length) {
      box.innerHTML = '<p class="muted preview__hint">Upload frames to preview.</p>';
      return;
    }
    const manifest = validateManifest(raw);
    const manifestUrl = new URL(`/api/projects/${encodeURIComponent(id)}`, location.href).href;
    preview = new Viewer(box, manifest, manifestUrl, { preserveDrawingBuffer: true });
    await preview.boot();
    panel = new Panel(preview, { editor: true });
    // A freshly-mounted panel starts open; keep the sidebar's slide state in sync.
    setSidebarCollapsed(false);
    fpsMeter = new FpsMeter(preview);
    disposeShortcuts = installShortcuts(preview, {
      togglePanel: () => {
        // Tab hides both the floating control panel and the left sidebar.
        const collapsed = panel ? panel.toggleCollapsed() : !sidebarCollapsed;
        setSidebarCollapsed(collapsed);
      },
      toggleFps: () => fpsMeter?.toggle(),
      refresh: () => panel?.refreshControls(),
    });
    saveLook.disabled = false;
    saveThumb.disabled = false;
  }

  await mountPreview();
}
