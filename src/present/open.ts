import { api, checkSignIn, roleOf } from '../admin/api';
import type { EditorProject } from '../admin/projectEdit';
import { mountWorkspace } from './workspace';

/**
 * The route `/?tl=<id>&present=1` (main.ts): Present for a published frame
 * project, for the owner only. Loaded by a dynamic import, so the public
 * viewer's bundle does not carry it.
 *
 * The gate is the owner's own session and the owner's API, as the editor
 * has them (admin/api.ts): the sign-in probe must say owner, and the
 * project must read through /admin/api/projects/:id. Not signed in, not
 * the owner, not a frame project, or any refusal at all, is `false`, and
 * the caller shows the ordinary viewer: this page never asks for a
 * sign-in and never shows an error page for want of one. Once the gate is
 * passed a failure is a real one, and throws.
 */
export async function openPresent(
  id: string,
  viewport: HTMLElement,
  onStatus?: (msg: string) => void,
  tab?: string | null,
): Promise<boolean> {
  try {
    if (roleOf(await checkSignIn()) !== 'owner') return false;
  } catch {
    return false;
  }
  let project: EditorProject;
  try {
    project = (await api.get(id)) as EditorProject;
  } catch {
    // The owner's second lock shut, a project that is not there, no network: the viewer says it.
    return false;
  }
  // A scene or an armature opens where it was made; only frames are played here.
  if (project?.mode !== 'timelapse' && project?.mode !== 'model') return false;
  if (!Array.isArray(project.frames)) return false;
  // A project made but not yet given frames (the Projects list's Create) opens on its Frames tab, empty.
  onStatus?.(project.mode === 'model' ? 'Loading model…' : 'Loading timelapse…');
  await mountWorkspace({
    viewport,
    project: { id, data: project },
    tab: tab === 'frames' || project.frames.length === 0 ? 'frames' : tab === 'project' ? 'project' : undefined,
    onStatus,
  });
  return true;
}
