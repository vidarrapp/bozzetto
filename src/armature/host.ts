import type { LookState, Viewer } from '../viewer/Viewer';
import type { Studio } from '../studio/Studio';

/**
 * What the Sculpt page gives Armature, a workspace of it (docs/plans/armature-workspace.md, step C).
 *
 * Armature's code is loaded the first time the workspace is entered (workspace.ts), and
 * everything it needs of the page comes through this: the shell it is hosted by, the address's
 * parameters for an armature, the page's way to apply a look and to make a figure. Nothing in it
 * names a Sculpt internal, so the module can be loaded after the page has started.
 */
export interface ArmatureHost {
  viewer: Viewer;
  /** The page's one shell: strip, menus, edge column, details, Material and Reference. */
  studio: Studio;
  /**
   * What the address asked Armature to open (`?armature=1&project=` or `&template=`), read by the
   * page and handed over once: the open token (ui/openToken) is taken by whoever reads first.
   */
  address: { project: string | null; template: string | null; scope: 'admin' | undefined; sentHere: string | null };
  /** Apply a look as the scene's, without the material hooks reading it as an edit. */
  applyLook(look: LookState): Promise<void>;
  /** Remesh the posed mannequin to a figure at this resolution: one new object, one undo step. False when it did not happen. */
  remesh(resolution: number): Promise<boolean>;
  /** The material the mannequin has until it is given its own: the scene's first material, the clay of a new object. */
  mannequinSurface(): { albedo: string; roughness: number; metalness: number };
  /** The mannequin's name, eye or material changed in a way the page's panels show (the Scene row, the Material tab). */
  changed(): void;
  /** Whether a figure has been made from the mannequin (it then shows only in Armature). */
  figureMade(): boolean;
  /** The Resolution both Remesh to a figure controls (the Armature tab's and the Model tab's) read and write. */
  figure: { resolution: number };
  /** File > Close from Armature: the page's own way out (its scene written, the gallery next). */
  leaveForGallery(): void;
}
