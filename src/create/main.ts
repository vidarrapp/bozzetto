import { frameFromFile, runPool } from '../admin/convert';
import { Viewer } from '../viewer/Viewer';
import { MemorySource } from '../viewer/AssetSource';
import { Panel } from '../ui/Panel';
import { mountReelControls } from '../ui/reel';
import { EditorLayout } from '../ui/editorLayout';
import { FpsMeter } from '../ui/FpsMeter';
import { installShortcuts } from '../ui/shortcuts';
import { disposePageChrome, pageChrome } from '../ui/ChromeToggle';
import { initTheme, mountThemeToggle } from '../ui/theme';
import { followPanelOpacity } from '../ui/appearance';
import { installSliderBubble } from '../ui/sliderBubble';
import { validateManifest, type Manifest } from '../types/manifest';
import { AuthExpiredError, checkSignIn, libraryProjects, roleOf, uploadFailure, type SignIn } from '../admin/api';
import { loadConfig, sizeText } from '../net/account';
import { statusToast, type StatusToast } from '../sculpt/ui/statusToast';
import { signInButton } from '../ui/signIn';
import { aoWithoutCavity } from '../viewer/Viewer';

/**
 * The uploader (`/create`, the gallery's Create > Create timelapse). Drop a
 * sculpt sequence, set up the look in the real viewer, and keep it. Frames
 * are converted in the browser and kept in memory (a MemorySource feeds the
 * live preview).
 *
 * For a guest it is backend-free: nothing is uploaded, saved, or gated;
 * the reel's GIF and MP4 are what it makes, and Sign in (with accounts on)
 * turns the page into a signed-in one without losing the frames. Signed in
 * (a member, a moderator or the owner) the same page saves to the library:
 * Save to My projects makes a project on the account's own routes
 * (Projects, on the owner tools', with accounts off) - its title, mode and
 * fps, the frames uploaded, the stages and the look as its data, and a 4:5
 * picture - and opens My projects, where it is viewed and shared. The
 * single-file .html export is gone (cloud viewing and sharing replace it).
 * The owner's /admin/ editor stays for the owner tools.
 */

/** The server's frame list cap (functions/_shared/projects.ts), checked before a byte goes up. */
const MAX_FRAMES = 10_000;
/** A member's frame cap (docs/accounts.md §4), when /api/config does not say. */
const FRAME_BYTES = 32 * 1024 * 1024;
/** The longest title the server keeps. */
const MAX_TITLE = 200;

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

/** A number /api/config gives, or the fallback when it gives none. */
const limit = (v: unknown, fallback: number): number => (typeof v === 'number' && v > 0 ? v : fallback);

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * The picture a save sends: the frame on screen when playback is paused
 * (so pausing on a frame chooses it), else the last - the finished piece -
 * at the camera as set. Taken by the viewer's captureThumbnail, the 4:5
 * portrait at 800 x 1000 every picture in the app is; playback is put back
 * as it was.
 */
async function savePicture(p: Viewer): Promise<Blob> {
  const was = p.timeline.frameIndex();
  const playing = p.timeline.playing;
  if (playing) {
    p.pause();
    p.jumpTo(p.timeline.frameCount - 1);
  }
  for (let i = 0; i < 100 && p.isAwaitingFrame(); i++) await new Promise((r) => setTimeout(r, 30));
  await nextFrame();
  try {
    return await p.captureThumbnail();
  } finally {
    if (playing) {
      p.jumpTo(was);
      p.play();
    }
  }
}

async function main(): Promise<void> {
  initTheme();
  followPanelOpacity();
  mountThemeToggle();
  installSliderBubble();

  const host = document.getElementById('create');
  if (!host) throw new Error('#create element not found');

  // Who it is for decides how it ends: a save to the library for anyone
  // signed in; for a guest, the reel, and Sign in where the site has
  // accounts. Suspended or expired, a guest's page.
  const signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
  const placeOf = (s: SignIn): string | null => {
    const role = roleOf(s);
    return role === 'owner' || role === 'moderator' || role === 'member' ? (s.accounts ? 'My projects' : 'Projects') : null;
  };
  let place = placeOf(signIn);
  const introText = (at: string | null): string =>
    at
      ? `Build a timelapse or a model from frames made elsewhere, and save it to ${at}, where only you see it.`
      : signIn.accounts
        ? 'Build a timelapse or a model from frames made elsewhere. Sign in to save it to My projects and share it. Nothing is uploaded until then.'
        : 'Build a timelapse or a model from frames made elsewhere, and make a GIF or MP4 of it. Nothing is uploaded.';
  /** The Save section's own content, signed in: the button, its progress. */
  const saveBody = (at: string): string => `
            <p class="muted editor__hint">Set up the look in the right-hand panel, then save: the frames, the stages and the look go to ${at}, with the view as its picture (the frame on screen when paused, else the last).</p>
            <div class="editor__row">
              <button id="save-project" class="btn btn--primary" type="button" disabled>Save to ${at}</button>
            </div>
            <div id="save-progress" class="progress" hidden>
              <div class="progress__track"><div class="progress__bar" id="save-bar"></div></div>
              <span id="save-label" class="muted"></span>
            </div>`;
  const guestBody = signIn.accounts
    ? `
            <p class="muted editor__hint">Sign in to save the frames, the stages and the look to My projects, where you can view and share them. The frames stay here while you do.</p>
            <div class="editor__row" id="save-signin"></div>`
    : '';
  const finish = `
          <section class="editor__section">
            <h3>${place || signIn.accounts ? 'Save' : 'Export'}</h3>
            <div id="save-body">${place ? saveBody(place) : guestBody}</div>
            <div id="reel-mount"></div>
          </section>`;

  host.innerHTML = `
    <div class="editor">
      <div id="preview" class="editor__preview"></div>
      <div class="topbar topbar--left"><a class="topchip" href="/">← Gallery</a></div>

      <aside class="editor__sidebar">
        <button class="editor__sidebar-handle" type="button" title="Hide / show">‹</button>
        <div class="editor__sidebar-body">
          <h1 class="editor__title">Create</h1>
          <p class="editor__id muted" id="create-intro">${introText(place)}</p>

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

          ${finish}
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
  const reelMount = $('#reel-mount');
  let saveBtn = host.querySelector<HTMLButtonElement>('#save-project');

  const memorySource = new MemorySource();
  let frames: FrameMeta[] = [];

  let preview: Viewer | null = null;
  let panel: Panel | null = null;
  let fpsMeter: FpsMeter | null = null;
  let disposeShortcuts: (() => void) | null = null;
  const disposePreview = (): void => {
    disposeShortcuts?.();
    disposeShortcuts = null;
    disposePageChrome(); // the interface back, and the toggle with the preview
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
    if (saveBtn) saveBtn.disabled = true;
    reelMount.replaceChildren(); // drop reel controls bound to the old viewer
    previewBox.innerHTML = '';
    if (frames.length === 0) {
      previewBox.innerHTML = '<p class="muted preview__hint">Drop frames to preview.</p>';
      return;
    }
    const manifest = buildManifest();
    memorySource.setManifest(manifest);
    // The editor preview reads the canvas back for reel/thumbnail capture; with a
    // paused loop the WebGPU canvas retains its last frame, so no extra flag is
    // needed (the option is kept only for call-site symmetry with the viewer).
    preview = await Viewer.create(previewBox, manifest, memorySource, { preserveDrawingBuffer: true });
    // The console handle the viewer's own page has (mountViewer), for the
    // preview here: __bozzetto.getLook() and the like.
    (window as unknown as { __bozzetto?: Viewer }).__bozzetto = preview;
    await preview.boot();
    panel = new Panel(preview, { editor: true });
    preview.onDofChange = () => panel?.refreshControls();
    layout.attach(panel);
    fpsMeter = new FpsMeter(preview);
    disposeShortcuts = installShortcuts(preview, {
      // Tab as everywhere (ChromeToggle): the open panel closes, then the
      // preview's chrome hides - its panel, tab and chips, never the
      // sidebar's forms - then it all comes back; Esc brings it back too.
      toggleChrome: () => pageChrome().handleTab(),
      toggleFps: () => fpsMeter?.toggle(),
      refresh: () => panel?.refreshControls(),
    });
    reelMount.replaceChildren(mountReelControls(preview));
    if (saveBtn) saveBtn.disabled = saving;
  }

  // Live FPS tweak without a remount; title/mode/stages are read at save.
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

  // --- save to the library (signed in) ------------------------------------
  let saving = false;
  let saveProgress = host.querySelector<HTMLElement>('#save-progress');
  let saveBar = host.querySelector<HTMLElement>('#save-bar');
  let saveLabel = host.querySelector<HTMLElement>('#save-label');
  const showSave = (text: string, fraction: number | null): void => {
    if (!saveProgress || !saveBar || !saveLabel) return;
    saveProgress.hidden = false;
    saveLabel.textContent = text;
    if (fraction !== null) saveBar.style.width = `${Math.round(fraction * 100)}%`;
  };

  /**
   * Make the project and fill it: created on the library's routes (the
   * account's own, private, under the server's id; or the owner tools',
   * private, under an id made from the title), the frames uploaded four at
   * a time, then its data in one patch - the frame list, which publishes
   * them, the stages and the look - and its picture. A save that does not
   * finish takes the project back, as Capture's publish does, so nothing
   * half-made holds the quota. Answers where to go and what it is called.
   */
  async function saveToLibrary(p: Viewer, status: StatusToast): Promise<{ title: string; href: string }> {
    const client = await libraryProjects();
    const config = client.scope === 'me' ? await loadConfig() : null;
    const maxFrames = limit(config?.limits.framesPerProject, MAX_FRAMES);
    if (frames.length > maxFrames) {
      throw new Error(`Too many frames (${frames.length.toLocaleString('en-US')}): a project takes at most ${maxFrames.toLocaleString('en-US')}`);
    }
    if (client.scope === 'me') {
      const cap = limit(config?.limits.frameBytes, FRAME_BYTES);
      const big = frames.findIndex((f) => f.bytes > cap);
      if (big >= 0) throw new Error(`Frame ${big + 1} is ${sizeText(frames[big].bytes)}: a frame may be at most ${sizeText(cap)}`);
    }
    const title = titleInput.value.trim().slice(0, MAX_TITLE) || 'Untitled';
    const mode = modeSelect.value === 'model' ? 'model' : 'timelapse';
    const fps = Math.min(30, Math.max(1, Math.round(Number(fpsInput.value) || 4)));
    const count = frames.length;
    status.set('Creating project...');
    showSave('Creating project...', 0);
    const made = await client.create(
      client.scope === 'me'
        ? { title, mode, fps }
        : { id: `${slug(title).slice(0, 50) || 'timelapse'}-${Math.random().toString(36).slice(2, 8)}`, title, mode, fps, visibility: 'private' },
    );
    const id = made.id;
    try {
      // Four in flight; the first refusal stops the rest before they start,
      // and the lanes settle before the project is taken back.
      let failure: unknown = null;
      let next = 0;
      let done = 0;
      const lane = async (): Promise<void> => {
        while (failure === null && next < count) {
          const i = next++;
          try {
            await client.uploadFrame(id, i, await memorySource.getBytes(framePath(i)));
            done += 1;
            const text = `Uploading frame ${done} of ${count}...`;
            status.set(text);
            showSave(text, done / count);
          } catch (err) {
            failure ??= err;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, count) }, lane));
      if (failure !== null) throw failure;
      status.set('Finishing...');
      showSave('Finishing...', 1);
      const look = p.getLook();
      await client.update(id, {
        title,
        mode,
        fps,
        frames: frames.map((f, index) => ({ index, tris: f.tris })),
        stages: collectStages(),
        lighting: look.lighting,
        material: look.material,
        environment: look.environment,
        ao: aoWithoutCavity(look),
        presentation: look.presentation,
        camera: look.camera,
        defaults: { material: look.materialMode },
      });
      await client.uploadThumb(id, await savePicture(p));
    } catch (err) {
      await client.remove(id).catch(() => undefined);
      throw err;
    }
    return { title, href: client.scope === 'me' ? '/?me' : '/admin/' };
  }

  /** How a save that did not happen ended, said as Sculpt's Save to library says it. */
  const notSaved = (status: StatusToast, err: unknown): void => {
    const why = err instanceof Error ? err.message.replace(/\.$/, '') : String(err);
    switch (uploadFailure(err)) {
      case 'expired': {
        const again = signInButton('', (ok) => (ok ? void save() : undefined), 'Sign in again', err instanceof AuthExpiredError ? err.via : undefined);
        status.fail('Your sign-in has expired. Nothing was saved; the frames are still here.', again);
        break;
      }
      case 'suspended':
        status.fail(`${why}. Nothing was saved.`);
        break;
      case 'full':
        // The server's numbers: "Your storage is full (248 of 250 MB)".
        status.fail(`${why}. Nothing was saved; make room in ${place}, then try again.`);
        break;
      case 'offline':
        status.fail('No connection. Nothing was saved; try again when you are online.');
        break;
      default:
        status.fail(`Not saved to ${place}: ${why}.`);
    }
  };

  async function save(): Promise<void> {
    if (!preview || !saveBtn || saving || frames.length === 0) return;
    const p = preview;
    saving = true;
    saveBtn.disabled = true;
    const status = statusToast(`Saving to ${place}...`);
    try {
      const { title, href } = await saveToLibrary(p, status);
      status.done(`Saved to ${place}: ${title}`);
      showSave(`Saved to ${place}`, 1);
      window.location.href = href;
    } catch (err) {
      if (saveProgress) saveProgress.hidden = true;
      notSaved(status, err);
    } finally {
      saving = false;
      saveBtn.disabled = !preview;
    }
  }
  saveBtn?.addEventListener('click', () => void save());

  // --- sign in (a guest, with accounts on) -------------------------------
  // Signed in in the dialog over the page, which stays where it is: the
  // Save section takes the signed-in form, and the frames and the look stay.
  const signInMount = host.querySelector<HTMLElement>('#save-signin');
  if (signInMount) {
    signInMount.append(
      signInButton(
        'btn btn--primary',
        (ok) => {
          if (!ok) return;
          void checkSignIn()
            .catch((): SignIn => ({ email: null, expired: false }))
            .then((now) => {
              const at = placeOf(now);
              if (!at) return;
              place = at;
              $('#create-intro').textContent = introText(at);
              $('#save-body').innerHTML = saveBody(at);
              saveBtn = $<HTMLButtonElement>('#save-project');
              saveProgress = $('#save-progress');
              saveBar = $('#save-bar');
              saveLabel = $('#save-label');
              saveBtn.disabled = !preview || saving;
              saveBtn.addEventListener('click', () => void save());
            });
        },
        'Sign in',
      ),
    );
  }
}

void main();
