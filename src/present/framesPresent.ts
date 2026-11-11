import '../sculpt/ui/shell.css';
import type { Viewer } from '../viewer/Viewer';
import { HttpSource } from '../viewer/AssetSource';
import { mountViewerParts } from '../viewer/mountViewer';
import type { Manifest } from '../types/manifest';
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
import { onTap } from '../ui/dom';
import { helpMenuItems } from '../help/menu';
import { TitleStrip, stripButton } from '../sculpt/ui/TitleStrip';
import { TopMenu } from '../sculpt/ui/TopMenu';
import { failNotice, statusToast } from '../sculpt/ui/statusToast';
import { viewMenuItems } from '../sculpt/ui/viewMenu';
import { layoutShell } from '../sculpt/ui/shellLayout';
import { ProjectPanel } from './ProjectPanel';
import { OutputPanel } from './OutputPanel';

/**
 * Present for a published frame project (mode `timelapse` or `model`), the
 * owner's workspace for its look and settings (owner decision, 2026-11-11):
 * `/?tl=<id>&present=1`. It is the page's viewer and Render panel under
 * Sculpt's shell - the title strip, folder tabs and panels (sculpt/ui) -
 * with Project at the left, Render and Output at the right, and the
 * transport at the foot. Opened only for the owner (open.ts).
 *
 * One Save writes what Save look and Save settings and Save stages wrote in
 * the editor (admin/projectEdit.ts): the look, with the settings and the
 * stages that changed, in the one call the editor's own use. The strip says
 * "Edited" after the title while something is not saved.
 */

/** Where the gallery is, whatever the address says (as main.ts's own link). */
const GALLERY = '/';

export interface FramesPresentOptions {
  id: string;
  project: EditorProject;
  manifest: Manifest;
  viewport: HTMLElement;
  onStatus?: (msg: string) => void;
}

/** What was last saved, to tell what changed. */
interface Saved {
  title: string;
  visibility: Visibility;
  fps: number;
  stages: Stage[];
  look: string;
}

export async function mountFramesPresent(opts: FramesPresentOptions): Promise<Viewer> {
  const { id, project, manifest } = opts;
  const timelapse = manifest.mode === 'timelapse' && manifest.config.frameCount > 1;
  const parts = await mountViewerParts(opts.viewport, manifest, new HttpSource(manifestUrl(id)), opts.onStatus, {
    shell: true,
    preserveDrawingBuffer: true,
  });
  const { viewer, transport } = parts;
  document.body.classList.add('bz-frames');

  // --- the working copy, and what was saved ---------------------------------
  const stages0 = normalizeStages(project.stages ?? []);
  const title0 = project.title || id;
  const saved: Saved = {
    title: title0,
    visibility: project.visibility === 'private' ? 'private' : 'public',
    fps: project.config?.fps ?? manifest.config.fps,
    stages: stages0,
    look: '',
  };
  const lookKey = (): string => {
    // The camera's place is a view, not an edit: orbiting does not make the page Edited
    // (a save still writes where the camera stands, as the editor's Save look does).
    const look = lookPatch(viewer);
    const { position: _p, target: _t, ...camera } = (look.camera ?? {}) as Record<string, unknown>;
    return JSON.stringify({ ...look, camera });
  };

  // --- the strip ---------------------------------------------------------------
  const strip = new TitleStrip();
  let projectPanel: ProjectPanel;
  let saving = false;

  const isEdited = (): boolean => {
    const v = projectPanel.values;
    return (
      v.title.trim() !== saved.title ||
      v.visibility !== saved.visibility ||
      (timelapse && v.fps !== saved.fps) ||
      (timelapse && !sameStages(v.stages, saved.stages)) ||
      lookKey() !== saved.look
    );
  };
  let wasEdited = false;
  const refreshReadout = (frame = viewer.timeline.frameIndex()): void => {
    const edited = isEdited();
    wasEdited = edited;
    const v = projectPanel.values;
    const at = timelapse ? viewer.timeline.stageAt(frame) : null;
    strip.setReadout({
      name: v.title.trim() || id,
      edited,
      extras: [
        timelapse
          ? { key: 'Timelapse', value: `${manifest.config.frameCount} frames` }
          : { key: 'Model', value: '' },
        ...(timelapse ? [{ key: 'Stage', value: at?.name || null }] : []),
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

  // --- panels ----------------------------------------------------------------------
  projectPanel = new ProjectPanel(
    { title: title0, visibility: saved.visibility, fps: saved.fps, stages: stages0 },
    {
      timelapse,
      frameAt: () => viewer.timeline.frameIndex(),
      seek: (frame) => viewer.scrubTo(frame),
      stagesChanged: (stages) => {
        viewer.setStages(normalizeStages(stages));
        transport?.syncStages();
        refreshReadout();
      },
      fpsChanged: (fps) => viewer.setFps(fps),
      edited: check,
      useFrame: () => useThisFrame(),
    },
  );
  const output = new OutputPanel(viewer, { timelapse, title: () => projectPanel.values.title.trim() || id });
  strip.setWorkspace('present', {
    armature: { unavailable: 'This project has no sculpt scene' },
    sculpt: { unavailable: 'This project has no sculpt scene' },
  });

  // The frame moves: the transport has the viewer's hook, so this rides on it.
  const frameHook = viewer.onFrame;
  viewer.onFrame = (n) => {
    frameHook?.(n);
    projectPanel.syncFrame(n);
    refreshReadout(n);
  };
  // The editor's own preview did this after a thumbnail: the frame on show.
  const useThisFrame = async (): Promise<void> => {
    const status = statusToast('Saving the card picture...');
    try {
      const was = viewer.timeline.playing;
      viewer.pause();
      // Let the render loop show the frame before the canvas is read.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await api.uploadThumb(id, await viewer.captureThumbnail());
      if (was) viewer.play();
      status.done('Card picture saved');
    } catch (err) {
      status.fail(`Could not save the card picture: ${failureText(err)}`);
    }
  };

  // --- save and close ---------------------------------------------------------------
  const saveBtn = stripButton('Save', true);
  saveBtn.setAttribute('aria-label', 'Save');
  strip.publishHost.prepend(saveBtn);

  const save = async (): Promise<boolean> => {
    if (saving) return false;
    const v = projectPanel.values;
    const title = v.title.trim();
    if (!title) {
      failNotice('Give the project a title before saving');
      return false;
    }
    saving = true;
    saveBtn.disabled = true;
    const status = statusToast('Saving...');
    const stages = normalizeStages(v.stages);
    const look = lookKey();
    const patch: Record<string, unknown> = { ...lookPatch(viewer) };
    if (title !== saved.title) patch.title = title;
    if (v.visibility !== saved.visibility) patch.visibility = v.visibility;
    if (timelapse && v.fps !== saved.fps) patch.fps = v.fps;
    if (timelapse && !sameStages(stages, saved.stages)) patch.stages = stages;
    try {
      await api.update(id, patch);
    } catch (err) {
      // Nothing is lost: every edit is still here, and Save tries again.
      status.fail(`Could not save: ${failureText(err)}`);
      return false;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
    Object.assign(saved, { title, visibility: v.visibility, fps: v.fps, stages, look });
    viewer.manifest.title = title;
    if (timelapse) projectPanel.setStages(stages);
    status.done('Saved');
    refreshReadout();
    return true;
  };
  onTap(saveBtn, () => void save());

  const close = async (): Promise<void> => {
    if (isEdited()) {
      const yes = await askWindow({
        title: 'Close without saving?',
        text: 'The changes since the last save will be lost.',
        yes: 'Close without saving',
      });
      if (!yes) return;
    }
    leaving = true;
    window.location.href = GALLERY;
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
      { label: 'Save', action: () => void save() },
      { separator: true },
      { label: 'Close', action: () => void close() },
    ],
    'file-menu--file',
    strip.menus,
    true,
  );
  new TopMenu(
    'View',
    viewMenuItems({
      panels: [
        ['project', 'Project'],
        ['settings', 'Render'],
        ['output', 'Output'],
      ],
      hideInterface: () => chrome.set(true),
    }),
    'file-menu--view',
    strip.menus,
    true,
  );
  new TopMenu('Help', helpMenuItems(), 'file-menu--help', strip.menus, true);
  strip.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => strip.setChromeHidden(hidden);

  // Project on the left and Output on the right stand open, as drawn; Render is a tab away.
  projectPanel.setCollapsed(false);
  output.setCollapsed(false);

  // --- what is Edited ----------------------------------------------------------------
  // A handle for the tests and the console: whether the page is Edited, and what its look was.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    (window as unknown as { __presentPage?: object }).__presentPage = { isEdited, lookKey, saved };
  }
  // The look is read, not watched: a field, a key or a drag in the view ends in one of these.
  for (const type of ['input', 'change', 'keyup', 'pointerup']) document.addEventListener(type, check, true);
  window.addEventListener('bozzetto:look-restored', check);
  window.setInterval(check, 1500);
  // The baseline is the look as it stands once the first frames are drawn.
  await viewer.whenFramesDrawn(2).catch(() => undefined);
  saved.look = lookKey();
  refreshReadout();
  layoutShell();
  return viewer;
}
