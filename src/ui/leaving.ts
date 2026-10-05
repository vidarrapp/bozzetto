/**
 * Leaving the page on purpose, with the work stored first.
 *
 * Two things take a page away from the work on it and bring it straight
 * back: signing in again (ui/signIn: through the Access login and back) and
 * reloading onto an update (ui/serviceWorker). The work crosses either the
 * way it crosses a reload. A mode registers what must be written before the
 * page goes - Sculpt its autosave, Armature its save - and the page that
 * comes back restores from there, the scene's project link with it.
 */

/**
 * Write what the page holds that is not stored yet. Resolves false when
 * something could not be, which would be lost by leaving.
 */
type Store = () => Promise<boolean>;

const stores = new Set<Store>();

/** Have `store` run before the page leaves on purpose. Returns the undo. */
export function beforeLeaving(store: Store): () => void {
  stores.add(store);
  return () => {
    stores.delete(store);
  };
}

/**
 * Store everything registered, and say whether the page may go: true when
 * all of it was stored, or when, told that the newest work was not, the
 * person chose to go anyway. `why` finishes the question - what leaving
 * means here, and the question itself ("signing in means leaving the page.
 * Leave anyway?").
 */
export async function readyToLeave(why: string): Promise<boolean> {
  const stored = await Promise.all([...stores].map((store) => store().catch(() => false)));
  if (!stored.includes(false)) return true;
  return confirm(
    `The newest work on this page could not be stored on this device, and ${why} ` +
      'Cancel, then File > Save file, keeps a copy.',
  );
}
