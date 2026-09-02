/**
 * Landing gallery. Lists projects from `/api/projects` as cards linking to the
 * viewer (`?tl=<id>`). The bundled demo is always offered, even before the db
 * has any projects (or when the API isn't reachable, e.g. plain `vite dev`).
 */

import { probeAdmin } from '../admin/api';
import { installChip } from './InstallHint';
import { topChip, topbarRight } from './topbar';

interface ProjectSummary {
  id: string;
  title: string;
  mode: string;
  fps: number;
  updated_at: number;
  frameCount: number;
}

export async function renderLanding(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--landing');
  app.innerHTML = `
    <div class="landing">
      <header class="landing__head">
        <div>
          <h1 class="landing__title">Bozzetto</h1>
          <p class="landing__tagline">Sculpt, paint &amp; timelapse in your browser</p>
        </div>

      </header>
      <div class="landing__grid" id="landing-grid"></div>
    </div>`;

  const grid = app.querySelector<HTMLElement>('#landing-grid');
  if (!grid) return;

  // Page actions live in the shared top row with the theme toggle, so the
  // same controls sit in the same place on every page and mode.
  const admin = await probeAdmin().catch(() => null);
  const bar = topbarRight();
  // Guests get the install steps (owner call: the audience being shown the
  // app); the owner has it installed, and standalone hides it regardless.
  if (!admin) {
    const install = installChip();
    if (install) bar.appendChild(install);
  }
  bar.appendChild(topChip('Upload timelapse', '/create/'));
  // Same slot either way: the way in for a guest, the way to the editor for
  // the owner - who otherwise had no link to the admin panel at all.
  bar.appendChild(topChip(admin ? 'Projects' : 'Log in', '/admin/'));

  let projects: ProjectSummary[] = [];
  try {
    const res = await fetch('/api/projects', { headers: { accept: 'application/json' } });
    if (res.ok) projects = (await res.json()) as ProjectSummary[];
  } catch {
    /* API not reachable — fall through to demo-only. */
  }

  // The first tile starts a new sculpt, for everyone: it used to be a
  // guest's top-row "Sculpt" chip, and the tile read much clearer (owner
  // call before showing the app around). It doubles as the empty state -
  // a gallery with nothing in it still leads with the way to make
  // something.
  grid.appendChild(newSculptCard());

  // Then work in progress: the sculpt autosave lives in this browser, so it
  // is not a project the API knows about, but it is the thing most worth
  // getting back to.
  const inProgress = await sculptCard();
  if (inProgress) grid.appendChild(inProgress);

  // Only projects with frames are shown publicly; empties live in the editor.
  for (const p of projects.filter((p) => p.frameCount > 0)) grid.appendChild(card(p));
}

/** Start a fresh sculpt: a plus over the default subject. */
function newSculptCard(): HTMLElement {
  const a = document.createElement('a');
  a.className = 'card card--new';
  a.href = '/?sculpt=1';
  a.innerHTML =
    '<div><div class="card--new__plus">+</div>' +
    '<div class="card--new__label">New sculpt</div></div>';
  // Sculpt mode restores the autosave on entry, so without this the tile
  // quietly RESUMED the work in progress instead of starting anything new.
  // Ask, then clear the scene and its recording before going in.
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void (async () => {
      const store = await import('../sculpt/bridge/ScenePersist');
      const snap = await store.loadSculptSnapshot().catch(() => null);
      if (
        snap &&
        !confirm('Start a new sculpt? The work in progress on this device will be replaced.')
      ) {
        return;
      }
      if (snap) {
        await store.clearSavedScene();
        await store.clearSculptFrames();
        // The look too: "new" has to mean new. Leaving it behind is how a
        // light set flat in one session kept arriving in the next one, with
        // a fresh sphere lit by it and no obvious cause.
        await store.clearSculptLook();
      }
      window.location.href = a.href;
    })();
  });
  return a;
}

/**
 * The unfinished sculpt sitting in this browser's storage, as a card. The
 * picture is the snapshot taken when sculpt mode was last left; clicking
 * goes straight back in, where the autosave restores the geometry.
 */
async function sculptCard(): Promise<HTMLElement | null> {
  let snap: Awaited<ReturnType<typeof import('../sculpt/bridge/ScenePersist').loadSculptSnapshot>>;
  try {
    // Imported lazily: the landing page should not pull in sculpt code just
    // to discover there is nothing saved.
    const store = await import('../sculpt/bridge/ScenePersist');
    snap = await store.loadSculptSnapshot();
  } catch {
    return null; // storage blocked, or the module failed to load
  }
  if (!snap) return null;

  const a = document.createElement('a');
  a.className = 'card card--sculpt';
  a.href = '/?sculpt=1';
  const url = URL.createObjectURL(snap.thumb);
  a.innerHTML = `
    <div class="card__thumb">
      <img class="card__img-blur" aria-hidden="true" alt="" src="${url}" />
      <img class="card__img" alt="" src="${url}" />
      <span class="card__badge">In progress</span>
    </div>
    <div class="card__body">
      <span class="card__title">Your sculpt</span>
      <span class="card__meta"></span>
    </div>`;
  const objects = `${snap.objects} object${snap.objects === 1 ? '' : 's'}`;
  a.querySelector<HTMLElement>('.card__meta')!.textContent =
    `${objects} · ${snap.tris.toLocaleString('en-US')} tris · ${ago(snap.savedAt)}`;
  return a;
}

/** "just now" / "3 hours ago" - enough to recognise which session it was. */
function ago(t: number): string {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function card(p: ProjectSummary): HTMLElement {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `?tl=${encodeURIComponent(p.id)}`;

  const frames =
    p.frameCount > 0 ? `${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}` : 'no frames yet';

  const thumb = `/media/${encodeURIComponent(p.id)}/thumb.jpg?v=${p.updated_at}`;
  a.innerHTML = `
    <div class="card__thumb">
      <img class="card__img-blur" aria-hidden="true" alt="" loading="lazy" src="${thumb}" />
      <img class="card__img" alt="" loading="lazy" src="${thumb}" />
    </div>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta">
        <span class="badge">${p.mode === 'model' ? 'model' : 'timelapse'}</span>
        <span>${frames}</span>
      </span>
    </div>`;
  // textContent (not innerHTML) for the title — never trust stored strings.
  a.querySelector<HTMLElement>('.card__title')!.textContent = p.title || p.id;
  // No thumbnail yet → drop both image layers so the gradient placeholder shows.
  const img = a.querySelector<HTMLImageElement>('.card__img');
  img?.addEventListener('error', () => {
    a.querySelectorAll('.card__img, .card__img-blur').forEach((el) => el.remove());
  });
  return a;
}
