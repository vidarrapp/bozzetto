import type { SculptSession } from './SculptSession';
import type { SnapshotRecorder } from './SnapshotRecorder';
import type { SavedScene, SceneLink } from './ScenePersist';
import type { LookState } from '../../viewer/Viewer';
import { packScene, sceneToOBJ, unpackScene } from './SceneFile';
import {
  cacheProjectScene,
  defaultSceneName,
  deleteLibraryScene,
  findSentCopy,
  getLibraryEntry,
  keepUnsent,
  saveToLibrary,
  type LibraryEntry,
} from './SceneLibrary';
import { uploadScene } from './SceneProjects';
import { libraryProjects, uploadFailure, type UploadFailure } from '../../admin/api';

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
  /** The scene as it stands, as a token onSceneClean can be handed later. */
  cleanPoint(): unknown;
  /**
   * What is on screen now matches a file: a save, a completed open, a fresh
   * start. `at` is a cleanPoint() taken earlier: an upload that took a
   * while marks clean only what it sent, not strokes made while it ran.
   */
  onSceneClean(at?: unknown): void;
  /** A picture of the viewport, for a library card. */
  captureThumb(): Promise<Blob>;
  /**
   * In Present mode, the view and the look as a project's manifest blocks,
   * for Save to library to write beside the file; null otherwise.
   */
  presentation?(): Record<string, unknown> | null;
  /** The project link changed, so the autosave record has to learn it. */
  onLinkChange?(link: SceneLink | null): void;
  /** The scene's unsent copy changed (FileActions.unsentCopy): the same, for that. */
  onUnsentChange?(id: string | null): void;
}

/**
 * Save to library could not upload the scene, and kept it on this device
 * instead: `kept` is that copy, null when even that failed (`keepError`
 * says why). `reason` is which way the upload went wrong, since each wants
 * its own next step: sign in again, wait for a connection, make room, or
 * read what the server said (`why`). `place` is where it was going, as a
 * sentence names it: Projects, or My projects.
 */
export class NotUploadedError extends Error {
  constructor(
    readonly reason: UploadFailure,
    readonly why: Error,
    readonly kept: LibraryEntry | null,
    readonly keepError: Error | null = null,
    readonly place = 'Projects',
  ) {
    super(why.message);
  }
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/** A link as the scene keeps it: its own copy, with the scope only where there is one. */
const copyLink = (link: SceneLink | null): SceneLink | null =>
  link ? { id: link.id, title: link.title, ...(link.scope ? { scope: link.scope } : {}) } : null;

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
  /**
   * The server project this scene was opened from or last saved to, which
   * is where Save to library writes when signed in - the web's counterpart
   * of the desktop document's path. Kept in memory here and in the
   * autosave record (SavedScene.project), never in a .bozz file.
   */
  private linked: SceneLink | null = null;
  /**
   * The copy a failed Save to library left on the shelf for this scene
   * (SceneLibrary.keepUnsent), while it is this scene's: the next failure
   * replaces it rather than adding a card per attempt, and the next save
   * that does upload removes it, its place taken by the project's copy.
   * Rides the autosave record beside the link, so a sign-in round trip
   * comes back knowing it.
   */
  private unsent: string | null = null;
  private uploading = false;
  /**
   * Bumped whenever the scene is replaced (New, Open). An upload started
   * before that must not, when it lands, link the scene now on screen to
   * the project it uploaded - the next save would overwrite that project
   * with unrelated work.
   */
  private generation = 0;

  constructor(
    private readonly session: SculptSession,
    private readonly recorder: SnapshotRecorder,
    private readonly hooks: FileActionHooks,
  ) {}

  hasWork(): boolean {
    return this.hooks.hasWork();
  }

  get link(): SceneLink | null {
    return this.linked;
  }

  /** True while an upload to Projects is running. */
  isUploading(): boolean {
    return this.uploading;
  }

  /** Point the scene at a project (or at none), and tell the autosave. */
  setLink(link: SceneLink | null): void {
    if (link?.id === this.linked?.id && link?.title === this.linked?.title && link?.scope === this.linked?.scope) return;
    this.linked = copyLink(link);
    this.hooks.onLinkChange?.(this.linked);
  }

  /**
   * The link the boot scene came with (the autosave's, a library copy's, an
   * opened project's), taken without telling anyone: the record it came
   * from already says so.
   */
  adoptLink(link: SceneLink | null): void {
    this.linked = copyLink(link);
  }

  /** The id of this scene's unsent copy on the shelf, or null. */
  get unsentCopy(): string | null {
    return this.unsent;
  }

  /** Point the scene at its unsent copy (or at none), and tell the autosave. */
  private setUnsent(id: string | null): void {
    if (id === this.unsent) return;
    this.unsent = id;
    this.hooks.onUnsentChange?.(id);
  }

  /** The boot scene's unsent copy, taken as adoptLink takes its link. */
  adoptUnsent(id: string | null): void {
    this.unsent = id;
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
    this.generation++;
    // A new scene is nobody's project: saving it must not overwrite one.
    // Nor is the old one's unsent copy its own; that stays on the shelf.
    this.setLink(null);
    this.setUnsent(null);
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
   * no. `link` is the project the bytes came from; a file has none, so it
   * is saved as a project of its own rather than over the last one.
   */
  async replaceWith(
    bytes: ArrayBuffer,
    ask?: () => boolean | Promise<boolean>,
    link: SceneLink | null = null,
  ): Promise<boolean> {
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
    this.generation++;
    this.setLink(link);
    this.setUnsent(null);
    if (scene.look && this.hooks.look) await this.hooks.look.apply(scene.look);
    this.hooks.onSceneClean();
    return true;
  }

  /** Objects and triangles, as a library card or a scene project counts them. */
  private counts(): { objects: number; tris: number } {
    const meshes = this.session.getMeshes();
    return { objects: meshes.length, tris: meshes.reduce((n, m) => n + m.getNbTriangles(), 0) };
  }

  /** The card's picture; a card without one beats no entry. */
  private async thumb(): Promise<Blob | undefined> {
    try {
      return await this.hooks.captureThumb();
    } catch {
      return undefined;
    }
  }

  /**
   * Put the scene on the device's shelf. Same bytes as a saved file, so a
   * library entry can be exported later without converting anything.
   * Unlike a save this does NOT mark the scene clean: the work is still
   * live in the browser, and the autosave still owns it.
   */
  async keepOnDevice(): Promise<LibraryEntry> {
    const scene = this.serialize();
    const counts = this.counts();
    return saveToLibrary(scene, { thumb: await this.thumb(), ...counts });
  }

  /**
   * Save to library for whoever is signed in: upload the scene as a project
   * (or re-save the one it came from, in place) - to the owner's Projects
   * with accounts off, to the account's own My projects with them on
   * (SceneProjects) - then keep a device copy under the project's id: what
   * an offline open falls back to. The scene now exists off the device, so
   * like a saved file it is marked clean, as of the moment it was packed.
   *
   * An upload that fails never loses the save: the same bytes are kept on
   * the shelf, marked unsent so the card offers the upload again, and a
   * NotUploadedError says why - an expired sign-in, no connection, a full
   * quota, or the server's refusal - and what was kept. That copy is not a
   * save: the scene still counts as unsaved, and the autosave still owns it.
   */
  async uploadToProjects(onProgress?: (text: string) => void): Promise<SceneLink> {
    if (this.uploading) throw new Error('Already saving to Projects');
    this.uploading = true;
    try {
      const generation = this.generation;
      const at = this.hooks.cleanPoint();
      // Where the scene goes, read before anything waits: a scene opened
      // while this one packs must not send these bytes to its project.
      let target = this.linked;
      const unsent = this.unsent;
      const scene = this.serialize();
      const presentation = this.hooks.presentation?.() ?? undefined;
      const counts = this.counts();
      const thumb = await this.thumb();
      onProgress?.('Packing the scene...');
      const bytes = await (await packScene(scene)).arrayBuffer();
      // The copy a failed save kept may have gone up from its card since:
      // then this scene is that project's, and re-saves it.
      if (!target && unsent) {
        const sent = await findSentCopy(unsent);
        if (sent?.projectId) {
          target = { id: sent.projectId, title: sent.name, ...(sent.scope ? { scope: sent.scope } : {}) };
          if (generation === this.generation) this.setLink(target);
        }
      }
      // A scene that waited on the shelf may have been renamed there; a new
      // project takes that name rather than a fresh "Sculpt <date>".
      const waiting = !target && unsent ? await getLibraryEntry(unsent) : null;
      const title = target?.title ?? waiting?.name ?? defaultSceneName();
      const scope = target?.scope;
      let link: SceneLink;
      try {
        link = await uploadScene({ bytes, thumb, title, projectId: target?.id, scope, presentation, ...counts }, onProgress);
      } catch (err) {
        const why = asError(err);
        let kept: LibraryEntry | null = null;
        let keepError: Error | null = null;
        try {
          kept = await keepUnsent({ id: unsent, name: title, bytes, thumb, uploadTo: target?.id, scope, ...counts });
          if (generation === this.generation) this.setUnsent(kept.id);
        } catch (keepErr) {
          keepError = asError(keepErr);
        }
        const place = await this.place(scope).catch(() => 'Projects');
        throw new NotUploadedError(uploadFailure(err), why, kept, keepError, place);
      }
      // A full device is no reason to report a save the server has as failed.
      await cacheProjectScene(link.id, { name: link.title, bytes, thumb, scope: link.scope, ...counts }).catch(() => undefined);
      // The copy an earlier failure kept is in Projects now, newer than it was.
      if (unsent && unsent !== link.id) await deleteLibraryScene(unsent);
      if (generation === this.generation) {
        this.setLink(link);
        this.setUnsent(null);
        this.hooks.onSceneClean(at);
      }
      return link;
    } finally {
      this.uploading = false;
    }
  }

  /**
   * Where Save to library puts this scene, as a sentence names it: My
   * projects with accounts on, Projects with them off or for a scene opened
   * through the owner tools (SceneLink.scope).
   */
  async place(scope = this.linked?.scope): Promise<string> {
    return (await libraryProjects(scope)).place;
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
