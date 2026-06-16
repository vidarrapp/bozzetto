import { api } from './api';
import { frameFromFile, runPool } from './convert';
import { Viewer } from '../viewer/Viewer';
import { validateManifest } from '../types/manifest';

/** The manifest-shaped fields the editor reads from /api/projects/:id. */
interface EditorProject {
  id: string;
  title: string;
  mode: string;
  config: { fps: number; frameCount: number };
  frames: { index: number; tris: number }[];
}

const naturalSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

let preview: Viewer | null = null;
function disposePreview(): void {
  preview?.dispose();
  preview = null;
}

export async function renderEditor(host: HTMLElement, id: string): Promise<void> {
  disposePreview();
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
    <div class="admin editor">
      <header class="admin__head">
        <h1 class="editor__title"></h1>
        <a class="admin__home" href="/admin/">← Projects</a>
      </header>

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
        <h3>Preview</h3>
        <div id="preview" class="editor__preview"></div>
      </section>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  const titleHeading = $('.editor__title');
  const titleInput = $<HTMLInputElement>('#f-title');
  const modeSelect = $<HTMLSelectElement>('#f-mode');
  const fpsInput = $<HTMLInputElement>('#f-fps');
  const frameCountEl = $('#frame-count');

  titleHeading.textContent = project.title || id;
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

  $<HTMLButtonElement>('#save').addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try {
      await api.update(id, settings());
      titleHeading.textContent = settings().title || id;
    } catch (err) {
      alert(`Save failed: ${(err as Error).message}`);
    } finally {
      btn.disabled = false;
    }
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

  // --- preview ------------------------------------------------------------
  async function mountPreview(): Promise<void> {
    disposePreview();
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
    const matcapUrl = new URL('/assets/matcaps/clay.png', location.href).href;
    const manifestUrl = new URL(`/api/projects/${encodeURIComponent(id)}`, location.href).href;
    preview = new Viewer(box, manifest, manifestUrl, matcapUrl);
    await preview.boot();
  }

  await mountPreview();
}
