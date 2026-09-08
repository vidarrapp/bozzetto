import type { SculptSession } from './SculptSession';
import type { SnapshotRecorder } from './SnapshotRecorder';
import type { SavedScene } from './ScenePersist';
import type { LookState } from '../../viewer/Viewer';
import { packScene, sceneToOBJ, unpackScene } from './SceneFile';
import { saveToLibrary } from './SceneLibrary';

/** How the file actions reach the viewer's look, so .bozz files carry it. */
export interface LookBridge {
  get(): LookState;
  /** Resolves once the look is on screen (the open path waits for it). */
  apply(look: LookState): Promise<void>;
}

/** What the sculpt mount lends the file actions. */
export interface FileActionHooks {
  look: LookBridge | null;
  /** Materials and workspace settings ride the record. */
  decorate(scene: SavedScene): void;
  /** Before the scene is replaced: the material library holds its fills. */
  prepare(): void;
  /** The replace threw after prepare(): undo what prepare() set up. */
  abandon(): void;
  /** After the scene is replaced: materials and settings, before anything reads them. */
  adopt(scene: SavedScene): void;
  /**
   * Is there work that exists nowhere else? A session restored from the
   * autosave, edits since the last save or open, or captured frames.
   */
  hasWork(): boolean;
  /** What is on screen now matches a file: a save, a completed open, a fresh start. */
  onSceneClean(): void;
  /** A picture of the viewport, for a library card. */
  captureThumb(): Promise<Blob>;
}

/**
 * Everything File means, with no dialogs in it.
 *
 * One implementation behind three fronts: the web page's File menu, the
 * desktop app's native File menu, and the console handle the tests drive.
 * Each front owns its own questions (a confirm(), a native Save / Don't
 * Save / Cancel) and its own way of moving bytes (a download sheet, a
 * file dialog); what happens to the scene is decided here, once.
 */
export class FileActions {
  constructor(
    private readonly session: SculptSession,
    private readonly recorder: SnapshotRecorder,
    private readonly hooks: FileActionHooks,
  ) {}

  hasWork(): boolean {
    return this.hooks.hasWork();
  }

  /** "The current objects and 3 captured frames": what a replace would cost. */
  atRisk(): string {
    const frames = this.recorder.frameCount();
    return frames > 0
      ? `The current objects and ${frames} captured frame${frames === 1 ? '' : 's'}`
      : 'The current objects';
  }

  /** The scene was just written somewhere: it is no longer at risk. */
  markClean(): void {
    this.hooks.onSceneClean();
  }

  /**
   * Start over from a clean sphere. The reel goes too: a timelapse of a
   * scene you just discarded is not much use, and a publish must never
   * mix two scenes' geometry.
   */
  async newScene(): Promise<void> {
    if (this.recorder.frameCount() > 0) await this.recorder.clear();
    this.session.newScene();
    this.hooks.onSceneClean();
  }

  /** The live scene as a record: objects, look, materials, settings. */
  serialize(): SavedScene {
    const scene = this.session.serializeScene();
    if (!scene) throw new Error('Nothing to save');
    // The look travels with the file: reopening it puts the work back
    // under the lighting, material and camera it was saved in.
    if (this.hooks.look) scene.look = this.hooks.look.get();
    this.hooks.decorate(scene);
    return scene;
  }

  /** The scene as .bozz bytes. */
  async pack(): Promise<Blob> {
    return packScene(this.serialize());
  }

  /** Read a .bozz file without applying it (tests inspect records this way). */
  unpack(bytes: ArrayBuffer): Promise<SavedScene> {
    return unpackScene(bytes);
  }

  /**
   * Replace the scene with a .bozz file's bytes. The file is unpacked
   * FIRST, so a corrupt one costs nothing - not the question, not the
   * frames. `ask` runs after that and before anything is touched: the
   * front's "are you sure?", when it has one. Resolves false when it said
   * no.
   */
  async replaceWith(bytes: ArrayBuffer, ask?: () => boolean | Promise<boolean>): Promise<boolean> {
    const scene = await unpackScene(bytes);
    if (ask && !(await ask())) return false;
    // A timelapse belongs to the scene it recorded: frames from the old
    // one must not ride along into the newly opened work.
    if (this.recorder.frameCount() > 0) await this.recorder.clear();
    this.hooks.prepare();
    try {
      this.session.replaceScene(scene);
    } catch (err) {
      this.hooks.abandon(); // the session rolled the old scene back; so do we
      throw err;
    }
    this.hooks.adopt(scene);
    if (scene.look && this.hooks.look) await this.hooks.look.apply(scene.look);
    this.hooks.onSceneClean();
    return true;
  }

  /**
   * Put the scene on the device's shelf. Same bytes as a saved file, so a
   * library entry can be exported later without converting anything.
   * Unlike a save this does NOT mark the scene clean: the work is still
   * live in the browser, and the autosave still owns it.
   */
  async saveToLibrary(): Promise<void> {
    const scene = this.serialize();
    const meshes = this.session.getMeshes();
    let thumb: Blob | undefined;
    try {
      thumb = await this.hooks.captureThumb();
    } catch {
      thumb = undefined; // a card without a picture beats no entry
    }
    await saveToLibrary(scene, {
      thumb,
      objects: meshes.length,
      tris: meshes.reduce((n, m) => n + m.getNbTriangles(), 0),
    });
  }

  /** The visible scene as Wavefront OBJ text. */
  objText(): string {
    return sceneToOBJ(this.session);
  }

  /**
   * Bring an OBJ in as a new sculptable object. `zUp` rotates DCC exports
   * (Blender and friends) to Y-up on the way in.
   */
  async importObj(text: string, zUp: boolean, name: string): Promise<void> {
    await this.session.importOBJ(text, zUp, name);
  }
}
