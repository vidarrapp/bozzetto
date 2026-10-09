/**
 * Landing gallery. Lists the site's templates from `/api/projects` as cards
 * (docs/accounts.md §5), each badged Template: a model or a timelapse plays
 * in the viewer (`?tl=<id>`), and a scene opens in Sculpt as a copy
 * (`?sculpt=1&template=<id>`), belonging to no project, so saving it makes
 * something of your own. The bundled demo is always offered, even before
 * the db has any projects (or when the API isn't reachable, e.g. plain
 * `vite dev`).
 *
 * For the owner (the Access probe answers, or with accounts on the
 * owner's account) the list comes from `/admin/api/projects` instead: the
 * templates and the owner's own work.
 * Private projects show with a Private badge and a toggle, whose Public
 * makes a template, and the owner's own scenes saved to the library from
 * Sculpt sit beside the device's own shelf, opening in Sculpt as
 * themselves (`?sculpt=1&project=<id>`); a template opens as a copy for the
 * owner too, and is edited from Projects. An owner whose sign-in has
 * expired gets a guest's gallery and Log in, as that is what the server
 * will answer, told once that the sign-in expired.
 *
 * With accounts on (docs/accounts.md §7) the top row is the account's: Sign
 * in for a guest, which opens the sign-in dialog over the gallery; My
 * projects and the @handle menu signed in, and Owner tools for the owner
 * (ui/account/menu). The foot links the legal pages.
 */

import { div } from './dom';
import {
  AuthExpiredError,
  api,
  checkSignIn,
  mediaPath,
  roleOf,
  setThumbSrc,
  takeExpiryNotice,
  uploadFailure,
  VISIBILITY_HINT,
  type ProjectSummary,
  type SignIn,
  type Visibility,
} from '../admin/api';
import { apiFetch, apiJson, isDesktop } from '../net/origin';
import { installChip } from './InstallHint';
import { topChip, topbarRight } from './topbar';
import { DEVICE_ONLY_NOTE } from './deviceOnly';
import { signInButton, signOutChip } from './signIn';
import { failNotice } from '../sculpt/ui/statusToast';
import { markOpenOnClick } from './openToken';
import { accountChips } from './account/menu';
import { LEGAL } from './account/parts';
import { suspensionText } from '../net/account';

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
  const signIn: SignIn = await checkSignIn().catch(() => ({ email: null, expired: false }));
  const admin = roleOf(signIn) === 'owner';
  const bar = topbarRight();
  // A re-render (after a delete) must not stack a second set of chips
  // beside the first: the row outlives the grid it is rebuilt around.
  bar.querySelectorAll('.landing-chip').forEach((el) => el.remove());
  const chip = (el: HTMLElement): void => {
    el.classList.add('landing-chip');
    bar.appendChild(el);
  };
  // A sign-in from the gallery (the chip, the expiry line): the page draws
  // itself again for whoever it is for now.
  const again = (): void => void renderLanding(app);
  if (signIn.accounts) {
    // The account's chips (docs/accounts.md §7): Sign in and Install for a
    // guest; My projects, Owner tools for the owner, and the @handle menu.
    for (const c of accountChips(signIn, roleOf(signIn), again)) chip(c);
    app.querySelector('.landing')?.appendChild(legalFoot());
  } else {
    // Guests get the install steps (owner call: the audience being shown the
    // app); the owner has it installed, and standalone hides it regardless.
    if (!admin && !signIn.expired) {
      const install = installChip();
      if (install) chip(install);
    }
    // Same slot either way: the way in for a guest, the way to the editor for
    // the owner - who otherwise had no link to the admin panel at all. An
    // expired sign-in is Log in, which is the truth of it: the service
    // worker's last "signed in" used to stand in for an expired session, and
    // the gallery went on offering the owner's things until each one failed.
    chip(topChip(admin ? 'Projects' : 'Log in', '/admin/'));
    // And the way out (owner request), so a sign-in is not left behind on a
    // device the owner is done with. The desktop app signs out in Server
    // settings, where it signs in.
    if (admin && !isDesktop()) chip(signOutChip());
  }
  if (signIn.suspended) {
    // Every time, while it lasts: nothing of the account answers until the
    // owner lifts it, and no sign-in would.
    const note = document.createElement('p');
    note.className = 'landing__notice landing__notice--suspended';
    note.textContent = suspensionText(signIn.suspended.reason);
    app.querySelector('.landing__head > div')?.appendChild(note);
  }
  if (takeDeletedNotice()) {
    // Once, after Delete account finished: the gallery is a guest's now.
    const note = document.createElement('p');
    note.className = 'landing__notice';
    note.textContent = 'Your account has been deleted, with everything in it.';
    app.querySelector('.landing__head > div')?.appendChild(note);
  } else if (signIn.expired && takeExpiryNotice()) {
    // Once, in the heading's quiet voice: the chip says the rest. With
    // accounts on, Sign in again opens the dialog here.
    const note = document.createElement('p');
    note.className = 'landing__notice';
    note.append('Your sign-in has expired. ', signInButton('landing__signin', (ok) => (ok ? again() : undefined)));
    app.querySelector('.landing__head > div')?.appendChild(note);
  }

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
  // Saved to the library from its card, for whoever saves to a server here:
  // the owner, or anyone signed in with accounts on (docs/accounts.md §7).
  const savesHere = admin || signIn.expired || (signIn.accounts === true && !!signIn.me && !signIn.suspended);
  const armatureInProgress = await armatureCard({ uploads: savesHere, accounts: signIn.accounts === true, expired: signIn.expired });
  if (armatureInProgress) grid.appendChild(armatureInProgress);

  // Then the shelf: scenes explicitly saved on this device, newest first.
  // They sit before the published projects because they are yours and
  // one tap from being opened. A device copy of a scene the list already
  // shows is left out: the project's own card stands for it.
  const listed = new Set(projects.map((p) => p.id));
  // What opening a scene would replace: the sculpt in progress, or a reel
  // captured on this device (which goes with it, as File > Open's does).
  const workHere = inProgress !== null || (await framesKept());
  const libraryOpts = { owner, listed, expired: signIn.expired, accounts: signIn.accounts === true, signedIn: !!signIn.me };
  for (const c of await libraryCards(() => void renderLanding(app), workHere, libraryOpts)) {
    grid.appendChild(c);
  }

  // Then scenes: the templates, which open as copies, and for the owner
  // the library kept on the server - and after them the models and
  // timelapses.
  for (const p of projects.filter((p) => p.mode === 'scene')) {
    grid.appendChild(sceneCard(p, { owner, hasUnsavedWork: workHere }));
  }
  // Armatures: a template opens in Armature mode as a copy, the owner's
  // own as itself. The viewer does not play them.
  const armatureHere = armatureInProgress !== null;
  for (const p of projects.filter((p) => p.mode === 'armature')) {
    grid.appendChild(armatureProjectCard(p, { owner, hasUnsavedWork: armatureHere }));
  }
  // Only projects with frames are shown publicly; empties live in the editor.
  for (const p of projects.filter((p) => p.mode !== 'scene' && p.mode !== 'armature' && p.frameCount > 0)) {
    grid.appendChild(owner ? ownerCard(p) : card(p));
  }
}

/** The gallery's foot, with accounts on: the legal pages (docs/accounts.md §9). */
function legalFoot(): HTMLElement {
  const foot = document.createElement('footer');
  foot.className = 'landing__foot';
  const link = (text: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
  };
  foot.append(link('Privacy', LEGAL.privacy), link('Terms', LEGAL.terms), link('Report content', LEGAL.takedown));
  return foot;
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
 * The ways to start, in a small dialog over the gallery: three buttons
 * stacked, the same width - a new sculpt, a new armature, and the uploader
 * for models and timelapses made elsewhere (owner call).
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
          <span class="create-choice__title">New Sculpt</span>
          <span class="create-choice__hint">A sphere of clay, brushes and paint.</span>
        </button>
        <button type="button" class="create-choice" data-kind="armature">
          <span class="create-choice__title">New Armature</span>
          <span class="create-choice__hint">A posable figure to reference, or to send to Sculpt as a base.</span>
        </button>
        <button type="button" class="create-choice" data-kind="timelapse">
          <span class="create-choice__title">Upload Model(s)</span>
          <span class="create-choice__hint">OBJ or GLB files from another app: one model, or frames played back as a timelapse.</span>
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
  // Work that is its project's as saved (inProject) loses nothing: there
  // is no card for it, and no question either.
  const atRisk = hasWork && !(await inProject(store));
  if (atRisk && !confirm('Start a new sculpt? The work in progress on this device will be replaced.')) {
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

/** Whether captured frames are kept on this device. */
async function framesKept(): Promise<boolean> {
  try {
    return await (await import('../sculpt/bridge/ScenePersist')).hasSculptFrames();
  } catch {
    return false;
  }
}

/**
 * The armature in progress on this device, if there is one. For whoever
 * saves to a server here it offers Save to library (owner request: the
 * card's upload, as the mode's File menu has it), to the project it came
 * from or was last saved to, else a new one; for a guest, the .armature
 * file the mode's Save writes.
 */
async function armatureCard(opts: { uploads: boolean; accounts: boolean; expired: boolean }): Promise<HTMLElement | null> {
  let file: Awaited<ReturnType<typeof import('../armature/persist').loadArmature>>;
  try {
    const store = await import('../armature/persist');
    file = await store.loadArmature();
  } catch {
    return null;
  }
  if (!file) return null;
  const rec = file;
  const card = div('card card--sculpt card--armature');
  // The picture is taken on the way out of the mode, as the sculpt card's
  // is; an armature not yet left that way has none.
  const url = file.thumb instanceof Blob ? URL.createObjectURL(file.thumb) : null;
  const picture = url
    ? `<img class="card__img-blur" aria-hidden="true" alt="" draggable="false" src="${url}" />
      <img class="card__img" alt="" draggable="false" src="${url}" />`
    : ''; // no picture: the gradient placeholder stands in
  card.innerHTML = `
    <a class="card__thumb" href="/?armature=1">
      ${picture}
      <span class="card__badge">In progress</span>
    </a>
    <div class="card__body">
      <a class="card__title card__link" href="/?armature=1">Your armature</a>
      <span class="card__meta"></span>
      <span class="card__note"></span>
    </div>`;
  const note = card.querySelector<HTMLElement>('.card__note')!;
  const where = (): string => (opts.accounts && rec.project?.scope !== 'admin' ? 'My projects' : 'Projects');
  const paintNote = (): void => {
    note.textContent = rec.project ? `In ${where()} as "${rec.project.title}"; the latest pose is on this device.` : DEVICE_ONLY_NOTE;
  };
  paintNote();
  const meta = card.querySelector<HTMLElement>('.card__meta')!;
  const posed = Object.keys(file.state.pose ?? {}).length;
  meta.textContent = `${posed} joint${posed === 1 ? '' : 's'} posed · ${ago(file.savedAt)}`;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card__action card__upload';
  const label = (): string => (opts.uploads ? 'Save to library' : 'Save file');
  b.textContent = label();
  b.title = opts.uploads ? (rec.project ? `Updates "${rec.project.title}" in ${where()}` : `Saves it to ${where()}`) : 'Downloads a .armature file to keep';
  b.addEventListener('click', () => {
    b.disabled = true;
    void (async () => {
      const [project, files, store] = await Promise.all([import('../armature/project'), import('../armature/file'), import('../armature/persist')]);
      if (!opts.uploads) {
        const { downloadBlob } = await import('./download');
        downloadBlob(files.packArmature(rec), files.armatureStamp());
        return;
      }
      const link = await project.uploadKeptArmature(rec, (text) => {
        b.textContent = text;
      });
      rec.project = link;
      // The autosave learns its project, so the mode saves back to it too.
      const now = await store.loadArmature();
      if (now) await store.saveArmature({ ...now, project: link });
      paintNote();
      b.textContent = `Saved to ${where()}`;
    })()
      .catch((err: unknown) => {
        b.textContent = label();
        const reason = uploadFailure(err);
        const why = err instanceof Error ? err.message : String(err);
        if (reason === 'expired') {
          const retry = (ok: boolean): void => {
            if (ok && b.isConnected) b.click();
          };
          const via = opts.expired ? 'session' : err instanceof AuthExpiredError ? err.via : undefined;
          failNotice('Your sign-in has expired. The armature stays on this device.', signInButton('', retry, 'Sign in again', via));
        } else if (reason === 'offline') {
          failNotice(`No connection. The armature stays on this device; try again when you are online.`);
        } else {
          failNotice(`Not saved to ${where()}: ${why.replace(/\.$/, '')}. The armature stays on this device.`);
        }
      })
      .finally(() => {
        b.disabled = false;
      });
  });
  card.querySelector<HTMLElement>('.card__body')!.appendChild(b);
  return card;
}

/**
 * Is the sculpt autosave its project's as saved, with nothing else of it
 * only here? A Save to library went up (or the project was opened) and
 * nothing has been edited since (SavedScene.synced), no copy a failed
 * save kept is waiting to go up, and no captured reel would go with it -
 * the project's own card opens the same work. The autosave stays, as the
 * recovery copy it is; it only needs no card of its own.
 */
async function inProject(store: typeof import('../sculpt/bridge/ScenePersist')): Promise<boolean> {
  const status = await store.loadSceneStatus();
  return !!status?.synced && !!status.project && !status.unsent && !(await framesKept());
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
 *
 * Work saved to the library and not touched since has no card: the
 * project's stands for it (inProject). Edited after that save, the card
 * comes back, named for what it is - unsaved changes to that project.
 */
async function sculptCard(): Promise<HTMLElement | null> {
  let snap: Awaited<ReturnType<typeof import('../sculpt/bridge/ScenePersist').loadSculptSnapshot>>;
  let status: Awaited<ReturnType<typeof import('../sculpt/bridge/ScenePersist').loadSceneStatus>>;
  try {
    // Imported lazily: the landing page should not pull in sculpt code just
    // to discover there is nothing saved.
    const store = await import('../sculpt/bridge/ScenePersist');
    if (!(await store.hasSavedScene())) return null;
    if (await inProject(store)) return null;
    status = await store.loadSceneStatus();
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
  // Changes made since the scene was saved to its project. Not for a save
  // that could not upload: that card is as it always was, beside the copy
  // the save kept.
  if (status?.project && !status.synced && !status.unsent) {
    a.querySelector<HTMLElement>('.card__title')!.textContent = `Unsaved changes to "${status.project.title}"`;
  }
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

/** Where Account's Delete account leaves its word for the gallery it ends on. */
const DELETED_KEY = 'bozzetto-account-deleted';

/** Say, once, on the next gallery, that the account was deleted (Account's Delete account). */
export function noteAccountDeleted(): void {
  try {
    sessionStorage.setItem(DELETED_KEY, '1');
  } catch {
    // Not said, then: the gallery is a guest's either way.
  }
}

function takeDeletedNotice(): boolean {
  try {
    const said = sessionStorage.getItem(DELETED_KEY) !== null;
    sessionStorage.removeItem(DELETED_KEY);
    return said;
  } catch {
    return false;
  }
}

/**
 * The local library: sculpts explicitly saved on this device. Unlike the
 * in-progress card these are a shelf you put things on, so each one can be
 * renamed and thrown away, which means the card cannot be a bare <a> - a
 * link with buttons inside it is neither valid nor operable.
 *
 * Two kinds sit on the shelf. A scene kept only here says so, in the words
 * every device-only copy uses, and for the owner offers Upload to Projects
 * - with accounts on, Upload to My projects, for anyone signed in. A
 * device copy of a project (projectId set) is the cache Save to library
 * keeps for offline opens; the owner's list shows the project itself, so
 * the copy appears only when that list could not be had, marked In
 * Projects (In My projects).
 */
async function libraryCards(
  onChange: () => void,
  hasUnsavedWork: boolean,
  opts: { owner: boolean; listed: Set<string>; expired: boolean; accounts: boolean; signedIn: boolean },
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
    // simply be private.) A copy a failed save kept says that, and offers
    // the upload again to whoever has the gallery, since it was the
    // owner's save: an expired sign-in is told so when it is tapped.
    const inProjects = !!e.projectId && !opts.owner;
    // Where its project is, or where an upload sends it: with accounts on,
    // My projects, unless it is the owner tools' (a template edited from
    // Projects, SceneLink.scope).
    let scope = e.scope;
    const place = (): string => (opts.accounts && scope !== 'admin' ? 'My projects' : 'Projects');
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
      badge.textContent = `In ${place()}`;
      thumb.href = `/?sculpt=1&project=${encodeURIComponent(projectId)}${scope === 'admin' ? '&scope=admin' : ''}`;
    };
    if (inProjects) {
      markInProjects(e.projectId!);
    } else {
      badge.textContent = e.unsent ? 'Not uploaded' : 'Saved';
      thumb.href = `/?sculpt=1&lib=${encodeURIComponent(e.id)}`;
      const note = document.createElement('span');
      note.className = 'card__note';
      note.textContent = DEVICE_ONLY_NOTE;
      body.appendChild(note);
      if (opts.owner || e.unsent || (opts.accounts && opts.signedIn)) body.appendChild(uploadButton());
    }

    /**
     * Upload to Projects (with accounts on, My projects): the stored bytes
     * as they are, then this card becomes the project's copy. An unsent
     * re-save updates its project. A failed upload leaves the card as it
     * was - the scene is still here - and says what to do next.
     */
    function uploadButton(): HTMLButtonElement {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card__action card__upload';
      b.textContent = `Upload to ${place()}`;
      b.addEventListener('click', () => {
        b.disabled = true;
        void (async () => {
          const bytes = await lib.loadLibraryBytes(key);
          if (!bytes) throw new Error('This scene could not be read from the device');
          const { uploadScene } = await import('../sculpt/bridge/SceneProjects');
          const link = await uploadScene(
            { bytes, title: e.name, objects: e.objects, tris: e.tris, thumb: e.thumb, projectId: e.uploadTo, scope },
            (text) => {
              b.textContent = text;
            },
          );
          const moved = await lib.markUploaded(key, link.id, link.title, link.scope);
          key = moved?.id ?? key;
          scope = link.scope;
          body.querySelector('.card__note')?.remove();
          b.remove();
          markInProjects(link.id);
        })().catch((err: unknown) => {
          b.disabled = false;
          b.textContent = `Upload to ${place()}`;
          const reason = uploadFailure(err);
          if (reason === 'expired') {
            // Signed in again in the dialog (accounts on), the upload goes again.
            const retry = (ok: boolean): void => {
              if (ok && b.isConnected) b.click();
            };
            // A sign-in the probe found expired is the account's (with
            // accounts on), whatever the owner route answered.
            const via = opts.expired ? 'session' : err instanceof AuthExpiredError ? err.via : undefined;
            failNotice('Your sign-in has expired. The scene stays on this device.', signInButton('', retry, 'Sign in again', via));
          } else if (reason === 'suspended') {
            failNotice(`${err instanceof Error ? err.message : String(err)} The scene stays on this device.`);
          } else if (reason === 'full') {
            // The server's numbers: "Your storage is full (248 of 250 MB)".
            failNotice(`${err instanceof Error ? err.message : String(err)}. The scene stays on this device; make room in ${place()}, then try again.`);
          } else if (reason === 'offline') {
            failNotice(`No connection. The scene stays on this device; use Upload to ${place()} when you are online.`);
          } else {
            failNotice(`Upload failed: ${err instanceof Error ? err.message : String(err)}. Nothing changed on this device.`);
          }
        });
      });
      return b;
    }

    // Opening replaces whatever is in the autosave slot, and the autosave
    // overwrites it seconds later - the same trap Open file guards, so the
    // same guard: ask, but only when there is unsaved work to lose. Asked
    // (or with nothing to ask about), the tab says so for Sculpt, which
    // otherwise asks again: a link to the same address can come from
    // anywhere (ui/openToken).
    thumb.addEventListener('click', (ev) => {
      if (hasUnsavedWork && !confirm(`Open "${e.name}"? Your work in progress will be replaced.`)) {
        ev.preventDefault();
        return;
      }
      markOpenOnClick(ev, thumb);
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
        ? `Delete this device's copy of "${e.name}"? The scene stays in ${place()}.`
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
      actionFailed('Rename failed', err);
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
 * Where a scene's card opens it in Sculpt. A template opens as a copy, for
 * everyone, the owner included, so saving it makes a project of one's own
 * (docs/accounts.md §5); the owner edits the template itself from
 * Projects. The owner's own scene opens as itself, from the server, with
 * this device's copy as the offline fallback.
 */
const sceneHref = (p: ProjectSummary): string =>
  `/?sculpt=1&${p.template ? 'template' : 'project'}=${encodeURIComponent(p.id)}`;

/**
 * A scene from the server, as a card that opens it in Sculpt (sceneHref).
 * For the owner it carries what the device shelf's cards do - rename,
 * delete - and who may see it.
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
  setPicture(thumb, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  const badges = card.querySelector<HTMLElement>('.card__badges')!;
  // Made public, the owner's scene becomes a template (visibilityToggle),
  // and from then on opens as a copy: the link follows the badges.
  const paintBadges = (): void => {
    thumb.href = sceneHref(p);
    setBadges(badges, ['Scene', ...kindBadges(p)]);
  };
  paintBadges();
  const title = card.querySelector<HTMLElement>('.card__title')!;
  title.textContent = p.title || p.id;
  card.querySelector<HTMLElement>('.card__meta')!.textContent = p.scene
    ? `${p.scene.objects} object${p.scene.objects === 1 ? '' : 's'} · ` +
      `${p.scene.tris.toLocaleString('en-US')} tris · ${mb(p.scene.bytes)} · ${ago(p.updated_at)}`
    : 'Upload did not finish';
  thumb.addEventListener('click', (ev) => {
    const what = p.template ? `a copy of "${p.title}"` : `"${p.title}"`;
    if (opts.hasUnsavedWork && !confirm(`Open ${what}? Your work in progress will be replaced.`)) {
      ev.preventDefault();
      return;
    }
    markOpenOnClick(ev, thumb);
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
        actionFailed('Delete failed', err);
      });
  });
  card.appendChild(trash);
  return card;
}

/**
 * An armature project from the server, as a card that opens it in
 * Armature mode: a template as a copy (`&template=`, for everyone, so a
 * save makes one's own), the owner's own as itself (`&project=`). The
 * viewer does not play an armature, and the card says where it opens. For
 * the owner it carries who may see it, as every card of theirs does.
 */
function armatureProjectCard(p: ProjectSummary, opts: { owner: boolean; hasUnsavedWork: boolean }): HTMLElement {
  const card = div('card card--library card--armature-project');
  card.dataset.project = p.id;
  card.innerHTML = `
    <a class="card__thumb">
      <span class="card__badges"></span>
    </a>
    <div class="card__body">
      <a class="card__title card__link"></a>
      <span class="card__meta"></span>
    </div>`;
  const thumb = card.querySelector<HTMLAnchorElement>('.card__thumb')!;
  const title = card.querySelector<HTMLAnchorElement>('.card__title')!;
  setPicture(thumb, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  const badges = card.querySelector<HTMLElement>('.card__badges')!;
  const paintBadges = (): void => {
    const href = `/?armature=1&${p.template ? 'template' : 'project'}=${encodeURIComponent(p.id)}`;
    thumb.href = href;
    title.href = href;
    setBadges(badges, ['Armature', ...kindBadges(p)]);
  };
  paintBadges();
  title.textContent = p.title || p.id;
  card.querySelector<HTMLElement>('.card__meta')!.textContent =
    `${p.template ? 'Opens a copy in Armature mode' : 'Opens in Armature mode'} · ${ago(p.updated_at)}`;
  for (const link of [thumb, title]) {
    link.addEventListener('click', (ev) => {
      const what = p.template ? `a copy of "${p.title}"` : `"${p.title}"`;
      if (opts.hasUnsavedWork && !confirm(`Open ${what}? The armature in progress on this device will be replaced.`)) {
        ev.preventDefault();
        return;
      }
      markOpenOnClick(ev, link);
    });
  }
  if (opts.owner) card.querySelector<HTMLElement>('.card__body')!.appendChild(visibilityToggle(p, paintBadges));
  return card;
}

/**
 * The owner's Public/Private switch on a card: a checkbox labelled Private,
 * so which way it points is never in doubt. Made public, a project becomes
 * a template, as the server answers. The badges follow once the server has
 * agreed; a refusal puts the box back.
 */
function visibilityToggle(p: ProjectSummary, repaint: () => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'card__vis';
  label.title = VISIBILITY_HINT;
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
        if (typeof row.template === 'boolean') p.template = row.template;
        if (typeof row.media === 'string') p.media = row.media;
        box.checked = p.visibility === 'private';
        repaint();
      })
      .catch((err: Error) => {
        box.checked = p.visibility === 'private';
        actionFailed(`Could not change who sees "${p.title}"`, err);
      })
      .finally(() => {
        box.disabled = false;
      });
  });
  return label;
}

/**
 * An owner's action on a card that the server did not take. The session
 * having expired since the page drew is said as that, with the way back
 * in; anything else is the server's own words, as before.
 */
function actionFailed(what: string, err: Error): void {
  if (err instanceof AuthExpiredError) {
    failNotice(`${what}: your sign-in has expired.`, signInButton('', undefined, 'Sign in again', err.via));
    return;
  }
  alert(`${what}: ${err.message}`);
}

/** The badges that say what a project is to the gallery: a template, and private. */
const kindBadges = (p: ProjectSummary): string[] => [
  ...(p.template ? ['Template'] : []),
  ...(p.visibility === 'private' ? ['Private'] : []),
];

/** Badges that state a project's standing rather than its kind wear no fill. */
const QUIET_BADGES: Record<string, string> = { Private: 'card__badge--private', Template: 'card__badge--template' };

function setBadges(host: HTMLElement, labels: string[]): void {
  host.replaceChildren(
    ...labels.map((text) => {
      const b = document.createElement('span');
      b.className = `card__badge${QUIET_BADGES[text] ? ` ${QUIET_BADGES[text]}` : ''}`;
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
export function setPicture(thumb: HTMLElement, path: string): void {
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
      // A template's picture on the files host is asked for with CORS.
      setThumbSrc(img, src);
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

  // A number, made one: this goes into innerHTML, and the list is the
  // server's word, not the app's.
  const count = Number(p.frameCount) || 0;
  const frames = count > 0 ? `${count} frame${count === 1 ? '' : 's'}` : 'no frames yet';

  a.innerHTML = `
    <div class="card__thumb"><span class="card__badges"></span></div>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta">
        <span class="badge">${p.mode === 'model' ? 'model' : 'timelapse'}</span>
        <span>${frames}</span>
      </span>
    </div>`;
  // textContent (not innerHTML) for the title — never trust stored strings.
  a.querySelector<HTMLElement>('.card__title')!.textContent = p.title || p.id;
  setBadges(a.querySelector<HTMLElement>('.card__badges')!, kindBadges(p));
  // No thumbnail yet: setPicture drops both layers, and the gradient shows.
  setPicture(a.querySelector<HTMLElement>('.card__thumb')!, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  return a;
}

/**
 * A published project in the owner's gallery: the guest's card plus who may
 * see it - the Template and Private badges, and the switch. With a control
 * on it, the card is a div with links inside rather than a link around
 * everything.
 */
function ownerCard(p: ProjectSummary): HTMLElement {
  const card = div('card card--library card--owned');
  card.dataset.project = p.id;
  const href = `?tl=${encodeURIComponent(p.id)}`;
  // A number, made one: this goes into innerHTML (see card()).
  const count = Number(p.frameCount) || 0;
  const frames = `${count} frame${count === 1 ? '' : 's'}`;
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
  const paintBadges = (): void => setBadges(badges, kindBadges(p));
  paintBadges();
  card.querySelector<HTMLElement>('.card__body')!.appendChild(visibilityToggle(p, paintBadges));
  return card;
}
