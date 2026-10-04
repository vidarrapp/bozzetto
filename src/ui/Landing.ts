/**
 * Landing gallery. Lists projects from `/api/projects` as cards linking to the
 * viewer (`?tl=<id>`). The bundled demo is always offered, even before the db
 * has any projects (or when the API isn't reachable, e.g. plain `vite dev`).
 *
 * For the owner (the Access probe answers) the list comes from
 * `/admin/api/projects` instead: private projects show with a Private badge
 * and a toggle, and scenes saved to the library from Sculpt sit beside the
 * device's own shelf, opening in Sculpt (`?sculpt=1&project=<id>`).
 */

import { div } from './dom';
import { api, mediaPath, probeAdmin, type ProjectSummary, type Visibility } from '../admin/api';
import { apiFetch, apiJson, isDesktop } from '../net/origin';
import { installChip } from './InstallHint';
import { topChip, topbarRight } from './topbar';
import { DEVICE_ONLY_NOTE } from './deviceOnly';

export async function renderLanding(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--landing');
  app.innerHTML = `
    <div class="landing">
      <header class="landing__head">
        <div>
          <h1 class="landing__title">Bozzetto</h1>
          <p class="landing__tagline">Pose, sculpt, render and timelapse</p>
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
  // A re-render (after a delete) must not stack a second set of chips
  // beside the first: the row outlives the grid it is rebuilt around.
  bar.querySelectorAll('.landing-chip').forEach((el) => el.remove());
  const chip = (el: HTMLElement): void => {
    el.classList.add('landing-chip');
    bar.appendChild(el);
  };
  // Guests get the install steps (owner call: the audience being shown the
  // app); the owner has it installed, and standalone hides it regardless.
  if (!admin) {
    const install = installChip();
    if (install) chip(install);
  }
  // Same slot either way: the way in for a guest, the way to the editor for
  // the owner - who otherwise had no link to the admin panel at all.
  chip(topChip(admin ? 'Projects' : 'Log in', '/admin/'));

  // Published projects come from whichever server is configured. On the web
  // that is the site itself; in the desktop app it is nothing at all until
  // someone points it at their own deployment, and an empty shelf is the
  // right answer there rather than an error. The owner gets the full list,
  // private projects and scenes included; if it cannot be had (offline with
  // nothing cached) the public one stands in, and the page is a guest's.
  const owned = admin ? await apiJson<ProjectSummary[]>('/admin/api/projects') : null;
  const projects: ProjectSummary[] = owned ?? (await apiJson<ProjectSummary[]>('/api/projects')) ?? [];
  const owner = owned !== null;

  // The first tile starts new work, for everyone: it used to be a guest's
  // top-row "Sculpt" chip, and the tile read much clearer (owner call
  // before showing the app around). It doubles as the empty state - a
  // gallery with nothing in it still leads with the way to make
  // something. Armature mode is everyone's too now (owner call), so the
  // tile asks which of the two to start rather than going straight in.
  grid.appendChild(createCard());

  // Then work in progress: the sculpt autosave lives in this browser, so it
  // is not a project the API knows about, but it is the thing most worth
  // getting back to. An armature in progress sits beside it.
  const inProgress = await sculptCard();
  if (inProgress) grid.appendChild(inProgress);
  const armatureInProgress = await armatureCard();
  if (armatureInProgress) grid.appendChild(armatureInProgress);

  // Then the shelf: scenes explicitly saved on this device, newest first.
  // They sit before the published projects because they are yours and
  // one tap from being opened. A device copy of a scene the list already
  // shows is left out: the project's own card stands for it.
  const listed = new Set(projects.map((p) => p.id));
  for (const c of await libraryCards(() => void renderLanding(app), inProgress !== null, { owner, listed })) {
    grid.appendChild(c);
  }

  // Then scenes in Projects - the owner's library, kept on the server, and
  // any the owner has made public - and after them the published work.
  for (const p of projects.filter((p) => p.mode === 'scene')) {
    grid.appendChild(sceneCard(p, { owner, hasUnsavedWork: inProgress !== null }));
  }
  // Only projects with frames are shown publicly; empties live in the editor.
  for (const p of projects.filter((p) => p.mode !== 'scene' && p.frameCount > 0)) {
    grid.appendChild(owner ? ownerCard(p) : card(p));
  }
}

/**
 * The Create tile: a plus that opens the choice between a new sculpt, a new
 * armature and the timelapse uploader (owner calls: two kinds of work start
 * here, and the uploader moved in from the top row, which keeps to Install
 * and the sign-in).
 */
function createCard(): HTMLElement {
  const a = document.createElement('a');
  a.className = 'card card--new';
  a.href = '/?sculpt=1';
  a.innerHTML =
    '<div><div class="card--new__plus">+</div>' +
    '<div class="card--new__label">Create</div></div>';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openCreateChooser();
  });
  return a;
}

/**
 * The ways to start, in a small dialog over the gallery: the two kinds of
 * new work side by side, and the uploader for frames made elsewhere on a
 * row of its own below them.
 */
function openCreateChooser(): void {
  const overlay = document.createElement('div');
  overlay.className = 'install-overlay create-overlay';
  overlay.innerHTML = `
    <div class="install-card create-card" role="dialog" aria-modal="true" aria-label="Create">
      <button type="button" class="install-close" aria-label="Close">×</button>
      <h2>Create</h2>
      <div class="create-choices">
        <button type="button" class="create-choice" data-kind="sculpt">
          <span class="create-choice__title">New sculpt</span>
          <span class="create-choice__hint">A sphere of clay, brushes and paint.</span>
        </button>
        <button type="button" class="create-choice" data-kind="armature">
          <span class="create-choice__title">New armature</span>
          <span class="create-choice__hint">A posable figure to reference, or to send to Sculpt as a base.</span>
        </button>
        <button type="button" class="create-choice create-choice--wide" data-kind="timelapse">
          <span class="create-choice__title">Upload timelapse</span>
          <span class="create-choice__hint">OBJ or GLB frames from another app, played back as a timelapse.</span>
        </button>
      </div>
    </div>`;
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.install-close')?.addEventListener('click', close);
  overlay.querySelector('[data-kind="sculpt"]')?.addEventListener('click', () => void startSculpt());
  overlay.querySelector('[data-kind="armature"]')?.addEventListener('click', () => void startArmature());
  overlay.querySelector('[data-kind="timelapse"]')?.addEventListener('click', () => {
    window.location.href = '/create/';
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

/**
 * Start a fresh sculpt. Sculpt mode restores the autosave on entry, so
 * without this the tile quietly RESUMED the work in progress instead of
 * starting anything new. Ask, then clear the scene and its recording
 * before going in.
 */
async function startSculpt(): Promise<void> {
  const store = await import('../sculpt/bridge/ScenePersist');
  // The scene itself, not its snapshot: the picture is only written on
  // the way out through the gallery link, so a reload, a closed tab or
  // iOS evicting the page left saved work that this silently RESUMED
  // instead of replacing - the one thing this tile promises not to do.
  const hasWork = await store.hasSavedScene().catch(() => false);
  if (hasWork && !confirm('Start a new sculpt? The work in progress on this device will be replaced.')) {
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
  window.location.href = '/?sculpt=1';
}

/** Start a fresh armature, replacing the one in progress after asking. */
async function startArmature(): Promise<void> {
  const store = await import('../armature/persist');
  const hasWork = await store.hasArmature().catch(() => false);
  if (hasWork && !confirm('Start a new armature? The one in progress on this device will be replaced.')) {
    return;
  }
  if (hasWork) await store.clearArmature();
  window.location.href = '/?armature=1';
}

/** The armature in progress on this device, if there is one. */
async function armatureCard(): Promise<HTMLElement | null> {
  let file: Awaited<ReturnType<typeof import('../armature/persist').loadArmature>>;
  try {
    const store = await import('../armature/persist');
    file = await store.loadArmature();
  } catch {
    return null;
  }
  if (!file) return null;
  const a = document.createElement('a');
  a.className = 'card card--sculpt card--armature';
  a.href = '/?armature=1';
  // The picture is taken on the way out of the mode, as the sculpt card's
  // is; an armature not yet left that way has none.
  const url = file.thumb instanceof Blob ? URL.createObjectURL(file.thumb) : null;
  const picture = url
    ? `<img class="card__img-blur" aria-hidden="true" alt="" draggable="false" src="${url}" />
      <img class="card__img" alt="" draggable="false" src="${url}" />`
    : ''; // no picture: the gradient placeholder stands in
  a.innerHTML = `
    <div class="card__thumb">
      ${picture}
      <span class="card__badge">In progress</span>
    </div>
    <div class="card__body">
      <span class="card__title">Your armature</span>
      <span class="card__meta"></span>
      <span class="card__note"></span>
    </div>`;
  a.querySelector<HTMLElement>('.card__note')!.textContent = DEVICE_ONLY_NOTE;
  const meta = a.querySelector<HTMLElement>('.card__meta')!;
  const posed = Object.keys(file.state.pose ?? {}).length;
  meta.textContent = `${posed} joint${posed === 1 ? '' : 's'} posed · ${ago(file.savedAt)}`;
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
    ? `<img class="card__img-blur" aria-hidden="true" alt="" draggable="false" src="${url}" />
      <img class="card__img" alt="" draggable="false" src="${url}" />`
    : ''; // no snapshot: the gradient placeholder stands in
  a.innerHTML = `
    <div class="card__thumb">
      ${picture}
      <span class="card__badge">In progress</span>
    </div>
    <div class="card__body">
      <span class="card__title">Your sculpt</span>
      <span class="card__meta"></span>
      <span class="card__note"></span>
    </div>`;
  // The autosave is browser storage like the shelf, and goes the same way
  // with a reinstall - however often it is written.
  a.querySelector<HTMLElement>('.card__note')!.textContent = DEVICE_ONLY_NOTE;
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
 *
 * Two kinds sit on the shelf. A scene kept only here says so, in the words
 * every device-only copy uses, and for the owner offers Upload to Projects.
 * A device copy of a project (projectId set) is the cache Save to library
 * keeps for offline opens; the owner's list shows the project itself, so
 * the copy appears only when that list could not be had, marked In Projects.
 */
async function libraryCards(
  onChange: () => void,
  hasUnsavedWork: boolean,
  opts: { owner: boolean; listed: Set<string> },
): Promise<HTMLElement[]> {
  let lib: typeof import('../sculpt/bridge/SceneLibrary');
  let entries: Awaited<ReturnType<typeof import('../sculpt/bridge/SceneLibrary').listLibrary>>;
  try {
    lib = await import('../sculpt/bridge/SceneLibrary');
    entries = await lib.listLibrary();
  } catch {
    return []; // storage blocked, or the module failed to load
  }
  const seen = new Set<string>();
  const shown = entries.filter((e) => {
    if (!e.projectId) return true;
    // The project's own card is on the page: its copy here would be a twin.
    if (opts.listed.has(e.projectId)) return false;
    // One card per project, the newest copy, should an interrupted upload
    // ever have left two.
    if (seen.has(e.projectId)) return false;
    seen.add(e.projectId);
    return true;
  });
  return shown.map((e) => {
    // A project's copy reads as In Projects - unless the owner's full list
    // leaves it out, which means it was deleted elsewhere. Then the copy is
    // all there is, and it is offered as what it now is: a scene on this
    // device only. (Missing from the public list proves nothing: it may
    // simply be private.)
    const inProjects = !!e.projectId && !opts.owner;
    // The key changes when an upload turns this card into a project's copy.
    let key = e.id;
    const card = div('card card--library');
    const url = e.thumb ? URL.createObjectURL(e.thumb) : null;
    const picture = url
      ? `<img class="card__img-blur" aria-hidden="true" alt="" draggable="false" src="${url}" />
        <img class="card__img" alt="" draggable="false" src="${url}" />`
      : '';
    card.innerHTML = `
      <a class="card__thumb">
        ${picture}
        <span class="card__badge"></span>
      </a>
      <div class="card__body">
        <span class="card__title" tabindex="0" title="Double-click to rename"></span>
        <span class="card__meta"></span>
      </div>
      <button class="card__trash" type="button" aria-label="Delete this scene">Delete</button>`;
    const thumb = card.querySelector<HTMLAnchorElement>('.card__thumb')!;
    const badge = card.querySelector<HTMLElement>('.card__badge')!;
    const body = card.querySelector<HTMLElement>('.card__body')!;
    // A copy of a project opens as the project does, from the server with
    // this copy as the fallback; a device-only scene opens from here.
    const markInProjects = (projectId: string): void => {
      card.classList.add('card--uploaded');
      badge.textContent = 'In Projects';
      thumb.href = `/?sculpt=1&project=${encodeURIComponent(projectId)}`;
    };
    if (inProjects) {
      markInProjects(e.projectId!);
    } else {
      badge.textContent = 'Saved';
      thumb.href = `/?sculpt=1&lib=${encodeURIComponent(e.id)}`;
      const note = document.createElement('span');
      note.className = 'card__note';
      note.textContent = DEVICE_ONLY_NOTE;
      body.appendChild(note);
      if (opts.owner) body.appendChild(uploadButton());
    }

    /** Upload to Projects: the stored bytes as they are, then this card becomes the project's copy. */
    function uploadButton(): HTMLButtonElement {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card__action card__upload';
      b.textContent = 'Upload to Projects';
      b.addEventListener('click', () => {
        b.disabled = true;
        void (async () => {
          const bytes = await lib.loadLibraryBytes(key);
          if (!bytes) throw new Error('This scene could not be read from the device');
          const { uploadScene } = await import('../sculpt/bridge/SceneProjects');
          const link = await uploadScene(
            { bytes, title: e.name, objects: e.objects, tris: e.tris, thumb: e.thumb },
            (text) => {
              b.textContent = text;
            },
          );
          const moved = await lib.markUploaded(key, link.id, link.title);
          key = moved?.id ?? key;
          body.querySelector('.card__note')?.remove();
          b.remove();
          markInProjects(link.id);
        })().catch((err: Error) => {
          b.disabled = false;
          b.textContent = 'Upload to Projects';
          alert(`Upload failed: ${err.message}`);
        });
      });
      return b;
    }

    // Opening replaces whatever is in the autosave slot, and the autosave
    // overwrites it seconds later - the same trap Open file guards, so the
    // same guard: ask, but only when there is unsaved work to lose.
    thumb.addEventListener('click', (ev) => {
      if (!hasUnsavedWork) return;
      if (!confirm(`Open "${e.name}"? Your work in progress will be replaced.`)) ev.preventDefault();
    });

    const title = card.querySelector<HTMLElement>('.card__title')!;
    title.textContent = e.name;
    const objects = `${e.objects} object${e.objects === 1 ? '' : 's'}`;
    card.querySelector<HTMLElement>('.card__meta')!.textContent =
      `${objects} · ${e.tris.toLocaleString('en-US')} tris · ${mb(e.bytes)} · ${ago(e.savedAt)}`;

    // Rename in place, the way the Scene panel renames an object.
    editableTitle(title, e.name, (name) => lib.renameLibraryScene(key, name));

    card.querySelector<HTMLButtonElement>('.card__trash')!.addEventListener('click', () => {
      const question = card.classList.contains('card--uploaded')
        ? `Delete this device's copy of "${e.name}"? The scene stays in Projects.`
        : `Delete "${e.name}"? This cannot be undone.`;
      if (!confirm(question)) return;
      void lib.deleteLibraryScene(key).then(() => {
        if (url) URL.revokeObjectURL(url);
        card.remove();
        onChange();
      });
    });
    return card;
  });
}

/**
 * Double-click to rename, Enter to keep, Escape to drop: the Scene panel's
 * gesture. An empty name is a cancel, not a wipe; a rename that fails puts
 * the old name back.
 */
function editableTitle(title: HTMLElement, initial: string, save: (name: string) => Promise<unknown>): void {
  let current = initial;
  const commit = (): void => {
    title.contentEditable = 'false';
    const name = (title.textContent ?? '').trim();
    if (!name) {
      title.textContent = current;
      return;
    }
    if (name === current) return;
    const before = current;
    current = name;
    void save(name).catch((err: Error) => {
      current = before;
      title.textContent = before;
      alert(`Rename failed: ${err.message}`);
    });
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
      title.textContent = current;
      title.blur();
    }
  });
}

/**
 * A scene in Projects: opens in Sculpt, from the server, with this device's
 * copy as the offline fallback. For the owner it carries what the device
 * shelf's cards do - rename, delete - and who may see it.
 */
function sceneCard(p: ProjectSummary, opts: { owner: boolean; hasUnsavedWork: boolean }): HTMLElement {
  const card = div('card card--library card--scene');
  card.dataset.project = p.id;
  card.innerHTML = `
    <a class="card__thumb">
      <span class="card__badges"></span>
    </a>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta"></span>
    </div>`;
  const thumb = card.querySelector<HTMLAnchorElement>('.card__thumb')!;
  thumb.href = `/?sculpt=1&project=${encodeURIComponent(p.id)}`;
  setPicture(thumb, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  const badges = card.querySelector<HTMLElement>('.card__badges')!;
  const paintBadges = (): void => setBadges(badges, ['Scene', ...(p.visibility === 'private' ? ['Private'] : [])]);
  paintBadges();
  const title = card.querySelector<HTMLElement>('.card__title')!;
  title.textContent = p.title || p.id;
  card.querySelector<HTMLElement>('.card__meta')!.textContent = p.scene
    ? `${p.scene.objects} object${p.scene.objects === 1 ? '' : 's'} · ` +
      `${p.scene.tris.toLocaleString('en-US')} tris · ${mb(p.scene.bytes)} · ${ago(p.updated_at)}`
    : 'Upload did not finish';
  thumb.addEventListener('click', (ev) => {
    if (!opts.hasUnsavedWork) return;
    if (!confirm(`Open "${p.title}"? Your work in progress will be replaced.`)) ev.preventDefault();
  });
  if (!opts.owner) return card;

  title.tabIndex = 0;
  title.title = 'Double-click to rename';
  editableTitle(title, p.title, async (name) => {
    const row = await api.rename(p.id, name);
    p.title = row.title;
    // The device copy goes by the same name, for the day it is all there is.
    const lib = await import('../sculpt/bridge/SceneLibrary');
    await lib.renameLibraryScene(p.id, row.title).catch(() => undefined);
  });
  card.querySelector<HTMLElement>('.card__body')!.appendChild(visibilityToggle(p, paintBadges));
  const trash = document.createElement('button');
  trash.type = 'button';
  trash.className = 'card__trash';
  trash.setAttribute('aria-label', 'Delete this scene');
  trash.textContent = 'Delete';
  trash.addEventListener('click', () => {
    if (!confirm(`Delete "${p.title}"? It goes from Projects and from this device. This cannot be undone.`)) return;
    trash.disabled = true;
    void api
      .remove(p.id)
      .then(async () => {
        // Its device copy too: left behind it would come back as a
        // device-only card, which is not what deleting it meant.
        const lib = await import('../sculpt/bridge/SceneLibrary');
        await lib.deleteLibraryScene(p.id);
        card.remove();
      })
      .catch((err: Error) => {
        trash.disabled = false;
        alert(`Delete failed: ${err.message}`);
      });
  });
  card.appendChild(trash);
  return card;
}

/**
 * The owner's Public/Private switch on a card: a checkbox labelled Private,
 * so which way it points is never in doubt. The badge follows once the
 * server has agreed; a refusal puts the box back.
 */
function visibilityToggle(p: ProjectSummary, repaint: () => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'card__vis';
  label.title = 'Private projects show only here, signed in';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = p.visibility === 'private';
  label.append(box, document.createTextNode('Private'));
  box.addEventListener('change', () => {
    const want: Visibility = box.checked ? 'private' : 'public';
    box.disabled = true;
    void api
      .setVisibility(p.id, want)
      .then((row) => {
        p.visibility = row.visibility ?? want;
        box.checked = p.visibility === 'private';
        repaint();
      })
      .catch((err: Error) => {
        box.checked = p.visibility === 'private';
        alert(`Could not change who sees "${p.title}": ${err.message}`);
      })
      .finally(() => {
        box.disabled = false;
      });
  });
  return label;
}

function setBadges(host: HTMLElement, labels: string[]): void {
  host.replaceChildren(
    ...labels.map((text) => {
      const b = document.createElement('span');
      b.className = `card__badge${text === 'Private' ? ' card__badge--private' : ''}`;
      b.textContent = text;
      return b;
    }),
  );
}

/**
 * A server thumbnail, as the two image layers every card draws. On the web
 * its path is the source. The desktop app's page cannot load a server's
 * images itself - its policy allows only its own and blob: images, and the
 * deployment sends no CORS headers - so there the bytes come through the
 * main process like every other server call. No picture: the gradient
 * placeholder stands in.
 */
function setPicture(thumb: HTMLElement, path: string): void {
  const source = isDesktop()
    ? apiFetch(path)
        .then((r) =>
          r.ok && r.bytes && r.contentType.startsWith('image/')
            ? URL.createObjectURL(new Blob([r.bytes], { type: r.contentType }))
            : null,
        )
        .catch(() => null)
    : Promise.resolve(path);
  void source.then((src) => {
    if (!src) return;
    const layer = (cls: string): HTMLImageElement => {
      const img = document.createElement('img');
      img.className = cls;
      img.alt = '';
      img.draggable = false;
      img.loading = 'lazy';
      img.src = src;
      return img;
    };
    const blur = layer('card__img-blur');
    blur.setAttribute('aria-hidden', 'true');
    const sharp = layer('card__img');
    sharp.addEventListener('error', () => {
      blur.remove();
      sharp.remove();
    });
    thumb.prepend(blur, sharp);
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

  a.innerHTML = `
    <div class="card__thumb"></div>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta">
        <span class="badge">${p.mode === 'model' ? 'model' : 'timelapse'}</span>
        <span>${frames}</span>
      </span>
    </div>`;
  // textContent (not innerHTML) for the title — never trust stored strings.
  a.querySelector<HTMLElement>('.card__title')!.textContent = p.title || p.id;
  // No thumbnail yet: setPicture drops both layers, and the gradient shows.
  setPicture(a.querySelector<HTMLElement>('.card__thumb')!, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  return a;
}

/**
 * A published project in the owner's gallery: the guest's card plus who may
 * see it - the Private badge, and the switch. With a control on it, the
 * card is a div with links inside rather than a link around everything.
 */
function ownerCard(p: ProjectSummary): HTMLElement {
  const card = div('card card--library card--owned');
  card.dataset.project = p.id;
  const href = `?tl=${encodeURIComponent(p.id)}`;
  const frames = `${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}`;
  card.innerHTML = `
    <a class="card__thumb">
      <span class="card__badges"></span>
    </a>
    <div class="card__body">
      <a class="card__title card__link"></a>
      <span class="card__meta">
        <span class="badge">${p.mode === 'model' ? 'model' : 'timelapse'}</span>
        <span>${frames}</span>
      </span>
    </div>`;
  const thumb = card.querySelector<HTMLAnchorElement>('.card__thumb')!;
  thumb.href = href;
  setPicture(thumb, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  const title = card.querySelector<HTMLAnchorElement>('.card__title')!;
  title.href = href;
  title.textContent = p.title || p.id;
  const badges = card.querySelector<HTMLElement>('.card__badges')!;
  const paintBadges = (): void => setBadges(badges, p.visibility === 'private' ? ['Private'] : []);
  paintBadges();
  card.querySelector<HTMLElement>('.card__body')!.appendChild(visibilityToggle(p, paintBadges));
  return card;
}
