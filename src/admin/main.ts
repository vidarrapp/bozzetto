import { api, failureText, mediaPath } from './api';
import type { ProjectSummary } from './api';
import { renderEditor } from './editor';
import { initTheme, mountThemeToggle } from '../ui/theme';
import { followPanelOpacity } from '../ui/appearance';
import { installSliderBubble } from '../ui/sliderBubble';
import { topbarRight } from '../ui/topbar';
import { signOutChip } from '../ui/signIn';
import { isProjectId } from '../net/ids';
import { markOpen } from '../ui/openToken';

/**
 * Editor router. `/admin/?p=<id>` opens the per-project editor (frame upload,
 * preview, settings); with no `p` it shows the project list + create form.
 * Navigation uses plain links (full reload), so each view starts clean and the
 * preview's WebGL context is never leaked across views.
 */
const root = document.getElementById('admin');
if (!root) throw new Error('#admin element not found');

function fromHTML(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 63)
    .replace(/-+$/g, ''); // drop a hyphen left at the length cut
}

/** Create a project, deriving the id from the title and avoiding collisions. */
async function createWithSlug(title: string): Promise<{ id: string }> {
  const base = slugify(title) || 'project';
  for (let n = 1; n <= 50; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    try {
      return (await api.create({ id, title })) as { id: string };
    } catch (err) {
      if (!/already exists/i.test((err as Error).message)) throw err;
    }
  }
  throw new Error('Could not find an available id for that title');
}

async function renderList(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <div class="admin">
      <div class="topbar topbar--left"><a class="topchip" href="/">← Gallery</a></div>
      <header class="admin__head">
        <h1>Bozzetto editor</h1>
      </header>
      <form class="admin-create" id="create-form">
        <input name="title" placeholder="New project title" required autofocus />
        <button type="submit" class="btn btn--primary">Create</button>
      </form>
      <p class="admin__hint muted">The project id is derived from the title; you can set the frame rate and mode on the next page.</p>
      <div class="admin-list" id="project-list"></div>
    </div>`;

  const list = host.querySelector<HTMLElement>('#project-list')!;
  const form = host.querySelector<HTMLFormElement>('#create-form')!;
  // This page is only reached signed in (Access fronts it), so the way out
  // is always offered, beside the theme toggle.
  topbarRight().appendChild(signOutChip());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (!title) return;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = true;
    try {
      const created = await createWithSlug(title);
      // Straight into the new project's editor to add frames.
      window.location.search = `?p=${encodeURIComponent(created.id)}`;
    } catch (err) {
      alert(`Create failed: ${failureText(err)}`);
      submit.disabled = false;
    }
  });

  await refresh(list);
}

async function refresh(listEl: HTMLElement): Promise<void> {
  listEl.textContent = 'Loading…';
  let projects: ProjectSummary[];
  try {
    // The owner's list: private projects and scenes saved from Sculpt too.
    projects = await api.adminList();
  } catch (err) {
    listEl.textContent = `Failed to load projects: ${failureText(err)}`;
    return;
  }

  listEl.innerHTML = '';
  if (projects.length === 0) {
    listEl.appendChild(fromHTML('<p class="admin__empty">No projects yet. Create one above.</p>'));
    return;
  }

  for (const p of projects) {
    const scene = p.mode === 'scene';
    // A scene is a file to open in Sculpt; the editor is for frames.
    const actions = scene
      ? '<a class="btn btn--primary admin-row__open">Open in Sculpt</a>'
      : `<a class="btn btn--primary admin-row__edit">Edit</a>
          <a class="btn admin-row__view" target="_blank" rel="noopener">Open</a>`;
    const row = fromHTML(`
      <div class="admin-row">
        <div class="admin-row__thumb">
          <img class="admin-row__img" alt="" loading="lazy" />
        </div>
        <div class="admin-row__main">
          <span class="admin-row__title"></span>
          <span class="admin-row__meta"></span>
        </div>
        <div class="admin-row__actions">
          <label class="admin-row__vis" title="Private projects show only to you, signed in">
            <input type="checkbox" /> Private
          </label>
          ${actions}
          <button class="btn btn--danger admin-row__delete" type="button">Delete</button>
        </div>
      </div>`);

    row.dataset.project = p.id;
    const img = row.querySelector<HTMLImageElement>('.admin-row__img')!;
    img.src = mediaPath(p, `thumb.jpg?v=${p.updated_at}`);
    // No thumbnail yet (e.g. before any frames) → drop the <img>, show the placeholder.
    img.addEventListener('error', () => img.remove());

    row.querySelector<HTMLElement>('.admin-row__title')!.textContent = p.title || p.id;
    row.querySelector<HTMLElement>('.admin-row__meta')!.textContent = scene
      ? `${p.id} · scene · ${
          p.scene
            ? `${p.scene.objects} object${p.scene.objects === 1 ? '' : 's'} · ` +
              `${p.scene.tris.toLocaleString('en-US')} tris · ${(p.scene.bytes / (1024 * 1024)).toFixed(1)} MB`
            : 'upload did not finish'
        }`
      : `${p.id} · ${p.mode} · ${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}`;

    if (scene) {
      const open = row.querySelector<HTMLAnchorElement>('.admin-row__open')!;
      open.href = `/?sculpt=1&project=${encodeURIComponent(p.id)}`;
      // Opening replaces the sculpt in progress on this device, as a
      // gallery card does - so the same question, when there is one.
      open.addEventListener('click', (e) => {
        e.preventDefault();
        void (async () => {
          const store = await import('../sculpt/bridge/ScenePersist').catch(() => null);
          const busy = store ? (await store.hasSavedScene()) || (await store.hasSculptFrames()) : false;
          if (busy && !confirm(`Open "${p.title}"? Your work in progress in Sculpt will be replaced.`)) return;
          // Asked, or nothing to ask about: Sculpt need not ask again (ui/openToken).
          markOpen('project', p.id);
          window.location.href = open.href;
        })();
      });
    } else {
      row
        .querySelector<HTMLAnchorElement>('.admin-row__edit')!
        .setAttribute('href', `?p=${encodeURIComponent(p.id)}`);
      row
        .querySelector<HTMLAnchorElement>('.admin-row__view')!
        .setAttribute('href', `/?tl=${encodeURIComponent(p.id)}`);
    }

    const vis = row.querySelector<HTMLInputElement>('.admin-row__vis input')!;
    vis.checked = p.visibility === 'private';
    vis.addEventListener('change', async () => {
      vis.disabled = true;
      try {
        const updated = await api.setVisibility(p.id, vis.checked ? 'private' : 'public');
        p.visibility = updated.visibility;
      } catch (err) {
        vis.checked = p.visibility === 'private';
        alert(`Could not change who sees "${p.title || p.id}": ${failureText(err)}`);
      } finally {
        vis.disabled = false;
      }
    });

    const del = row.querySelector<HTMLButtonElement>('.admin-row__delete')!;
    del.addEventListener('click', async () => {
      const question = scene
        ? `Delete "${p.title || p.id}"? It goes from Projects and from this device.`
        : `Delete "${p.id}"? This also removes its uploaded meshes.`;
      if (!confirm(question)) return;
      del.disabled = true;
      try {
        await api.remove(p.id);
        if (scene) {
          // Its device copy too, or it would come back in the gallery as a
          // scene kept only on this device.
          const lib = await import('../sculpt/bridge/SceneLibrary').catch(() => null);
          await lib?.deleteLibraryScene(p.id);
        }
        await refresh(listEl);
      } catch (err) {
        alert(`Delete failed: ${failureText(err)}`);
        del.disabled = false;
      }
    });

    listEl.appendChild(row);
  }
}

initTheme();
followPanelOpacity();
mountThemeToggle();
  installSliderBubble();
// An id from the address goes into request paths: one that is not an id
// (net/ids) opens nothing, and the list stands in.
const projectId = new URLSearchParams(window.location.search).get('p');
if (isProjectId(projectId)) void renderEditor(root, projectId);
else void renderList(root);
