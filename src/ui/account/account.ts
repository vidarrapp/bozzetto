import { checkSignIn, forgetSignIn, memberProjects, roleOf, signOut, type SignIn } from '../../admin/api';
import {
  AccountError,
  BotCheck,
  addPasskey,
  changeHandle,
  dayOf,
  deleteAccountStep,
  errorText,
  finishEmailChange,
  getAccount,
  getExport,
  inWait,
  loadConfig,
  momentOf,
  newPasskeyOptions,
  noPasskeysWhy,
  passkeyAborted,
  passkeyErrorText,
  removePasskey,
  sizeText,
  suspensionText,
  renamePasskey,
  revokeAllSessions,
  revokeSession,
  startEmailChange,
  type AccountDetails,
  type AccountExport,
  type AccountsConfig,
  type DeletionProgress,
  type Me,
  type Passkey,
  type SessionView,
} from '../../net/account';
import { isDesktop } from '../../net/origin';
import { forgetOwnerCaches } from '../../net/ownerCaches';
import { statusToast } from '../../sculpt/ui/statusToast';
import { signInAgain } from '../signIn';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { noteAccountDeleted } from '../Landing';
import { accountChips } from './menu';
import { CodeStep, HandleField, LEGAL, Say, button, el, field, input, legalLink } from './parts';
import { confirmIdentity } from './signIn';

/**
 * The Account page (`/?account`, docs/accounts.md §7): the handle, changed
 * at most once in 30 days; the address, changed by a code sent to the new
 * one; the passkeys, added, renamed and removed; where the account is
 * signed in, one session or all of them signed out; Download my data, a
 * zip made here (§3); Delete account, the handle typed to confirm; the
 * legal pages. What needs a recent sign-in (a passkey added or removed,
 * the address changed, the data downloaded, the account deleted) asks for
 * one when the server says so (401 reauth), then goes on.
 *
 * Nothing on it is kept offline: the account's details are never cached
 * (§7), so offline the page says it needs a connection.
 */

interface PageState {
  config: AccountsConfig;
  me: Me;
  details: AccountDetails;
  host: HTMLElement;
}

export async function renderAccount(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  document.title = 'Account · Bozzetto';
  const page = el('div', 'landing account-page');
  app.replaceChildren(page);
  galleryChip();
  const config = await loadConfig();
  const head = el('header', 'landing__head');
  const titles = el('div');
  titles.append(el('h1', 'landing__title', 'Account'));
  head.appendChild(titles);
  page.appendChild(head);
  const host = el('div', 'account-sections');
  page.appendChild(host);
  if (!config?.accounts) {
    host.appendChild(el('p', 'muted', 'Accounts are not open on this site.'));
    return;
  }
  let signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
  if (signIn.suspended) {
    // Nothing of the account answers while it is suspended, and no sign-in
    // would lift it: say so, and offer to let the device go.
    chips(signIn, app);
    host.append(el('p', 'account-say', suspensionText(signIn.suspended.reason)));
    // The desktop app signs out in Server settings, where it signs in.
    if (!isDesktop()) {
      const out = button('Sign out', 'btn');
      out.addEventListener('click', () => {
        out.disabled = true;
        void signOut().catch((err: unknown) => {
          out.disabled = false;
          statusToast('').fail(`Could not sign out: ${errorText(err)}`);
        });
      });
      host.append(out);
    }
    return;
  }
  if (!signIn.me && (await signInAgain(undefined, 'Sign in to see your account.'))) {
    signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false, accounts: true }));
  }
  chips(signIn, app);
  const me = signIn.me;
  if (!me) {
    const again = button('Sign in', 'btn btn--primary');
    again.addEventListener('click', () => void renderAccount(app));
    host.append(el('p', 'muted', 'You are not signed in.'), again);
    return;
  }
  titles.appendChild(el('p', 'landing__tagline', `@${me.handle}`));
  let details: AccountDetails;
  try {
    details = await getAccount();
  } catch (err) {
    host.appendChild(el('p', 'account-say', `Your account could not be loaded: ${errorText(err)}`));
    return;
  }
  titles.lastElementChild!.textContent = `@${me.handle} · since ${dayOf(details.createdAt)}`;
  draw({ config, me, details, host });
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
  for (const c of accountChips(signIn, roleOf(signIn), () => void renderAccount(app))) {
    c.classList.add('landing-chip');
    bar.appendChild(c);
  }
}

/** Every section, from the state as it stands. */
function draw(state: PageState): void {
  state.host.replaceChildren(
    handleSection(state),
    emailSection(state),
    passkeysSection(state),
    sessionsSection(state),
    dataSection(state),
    legalSection(state),
  );
}

/** The account's details again, after a change, and every section drawn from them. */
async function reload(state: PageState): Promise<void> {
  try {
    state.details = await getAccount();
  } catch (err) {
    statusToast('').fail(`The page could not be brought up to date: ${errorText(err)}`);
    return;
  }
  draw(state);
}

function section(key: string, title: string): HTMLElement {
  const s = el('section', 'account-section');
  s.dataset.section = key;
  s.appendChild(el('h2', 'account-section__title', title));
  return s;
}

/**
 * Run something that needs a recent sign-in: asked for when the server
 * says so (401 reauth), then tried once more. Null when the person closed
 * the confirmation instead.
 */
async function withReauth<T>(state: PageState, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof AccountError && err.code === 'reauth')) throw err;
    if (!(await confirmIdentity({ hasPasskey: state.details.passkeys.length > 0 }))) return null;
    return run();
  }
}

// --- handle ---------------------------------------------------------------------------

function handleSection(state: PageState): HTMLElement {
  const s = section('handle', 'Handle');
  const line = el('p', 'account-line');
  line.append(el('strong', '', `@${state.me.handle}`));
  const note = el(
    'p',
    'account-small',
    'Your name on Bozzetto. You can change it once every 30 days; the old one is held for 90 days so nobody else takes it meanwhile.',
  );
  const change = button('Change handle');
  const say = new Say();
  s.append(line, note, change, say.root);
  change.addEventListener('click', () => {
    const form = el('form', 'account-step');
    form.noValidate = true;
    const handle = new HandleField('New handle', state.me.handle);
    const save = button('Save', 'btn btn--primary');
    save.type = 'submit';
    const cancel = button('Cancel');
    const actions = el('div', 'account-actions');
    actions.append(save, cancel);
    form.append(handle.root, actions);
    change.replaceWith(form);
    handle.input.focus();
    cancel.addEventListener('click', () => {
      form.replaceWith(change);
      say.clear();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        say.clear();
        if (handle.value === state.me.handle.toLowerCase()) {
          handle.refused(null);
          handle.hint.textContent = 'That is your handle now.';
          return;
        }
        if (!(await handle.check())) return;
        save.disabled = true;
        try {
          state.me = await changeHandle(handle.value);
          statusToast('').done(`Your handle is @${state.me.handle} now.`);
          // The top row and the heading say it too.
          void renderAccount(state.host.closest<HTMLElement>('#app') ?? document.body);
        } catch (err) {
          save.disabled = false;
          if (err instanceof AccountError && err.code === 'rate_limited') {
            say.error(`A handle can be changed once every 30 days. You can change yours again ${inWait(err.retryAfter)}.`);
          } else if (err instanceof AccountError && (err.code === 'handle_taken' || err.reason)) {
            handle.refused(err.reason);
          } else {
            say.error(err);
          }
        }
      })();
    });
  });
  return s;
}

// --- email ----------------------------------------------------------------------------

function emailSection(state: PageState): HTMLElement {
  const s = section('email', 'Email address');
  const line = el('p', 'account-line');
  line.append(el('strong', '', state.details.email));
  const note = el('p', 'account-small', 'Codes for signing in, and notices about your account, go here.');
  const change = button('Change address');
  const say = new Say();
  s.append(line, note, change, say.root);
  change.addEventListener('click', () => {
    const form = el('form', 'account-step');
    form.noValidate = true;
    const address = input('email', 'email', { autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false' });
    const botHost = el('div', 'account-bot');
    const bot = new BotCheck(botHost, state.config.turnstileSiteKey, 'email-code');
    void bot.start().catch((err: unknown) => say.error(err));
    const send = button('Send a code', 'btn btn--primary');
    send.type = 'submit';
    const cancel = button('Cancel');
    const actions = el('div', 'account-actions');
    actions.append(send, cancel);
    form.append(field('New address', address), botHost, actions);
    change.replaceWith(form);
    address.focus();
    const back = (): void => {
      bot.dispose();
      s.querySelector('.account-code')?.remove();
      form.remove();
      s.insertBefore(change, say.root);
    };
    cancel.addEventListener('click', () => {
      back();
      say.clear();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        say.clear();
        const email = address.value.trim();
        if (!email || !address.checkValidity()) {
          say.error('Type the new address.');
          return;
        }
        send.disabled = true;
        say.note('Sending a code…');
        try {
          // A token for each try: the first may come back asking who you are.
          const sent = await withReauth(state, async () => startEmailChange(email, await bot.take()));
          if (!sent) {
            say.clear();
            send.disabled = false;
            return;
          }
          say.clear();
          // The form's widget goes with the form; the code step draws its own for a resend.
          bot.dispose();
          const code = new CodeStep({
            config: state.config,
            intro: `A code is on its way to ${email}. It works once, for 10 minutes. Your address changes when you type it here.`,
            sent,
            submitLabel: 'Change address',
            verify: async (typed) => {
              const now = await finishEmailChange(typed);
              statusToast('').done(`Your address is ${now} now. The old one has been told.`);
              await reload(state);
            },
            back: { label: 'Cancel', go: back },
          });
          form.replaceWith(code.root);
          code.focus();
        } catch (err) {
          send.disabled = false;
          say.error(err);
        }
      })();
    });
  });
  return s;
}

// --- passkeys ------------------------------------------------------------------------

/** What a passkey is, at a glance: synced, or on this device alone. */
function passkeyKind(p: Passkey): string {
  return p.deviceType === 'multiDevice' || p.backedUp ? 'Synced' : 'On one device';
}

function passkeysSection(state: PageState): HTMLElement {
  const s = section('passkeys', 'Passkeys');
  const { passkeys } = state.details;
  const limit = state.config.limits.passkeys ?? 10;
  s.appendChild(
    el(
      'p',
      'account-small',
      passkeys.length
        ? `Sign in with your device's screen lock instead of a code. An account can have ${limit}.`
        : 'No passkeys yet: you sign in with a code by email. A passkey signs you in with your device’s screen lock instead.',
    ),
  );
  const say = new Say();
  const list = el('ul', 'account-list');
  for (const p of passkeys) list.appendChild(passkeyRow(state, p, say));
  if (passkeys.length) s.appendChild(list);
  const add = button('Add a passkey', 'btn btn--primary');
  s.appendChild(add);
  const why = noPasskeysWhy(state.config);
  if (why) {
    add.disabled = true;
    s.appendChild(el('p', 'account-small', `${why}.`));
  } else if (passkeys.length >= limit) {
    add.disabled = true;
    s.appendChild(el('p', 'account-small', `That is ${limit}, the most an account can have. Remove one to add another.`));
  }
  add.addEventListener('click', () => {
    void (async () => {
      add.disabled = true;
      say.note('Waiting for the passkey…');
      try {
        const options = await withReauth(state, () => newPasskeyOptions());
        if (!options) {
          say.clear();
          return;
        }
        const made = await addPasskey(options);
        statusToast('').done(`Passkey added: ${made.name}.`);
        await reload(state);
      } catch (err) {
        if (passkeyAborted(err)) say.clear();
        else say.error(passkeyErrorText(err));
      } finally {
        add.disabled = false;
      }
    })();
  });
  s.appendChild(say.root);
  return s;
}

function passkeyRow(state: PageState, p: Passkey, say: Say): HTMLElement {
  const row = el('li', 'account-item');
  row.dataset.passkey = p.id;
  const main = el('div', 'account-item__main');
  const name = el('span', 'account-item__title', p.name);
  const used = p.lastUsedAt ? `last used ${momentOf(p.lastUsedAt)}` : 'not used yet';
  main.append(name, el('span', 'account-item__meta', `${passkeyKind(p)} · added ${dayOf(p.createdAt)} · ${used}`));
  if (p.counterWarningAt) {
    main.appendChild(
      el(
        'span',
        'account-item__warn',
        `A sign-in on ${momentOf(p.counterWarningAt)} did not count on from the one before, as a copied passkey would not. If that was not you, remove it.`,
      ),
    );
  }
  const actions = el('div', 'account-item__actions');
  const rename = button('Rename');
  const remove = button('Remove', 'btn btn--danger');
  actions.append(rename, remove);
  row.append(main, actions);

  rename.addEventListener('click', () => {
    const form = el('form', 'account-rename');
    const box = input('text', 'name', { maxlength: '64', autocomplete: 'off' });
    box.value = p.name;
    box.setAttribute('aria-label', 'Passkey name');
    const save = button('Save', 'btn btn--primary');
    save.type = 'submit';
    const cancel = button('Cancel');
    form.append(box, save, cancel);
    name.replaceWith(form);
    rename.disabled = true;
    box.focus();
    box.select();
    const done = (): void => {
      form.replaceWith(name);
      rename.disabled = false;
    };
    cancel.addEventListener('click', done);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = box.value.trim();
      if (!next || next === p.name) {
        done();
        return;
      }
      save.disabled = true;
      void renamePasskey(p.id, next)
        .then((updated) => {
          p.name = updated.name;
          name.textContent = updated.name;
          done();
        })
        .catch((err: unknown) => {
          save.disabled = false;
          say.error(err);
        });
    });
  });

  remove.addEventListener('click', () => {
    const last = state.details.passkeys.length === 1;
    const question = last
      ? `Remove the passkey “${p.name}”? It is your only one: you will sign in with a code by email after this.`
      : `Remove the passkey “${p.name}”? It will no longer sign you in.`;
    if (!confirm(question)) return;
    void (async () => {
      remove.disabled = true;
      try {
        const removed = await withReauth(state, async () => {
          await removePasskey(p.id);
          return true;
        });
        if (removed) {
          statusToast('').done(`Passkey removed: ${p.name}.`);
          await reload(state);
        }
      } catch (err) {
        say.error(passkeyErrorText(err));
      } finally {
        remove.disabled = false;
      }
    })();
  });
  return row;
}

// --- sessions ------------------------------------------------------------------------

/** Where a session is, as its user agent says: "Safari on iPad", "Chrome on Windows". */
export function deviceOf(ua: string | null, client: string): string {
  if (client === 'desktop') return 'The Bozzetto desktop app';
  const s = ua ?? '';
  const device = /iPad/.test(s)
    ? 'iPad'
    : /iPhone/.test(s)
      ? 'iPhone'
      : /Android/.test(s)
        ? 'Android'
        : /CrOS/.test(s)
          ? 'ChromeOS'
          : /Macintosh|Mac OS X/.test(s)
            ? 'Mac'
            : /Windows/.test(s)
              ? 'Windows'
              : /Linux/.test(s)
                ? 'Linux'
                : null;
  const browser = /Edg(A|iOS)?\//.test(s)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(s)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(s)
        ? 'Chrome'
        : /Safari\//.test(s)
          ? 'Safari'
          : null;
  if (browser && device) return `${browser} on ${device}`;
  return device ?? browser ?? 'A browser';
}

const HOW: Record<string, string> = {
  passkey: 'with a passkey',
  email: 'with a code',
  link: 'with a mailed link',
  bootstrap: 'as the account was made',
};

function sessionsSection(state: PageState): HTMLElement {
  const s = section('sessions', 'Where you are signed in');
  const { sessions } = state.details;
  const say = new Say();
  const list = el('ul', 'account-list');
  for (const v of sessions) list.appendChild(sessionRow(state, v, say));
  s.appendChild(list);
  const others = sessions.filter((v) => !v.current).length;
  const actions = el('div', 'account-actions');
  if (others > 0) {
    const elsewhere = button('Sign out everywhere else');
    elsewhere.addEventListener('click', () => {
      if (!confirm(`Sign out of the ${others} other session${others === 1 ? '' : 's'}? This one stays signed in.`)) return;
      elsewhere.disabled = true;
      void revokeAllSessions(true)
        .then(async (n) => {
          statusToast('').done(`Signed out of ${n} other session${n === 1 ? '' : 's'}.`);
          await reload(state);
        })
        .catch((err: unknown) => {
          elsewhere.disabled = false;
          say.error(err);
        });
    });
    actions.appendChild(elsewhere);
  }
  const everywhere = button('Sign out everywhere', 'btn btn--danger');
  everywhere.addEventListener('click', () => {
    if (!confirm('Sign out everywhere, this browser included?')) return;
    everywhere.disabled = true;
    void revokeAllSessions(false)
      .then(() => signedOutHere())
      .catch((err: unknown) => {
        everywhere.disabled = false;
        say.error(err);
      });
  });
  actions.appendChild(everywhere);
  s.append(actions, say.root);
  return s;
}

function sessionRow(state: PageState, v: SessionView, say: Say): HTMLElement {
  const row = el('li', 'account-item');
  row.dataset.session = v.id;
  if (v.current) row.classList.add('account-item--current');
  const main = el('div', 'account-item__main');
  const title = el('span', 'account-item__title', deviceOf(v.userAgent, v.client));
  if (v.current) title.appendChild(el('span', 'badge account-item__badge', 'This browser'));
  const how = HOW[v.method];
  main.append(
    title,
    el(
      'span',
      'account-item__meta',
      `Signed in ${momentOf(v.createdAt)}${how ? ` ${how}` : ''} · last seen ${momentOf(v.lastSeenAt)}`,
    ),
  );
  const actions = el('div', 'account-item__actions');
  const out = button('Sign out');
  out.addEventListener('click', () => {
    out.disabled = true;
    void revokeSession(v.id)
      .then(async () => {
        if (v.current) {
          await signedOutHere();
          return;
        }
        statusToast('').done('Signed out there.');
        await reload(state);
      })
      .catch((err: unknown) => {
        out.disabled = false;
        say.error(err);
      });
  });
  actions.appendChild(out);
  row.append(main, actions);
  return row;
}

/** This browser's session has been signed out from here: what the device kept goes, and the gallery comes back as a guest's. */
async function signedOutHere(): Promise<void> {
  try {
    // The server has already ended the session; signOut forgets the rest
    // (and its own request finds nothing left to revoke).
    await signOut();
  } catch {
    await forgetOwnerCaches();
    window.location.assign('/');
  }
}

// --- the rest -----------------------------------------------------------------------

function dataSection(state: PageState): HTMLElement {
  const s = section('data', 'Your data');
  const list = el('ul', 'account-list');
  list.append(downloadItem(state), deleteItem(state));
  s.appendChild(list);
  return s;
}

/** One row of Your data: what it is, and its button, with a line beneath for how it goes. */
function dataItem(key: string, label: string, what: string, danger = false): {
  row: HTMLElement;
  action: HTMLButtonElement;
  more: HTMLElement;
  say: Say;
} {
  const row = el('li', 'account-item account-item--data');
  row.dataset.item = key;
  const main = el('div', 'account-item__main');
  main.append(el('span', 'account-item__title', label), el('span', 'account-item__meta', what));
  const action = button(label, danger ? 'btn btn--danger' : 'btn');
  const actions = el('div', 'account-item__actions');
  actions.appendChild(action);
  const more = el('div', 'account-item__more');
  const say = new Say();
  more.appendChild(say.root);
  row.append(main, actions, more);
  return { row, action, more, say };
}

/** Past this, the zip is offered a project at a time too: an iPad holds a whole zip in memory (§3). */
const ONE_ZIP_BYTES = 200 * 1024 * 1024;

/** "Download my data" (docs/accounts.md §3): the export, then the files it names, as one zip made here. */
function downloadItem(state: PageState): HTMLElement {
  const item = dataItem(
    'download',
    'Download my data',
    'Everything your account holds, as a zip: your projects and their files, and what the site keeps about the account.',
  );
  const { action, more, say } = item;
  let panel: HTMLElement | null = null;
  action.addEventListener('click', () => {
    void (async () => {
      action.disabled = true;
      panel?.remove();
      panel = null;
      say.note('Gathering your data…');
      try {
        const data = await withReauth(state, () => getExport());
        if (!data) {
          say.clear();
          return;
        }
        say.clear();
        panel = await exportPanel(state, data);
        more.appendChild(panel);
      } catch (err) {
        say.error(`Your data could not be gathered: ${errorText(err)}`);
      } finally {
        action.disabled = false;
      }
    })();
  });
  return item.row;
}

/**
 * What the export comes to, and the ways to save it: one zip, written to a
 * file where the browser can stream one (zip.ts), else downloaded once it
 * is whole; and past ONE_ZIP_BYTES, a project at a time as well, with the
 * account's part on its own, since an iPad holds a zip in memory.
 */
async function exportPanel(state: PageState, data: AccountExport): Promise<HTMLElement> {
  const [{ archiveBytes, archiveFiles, slug, ArchiveError }, { writeZip, zipTarget }] = await Promise.all([
    import('./archive'),
    import('./zip'),
  ]);
  const panel = el('div', 'account-export');
  const total = archiveBytes(data.projects);
  const files = data.projects.reduce((n, p) => n + p.files.length, 0);
  const projects = data.projects.length;
  panel.appendChild(
    el(
      'p',
      'account-small account-export__sum',
      `${projects} project${projects === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}, ${sizeText(total)} in all.`,
    ),
  );
  const say = new Say();
  const stamp = new Date(data.exportedAt).toISOString().slice(0, 10);
  const base = `bozzetto-${data.account.handle}-${stamp}`;

  /** Make one zip, said as it goes, after asking where it goes (first, in the click). */
  const save = async (b: HTMLButtonElement, name: string, opts: { account: boolean; projects: AccountExport['projects'] }): Promise<void> => {
    const target = await zipTarget(name);
    if (!target) return;
    for (const other of panel.querySelectorAll('button')) other.disabled = true;
    say.note('Starting…');
    try {
      await writeZip(
        target,
        archiveFiles(data, opts, (p) => {
          say.note(`Saving ${p.files} of ${p.of} files (${sizeText(p.bytes)} of ${sizeText(p.total)})…`);
        }),
      );
      say.note(target.kind === 'file' ? `Saved as ${target.name}.` : `Downloaded ${target.name}.`);
      b.dataset.done = 'true';
    } catch (err) {
      say.error(`The download stopped: ${err instanceof ArchiveError ? err.message : errorText(err)}`);
    } finally {
      for (const other of panel.querySelectorAll('button')) other.disabled = false;
    }
  };

  const whole = button('Save as one zip', 'btn btn--primary account-export__whole');
  whole.addEventListener('click', () => void save(whole, `${base}.zip`, { account: true, projects: data.projects }));
  const actions = el('div', 'account-actions');
  actions.appendChild(whole);
  panel.appendChild(actions);

  if (total > ONE_ZIP_BYTES) {
    panel.appendChild(
      el(
        'p',
        'account-small',
        'That is more than an iPad can hold as one zip. Download it a part at a time instead: unpacked together, the parts are the whole.',
      ),
    );
    const parts = el('ul', 'account-list account-export__parts');
    const part = (label: string, meta: string, name: string, opts: { account: boolean; projects: AccountExport['projects'] }): void => {
      const row = el('li', 'account-item');
      const main = el('div', 'account-item__main');
      main.append(el('span', 'account-item__title', label), el('span', 'account-item__meta', meta));
      const b = button('Download');
      b.addEventListener('click', () => void save(b, name, opts));
      const acts = el('div', 'account-item__actions');
      acts.appendChild(b);
      row.append(main, acts);
      parts.appendChild(row);
    };
    part('Your account', 'account.json and README.txt', `${base}-account.zip`, { account: true, projects: [] });
    for (const p of data.projects) {
      part(p.title || p.id, sizeText(archiveBytes([p])), `${base}-${slug(p.title)}-${p.id}.zip`, { account: false, projects: [p] });
    }
    panel.appendChild(parts);
  }
  panel.appendChild(say.root);
  if (!data.complete) {
    panel.appendChild(
      el('p', 'account-small', 'Some projects had too many files to list in one go; the zip names them from their records instead.'),
    );
  }
  return panel;
}

/** How many times a deletion step that met no answer is tried again before the page says so. */
const DELETE_TRIES = 3;

/**
 * "Delete account" (docs/accounts.md §3): the handle typed to confirm, a
 * recent sign-in, then POST /api/me/delete again and again until it says
 * done, the progress said meanwhile. Then what this device keeps of the
 * account goes - the sign-in it remembers, the worker's copies, and its
 * copies of the account's projects - and the gallery comes back, a guest's.
 */
function deleteItem(state: PageState): HTMLElement {
  const item = dataItem('delete', 'Delete account', 'Your account and everything in it, for good.', true);
  const { action, more, say } = item;
  action.textContent = 'Delete account…';
  action.addEventListener('click', () => {
    if (more.querySelector('form')) return;
    const form = el('form', 'account-step account-delete');
    form.noValidate = true;
    const handle = state.me.handle;
    form.appendChild(
      el(
        'p',
        'account-small account-delete__warn',
        'This deletes your account and everything in it: your projects and their files, your passkeys, and every sign-in. ' +
          "The copies of your projects on this device go too. It cannot be undone, so download your data first if you want to keep any of it.",
      ),
    );
    const typed = input('text', 'confirm', { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: handle });
    form.appendChild(field(`Type your handle, ${handle}, to confirm`, typed));
    const go = button('Delete my account', 'btn btn--danger');
    go.type = 'submit';
    const cancel = button('Cancel');
    const actions = el('div', 'account-actions');
    actions.append(go, cancel);
    form.appendChild(actions);
    more.insertBefore(form, say.root);
    action.disabled = true;
    typed.focus();
    cancel.addEventListener('click', () => {
      form.remove();
      say.clear();
      action.disabled = false;
    });
    /** Whether the deletion has begun on the server: from then on, the steps go on without asking again. */
    let begun = false;
    /** The account's projects, for this device's copies of them: asked before the deletion takes them. */
    let ids: string[] | null = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        say.clear();
        const answer = typed.value.trim().replace(/^@/, '').toLowerCase();
        if (!begun && answer !== handle.toLowerCase()) {
          say.error(`Type your handle, ${handle}, exactly to confirm.`);
          typed.focus();
          return;
        }
        go.disabled = cancel.disabled = typed.disabled = true;
        try {
          ids ??= (await memberProjects.list().catch(() => [])).map((p) => p.id);
          let step: DeletionProgress | null;
          if (begun) {
            step = await deletionStep();
          } else {
            say.note('Deleting your account…');
            step = await withReauth(state, () => deleteAccountStep(handle));
            if (!step) {
              say.clear();
              go.disabled = cancel.disabled = typed.disabled = false;
              return;
            }
            begun = true;
          }
          while (!step.done) {
            say.note(step.remaining > 0 ? `Deleting… ${step.remaining} still to go.` : 'Deleting… nearly done.');
            step = await deletionStep();
          }
          say.note('Your account has been deleted.');
          await deletedHere(ids);
        } catch (err) {
          go.disabled = false;
          if (begun) {
            go.textContent = 'Finish deleting';
            say.error(
              `The deletion has begun, and stopped part way: ${errorText(err).replace(/\.$/, '')}. ` +
                "Press Finish deleting to carry it on; if this page is closed, the site's owner finishes it.",
            );
          } else {
            cancel.disabled = typed.disabled = false;
            say.error(err);
          }
        }
      })();
    });
  });
  return item.row;
}

/**
 * One more step of a deletion that has begun, tried again when it met no
 * answer or a server's hiccup: each step carries on from where the last
 * one stopped (functions/_shared/deletion.ts), so asking twice is safe.
 */
async function deletionStep(): Promise<DeletionProgress> {
  let last: unknown = null;
  for (let attempt = 0; attempt < DELETE_TRIES; attempt++) {
    try {
      return await deleteAccountStep();
    } catch (err) {
      last = err;
      const transient = err instanceof AccountError && (err.status === 0 || err.status >= 500);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw last;
}

/**
 * The account is gone: so is what this device kept of it - the sign-in it
 * remembers and the worker's copies (forgetSignIn), and its copies of the
 * account's projects, which would otherwise come back on the gallery as
 * scenes of no one's. Scenes kept only on this device stay: they were
 * never the account's. Then the gallery, a guest's, says it once.
 */
async function deletedHere(ids: string[]): Promise<void> {
  try {
    const lib = await import('../../sculpt/bridge/SceneLibrary');
    for (const id of ids) await lib.deleteLibraryScene(id);
  } catch {
    // Storage blocked: nothing was kept to delete.
  }
  await forgetSignIn();
  noteAccountDeleted();
  window.location.assign('/');
}

function legalSection(state: PageState): HTMLElement {
  const s = section('legal', 'The small print');
  s.appendChild(
    el(
      'p',
      'account-small',
      `You accepted the terms of ${state.details.termsVersion} when you joined, on ${dayOf(state.details.createdAt)}.`,
    ),
  );
  const links = el('p', 'account-links');
  links.append(
    legalLink('Terms', LEGAL.terms),
    legalLink('Content policy', LEGAL.content),
    legalLink('Privacy notice', LEGAL.privacy),
    legalLink('Reporting content', LEGAL.takedown),
  );
  s.appendChild(links);
  return s;
}
