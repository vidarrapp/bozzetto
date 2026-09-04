/**
 * Landing gallery. Lists projects from `/api/projects` as cards linking to the
 * viewer (`?tl=<id>`). The bundled demo is always offered, even before the db
 * has any projects (or when the API isn't reachable, e.g. plain `vite dev`).
 */

import { div } from './dom';
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

  // Then the shelf: scenes explicitly saved on this device, newest first.
  // They sit before the published projects because they are yours and
  // one tap from being opened.
  for (const c of await libraryCards(() => void renderLanding(app), inProgress !== null)) {
    grid.appendChild(c);
  }

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
      // The scene itself, not its snapshot: the picture is only written on
      // the way out through the gallery link, so a reload, a closed tab or
      // iOS evicting the page left saved work that this silently RESUMED
      // instead of replacing - the one thing this tile promises not to do.
      const hasWork = await store.hasSavedScene().catch(() => false);
      if (
        hasWork &&
        !confirm('Start a new sculpt? The work in progress on this device will be replaced.')
      ) {
        return;
      }
      if (hasWork) {
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
 * The unfinished sculpt sitting in this browser's storage, as a card.
 * Clicking goes straight back in, where the autosave restores the geometry.
 *
 * The SCENE decides whether there is a card; the snapshot only decides
 * whether it has a picture and a caption. The snapshot is written on the
 * way out through the gallery link, so every other exit - a reload, a
 * closed tab, iOS evicting the page - left work with no way back to it
 * from here.
 */
async function sculptCard(): Promise<HTMLElement | null> {
  let snap: Awaited<ReturnType<typeof import('../sculpt/bridge/ScenePersist').loadSculptSnapshot>>;
  try {
    // Imported lazily: the landing page should not pull in sculpt code just
    // to discover there is nothing saved.
    const store = await import('../sculpt/bridge/ScenePersist');
    if (!(await store.hasSavedScene())) return null;
    snap = await store.loadSculptSnapshot();
  } catch {
    return null; // storage blocked, or the module failed to load
  }

  const a = document.createElement('a');
  a.className = 'card card--sculpt';
  a.href = '/?sculpt=1';
  const url = snap ? URL.createObjectURL(snap.thumb) : null;
  const picture = url
    ? `<img class="card__img-blur" aria-hidden="true" alt="" src="${url}" />
      <img class="card__img" alt="" src="${url}" />`
    : ''; // no snapshot: the gradient placeholder stands in
  a.innerHTML = `
    <div class="card__thumb">
      ${picture}
      <span class="card__badge">In progress</span>
    </div>
    <div class="card__body">
      <span class="card__title">Your sculpt</span>
      <span class="card__meta"></span>
    </div>`;
  const meta = a.querySelector<HTMLElement>('.card__meta')!;
  if (snap) {
    const objects = `${snap.objects} object${snap.objects === 1 ? '' : 's'}`;
    meta.textContent = `${objects} · ${snap.tris.toLocaleString('en-US')} tris · ${ago(snap.savedAt)}`;
  } else {
    meta.textContent = 'Saved on this device';
  }
  return a;
}

/**
 * The local library: sculpts explicitly saved on this device. Unlike the
 * in-progress card these are a shelf you put things on, so each one can be
 * renamed and thrown away, which means the card cannot be a bare <a> - a
 * link with buttons inside it is neither valid nor operable.
 */
async function libraryCards(
  onChange: () => void,
  hasUnsavedWork: boolean,
): Promise<HTMLElement[]> {
  let lib: typeof import('../sculpt/bridge/SceneLibrary');
  let entries: Awaited<ReturnType<typeof import('../sculpt/bridge/SceneLibrary').listLibrary>>;
  try {
    lib = await import('../sculpt/bridge/SceneLibrary');
    entries = await lib.listLibrary();
  } catch {
    return []; // storage blocked, or the module failed to load
  }
  return entries.map((e) => {
    const card = div('card card--library');
    const url = e.thumb ? URL.createObjectURL(e.thumb) : null;
    const picture = url
      ? `<img class="card__img-blur" aria-hidden="true" alt="" src="${url}" />
        <img class="card__img" alt="" src="${url}" />`
      : '';
    card.innerHTML = `
      <a class="card__thumb" href="/?sculpt=1&lib=${encodeURIComponent(e.id)}">
        ${picture}
        <span class="card__badge">Saved</span>
      </a>
      <div class="card__body">
        <span class="card__title" tabindex="0" title="Double-click to rename"></span>
        <span class="card__meta"></span>
      </div>
      <button class="card__trash" type="button" aria-label="Delete this scene">Delete</button>`;

    // Opening replaces whatever is in the autosave slot, and the autosave
    // overwrites it seconds later - the same trap Open file guards, so the
    // same guard: ask, but only when there is unsaved work to lose.
    card.querySelector<HTMLAnchorElement>('.card__thumb')!.addEventListener('click', (ev) => {
      if (!hasUnsavedWork) return;
      if (!confirm(`Open "${e.name}"? Your work in progress will be replaced.`)) ev.preventDefault();
    });

    const title = card.querySelector<HTMLElement>('.card__title')!;
    title.textContent = e.name;
    const objects = `${e.objects} object${e.objects === 1 ? '' : 's'}`;
    card.querySelector<HTMLElement>('.card__meta')!.textContent =
      `${objects} · ${e.tris.toLocaleString('en-US')} tris · ${mb(e.bytes)} · ${ago(e.savedAt)}`;

    // Rename in place, the way the Scene panel renames an object.
    const commit = (): void => {
      title.contentEditable = 'false';
      const name = (title.textContent ?? '').trim();
      if (!name) {
        title.textContent = e.name; // an empty name is a cancel, not a wipe
        return;
      }
      if (name !== e.name) void lib.renameLibraryScene(e.id, name);
    };
    title.addEventListener('dblclick', () => {
      title.contentEditable = 'true';
      title.focus();
      getSelection()?.selectAllChildren(title);
    });
    title.addEventListener('blur', commit);
    title.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        title.blur();
      } else if (ev.key === 'Escape') {
        title.textContent = e.name;
        title.blur();
      }
    });

    card.querySelector<HTMLButtonElement>('.card__trash')!.addEventListener('click', () => {
      if (!confirm(`Delete "${e.name}"? This cannot be undone.`)) return;
      void lib.deleteLibraryScene(e.id).then(() => {
        if (url) URL.revokeObjectURL(url);
        card.remove();
        onChange();
      });
    });
    return card;
  });
}

/** Packed size, at the precision the number is worth. */
function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
