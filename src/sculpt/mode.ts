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
  loadSavedScene,
  clearSculptLook,
  loadSculptLook,
  saveSculptLook,
  saveSculptSnapshot,
} from './bridge/ScenePersist';
import { SnapshotRecorder } from './bridge/SnapshotRecorder';
import { WorldScaleBrush } from './bridge/worldScale';
import { TransformGizmo, type GizmoMode } from './bridge/transform';
import { MaterialLibrary, type SculptMaterial } from './bridge/materials';
import { saveModelToGallery, saveTimelapseToGallery } from './bridge/GallerySave';
import { packScene, sceneToOBJ, unpackScene } from './bridge/SceneFile';
import { galleryForm } from './ui/galleryForm';
import { probeAdmin } from '../admin/api';
import { SculptToolbar } from './ui/SculptToolbar';
import { BrushSliders } from './ui/BrushSliders';
import { ScenePanel } from './ui/ScenePanel';
import { ChromeToggle } from './ui/ChromeToggle';
import { InputDebug } from './ui/InputDebug';
import { FilePanel } from './ui/FilePanel';
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
  let saved = await loadSavedScene();
  let multimesh;
  try {
    multimesh = saved ? session.restoreScene(saved) : session.addSphere();
  } catch (err) {
    // A malformed record must never brick sculpt entry: drop it, start clean.
    console.warn('sculpt restore failed, starting fresh:', err);
    void clearSavedScene();
    saved = null;
    multimesh = session.addSphere();
  }
  // The boot scene is the floor of history: its add-states must not be
  // undoable (ctrl+z or the rail buttons would delete restored objects).
  session.clearHistory();

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
  lighting.setEnabled('fill', false);
  lighting.setEnabled('rim', false);
  // Shadows on by default (review call): they read the form far better than
  // the flat key light did, and the frame cost is affordable now.
  lighting.setShadowsMaster(true);
  if (savedDof.enabled) viewer.setDoF({ enabled: false });
  viewer.onDofChange?.();
  viewer.scene.environment = null;
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
  // control - the defaults above are only meant for a first visit.
  await applyLookSafely(await loadSculptLook());
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
  let filePanel: FilePanel | null = null;
  let sculptPanel: SculptPanel | null = null;
  let modelPanel: ModelPanel | null = null;
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
        continue;
      }
      const extraSync = new GeometrySync();
      extraSync.bind(mesh);
      const handle = viewer.addSculptExtra(
        extraSync.geometry,
        new Matrix4().fromArray(mesh.getMatrix()),
      );
      handle.visible = mesh.isVisible();
      extras.set(mesh, { sync: extraSync, handle });
    }
    // The outliner eye: the vendor flag is the truth, the display follows.
    viewer.setSculptVisible(active ? active.isVisible() : true);
    // A newly added object still has SculptGL's white vertex colours.
    library.applyNew();
  };
  // The gizmo refuses hidden and locked objects: moving what you cannot see
  // (or deliberately froze) is never what a press meant.
  const gizmoTarget = (): SculptMesh | null => {
    const active = session.getMesh();
    return active && active.isVisible() && !session.isLocked(active) ? active : null;
  };

  // Dyntopo, undo and subdivision can swap the active mesh instance; follow it.
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

  // Opt-in hardware input log, for bugs that only exist on a real tablet.
  const inputDebug = new URLSearchParams(location.search).get('inputdebug') === '1'
    ? new InputDebug()
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
      viewer.frameBounds(liveWorldBox(active));
      // Framing re-centres deliberately, so it also resets what you orbit
      // around; otherwise the next drag would swing away from the framing.
      liveWorldBox(active).getCenter(pivot);
    },
    // Remember where the work was; do NOT move the view for it. The jump
    // after every stroke was the objectionable part, not the re-pivot.
    focusEdit: (point) => pivot.set(point[0], point[1], point[2]),
    // Once painted, an object owns its vertex colours: recolouring the
    // material must not wipe the strokes.
    transformMode: (mode) => enterTransform(mode),
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
    toggleShadows: () => {
      lighting.setShadowsMaster(!lighting.getShadowsMaster());
    },
    // Sideways swings the key light around the model, up/down raises it.
    // Elevation is clamped just shy of the poles, where azimuth stops
    // meaning anything and the light would appear to stick.
    moveKeyLight: (deltaAzimuth, deltaElevation) => {
      const key = lighting.state().find((l) => l.id === 'key');
      if (!key) return;
      let az = (key.azimuth + deltaAzimuth) % 360;
      if (az > 180) az -= 360;
      if (az < -180) az += 360;
      const el = Math.max(-20, Math.min(90, key.elevation + deltaElevation));
      lighting.setAngles('key', az, el);
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
    extractMasked: () => session.extractMasked(sculptPanel?.getExtractThickness() ?? 1),
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
  gizmo.onCommit = () => {
    persist.markDirty();
    sliders?.refreshHistory();
  };
  const enterTransform = (mode: GizmoMode): void => {
    if (gizmo.isActive() && mode !== 'all' && gizmo.getMode() === mode) return;
    gizmo.enter(mode, gizmoTarget());
    cursor.hide();
    toolbar.setTransformActive(true);
  };
  const exitTransform = (): void => {
    if (!gizmo.isActive()) return;
    gizmo.exit();
    toolbar.setTransformActive(false);
  };
  // On by default: a brush you can rely on is worth more than one that
  // rescales with the camera, and the screen-pixel behaviour is a tick away.
  // Enabled here (not by a field default) so the pinned world radius is
  // converted from the tool's starting pixel size at the entry distance.
  worldScale.setEnabled(true);
  input.install();
  // The log wants to know what the shell did with each pointer, not just
  // that one arrived: the two together tell a dropped Pencil event apart
  // from one we received and then discarded.
  input.setVerdictSink(inputDebug ? inputDebug.verdict : null);
  const recorder = new SnapshotRecorder(session);
  const toolbar = new SculptToolbar(input);
  toolbar.onToggleTransform = () => {
    if (gizmo.isActive()) exitTransform();
    else enterTransform('all');
  };
  toolbar.onToggleChrome = () => chrome.toggle();
  chrome.onChange = (hidden) => toolbar.setChromeHidden(hidden);
  sliders = new BrushSliders(input, {
    undo: () => session.undo(),
    redo: () => session.redo(),
    canUndo: () => session.canUndo(),
    canRedo: () => session.canRedo(),
  });
  filePanel = new FilePanel(session, recorder, {
    get: () => viewer.getLook(),
    apply: (look) => {
      void applyLookSafely(look).then(() => {
        sculptPanel?.refreshBrush();
        window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
      });
    },
  });
  /**
   * Brush workspace settings ride every saved scene: how the brushes are
   * set up is part of coming back to work, and a .bozz opened elsewhere
   * should feel like the session that made it.
   */
  const collectSettings = (): SculptSettings => ({
    worldScale: worldScale.isEnabled(),
    worldRadius: worldScale.isEnabled() ? worldScale.worldRadius() : undefined,
    dynamics: input.dynamics.serialize(),
    paintColor: paintColorOf(),
  });
  const applySettings = (settings: SculptSettings | undefined): void => {
    if (!settings) return;
    worldScale.restore(settings.worldScale, settings.worldRadius);
    input.dynamics.load(settings.dynamics);
    if (settings.paintColor) setPaintColorOn(settings.paintColor);
    input.refreshBrushCursor();
    sculptPanel?.refreshBrush();
  };

  // The mount restore: materials were applied when the library loaded (the
  // panels need them first); settings wait until here, where the world
  // scale and dynamics they describe exist to be written into.
  if (saved) applySettings(saved.settings);

  filePanel.decorate = (scene) => {
    library.saveInto(scene);
    scene.settings = collectSettings();
  };
  filePanel.adopt = (scene) => {
    library.loadFrom(scene);
    applySettings(scene.settings);
    session.render();
  };
  scenePanel = new ScenePanel(session, library);
  // Rename, eye and padlock bypass the undo stack: sync the display side
  // (visibility, the stats corner name) and let the autosave know directly.
  scenePanel.onSceneEdit = () => {
    reconcile();
    if (gizmo.isActive()) gizmo.attach(gizmoTarget());
    persist.markDirty();
    session.render();
  };
  sculptPanel = new SculptPanel(session, input, viewer);
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
  {
    const hooks = { thumbnail: () => viewer.captureThumbnail(), look: () => viewer.getLook() };
    const tlForm = galleryForm({
      buttonLabel: 'Publish timelapse',
      onSave: (id, title, progress) =>
        saveTimelapseToGallery(recorder, hooks, id, title, progress),
      recheck: probeAdmin,
    });
    const modelForm = galleryForm({
      buttonLabel: 'Publish model',
      onSave: (id, title, progress) =>
        saveModelToGallery(session, recorder, hooks, id, title, progress),
      recheck: probeAdmin,
    });
    filePanel.captureSlot.appendChild(tlForm.root);
    filePanel.filesSlot.appendChild(modelForm.root);
    void probeAdmin().then((email) => {
      tlForm.setAdmin(!!email);
      modelForm.setAdmin(!!email);
    });
  }

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
  persist.decorate = (scene) => {
    library.saveInto(scene);
    scene.settings = collectSettings();
  };
  persist.install();
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
  const toast = saved
    ? restoredToast(() => {
        persist.disable();
        void clearSavedScene().then(() => location.reload());
      })
    : null;

  // Console/debug handle, mirroring window.__bozzetto:
  //   __sculpt.session.getMesh().getNbVertices(), __sculpt.sync.stats, etc.
  (window as unknown as { __sculpt?: object }).__sculpt = {
    session,
    sync,
    input,
    persist,
    recorder,
    cursor,
    chrome,
    scenePanel,
    filePanel,
    sculptPanel,
    modelPanel,
    tablet: Tablet,
    library,
    // File pipeline, callable from the console/tests without the buttons.
    file: {
      pack: async () => {
        const scene = session.serializeScene();
        if (!scene) throw new Error('nothing to pack');
        scene.look = viewer.getLook(); // same payload the Save file button writes
        library.saveInto(scene); // ...and the same materials
        scene.settings = collectSettings();
        return (await packScene(scene)).arrayBuffer();
      },
      open: async (bytes: ArrayBuffer) => {
        const scene = await unpackScene(bytes);
        session.replaceScene(scene);
        library.loadFrom(scene); // same as the File panel's Open
        applySettings(scene.settings);
        if (scene.look) {
          await applyLookSafely(scene.look);
          window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
        }
      },
      /** Unpack without applying, for tests that inspect a record. */
      unpack: (bytes: ArrayBuffer) => unpackScene(bytes),
      toOBJ: () => sceneToOBJ(session),
    },
  };

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
    window.removeEventListener('pagehide', onLookHide);
    delete (window as unknown as { __sculpt?: object }).__sculpt;
    window.dispatchEvent(new CustomEvent('bozzetto:sculptmode', { detail: { active: false } }));
    toast?.remove();
    session.onLevelChange = null;
    levelToast.dispose();
    stats.dispose();
    gizmo.dispose();
    recorder.dispose(); // before persist: its wraps sit on top of persist's
    persist.dispose();
    sculptPanel?.dispose();
    modelPanel?.dispose();
    scenePanel?.dispose();
    filePanel?.dispose();
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
    chrome.dispose();
    sliders?.dispose();
    toolbar.dispose();
    input.dispose();
    cursor.dispose();
    session.onActiveMeshChange = null;
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

/** "Restored your sculpt" notice with a start-fresh escape hatch. */
function restoredToast(onFresh: () => void): HTMLDivElement {
  const toast = document.createElement('div');
  toast.className = 'sculpt-toast';
  const label = document.createElement('span');
  label.textContent = 'Restored your last sculpt';
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'sculpt-toast__btn';
  fresh.textContent = 'Start fresh';
  fresh.addEventListener('click', onFresh);
  toast.append(label, fresh);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 10000);
  return toast;
}

/** World-space box of the live vertex region (over-allocated tail excluded). */
function liveWorldBox(mesh: SculptMesh): Box3 {
  const v = mesh.getVertices();
  const n = mesh.getNbVertices() * 3;
  const box = new Box3();
  const p = new Vector3();
  for (let i = 0; i < n; i += 3) {
    box.expandByPoint(p.set(v[i], v[i + 1], v[i + 2]));
  }
  return box.applyMatrix4(new Matrix4().fromArray(mesh.getMatrix()));
}
