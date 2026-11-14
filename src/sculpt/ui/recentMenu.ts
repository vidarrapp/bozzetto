import { markOpen } from '../../ui/openToken';
import { KIND_LABEL, ago, clearRecent, dropRecent, listRecent, type Recent } from '../../ui/recent';
import type { MenuItem } from './TopMenu';
import { statusToast } from './statusToast';

/** Where a recent entry opens, in its own mode, by the same addresses the cards and Projects pages use. */
export function recentHref(r: Recent): string {
  const id = encodeURIComponent(r.id);
  const scope = r.scope === 'admin' ? '&scope=admin' : '';
  if (r.kind === 'armature') return `/?armature=1&project=${id}${scope}`;
  if (r.kind === 'present') return `/?tl=${id}&present=1`;
  if (r.kind === 'lib') return `/?sculpt=1&lib=${id}`;
  return `/?sculpt=1&project=${id}${scope}`;
}

/** Why an entry cannot be opened, or null when it can (or when this device can still open its own copy). */
async function whyNot(r: Recent): Promise<string | null> {
  try {
    const lib = await import('../bridge/SceneLibrary');
    if (r.kind === 'lib') return (await lib.getLibraryEntry(r.id)) ? null : 'it is no longer on this device';
    try {
      const { sceneManifest } = await import('../bridge/SceneProjects');
      await sceneManifest(r.id, r.scope);
      return null;
    } catch (err) {
      // A scene's copy on this device opens when the server cannot be asked.
      if (r.kind === 'scene' && (await lib.getLibraryEntry(r.id))) return null;
      return err instanceof Error ? err.message.replace(/\.$/, '') : String(err);
    }
  } catch {
    return null; // cannot tell: the open itself will say
  }
}

/**
 * Open one of the recent projects in its own mode: the question first when
 * work would be replaced, then a look that it is still there. One that is
 * gone is said so and leaves the list.
 */
export async function openRecent(r: Recent, hasWork: () => boolean): Promise<void> {
  if (hasWork() && !confirm(`Open "${r.name}"? The current work will be replaced.`)) return;
  const why = await whyNot(r);
  if (why) {
    dropRecent(r);
    statusToast('').fail(`"${r.name}" can no longer be opened: ${why}. It is off the recent list.`);
    return;
  }
  if (r.kind === 'scene') markOpen('project', r.id);
  else if (r.kind === 'lib') markOpen('lib', r.id);
  window.location.assign(recentHref(r));
}

/** File > Open recent: the list newest first, then Clear list. Greyed out while there is nothing on it. */
export function recentMenuItem(hasWork: () => boolean): MenuItem {
  return {
    label: 'Open recent',
    enabled: () => listRecent().length > 0,
    hint: () => (listRecent().length ? '' : 'Nothing opened yet'),
    submenu: () => [
      ...listRecent().map(
        (r): MenuItem => ({
          label: r.name,
          hint: `${KIND_LABEL[r.kind]} · ${r.place} · ${ago(r.at)}`,
          action: () => openRecent(r, hasWork),
        }),
      ),
      { separator: true },
      { label: 'Clear list', action: () => clearRecent() },
    ],
  };
}
