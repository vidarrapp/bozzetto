import { api } from './api';
import type { ProjectSummary } from './api';
import { renderEditor } from './editor';
import { initTheme, mountThemeToggle } from '../ui/theme';

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
      <a class="admin__home" href="/">← Gallery</a>
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
      alert(`Create failed: ${(err as Error).message}`);
      submit.disabled = false;
    }
  });

  await refresh(list);
}

async function refresh(listEl: HTMLElement): Promise<void> {
  listEl.textContent = 'Loading…';
  let projects: ProjectSummary[];
  try {
    projects = await api.list();
  } catch (err) {
    listEl.textContent = `Failed to load projects: ${(err as Error).message}`;
    return;
  }

  listEl.innerHTML = '';
  if (projects.length === 0) {
    listEl.appendChild(fromHTML('<p class="admin__empty">No projects yet. Create one above.</p>'));
    return;
  }

  for (const p of projects) {
    const row = fromHTML(`
      <div class="admin-row">
        <div class="admin-row__main">
          <span class="admin-row__title"></span>
          <span class="admin-row__meta"></span>
        </div>
        <div class="admin-row__actions">
          <a class="btn btn--primary admin-row__edit">Edit</a>
          <a class="btn" target="_blank" rel="noopener">Open</a>
          <button class="btn btn--danger" type="button">Delete</button>
        </div>
      </div>`);

    row.querySelector<HTMLElement>('.admin-row__title')!.textContent = p.title || p.id;
    row.querySelector<HTMLElement>('.admin-row__meta')!.textContent =
      `${p.id} · ${p.mode} · ${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}`;
    row
      .querySelector<HTMLAnchorElement>('.admin-row__edit')!
      .setAttribute('href', `?p=${encodeURIComponent(p.id)}`);
    row
      .querySelector<HTMLAnchorElement>('a:not(.admin-row__edit)')!
      .setAttribute('href', `/?tl=${encodeURIComponent(p.id)}`);

    const del = row.querySelector<HTMLButtonElement>('button')!;
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${p.id}"? This also removes its uploaded meshes.`)) return;
      del.disabled = true;
      try {
        await api.remove(p.id);
        await refresh(listEl);
      } catch (err) {
        alert(`Delete failed: ${(err as Error).message}`);
        del.disabled = false;
      }
    });

    listEl.appendChild(row);
  }
}

initTheme();
mountThemeToggle();
const projectId = new URLSearchParams(window.location.search).get('p');
if (projectId) void renderEditor(root, projectId);
else void renderList(root);
