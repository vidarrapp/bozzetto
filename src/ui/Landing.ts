/**
 * Landing gallery. Lists projects from `/api/projects` as cards linking to the
 * viewer (`?tl=<id>`). The bundled demo is always offered, even before the db
 * has any projects (or when the API isn't reachable, e.g. plain `vite dev`).
 */

interface ProjectSummary {
  id: string;
  title: string;
  mode: string;
  fps: number;
  updated_at: number;
  frameCount: number;
}

const DEMO: ProjectSummary = {
  id: 'demo',
  title: 'Demo — clay study',
  mode: 'timelapse',
  fps: 4,
  updated_at: 0,
  frameCount: 0,
};

export async function renderLanding(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--landing');
  app.innerHTML = `
    <div class="landing">
      <header class="landing__head">
        <div>
          <h1 class="landing__title">Bozzetto</h1>
          <p class="landing__tagline">Sculpt timelapses &amp; 3D studies</p>
        </div>
        <a class="landing__editor" href="/admin/">Editor →</a>
      </header>
      <div class="landing__grid" id="landing-grid"></div>
    </div>`;

  const grid = app.querySelector<HTMLElement>('#landing-grid');
  if (!grid) return;

  let projects: ProjectSummary[] = [];
  try {
    const res = await fetch('/api/projects', { headers: { accept: 'application/json' } });
    if (res.ok) projects = (await res.json()) as ProjectSummary[];
  } catch {
    /* API not reachable — fall through to demo-only. */
  }

  const list = projects.some((p) => p.id === 'demo') ? projects : [DEMO, ...projects];
  for (const p of list) grid.appendChild(card(p));
}

function card(p: ProjectSummary): HTMLElement {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `?tl=${encodeURIComponent(p.id)}`;

  const frames =
    p.frameCount > 0 ? `${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}` : 'no frames yet';

  a.innerHTML = `
    <div class="card__thumb" aria-hidden="true"></div>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta">
        <span class="badge">${p.mode === 'model' ? 'model' : 'timelapse'}</span>
        <span>${frames}</span>
      </span>
    </div>`;
  // textContent (not innerHTML) for the title — never trust stored strings.
  a.querySelector<HTMLElement>('.card__title')!.textContent = p.title || p.id;
  return a;
}
