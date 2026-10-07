import {
  AuthExpiredError,
  checkSignIn,
  mediaPath,
  memberProjects,
  roleOf,
  type ProjectSummary,
  type SignIn,
} from '../../admin/api';
import { dayOf, errorText, getMe, loadConfig, sizeOfText, sizeText, suspensionText, type Me } from '../../net/account';
import { apiFetch } from '../../net/origin';
import { failNotice } from '../../sculpt/ui/statusToast';
import { downloadBlob } from '../download';
import { setPicture } from '../Landing';
import { markOpenOnClick } from '../openToken';
import { signInAgain, signInButton } from '../signIn';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { accountChips } from './menu';
import { Say, button, el } from './parts';

/**
 * My projects (`/?me`, docs/accounts.md §7): the account's own work, with
 * the storage it takes.
 *
 * - A storage meter: what is stored, what uploads in progress hold, and the
 *   quota, as GET /api/me counts them.
 * - A card per project (GET /api/me/projects): its picture, through the
 *   private media route and kept by nothing; its title, renamed in place
 *   (at most 200 characters, as the server keeps); its mode, size and date.
 * - Open: Sculpt for a scene, through the account's own routes (falling
 *   back to this device's copy, as Sculpt does); the viewer for a
 *   timelapse or a model. Download: the scene's .bozz, or a zip of the
 *   frames (client-zip). Delete, asked first, from the server and from
 *   this device's shelf.
 *
 * Offline it is read only: the worker's last copy of the list draws the
 * cards (vite.config.ts), Open works for a scene this device has a copy
 * of, and everything else waits for the connection.
 */

/** The longest title the server keeps (functions/_shared/projects.ts). */
const MAX_TITLE = 200;

/** What the page listens to for the connection coming or going; the next drawing takes it over. */
let connection: AbortController | null = null;

interface Page {
  app: HTMLElement;
  me: Me;
  meter: Meter;
  grid: HTMLElement;
  say: Say;
  /** Read only: no connection, so the cards are the worker's last copy of the list. */
  offline: boolean;
  /** Ids this device keeps a copy of, which Sculpt opens offline. */
  copies: Set<string>;
  /** Whether opening a scene would replace work in progress here (the autosave, or captured frames). */
  workHere: boolean;
}

export async function renderMyProjects(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  document.title = 'My projects · Bozzetto';
  const page = el('div', 'landing account-page my-projects');
  const head = el('header', 'landing__head');
  const titles = el('div');
  titles.append(el('h1', 'landing__title', 'My projects'));
  head.appendChild(titles);
  const host = el('div', 'my-projects__body');
  page.append(head, host);
  app.replaceChildren(page);
  galleryChip();

  const config = await loadConfig();
  const signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
  if (config?.accounts) chips(signIn, app);
  if (!config?.accounts) {
    host.appendChild(el('p', 'muted', 'Accounts are not open on this site.'));
    return;
  }
  if (signIn.suspended) {
    host.appendChild(el('p', 'account-say', suspensionText(signIn.suspended.reason)));
    return;
  }
  const me = signIn.me;
  if (!me) {
    const again = button('Sign in', 'btn btn--primary');
    again.addEventListener('click', () => {
      again.disabled = true;
      void signInAgain(undefined, signIn.expired ? undefined : 'Sign in to see your projects.')
        .then((ok) => {
          if (ok) void renderMyProjects(app);
        })
        .finally(() => {
          again.disabled = false;
        });
    });
    host.append(el('p', 'muted', signIn.expired ? 'Your sign-in has expired.' : 'Sign in to see your projects.'), again);
    return;
  }
  titles.appendChild(el('p', 'landing__tagline', `@${me.handle}`));

  const meter = new Meter();
  meter.set(me.usage);
  const say = new Say();
  const grid = el('div', 'landing__grid my-projects__grid');
  host.append(meter.root, say.root, grid);

  let projects: ProjectSummary[];
  try {
    projects = await memberProjects.list();
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      say.error('Your sign-in has expired.');
      say.root.append(' ', signInButton('account-linkbtn', (ok) => (ok ? void renderMyProjects(app) : undefined)));
    } else {
      say.error(`Your projects could not be loaded: ${loadText(err)}`);
    }
    return;
  }
  const state: Page = {
    app,
    me,
    meter,
    grid,
    say,
    offline: !navigator.onLine,
    copies: await deviceCopies(),
    workHere: await workInProgress(),
  };
  if (state.offline) {
    say.note(
      "You are offline: this is the list as it was when you were last here. A scene this device has a copy of opens; the rest waits for the connection.",
    );
  }
  // The page again when the connection comes or goes: read only offline,
  // live online. One listener at a time, whichever drawing set it.
  connection?.abort();
  connection = new AbortController();
  window.addEventListener(state.offline ? 'online' : 'offline', () => void renderMyProjects(app), {
    once: true,
    signal: connection.signal,
  });
  if (projects.length === 0) {
    grid.appendChild(emptyNote());
    return;
  }
  for (const p of projects) grid.appendChild(projectCard(state, p));
}

/** The top row: back to the gallery on the left, the account's chips on the right. */
function galleryChip(): void {
  const left = topbarLeft();
  if (left.querySelector('.viewer-back')) return;
  const back = topChip('← Gallery', '/');
  back.classList.add('viewer-back');
  left.appendChild(back);
}

function chips(signIn: SignIn, app: HTMLElement): void {
  const bar = topbarRight();
  bar.querySelectorAll('.landing-chip').forEach((c) => c.remove());
  for (const c of accountChips(signIn, roleOf(signIn), () => void renderMyProjects(app))) {
    c.classList.add('landing-chip');
    bar.appendChild(c);
  }
}

/** Why the list would not come, as the end of a sentence. */
function loadText(err: unknown): string {
  if (err instanceof TypeError) return 'No connection. Check it, then try again.';
  return errorText(err);
}

function emptyNote(): HTMLElement {
  return el(
    'p',
    'muted my-projects__empty',
    "Nothing here yet. In Sculpt, Save to library keeps a scene here, and the Capture window's Publish keeps a timelapse or a model.",
  );
}

/** The ids of projects this device keeps a copy of (the shelf, SceneLibrary). */
async function deviceCopies(): Promise<Set<string>> {
  try {
    const lib = await import('../../sculpt/bridge/SceneLibrary');
    return new Set((await lib.listLibrary()).map((e) => e.projectId).filter((id): id is string => !!id));
  } catch {
    return new Set();
  }
}

/** Whether opening a scene would replace something here: the sculpt in progress, or frames captured. */
async function workInProgress(): Promise<boolean> {
  try {
    const store = await import('../../sculpt/bridge/ScenePersist');
    return (await store.hasSavedScene()) || (await store.hasSculptFrames());
  } catch {
    return false;
  }
}

// --- the meter --------------------------------------------------------------------------

/**
 * Storage: what the account stores, what its uploads in progress hold
 * meanwhile, and its quota (GET /api/me's usage), as a bar and a line.
 */
class Meter {
  readonly root = el('section', 'account-section my-storage');
  private readonly bar = el('div', 'storage-meter');
  private readonly used = el('span', 'storage-meter__used');
  private readonly reserved = el('span', 'storage-meter__reserved');
  private readonly line = el('p', 'account-small storage-meter__text');

  constructor() {
    this.root.dataset.section = 'storage';
    this.root.appendChild(el('h2', 'account-section__title', 'Storage'));
    this.bar.setAttribute('role', 'meter');
    this.bar.setAttribute('aria-label', 'Storage used');
    this.bar.append(this.used, this.reserved);
    this.root.append(this.bar, this.line);
  }

  set(usage: Me['usage']): void {
    const quota = Math.max(1, usage.quota);
    const usedPct = Math.min(100, (usage.used / quota) * 100);
    const heldPct = Math.min(100 - usedPct, (usage.reserved / quota) * 100);
    this.used.style.width = `${usedPct}%`;
    this.reserved.style.width = `${heldPct}%`;
    const taken = usage.used + usage.reserved;
    const full = taken >= usage.quota;
    let text = `${sizeOfText(usage.used, usage.quota)} used`;
    if (usage.reserved > 0) text += ` · ${sizeText(usage.reserved)} held by an upload in progress`;
    if (full) text += '. Your storage is full: delete something to make room.';
    this.line.textContent = text;
    this.root.dataset.full = String(full);
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', String(usage.quota));
    this.bar.setAttribute('aria-valuenow', String(Math.min(taken, usage.quota)));
    this.bar.setAttribute('aria-valuetext', text);
  }
}

/** The meter again, from the server, after something changed what the account stores. */
async function refreshMeter(page: Page): Promise<void> {
  try {
    const me = await getMe();
    if (me) {
      page.me = me;
      page.meter.set(me.usage);
    }
  } catch {
    // The meter stays as it was until the page is drawn again.
  }
}

// --- the cards ---------------------------------------------------------------------------

const MODES: Record<string, string> = { scene: 'Scene', timelapse: 'Timelapse', model: 'Model' };
const modeLabel = (p: ProjectSummary): string => MODES[p.mode] ?? p.mode;

/** Where Open goes, or null when there is nothing to open yet. */
function openHref(p: ProjectSummary): string | null {
  if (p.mode === 'scene') return p.scene ? `/?sculpt=1&project=${encodeURIComponent(p.id)}` : null;
  return p.frameCount > 0 ? `/?tl=${encodeURIComponent(p.id)}` : null;
}

/** What is in it, for the card's line: objects for a scene, frames for the rest. */
function contents(p: ProjectSummary): string {
  if (p.mode === 'scene') {
    if (!p.scene) return 'upload did not finish';
    return `${p.scene.objects} object${p.scene.objects === 1 ? '' : 's'}`;
  }
  const n = Number(p.frameCount) || 0;
  return n > 0 ? `${n} frame${n === 1 ? '' : 's'}` : 'no frames yet';
}

/** A title made safe as a file name: the characters no system takes, gone. */
function fileBase(title: string, fallback: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[.-]+|[.-]+$/g, '');
  return base || fallback;
}

function projectCard(page: Page, p: ProjectSummary): HTMLElement {
  const card = el('div', 'card card--library card--mine');
  card.dataset.project = p.id;
  card.innerHTML = `
    <a class="card__thumb">
      <span class="card__badges"></span>
    </a>
    <div class="card__body">
      <span class="card__title"></span>
      <span class="card__meta"></span>
      <div class="card__actions"></div>
    </div>`;
  const thumb = card.querySelector<HTMLAnchorElement>('.card__thumb')!;
  const title = card.querySelector<HTMLElement>('.card__title')!;
  const meta = card.querySelector<HTMLElement>('.card__meta')!;
  const actions = card.querySelector<HTMLElement>('.card__actions')!;
  const badge = el('span', 'card__badge', modeLabel(p));
  card.querySelector('.card__badges')!.appendChild(badge);
  // Through the private route, which every cache leaves alone (vite.config.ts);
  // offline there is none, and the gradient stands in.
  if (!page.offline) setPicture(thumb, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
  title.textContent = p.title || 'Untitled';
  const paintMeta = (): void => {
    meta.textContent = `${modeLabel(p)} · ${contents(p)} · ${sizeText(p.bytes ?? 0)} · ${dayOf(p.updated_at)}`;
  };
  paintMeta();

  // Open: Sculpt for a scene, the viewer for the rest. Offline, only a
  // scene this device has a copy of can open (Sculpt falls back to it).
  const href = openHref(p);
  const canOpen = !!href && (!page.offline || (p.mode === 'scene' && page.copies.has(p.id)));
  const open = el('a', 'card__action card__open', 'Open');
  if (href && canOpen) {
    open.href = href;
    thumb.href = href;
    const ask = (ev: MouseEvent, link: HTMLAnchorElement): void => {
      if (p.mode === 'scene' && page.workHere && !confirm(`Open "${p.title}"? Your work in progress will be replaced.`)) {
        ev.preventDefault();
        return;
      }
      markOpenOnClick(ev, link);
    };
    open.addEventListener('click', (ev) => ask(ev, open));
    thumb.addEventListener('click', (ev) => ask(ev, thumb));
  } else {
    open.setAttribute('aria-disabled', 'true');
    open.classList.add('card__action--off');
  }

  const download = button('Download', 'card__action card__download');
  const rename = button('Rename', 'card__action card__rename');
  const remove = button('Delete', 'card__action card__delete');
  download.disabled = page.offline || !href;
  rename.disabled = page.offline;
  remove.disabled = page.offline;
  actions.append(open, download, rename, remove);

  download.addEventListener('click', () => void downloadProject(page, p, download));

  rename.addEventListener('click', () => {
    const form = el('form', 'account-rename my-rename');
    const box = el('input', 'account-input');
    box.type = 'text';
    box.name = 'title';
    box.maxLength = MAX_TITLE;
    box.value = p.title;
    box.setAttribute('aria-label', 'Title');
    box.autocomplete = 'off';
    const save = button('Save', 'card__action card__save');
    save.type = 'submit';
    const cancel = button('Cancel', 'card__action');
    form.append(box, save, cancel);
    title.replaceWith(form);
    rename.disabled = true;
    box.focus();
    box.select();
    const done = (): void => {
      form.replaceWith(title);
      rename.disabled = page.offline;
    };
    cancel.addEventListener('click', done);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = box.value.trim().slice(0, MAX_TITLE);
      if (!next || next === p.title) {
        done();
        return;
      }
      save.disabled = true;
      void memberProjects
        .rename(p.id, next)
        .then(async (row) => {
          p.title = row.title;
          title.textContent = row.title;
          done();
          // This device's copy goes by the same name.
          const lib = await import('../../sculpt/bridge/SceneLibrary');
          await lib.renameLibraryScene(p.id, row.title).catch(() => undefined);
        })
        .catch((err: unknown) => {
          save.disabled = false;
          failed(page, `Could not rename "${p.title}"`, err);
        });
    });
  });

  remove.addEventListener('click', () => {
    if (!confirm(`Delete "${p.title}"? It goes from My projects and from this device, and cannot be undone.`)) return;
    remove.disabled = true;
    void memberProjects
      .remove(p.id)
      .then(async () => {
        // Its device copy too: left behind it would come back on the
        // gallery as a scene kept only here.
        const lib = await import('../../sculpt/bridge/SceneLibrary');
        await lib.deleteLibraryScene(p.id).catch(() => undefined);
        card.remove();
        if (!page.grid.querySelector('.card--mine')) page.grid.appendChild(emptyNote());
        await refreshMeter(page);
      })
      .catch((err: unknown) => {
        remove.disabled = false;
        failed(page, `Could not delete "${p.title}"`, err);
      });
  });
  return card;
}

/**
 * Download: a scene's .bozz as it is stored, or a zip of a timelapse's or
 * a model's frames, with its settings (project.json) and picture, made here
 * with client-zip one frame at a time. The button says how far it has got.
 */
async function downloadProject(page: Page, p: ProjectSummary, b: HTMLButtonElement): Promise<void> {
  b.disabled = true;
  const label = b.textContent;
  try {
    if (p.mode === 'scene') {
      b.textContent = 'Downloading…';
      const res = await apiFetch(mediaPath(p, 'scene.bozz?download=1'));
      // The private route answers a request without a session as it answers
      // a missing file (404): who is signed in tells the two apart.
      if (res.status === 401 || (res.status === 404 && (await getMe().catch(() => undefined)) === null)) {
        throw new AuthExpiredError('session');
      }
      if (!res.ok || !res.bytes) throw new Error(`the server could not send it (${res.status})`);
      downloadBlob(new Blob([res.bytes], { type: 'application/x-bozzetto' }), `${fileBase(p.title, 'scene')}.bozz`);
      return;
    }
    const manifest = (await memberProjects.get(p.id)) as { frames?: { index: number; sd: string }[] };
    const frames = (manifest.frames ?? []).map((f) => ({ index: f.index, url: f.sd }));
    if (frames.length === 0) throw new Error('it has no frames yet');
    const [{ frameFiles, slug }, { writeZip }] = await Promise.all([import('./archive'), import('./zip')]);
    await writeZip(
      { kind: 'download', name: `${slug(p.title)}.zip` },
      frameFiles(p, manifest, frames, mediaPath(p, `thumb.jpg?v=${p.updated_at}`), (done, of) => {
        b.textContent = `Downloading ${done} of ${of}…`;
      }),
    );
  } catch (err) {
    failed(page, `Could not download "${p.title}"`, err);
  } finally {
    b.textContent = label;
    b.disabled = page.offline;
  }
}

/**
 * An action the server did not take: a sign-in gone is said with the way
 * back in, which draws the page again; anything else in its own words.
 */
function failed(page: Page, what: string, err: unknown): void {
  if (err instanceof AuthExpiredError) {
    failNotice(
      `${what}: your sign-in has expired.`,
      signInButton('', (ok) => (ok ? void renderMyProjects(page.app) : undefined), 'Sign in again', 'session'),
    );
    return;
  }
  const why = err instanceof TypeError ? 'no connection' : err instanceof Error ? err.message : String(err);
  page.say.error(`${what}: ${why.replace(/\.$/, '')}.`);
}
