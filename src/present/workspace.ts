import '../sculpt/ui/shell.css';
import type { LookState, Viewer } from '../viewer/Viewer';
import { HttpSource } from '../viewer/AssetSource';
import { MaterialPanel } from '../ui/MaterialPanel';
import { mountViewerParts, type ViewerParts } from '../viewer/mountViewer';
import { validateManifest, type Manifest, type ProjectMode } from '../types/manifest';
import { api, failureText, type Visibility } from '../admin/api';
import {
  lookPatch,
  manifestUrl,
  normalizeStages,
  sameStages,
  type EditorProject,
  type Stage,
} from '../admin/projectEdit';
import { pageChrome } from '../ui/ChromeToggle';
import { askWindow } from '../ui/askWindow';
import { Help } from '../ui/Help';
import { onTap } from '../ui/dom';
import { signInAgain } from '../ui/signIn';
import { helpMenuItems } from '../help/menu';
import { TitleStrip, stripButton } from '../sculpt/ui/TitleStrip';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { failNotice, statusToast } from '../sculpt/ui/statusToast';
import { viewMenuItems } from '../sculpt/ui/viewMenu';
import { layoutShell } from '../sculpt/ui/shellLayout';
import type { ScaleBanner } from '../sculpt/ui/SetScale';
import { ProjectPanel } from './ProjectPanel';
import { OutputPanel } from './OutputPanel';
import { FramesPanel } from './FramesPanel';
import { mountScaleBanner } from './setScale';
import {
  FramesSource,
  MAX_FRAMES,
  convertFiles,
  entriesFromProject,
  framesFiles,
  manifestFrames,
  type FrameItem,
} from './frameStore';
import { reseat, sequenceChanged, uploadSequence } from './saveFrames';
import { notSavedNotice, saveNewProject } from './saveNew';
import { originOf } from '../ui/origin';

/**
 * The Present workspace for a frame project (mode `timelapse` or `model`):
 * the one place that makes one and edits one (owner decision, 2026-11-12,
 * folding the Create page and the owner's frame editor into it). It is the
 * page's viewer and Render panel under Sculpt's shell - the title strip,
 * folder tabs and panels (sculpt/ui) - with Frames and Project at the
 * left, Render and Output at the right, and the transport at the foot.
 *
 * Two ways in. `/?tl=<id>&present=1` (open.ts) is a published project, for
 * the owner only; `/create/` (create/main.ts) is a project that is not on
 * the site yet, for whoever may use the page. The difference is what Save
 * is: for a published project the one Save writes the look with whatever
 * changed (settings, stages, the sequence); in Create it makes the project
 * in the library, or asks to sign in first.
 *
 * Frames and the other edits are a working copy: nothing reaches the site
 * until Save, and the strip says "Edited" (Create: "Not saved") while
 * something has not. A change to the sequence plays the new one by taking
 * the view down and putting it up again with the look it had.
 */

/** What Create knows of who is using it. */
export interface CreateAccount {
  /** Where a save goes ("My projects", "Projects"), or null for a guest. */
  place: string | null;
  /** Whether the site has accounts, so a guest may be offered Sign in. */
  accounts: boolean;
  /** Who is signed in now, asked again after a Sign in (null: still a guest). */
  recheck(): Promise<string | null>;
}

export interface WorkspaceOptions {
  viewport: HTMLElement;
  /** A published project, as the owner's API gives it; absent for Create. */
  project?: { id: string; data: EditorProject };
  /** Create's guest or member; set exactly when `project` is not. */
  create?: CreateAccount;
  /** The tab to open at the left: Frames (the default for Create) or Project. */
  tab?: 'frames' | 'project';
  onStatus?: (msg: string) => void;
}

/** What was last saved, to tell what changed. */
interface Saved {
  title: string;
  mode: ProjectMode;
  visibility: Visibility;
  fps: number;
  stages: Stage[];
  look: string;
  /** The sequence's frames, by key, in order. */
  seq: number[];
}

/** What a view held up for the sequence has: taken down and put up again as the sequence changes. */
interface Mounted {
  parts: ViewerParts;
  output: OutputPanel;
  /** The left-hand Material tab: how the model is drawn. */
  material: MaterialPanel;
  banner: ScaleBanner<string> | null;
}

/** Create's manifest, before anything is chosen: what the Create page began from. */
const NEW_DEFAULTS = {
  defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
};

export async function mountWorkspace(opts: WorkspaceOptions): Promise<Viewer | null> {
  const { viewport } = opts;
  const project = opts.project ?? null;
  const id = project?.id ?? null;
  const create = opts.create ?? null;
  document.body.classList.add('bz-frames');

  // --- the working copy, and what was saved ---------------------------------
  const source = new FramesSource(new HttpSource(id ? manifestUrl(id) : window.location.href));
  let items: FrameItem[] = project ? entriesFromProject(project.data.frames) : [];
  const stages0 = normalizeStages(project?.data.stages ?? []);
  const title0 = project ? project.data.title || project.id : '';
  const mode0: ProjectMode = project?.data.mode === 'model' ? 'model' : 'timelapse';
  const saved: Saved = {
    title: title0,
    mode: mode0,
    visibility: project?.data.visibility === 'private' ? 'private' : 'public',
    fps: project?.data.config?.fps ?? 4,
    stages: stages0,
    look: '',
    seq: items.map((f) => f.key),
  };
  let place = create?.place ?? null;

  let current: Mounted | null = null;
  const viewer = (): Viewer | null => current?.parts.viewer ?? null;

  const lookKey = (): string => {
    const v = viewer();
    if (!v) return '';
    // The camera's place is a view, not an edit: orbiting does not make the page Edited
    // (a save still writes where the camera stands, as the editor's Save look does).
    const look = lookPatch(v);
    const { position: _p, target: _t, ...camera } = (look.camera ?? {}) as Record<string, unknown>;
    return JSON.stringify({ ...look, camera });
  };

  // --- the strip ---------------------------------------------------------------
  const strip = new TitleStrip();
  let projectPanel: ProjectPanel;
  let framesPanel: FramesPanel;
  let saving = false;
  const timelapse = (): boolean => projectPanel.values.mode === 'timelapse' && items.length > 1;
  const sequenceDirty = (): boolean => sequenceChanged(items, saved.seq);

  const isEdited = (): boolean => {
    // Create has nothing on the site: any frame is work that is not saved.
    if (!project) return items.length > 0;
    const v = projectPanel.values;
    return (
      v.title.trim() !== saved.title ||
      v.mode !== saved.mode ||
      v.visibility !== saved.visibility ||
      (v.mode === 'timelapse' && v.fps !== saved.fps) ||
      (v.mode === 'timelapse' && !sameStages(v.stages, saved.stages)) ||
      sequenceDirty() ||
      lookKey() !== saved.look
    );
  };
  let wasEdited = false;
  const refreshReadout = (frame = viewer()?.timeline.frameIndex() ?? 0): void => {
    const edited = isEdited();
    wasEdited = edited;
    const v = projectPanel.values;
    const at = timelapse() ? viewer()?.timeline.stageAt(frame) : null;
    const n = items.length;
    strip.setReadout({
      name: v.title.trim() || (project ? id : 'Untitled'),
      edited,
      editedText: project ? undefined : 'Not saved',
      extras: [
        v.mode === 'model'
          ? { key: 'Model', value: '' }
          : { key: 'Timelapse', value: n === 0 ? 'no frames' : `${n} frame${n === 1 ? '' : 's'}` },
        ...(timelapse() ? [{ key: 'Stage', value: at?.name || null }] : []),
      ],
    });
  };
  let soon = 0;
  const check = (): void => {
    if (soon) return;
    soon = window.setTimeout(() => {
      soon = 0;
      refreshReadout();
    }, 120);
  };

  // --- the view: up for the sequence, down and up again as it changes ---------
  /** Which right-hand panel is open, so a view put up again opens the same. */
  let rightOpen: string | null = null;
  let leftOpen: string | null = null;
  /** A phone has room for one panel: opening one on a side puts away the one on the other. */
  const narrow = (): boolean => window.matchMedia('(max-width: 600px)').matches;
  window.addEventListener('bozzetto:panel-open', (e) => {
    const d = (e as CustomEvent<{ id?: string; side?: string }>).detail;
    if (d?.side === 'right') rightOpen = d.id ?? null;
    else if (d?.side === 'left') leftOpen = d.id ?? null;
    if (!narrow()) return;
    const other = d?.side === 'right' ? leftOpen : rightOpen;
    if (other) window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: other, open: false } }));
  });
  window.addEventListener('bozzetto:panel-close', (e) => {
    const d = (e as CustomEvent<{ id?: string; side?: string }>).detail;
    if (d?.side === 'right' && d.id === rightOpen) rightOpen = null;
    if (d?.side === 'left' && d.id === leftOpen) leftOpen = null;
  });

  const empty = document.createElement('p');
  empty.className = 'bz-empty';
  empty.textContent = 'Drop frames to preview.';
  let emptyHelp: Help | null = null;

  /** The manifest for the list as it stands: the project's own, with the list's frames, mode, rate and stages. */
  const buildManifest = (frame: number, playing: boolean): Manifest => {
    const v = projectPanel.values;
    const base = (project ? (project.data as unknown as Record<string, unknown>) : NEW_DEFAULTS) as Record<string, unknown> & {
      config?: object;
      defaults?: object;
    };
    return validateManifest({
      ...base,
      id: project?.id ?? 'timelapse',
      title: v.title.trim() || (project ? project.id : 'Untitled'),
      mode: v.mode,
      config: { ext: 'glb', tiers: ['sd'], frameStartIndex: 0, ...(base.config ?? {}), frameCount: items.length, fps: v.fps },
      defaults: { ...(base.defaults ?? {}), frame: Math.min(frame, Math.max(0, items.length - 1)), playing },
      frames: manifestFrames(items),
      stages: normalizeStages(v.stages),
    });
  };

  const takeDown = (): void => {
    if (!current) return;
    const { parts, output, material, banner } = current;
    banner?.dispose();
    output.dispose();
    material.dispose();
    if (leftOpen === 'material') leftOpen = null;
    parts.dispose();
    current = null;
    // The console's handle on the view goes with it; the next view sets its own.
    delete (window as unknown as { __bozzetto?: Viewer }).__bozzetto;
    paintAction();
  };

  let building: Promise<void> = Promise.resolve();
  let again = false;
  /** Put the view up for the list as it is now (or take it down, with no frames). Calls in a row settle into one more. */
  const rebuild = (): Promise<void> => {
    again = true;
    building = building.then(async () => {
      if (!again) return;
      again = false;
      await mountView();
    });
    return building;
  };

  /** The look the project opened with: what Reset look in Render goes back to, through every remount of the view. */
  let openedLook: LookState | null = null;
  const mountView = async (): Promise<void> => {
    const old = current;
    const v0 = old?.parts.viewer ?? null;
    const look = v0?.getLook() ?? null;
    const frame = v0?.timeline.frameIndex() ?? 0;
    const playing = v0?.timeline.playing ?? true;
    const wasOpen = rightOpen;
    const materialWasOpen = leftOpen === 'material';
    takeDown();
    source.entries = items;
    if (items.length === 0) {
      viewport.replaceChildren(empty);
      emptyHelp ??= new Help({ button: false });
      projectPanel.refreshFrames();
      refreshReadout(0);
      paintAction();
      layoutShell();
      return;
    }
    emptyHelp?.dispose();
    emptyHelp = null;
    empty.remove();
    const manifest = buildManifest(frame, playing);
    source.setManifest(manifest);
    const parts = await mountViewerParts(viewport, manifest, source, opts.onStatus, {
      shell: true,
      openedLook: openedLook ?? undefined,
      preserveDrawingBuffer: true,
    });
    const view = parts.viewer;
    openedLook ??= view.getLook();
    if (look) {
      await view.applyLook(look);
      parts.panel.refreshControls();
    }
    const output = new OutputPanel(view, { timelapse: timelapse(), title: () => projectPanel.values.title.trim() || id || 'Bozzetto' });
    // Mode, shading and wireframe sit in this tab, not in Render (the Render panel is built without them).
    const material = new MaterialPanel(view, { sculpting: false });
    current = { parts, output, material, banner: null };
    // The frame moves: the transport has the viewer's hook, so this rides on it.
    const frameHook = view.onFrame;
    view.onFrame = (n) => {
      frameHook?.(n);
      projectPanel.syncFrame(n);
      refreshReadout(n);
    };
    projectPanel.refreshFrames();
    // Output stands open as drawn, the first time; after that, as it was left.
    if (wasOpen === 'settings') window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'settings', open: true } }));
    else if (wasOpen === 'output' || (!old && !narrow())) output.setCollapsed(false);
    if (materialWasOpen) material.setCollapsed(false);
    // A project from before real units: the Set scale offer (owner tool).
    if (id) {
      current.banner = mountScaleBanner(view, id, projectPanel.values.title.trim() || title0, () => {
        saved.look = lookKey();
        refreshReadout();
      });
    }
    window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    refreshReadout(view.timeline.frameIndex());
    paintAction();
    layoutShell();
  };

  // --- panels ----------------------------------------------------------------------
  framesPanel = new FramesPanel({
    addFiles: async (files, zUp) => {
      const picked = framesFiles(files);
      if (picked.length === 0) {
        failNotice('No .obj or .glb files found.');
        return;
      }
      if (items.length + picked.length > MAX_FRAMES) {
        failNotice(`Too many frames (${(items.length + picked.length).toLocaleString('en-US')}): a project takes at most ${MAX_FRAMES.toLocaleString('en-US')}`);
        return;
      }
      framesPanel.showProgress(0, picked.length);
      try {
        const added = await convertFiles(picked, zUp, (done) => framesPanel.showProgress(done, picked.length));
        items = [...items, ...added];
        framesPanel.showProgress(items.length, items.length, `Done: ${added.length} frame${added.length === 1 ? '' : 's'} added`);
        changed();
      } catch (err) {
        framesPanel.showProgress(null, 0, `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    clear: () => {
      void (async () => {
        const yes = await askWindow({
          title: 'Clear the frames?',
          text: project
            ? 'Every frame is taken out of the list. The project on the site keeps them until you save.'
            : 'Every frame is taken out of the list, and the preview with them.',
          yes: 'Clear the frames',
        });
        if (!yes) return;
        items = [];
        framesPanel.showProgress(null);
        changed();
      })();
    },
  });
  /** The list changed: the tab and the strip say so, and the view is put up for the new sequence. */
  const changed = (): void => {
    framesPanel.setItems(items);
    refreshReadout();
    void rebuild();
  };

  projectPanel = new ProjectPanel(
    {
      title: title0,
      mode: mode0,
      visibility: project ? saved.visibility : null,
      fps: saved.fps,
      stages: stages0,
    },
    {
      card: !!project,
      hasFrames: () => items.length > 0,
      frameAt: () => viewer()?.timeline.frameIndex() ?? 0,
      seek: (frame) => viewer()?.scrubTo(frame),
      stagesChanged: (list) => {
        viewer()?.setStages(normalizeStages(list));
        current?.parts.transport?.syncStages();
        refreshReadout();
      },
      fpsChanged: (fps) => viewer()?.setFps(fps),
      modeChanged: () => {
        refreshReadout();
        void rebuild();
      },
      edited: check,
      useFrame: () => useThisFrame(),
    },
  );
  strip.setWorkspace('present', {
    armature: { unavailable: 'This project has no sculpt scene' },
    sculpt: { unavailable: 'This project has no sculpt scene' },
  });

  // The editor did this after a thumbnail: the frame on show.
  const useThisFrame = async (): Promise<void> => {
    const v = viewer();
    if (!v || !id) return;
    const status = statusToast('Saving the card picture...');
    try {
      const was = v.timeline.playing;
      v.pause();
      // Let the render loop show the frame before the canvas is read.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await api.uploadThumb(id, await v.captureThumbnail());
      if (was) v.play();
      status.done('Card picture saved');
    } catch (err) {
      status.fail(`Could not save the card picture: ${failureText(err)}`);
    }
  };

  // --- save and close ---------------------------------------------------------------
  const saveBtn = stripButton('Save', true);
  strip.publishHost.prepend(saveBtn);

  /** The strip's one orange action, worded for who is here: Save, Save to My projects, Sign in to save, or none. */
  const paintAction = (): void => {
    // Create says where the frames go, as its page did: nowhere until there is a save to make.
    if (!project) {
      framesPanel.setNote(
        place ? `Nothing is uploaded until you save to ${place}.` : create?.accounts ? 'Nothing is uploaded until you sign in and save.' : 'Nothing is uploaded.',
      );
    }
    if (project) {
      saveBtn.textContent = 'Save';
      saveBtn.setAttribute('aria-label', 'Save');
      saveBtn.hidden = false;
    } else if (place) {
      saveBtn.textContent = `Save to ${place}`;
      saveBtn.setAttribute('aria-label', `Save to ${place}`);
      saveBtn.hidden = false;
    } else if (create?.accounts) {
      saveBtn.textContent = 'Sign in to save';
      saveBtn.setAttribute('aria-label', 'Sign in to save');
      saveBtn.hidden = false;
    } else {
      // A guest on a site with no accounts has nothing to save to: the reel and the image are what it makes.
      saveBtn.hidden = true;
    }
    // Create has nothing to save, or to sign in for, until there is a view of frames.
    saveBtn.disabled = saving || (!project && !!place && !current);
    layoutShell();
  };

  /** A project on the site: the look and what changed, in one patch; the sequence first, when it changed. */
  const saveProject = async (): Promise<boolean> => {
    if (!id) return false;
    const v = projectPanel.values;
    const title = v.title.trim();
    if (!title) {
      failNotice('Give the project a title before saving');
      return false;
    }
    if (items.length === 0) {
      failNotice('Add at least one frame before saving');
      return false;
    }
    const view = viewer();
    if (!view) return false;
    saving = true;
    paintAction();
    const status = statusToast('Saving...');
    const stages = normalizeStages(v.stages);
    const look = lookKey();
    const seqChanged = sequenceDirty();
    const patch: Record<string, unknown> = { ...lookPatch(view) };
    if (title !== saved.title) patch.title = title;
    if (v.mode !== saved.mode) patch.mode = v.mode;
    if (v.visibility !== null && v.visibility !== saved.visibility) patch.visibility = v.visibility;
    if (v.mode === 'timelapse' && v.fps !== saved.fps) patch.fps = v.fps;
    if (v.mode === 'timelapse' && !sameStages(stages, saved.stages)) patch.stages = stages;
    const replaced = seqChanged && !items.some((f) => f.glb === null);
    try {
      if (seqChanged) {
        await uploadSequence(id, items, source, (done, total) => status.set(`Uploading frame ${done} of ${total}...`));
        patch.frames = items.map((f, index) => ({ index, tris: f.tris }));
      }
      await api.update(id, patch);
    } catch (err) {
      // Nothing is lost: every edit is still here, and Save tries again.
      status.fail(
        seqChanged
          ? `Could not save: ${failureText(err)}. Frames may have been partly written; save again to finish.`
          : `Could not save: ${failureText(err)}`,
      );
      return false;
    } finally {
      saving = false;
      paintAction();
    }
    Object.assign(saved, { title, mode: v.mode, visibility: v.visibility ?? saved.visibility, fps: v.fps, stages, look });
    view.manifest.title = title;
    if (v.mode === 'timelapse') projectPanel.setStages(stages);
    if (seqChanged) {
      try {
        items = await reseat(id, items);
      } catch {
        // The list stays as it was: the frames are held, and the next save writes the same places again.
      }
      source.entries = items;
      saved.seq = items.map((f) => f.key);
      framesPanel.setItems(items);
      // A sequence put in whole has no card picture of its own yet: its first frame, as the editor made one.
      if (replaced) await firstFrameCard(view, id);
    }
    status.done('Saved');
    refreshReadout();
    return true;
  };

  /** The editor's default card picture after an upload (best effort): frame 0. */
  const firstFrameCard = async (view: Viewer, project: string): Promise<void> => {
    const was = view.timeline.frameIndex();
    const playing = view.timeline.playing;
    try {
      view.pause();
      view.jumpTo(0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await api.uploadThumb(project, await view.captureThumbnail());
    } catch {
      /* non-fatal: Use this frame puts one there */
    } finally {
      view.jumpTo(was);
      if (playing) view.play();
    }
  };

  /** Create: make the project in the library and go where it is. */
  const saveNew = async (): Promise<boolean> => {
    const view = viewer();
    if (!view || !place || items.length === 0) return false;
    saving = true;
    paintAction();
    const status = statusToast(`Saving to ${place}...`);
    try {
      const v = projectPanel.values;
      const { title, href } = await saveNewProject(
        view,
        items,
        source,
        { title: v.title, mode: v.mode, fps: v.fps, stages: normalizeStages(v.stages) },
        status,
      );
      status.done(`Saved to ${place}: ${title}`);
      leaving = true;
      window.location.href = href;
      return true;
    } catch (err) {
      notSavedNotice(status, err, place, () => void save());
      return false;
    } finally {
      saving = false;
      paintAction();
    }
  };

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    if (!project && !place) {
      // A guest: Sign in, and the frames stay here while it is done.
      if (!create?.accounts) return false;
      if (!(await signInAgain())) return false;
      place = (await create.recheck()) ?? null;
      paintAction();
      return false;
    }
    return project ? saveProject() : saveNew();
  };
  onTap(saveBtn, () => void save());
  paintAction();

  const close = async (): Promise<void> => {
    if (isEdited()) {
      const yes = await askWindow({
        title: 'Close without saving?',
        text: project ? 'The changes since the last save will be lost.' : 'The frames and settings here will be lost.',
        yes: 'Close without saving',
      });
      if (!yes) return;
    }
    leaving = true;
    window.location.href = originOf().href;
  };
  let leaving = false;
  const warn = (e: BeforeUnloadEvent): void => {
    if (leaving || !wasEdited) return;
    e.preventDefault();
  };
  window.addEventListener('beforeunload', warn);

  // --- menus ---------------------------------------------------------------------------
  const chrome = pageChrome();
  new TopMenu(
    'File',
    [
      {
        label: () => (project || !place ? 'Save' : `Save to ${place}`),
        action: () => void save(),
        enabled: () => !!project || !!place,
      },
      { separator: true },
      { label: 'Close', hint: originOf().hint, action: () => void close() },
    ],
    'file-menu--file',
    strip.menus,
    true,
  );
  const viewItems = viewMenuItems({
    panels: [
      ['frames', 'Frames'],
      ['project', 'Project'],
      ['material', 'Material'],
      ['settings', 'Render'],
      ['output', 'Output'],
    ],
    hideInterface: () => chrome.set(true),
  });
  // Material, Render and Output are the view's: with no frames there is no view to have them.
  for (const item of viewItems) {
    if (!('separator' in item) && (item.label === 'Material panel' || item.label === 'Render panel' || item.label === 'Output panel')) item.enabled = () => !!current;
  }
  new TopMenu('View', viewItems, 'file-menu--view', strip.menus, true);
  new TopMenu('Help', helpMenuItems(), 'file-menu--help', strip.menus, true);
  strip.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => strip.setChromeHidden(hidden);

  // --- up --------------------------------------------------------------------------------
  framesPanel.setItems(items);
  // Frames at the left for Create and when asked; Project otherwise. Output stands open at the right once there is a view.
  (opts.tab === 'project' || (project && opts.tab !== 'frames') ? projectPanel : framesPanel).setCollapsed(false);
  await rebuild();

  // A handle for the tests and the console: whether the page is Edited, and what its look was.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    (window as unknown as { __presentPage?: object }).__presentPage = {
      isEdited,
      lookKey,
      saved,
      frames: () => items.map((f) => ({ name: f.name, held: f.glb !== null, index: f.index })),
    };
  }
  // The look is read, not watched: a field, a key or a drag in the view ends in one of these.
  for (const type of ['input', 'change', 'keyup', 'pointerup']) document.addEventListener(type, check, true);
  window.addEventListener('bozzetto:look-restored', check);
  window.setInterval(check, 1500);
  // The baseline is the look as it stands once the first frames are drawn.
  await viewer()?.whenFramesDrawn(2).catch(() => undefined);
  saved.look = lookKey();
  refreshReadout();
  layoutShell();
  return viewer();
}
