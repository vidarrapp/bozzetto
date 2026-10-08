import { OwnerSessionError, TEMPLATE_HINT, VISIBILITY_HINT, api, failureText, mediaPath, setThumbSrc } from './api';
import type { ProjectSummary } from './api';
import { renderEditor } from './editor';
import { ownerSignIn, ownerSignInPanel } from './ownerSession';
import { AccountError, bootstrapOwner, errorText, loadConfig, whoami } from '../net/account';
import { HandleField, Say, termsBox } from '../ui/account/parts';
import { initTheme, mountThemeToggle } from '../ui/theme';
import { followPanelOpacity } from '../ui/appearance';
import { installSliderBubble } from '../ui/sliderBubble';
import { topbarRight } from '../ui/topbar';
import { signOutChip } from '../ui/signIn';
import { isProjectId } from '../net/ids';
import { markOpen } from '../ui/openToken';

/**
 * Editor router. `/admin/?p=<id>` opens the per-project editor (frame upload,
 * preview, settings); with no `p` it shows the project list + create form,
 * and with accounts on, tabs beside it for the owner's tools over accounts
 * (`?tab=invites|users|audit`). Navigation uses plain links (full reload),
 * so each view starts clean and the preview's WebGL context is never leaked
 * across views.
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

/**
 * The tabs of /admin/ (docs/accounts.md §8): Projects, and with accounts
 * on and the owner's account made, the owner's tools over accounts -
 * Invites, Users and the Audit log. A tab is a plain link (`?tab=`), so each
 * starts clean, as the editor's views do.
 */
type Tab = 'projects' | 'invites' | 'users' | 'audit';

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['projects', 'Projects'],
  ['invites', 'Invites'],
  ['users', 'Users'],
  ['audit', 'Audit'],
];

/** The tab the address asks for; Projects for anything else. */
function wantedTab(): Tab {
  const asked = new URLSearchParams(window.location.search).get('tab');
  return TABS.find(([t]) => t === asked)?.[0] ?? 'projects';
}

/** Where a tab is: /admin/ for Projects, `?tab=` for the rest. */
const tabHref = (tab: Tab): string => (tab === 'projects' ? '/admin/' : `/admin/?tab=${tab}`);

async function renderAdmin(host: HTMLElement, wanted: Tab): Promise<void> {
  host.innerHTML = `
    <div class="admin">
      <div class="topbar topbar--left"><a class="topchip" href="/">← Gallery</a></div>
      <header class="admin__head">
        <h1>Bozzetto editor</h1>
      </header>
      <div id="owner-account"></div>
      <nav class="admin-tabs" id="admin-tabs" aria-label="Owner tools" hidden></nav>
      <div id="admin-tab"></div>
    </div>`;
  const body = host.querySelector<HTMLElement>('#admin-tab')!;
  // This page is only reached signed in (Access fronts it), so the way out
  // is always offered, beside the theme toggle. Drawn again after a sign-in
  // (renderAdmin runs again), so one chip, not a second beside the first.
  topbarRight().querySelector('.admin-signout')?.remove();
  const out = signOutChip();
  out.classList.add('admin-signout');
  topbarRight().appendChild(out);
  // With accounts on, the owner's account: made here the first time
  // (bootstrap), and signed in for the second lock after that.
  const gate = await ownerAccount(host.querySelector<HTMLElement>('#owner-account')!, () => void renderAdmin(host, wanted));
  if (!gate.go) return;
  // The tabs over accounts are there once there are accounts, and an owner
  // to use them; before that, the address's tab is Projects.
  const tab = gate.owner ? wanted : 'projects';
  if (tab !== wanted) {
    const url = new URL(window.location.href);
    url.searchParams.delete('tab');
    history.replaceState(history.state, '', url);
  }
  if (gate.owner) drawTabs(host.querySelector<HTMLElement>('#admin-tabs')!, tab);
  switch (tab) {
    case 'invites':
      return (await import('./invites')).renderInvites(body);
    case 'users':
      return (await import('./users')).renderUsers(body);
    case 'audit':
      return (await import('./audit')).renderAudit(body);
    default:
      return renderProjects(body);
  }
}

function drawTabs(nav: HTMLElement, current: Tab): void {
  nav.replaceChildren(
    ...TABS.map(([tab, label]) => {
      const a = document.createElement('a');
      a.className = `admin-tab${tab === current ? ' admin-tab--current' : ''}`;
      a.href = tabHref(tab);
      a.textContent = label;
      a.dataset.tab = tab;
      if (tab === current) a.setAttribute('aria-current', 'page');
      return a;
    }),
  );
  nav.hidden = false;
}

/** The Projects tab: the create form and the owner's list. */
async function renderProjects(body: HTMLElement): Promise<void> {
  body.innerHTML = `
    <form class="admin-create" id="create-form">
      <input name="title" placeholder="New project title" required autofocus />
      <button type="submit" class="btn btn--primary">Create</button>
    </form>
    <p class="admin__hint muted">The project id is derived from the title; you can set the frame rate and mode on the next page.</p>
    <div class="admin-list" id="project-list"></div>`;
  const list = body.querySelector<HTMLElement>('#project-list')!;
  const form = body.querySelector<HTMLFormElement>('#create-form')!;

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

/**
 * The owner's account, with accounts on (docs/accounts.md §8): whether the
 * page may go on to its tab (`go`), and whether there is an owner's account
 * signed in here to use the tools over accounts (`owner`). Accounts off,
 * there is nothing to do, and no such tools. With no owner account yet,
 * "Create your account" is offered above the list, which Access alone
 * still opens. With one, and no owner's session here (403 owner_session),
 * the sign-in dialog opens over the page, and the page draws itself again
 * once signed in; until then it says why the list is not there.
 */
async function ownerAccount(slot: HTMLElement, again: () => void): Promise<{ go: boolean; owner: boolean }> {
  slot.replaceChildren();
  const config = await loadConfig();
  if (!config?.accounts) return { go: true, owner: false };
  try {
    const who = await whoami();
    if (who.owner === null) slot.appendChild(bootstrapForm(who.email, again));
    return { go: true, owner: who.owner !== null };
  } catch (err) {
    if (err instanceof AccountError && err.code === 'owner_session') {
      if (await ownerSignIn(true)) {
        again();
        return { go: false, owner: false };
      }
      slot.appendChild(ownerSignInPanel(again));
      return { go: false, owner: false };
    }
    // Anything else - Access's own refusal, no connection - is the list's
    // to say, as it always has.
    return { go: true, owner: false };
  }
}

/**
 * "Create your account": the owner's account, made once from the Access
 * identity, with a handle and the terms; the projects the owner had
 * before accounts become its own. It signs the owner in and offers a
 * passkey, then the page draws itself again behind both locks.
 */
function bootstrapForm(email: string, again: () => void): HTMLElement {
  const form = document.createElement('form');
  form.className = 'admin__bootstrap account-step';
  form.noValidate = true;
  const title = document.createElement('h2');
  title.textContent = 'Create your account';
  const lede = document.createElement('p');
  lede.className = 'muted';
  lede.textContent =
    `Accounts are on, and the owner has no account yet. Make yours: it takes the address Cloudflare Access ` +
    `signed you in with (${email}), with a 10 GB quota, and the projects you have now become its own. ` +
    'From then on, the owner tools want it signed in as well as Access.';
  const handle = new HandleField('Handle', null, true);
  const terms = termsBox();
  const say = new Say();
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = 'Create account';
  form.append(title, lede, handle.root, terms.root, submit, say.root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void (async () => {
      say.clear();
      if (!(await handle.check())) {
        handle.input.focus();
        return;
      }
      if (!terms.box.checked) {
        say.error('Tick the box to confirm you are 13 or older and accept the Terms.');
        return;
      }
      submit.disabled = true;
      say.note('Creating your account…');
      try {
        const me = await bootstrapOwner(handle.value);
        say.note(`Your account is @${me.handle}.`);
        const { offerPasskey } = await import('../ui/account/signIn');
        await offerPasskey(me);
        again();
      } catch (err) {
        submit.disabled = false;
        if (err instanceof AccountError && err.code === 'owner_exists') {
          again();
          return;
        }
        if (err instanceof AccountError && (err.code === 'handle_taken' || err.reason)) {
          handle.refused(err.reason);
          say.clear();
          return;
        }
        say.error(errorText(err));
      }
    })();
  });
  return form;
}

async function refresh(listEl: HTMLElement): Promise<void> {
  listEl.textContent = 'Loading…';
  let projects: ProjectSummary[];
  try {
    // The owner's list: private projects and scenes saved from Sculpt too.
    projects = await api.adminList();
  } catch (err) {
    if (err instanceof OwnerSessionError) {
      // The second lock (docs/accounts.md §2): signed in, the list comes.
      if (await ownerSignIn(true)) return refresh(listEl);
      listEl.replaceChildren(ownerSignInPanel(() => void refresh(listEl)));
      return;
    }
    listEl.textContent = `Failed to load projects: ${failureText(err)}`;
    return;
  }

  listEl.innerHTML = '';
  if (projects.length === 0) {
    listEl.appendChild(fromHTML('<p class="admin__empty">No projects yet. Create one above.</p>'));
    return;
  }
  // With accounts on, Sculpt saves to the account's own projects; a scene
  // opened from here is read and saved through the owner tools instead
  // (docs/accounts.md §5), so a template is edited as itself.
  const accounts = (await loadConfig())?.accounts === true;

  for (const p of projects) {
    const scene = p.mode === 'scene';
    const armature = p.mode === 'armature';
    // A scene is a file to open in Sculpt, an armature one to open in
    // Armature mode; the editor is for frames.
    const actions = scene
      ? '<a class="btn btn--primary admin-row__open">Open in Sculpt</a>'
      : armature
        ? '<a class="btn btn--primary admin-row__open">Open in Armature</a>'
      : `<a class="btn btn--primary admin-row__edit">Edit</a>
          <a class="btn admin-row__view" target="_blank" rel="noopener">Open</a>`;
    const row = fromHTML(`
      <div class="admin-row">
        <div class="admin-row__thumb">
          <img class="admin-row__img" alt="" loading="lazy" />
        </div>
        <div class="admin-row__main">
          <span class="badge admin-row__badge" hidden>Template</span>
          <span class="admin-row__title"></span>
          <span class="admin-row__meta"></span>
        </div>
        <div class="admin-row__actions">
          <label class="admin-row__vis">
            <input type="checkbox" /> Private
          </label>
          <label class="admin-row__tpl">
            <input type="checkbox" /> Template
          </label>
          ${actions}
          <button class="btn btn--danger admin-row__delete" type="button">Delete</button>
        </div>
      </div>`);

    row.dataset.project = p.id;
    const img = row.querySelector<HTMLImageElement>('.admin-row__img')!;
    setThumbSrc(img, mediaPath(p, `thumb.jpg?v=${p.updated_at}`));
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
      : armature
        ? `${p.id} · armature · opens in Armature mode`
        : `${p.id} · ${p.mode} · ${p.frameCount} frame${p.frameCount === 1 ? '' : 's'}`;

    if (armature) {
      const open = row.querySelector<HTMLAnchorElement>('.admin-row__open')!;
      open.href = `/?armature=1&project=${encodeURIComponent(p.id)}${accounts ? '&scope=admin' : ''}`;
      open.addEventListener('click', (e) => {
        e.preventDefault();
        void (async () => {
          const store = await import('../armature/persist').catch(() => null);
          const busy = store ? await store.hasArmature() : false;
          if (busy && !confirm(`Open "${p.title}"? The armature in progress on this device will be replaced.`)) return;
          markOpen('project', p.id);
          window.location.href = open.href;
        })();
      });
    } else if (scene) {
      const open = row.querySelector<HTMLAnchorElement>('.admin-row__open')!;
      open.href = `/?sculpt=1&project=${encodeURIComponent(p.id)}${accounts ? '&scope=admin' : ''}`;
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

    // Who sees it, and whether it is a template (docs/accounts.md §5): a
    // template belongs to no one, and Public lists it in the gallery; made
    // public, the owner's own project becomes one; no longer a template,
    // a project is the owner's again, and private. Each switch shows what
    // the server answered, so one moves when the other's change moves it.
    const vis = row.querySelector<HTMLInputElement>('.admin-row__vis input')!;
    const tpl = row.querySelector<HTMLInputElement>('.admin-row__tpl input')!;
    const badge = row.querySelector<HTMLElement>('.admin-row__badge')!;
    row.querySelector<HTMLElement>('.admin-row__vis')!.title = VISIBILITY_HINT;
    row.querySelector<HTMLElement>('.admin-row__tpl')!.title = TEMPLATE_HINT;
    const paint = (): void => {
      vis.checked = p.visibility === 'private';
      tpl.checked = p.template === true;
      badge.hidden = p.template !== true;
    };
    paint();
    /**
     * One switch's change, sent: the row takes the server's answer - who
     * sees it, whether it is a template, and where its files now are - and
     * a refusal puts it back.
     */
    const send = async (failed: string, change: () => Promise<ProjectSummary>): Promise<void> => {
      vis.disabled = tpl.disabled = true;
      try {
        const updated = await change();
        if (updated.visibility) p.visibility = updated.visibility;
        if (typeof updated.template === 'boolean') p.template = updated.template;
        if (typeof updated.media === 'string') p.media = updated.media;
      } catch (err) {
        // Put back before the alert holds the page, not after.
        paint();
        alert(`${failed}: ${failureText(err)}`);
      } finally {
        paint();
        vis.disabled = tpl.disabled = false;
      }
    };
    vis.addEventListener('change', () => {
      const want = vis.checked ? 'private' : 'public';
      void send(`Could not change who sees "${p.title || p.id}"`, () => api.setVisibility(p.id, want));
    });
    tpl.addEventListener('change', () => {
      const want = tpl.checked;
      void send(`Could not change whether "${p.title || p.id}" is a template`, () => api.setTemplate(p.id, want));
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
else void renderAdmin(root, wantedTab());
