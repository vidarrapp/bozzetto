import { Box3, Color as ThreeColor, Euler, Matrix4, Quaternion, Sphere, Vector3 } from 'three';
import type { Viewer } from '../viewer/Viewer';
import { BrushCursor } from './bridge/BrushCursor';
import { CameraAdapter } from './bridge/CameraAdapter';
import { GeometrySync } from './bridge/GeometrySync';
import { InputShell } from './bridge/InputShell';
import Enums from '@sculpt-vendor/misc/Enums';
import Tablet from '@sculpt-vendor/misc/Tablet';
import { SculptSession } from './bridge/SculptSession';
import {
  ScenePersist,
  type SculptSettings,
  clearSavedScene,
  clearSculptFrames,
  loadSavedScene,
  clearSculptLook,
  loadSculptLook,
  saveSculptLook,
  saveSculptSnapshot,
} from './bridge/ScenePersist';
import type { SavedScene, SceneLink } from './bridge/ScenePersist';
import type { BrushSymmetry, SymmetryAxis } from './bridge/symmetry';
import { SnapshotRecorder, recordingAllowed } from './bridge/SnapshotRecorder';
import { WorldScaleBrush } from './bridge/worldScale';
import { TransformGizmo, type GizmoMode, type GizmoParts } from './bridge/transform';
import { MaterialLibrary, type SculptMaterial } from './bridge/materials';
import { saveModelToGallery, saveTimelapseToGallery } from './bridge/GallerySave';
import { packScene, unpackScene } from './bridge/SceneFile';
import { galleryForm } from './ui/galleryForm';
import { statusToast } from './ui/statusToast';
import { AuthExpiredError, checkSignIn, roleOf, type Role } from '../admin/api';
import { isDesktop } from '../net/origin';
import { beforeLeaving } from '../ui/leaving';
import {
  mountDesktop,
  setDocumentDirty,
  offerRecovery,
  clearRecovery as clearDesktopRecovery,
  showServerSettings,
  writeRecovery,
} from '../desktop';
import { SculptToolbar } from './ui/SculptToolbar';
import { BrushSliders } from './ui/BrushSliders';
import { ScenePanel } from './ui/ScenePanel';
import { ChromeToggle } from './ui/ChromeToggle';
import { InputDebug } from './ui/InputDebug';
import { PerfDebug } from './ui/PerfDebug';
import { perfLog } from '../viewer/perfLog';
import { CaptureWindow } from './ui/CaptureWindow';
import { FileMenu, reportNotUploaded } from './ui/FileMenu';
import { TopMenu } from './ui/TopMenu';
import { showPreferences } from '../ui/Preferences';
import { FileActions, type LookBridge } from './bridge/FileActions';
import { ModelPanel } from './ui/ModelPanel';
import { SculptPanel } from './ui/SculptPanel';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Turntable coast: only fast ticks glide, and only a little.
 *
 * Decay is per SECOND, not per frame. A per-frame factor makes the glide
 * last as long as the machine is slow - measured still drifting three
 * seconds after the last tick under a software renderer, because thirty
 * frames of decay took that long to arrive. Velocity is degrees per second
 * and both the step and the decay are scaled by real elapsed time.
 *
 * Total glide is v0 * TAU, so v0 is set to make that about 1.75 steps: enough
 * to read as the wheel easing to a stop, not enough to be a flywheel.
 */
const SPIN_COAST_MIN_DEG = 3;
const SPIN_COAST_AFTER_MS = 90;
const SPIN_TAU_S = 0.15;
const SPIN_COAST_TURNS = 1.75;
const SPIN_STOP_DEG_S = 2;
/**
 * Hard wall-clock deadline for the glide. The per-frame dt is clamped so a
 * stalled frame cannot fling the camera, but that clamp also slows the
 * DECAY when frames are scarce - which had the coast still drifting seconds
 * later on a software renderer. The deadline makes the end of the glide a
 * property of time rather than of frame rate.
 */
const SPIN_COAST_MAX_MS = 600;

/** Sculpt's clay: warmer and smoother than the viewer's neutral default. */
const SCULPT_ALBEDO = '#fed9a8';
const SCULPT_ROUGHNESS = 0.5;

/**
 * Mount sculpt mode into a running Viewer (plan section 5): build the vendored
 * editing session around Bozzetto's camera and canvas, adopt the sculpt mesh
 * as the scene subject, and arbitrate input ahead of OrbitControls.
 *
 * Mount defaults (plan 7.5, chosen for GPU cost): key light only, shadows
 * off, DoF off; the previous viewer state is restored on unmount. The default
 * sphere is ~50k triangles with its multiresolution stack available on
 * d / shift+d / ctrl+d.
 */
export async function mountSculptMode(viewer: Viewer): Promise<() => void> {
  const canvas = viewer.captureCanvas;
  const container = canvas.parentElement as HTMLElement;

  const camera = new CameraAdapter(viewer.camera, canvas);
  const session = new SculptSession(camera, canvas, () => {});
  // Reload safety: a saved session takes the sphere's place (ScenePersist).
  // A ?lib=<id> link from a gallery card outranks it, and so does a
  // ?project=<id> link to a scene in Projects - those are an explicit "open
  // this one", where the autosave is only "carry on where I was". A missing
  // or unreadable one falls back rather than failing the boot.
  const query = new URLSearchParams(window.location.search);
  const libId = query.get('lib');
  const projectId = query.get('project');
  let saved: SavedScene | null = null;
  // The project the boot scene belongs to, if any: where Save to library
  // writes again. Set by how the scene was opened, never read from a file.
  let bootLink: SceneLink | null = null;
  // The boot scene's unsent copy on the shelf (FileActions.unsentCopy): the
  // autosave's, or the entry itself when that is what was opened.
  let bootUnsent: string | null = null;
  let opened: ProjectOpen | null = null;
  if (projectId) {
    opened = await openProjectAtBoot(projectId);
    saved = opened.scene;
    bootLink = opened.link;
  } else if (libId) {
    const lib = await import('./bridge/SceneLibrary');
    saved = await lib.loadFromLibrary(libId);
    // A device copy of a project opens linked to it, so a save from here
    // updates that project rather than making a second one. So does an
    // unsent re-save, and a save that does upload takes its card's place.
    const entry = saved ? await lib.getLibraryEntry(libId) : null;
    const project = entry?.projectId ?? entry?.uploadTo;
    bootLink = entry && project ? { id: project, title: entry.name } : null;
    bootUnsent = entry?.unsent ? entry.id : null;
  }
  if (libId || projectId) {
    // The link has done its job. Left in the address bar, a reload - or
    // iOS relaunching the tab with the same URL - would open the untouched
    // shelf copy again and hide every autosaved edit made since behind it.
    const url = new URL(window.location.href);
    url.searchParams.delete('lib');
    url.searchParams.delete('project');
    history.replaceState(history.state, '', url);
  }
  // Whether the boot scene is one that was asked for, rather than the
  // autosave standing in for an open that failed.
  let openedExplicitly = !!saved;
  // An opened scene starts a reel of its own, as File > Open does: frames
  // recorded on the scene it replaces would otherwise run on into it, and
  // a publish must never mix two scenes' geometry. Cleared before the
  // recorder reads its store at install.
  if (openedExplicitly) await clearSculptFrames();
  // The desktop app starts clean (owner call): its work lives in files,
  // and a scene that was saved to one has no business coming back on its
  // own. The slot and the reel are cleared so the gallery's in-progress
  // card does not offer them either; a crash still leaves the recovery
  // sidecar, which is offered below as before.
  if (isDesktop() && !libId && !projectId) {
    await Promise.all([clearSavedScene(), clearSculptFrames()]);
  } else if (!saved) {
    saved = await loadSavedScene();
    bootLink = saved?.project ?? null;
    bootUnsent = saved?.unsent ?? null;
  }
  let multimesh;
  try {
    multimesh = saved ? session.restoreScene(saved) : session.addSphere();
  } catch (err) {
    // A malformed record must never brick sculpt entry: drop it, start clean.
    console.warn('sculpt restore failed, starting fresh:', err);
    void clearSavedScene();
    saved = null;
    bootLink = null;
    bootUnsent = null;
    opened = null;
    openedExplicitly = false;
    multimesh = session.addSphere();
  }
  // The boot scene is the floor of history: its add-states must not be
  // undoable (ctrl+z or the rail buttons would delete restored objects).
  session.clearHistory();

  // The perf log's entries carry the active object's size, so a slow write
  // or a stall can be read against how heavy the model was at the time.
  perfLog.triangles = () => session.getMesh()?.getNbTriangles() ?? 0;

  const sync = new GeometrySync();
  sync.bind(multimesh as unknown as SculptMesh);

  // The display mesh adopts the sculpt geometry (with the vendor mesh's
  // matrix: its normalizeSize scales by matrix, not by baking), so the whole
  // Render panel - material mode, albedo/roughness, matcaps, smooth/flat,
  // wireframe - drives the sculpt subject through the existing machinery.
  viewer.enterSculpt(
    sync.geometry,
    new Matrix4().fromArray(multimesh.getMatrix()),
    liveWorldBox(multimesh as unknown as SculptMesh),
    () => sync.wireGeometry(),
  );

  // View-follow lighting (review decision): the rig rides the camera orbit
  // as a delta from a REFERENCE view, approximating turning the model in
  // your hand - the underside is lit when you look at it from below. The
  // L-drag offset still composes on top.
  //
  // The reference is captured HERE, straight after enterSculpt framed the
  // model from the default three-quarter direction, because that is the
  // orientation the rig's default azimuth and elevation were authored
  // against. Capturing it later - after a restored look has moved the
  // camera - left the rig at its world default while the camera sat two
  // hundred degrees away, which put the key light behind the subject on
  // every re-entry.
  const camScratch = {
    prevPos: new Vector3(),
    prevQuat: new Quaternion(),
    dir: new Vector3(),
    eul: new Euler(),
    q: new Quaternion(),
    entryInv: new Quaternion(),
    delta: new Quaternion(),
  };
  const orbitQuat = (out: Quaternion): Quaternion => {
    viewer.camera.getWorldDirection(camScratch.dir);
    camScratch.dir.multiplyScalar(-1); // subject -> camera
    const azim = Math.atan2(camScratch.dir.x, camScratch.dir.z);
    const elev = Math.asin(Math.min(1, Math.max(-1, camScratch.dir.y)));
    return out.setFromEuler(camScratch.eul.set(-elev, azim, 0, 'YXZ'));
  };
  orbitQuat(camScratch.entryInv).invert();

  // Performance defaults (plan 7.5): one light, no DoF, no HDRI
  // environment sampling (the hemisphere ambient carries the fill; cheapest
  // possible IBL is none), and the cavity composite instead of GTAO. All
  // saved and restored around the session.
  const lighting = viewer.lighting;
  const savedLights = lighting.serialize();
  const savedDof = viewer.getDoFState();
  const savedEnv = viewer.scene.environment;
  const savedMaterial = viewer.materials.getMaterialState();
  const savedShadowsMaster = lighting.getShadowsMaster();
  const savedGround = viewer.getGround();
  const savedAO = viewer.getAOState();
  lighting.setEnabled('fill', false);
  lighting.setEnabled('rim', false);
  // Shadows on by default (review call): they read the form far better than
  // the flat key light did, and the frame cost is affordable now.
  lighting.setShadowsMaster(true);
  if (savedDof.enabled) viewer.setDoF({ enabled: false });
  viewer.onDofChange?.();
  viewer.scene.environment = null;
  // Said here rather than left to the Render panel, which reads the AO
  // model back from the look (Reset look returns to this, too).
  viewer.setAO({ enabled: false });
  viewer.setSculptShading(true);
  // Flat shading is the sculpt default; the panel checkbox drives it live.
  viewer.materials.setFlatShading(true);
  // Clay, not the viewer's neutral grey: warmer and less rough, which reads
  // form better under a single key light and suits what the app is for.
  // Sculpt-local, so a published project's own saved material is untouched.
  viewer.materials.setAlbedo(SCULPT_ALBEDO);
  viewer.materials.setRoughness(SCULPT_ROUGHNESS);
  // Albedo comes from the painted `color` attribute while sculpting. Vertex
  // colours start white, so every object is filled with the material colour
  // to read as that material - which is also the state a first paint stroke
  // paints on top of.
  viewer.materials.setSculptVertexColor(true);
  viewer.materials.setSculptVertexPBR(true);
  // Materials are per object now: a named set of albedo/roughness/metalness
  // written across a mesh's attributes, rather than one uniform for the
  // whole scene. The Render panel's controls drive the ACTIVE object's
  // material, so those sliders keep meaning what they look like they mean.
  const paintTool = (): { _color?: Float32Array } =>
    session.getSculptManager().getTool(Enums.Tools.PAINT);
  // Paint owns COLOUR ONLY. Upstream's Paint also writes roughness and
  // metalness from its own settings - which default to rough 0.3, metal
  // 0.95, so every stroke turned the clay mirror-shiny (owner bug report).
  // Bozzetto's surface response belongs to the object's material; the
  // vendor ships the off-switches, so use them.
  {
    const paint = session.getSculptManager().getTool(Enums.Tools.PAINT);
    paint._writeRoughness = false;
    paint._writeMetalness = false;
  }
  const paintColorOf = (): string => {
    const c = paintTool()._color;
    if (!c) return '#ffffff';
    return `#${new ThreeColor().setRGB(c[0], c[1], c[2]).getHexString()}`;
  };
  const setPaintColorOn = (hex: string): void => {
    const c = paintTool()._color;
    if (!c) return;
    const col = new ThreeColor(hex);
    c[0] = col.r;
    c[1] = col.g;
    c[2] = col.b;
  };
  const library = new MaterialLibrary(session);
  // A restored scene brings its own library and assignments. Applied here,
  // before the panels are built, so the first thing they show is right.
  if (saved) library.loadFrom(saved);
  const activeMaterial = (): SculptMaterial => {
    const active = session.getMesh();
    return active ? library.materialFor(active) : library.list()[0];
  };
  const pushActiveMaterial = (patch: Partial<Omit<SculptMaterial, 'id'>>): void => {
    library.update(activeMaterial().id, patch);
    session.render();
  };
  viewer.materials.onAlbedoChange = () => {
    if (syncingPanel) return;
    const albedo = viewer.materials.getMaterialState().albedo;
    if (albedo !== activeMaterial().albedo) pushActiveMaterial({ albedo });
  };
  /**
   * Push the active object's material into the Render panel's controls.
   * Those controls edit a material, and which material depends on what is
   * selected, so switching objects has to re-point them.
   */
  // True while the panel is being pointed at a different material. The
  // setters below fire the same change hooks a user edit does, and without
  // this the sync was read back as an edit and wrote the OUTGOING object's
  // colour onto the incoming object's material.
  let syncingPanel = false;
  /**
   * Apply a look (or re-point the panel) without the material hooks reading
   * it back as an edit. Materials.applyMaterialState goes through the same
   * setAlbedo/setRoughness/setMetalness a user drag does, so restoring a
   * look wrote the LOOK's material onto whichever object was selected -
   * which is how a reopened file came back with one object's colour on
   * another's material. The object's own material wins in sculpt mode, so
   * the panel is re-pointed at it afterwards.
   */
  // Declared ABOVE the look restore below: syncPanelMaterial touches it
  // during mount, and a later `let` is a temporal dead zone at that point
  // (found the hard way - the whole sculpt boot died on it).
  let modelPanel: ModelPanel | null = null;
  const applyLookSafely = async (look: Parameters<Viewer['applyLook']>[0]): Promise<void> => {
    syncingPanel = true;
    try {
      await viewer.applyLook(look);
    } finally {
      syncingPanel = false;
    }
    syncPanelMaterial();
  };
  const syncPanelMaterial = (): void => {
    const mat = activeMaterial();
    if (!mat) return;
    const mats = viewer.materials;
    syncingPanel = true;
    try {
      mats.setAlbedo(mat.albedo);
      mats.setRoughness(mat.roughness);
      mats.setMetalness(mat.metalness);
    } finally {
      syncingPanel = false;
    }
    window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    modelPanel?.refreshMaterial();
  };
  viewer.materials.onPbrChange = () => {
    if (syncingPanel) return;
    const st = viewer.materials.getMaterialState();
    const mat = activeMaterial();
    if (st.roughness !== mat.roughness || st.metalness !== mat.metalness) {
      pushActiveMaterial({ roughness: st.roughness, metalness: st.metalness });
    }
  };
  // No stage under a work in progress: the floor/pedestal hid the sculpt's
  // underside. g (or the panel) cycles it back on when wanted.
  viewer.setGround('off');
  // Snapshot the mount defaults BEFORE any saved look lands on top: this is
  // what "Reset look" goes back to, and it has to be captured here, while
  // the defaults above are still what the viewer is showing.
  const defaultLook = viewer.getLook();
  // ...and then, on top of those defaults, whatever the last session set up.
  // Without this, leaving sculpt mode and coming back reset every look-dev
  // control - the defaults above are only meant for a first visit. A scene
  // opened from a card or from Projects brings the look it was saved under
  // instead, as File > Open does with the same bytes.
  await applyLookSafely(openedExplicitly && saved?.look ? saved.look : await loadSculptLook());
  const onLookReset = (): void => {
    void (async () => {
      await clearSculptLook();
      await applyLookSafely(defaultLook);
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    })();
  };
  window.addEventListener('bozzetto:look-reset', onLookReset);

  // Multi-mesh (WS4): the ACTIVE mesh renders through the primary sync and
  // the viewer's display machinery; every other scene object gets its own
  // sync + extra display mesh sharing the primary's material. Reconciled on
  // every mesh-list or selection change (extract, add, dyntopo, undo).
  let scenePanel: ScenePanel | null = null;
  let captureWindow: CaptureWindow | null = null;
  let fileMenu: FileMenu | null = null;
  let editMenu: TopMenu | null = null;
  let sculptPanel: SculptPanel | null = null;
  let sliders: BrushSliders | null = null;
  const extras = new Map<
    SculptMesh,
    { sync: GeometrySync; handle: ReturnType<Viewer['addSculptExtra']> }
  >();
  const reconcile = (): void => {
    const active = session.getMesh();
    const list = session.getMeshes();
    for (const [mesh, e] of extras) {
      if (!list.includes(mesh) || mesh === active) {
        viewer.removeSculptExtra(e.handle);
        e.sync.dispose();
        extras.delete(mesh);
      }
    }
    for (const mesh of list) {
      if (mesh === active) continue;
      const existing = extras.get(mesh);
      if (existing) {
        viewer.setSculptExtraMatrix(existing.handle, new Matrix4().fromArray(mesh.getMatrix()));
        existing.handle.visible = mesh.isVisible();
        viewer.setSculptLocked(existing.handle, session.isLocked(mesh));
        continue;
      }
      const extraSync = new GeometrySync();
      extraSync.bind(mesh);
      const handle = viewer.addSculptExtra(
        extraSync.geometry,
        new Matrix4().fromArray(mesh.getMatrix()),
        () => extraSync.wireGeometry(),
      );
      handle.visible = mesh.isVisible();
      viewer.setSculptLocked(handle, session.isLocked(mesh));
      extras.set(mesh, { sync: extraSync, handle });
    }
    // The outliner eye and padlock: the vendor flag and the session's lock
    // set are the truth, the display follows (a locked object draws as if
    // fully masked).
    viewer.setSculptVisible(active ? active.isVisible() : true);
    viewer.setSculptLocked('primary', !!active && session.isLocked(active));
    // A newly added object still has SculptGL's white vertex colours.
    library.applyNew();
    syncHighlights();
  };
  /**
   * Selection outlines: on every selected object while the Select tool or
   * the gizmo is up, off while a brush is - a halo under the pen would
   * only get in the way of reading the surface.
   */
  // The shell and the gizmo are built after the first reconcile runs, so
  // the sync reads them through holders that start out saying "no".
  let highlightSources = { selecting: (): boolean => false, gizmoActive: (): boolean => false };
  const syncHighlights = (): void => {
    const show = highlightSources.selecting() || highlightSources.gizmoActive();
    const selected = new Set(session.getSelectedMeshes());
    const active = session.getMesh();
    viewer.highlightSculpt('primary', show && !!active && selected.has(active));
    for (const [mesh, e] of extras) viewer.highlightSculpt(e.handle, show && selected.has(mesh));
  };
  session.onSelectionChange = () => {
    scenePanel?.refresh();
    syncHighlights();
  };

  // The gizmo refuses hidden and locked objects: moving what you cannot see
  // (or deliberately froze) is never what a press meant.
  const gizmoTarget = (): SculptMesh | null => {
    const active = session.getMesh();
    return active && active.isVisible() && !session.isLocked(active) ? active : null;
  };

  /**
   * Solo (alt+q, or the Scene panel's Solo button and chip): the session
   * hides the other objects and keeps their eyes; the display, the gizmo
   * and the panel follow here. View state, so the autosave is not told.
   */
  const setSolo = (on: boolean): void => {
    if (on === session.isSolo()) return;
    session.setSolo(on);
    reconcile();
    if (gizmo.isActive()) gizmo.attach(gizmoTarget());
    scenePanel?.refresh();
  };

  // Dyntopo, undo and subdivision can swap the active mesh instance; follow it.
  // Two quick dabs at one spot are strokes, not a focus request: the
  // viewer's double-tap DoF lock stays off for the whole mode.
  viewer.tapToFocus = false;

  session.onActiveMeshChange = () => {
    const active = session.getMesh();
    if (active) {
      sync.bind(active);
      viewer.setSculptMatrix(new Matrix4().fromArray(active.getMatrix()));
    }
    reconcile();
    scenePanel?.refresh();
    sculptPanel?.refreshState();
    modelPanel?.refreshState();
    syncPanelMaterial();
    if (gizmo.isActive()) gizmo.attach(gizmoTarget());
  };
  reconcile();

  // A small transient pill announces level moves ("Subdiv 2/4"): steps,
  // ctrl+d, and undo/redo that land on another level. The palette's
  // Topology block shows the same numbers, so it follows along.
  const levelToast = makeLevelToast();
  session.onLevelChange = (sel, levels) => {
    levelToast.show(sel + 1, levels);
    modelPanel?.refreshTopology();
  };

  // Top-left stats: active object name + live triangle count (the name
  // column becomes the scene graph/outliner entry point later).
  const stats = makeStatsCorner(session);

  // Opt-in hardware input log, for bugs that only exist on a real tablet,
  // and the perf log's overlay, for freezes that only happen on one.
  const inputDebug = new URLSearchParams(location.search).get('inputdebug') === '1'
    ? new InputDebug()
    : null;
  const perfDebug = new URLSearchParams(location.search).get('perfdebug') === '1'
    ? new PerfDebug()
    : null;

  // Tab clears the interface for focused work; the toggle owns the ways back.
  const chrome = new ChromeToggle();

  const cursor = new BrushCursor(container);
  // The surface ring is projected SVG: crisp at any DPI on any backend.
  const projVec = new Vector3();
  cursor.setProjector((p) => {
    projVec.set(p[0], p[1], p[2]).project(viewer.camera);
    if (projVec.z > 1 || projVec.z < -1) return null;
    return [
      (projVec.x * 0.5 + 0.5) * container.clientWidth,
      (0.5 - projVec.y * 0.5) * container.clientHeight,
    ];
  });

  // The same tick re-projects the cursor when the camera moves under a
  // still pointer (wheel zoom).
  const followTick = (): void => {
    // Coast: once the ticks stop arriving, keep the spin going briefly and
    // let it decay. The gap check keeps this from double-counting while the
    // wheel is still feeding steps.
    if (spin.vel !== 0) {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - spin.lastFrame) / 1000));
      spin.lastFrame = now;
      if (now > spin.until) spin.vel = 0;
      else if (now - spin.lastTick > SPIN_COAST_AFTER_MS) {
        viewer.orbitAzimuthAbout(spin.centre, spin.vel * dt);
        spin.vel *= Math.exp(-dt / SPIN_TAU_S);
        if (Math.abs(spin.vel) < SPIN_STOP_DEG_S) spin.vel = 0;
      }
    }
    // History flags move through many routes (strokes, panel ops, keyboard,
    // buttons, restore); polling each frame is cheaper than wiring them all.
    sliders?.refreshHistory();
    const cam = viewer.camera;
    if (cam.position.equals(camScratch.prevPos) && cam.quaternion.equals(camScratch.prevQuat)) {
      return;
    }
    camScratch.prevPos.copy(cam.position);
    camScratch.prevQuat.copy(cam.quaternion);
    viewer.lighting.setRigFollow(
      camScratch.delta.copy(orbitQuat(camScratch.q)).multiply(camScratch.entryInv),
    );
    // A world-scale radius is a function of the camera, so it has to be
    // re-derived when the camera moves and not only when a pointer does:
    // a wheel zoom on a still pointer would otherwise leave the tool
    // holding the pixel radius from the old distance.
    worldScale.sync();
    cursor.refresh();
  };
  viewer.onTick = followTick;
  // After the controls, not before: onTick's camera is overwritten by
  // controls.update() later in the same frame.
  viewer.onPostControls = () => applyPivotOrbit();

  /**
   * Orbit around the last stroke instead of the middle of the view, without
   * the view jumping when the pivot moves.
   *
   * OrbitControls can only rotate about its own target, and moving that
   * target off the view axis necessarily swings the view - which is exactly
   * the jump to avoid. So the target is left alone and OrbitControls is used
   * purely as an input device: each frame of a drag, the rotation R it has
   * produced (the turn from the start offset to the current one) is re-applied
   * about the pivot instead. Rotating camera and target rigidly about P by
   * the same R IS a rotation about P, and since both move together the
   * controls' own spherical state is untouched, so nothing fights back and
   * damping, pinch and dolly all keep working.
   */
  const pivot = new Vector3();
  const UP = new Vector3(0, 1, 0);
  /**
   * The previous frame's corrected camera and target, while a drag is being
   * re-centred. The correction is INCREMENTAL - each frame it re-applies
   * only what the controls did in that frame - because the absolute form
   * (rebuild the whole state from the drag's first frame) silently ate
   * panning: a pan moves camera and target together, leaving the offset
   * unchanged, so the rotation derived from it was the identity and the
   * correction put the view straight back where the pan started.
   */
  let prev: { cam: Vector3; target: Vector3 } | null = null;
  /** How long the damped tail after a release stays re-centred. */
  const ORBIT_SETTLE_MS = 900;
  let orbitUntil = 0;

  const orbitScratch = {
    cam: new Vector3(),
    tgt: new Vector3(),
    off0: new Vector3(),
    off1: new Vector3(),
    pan: new Vector3(),
    outCam: new Vector3(),
    outTgt: new Vector3(),
    x: new Vector3(),
    y: new Vector3(),
    z: new Vector3(),
    m0: new Matrix4(),
    m1: new Matrix4(),
    r: new Matrix4(),
    q: new Quaternion(),
  };

  /**
   * The camera's no-roll world basis for a camera-to-target offset, which is
   * what fixes the rotation completely: OrbitControls keeps up at +Y, so the
   * offset alone determines the orientation. False when the offset is along
   * the up axis, where the basis is undefined (the controls clamp short of
   * it, so this is only a guard).
   */
  const basisOf = (off: Vector3, m: Matrix4): boolean => {
    const { x, y, z } = orbitScratch;
    z.copy(off).normalize();
    x.crossVectors(UP, z);
    if (x.lengthSq() < 1e-8) return false;
    x.normalize();
    y.crossVectors(z, x);
    m.makeBasis(x, y, z);
    return true;
  };

  /**
   * A frame is a reset: the orbit's settling tail must not read the jump
   * to the framing as one more increment of the drag and re-apply it
   * about the old pivot, which left an F pressed just after an orbit or a
   * pinch off-centre.
   */
  const endPivotOrbit = (): void => {
    prev = null;
    orbitUntil = 0;
  };

  const beginPivotOrbit = (): void => {
    orbitUntil = 0;
    const st = viewer.getCameraState();
    prev = {
      cam: new Vector3(st.position[0], st.position[1], st.position[2]),
      target: new Vector3(st.target[0], st.target[1], st.target[2]),
    };
  };

  const applyPivotOrbit = (): void => {
    if (!prev) return;
    if (orbitUntil > 0 && performance.now() > orbitUntil) {
      prev = null;
      orbitUntil = 0;
      return;
    }
    const sc = orbitScratch;
    const st = viewer.getCameraState();
    const cam = sc.cam.set(st.position[0], st.position[1], st.position[2]);
    const tgt = sc.tgt.set(st.target[0], st.target[1], st.target[2]);
    const off0 = sc.off0.subVectors(prev.cam, prev.target);
    const off1 = sc.off1.subVectors(cam, tgt);
    const d0 = off0.length();
    const d1 = off1.length();
    if (d0 < 1e-6 || d1 < 1e-6 || !basisOf(off0, sc.m0) || !basisOf(off1, sc.m1)) {
      prev.cam.copy(cam);
      prev.target.copy(tgt);
      return;
    }
    // Split the frame into the rotation the controls made and the pan they
    // made: a rotation leaves the target alone, so whatever the target moved
    // IS the pan, and it passes through untouched. Rebuilding the rotation
    // from the two bases (rather than a minimal arc between the offsets)
    // keeps it roll-free, which is what holds the pivot on screen.
    sc.q.setFromRotationMatrix(sc.r.multiplyMatrices(sc.m1, sc.m0.transpose()));
    const scale = d1 / d0;
    const pan = sc.pan.subVectors(tgt, prev.target);
    const place = (from: Vector3, out: Vector3): Vector3 =>
      out
        .copy(from)
        .sub(pivot)
        .applyQuaternion(sc.q)
        .multiplyScalar(scale)
        .add(pivot)
        .add(pan);
    viewer.setCameraState(place(prev.cam, sc.outCam), place(prev.target, sc.outTgt));
    prev.cam.copy(sc.outCam);
    prev.target.copy(sc.outTgt);
  };

  // Turntable (arrow keys / a wheel mapped to them). Two things separate it
  // from a drag-orbit: it always spins about the OBJECT's centre, never the
  // stroke pivot, so it stays a turntable wherever you have been working;
  // and a fast spin coasts briefly instead of stopping dead with the wheel.
  // vel is degrees per second; lastFrame is what makes the decay wall-clock.
  const spin = { vel: 0, lastTick: 0, lastFrame: 0, until: 0, centre: new Vector3() };
  const turntable = (deg: number): void => {
    const active = session.getMesh();
    if (active) liveWorldBox(active).getCenter(spin.centre);
    viewer.orbitAzimuthAbout(spin.centre, deg);
    // Only a genuinely fast tick leaves momentum behind; a single keypress
    // or a slow creep should stop exactly where it was put.
    spin.vel =
      Math.abs(deg) >= SPIN_COAST_MIN_DEG ? (deg * SPIN_COAST_TURNS) / SPIN_TAU_S : 0;
    spin.lastTick = performance.now();
    spin.lastFrame = spin.lastTick;
    spin.until = spin.lastTick + SPIN_COAST_MAX_MS;
  };

  const input = new InputShell(session, container, cursor, {
    frameModel: () => {
      const active = session.getMesh();
      if (!active) return;
      endPivotOrbit();
      viewer.frameBounds(liveWorldBox(active));
      // Framing re-centres deliberately, so it also resets what you orbit
      // around; otherwise the next drag would swing away from the framing.
      liveWorldBox(active).getCenter(pivot);
    },
    selectModeChanged: (on) => {
      toolbar.setSelectActive(on);
      sculptPanel?.refreshBrush();
      syncHighlights();
    },
    selectInRect: (rect) => {
      // An object is in the marquee when its projected world bound meets
      // the rectangle: the eight corners of the bound, through the camera,
      // in container pixels.
      const r = container.getBoundingClientRect();
      const hits: SculptMesh[] = [];
      for (const mesh of session.getMeshes()) {
        if (!mesh.isVisible()) continue;
        const b = mesh.computeWorldBound();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, infront = false;
        for (let i = 0; i < 8; i++) {
          const p = new Vector3(b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]).project(viewer.camera);
          if (p.z > 1) continue; // behind the camera
          infront = true;
          const sx = ((p.x + 1) / 2) * r.width;
          const sy = ((1 - p.y) / 2) * r.height;
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        }
        if (!infront) continue;
        if (maxX >= rect.x0 && minX <= rect.x1 && maxY >= rect.y0 && minY <= rect.y1) hits.push(mesh);
      }
      return hits;
    },
    deleteSelected: () => scenePanel?.deleteSelected(),
    mirrorSelected: () => scenePanel?.mirrorActive(session.getSymmetryAxis()),
    mergeSelected: () => scenePanel?.mergeSelected(),
    toggleSolo: () => setSolo(!session.isSolo()),
    stepObject: (dir, extend) => scenePanel?.step(dir, extend),
    frameAll: () => {
      const meshes = session.getMeshes().filter((m) => m.isVisible());
      if (meshes.length === 0) return;
      const box = liveWorldBox(meshes[0]);
      for (let i = 1; i < meshes.length; i++) box.union(liveWorldBox(meshes[i]));
      endPivotOrbit();
      viewer.frameBounds(box);
      box.getCenter(pivot);
    },
    // Remember where the work was; do NOT move the view for it. The jump
    // after every stroke was the objectionable part, not the re-pivot.
    focusEdit: (point) => pivot.set(point[0], point[1], point[2]),
    // Once painted, an object owns its vertex colours: recolouring the
    // material must not wipe the strokes.
    transformMode: (mode) => enterTransform(mode),
    transformToggle: () => toolbar.onToggleTransform?.(),
    transformExit: () => exitTransform(),
    markPainted: () => {
      const active = session.getMesh();
      if (active) library.markPainted(active);
    },
    orbitBegin: () => beginPivotOrbit(),
    // Not cleared on release: the controls keep easing for a while after the
    // finger lifts, and that damped tail has to stay re-centred too or it
    // undoes part of the correction.
    orbitEnd: () => {
      orbitUntil = performance.now() + ORBIT_SETTLE_MS;
    },
    orbitHalt: () => viewer.haltOrbit(),
    toggleShadows: () => {
      lighting.setShadowsMaster(!lighting.getShadowsMaster());
    },
    // Like toggleShadows above: sculpt mode does not hold the Render panel
    // (mountViewer owns it), and the panel re-reads its controls when it
    // opens, so the checkbox catches up there.
    toggleWireframe: () => {
      viewer.toggleWireframe();
    },
    // Sideways swings the key light around the model, up/down raises it
    // (Lighting.nudgeKey, which Armature mode's hold-L drag shares).
    moveKeyLight: (deltaAzimuth, deltaElevation) => {
      lighting.nudgeKey(deltaAzimuth, deltaElevation);
      // The Render panel's azimuth/elevation rows read their values once,
      // when built; without this the sliders kept showing wherever the
      // light was before the drag. One rebuild after the drag settles.
      clearTimeout(lightSyncTimer);
      lightSyncTimer = window.setTimeout(
        () => window.dispatchEvent(new CustomEvent('bozzetto:look-restored')),
        350,
      );
    },
    orbitY: (deltaDeg) => turntable(deltaDeg),
    dolly: (factor) => viewer.dolly(factor),
    toggleChrome: () => chrome.handleTab(),
    extractMasked: () => session.extractMasked(modelPanel?.getExtractThickness() ?? 1),
    toggleMaskTint: () => {
      viewer.materials.setSculptMaskTint(!viewer.materials.getSculptMaskTint());
    },
  });
  // World-scale brush sizing needs the three camera (for the fov) and the
  // orbit distance, neither of which the vendor session knows about.
  const worldScale = new WorldScaleBrush(
    session,
    viewer.camera,
    () =>
      viewer.camera.position.distanceTo(
        new Vector3(...(viewer.getCameraState().target as [number, number, number])),
      ),
    () => {
      const active = session.getMesh();
      if (!active) return 1;
      return Math.max(1e-3, liveWorldBox(active).getBoundingSphere(new Sphere()).radius);
    },
    () => input.brushInHand(),
  );
  input.worldScale = worldScale;

  /**
   * The transform gizmo (owner design): unified from the toolbar, one mode
   * from e/r/t, q to leave. It lives in the viewer's scene and writes into
   * the vendor mesh matrix, so persistence and undo see ordinary state.
   */
  let lightSyncTimer = 0;
  const gizmo = new TransformGizmo(session, viewer.camera, canvas, viewer.scene);
  input.transform = gizmo;
  highlightSources = { selecting: () => input.isSelecting(), gizmoActive: () => gizmo.isActive() };
  gizmo.onTransform = (mesh) => {
    const m = new Matrix4().fromArray(mesh.getMatrix());
    if (mesh === session.getMesh()) viewer.setSculptMatrix(m);
    else {
      const extra = extras.get(mesh as never);
      if (extra) viewer.setSculptExtraMatrix(extra.handle, m);
    }
    session.render();
  };
  gizmo.onDragState = (dragging) => {
    // The gizmo and the orbit share a pointer; only one may listen.
    viewer.setOrbitEnabled(!dragging);
  };
  // The rest of the selection moves with the active object (owner
  // request); hidden and locked objects stay put, as the active one would.
  gizmo.getCompanions = () =>
    session.getSelectedMeshes().filter((m) => m.isVisible() && !session.isLocked(m));
  gizmo.onCommit = () => {
    persist.markDirty();
    sliders?.refreshHistory();
  };
  const enterTransform = (mode: GizmoMode): void => {
    if (gizmo.isActive() && mode !== 'all' && gizmo.getMode() === mode) return;
    input.exitSelect();
    gizmo.enter(mode, gizmoTarget());
    cursor.hide();
    toolbar.setTransformActive(true);
    sculptPanel?.refreshBrush();
    syncHighlights();
  };
  const exitTransform = (): void => {
    if (!gizmo.isActive()) return;
    gizmo.exit();
    toolbar.setTransformActive(false);
    sculptPanel?.refreshBrush();
    syncHighlights();
  };
  // Which handles the gizmo shows is a workspace preference, kept per browser.
  try {
    const stored = localStorage.getItem('bozzetto-gizmo-parts');
    if (stored) gizmo.setParts(JSON.parse(stored) as Partial<GizmoParts>);
  } catch {
    // A blocked or corrupt store: every handle shows.
  }
  // On by default: a brush you can rely on is worth more than one that
  // rescales with the camera, and the screen-pixel behaviour is a tick away.
  // Begun here (not by a field default) so the pinned world radius is
  // converted from the tool's starting pixel size at the entry distance.
  worldScale.begin();
  input.install();
  // The log wants to know what the shell did with each pointer, not just
  // that one arrived: the two together tell a dropped Pencil event apart
  // from one we received and then discarded.
  input.setVerdictSink(inputDebug ? inputDebug.verdict : null);
  // And what the shell believes between events: a stroke still open, the
  // touches it counts as down, how long since the pen last spoke.
  inputDebug?.watch(input);
  const recorder = new SnapshotRecorder(session);
  const toolbar = new SculptToolbar(input);
  toolbar.onToggleTransform = () => {
    if (gizmo.isActive()) exitTransform();
    else enterTransform('all');
  };
  toolbar.onToggleSelect = () => input.toggleSelect();
  toolbar.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => toolbar.setChromeHidden(hidden);
  sliders = new BrushSliders(input, {
    undo: () => session.undo(),
    redo: () => session.redo(),
    canUndo: () => session.canUndo(),
    canRedo: () => session.canRedo(),
  });
  // How the file actions reach the viewer's look, so .bozz files carry it.
  const lookBridge: LookBridge = {
    get: () => viewer.getLook(),
    apply: async (look) => {
      await applyLookSafely(look);
      sculptPanel?.refreshBrush();
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    },
  };
  /**
   * Brush workspace settings ride every saved scene: how the brushes are
   * set up is part of coming back to work, and a .bozz opened elsewhere
   * should feel like the session that made it.
   */
  const collectSettings = (): SculptSettings => ({
    worldScale: worldScale.isEnabled(),
    worldRadius: worldScale.isEnabled() ? worldScale.worldRadius() : undefined,
    radius: worldScale.serializeSizes(),
    dynamics: input.dynamics.serialize(),
    paintColor: paintColorOf(),
    spacing: input.serializeSpacing(),
    alphas: input.serializeAlphas(),
    symmetry: session.symmetry.serialize(),
  });
  /**
   * What a scene from before per-brush symmetry sculpted with: its one
   * flag and the active object's mirror plane. Every brush starts from it.
   */
  const legacySymmetry = (scene: SavedScene): BrushSymmetry => {
    const n = scene.meshes[scene.active]?.sym;
    const axis: SymmetryAxis =
      Array.isArray(n) && n.length === 3
        ? Math.abs(n[1]) > Math.abs(n[0]) && Math.abs(n[1]) >= Math.abs(n[2])
          ? 'y'
          : Math.abs(n[2]) > Math.abs(n[0])
            ? 'z'
            : 'x'
        : 'x';
    return { on: scene.symmetry !== false, axis };
  };
  const applySettings = (scene: SavedScene | null): void => {
    const settings = scene?.settings;
    // Symmetry is per brush and always applied: with no settings at all
    // (a fresh scene, or a bare legacy record) the brushes take their
    // defaults, or the legacy scene's one flag and axis.
    session.symmetry.load(settings?.symmetry, scene ? legacySymmetry(scene) : undefined);
    session.applyBrushSymmetry(input.currentToolIndex());
    if (settings) {
      worldScale.restore(settings.worldScale, settings.worldRadius);
      worldScale.loadSizes(settings.radius);
      input.dynamics.load(settings.dynamics);
      input.loadSpacing(settings.spacing);
      input.loadAlphas(settings.alphas, settings.rakeAlpha);
      if (settings.paintColor) setPaintColorOn(settings.paintColor);
      input.refreshBrushCursor();
      sculptPanel?.refreshBrush();
    }
    // After the settings, and whatever the tool: the World-scale box has to
    // show the scale the scene came back in, and refreshBrush only re-reads
    // it while a brush is up, not the Select tool or the gizmo.
    sculptPanel?.refreshState();
  };

  // The mount restore: materials were applied when the library loaded (the
  // panels need them first); settings wait until here, where the world
  // scale and dynamics they describe exist to be written into.
  applySettings(saved);

  // "Is there work to lose?" - asked before anything replaces the scene.
  // A session restored from the autosave counts: it exists nowhere else.
  // Otherwise it is edits since the last clean point (a save, or an open),
  // compared by the undo stack's TOP ENTRY rather than its index, because a
  // full stack shifts and leaves the index standing.
  // A scene just opened from Projects exists there as it is: nothing to lose yet.
  let sceneOnDisk = !saved || !!opened?.from;
  let cleanState: unknown = session.getStateManager().getCurrentState();
  const markSceneClean = (at: unknown = session.getStateManager().getCurrentState()): void => {
    sceneOnDisk = true;
    cleanState = at;
  };
  const hasWork = (): boolean =>
    !sceneOnDisk ||
    session.getStateManager().getCurrentState() !== cleanState ||
    recorder.frameCount() > 0;
  // One implementation of File, behind the web menu, the desktop app's
  // native menu and the console handle alike.
  const fileActions = new FileActions(session, recorder, {
    look: lookBridge,
    decorate: (scene) => {
      library.saveInto(scene);
      scene.settings = collectSettings();
    },
    prepare: () => library.beginRestore(),
    abandon: () => library.endRestore(),
    adopt: (scene) => {
      library.loadFrom(scene);
      applySettings(scene);
      session.render();
    },
    hasWork,
    cleanPoint: () => session.getStateManager().getCurrentState(),
    onSceneClean: markSceneClean,
    // The library card wants the same picture the gallery's in-progress
    // card gets, taken at the moment you press Save rather than on the way out.
    captureThumb: () => viewer.captureThumbnail(480),
    // A new link must reach the autosave record (it rides the same put as
    // the geometry), or a reload would forget where Save to library goes.
    onLinkChange: () => persist.markDirty(),
    onUnsentChange: () => persist.markDirty(),
  });
  fileActions.adoptLink(bootLink);
  fileActions.adoptUnsent(bootUnsent);
  // The top row's File and Edit menus. The desktop app has native ones
  // over the same actions, so it goes without.
  if (!isDesktop()) {
    fileMenu = new FileMenu(fileActions);
    editMenu = new TopMenu(
      'Edit',
      [
        { label: 'Undo', action: () => session.undo() },
        { label: 'Redo', action: () => session.redo() },
        { separator: true },
        { label: 'Preferences…', action: () => showPreferences('sculpt') },
      ],
      'file-menu--edit',
    );
  }
  // Built after File and Edit so its chip lands beside them in the row.
  // The chip stays hidden until recording is known to be allowed here
  // (the role probe below; the desktop app straight away).
  captureWindow = new CaptureWindow(recorder);
  scenePanel = new ScenePanel(session, library);
  // Rename, eye and padlock bypass the undo stack: sync the display side
  // (visibility, the stats corner name) and let the autosave know directly.
  scenePanel.onSceneEdit = () => {
    reconcile();
    if (gizmo.isActive()) gizmo.attach(gizmoTarget());
    persist.markDirty();
    session.render();
  };
  scenePanel.onSolo = (on) => setSolo(on);
  sculptPanel = new SculptPanel(session, input, viewer);
  sculptPanel.onGizmoParts = (parts) => {
    try {
      localStorage.setItem('bozzetto-gizmo-parts', JSON.stringify(parts));
    } catch {
      // Not worth failing the tick over.
    }
  };
  modelPanel = new ModelPanel(session, viewer);
  // Both callbacks are single-slot and already claimed (the toolbar owns
  // onToolChange, the rail owns onBrushChange), so the palette chains onto
  // each rather than replacing it.
  {
    const prevToolChange = input.onToolChange;
    input.onToolChange = () => {
      prevToolChange?.();
      sculptPanel?.refreshBrush();
    };
    input.onPaintColorChange = () => sculptPanel?.refreshBrush();
    const prevBrushChange = input.onBrushChange;
    input.onBrushChange = () => {
      prevBrushChange?.();
      sculptPanel?.refreshBrushValues();
    };
  }

  // Gallery publishing (WS5): built for everyone, revealed only when the
  // admin probe confirms a Cloudflare Access session. Guests keep the
  // device-local outputs (autosave, scene file, OBJ) - nothing uploads.
  // The same answer decides what Save to library does.
  let ownerNow: boolean | null = null;
  const galleryHooks = { thumbnail: () => viewer.captureThumbnail(), look: () => viewer.getLook() };
  /** Who the page is for, by the latest probe; null before its first answer. */
  let role: Role | null = null;
  /**
   * Whether recording can go somewhere here (recordingAllowed), and so
   * whether the Capture chip shows: the desktop app from the start, the
   * web once the probe has said "signed in" in this session - or "signed
   * in, and the session has since expired", which is still the owner's
   * device: the reel waits for the sign-in, as it waits for one that lapses
   * mid-session. A later "guest" does not take it back.
   */
  let signedIn = false;
  const applyRecordingGate = (): void => {
    const allowed = recordingAllowed({ desktop: isDesktop(), signedIn });
    recorder.setAllowed(allowed);
    captureWindow?.setAvailable(allowed);
  };
  applyRecordingGate();
  // One answer for everything that follows the role: both forms, the File
  // menu and the recording gate. The forms' "re-check sign-in" runs the
  // same probe, so an admin whose Access session had lapsed at boot gets
  // the publish buttons (and Save to library's upload, and the Capture
  // chip) when they sign in. Capture itself still starts off until the
  // checkbox turns it on (owner call; see SnapshotRecorder.install).
  const probeRole = async (): Promise<string | null> => {
    const answer = await checkSignIn();
    role = roleOf(answer);
    ownerNow = !!answer.email;
    if (role !== 'guest') signedIn = true;
    tlForm.setRole(role);
    modelForm.setRole(role);
    fileMenu?.setRole(role);
    applyRecordingGate();
    return answer.email;
  };
  const tlForm = galleryForm({
    buttonLabel: 'Publish timelapse',
    onSave: (id, title, visibility, progress) =>
      saveTimelapseToGallery(recorder, galleryHooks, id, title, visibility, progress),
    recheck: probeRole,
  });
  const modelForm = galleryForm({
    buttonLabel: 'Publish model',
    onSave: (id, title, visibility, progress) =>
      saveModelToGallery(session, recorder, galleryHooks, id, title, visibility, progress),
    recheck: probeRole,
  });
  captureWindow.captureSlot.appendChild(tlForm.root);
  captureWindow.publishSlot.appendChild(modelForm.root);
  void probeRole();
  // A save that found the sign-in expired, or one that went through after
  // it had: the probe says which, for the forms and the menu alike.
  if (fileMenu) fileMenu.onSignInChange = () => void probeRole();
  // A guest on the web cannot reach the forms' re-check: it lives in the
  // Capture window, whose chip they do not have. Signing in happens
  // elsewhere (the gallery's Log in, /admin/ in another tab or app), and
  // the page is back in front afterwards, so that is when it asks again -
  // and so does an owner whose sign-in had expired.
  const onReturn = (): void => {
    if (document.visibilityState === 'visible' && role !== 'owner' && !isDesktop()) void probeRole();
  };
  document.addEventListener('visibilitychange', onReturn);

  /**
   * Keep the look with the session, so leaving sculpt mode and coming back
   * does not reset the lighting, AO, material and camera to the mount
   * defaults. The whole look is re-read wholesale rather than tracked
   * control by control: a change anywhere in a panel schedules a write, and
   * the moments we are certainly leaving (hide, gallery, unmount) force one,
   * which also catches the hotkeys that never fire an input event.
   */
  const storeLook = (): Promise<void> => saveSculptLook(viewer.getLook());
  let lookTimer = 0;
  const onLookInput = (e: Event): void => {
    if (!(e.target as HTMLElement | null)?.closest?.('.panel')) return;
    clearTimeout(lookTimer);
    clearTimeout(lightSyncTimer);
    lookTimer = window.setTimeout(() => void storeLook(), 400);
  };
  const onLookHide = (e: Event): void => {
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') void storeLook();
  };
  document.addEventListener('input', onLookInput, true);
  document.addEventListener('change', onLookInput, true);
  document.addEventListener('visibilitychange', onLookHide);
  window.addEventListener('pagehide', onLookHide);

  // Autosave from here on; if a session was restored, say so and offer a
  // way back to a clean sphere.
  const persist = new ScenePersist(session);
  // Autosave giving up must be visible: it used to disable itself on the
  // first storage hiccup with only a console line, and sculpting carried on
  // for hours saving nothing into a scene the user believed was safe. Said
  // on screen to everyone - a guest has no Capture window to read it in -
  // and kept in the window, beside the frames that take the storage.
  persist.onStopped = (reason) => {
    captureWindow?.showAutosaveStopped(reason);
    statusToast('Autosave stopped').fail(
      reason === 'quota'
        ? 'Autosave stopped: this device is out of storage. Save a file (File menu) to keep this work.'
        : 'Autosave stopped: this browser refused to store the scene. Save a file (File menu) to keep this work.',
    );
  };
  persist.decorate = (scene) => {
    library.saveInto(scene);
    scene.settings = collectSettings();
    // The project link rides the same put as the geometry, so the record
    // can never pair one scene with another's project (SavedScene.project).
    // So does the unsent copy a failed save left (SavedScene.unsent).
    if (fileActions.link) scene.project = { ...fileActions.link };
    if (fileActions.unsentCopy) scene.unsent = fileActions.unsentCopy;
  };
  persist.install();
  // A scene opened from a library card or from Projects replaces the one in
  // the autosave: write it, with its link, as soon as the grace allows, so
  // a reload before the first stroke comes back to it and not to whatever
  // the slot held before.
  if (openedExplicitly) persist.markDirty();
  // Materials and workspace settings ride the scene record, but nothing
  // about them is an EDIT, so they never marked the autosave dirty: create
  // a material, reload, and it was gone unless a stroke happened to follow.
  // Every mutation source reports in.
  const noteWorkspace = (): void => persist.markDirty();
  library.onChange = () => {
    scenePanel?.refresh();
    syncPanelMaterial();
    noteWorkspace();
  };
  worldScale.onChange = noteWorkspace;
  input.onBrushSettingsChange = noteWorkspace;
  // Timelapse capture stacks its edit hooks on top of the autosave's (the
  // unmount below unwinds in reverse). Install is async (frame index read).
  void recorder.install();
  // Only the autosave coming back on its own gets the notice, with Start
  // fresh as the way out of it. A scene opened from a library card or from
  // Projects is what was asked for: saying so, with an offer to throw it
  // away, only got in the way (owner call). The exception is a project
  // that opened from this device's copy because Projects could not be
  // reached, which says so, and why, with nothing to press.
  let toast: HTMLDivElement | null = null;
  if (saved && !openedExplicitly) {
    toast = bootToast(openedLabel(opened), () => {
      persist.disable();
      // The desktop sidecar mirrors the autosave; a fresh start that left
      // it behind would offer the abandoned scene back at the reload.
      void Promise.all([clearSavedScene(), clearDesktopRecovery()]).then(() =>
        location.reload(),
      );
    });
  } else if (saved && opened?.from === 'device') {
    toast = bootToast(openedLabel(opened));
  }
  // Asked for a project and got neither it nor a device copy: say why,
  // rather than leave the autosaved scene looking like the answer.
  if (opened && !opened.scene) {
    statusToast('Opening the project...').fail(`Could not open that project: ${opened.error}`);
  }

  // Console/debug handle, mirroring window.__bozzetto:
  //   __sculpt.session.getMesh().getNbVertices(), __sculpt.sync.stats, etc.
  // A figure sent over from the Armature mode (?handoff=1): voxelised here,
  // where the remesher lives, and added as an object. A scene with nothing
  // done to it yet (the default sphere) makes way for the figure.
  if (new URLSearchParams(window.location.search).get('handoff') === '1') {
    const { takeHandoff } = await import('../armature/persist');
    const handoff = await takeHandoff();
    if (handoff) {
      const untouched = !fileActions.hasWork();
      const added = session.addVoxelised(handoff.name, handoff.positions, handoff.indices, handoff.resolution);
      if (untouched) {
        for (const m of [...session.getMeshes()]) if (m !== added) session.deleteMesh(m);
      }
      persist.markDirty();
      viewer.frameBounds(liveWorldBox(added as unknown as SculptMesh));
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('handoff');
    history.replaceState(null, '', url);
  }

  const handle = {
    viewer,
    session,
    sync,
    input,
    persist,
    recorder,
    cursor,
    chrome,
    scenePanel,
    captureWindow,
    fileMenu,
    editMenu,
    fileActions,
    sculptPanel,
    modelPanel,
    tablet: Tablet,
    library,
    gizmo, // transform modes, for the console and the tests
    // File pipeline, callable from the console/tests without the menu.
    file: {
      pack: async () => (await fileActions.pack()).arrayBuffer(),
      open: async (bytes: ArrayBuffer) => {
        await fileActions.replaceWith(bytes);
      },
      /** Unpack without applying, for tests that inspect a record. */
      unpack: (bytes: ArrayBuffer) => fileActions.unpack(bytes),
      toOBJ: () => fileActions.objText(),
    },
  };
  (window as unknown as { __sculpt?: object }).__sculpt = handle;

  // --- the desktop shell -------------------------------------------------
  // Native File menu, window title and crash recovery, when running inside
  // Electron. Inert in a browser: mountDesktop returns null and nothing
  // below it runs. It reuses the same file pipeline the panel buttons and
  // the tests use, so there is one packing path, not two.
  const desktopHandle = mountDesktop({
    pack: () => fileActions.pack().then((b) => b.arrayBuffer()),
    load: async (bytes) => {
      await fileActions.replaceWith(bytes);
    },
    reset: () => fileActions.newScene(),
    hasWork,
    markClean: () => markSceneClean(),
    // Signed in to a server, Save to Library uploads to Projects as it does
    // on the web. Without one it keeps the scene on this device: the app's
    // storage is its own profile, not a browser's, and File > Save is right
    // beside it for a copy that leaves the machine.
    saveToLibrary: async () => {
      const owner = ownerNow ?? !!(await probeRole());
      if (!owner) {
        await fileActions.keepOnDevice();
        statusToast('Keeping on this device...').done('Kept on this device');
        return;
      }
      const status = statusToast('Saving to Projects...');
      try {
        const link = await fileActions.uploadToProjects((text) => status.set(text));
        status.done(`Saved to Projects: ${link.title}`);
      } catch (err) {
        reportNotUploaded(status, err, () => void probeRole());
      }
    },
    importObj: (text, zUp, name) => fileActions.importObj(text, zUp, name),
    objText: () => fileActions.objText(),
    undo: () => session.undo(),
    redo: () => session.redo(),
    showServerSettings: () => void showServerSettings(),
    showPreferences: () => showPreferences('sculpt'),
  });
  if (desktopHandle) {
    // The title's dirty dot and the close guard follow the same signal the
    // Open guard uses, sampled at every edit - not at the autosave write,
    // which lands seconds later and would leave a window closable with a
    // stroke it never asked about. Undo back to the clean point clears it.
    persist.onDirty = () => setDocumentDirty(hasWork());
    // Mirror each autosave to the crash sidecar. Same bytes as a .bozz
    // file, written atomically under userData - never through to the open
    // document, which would make Save meaningless and quitting-without-
    // saving impossible.
    persist.onWrote = (scene) => {
      void packScene(scene)
        .then((b) => b.arrayBuffer())
        .then(writeRecovery)
        .catch(() => undefined);
    };
    // A crash left a sidecar. It mirrors the autosave, so when IndexedDB
    // has just restored the same session there is nothing newer in it and
    // no question to ask; it is offered only when the autosave came back
    // empty - a cleared profile, or a store that could not be read.
    if (!saved) void offerRecovery(handle.file.open);
  }

  // Leaving for the gallery: remember what the work looked like, so the
  // landing page can offer it back as a card. The autosave already keeps the
  // geometry; this is only the picture and the counts that go with it.
  const snapshot = async (): Promise<void> => {
    try {
      const meshes = session.getMeshes();
      await saveSculptSnapshot({
        thumb: await viewer.captureThumbnail(480),
        savedAt: Date.now(),
        objects: meshes.length,
        tris: meshes.reduce((n, m) => n + m.getNbTriangles(), 0),
      });
    } catch {
      // Never block leaving the page over a thumbnail.
    }
  };
  const galleryLink = document.querySelector<HTMLAnchorElement>('.viewer-back');
  const onLeave = (e: MouseEvent): void => {
    if (!galleryLink || e.defaultPrevented || e.button !== 0) return;
    e.preventDefault();
    // The flush is what makes the card honest: the picture and the geometry
    // behind it must describe the same moment.
    void Promise.all([snapshot(), persist.flush(), storeLook()]).finally(() => {
      window.location.href = galleryLink.href;
    });
  };
  galleryLink?.addEventListener('click', onLeave);
  // Signing in again and reloading onto an update leave the page and come
  // back to it (ui/leaving): the scene goes as it goes to the gallery,
  // written and pictured first, and the autosave brings it back, link and
  // unsent copy included. A scene the store does not hold as it stands is
  // said before the page goes.
  const offLeaving = beforeLeaving(async () => {
    await Promise.all([snapshot(), storeLook()]);
    return persist.settle();
  });

  // The hotkey guide (H) swaps to the sculpt table while the mode is active.
  window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: true } }));

  return () => {
    // Before the viewer's own look is put back below, or the session's would
    // be recorded as whatever the viewer had before sculpt started.
    clearTimeout(lookTimer);
    window.removeEventListener('bozzetto:look-reset', onLookReset);
    void storeLook();
    document.removeEventListener('input', onLookInput, true);
    document.removeEventListener('change', onLookInput, true);
    document.removeEventListener('visibilitychange', onLookHide);
    document.removeEventListener('visibilitychange', onReturn);
    offLeaving();
    window.removeEventListener('pagehide', onLookHide);
    delete (window as unknown as { __sculpt?: object }).__sculpt;
    perfLog.triangles = null; // the session is going; the log keeps its entries
    desktopHandle?.(); // menu commands and OS opens stop reaching a dead scene
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false } }));
    toast?.remove();
    session.onLevelChange = null;
    levelToast.dispose();
    stats.dispose();
    gizmo.dispose();
    // Solo belongs to this visit, not to the scene: every object gets its
    // own eye back before the last autosave and the recorder let go.
    session.setSolo(false);
    recorder.dispose(); // before persist: its wraps sit on top of persist's
    persist.dispose();
    sculptPanel?.dispose();
    modelPanel?.dispose();
    scenePanel?.dispose();
    captureWindow?.dispose();
    fileMenu?.dispose();
    editMenu?.dispose();
    for (const [, e] of extras) {
      viewer.removeSculptExtra(e.handle);
      e.sync.dispose();
    }
    extras.clear();
    // The eye may have hidden the active object; the viewer's display mesh
    // outlives sculpt mode and must come back visible for playback.
    viewer.setSculptVisible(true);
    galleryLink?.removeEventListener('click', onLeave);
    inputDebug?.dispose();
    perfDebug?.dispose();
    chrome.dispose();
    sliders?.dispose();
    toolbar.dispose();
    input.dispose();
    cursor.dispose();
    session.onActiveMeshChange = null;
    session.onSelectionChange = null;
    input.exitSelect();
    viewer.tapToFocus = true;
    viewer.onTick = null;
    viewer.onPostControls = null;
    viewer.materials.onAlbedoChange = null;
    viewer.materials.onPbrChange = null;
    viewer.materials.setSculptVertexColor(false);
    viewer.materials.setSculptVertexPBR(false);
    lighting.setRigFollow(null);
    lighting.applyState(savedLights);
    lighting.setShadowsMaster(savedShadowsMaster);
    viewer.setGround(savedGround);
    viewer.environment.setRotation(lighting.getRigRotation());
    viewer.scene.environment = savedEnv;
    viewer.setSculptShading(false);
    viewer.setAO(savedAO);
    viewer.materials.applyMaterialState(savedMaterial);
    viewer.setDoF(savedDof);
    viewer.onDofChange?.();
    viewer.exitSculpt();
    sync.dispose();
  };
}

/** Top-left corner stats: object name + live poly count (polled, cheap). */
function makeStatsCorner(session: SculptSession): { dispose(): void } {
  const el = document.createElement('div');
  el.className = 'sculpt-stats';
  const name = document.createElement('div');
  name.className = 'sculpt-stats__name';
  const tris = document.createElement('div');
  tris.className = 'sculpt-stats__tris';
  el.append(name, tris);
  document.body.appendChild(el);
  const update = (): void => {
    const mesh = session.getMesh();
    name.textContent = session.activeName();
    tris.textContent = mesh ? `${mesh.getNbTriangles().toLocaleString('en-US')} tris` : '';
  };
  update();
  const timer = window.setInterval(update, 500);
  return {
    dispose() {
      clearInterval(timer);
      el.remove();
    },
  };
}

/** Transient "Subdiv 2/4" pill; repeated steps reuse it and reset the fade. */
function makeLevelToast(): { show(at: number, total: number): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'sculpt-leveltoast';
  document.body.appendChild(el);
  let timer = 0;
  return {
    show(at, total) {
      el.textContent = `Subdiv ${at}/${total}`;
      el.classList.add('is-visible');
      clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove('is-visible'), 1200);
    },
    dispose() {
      clearTimeout(timer);
      el.remove();
    },
  };
}

/** What a ?project= open came back with. */
interface ProjectOpen {
  scene: SavedScene | null;
  link: SceneLink | null;
  /** 'server' when fetched, 'device' for this device's copy, null for neither. */
  from: 'server' | 'device' | null;
  error?: string;
}

/**
 * /?sculpt=1&project=<id>: the scene project's file, fetched through the
 * media route with the Access session, and - for the owner - kept as this
 * device's copy of the project. When it cannot be had - offline, signed
 * out, deleted - the copy kept under the project's id by the last save or
 * open opens instead.
 */
async function openProjectAtBoot(id: string): Promise<ProjectOpen> {
  const lib = await import('./bridge/SceneLibrary');
  try {
    const { fetchSceneProject } = await import('./bridge/SceneProjects');
    const { bytes, project, owner } = await fetchSceneProject(id);
    const scene = await unpackScene(bytes);
    // The owner's copy follows the server, so offline opens the latest. A
    // guest opening a public scene gets no copy: nothing lands in their
    // storage that they did not put there. Best effort, and not awaited:
    // the open must not wait on a write.
    if (owner) {
      void lib
        .cacheProjectScene(project.id, {
          name: project.title,
          bytes,
          objects: project.scene?.objects ?? scene.meshes.length,
          tris: project.scene?.tris ?? 0,
        })
        .catch(() => undefined);
    }
    return { scene, link: { id: project.id, title: project.title }, from: 'server' };
  } catch (err) {
    console.warn('sculpt: could not open project', id, err);
    // Said after a colon, mid-sentence, where the error's own words start a notice.
    const error =
      err instanceof AuthExpiredError ? 'your sign-in has expired' : err instanceof Error ? err.message : String(err);
    const entry = await lib.getLibraryEntry(id);
    const scene = entry ? await lib.loadFromLibrary(id) : null;
    if (entry && scene) return { scene, link: { id, title: entry.name }, from: 'device', error };
    return { scene: null, link: null, from: null, error };
  }
}

/** The boot notice's words: the autosave back, or a project's device copy and why. */
function openedLabel(opened: ProjectOpen | null): string {
  // The reason, not a guess at it: offline, signed out and deleted all
  // land here, and each wants a different next step.
  if (opened?.from === 'device') {
    return `Opened this device's copy of "${opened.link?.title}": ${opened.error}`;
  }
  return 'Restored your last sculpt';
}

/**
 * The boot notice. With `onFresh` it carries Start fresh, the way out of
 * an autosave nobody asked to resume.
 */
function bootToast(text: string, onFresh?: () => void): HTMLDivElement {
  const toast = document.createElement('div');
  toast.className = 'sculpt-toast';
  const label = document.createElement('span');
  label.textContent = text;
  toast.append(label);
  if (onFresh) {
    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'sculpt-toast__btn';
    fresh.textContent = 'Start fresh';
    fresh.addEventListener('click', onFresh);
    toast.append(fresh);
  }
  document.body.appendChild(toast);
  // Ten seconds of being SEEN, not ten seconds from mount: the boot
  // overlay is still up when this is built, and on a slow device (or a
  // big restored scene) it could cover most of the toast's life - the
  // "Start fresh" escape hatch expiring before anyone laid eyes on it.
  const arm = (): void => {
    window.setTimeout(() => toast.remove(), 10000);
  };
  if (!document.getElementById('overlay')) {
    arm();
  } else {
    const watch = new MutationObserver(() => {
      if (document.getElementById('overlay')) return;
      watch.disconnect();
      arm();
    });
    watch.observe(document.documentElement, { childList: true, subtree: true });
  }
  return toast;
}

/** World-space box of the live vertex region (over-allocated tail excluded). */
function liveWorldBox(mesh: SculptMesh): Box3 {
  // The bound the vendor already maintains, not a fresh scan of every
  // vertex: the octree keeps a local AABB that strokes grow, and
  // computeWorldBound transforms it by the mesh matrix. This is called
  // three to six times per pointer event by the world-scale brush unit
  // (the size slider, a hold-b drag, the bracket keys) and once per
  // turntable tick, where an O(vertices) scan cost about a millisecond a
  // call on a subdivided sphere. The octree bound is LOOSE - it grows with
  // the geometry at once but only tightens on a full octree rebuild -
  // which is the right trade for a brush unit and a framing box.
  const b = mesh.computeWorldBound(); // the mesh's own scratch array
  return new Box3(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5]));
}
