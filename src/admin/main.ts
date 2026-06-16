import { api } from './api';
import type { ProjectSummary } from './api';

/**
 * Editor shell (Phase 3 foundation). Lists projects and supports create/delete
 * against the Access-gated admin API. Frame upload + in-browser OBJ→GLB
 * conversion, the lighting editor, stages, and the 3D preview build on top of
 * this in the per-project editor next.
 */
const root = document.getElementById('admin');
if (!root) throw new Error('#admin element not found');

function fromHTML(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
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
          <a class="btn" target="_blank" rel="noopener">Open</a>
          <button class="btn btn--danger" type="button">Delete</button>
        </div>
      </div>`);

    row.querySelector<HTMLElement>('.admin-row__title')!.textContent = p.title || p.id;
    row.querySelector<HTMLElement>('.admin-row__meta')!.textContent =
      `${p.id} · ${p.mode} · ${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}`;
    row
      .querySelector<HTMLAnchorElement>('a')!
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

function mount(): void {
  root!.innerHTML = `
    <div class="admin">
      <header class="admin__head">
        <h1>Bozzetto editor</h1>
        <a class="admin__home" href="/">← Gallery</a>
      </header>
      <form class="admin-create" id="create-form">
        <input name="id" placeholder="project-id" required
               pattern="[a-z0-9][a-z0-9-]*" title="lowercase letters, digits, hyphens" />
        <input name="title" placeholder="Title" />
        <select name="mode">
          <option value="timelapse">Timelapse</option>
          <option value="model">Model</option>
        </select>
        <input name="fps" type="number" value="4" min="1" max="30" step="1" title="fps" />
        <button type="submit" class="btn btn--primary">Create</button>
      </form>
      <div class="admin-list" id="project-list"></div>
    </div>`;

  const list = root!.querySelector<HTMLElement>('#project-list')!;
  const form = root!.querySelector<HTMLFormElement>('#create-form')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const input = {
      id: String(data.get('id') ?? '').trim(),
      title: String(data.get('title') ?? '').trim(),
      mode: String(data.get('mode') ?? 'timelapse'),
      fps: Number(data.get('fps') ?? 4),
    };
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = true;
    try {
      await api.create(input);
      form.reset();
      await refresh(list);
    } catch (err) {
      alert(`Create failed: ${(err as Error).message}`);
    } finally {
      submit.disabled = false;
    }
  });

  void refresh(list);
}

mount();
