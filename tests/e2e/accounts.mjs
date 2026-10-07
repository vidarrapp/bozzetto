// The accounts suite (docs/accounts.md §10): the sign-in dialog, Join, the
// Account page and the owner's bootstrap, against the real Functions -
// `wrangler pages dev` over the test build with a local D1
// (startAccountsServer) - at http://localhost:<port>, since WebAuthn takes
// localhost as an RP ID but not an IP address. Passkeys are Chromium's
// virtual authenticators (CDP WebAuthn, the options §10 names); codes come
// from the dev outbox; Turnstile's script is a stand-in that hands each
// widget a token for its action, which the server checks with the fake
// siteverify (tests/functions/turnstile-fake.mjs). Pages run without the
// service worker, so every request they make passes the suite's routes,
// which carry a clock (X-Test-Now, to make a sign-in ten minutes old), an
// address of the browser's own (CF-Connecting-IP, so each has rate-limit
// buckets of its own) and, for the owner, the header Cloudflare Access
// adds on /admin/.
//
// The path: an invite opens Join, which refuses to go on until the terms
// box is ticked, mails a code, makes the account and offers a passkey;
// sign out; a modal passkey sign-in (the autofill request is only seen to
// be made, since its picker cannot be driven), refused first without user
// verification, which asks for the handle; where the browser offers no
// passkey unless it is named (Safari with 1Password on an iPad, played by
// the page), the button and a pick among the field's suggestions ask for
// the handle, and Try again names the passkey; a code sign-in with a wrong
// code first, after which the passkey offer comes back; Account: rename a
// passkey, add a second after confirming by code, remove it after
// confirming by passkey; sessions signed out one at a time and all but
// this one, the other browser told its sign-in expired; the handle
// changed, and refused a second change within 30 days; the address
// changed by a code to the new one; on 127.0.0.1 only codes are offered;
// a mailed link signs in the browser that asked; a new code a minute on
// replaces the one before it; the desktop app's
// sign-in window (/?signin=desktop) leads with the code, mails no link,
// offers no passkey, marks its session as the desktop app's and registers
// no service worker; a used-up invite says so; the legal pages. Then the owner: Create your account on /admin/,
// a passkey, the second lock opening the dialog by itself and the list
// coming once signed in; and in Sculpt, a save the second lock refused
// goes again once signed in from its notice, to My projects, and a scene
// opened from the Projects page saves back through the owner tools; an
// account the owner suspends is told so, in the top row, the gallery,
// Sculpt and Account, offered Sign out and never Sign in. Then the
// member's own projects: Save to library makes a project of the bytes the
// scene packs to, and a second save updates it; a quota the owner lowers
// refuses the next, which stays on the device with the server's numbers;
// sessions the owner revokes make the next save Not uploaded, and Sign in
// again signs in and saves; Capture publishes a model there. My projects:
// the meter, rename, download (the .bozz, and a frames zip), open in the
// viewer and Sculpt, read only offline, delete. Download my data, after
// confirming it is you, as one zip streamed to a picked file and as a
// download, unzipped and checked here; Delete account, the handle typed,
// to done, and a guest's gallery. First of all, the build: the worker's
// rules for the account, My projects and the site's settings, the legal
// pages in its precache on the built stylesheet, and the policy admitting
// Turnstile.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { openSculpt, startAccountsServer } from './lib.mjs';
import { chooseFile, clearNotices, failedNotice, fileItems, readBozz, savedToast, shelf, workerRoutes } from './smoke.mjs';
import { TURNSTILE_SECRET, startTurnstileFake } from '../functions/turnstile-fake.mjs';
import { inviteToken, seedInvite, seedUser } from '../functions/lib.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const show = (o) => JSON.stringify(o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** docs/accounts.md §10's authenticator. */
const AUTHENTICATOR = {
  protocol: 'ctap2',
  ctap2Version: 'ctap2_1',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
  defaultBackupEligibility: true,
  defaultBackupState: true,
};

/** Cloudflare's always-passing test key: /api/config sends it, so the dialog draws widgets. */
const SITE_KEY = '1x00000000000000000000AA';

/**
 * Turnstile's stand-in: render() remembers the widget and soon hands its
 * callback a token for the widget's action, `pass:<action>`, which the
 * fake siteverify passes for that action alone; reset() hands it another.
 * window.__turnstile keeps what was asked: each widget's options, the
 * tokens given, the resets.
 */
const TURNSTILE_STUB = `
  window.__turnstile = { widgets: [], given: 0, resets: 0, removed: 0 };
  (() => {
    const live = new Map();
    const give = (id) => setTimeout(() => {
      const w = live.get(id);
      if (!w) return;
      window.__turnstile.given++;
      w.callback('pass:' + w.action);
    }, 30);
    window.turnstile = {
      render(el, opts) {
        const id = 'w' + (window.__turnstile.widgets.length + 1);
        window.__turnstile.widgets.push({ id, sitekey: opts.sitekey, action: opts.action, appearance: opts.appearance });
        live.set(id, opts);
        give(id);
        return id;
      },
      reset(id) {
        window.__turnstile.resets++;
        give(id);
      },
      remove(id) {
        window.__turnstile.removed++;
        live.delete(id);
      },
    };
  })();
`;

/**
 * A browser whose autofill request waits for the field, as Safari's and
 * Chrome's do with their pickers, until it is stopped: the virtual
 * authenticator would complete one at once, signing in without a click.
 * Counted, so the suite can see one was asked for, and stopped;
 * __autofill.refusePick() ends the one waiting as Safari ended a pick it
 * would not complete. With __refuseUnnamed, a request naming no passkey is
 * refused at once, as Safari with 1Password on an iPad refused one.
 */
function waitingAutofill() {
  const real = navigator.credentials.get.bind(navigator.credentials);
  const refusal = () => new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
  window.__autofill = { asked: 0, ended: 0, refusePick: () => {} };
  window.__refuseUnnamed = false;
  navigator.credentials.get = (options) => {
    if (options?.mediation !== 'conditional') {
      if (window.__refuseUnnamed && !options?.publicKey?.allowCredentials?.length) return Promise.reject(refusal());
      return real(options);
    }
    window.__autofill.asked++;
    return new Promise((_, reject) => {
      window.__autofill.refusePick = () => reject(refusal());
      options.signal?.addEventListener('abort', () => {
        window.__autofill.ended++;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  };
}

/** The suite's clock: every browser's requests carry Date.now() + offset as X-Test-Now. */
const clock = { offset: 0 };

/**
 * A browser on `origin`: no service worker (unless `serviceWorkers` says
 * 'allow'), the routes above, the stand-ins, and with `authenticator` a
 * virtual authenticator on its page. Confirmations (a passkey removed,
 * sessions signed out) are accepted.
 */
async function browserFor(browser, origin, { ip, access = false, authenticator = false, serviceWorkers = 'block' }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers });
  await ctx.addInitScript(waitingAutofill);
  await ctx.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
  const requests = [];
  await ctx.route(
    (url) => url.origin === origin && /^\/(api|admin\/api)\//.test(url.pathname),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      requests.push({ method: req.method(), path });
      const headers = { ...(await req.allHeaders()), 'x-test-now': String(Date.now() + clock.offset), 'cf-connecting-ip': ip };
      if (access && path.startsWith('/admin/api/')) headers['cf-access-authenticated-user-email'] = 'owner@example.com';
      await route.continue({ headers });
    },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  let auth = null;
  if (authenticator) auth = await addAuthenticator(ctx, page);
  return { ctx, page, errors, auth, requests, origin };
}

/**
 * A virtual authenticator on `page`: the built-in one §10 names, or with
 * `transport` another kind - Chrome has one built-in authenticator to an
 * environment, so a second passkey comes from a security key ('usb').
 */
async function addAuthenticator(ctx, page, transport = 'internal') {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { ...AUTHENTICATOR, transport } });
  return { cdp, id: authenticatorId };
}

const credentials = async (auth) => (await auth.cdp.send('WebAuthn.getCredentials', { authenticatorId: auth.id })).credentials;

/** The top row's chips, right side, as they read. */
const chips = (p) => p.evaluate(() => [...document.querySelectorAll('.topbar--right .topchip')].map((c) => c.textContent.trim()));

/** Wait (bounded) for a chip; whether it came. */
const chipShown = (p, label, timeout = 20_000) =>
  p
    .waitForFunction((l) => [...document.querySelectorAll('.topbar--right .topchip')].some((c) => c.textContent.trim() === l), label, { timeout })
    .then(() => true, () => false);

/** The gallery, drawn. */
async function gallery(b, query = '') {
  await b.page.goto(`${b.origin}/${query}`, { waitUntil: 'domcontentloaded' });
  await b.page.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
}

/** The dialog's step, by its heading; whether it came. */
const step = (p, title, timeout = 15_000) =>
  p
    .waitForFunction((t) => document.querySelector('.account-card .account-title')?.textContent === t, title, { timeout })
    .then(() => true, () => false);

const dialogOpen = (p) => p.evaluate(() => !!document.querySelector('.account-card'));
const dialogGone = (p, timeout = 15_000) =>
  p.waitForFunction(() => !document.querySelector('.account-card'), null, { timeout }).then(() => true, () => false);

/** Wait (bounded) until the sign-in step asks for the handle, to name the passkey; whether it did. */
const retryShown = (p, timeout = 10_000) =>
  p.waitForFunction(() => document.querySelector('.account-card .account-retry')?.hidden === false, null, { timeout }).then(() => true, () => false);

/** What the dialog's step says has gone wrong, or is going on. */
const said = (p, scope = '.account-card') => p.evaluate((s) => document.querySelector(`${s} .account-say`)?.textContent ?? '', scope);

/** Wait (bounded) until the line says something matching `re`; what it says either way. */
async function saidLike(p, re, scope = '.account-card', timeout = 15_000) {
  await p
    .waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(`${s} .account-say`)?.textContent ?? ''), [scope, re.source], { timeout })
    .catch(() => {});
  return said(p, scope);
}

const press = (p, scope, label) => p.click(`${scope} button:text-is("${label}")`);

/** The newest mail to `to` after mail `after`, waited for. */
async function mailAfter(server, to, after, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const fresh = (await server.outbox(to)).filter((r) => r.id > after);
    if (fresh.length) return fresh.at(-1);
    await sleep(150);
  }
  return null;
}

const lastMail = async (server, to) => (await server.outbox(to)).at(-1)?.id ?? 0;
const codeIn = (row) => /^(\d{6}) is your Bozzetto code$/.exec(row?.subject ?? '')?.[1] ?? null;
const linkIn = (row) => /\/\?link=([A-Za-z0-9_-]{43})/.exec(row?.body ?? '')?.[1] ?? null;

/** The account signed in here, as GET /api/me answers the page (its status, and the handle). */
const me = (p) =>
  p.evaluate(async () => {
    const r = await fetch('/api/me');
    return { status: r.status, handle: r.ok ? (await r.json()).handle : null };
  });

/** Type the code a mail carries, spaced as the mail spaces it; it goes as six digits land. */
async function typeCode(p, code) {
  await p.waitForSelector('.account-card input[name=code]', { timeout: 15_000 });
  await p.fill('.account-card input[name=code]', `${code.slice(0, 3)} ${code.slice(3)}`);
}

/** Sign in by email code from the gallery's chip; true when signed in. */
async function signInByCode(server, b, email, { offer = 'Not now' } = {}) {
  const p = b.page;
  await p.click('.topbar--right .topchip:text-is("Sign in")');
  await step(p, 'Sign in');
  const before = await lastMail(server, email);
  await p.fill('.account-card input[name=email]', email);
  await p.click('.account-card .account-submit');
  const mail = await mailAfter(server, email, before);
  if (!codeIn(mail)) return false;
  await typeCode(p, codeIn(mail));
  if (offer && (await step(p, 'Add a passkey?', 10_000))) await press(p, '.account-card', offer);
  return dialogGone(p);
}

// --- the parts --------------------------------------------------------------------------

/** Join from an invite link: the invite checked, the handle checked as typed, the terms box required, the code, a passkey. */
async function joinWithInvite(server, turnstile, a, t) {
  const p = a.page;
  await gallery(a, `?invite=${inviteToken('join')}`);
  t.ok(await step(p, 'Join Bozzetto'), 'an invite link opens Join over the gallery');
  const url = new URL(p.url());
  const kept = await p.evaluate(() => sessionStorage.getItem('bozzetto-invite'));
  t.ok(!url.search.includes('invite') && kept === inviteToken('join'), `the token is taken off the address and kept in this tab (${url.search || '(none)'}, ${kept})`);
  await p.waitForFunction(() => /works until/.test(document.querySelector('.account-invite')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
  t.ok(/^Your invite works until \d+ \w+ \d{4}\.$/.test(await p.textContent('.account-invite')), `the invite is checked: "${await p.textContent('.account-invite')}"`);

  const hint = async (value) => {
    await p.fill('.account-card input[name=handle]', value);
    await p
      .waitForFunction(() => !/^(Checking…)?$/.test(document.querySelector('.account-card .account-hint')?.textContent ?? ''), null, { timeout: 10_000 })
      .catch(() => {});
    return p.textContent('.account-card .account-hint');
  };
  t.eq(await hint('ad'), 'A handle is 3 to 30 characters: lower-case letters, digits, _ and -, starting with a letter or digit.', 'a handle too short is said so as it is typed');
  t.eq(await hint('admin'), 'That handle is reserved.', 'a reserved one, with the server\'s reason');
  t.eq(await hint('Ada'), '@ada is free.', 'a free one, lower-cased as it is stored');
  await p.fill('.account-card input[name=email]', 'ada@example.com');

  // The box is required, and unticked.
  const box = await p.evaluate(() => {
    const b = document.querySelector('.account-card input[name=terms]');
    return { checked: b.checked, required: b.required, label: b.closest('label').textContent, links: [...b.closest('label').querySelectorAll('a')].map((l) => l.getAttribute('href')) };
  });
  t.ok(
    !box.checked && box.required && box.label === 'I am 13 or older and accept the Terms, including the content policy',
    `the 13+ and terms box, unticked and required, in the terms' words (${show(box)})`,
  );
  t.ok(show(box.links) === show(['/legal/terms.html', '/legal/terms.html#content']), `linking the terms and the content policy (${show(box.links)})`);
  const starts = () => a.requests.filter((r) => r.path === '/api/auth/register/start').length;
  await p.click('.account-card .account-submit');
  t.eq(await saidLike(p, /Tick the box/), 'Tick the box to confirm you are 13 or older and accept the Terms.', 'Join will not go on without the box');
  t.eq(starts(), 0, 'and nothing was sent');

  await p.check('.account-card input[name=terms]');
  const before = await lastMail(server, 'ada@example.com');
  const verified = turnstile.requests.length;
  await p.click('.account-card .account-submit');
  t.ok(await step(p, 'Check your email'), 'ticked, Join mails a code');
  const mail = await mailAfter(server, 'ada@example.com', before);
  t.ok(!!codeIn(mail) && !!linkIn(mail), `the mail carries the code, and a link for a desktop browser ("${mail?.subject}")`);
  const checked = turnstile.requests.slice(verified).map((r) => r.response);
  t.ok(show(checked) === show(['pass:register']), `Join's start sent a token for its own action, register (${show(checked)})`);
  const code = await p.evaluate(() => {
    const c = document.querySelector('.account-card input[name=code]');
    return { autocomplete: c.autocomplete, inputmode: c.inputMode };
  });
  t.ok(code.autocomplete === 'one-time-code' && code.inputmode === 'numeric', `the code field asks for a one-time code, digits (${show(code)})`);

  await typeCode(p, codeIn(mail));
  t.ok(await step(p, 'Add a passkey?'), 'the code makes the account, and a passkey is offered');
  t.ok(/Signed in as @ada\./.test(await p.textContent('.account-card .account-lede')), 'signed in as @ada');
  t.eq(await p.evaluate(() => sessionStorage.getItem('bozzetto-invite')), null, 'the invite is forgotten once used');
  await press(p, '.account-card', 'Add a passkey');
  t.ok(await dialogGone(p), 'Add a passkey makes one, and the dialog closes');
  const held = await credentials(a.auth);
  t.ok(held.length === 1 && held[0].rpId === 'localhost' && held[0].isResidentCredential, `the authenticator holds a discoverable passkey for localhost (${held.length})`);
  t.ok(await chipShown(p, '@ada'), `the top row is the account's (${(await chips(p)).join(', ')})`);
  const row = await chips(p);
  t.ok(row.includes('My projects') && !row.includes('Sign in') && !row.includes('Owner tools'), `My projects and @ada, no Sign in, no Owner tools for a member (${row.join(', ')})`);
  t.eq((await me(p)).handle, 'ada', 'and the server agrees');
  const widgets = await p.evaluate(() => window.__turnstile.widgets.map((w) => `${w.action}/${w.appearance}/${w.sitekey}`));
  t.ok(widgets.length > 0 && widgets.every((w) => w === `register/interaction-only/${SITE_KEY}`), `Join drew Turnstile with its action, interaction-only (${show(widgets)})`);
}

/** Sign out from the @handle menu: the session ended, the gallery a guest's. */
async function signOut(a, t, label = 'ada') {
  const p = a.page;
  // What the worker would have kept of the account (pages here run without it).
  await p.evaluate(async () => {
    await caches.open('bozzetto-me').then((c) => c.put('/api/me', new Response('{}')));
    await caches.open('bozzetto-my-projects').then((c) => c.put('/api/me/projects', new Response('[]')));
  });
  await p.click(`.topbar--right .topchip:text-is("@${label}")`);
  await p.click('.account-menu button:text-is("Sign out")');
  await p.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 15_000 }).catch(() => {});
  await p.waitForSelector('#landing-grid .card--new', { timeout: 30_000 }).catch(() => {});
  t.ok(await chipShown(p, 'Sign in'), `signed out, the top row says Sign in (${(await chips(p)).join(', ')})`);
  const cookies = (await a.ctx.cookies()).map((c) => c.name);
  t.ok(!cookies.includes('__Host-bz_session') && (await me(p)).status === 401, `the session cookie is gone, and /api/me says signed out (${show(cookies)})`);
  t.ok(a.requests.some((r) => r.method === 'POST' && r.path === '/api/auth/signout'), 'through POST /api/auth/signout');
  t.ok(
    !(await p.evaluate(async () => (await caches.has('bozzetto-me')) || (await caches.has('bozzetto-my-projects')))),
    'and the kept copies of the account and of My projects go with it',
  );
}

/** A modal passkey sign-in: the autofill asked for as the dialog opens, stopped by the button's prompt. */
async function passkeySignIn(a, t) {
  const p = a.page;
  await p.click('.topbar--right .topchip:text-is("Sign in")');
  await step(p, 'Sign in');
  const field = await p.evaluate(() => document.querySelector('.account-card input[name=email]').autocomplete);
  t.eq(field, 'username webauthn', 'the email field offers passkeys among its suggestions');
  await p.waitForFunction(() => window.__autofill.asked > 0, null, { timeout: 10_000 }).catch(() => {});
  const asked = await p.evaluate(() => window.__autofill.asked);
  t.ok(asked >= 1, `opening the dialog asks for the autofill (${asked})`);
  // Without user verification the browser refuses, and the dialog asks for the handle and stays.
  await a.auth.cdp.send('WebAuthn.setUserVerified', { authenticatorId: a.auth.id, isUserVerified: false });
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await retryShown(p), 'a passkey that cannot verify its user signs nobody in, and the dialog asks for the handle to try again');
  t.ok((await dialogOpen(p)) && (await me(p)).status === 401, 'the dialog stays, signed out');
  await a.auth.cdp.send('WebAuthn.setUserVerified', { authenticatorId: a.auth.id, isUserVerified: true });
  // The failed prompt's ceremony is asked for again before the button works again.
  await p.waitForFunction(() => !document.querySelector('.account-card .account-passkey')?.disabled, null, { timeout: 10_000 }).catch(() => {});
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await dialogGone(p), 'Use a passkey signs in with the browser\'s own prompt');
  const ended = await p.evaluate(() => window.__autofill.ended);
  t.ok(ended >= 1, `stopping the autofill first (${ended})`);
  t.ok(await chipShown(p, '@ada'), 'signed in as @ada, with no passkey offered after a passkey');
}

/**
 * Where the browser offers no passkey unless it is named: Safari with
 * 1Password on an iPad refused the button's request and a pick among the
 * field's suggestions, and let through one naming the passkey. The page
 * refuses so here, since Chromium's virtual authenticator cannot: with the
 * passkey made non-discoverable, it answers a named request without the
 * user handle a sign-in needs. Either failure asks for the handle, beside
 * the code; a request refused before the field is used asks for nothing;
 * an unknown handle finds no passkey; ada's, as she might type it, names
 * hers and signs in.
 */
async function passkeyFallback(a, t) {
  const p = a.page;
  const [held] = await credentials(a.auth);
  const heldId = Buffer.from(held?.credentialId ?? '', 'base64').toString('base64url');
  const open = async () => {
    const before = await p.evaluate(() => window.__autofill.asked);
    await p.click('.topbar--right .topchip:text-is("Sign in")');
    await step(p, 'Sign in');
    await p.waitForFunction((n) => window.__autofill.asked > n, before, { timeout: 10_000 }).catch(() => {});
  };
  const close = async () => {
    await p.click('.account-card .install-close');
    await dialogGone(p);
  };
  const named = () =>
    p.waitForResponse((r) => r.url().endsWith('/api/auth/passkey/options') && (r.request().postData() ?? '').includes('"handle"'), { timeout: 15_000 });
  await p.evaluate(() => {
    window.__refuseUnnamed = true;
  });

  await open();
  t.ok(await p.evaluate(() => document.querySelector('.account-card .account-retry')?.hidden === true), 'the handle is not asked for at first');
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await retryShown(p), 'Use a passkey, refused for naming no passkey, asks for the handle');
  const view = await p.evaluate(() => {
    const card = document.querySelector('.account-card');
    return {
      line: card.querySelector('.account-retry .account-note')?.textContent,
      focused: document.activeElement?.getAttribute('name') ?? null,
      buttons: [...card.querySelectorAll('button')].map((b) => b.textContent).filter((x) => x !== '×'),
      email: !!card.querySelector('input[name=email]'),
      said: card.querySelector('.account-say')?.textContent ?? '',
    };
  });
  t.ok(
    view.line === 'Your browser did not offer the passkey. Enter your handle and try again.' &&
      view.focused === 'handle' &&
      show(view.buttons) === show(['Use a passkey', 'Try again', 'Email me a code', 'Join with an invite']) &&
      view.email &&
      view.said === '',
    `in one line, with the handle field and Try again, and the code beside them (${show(view)})`,
  );
  await close();

  await open();
  await p.evaluate(() => window.__autofill.refusePick());
  await sleep(500);
  const quiet = await p.evaluate(() => ({ asked: !document.querySelector('.account-card .account-retry').hidden, said: document.querySelector('.account-card .account-say').textContent }));
  t.ok(!quiet.asked && quiet.said === '', `an autofill request refused before the field is used asks for nothing, as before (${show(quiet)})`);
  await close();

  await open();
  await p.focus('.account-card input[name=email]');
  await p.evaluate(() => window.__autofill.refusePick());
  t.ok(await retryShown(p), "a pick among the email field's suggestions, refused, asks for the handle too");

  await p.fill('.account-card input[name=handle]', 'nobody-here');
  let answer = named();
  await press(p, '.account-card', 'Try again');
  const decoys = ((await (await answer).json()).allowCredentials ?? []).map((c) => c.id);
  t.eq(await saidLike(p, /Check the handle/), 'The passkey did not work. Check the handle, or sign in with an email code instead.', 'an unknown handle finds no passkey, and the dialog says to check it, or use a code');
  t.ok(decoys.length >= 1 && !decoys.includes(heldId), `its options named passkeys all the same, none of them ada's (${decoys.length})`);
  await p.fill('.account-card input[name=handle]', ' @Ada ');
  answer = named();
  await press(p, '.account-card', 'Try again');
  const res = await answer;
  const sent = JSON.parse(res.request().postData() ?? '{}');
  const offered = ((await res.json()).allowCredentials ?? []).map((c) => c.id);
  t.ok(sent.handle === 'ada' && show(offered) === show([heldId]), `Try again asks for options naming the passkeys of @ada, as typed (${show(sent)}: ${show(offered)})`);
  t.ok(await dialogGone(p), 'and the browser, asked for the passkey by name, signs in with it');
  t.ok(await chipShown(p, '@ada'), 'as @ada');
  await p.evaluate(() => {
    window.__refuseUnnamed = false;
  });
}

/** A code sign-in: a wrong code first, said with the tries left; the offer comes back after a code. */
async function codeSignIn(server, turnstile, a, t) {
  const p = a.page;
  await p.click('.topbar--right .topchip:text-is("Sign in")');
  await step(p, 'Sign in');
  const before = await lastMail(server, 'ada@example.com');
  const verified = turnstile.requests.length;
  await p.fill('.account-card input[name=email]', 'ada@example.com');
  await p.click('.account-card .account-submit');
  t.ok(await step(p, 'Check your email'), 'Email me a code asks for the code');
  const intro = await p.textContent('.account-card .account-lede');
  t.eq(intro, 'If there is an account for ada@example.com, a code is on its way to it. It works once, for 10 minutes.', 'saying nothing of whether the address has an account');
  const mail = await mailAfter(server, 'ada@example.com', before);
  const code = codeIn(mail);
  t.ok(show(turnstile.requests.slice(verified).map((r) => r.response)) === show(['pass:email-code']), 'with a token for email-code');
  const wrong = code === '000000' ? '111111' : '000000';
  await typeCode(p, wrong);
  t.eq(await saidLike(p, /not right/), 'That code is not right. 4 tries left.', 'a wrong code is said, with the tries left');
  const resend = await p.evaluate(() => [...document.querySelectorAll('.account-card .account-linkbtn')].map((b) => ({ text: b.textContent, disabled: b.disabled, hidden: b.hidden }))[0]);
  t.ok(resend && !resend.hidden && resend.disabled && /^Send a new code in (\d+ seconds?|1 minute)$/.test(resend.text), `a new code can be asked for once the minute is up (${show(resend)})`);
  await typeCode(p, code);
  t.ok(await step(p, 'Add a passkey?'), 'the right code signs in, and the passkey offer comes back after a code');
  await press(p, '.account-card', 'Not now');
  t.ok((await dialogGone(p)) && (await chipShown(p, '@ada')), 'Not now closes it, signed in');
  const resets = await p.evaluate(() => window.__turnstile);
  t.ok(resets.resets >= 1 && resets.removed >= 1, `each token is taken once, the widget reset for the next, and removed with its step (${show(resets)})`);
}

/** The Account page: its sections, as signed in. */
async function openAccount(a) {
  await a.page.goto(`${a.origin}/?account`, { waitUntil: 'domcontentloaded' });
  await a.page.waitForSelector('[data-section="passkeys"]', { timeout: 30_000 });
}

const passkeyNames = (p) => p.evaluate(() => [...document.querySelectorAll('[data-section="passkeys"] .account-item .account-item__title')].map((n) => n.textContent));

async function accountPasskeys(server, a, t) {
  const p = a.page;
  await openAccount(a);
  const sections = await p.evaluate(() => [...document.querySelectorAll('.account-section')].map((s) => s.dataset.section));
  t.eq(show(sections), show(['handle', 'email', 'passkeys', 'sessions', 'data', 'legal']), 'Account: handle, email, passkeys, sessions, your data, the small print');
  const data = await p.evaluate(() =>
    [...document.querySelectorAll('[data-section="data"] .account-item')].map((r) => ({ item: r.dataset.item, button: r.querySelector('button').textContent, disabled: r.querySelector('button').disabled })),
  );
  t.ok(
    show(data) === show([{ item: 'download', button: 'Download my data', disabled: false }, { item: 'delete', button: 'Delete account…', disabled: false }]),
    `Your data offers Download my data and Delete account (${show(data)})`,
  );
  const legal = await p.evaluate(() => [...document.querySelectorAll('[data-section="legal"] a')].map((l) => l.getAttribute('href')));
  t.ok(['/legal/terms.html', '/legal/terms.html#content', '/legal/privacy.html', '/legal/terms.html#takedown'].every((h) => legal.includes(h)), `and the legal pages (${show(legal)})`);

  // Rename.
  t.eq(show(await passkeyNames(p)), show(['Chrome on Linux']), 'one passkey, named after the browser that made it');
  await p.click('[data-section="passkeys"] .account-item button:text-is("Rename")');
  await p.fill('[data-section="passkeys"] input[name=name]', 'Work laptop');
  await p.click('[data-section="passkeys"] .account-rename button:text-is("Save")');
  await p.waitForFunction(() => document.querySelector('[data-section="passkeys"] .account-item__title')?.textContent === 'Work laptop', null, { timeout: 10_000 }).catch(() => {});
  t.eq(show(await passkeyNames(p)), show(['Work laptop']), 'Rename renames it');

  // A second passkey, ten minutes on: confirmed by a code. The built-in
  // authenticator holds the account's passkey and would answer the new
  // passkey's request (excluded, so refused) as soon as it is touched;
  // untouched, the security key answers.
  clock.offset += 11 * MINUTE;
  const second = await addAuthenticator(a.ctx, p, 'usb');
  await a.auth.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: a.auth.id, enabled: false });
  const before = await lastMail(server, 'ada@example.com');
  await p.click('[data-section="passkeys"] button:text-is("Add a passkey")');
  t.ok(await step(p, 'Confirm it is you'), 'adding a passkey ten minutes on asks to confirm it is you');
  const ways = await p.evaluate(() => [...document.querySelectorAll('.account-card button')].map((b) => b.textContent).filter((x) => x !== '×'));
  t.ok(show(ways) === show(['Use a passkey', 'Email me a code']), `with a passkey or a code (${show(ways)})`);
  await press(p, '.account-card', 'Email me a code');
  const mail = await mailAfter(server, 'ada@example.com', before);
  await typeCode(p, codeIn(mail));
  t.ok(await dialogGone(p, 20_000), 'confirmed by the code');
  await p.waitForFunction(() => document.querySelectorAll('[data-section="passkeys"] .account-item').length === 2, null, { timeout: 20_000 }).catch(() => {});
  t.eq((await passkeyNames(p)).length, 2, `then the passkey is made and saved: two now (${show(await passkeyNames(p))})`);
  t.eq((await credentials(second)).length, 1, 'by the security key');
  await a.auth.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: a.auth.id, enabled: true });

  // Remove it, ten minutes on again: confirmed by a passkey.
  clock.offset += 11 * MINUTE;
  await p.click('[data-section="passkeys"] .account-item:nth-child(2) button:text-is("Remove")');
  t.ok(await step(p, 'Confirm it is you'), 'removing one asks again');
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await dialogGone(p, 20_000), 'confirmed by a passkey');
  await p.waitForFunction(() => document.querySelectorAll('[data-section="passkeys"] .account-item').length === 1, null, { timeout: 20_000 }).catch(() => {});
  t.eq(show(await passkeyNames(p)), show(['Work laptop']), 'then it is removed');
  // The security key goes back in the drawer: its passkey is no account's
  // now, and a later sign-in that asks for any passkey must not find it.
  await second.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: second.id });
  const notices = (await server.outbox('ada@example.com')).map((m) => m.subject).filter((s) => !/code$/.test(s));
  t.ok(notices.length >= 2, `the holder is told by mail of each passkey added and removed (${show(notices)})`);
}

async function accountSessions(server, browser, a, t) {
  const p = a.page;
  // Another browser signs in as ada.
  clock.offset += 16 * MINUTE; // a fresh window for the address's mail
  const b = await browserFor(browser, a.origin, { ip: '203.0.113.12' });
  try {
    await gallery(b);
    t.ok(await signInByCode(server, b, 'ada@example.com'), 'another browser signs in by code');
    await openAccount(a);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('[data-section="sessions"] .account-item')].map((r) => ({ id: r.dataset.session, current: r.classList.contains('account-item--current'), title: r.querySelector('.account-item__title').textContent })),
    );
    t.ok(rows.length === 2 && rows.filter((r) => r.current).length === 1 && rows.find((r) => r.current).title.endsWith('This browser'), `Account lists both sessions, this one marked (${show(rows)})`);
    const other = rows.find((r) => !r.current);
    await p.click(`[data-section="sessions"] [data-session="${other.id}"] button:text-is("Sign out")`);
    await p.waitForFunction(() => document.querySelectorAll('[data-section="sessions"] .account-item').length === 1, null, { timeout: 15_000 }).catch(() => {});
    t.eq(await p.evaluate(() => document.querySelectorAll('[data-section="sessions"] .account-item').length), 1, 'Sign out on its row signs the other out');
    t.eq((await me(b.page)).status, 401, 'which the other browser finds');
    // The other browser's gallery says its sign-in expired, once, and Sign in again opens the dialog.
    await gallery(b);
    const notice = await b.page.textContent('.landing__notice').catch(() => null);
    t.eq(notice, 'Your sign-in has expired. Sign in again', 'its gallery says the sign-in expired');
    await b.page.click('.landing__notice button');
    t.ok(await step(b.page, 'Sign in'), 'and Sign in again opens the dialog over it');
    t.eq(await b.page.textContent('.account-card .account-reason'), 'Your sign-in has expired. Sign in again, and carry on where you were.', 'saying why');
    await b.page.click('.account-card .install-close');
    await dialogGone(b.page);
    t.ok(await signInByCode(server, b, 'ada@example.com'), 'signed in again there');
    await openAccount(a);
    await p.click('[data-section="sessions"] button:text-is("Sign out everywhere else")');
    await p.waitForFunction(() => document.querySelectorAll('[data-section="sessions"] .account-item').length === 1, null, { timeout: 15_000 }).catch(() => {});
    t.ok((await me(b.page)).status === 401 && (await me(p)).status === 200, 'Sign out everywhere else signs the other out, and keeps this one');
    t.ok(!b.errors.length, `no page errors in the other browser${b.errors.length ? `: ${b.errors.join(' | ')}` : ''}`);
  } finally {
    await b.ctx.close();
  }
}

async function accountHandle(a, t) {
  const p = a.page;
  await openAccount(a);
  const scope = '[data-section="handle"]';
  await p.click(`${scope} button:text-is("Change handle")`);
  await p.fill(`${scope} input[name=handle]`, 'ada_l');
  await p.waitForFunction((s) => document.querySelector(`${s} .account-hint`)?.textContent === '@ada_l is free.', scope, { timeout: 10_000 }).catch(() => {});
  await p.click(`${scope} button:text-is("Save")`);
  await p.waitForFunction(() => /^@ada_l /.test(document.querySelector('.landing__tagline')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  t.ok(/^@ada_l · since /.test(await p.textContent('.landing__tagline')), `the handle changes: "${await p.textContent('.landing__tagline')}"`);
  t.ok(await chipShown(p, '@ada_l'), 'and the top row says it');
  await p.click(`${scope} button:text-is("Change handle")`);
  await p.fill(`${scope} input[name=handle]`, 'ada_m');
  await p.waitForFunction((s) => document.querySelector(`${s} .account-hint`)?.textContent === '@ada_m is free.', scope, { timeout: 10_000 }).catch(() => {});
  await p.click(`${scope} button:text-is("Save")`);
  t.eq(await saidLike(p, /30 days/, scope), 'A handle can be changed once every 30 days. You can change yours again in 30 days.', 'a second change within 30 days is refused, with the wait');
}

async function accountEmail(server, a, t) {
  const p = a.page;
  clock.offset += 11 * MINUTE;
  await openAccount(a);
  const scope = '[data-section="email"]';
  await p.click(`${scope} button:text-is("Change address")`);
  await p.fill(`${scope} input[name=email]`, 'ada@new.example');
  const before = await lastMail(server, 'ada@new.example');
  await p.click(`${scope} button:text-is("Send a code")`);
  t.ok(await step(p, 'Confirm it is you'), 'changing the address ten minutes on asks to confirm it is you');
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await dialogGone(p, 20_000), 'confirmed by a passkey');
  const mail = await mailAfter(server, 'ada@new.example', before);
  t.ok(!!codeIn(mail), 'a code goes to the new address');
  await p.waitForSelector(`${scope} input[name=code]`, { timeout: 15_000 }).catch(() => {});
  const oldBefore = await lastMail(server, 'ada@example.com');
  await p.fill(`${scope} input[name=code]`, codeIn(mail));
  await p.waitForFunction((s) => document.querySelector(`${s} .account-line`)?.textContent === 'ada@new.example', scope, { timeout: 20_000 }).catch(() => {});
  t.eq(await p.textContent(`${scope} .account-line`), 'ada@new.example', 'its code changes the address');
  const told = await mailAfter(server, 'ada@example.com', oldBefore);
  t.ok(!!told && !codeIn(told), `and the old address is told ("${told?.subject}")`);
}

/** On 127.0.0.1 the host is not the passkeys' (localhost): codes only. */
async function codesOnly(server, browser, t) {
  const c = await browserFor(browser, server.ipBase, { ip: '203.0.113.13' });
  try {
    const p = c.page;
    await gallery(c);
    await p.click('.topbar--right .topchip:text-is("Sign in")');
    await step(p, 'Sign in');
    const view = await p.evaluate(() => ({
      passkey: !!document.querySelector('.account-card .account-passkey'),
      autocomplete: document.querySelector('.account-card input[name=email]').autocomplete,
      note: document.querySelector('.account-card .account-note')?.textContent ?? null,
      asked: window.__autofill.asked,
    }));
    t.ok(
      !view.passkey &&
        view.autocomplete === 'username' &&
        view.asked === 0 &&
        view.note === 'Passkeys work at localhost, not at this address. Sign in with a code sent to your email address.',
      `at 127.0.0.1, no passkey button, no autofill, and a line saying where passkeys work (${show(view)})`,
    );
    await p.click('.account-card .install-close');
    await dialogGone(p);
    t.ok(await signInByCode(server, c, 'ada@new.example', { offer: null }), 'a code signs in there');
    t.ok(await chipShown(p, '@ada_l'), 'with no passkey offered after it');
    await openAccount(c);
    const add = await p.evaluate(() => {
      const s = document.querySelector('[data-section="passkeys"]');
      return {
        disabled: [...s.querySelectorAll('button')].find((b) => b.textContent === 'Add a passkey')?.disabled,
        said: [...s.querySelectorAll('.account-small')].map((n) => n.textContent).at(-1),
      };
    });
    t.ok(add.disabled && add.said === 'Passkeys work at localhost, not at this address.', `and Account adds none there, saying why (${show(add)})`);
    t.ok(!c.errors.length, `no page errors at 127.0.0.1${c.errors.length ? `: ${c.errors.join(' | ')}` : ''}`);
  } finally {
    await c.ctx.close();
  }
}

/** The link a code mail carries signs in the browser that asked, in another tab; the first notices. */
async function mailedLink(server, browser, t) {
  const d = await browserFor(browser, server.base, { ip: '203.0.113.15' });
  try {
    const p = d.page;
    await gallery(d);
    await p.click('.topbar--right .topchip:text-is("Sign in")');
    await step(p, 'Sign in');
    const before = await lastMail(server, 'ada@new.example');
    await p.fill('.account-card input[name=email]', 'ada@new.example');
    await p.click('.account-card .account-submit');
    await step(p, 'Check your email');
    const token = linkIn(await mailAfter(server, 'ada@new.example', before));
    t.ok(!!token, 'a desktop browser\'s code mail carries a sign-in link');
    const other = await d.ctx.newPage();
    await other.goto(`${server.base}/?link=${token}`, { waitUntil: 'domcontentloaded' });
    t.ok(await step(other, 'Add a passkey?'), 'opened in the same browser, the link signs in, and offers a passkey');
    t.ok(!new URL(other.url()).search.includes('link'), `the token is taken off the address (${new URL(other.url()).search || '(none)'})`);
    await press(other, '.account-card', 'Not now');
    await dialogGone(other);
    t.ok(await chipShown(other, '@ada_l'), 'signed in there');
    await p.bringToFront();
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    t.ok(await dialogGone(p), 'the tab that asked sees the sign-in when it is back in front, and closes its dialog');
    const again = await d.ctx.newPage();
    await again.goto(`${server.base}/?link=${token}`, { waitUntil: 'domcontentloaded' });
    t.ok(await step(again, 'That link did not work'), 'the link works once');
  } finally {
    await d.ctx.close();
  }
}

/** Until `fn` (in the page) answers true, or `timeout`; whether it did. */
async function until(p, fn, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await p.evaluate(fn).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

/**
 * The desktop app's sign-in window (/?signin=desktop, docs/accounts.md §2):
 * the code first and a passkey after it, for a phone or a security key; no
 * autofill; no link in the code mail, which would open another browser; no
 * passkey offered after the code; a session that says it is the desktop
 * app's; and no service worker, which the gallery in the same browser
 * would have registered.
 */
async function desktopWindow(server, browser, t) {
  clock.offset += 16 * MINUTE; // a fresh window for the address's mail
  const w = await browserFor(browser, server.base, { ip: '203.0.113.18', serviceWorkers: 'allow' });
  try {
    const p = w.page;
    await p.goto(`${server.base}/?signin=desktop`, { waitUntil: 'load' });
    t.ok(await step(p, 'Sign in'), "/?signin=desktop, the desktop app's window, opens the sign-in dialog");
    const view = await p.evaluate(() => {
      const card = document.querySelector('.account-card');
      return {
        buttons: [...card.querySelectorAll('button')].map((b) => b.textContent).filter((x) => x !== '×'),
        primary: [...card.querySelectorAll('.btn--primary')].map((b) => b.textContent),
        focused: document.activeElement?.getAttribute('name') ?? null,
        autocomplete: card.querySelector('input[name=email]').autocomplete,
        lede: card.querySelector('.account-lede')?.textContent ?? null,
      };
    });
    t.ok(
      show(view.buttons.slice(0, 2)) === show(['Email me a code', 'Use a passkey']) &&
        show(view.primary) === show(['Email me a code']) &&
        view.focused === 'email' &&
        view.autocomplete === 'username' &&
        /closes by itself/.test(view.lede ?? ''),
      `it leads with the code, a passkey after it, and no autofill on the field (${show(view)})`,
    );
    t.ok(!new URL(p.url()).search.includes('signin'), `the link is taken off the address (${new URL(p.url()).search || '(none)'})`);
    const before = await lastMail(server, 'ada@new.example');
    await p.fill('.account-card input[name=email]', 'ada@new.example');
    await p.click('.account-card .account-submit');
    const mail = await mailAfter(server, 'ada@new.example', before);
    t.ok(!!codeIn(mail) && !linkIn(mail), `its code mail carries the code and no link ("${mail?.subject}")`);
    await typeCode(p, codeIn(mail));
    t.ok(await dialogGone(p), 'the code signs in, with no passkey offered');
    t.eq(await p.evaluate(() => window.__autofill.asked), 0, 'no autofill was asked for');
    const session = await p.evaluate(async () => (await (await fetch('/api/me/account')).json()).sessions.find((s) => s.current) ?? null);
    t.eq(session?.client, 'desktop', "the session is the desktop app's");
    t.eq(await p.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), 0, 'and the window registered no service worker');
    await p.goto(`${server.base}/`, { waitUntil: 'load' });
    t.ok(await until(p, () => navigator.serviceWorker.getRegistrations().then((r) => r.length > 0)), 'where the gallery, in the same browser, registers one');
    t.ok(!w.errors.length, `no page errors in the desktop window${w.errors.length ? `: ${w.errors.join(' | ')}` : ''}`);
  } finally {
    await w.ctx.close();
  }
}

/**
 * Send a new code, once the minute is up: the page's clock moved on
 * (Playwright's, installed before the page loads, which otherwise runs in
 * step with the real one) and the server's with it (X-Test-Now). The
 * resend draws a bot check of its own; the code before it stops working,
 * with the tries counted afresh, and the new one signs in.
 */
async function codeResend(server, turnstile, browser, t) {
  clock.offset += 16 * MINUTE; // a fresh window for the address's mail
  const r = await browserFor(browser, server.base, { ip: '203.0.113.19' });
  try {
    const p = r.page;
    await r.ctx.clock.install();
    await gallery(r);
    await p.click('.topbar--right .topchip:text-is("Sign in")');
    await step(p, 'Sign in');
    const before = await lastMail(server, 'ada@new.example');
    await p.fill('.account-card input[name=email]', 'ada@new.example');
    await p.click('.account-card .account-submit');
    await step(p, 'Check your email');
    const first = codeIn(await mailAfter(server, 'ada@new.example', before));
    const resend = () =>
      p.evaluate(() => {
        const b = [...document.querySelectorAll('.account-card .account-linkbtn')].find((x) => x.textContent.startsWith('Send a new code'));
        return b ? { text: b.textContent, disabled: b.disabled, hidden: b.hidden } : null;
      });
    const waiting = await resend();
    t.ok(!!first && waiting?.disabled && waiting.text === 'Send a new code in 1 minute', `a code, and Send a new code counting down (${show(waiting)})`);
    clock.offset += 61_000;
    await p.clock.fastForward(61_000);
    t.ok(await until(p, () => {
      const b = [...document.querySelectorAll('.account-card .account-linkbtn')].find((x) => x.textContent.startsWith('Send a new code'));
      return !!b && !b.disabled && b.textContent === 'Send a new code';
    }), `a minute on, it can be pressed (${show(await resend())})`);
    const verified = turnstile.requests.length;
    const sent = await lastMail(server, 'ada@new.example');
    await p.click('.account-card .account-linkbtn:text-is("Send a new code")');
    const second = codeIn(await mailAfter(server, 'ada@new.example', sent));
    t.ok(!!second && second !== first, 'Send a new code mails another');
    t.eq(await saidLike(p, /new code is on its way/), 'A new code is on its way. The one before it no longer works.', 'and says the one before it no longer works');
    t.ok(show(turnstile.requests.slice(verified).map((x) => x.response)) === show(['pass:email-code']), 'with a bot check of its own, for email-code');
    const again = await resend();
    t.ok(again?.disabled && again.text === 'Send a new code in 1 minute', `counting down again (${show(again)})`);
    await typeCode(p, first);
    t.eq(await saidLike(p, /not right/), 'That code is not right. 4 tries left.', 'the first code no longer works, and the tries are counted afresh');
    await typeCode(p, second);
    t.ok(await step(p, 'Add a passkey?'), 'the new one signs in');
    await press(p, '.account-card', 'Not now');
    t.ok((await dialogGone(p)) && (await chipShown(p, '@ada_l')), 'signed in');
    t.ok(!r.errors.length, `no page errors in the resending browser${r.errors.length ? `: ${r.errors.join(' | ')}` : ''}`);
  } finally {
    await r.ctx.close();
  }
}

async function spentInvite(browser, origin, t) {
  const e = await browserFor(browser, origin, { ip: '203.0.113.16' });
  try {
    await gallery(e, `?invite=${inviteToken('spent')}`);
    await step(e.page, 'Join Bozzetto');
    await e.page.waitForFunction(() => document.querySelector('.account-invite')?.dataset.tone === 'no', null, { timeout: 10_000 }).catch(() => {});
    t.eq(
      await e.page.textContent('.account-invite'),
      'This invite does not work any more: it may have been used, withdrawn or have run out. Ask whoever sent it for a new one.',
      'a used-up invite says so as Join opens',
    );
    t.ok(await e.page.isVisible('.account-card input[name=invite]'), 'and offers the field for another invite link');
  } finally {
    await e.ctx.close();
  }
}

/** The legal pages: static, on the app's stylesheet, with their sections. */
async function legalPages(browser, origin, t) {
  const f = await browserFor(browser, origin, { ip: '203.0.113.17' });
  try {
    const p = f.page;
    await p.goto(`${origin}/legal/terms.html`, { waitUntil: 'load' });
    const terms = await p.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      version: /Version 2026-10\./.test(document.querySelector('.legal__meta')?.textContent ?? ''),
      sections: ['content', 'takedown'].filter((id) => document.getElementById(id)),
      todo: [...document.querySelectorAll('.legal__todo')].map((n) => n.textContent),
      font: getComputedStyle(document.querySelector('h1')).fontFamily,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    t.ok(terms.title === 'Terms of use' && terms.version && show(terms.sections) === show(['content', 'takedown']), `the terms, version 2026-10, with #content and #takedown (${show(terms)})`);
    t.ok(terms.todo.some((x) => x.includes('[takedown address]')) && terms.todo.some((x) => /templates/i.test(x)) && terms.todo.some((x) => /nudity/i.test(x)), 'the owner\'s decisions in brackets: the takedown address, the templates, nudity');
    t.ok(/Instrument Serif/.test(terms.font) && terms.background === 'rgb(28, 24, 20)', `on the app's stylesheet (${terms.font}, ${terms.background})`);
    await p.goto(`${origin}/legal/privacy.html`, { waitUntil: 'load' });
    const privacy = await p.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      todo: [...document.querySelectorAll('.legal__todo')].map((n) => n.textContent),
      imy: !!document.querySelector('a[href="https://www.imy.se/"]'),
    }));
    t.ok(privacy.title === 'Privacy notice' && privacy.todo.includes('[contact address]') && privacy.imy, `the privacy notice, with the contact address to fill in (${show(privacy)})`);
    t.ok(!f.errors.length, `no page errors on the legal pages${f.errors.length ? `: ${f.errors.join(' | ')}` : ''}`);
  } finally {
    await f.ctx.close();
  }
}

/**
 * The build: the worker keeps the account (GET /api/me) and the site's
 * settings for offline use, network first, and still never the account's
 * details or the sign-in ceremonies; the legal pages are in its precache,
 * on the built stylesheet; the report-only policy admits Turnstile.
 */
function build(dist, t) {
  const sw = workerRoutes(dist);
  const route = (u) => sw.routeFor(u);
  t.ok(
    show(route('/api/me')) === show({ handler: 'NetworkFirst', cache: 'bozzetto-me' }) &&
      show(route('/api/config')) === show({ handler: 'NetworkFirst', cache: 'bozzetto-config' }),
    `the worker keeps /api/me and /api/config, network first (${show([route('/api/me'), route('/api/config')])})`,
  );
  const never = [
    '/api/me/account',
    '/api/auth/passkey/options',
    '/api/me/media/p-abc/scene.bozz',
    '/api/me/media/p-abc/thumb.jpg?v=3',
    '/api/me/media/p-abc/frames/sd/0000.glb?v=3',
    '/api/me/export',
  ].filter((u) => route(u)?.handler !== 'NetworkOnly');
  t.ok(!never.length, `and still sends the account's details, its export, the ceremonies and a member's files to the network${never.length ? `: not ${never.join(', ')}` : ''}`);
  const mine = ['/api/me/projects', '/api/me/projects/p-abc'].map((u) => route(u));
  t.ok(
    mine.every((r) => show(r) === show({ handler: 'NetworkFirst', cache: 'bozzetto-my-projects' })),
    `it keeps My projects' list and manifests, network first (${show(mine)})`,
  );
  const scripts = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
  const purges = scripts.some((f) => {
    const js = readFileSync(join(dist, 'assets', f), 'utf8');
    return js.includes('"bozzetto-my-projects"') && js.includes('"bozzetto-owner-projects"') && js.includes('"bozzetto-me"');
  });
  t.ok(purges, 'and the app names that cache among the ones a sign-out drops (ownerCaches.ts)');
  const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
  const precached = ['legal/privacy.html', 'legal/terms.html', 'legal/theme.js'].filter((f) => worker.includes(`"${f}"`));
  t.eq(precached.length, 3, `the legal pages and their script are precached (${show(precached)})`);
  const css = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.css'));
  const linked = ['privacy.html', 'terms.html'].map((f) => /<link rel="stylesheet" href="\/assets\/([^"]+\.css)" \/>/.exec(readFileSync(join(dist, 'legal', f), 'utf8'))?.[1] ?? null);
  t.ok(linked.every((f) => f && css.includes(f)), `each links the built stylesheet, not its source (${show(linked)})`);
  const policy = readFileSync(join(dist, '_headers'), 'utf8').match(/^\s*Content-Security-Policy-Report-Only:\s*(.+)$/m)?.[1] ?? '';
  const directive = (name) => policy.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? [];
  t.ok(
    directive('script-src').includes('https://challenges.cloudflare.com') && show(directive('frame-src')) === show(['https://challenges.cloudflare.com']),
    `the policy admits Turnstile's script and its frame (script-src ${directive('script-src').join(' ')}; frame-src ${directive('frame-src').join(' ')})`,
  );
}

/** /admin/ before the owner has an account, then the second lock, then Sculpt's save. */
async function owner(server, o, t) {
  const p = o.page;
  await p.goto(`${server.base}/admin/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.admin__bootstrap', { timeout: 30_000 }).catch(() => {});
  const form = await p.evaluate(() => ({
    title: document.querySelector('.admin__bootstrap h2')?.textContent ?? null,
    email: /owner@example\.com/.test(document.querySelector('.admin__bootstrap .muted')?.textContent ?? ''),
    box: document.querySelector('.admin__bootstrap input[name=terms]')?.closest('label').textContent ?? null,
  }));
  t.ok(form.title === 'Create your account' && form.email && form.box === 'I am 13 or older and accept the Terms, including the content policy', `with no owner account, /admin/ offers Create your account, for the Access address (${show(form)})`);
  await p.fill('.admin__bootstrap input[name=handle]', 'boss');
  await p.waitForFunction(() => document.querySelector('.admin__bootstrap .account-hint')?.textContent === '@boss is free.', null, { timeout: 10_000 }).catch(() => {});
  await p.click('.admin__bootstrap button[type=submit]');
  t.eq(await saidLike(p, /Tick the box/, '.admin__bootstrap'), 'Tick the box to confirm you are 13 or older and accept the Terms.', 'the box is required here too');
  await p.check('.admin__bootstrap input[name=terms]');
  await p.click('.admin__bootstrap button[type=submit]');
  t.ok(await step(p, 'Add a passkey?'), 'Create account makes it, signed in, and offers a passkey');
  await press(p, '.account-card', 'Add a passkey');
  t.ok(await dialogGone(p), 'a passkey is added');
  await p.waitForSelector('.admin__empty, .admin-row', { timeout: 20_000 }).catch(() => {});
  t.ok(await p.evaluate(() => !document.querySelector('.admin__bootstrap') && !!document.querySelector('.admin__empty, .admin-row')), 'then the page is the list, the form gone');

  // The gallery: the owner's chips.
  await p.goto(`${server.base}/`, { waitUntil: 'domcontentloaded' });
  await chipShown(p, '@boss');
  const row = await chips(p);
  t.ok(row.includes('My projects') && row.includes('Owner tools') && row.includes('@boss'), `the owner's top row: My projects, Owner tools, @boss (${row.join(', ')})`);

  // The second lock: Access alone no longer opens the owner tools.
  await p.evaluate(() => fetch('/api/auth/signout', { method: 'POST' }));
  await p.goto(`${server.base}/admin/`, { waitUntil: 'domcontentloaded' });
  t.ok(await step(p, 'Sign in', 20_000), 'without the owner\'s session, /admin/ opens the sign-in dialog by itself');
  t.eq(await p.textContent('.account-card .account-reason'), "Owner tools need you signed in to the owner's account.", 'saying why');
  await press(p, '.account-card', 'Use a passkey');
  t.ok(await dialogGone(p), 'signed in with the owner\'s passkey');
  await p.waitForSelector('.admin__empty, .admin-row', { timeout: 20_000 }).catch(() => {});
  t.ok(await p.evaluate(() => !!document.querySelector('.admin__empty, .admin-row') && !document.querySelector('.admin__lock')), 'and the list comes');

  // Sculpt: Save to library goes to My projects, the owner's as everyone's;
  // with the session gone it is kept here, and Sign in again from the
  // notice signs in and saves.
  await openSculpt(p, server.base, '&q=low');
  await p.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 }).catch(() => {});
  await p.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
  const save = async () => {
    await p.click('.file-menu--file__chip');
    await p.click('.file-menu--file button:has-text("Save to library")');
  };
  await save();
  await p.waitForFunction(() => document.querySelector('.file-menu__progress')?.dataset.state === 'done', null, { timeout: 60_000 }).catch(() => {});
  const first = await p.evaluate(() => document.querySelector('.file-menu__progress')?.textContent ?? '');
  t.ok(/^Saved to My projects: /.test(first), `the owner's Save to library saves to My projects ("${first}")`);
  const saved = await p.evaluate(() => window.__sculpt.fileActions.link);
  t.ok(
    !!saved && !saved.scope && o.requests.some((r) => r.method === 'POST' && r.path === '/api/me/projects') && !o.requests.some((r) => r.method !== 'GET' && r.path.startsWith('/admin/api/projects')),
    `through the account's own routes, not the owner tools' (${show(saved)})`,
  );
  await p.evaluate(() => document.querySelectorAll('.file-menu__progress').forEach((n) => n.remove()));
  await p.evaluate(() => fetch('/api/auth/signout', { method: 'POST' }));
  await p.evaluate(() => window.__sculpt.session.addPrimitive('torus'));
  await save();
  await p.waitForFunction(() => document.querySelector('.file-menu__progress')?.dataset.state === 'failed', null, { timeout: 60_000 }).catch(() => {});
  const failed = await p.evaluate(() => {
    const n = document.querySelector('.file-menu__progress');
    return { text: n?.querySelector('.file-menu__words')?.textContent ?? n?.textContent, buttons: [...(n?.querySelectorAll('button') ?? [])].map((b) => b.textContent) };
  });
  t.ok(failed.text === 'Your sign-in has expired. Saved on this device.' && failed.buttons.includes('Sign in again'), `without the owner's session the save is kept here, and the notice offers Sign in again (${show(failed)})`);
  await p.click('.file-menu__progress button:text-is("Sign in again")');
  t.ok(await step(p, 'Sign in'), 'which opens the dialog over Sculpt');
  await press(p, '.account-card', 'Use a passkey');
  await dialogGone(p);
  await p.waitForFunction(() => [...document.querySelectorAll('.file-menu__progress')].some((n) => n.dataset.state === 'done'), null, { timeout: 60_000 }).catch(() => {});
  const again = await p.evaluate(() => [...document.querySelectorAll('.file-menu__progress')].map((n) => `${n.dataset.state}: ${n.textContent}`));
  t.ok(again.some((x) => /^done: Saved to My projects: /.test(x)), `signed in, the save goes again by itself (${show(again)})`);
  const unsent = await p.evaluate(() => window.__sculpt.fileActions.unsentCopy);
  t.eq(unsent, null, 'and the copy kept on the device is let go');
  return saved?.id ?? '';
}

/**
 * Edit in Sculpt from the owner's Projects page (docs/accounts.md §5): with
 * accounts on, Open in Sculpt reads the scene through the owner tools
 * (`&scope=admin`), and its saves go back there - how a template is edited
 * as itself - rather than to My projects.
 */
async function editFromProjects(o, id, t) {
  const p = o.page;
  await p.goto(`${o.origin}/admin/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector(`.admin-row[data-project="${id}"] .admin-row__open`, { timeout: 30_000 }).catch(() => {});
  const href = await p.evaluate((pid) => document.querySelector(`.admin-row[data-project="${pid}"] .admin-row__open`)?.getAttribute('href') ?? null, id);
  t.eq(href, `/?sculpt=1&project=${id}&scope=admin`, "with accounts on, the Projects page opens a scene in Sculpt through the owner tools");
  await p.click(`.admin-row[data-project="${id}"] .admin-row__open`);
  await p.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 }).catch(() => {});
  await p.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 }).catch(() => {});
  const link = await p.evaluate(() => ({ link: window.__sculpt.fileActions.link, search: location.search }));
  t.ok(link.link?.id === id && link.link.scope === 'admin' && !/scope=/.test(link.search), `the scene opens linked to it through the owner tools (${show(link)})`);
  const hint = (await fileItems(p)).find((i) => i.label === 'Save to library')?.hint;
  t.ok(/^Updates ".+" in Projects$/.test(hint ?? ''), `and Save to library says it updates it in Projects ("${hint}")`);
  await p.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
  const mark = o.requests.length;
  await clearNotices(p);
  await chooseFile(p, 'Save to library');
  const end = await savedToast(p);
  const sent = o.requests.slice(mark).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
  t.ok(
    end.state === 'done' && /^Saved to Projects: /.test(end.text) && sent.includes(`POST /admin/api/projects/${id}/scene`) && !sent.some((x) => x.includes('/api/me/')),
    `which saves it back through the owner tools ("${end.text}": ${show(sent)})`,
  );
}

/**
 * A suspended account (403 suspended on its cookie): its browser says so,
 * in the top row and the gallery, offers Sign out and never Sign in, and
 * Sculpt's Save to library keeps the scene as a file, saying why.
 */
async function suspension(server, browser, o, t) {
  const m = await browserFor(browser, server.base, { ip: '203.0.113.21' });
  try {
    const p = m.page;
    await gallery(m);
    // Bea joins, as a script would: the form's requests, made by hand.
    const post = (path, body) =>
      p.evaluate(
        ([u, b]) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status),
        [path, body],
      );
    await post('/api/auth/register/start', {
      invite: inviteToken('join2'),
      handle: 'bea',
      email: 'bea@example.com',
      acceptTerms: true,
      ageConfirmed: true,
      turnstile: 'pass:register',
    });
    const joined = await post('/api/auth/register/verify', { code: codeIn(await mailAfter(server, 'bea@example.com', 0)) });
    t.eq(joined, 201, 'another account joins');
    const bea = (await server.call('GET', '/api/dev/user?email=bea%40example.com')).body?.user?.id;
    const suspended = await o.page.evaluate(
      (id) =>
        fetch(`/admin/api/users/${id}/suspend`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'Testing the suspension' }),
        }).then((r) => r.status),
      bea,
    );
    t.eq(suspended, 200, 'the owner suspends it');

    await gallery(m);
    await chipShown(p, 'Suspended');
    const row = await chips(p);
    t.ok(row.includes('Suspended') && row.includes('Sign out') && !row.includes('Sign in') && !row.includes('My projects'), `its top row says Suspended and offers Sign out, no Sign in (${row.join(', ')})`);
    t.eq(
      await p.textContent('.landing__notice'),
      'Your account is suspended. The mail that told you says why, and how to object.',
      'and the gallery says so, every time',
    );
    await gallery(m, '?signin');
    await sleep(500);
    t.ok(!(await dialogOpen(p)), 'a sign-in link opens no dialog over it');

    await openSculpt(p, server.base, '&q=low');
    await p.waitForFunction(() => [...document.querySelectorAll('.gallery-form__gatenote')].some((n) => n.textContent === 'Your account is suspended.'), null, { timeout: 30_000 }).catch(() => {});
    const gate = await p.evaluate(() => ({
      notes: [...document.querySelectorAll('.gallery-form__gatenote')].map((n) => n.textContent),
      signIn: [...document.querySelectorAll('.gallery-form__signin')].filter((b) => !b.hidden).length,
      recording: window.__sculpt.recorder.isAllowed(),
    }));
    t.ok(gate.notes.every((n) => n === 'Your account is suspended.') && gate.signIn === 0 && !gate.recording, `Sculpt's publish forms say it is suspended, offer no sign-in, and nothing records (${show(gate)})`);
    const download = p.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await p.click('.file-menu--file__chip');
    await p.click('.file-menu--file button:has-text("Save to library")');
    const file = await download;
    await p.waitForFunction(() => document.querySelector('.file-menu__progress')?.dataset.state === 'failed', null, { timeout: 15_000 }).catch(() => {});
    const notice = await p.evaluate(() => document.querySelector('.file-menu__progress')?.textContent ?? null);
    t.ok(
      !!file && /\.bozz$/.test(file.suggestedFilename()) && notice === 'Your account is suspended. The mail that told you says why, and how to object. The scene was saved as a .bozz file instead.',
      `Save to library keeps the scene as a .bozz file and says why, with no sign-in offered (${file?.suggestedFilename()}: "${notice}")`,
    );

    await p.goto(`${server.base}/?account`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.account-sections .account-say', { timeout: 30_000 }).catch(() => {});
    t.ok(!(await dialogOpen(p)) && /^Your account is suspended\./.test(await p.textContent('.account-sections .account-say')), 'Account says it is suspended, and asks no sign-in');
    await p.click('.account-sections button:text-is("Sign out")');
    await p.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 15_000 }).catch(() => {});
    t.ok(await chipShown(p, 'Sign in'), 'Sign out lets the device go back to a guest\'s');
    t.ok(!m.errors.length, `no page errors in the suspended account's browser${m.errors.length ? `: ${m.errors.join(' | ')}` : ''}`);
  } finally {
    await m.ctx.close();
  }
}

// --- the member's projects (docs/accounts.md §7, Batch 8) --------------------------

/** A JSON route as the page asks it, with its cookies: {status, body}. */
const pageJson = (p, path) =>
  p.evaluate(async (u) => {
    const r = await fetch(u);
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* not JSON */
    }
    return { status: r.status, body };
  }, path);

/** Bytes the page fetches, with its cookies; null for a refusal. */
const pageBytes = (p, path) =>
  p
    .evaluate(async (u) => {
      const r = await fetch(u);
      if (!r.ok) return null;
      const u8 = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(bin);
    }, path)
    .then((b) => (b === null ? null : Buffer.from(b, 'base64')));

/** The bytes the device's shelf keeps under a key (SceneLibrary's libraryData store); null for none. */
const deviceBytes = (p, key) =>
  p
    .evaluate(
      (k) =>
        new Promise((ok, fail) => {
          const req = indexedDB.open('bozzetto-sculpt');
          req.onerror = () => fail(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('libraryData');
            const got = tx.objectStore('libraryData').get(k);
            tx.oncomplete = () => {
              db.close();
              if (!got.result) return ok(null);
              const u8 = new Uint8Array(got.result);
              let bin = '';
              for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
              ok(btoa(bin));
            };
          };
        }),
      key,
    )
    .then((b) => (b === null ? null : Buffer.from(b, 'base64')));

/** What R2 holds under a prefix, key to size (the dev hook). */
const r2 = async (server, prefix) =>
  Object.fromEntries(((await server.call('GET', `/api/dev/r2?prefix=${encodeURIComponent(prefix)}`)).body?.objects ?? []).map((o) => [o.key, o.size]));

/** A size as the account's pages say one (net/account.ts amount, sizeText, sizeOfText). */
const amount = (n) => (n >= 100 ? String(Math.round(n)) : n >= 1 ? String(Math.round(n * 10) / 10) : n > 0 ? String(Math.max(0.01, Math.round(n * 100) / 100)) : '0');
const MiB = 1024 * 1024;
const mbOf = (bytes) => amount(bytes / MiB);

/**
 * The files in a zip, by name, in the order they were written, each with
 * its bytes and whether its CRC-32 holds. client-zip stores files as they
 * are (method 0), so reading one is reading its central directory - and,
 * for an archive past 4 GiB, its Zip64 records, read here too.
 */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  let count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (at === 0xffffffff || count === 0xffff) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    at = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`not a zip: entry ${n} is not a central directory record`);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    let size = buf.readUInt32LE(at + 20);
    let length = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    let local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    for (let e = at + 46 + nameLen; e + 4 <= at + 46 + nameLen + extraLen; e += 4 + buf.readUInt16LE(e + 2)) {
      if (buf.readUInt16LE(e) !== 0x0001) continue;
      let q = e + 4;
      if (length === 0xffffffff) (length = Number(buf.readBigUInt64LE(q))), (q += 8);
      if (size === 0xffffffff) (size = Number(buf.readBigUInt64LE(q))), (q += 8);
      if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q));
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.push({ name, method, length, data, crcOk: crc32(data) === crc });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** The member's own Save to library, with accounts on: a project, again in place, a full quota, an expired sign-in; and Capture. */
async function memberLibrary(server, o, a, t) {
  const p = a.page;
  const uid = (await server.call('GET', '/api/dev/user?email=ada%40new.example')).body?.user?.id ?? '';
  await openSculpt(p, server.base, '&q=low');
  await p.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 }).catch(() => {});
  const lib = (await fileItems(p)).find((i) => i.label === 'Save to library');
  t.eq(lib?.hint, 'Saves to My projects, where only you see it', 'signed in as a member, Save to library says it saves to My projects');
  const capture = await p.evaluate(() => {
    const f = document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form');
    return {
      id: !f.querySelector('.gallery-form__input[placeholder="project-id"]').hidden,
      visibility: !f.querySelector('.gallery-form__visibility').hidden,
      where: f.querySelector('.gallery-form__where').textContent,
      recording: window.__sculpt.recorder.isAllowed() && !window.__sculpt.captureWindow.chip.hidden,
    };
  });
  t.ok(
    !capture.id && !capture.visibility && capture.where === 'To My projects, where only you see it.' && capture.recording,
    `Capture is a member's too: recording is allowed, and its publish asks no id and no visibility (${show(capture)})`,
  );

  // The first save: a project of the member's own, with the bytes the scene packed to.
  await p.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
  await clearNotices(p);
  await chooseFile(p, 'Save to library');
  let end = await savedToast(p);
  t.ok(end.state === 'done' && /^Saved to My projects: Sculpt /.test(end.text), `Save to library saves to My projects ("${end.text}")`);
  let list = (await pageJson(p, '/api/me/projects')).body ?? [];
  const pid = list[0]?.id ?? '';
  t.ok(
    list.length === 1 && list[0].mode === 'scene' && list[0].visibility === 'private' && list[0].scene?.objects === 2 && /^p-/.test(pid) && list[0].media === `/api/me/media/${pid}`,
    `a private scene project of the account's own, under the server's id, both objects in it (${show(list.map((x) => ({ id: x.id, mode: x.mode, scene: x.scene, media: x.media })))})`,
  );
  const link = await p.evaluate(() => window.__sculpt.fileActions.link);
  t.ok(link?.id === pid && !link.scope, `the scene belongs to it now (${show(link)})`);
  const file = await pageBytes(p, `/api/me/media/${pid}/scene.bozz`);
  const copy = await deviceBytes(p, pid);
  const stored = await r2(server, `users/${uid}/projects/${pid}/`);
  const key = (f) => `users/${uid}/projects/${pid}/${f}`;
  t.ok(
    !!file && !!copy && file.equals(copy) && stored[key('scene.bozz')] === file.length && list[0].scene.bytes === file.length,
    `the server keeps the bytes the device's copy holds, under the account's folder (${file?.length} bytes)`,
  );
  const usage = (await pageJson(p, '/api/me')).body?.usage;
  t.ok(
    stored[key('thumb.jpg')] > 0 && list[0].bytes === file.length + stored[key('thumb.jpg')] && usage?.used === list[0].bytes,
    `its size - the file and its picture - is what the account's storage counts (${list[0]?.bytes}; used ${usage?.used})`,
  );
  t.eq(file ? (await readBozz(p, file)).objects : 0, 2, 'and the file opens as the scene it was');

  // Again, after an edit: the same project, updated in place.
  await p.evaluate(() => window.__sculpt.session.addPrimitive('torus'));
  await clearNotices(p);
  await chooseFile(p, 'Save to library');
  end = await savedToast(p);
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  t.ok(end.state === 'done' && list.length === 1 && list[0].id === pid && list[0].scene?.objects === 3, `a second save updates it in place, three objects now ("${end.text}")`);
  t.eq((await fileItems(p)).find((i) => i.label === 'Save to library')?.hint, `Updates "${list[0]?.title}" in My projects`, 'and the menu says which project it updates');

  // A full quota: refused by the server, kept on the device, said with the server's numbers.
  const setQuota = (mib) =>
    o.page.evaluate(
      ([id, q]) => fetch(`/admin/api/users/${id}/quota`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quotaMiB: q }) }).then((r) => r.status),
      [uid, mib],
    );
  t.eq(await setQuota(1), 200, "the owner sets the member's quota to 1 MB");
  await p.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
  const held = (await pageJson(p, '/api/me')).body?.usage ?? { used: 0, reserved: 0 };
  await clearNotices(p);
  await chooseFile(p, 'Save to library');
  let notice = await failedNotice(p);
  t.eq(
    notice?.text,
    `Your storage is full (${mbOf(held.used + held.reserved)} of 1 MB). Saved on this device; make room in My projects, then use Upload to My projects on its card.`,
    'a save the quota cannot take stays on the device, and the notice says how full the storage is, in the server\'s numbers',
  );
  let copies = await shelf(p);
  t.ok(copies.filter((c) => c.unsent).length === 1 && copies.some((c) => c.unsent && c.uploadTo === pid && c.objects === 4), `the scene is on the shelf as Not uploaded, for its project (${show(copies)})`);
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  t.ok(list.length === 1 && list[0].scene?.objects === 3, 'and nothing changed on the server');
  t.eq(await setQuota(250), 200, 'the quota is put back');

  // The sign-in gone: revoked on the server, so a save is kept here, and Sign in again signs in and saves.
  const revoked = await o.page.evaluate((id) => fetch(`/admin/api/users/${id}/revoke-sessions`, { method: 'POST' }).then((r) => r.status), uid);
  t.eq(revoked, 200, "the owner signs the member out everywhere");
  await clearNotices(p);
  await chooseFile(p, 'Save to library');
  notice = await failedNotice(p);
  t.ok(notice?.text === 'Your sign-in has expired. Saved on this device.' && notice.buttons.includes('Sign in again'), `its next save is kept on the device, with Sign in again (${show(notice)})`);
  copies = await shelf(p);
  t.eq(copies.filter((c) => c.unsent).length, 1, 'replacing the copy the refused save kept, not adding another');
  await p.click('.file-menu__progress button:text-is("Sign in again")');
  t.ok(await step(p, 'Sign in'), 'Sign in again opens the dialog over Sculpt');
  await p.waitForFunction(() => !document.querySelector('.account-card .account-passkey')?.disabled, null, { timeout: 10_000 }).catch(() => {});
  await press(p, '.account-card', 'Use a passkey');
  const closed = await dialogGone(p, 20_000);
  t.ok(closed, `signed in with the passkey${closed ? '' : `, but the dialog says "${await said(p)}"`}`);
  await p.waitForFunction(() => [...document.querySelectorAll('.file-menu__progress')].some((n) => n.dataset.state === 'done'), null, { timeout: 60_000 }).catch(() => {});
  const again = await p.evaluate(() => [...document.querySelectorAll('.file-menu__progress')].map((n) => `${n.dataset.state}: ${n.textContent}`));
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  t.ok(again.some((x) => /^done: Saved to My projects: /.test(x)) && list.length === 1 && list[0].scene?.objects === 4, `signed in, the save goes again by itself, to the same project (${show(again)})`);
  copies = await shelf(p);
  t.ok(!copies.some((c) => c.unsent) && (await p.evaluate(() => window.__sculpt.fileActions.unsentCopy)) === null, `and the copy kept on the device is let go (${show(copies)})`);

  // Capture's publish: a model in My projects, under a title alone.
  await p.evaluate(() => {
    const form = document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form');
    form.querySelector('.gallery-form__input[placeholder="Title (optional)"]').value = 'Ada model';
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Publish model').click();
  });
  await p.waitForFunction(() => /^Saved/.test(document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form__status')?.textContent ?? ''), null, { timeout: 60_000 }).catch(() => {});
  const status = await p.evaluate(() => document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form__status')?.textContent ?? '');
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  const model = list.find((x) => x.mode === 'model');
  t.ok(/^Saved/.test(status) && !!model && model.title === 'Ada model' && model.frameCount === 1 && model.visibility === 'private', `Publish model puts a model in My projects (${status}; ${show(model)})`);
}

/** My projects (/?me): the meter, the cards, rename, download, open, read only offline, delete. */
async function myProjectsPage(server, a, t) {
  const p = a.page;
  const open = async () => {
    await p.goto(`${server.base}/?me`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.card--mine', { timeout: 30_000 }).catch(() => {});
  };
  await open();
  const usage = (await pageJson(p, '/api/me')).body?.usage ?? {};
  let list = (await pageJson(p, '/api/me/projects')).body ?? [];
  const scene = list.find((x) => x.mode === 'scene') ?? {};
  const model = list.find((x) => x.mode === 'model') ?? {};
  const view = () =>
    p.evaluate(() => ({
      meter: document.querySelector('.storage-meter__text')?.textContent ?? null,
      now: Number(document.querySelector('.storage-meter')?.getAttribute('aria-valuenow')),
      max: Number(document.querySelector('.storage-meter')?.getAttribute('aria-valuemax')),
      cards: [...document.querySelectorAll('.card--mine')].map((c) => ({
        id: c.dataset.project,
        title: c.querySelector('.card__title')?.textContent ?? null,
        meta: c.querySelector('.card__meta').textContent,
        badge: c.querySelector('.card__badge').textContent,
        actions: [...c.querySelectorAll('.card__action')].map((b) => b.textContent),
      })),
    }));
  let v = await view();
  t.ok(
    v.meter === `${mbOf(usage.used)} of 250 MB used` && v.now === usage.used + usage.reserved && v.max === usage.quota,
    `My projects' meter says what is stored, of the quota (${v.meter}; ${v.now} of ${v.max})`,
  );
  t.ok(
    v.cards.length === 2 &&
      v.cards[0].id === model.id &&
      v.cards[1].id === scene.id &&
      /^Model · 1 frame · [\d.]+ (KB|MB) · \d+ \w+ \d{4}$/.test(v.cards[0].meta) &&
      /^Scene · 4 objects · [\d.]+ MB · \d+ \w+ \d{4}$/.test(v.cards[1].meta) &&
      v.cards.every((c) => show(c.actions) === show(['Open', 'Download', 'Rename', 'Delete'])),
    `a card for each, newest first, with its kind, size and date, and Open, Download, Rename and Delete (${show(v.cards)})`,
  );
  await p.waitForFunction((id) => document.querySelector(`.card--mine[data-project="${id}"] .card__img`)?.complete, scene.id, { timeout: 10_000 }).catch(() => {});
  const img = await p.evaluate((id) => {
    const i = document.querySelector(`.card--mine[data-project="${id}"] .card__img`);
    return i ? { src: i.getAttribute('src'), width: i.naturalWidth } : null;
  }, scene.id);
  t.ok(!!img && img.src.startsWith(`/api/me/media/${scene.id}/thumb.jpg?v=`) && img.width > 0, `its picture comes through the private route (${show(img)})`);

  // Rename, up to 200 characters.
  const card = (id) => `.card--mine[data-project="${id}"]`;
  await p.click(`${card(scene.id)} .card__rename`);
  const max = await p.evaluate((sel) => document.querySelector(`${sel} input[name=title]`)?.maxLength ?? null, card(scene.id));
  await p.fill(`${card(scene.id)} input[name=title]`, 'Bust study');
  await p.click(`${card(scene.id)} .card__save`);
  await p.waitForFunction((sel) => document.querySelector(`${sel} .card__title`)?.textContent === 'Bust study', card(scene.id), { timeout: 15_000 }).catch(() => {});
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  const named = (await shelf(p)).find((c) => c.key === scene.id)?.name;
  t.ok(max === 200 && list.find((x) => x.id === scene.id)?.title === 'Bust study' && named === 'Bust study', `Rename renames it, on the server and its copy here, up to 200 characters (${max}; ${named})`);

  // Download: the scene's .bozz, as stored.
  let [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30_000 }).catch(() => null), p.click(`${card(scene.id)} .card__download`)]);
  const bozz = dl ? readFileSync(await dl.path()) : null;
  const served = await pageBytes(p, `/api/me/media/${scene.id}/scene.bozz`);
  t.ok(!!dl && dl.suggestedFilename() === 'Bust study.bozz' && !!bozz && !!served && bozz.equals(served), `Download saves the scene's .bozz file as stored (${dl?.suggestedFilename()}, ${bozz?.length} bytes)`);

  // Download: a model's frames, zipped here.
  [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }).catch(() => null), p.click(`${card(model.id)} .card__download`)]);
  const zip = dl ? readZip(readFileSync(await dl.path())) : [];
  const folder = `projects/ada-model-${model.id}`;
  const frame = await pageBytes(p, `/api/me/media/${model.id}/frames/sd/0000.glb`);
  const zipped = zip.find((f) => f.name === `${folder}/frames/0000.glb`);
  t.ok(
    dl?.suggestedFilename() === 'ada-model.zip' &&
      show(zip.map((f) => f.name)) === show([`${folder}/project.json`, `${folder}/thumb.jpg`, `${folder}/frames/0000.glb`]) &&
      zip.every((f) => f.method === 0 && f.crcOk) &&
      !!frame &&
      !!zipped &&
      zipped.data.equals(frame),
    `Download zips a model's frames with its settings and picture (${dl?.suggestedFilename()}: ${show(zip.map((f) => `${f.name} ${f.length}`))})`,
  );

  // Open: the model in the viewer, through the account's own routes.
  await Promise.all([p.waitForURL((u) => u.searchParams.get('tl') === model.id, { timeout: 30_000 }).catch(() => {}), p.click(`${card(model.id)} .card__open`)]);
  await p.waitForFunction(() => !!window.__bozzetto || !!document.querySelector('.overlay--error'), null, { timeout: 60_000 }).catch(() => {});
  const viewer = await p.evaluate(() => ({ up: !!window.__bozzetto, error: document.querySelector('.overlay--error')?.textContent ?? null }));
  t.ok(viewer.up && !viewer.error, `Open plays a model in the viewer, from the account's own manifest (${show(viewer)})`);

  // Offline, the page is read only.
  await open();
  await p.evaluate(() => {
    window.__onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await p.waitForFunction(() => /You are offline/.test(document.querySelector('.my-projects__body > .account-say')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
  const offline = await p.evaluate((ids) =>
    ids.map((id) => {
      const c = document.querySelector(`.card--mine[data-project="${id}"]`);
      return {
        open: !!c?.querySelector('.card__open')?.getAttribute('href'),
        disabled: [...(c?.querySelectorAll('button.card__action') ?? [])].map((b) => b.disabled),
      };
    }),
  [scene.id, model.id]);
  t.ok(
    offline[0].open && !offline[1].open && offline.every((c) => c.disabled.length === 3 && c.disabled.every(Boolean)),
    `offline it is read only: a scene with a copy here still opens, nothing else does (${show(offline)})`,
  );
  await p.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', window.__onLine);
    window.dispatchEvent(new Event('online'));
  });
  await p.waitForFunction(() => !/You are offline/.test(document.querySelector('.my-projects__body > .account-say')?.textContent ?? '') && !!document.querySelector('.card--mine .card__delete:not(:disabled)'), null, { timeout: 15_000 }).catch(() => {});

  // Delete, asked first: from the server, and the meter follows.
  const before = Number(await p.getAttribute('.storage-meter', 'aria-valuenow'));
  await p.click(`${card(model.id)} .card__delete`);
  await p.waitForFunction((sel) => !document.querySelector(sel), card(model.id), { timeout: 15_000 }).catch(() => {});
  await p.waitForFunction((n) => Number(document.querySelector('.storage-meter')?.getAttribute('aria-valuenow')) < n, before, { timeout: 15_000 }).catch(() => {});
  list = (await pageJson(p, '/api/me/projects')).body ?? [];
  v = await view();
  const gone = await r2(server, `users/${(await server.call('GET', '/api/dev/user?email=ada%40new.example')).body?.user?.id}/projects/${model.id}/`);
  t.ok(
    list.length === 1 && list[0].id === scene.id && v.cards.length === 1 && v.now < before && !Object.keys(gone).length,
    `Delete takes it off the server, its files too, and the meter follows (${before} to ${v.now} bytes)`,
  );

  // Open: the scene in Sculpt, through the account's own routes.
  await Promise.all([p.waitForURL((u) => u.searchParams.get('sculpt') === '1', { timeout: 30_000 }).catch(() => {}), p.click(`${card(scene.id)} .card__open`)]);
  await p.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 }).catch(() => {});
  const opened = await p.evaluate(() => ({ link: window.__sculpt?.fileActions.link ?? null, objects: window.__sculpt?.session.getMeshes().length ?? 0 }));
  t.ok(opened.link?.id === scene.id && opened.link.title === 'Bust study' && opened.objects === 4, `Open opens a scene in Sculpt, linked to its project (${show(opened)})`);
}

/** Account → Download my data: confirmed, then one zip of everything, streamed to a picked file or downloaded. */
async function exportData(server, a, t) {
  const p = a.page;
  clock.offset += 11 * MINUTE; // the sign-in more than ten minutes old: the export asks again
  await openAccount(a);
  const list = (await pageJson(p, '/api/me/projects')).body ?? [];
  const scene = list[0] ?? {};
  const uid = (await server.call('GET', '/api/dev/user?email=ada%40new.example')).body?.user?.id ?? '';
  const stored = await r2(server, `users/${uid}/projects/${scene.id}/`);
  // A picked file, as Chromium's Save dialog gives one: here, a stream the page keeps.
  await p.evaluate(() => {
    window.showSaveFilePicker = async (opts) => {
      const saved = { name: opts.suggestedName, chunks: [], closed: false };
      window.__saved = saved;
      return {
        name: opts.suggestedName,
        createWritable: async () =>
          new WritableStream({
            write(chunk) {
              saved.chunks.push(new Uint8Array(chunk));
            },
            close() {
              saved.closed = true;
            },
          }),
      };
    };
  });
  await p.click('[data-item="download"] button:text-is("Download my data")');
  t.ok(await step(p, 'Confirm it is you'), 'Download my data ten minutes on asks to confirm it is you');
  await press(p, '.account-card', 'Use a passkey');
  await dialogGone(p, 20_000);
  await p.waitForSelector('.account-export__sum', { timeout: 30_000 }).catch(() => {});
  const sum = await p.textContent('.account-export__sum').catch(() => null);
  const total = Object.values(stored).reduce((n, x) => n + x, 0);
  t.eq(sum, `1 project, 2 files, ${mbOf(total)} MB in all.`, 'then says what it comes to');
  await p.click('.account-export__whole');
  await p.waitForFunction(() => window.__saved?.closed === true, null, { timeout: 60_000 }).catch(() => {});
  const picked = await p.evaluate(() => {
    const s = window.__saved;
    if (!s) return null;
    const all = new Uint8Array(s.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of s.chunks) {
      all.set(c, at);
      at += c.length;
    }
    let bin = '';
    for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode(...all.subarray(i, i + 0x8000));
    return { name: s.name, b64: btoa(bin), said: document.querySelector('.account-export .account-say')?.textContent ?? '' };
  });
  const zip = picked ? readZip(Buffer.from(picked.b64, 'base64')) : [];
  const folder = `projects/bust-study-${scene.id}`;
  const names = zip.map((f) => f.name);
  t.ok(
    /^bozzetto-ada_l-\d{4}-\d{2}-\d{2}\.zip$/.test(picked?.name ?? '') && picked.said === `Saved as ${picked.name}.` &&
      show(names) === show(['account.json', `${folder}/project.json`, `${folder}/scene.bozz`, `${folder}/thumb.jpg`, 'README.txt']),
    `Save as one zip writes it, as it is made, to the file picked: account.json, the project's folder, README.txt (${picked?.name}: ${show(names)})`,
  );
  const entry = (name) => zip.find((f) => f.name === name);
  const served = await pageBytes(p, `/api/me/media/${scene.id}/scene.bozz`);
  t.ok(
    zip.every((f) => f.method === 0 && f.crcOk) &&
      entry(`${folder}/scene.bozz`)?.data.equals(served ?? Buffer.alloc(0)) &&
      entry(`${folder}/scene.bozz`)?.length === stored[`users/${uid}/projects/${scene.id}/scene.bozz`] &&
      entry(`${folder}/thumb.jpg`)?.length === stored[`users/${uid}/projects/${scene.id}/thumb.jpg`],
    'each file is whole, the sizes R2 holds, the scene byte for byte',
  );
  let account = null;
  let project = null;
  try {
    account = JSON.parse(entry('account.json').data.toString('utf8'));
    project = JSON.parse(entry(`${folder}/project.json`).data.toString('utf8'));
  } catch {
    /* said below */
  }
  t.ok(
    account?.format === 'bozzetto-export/1' &&
      account.account?.handle === 'ada_l' &&
      account.account?.email === 'ada@new.example' &&
      Array.isArray(account.passkeys) &&
      Array.isArray(account.sessions) &&
      Array.isArray(account.audit) &&
      show(account.projects) === show([{ id: scene.id, title: 'Bust study', mode: 'scene', folder }]),
    `account.json holds the account, its passkeys, sessions and audit rows, and names each project's folder (${show(account?.projects)})`,
  );
  t.ok(
    project?.id === scene.id && project.title === 'Bust study' && show(project.files.map((f) => f.name)) === show(['scene.bozz', 'thumb.jpg']) && project.data && typeof project.data === 'object',
    `project.json holds the project's settings and its files (${show(project?.files)})`,
  );
  const readme = entry('README.txt')?.data.toString('utf8') ?? '';
  t.ok(/^Bozzetto: your data/.test(readme) && readme.includes('@ada_l') && readme.includes('account.json') && !readme.includes('Not included'), 'README.txt says what is in it');

  // Where no file can be picked (Safari, an iPad), the zip downloads once it is whole.
  await p.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }).catch(() => null), p.click('.account-export__whole')]);
  const downloaded = dl ? readZip(readFileSync(await dl.path())) : [];
  t.ok(
    !!dl && /^bozzetto-ada_l-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()) && show(downloaded.map((f) => f.name)) === show(names) && downloaded.every((f) => f.crcOk),
    `without a file to write to, the same zip downloads (${dl?.suggestedFilename()})`,
  );
}

/** Account → Delete account: the handle typed, confirmed, deleted to done, and the gallery a guest's. */
async function deleteAccount(server, a, t) {
  const p = a.page;
  const uid = (await server.call('GET', '/api/dev/user?email=ada%40new.example')).body?.user?.id ?? '';
  // Forty more projects, empty: a deletion step spends at most 40
  // subrequests (functions/_shared/deletion.ts), about one per empty
  // project, so this one takes more than a step, and says how far it is.
  const made = await p.evaluate(async () => {
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const r = await fetch('/api/me/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `Empty ${i + 1}`, mode: 'timelapse' }),
      });
      if (r.status === 201) n++;
    }
    return n;
  });
  t.eq(made, 40, 'forty more projects, so the deletion takes more than one step');
  const notes = [];
  await a.ctx.exposeBinding('__deleteNote', (_source, text) => void notes.push(text));
  clock.offset += 11 * MINUTE; // asks to confirm it is you, again
  await openAccount(a);
  await p.evaluate(() => {
    const host = document.querySelector('[data-item="delete"]');
    new MutationObserver(() => {
      const text = host.querySelector('.account-say')?.textContent ?? '';
      if (text) window.__deleteNote(text);
    }).observe(host, { subtree: true, childList: true, characterData: true });
  });
  await p.click('[data-item="delete"] button:text-is("Delete account…")');
  const form = '[data-item="delete"] form';
  await p.waitForSelector(form, { timeout: 10_000 }).catch(() => {});
  t.ok(/cannot be undone/.test((await p.textContent(`${form} .account-delete__warn`).catch(() => '')) ?? ''), 'Delete account says what goes, and that it cannot be undone');
  await p.fill(`${form} input[name=confirm]`, 'ada');
  await p.click(`${form} button:text-is("Delete my account")`);
  t.eq(await saidLike(p, /Type your handle/, '[data-item="delete"]'), 'Type your handle, ada_l, exactly to confirm.', 'it goes no further without the handle typed');
  const sent = a.requests.filter((r) => r.path === '/api/me/delete').length;
  t.eq(sent, 0, 'and nothing was sent');
  await p.fill(`${form} input[name=confirm]`, '@ada_l');
  await p.click(`${form} button:text-is("Delete my account")`);
  t.ok(await step(p, 'Confirm it is you'), 'the handle typed, it asks to confirm it is you');
  await press(p, '.account-card', 'Use a passkey');
  await p.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 60_000 }).catch(() => {});
  await p.waitForSelector('#landing-grid .card--new', { timeout: 30_000 }).catch(() => {});
  const calls = a.requests.filter((r) => r.path === '/api/me/delete').length;
  const steps = notes.filter((n) => /^Deleting… \d+ still to go\.$/.test(n));
  t.ok(
    calls >= 3 && steps.length >= 1,
    `it asks again and again until the server says done - ${calls} calls, the first refused until it was confirmed - saying how far it is (${show([...new Set(notes)])})`,
  );
  const notice = await p.textContent('.landing__notice').catch(() => null);
  t.eq(notice, 'Your account has been deleted, with everything in it.', 'then the gallery says so');
  t.ok(await chipShown(p, 'Sign in'), `a guest's gallery: Sign in (${(await chips(p)).join(', ')})`);
  const cookies = (await a.ctx.cookies()).map((c) => c.name);
  t.ok(!cookies.includes('__Host-bz_session') && (await me(p)).status === 401, `signed out: no session cookie, and /api/me says so (${show(cookies)})`);
  const rows = (await server.call('GET', `/api/dev/rows?user=${uid}`)).body ?? {};
  const files = await r2(server, `users/${uid}/`);
  t.ok(
    rows.users === 0 && rows.projects === 0 && rows.credentials === 0 && rows.sessions === 0 && rows.pendingUploads === 0 && !Object.keys(files).length,
    `nothing of the account is left on the server: rows ${show(rows)}, files ${Object.keys(files).length}`,
  );
  const device = await p.evaluate(() => ({ remembered: localStorage.getItem('bozzetto-signed-in') }));
  const copies = await shelf(p);
  t.ok(device.remembered === null && !copies.some((c) => c.projectId), `this device forgets the sign-in and its copies of the account's projects (${show(copies)})`);
}

// --- the owner's tools over accounts (docs/accounts.md §8, Batch 9) ------------------

/** Accounts the seed makes for the owner's tools: one left half deleted, one whose storage count drifted, and enough others for a second page. */
const LEAVING = { id: 'u-leaving', handle: 'leaving', email: 'leaving@example.com' };
const DRIFT = { id: 'u-drift', handle: 'drift', email: 'drift@example.com' };
const FILLERS = 50;
/** Rows the seed writes to the log, of an action of their own, for a second page of a filter. */
const SEEDED_ROWS = 60;

function ownerToolsSeed(now) {
  const sql = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const rows = [
    seedUser({ ...LEAVING, status: 'deleting', at: now - 10 * DAY }),
    // Its deletion began two days ago (the account.delete row says when): flagged.
    `INSERT INTO audit_log (at, actor, action, subject, detail) VALUES (${[now - 2 * DAY, LEAVING.id, 'account.delete', LEAVING.id, '{}'].map(sql).join(', ')});`,
    seedUser({ ...DRIFT, used: 5 * MiB, at: now - 9 * DAY }),
  ];
  for (let i = 0; i < FILLERS; i++) {
    const n = String(i).padStart(2, '0');
    rows.push(seedUser({ id: `u-fill-${n}`, handle: `filler${n}`, at: now - 30 * DAY - i * 1000 }));
  }
  for (let i = 0; i < SEEDED_ROWS; i++) {
    rows.push(`INSERT INTO audit_log (at, actor, action, subject, detail) VALUES (${[now - 3 * DAY - i * 1000, 'u-fill-00', 'test.seeded', 'u-fill-00', `{"n":${i}}`].map(sql).join(', ')});`);
  }
  return rows.join('\n');
}

/** An owner tab, drawn: /admin/?tab=<tab> (or /admin/ for Projects), and what the tab row says. */
async function ownerTab(o, tab, ready) {
  const p = o.page;
  await p.goto(`${o.origin}/admin/${tab === 'projects' ? '' : `?tab=${tab}`}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector(ready, { timeout: 30_000 }).catch(() => {});
  return p.evaluate(() =>
    [...document.querySelectorAll('.admin-tabs .admin-tab')].map((a) => ({ label: a.textContent, href: a.getAttribute('href'), current: a.getAttribute('aria-current') === 'page' })),
  );
}

/** An account's row on the Users tab: what it says. */
const userRow = (p, handle) =>
  p.evaluate((h) => {
    const row = [...document.querySelectorAll('.admin-user')].find((r) => r.querySelector('.admin-row__title')?.textContent.split(' ')[0] === `@${h}`);
    if (!row) return null;
    return {
      id: row.dataset.user,
      status: row.dataset.status,
      title: row.querySelector('.admin-row__title').textContent,
      meta: row.querySelector('.admin-row__meta').textContent,
      usage: row.querySelector('.admin-user__usage').textContent,
      open: !row.querySelector('.admin-user__detail').hidden,
      detail: row.querySelector('.admin-user__detail').textContent,
      buttons: [...row.querySelectorAll('.admin-user__detail button')].map((b) => b.textContent),
      said: row.querySelector('.admin-user__detail .account-say')?.textContent ?? '',
    };
  }, handle);

/** The row's selector, for clicks. */
const rowOf = (id) => `.admin-user[data-user="${id}"]`;

/** Wait (bounded) until an account's panel says something matching `re`; what it says either way. */
async function panelSays(p, id, re, timeout = 20_000) {
  await p
    .waitForFunction(
      ([sel, src]) => new RegExp(src).test(document.querySelector(`${sel} .admin-user__detail .account-say`)?.textContent ?? ''),
      [rowOf(id), re.source],
      { timeout },
    )
    .catch(() => {});
  return p.evaluate((sel) => document.querySelector(`${sel} .admin-user__detail .account-say`)?.textContent ?? '', rowOf(id));
}

/** Open an account's panel (Manage), and wait for its actions. */
async function manage(p, id) {
  await p.click(`${rowOf(id)} .admin-user__manage`);
  await p.waitForFunction((sel) => !!document.querySelector(`${sel} .admin-user__detail .admin-user__facts`), rowOf(id), { timeout: 20_000 }).catch(() => {});
}

/**
 * The owner's tabs over accounts, on /admin/ beside Projects: Invites -
 * one made with a label, uses and days, its link shown once with Copy,
 * redeemed in another browser, then withdrawn; Users - the accounts in
 * pages of 50, a deletion left waiting flagged, an account signed out
 * everywhere and suspended (its holder then gets 403 suspended, and is
 * mailed the reason), a stale Unsuspend refused as the account having
 * moved on, its quota changed, a drifted count recounted, the owner's own
 * account offered neither, and the deletion finished; Audit - newest
 * first, filtered by action and by subject, with Load more.
 */
async function ownerPages(server, browser, o, t) {
  const p = o.page;
  const writes = (path) => o.requests.filter((r) => r.method !== 'GET' && r.path.startsWith(path)).length;

  // --- the tabs ------------------------------------------------------------------------
  const tabs = await ownerTab(o, 'projects', '.admin-row, .admin__empty');
  t.ok(
    show(tabs.map((x) => x.label)) === show(['Projects', 'Invites', 'Users', 'Audit']) &&
      tabs[0].current &&
      show(tabs.map((x) => x.href)) === show(['/admin/', '/admin/?tab=invites', '/admin/?tab=users', '/admin/?tab=audit']),
    `with accounts on and the owner's account signed in, /admin/ has Invites, Users and Audit beside Projects (${show(tabs)})`,
  );

  // --- Invites -------------------------------------------------------------------------
  await p.click('.admin-tab:text-is("Invites")');
  await p.waitForSelector('.admin-invites__form', { timeout: 30_000 }).catch(() => {});
  t.ok(new URL(p.url()).search === '?tab=invites', `a tab is a link (${new URL(p.url()).search})`);
  const defaults = await p.evaluate(() => ({
    uses: document.querySelector('.admin-invites__form input[name=maxUses]').value,
    days: document.querySelector('.admin-invites__form input[name=expiresInDays]').value,
  }));
  t.ok(defaults.uses === '1' && defaults.days === '14', `a new invite admits one account for 14 days unless said (${show(defaults)})`);
  const made = writes('/admin/api/invites');
  await p.fill('.admin-invites__form input[name=maxUses]', '0');
  await p.click('.admin-invites__form button[type=submit]');
  t.eq(await saidLike(p, /admits from/, '#admin-tab'), 'An invite admits from 1 to 500 accounts.', 'uses out of range are said so');
  t.eq(writes('/admin/api/invites'), made, 'and nothing is sent');
  await o.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.base });
  await p.fill('.admin-invites__form input[name=label]', 'For Cleo');
  await p.fill('.admin-invites__form input[name=maxUses]', '2');
  await p.fill('.admin-invites__form input[name=expiresInDays]', '7');
  await p.click('.admin-invites__form button[type=submit]');
  await p.waitForSelector('.admin-invites__made:not([hidden]) .admin-invites__link', { timeout: 15_000 }).catch(() => {});
  const link = await p.evaluate(() => document.querySelector('.admin-invites__link')?.value ?? '');
  const token = new RegExp(`^${server.base.replace(/[.]/g, '\\.')}/\\?invite=([A-Za-z0-9_-]{22})$`).exec(link)?.[1] ?? null;
  t.ok(!!token, `the invite's link is shown, on this site (${link})`);
  const shown = await p.textContent('.admin-invites__made p').catch(() => '');
  t.ok(/admits 2 accounts until .+\. This is the only time its link is shown: copy it now\./.test(shown ?? ''), `once, and says so ("${shown}")`);
  await p.click('.admin-invites__made button:text-is("Copy")');
  await p.waitForFunction(() => document.querySelector('.admin-invites__copied')?.textContent !== '', null, { timeout: 5000 }).catch(() => {});
  const copied = await p.evaluate(async () => ({ said: document.querySelector('.admin-invites__copied')?.textContent, text: await navigator.clipboard.readText().catch(() => null) }));
  t.ok(copied.said === 'Copied.' && copied.text === link, `Copy puts it on the clipboard (${show(copied)})`);
  const row = () =>
    p.evaluate(() => {
      const r = document.querySelector('.admin-invite');
      return r
        ? { state: r.dataset.state, title: r.querySelector('.admin-row__title').textContent, meta: r.querySelector('.admin-row__meta').textContent, badge: r.querySelector('.admin-invite__state').textContent, revoke: !!r.querySelector('.admin-invite__revoke') }
        : null;
    });
  let first = await row();
  t.ok(first?.state === 'live' && first.title === 'For Cleo' && /^0 of 2 used · made .+ · until .+$/.test(first.meta) && first.badge === 'Live' && first.revoke, `the list has it first, live, none of two used (${show(first)})`);
  await ownerTab(o, 'invites', '.admin-invite');
  t.ok(await p.evaluate(() => document.querySelector('.admin-invites__made').hidden && !document.querySelector('.admin-invites__link')), 'drawn again, the link is not shown: it was shown once');

  // Redeemed in another browser: Join, from the link.
  const c = await browserFor(browser, server.base, { ip: '203.0.113.30' });
  try {
    const cp = c.page;
    await gallery(c, `?invite=${token}`);
    await step(cp, 'Join Bozzetto');
    await cp.fill('.account-card input[name=handle]', 'cleo');
    await cp.waitForFunction(() => document.querySelector('.account-card .account-hint')?.textContent === '@cleo is free.', null, { timeout: 10_000 }).catch(() => {});
    await cp.fill('.account-card input[name=email]', 'cleo@example.com');
    await cp.check('.account-card input[name=terms]');
    const before = await lastMail(server, 'cleo@example.com');
    await cp.click('.account-card .account-submit');
    await step(cp, 'Check your email');
    const code = codeIn(await mailAfter(server, 'cleo@example.com', before));
    await typeCode(cp, code ?? '');
    if (await step(cp, 'Add a passkey?', 10_000)) await press(cp, '.account-card', 'Not now');
    t.ok((await dialogGone(cp)) && (await chipShown(cp, '@cleo')), 'the invite is redeemed in another browser: Join makes @cleo');
    await ownerTab(o, 'invites', '.admin-invite');
    first = await row();
    t.ok(first?.state === 'live' && /^1 of 2 used/.test(first.meta), `the list counts the use, and the invite is still live (${first?.meta})`);
    await p.click('.admin-invite .admin-invite__revoke');
    await p.waitForFunction(() => document.querySelector('.admin-invite')?.dataset.state === 'revoked', null, { timeout: 15_000 }).catch(() => {});
    first = await row();
    t.ok(first?.state === 'revoked' && first.badge === 'Withdrawn' && !first.revoke && /withdrawn/.test(first.meta), `Revoke withdraws it (${show(first)})`);
    const check = await server.call('POST', '/api/auth/invite/check', { json: { invite: token }, headers: { 'cf-connecting-ip': '203.0.113.31' } });
    t.eq(check.status, 410, 'and its link admits nobody now');

    // --- Users -------------------------------------------------------------------------
    const cleo = (await server.call('GET', '/api/dev/user?email=cleo%40example.com')).body?.user?.id ?? '';
    await ownerTab(o, 'users', '.admin-user');
    const notice = await p.evaluate(() => {
      const n = document.querySelector('.admin-users__pending');
      return n && !n.hidden ? n.textContent : null;
    });
    t.eq(notice, 'One account has been waiting over a day for its deletion to finish. Finish deletion, under Manage, carries it on.', 'a deletion left waiting over a day is flagged at the top');
    const page1 = await p.evaluate(() => ({ rows: document.querySelectorAll('.admin-user').length, more: !document.querySelector('.admin-users__more').hidden }));
    t.ok(page1.rows === 50 && page1.more, `the accounts, 50 a page, with Load more (${show(page1)})`);
    const handles = await p.evaluate(() => [...document.querySelectorAll('.admin-user .admin-row__title')].map((x) => x.textContent.split(' ')[0]));
    t.eq(handles[0], '@cleo', 'newest first');
    await p.click('.admin-users__more');
    await p.waitForFunction((n) => document.querySelectorAll('.admin-user').length > n, page1.rows, { timeout: 15_000 }).catch(() => {});
    const all = await p.evaluate(() => ({
      handles: [...document.querySelectorAll('.admin-user .admin-row__title')].map((x) => x.textContent.split(' ')[0]),
      more: !document.querySelector('.admin-users__more').hidden,
    }));
    t.ok(
      all.handles.length > 50 && !all.more && new Set(all.handles).size === all.handles.length && all.handles.includes('@filler49') && all.handles.includes('@boss'),
      `Load more brings the rest, none twice, and there is no more (${all.handles.length} accounts)`,
    );
    let cleoRow = await userRow(p, 'cleo');
    t.ok(
      !!cleoRow &&
        cleoRow.id === cleo &&
        /^cleo@example\.com · joined .+ · last seen .+ · 0 projects$/.test(cleoRow.meta) &&
        cleoRow.usage === '0 of 250 MB used' &&
        cleoRow.title === '@cleo',
      `each row: handle, address, dates, projects, and storage against the quota (${show(cleoRow && { meta: cleoRow.meta, usage: cleoRow.usage })})`,
    );
    const boss = await userRow(p, 'boss');
    t.ok(boss?.title === '@boss owner' && /^\d+(\.\d+)? of 10 GB used$/.test(boss.usage), `the owner's row says so, with its 10 GB (${show(boss && { title: boss.title, usage: boss.usage })})`);
    const leaving = await userRow(p, 'leaving');
    t.ok(leaving?.title === '@leaving being deleted' && leaving.status === 'deleting', `an account being deleted says so (${leaving?.title})`);

    // Signed out everywhere.
    await manage(p, cleo);
    cleoRow = await userRow(p, 'cleo');
    t.ok(
      /^0 passkeys · signed in on 1 session · /.test(cleoRow?.detail ?? '') &&
        show(cleoRow?.buttons) === show(['Suspend', 'Revoke sessions', 'Set quota', 'Recount']),
      `Manage opens the account: its passkeys and sessions counted, and what can be done (${show(cleoRow && { detail: cleoRow.detail.slice(0, 60), buttons: cleoRow.buttons })})`,
    );
    await p.click(`${rowOf(cleo)} .admin-user__revoke`);
    t.eq(await panelSays(p, cleo, /signed out of/), '@cleo is signed out of 1 session.', 'Revoke sessions signs it out everywhere, and says how many');
    t.eq((await me(cp)).status, 401, 'its browser is signed out');

    // Suspended: a reason is needed, asked about, mailed; the holder's cookie then answers 403 suspended.
    const sent = writes(`/admin/api/users/${cleo}/suspend`);
    await p.click(`${rowOf(cleo)} .admin-user__suspend button[type=submit]`);
    t.eq(await panelSays(p, cleo, /Give a reason/), 'Give a reason: it is mailed to them, and kept on the account while it is suspended.', 'Suspend wants a reason');
    t.eq(writes(`/admin/api/users/${cleo}/suspend`), sent, 'and sends nothing without one');
    const mailed = await lastMail(server, 'cleo@example.com');
    await p.fill(`${rowOf(cleo)} .admin-user__reason`, 'Spam in the gallery');
    await p.click(`${rowOf(cleo)} .admin-user__suspend button[type=submit]`);
    t.eq(await panelSays(p, cleo, /is suspended/), '@cleo is suspended, and has been mailed the reason.', 'confirmed, it is suspended');
    cleoRow = await userRow(p, 'cleo');
    t.ok(cleoRow?.title === '@cleo suspended' && /Suspended: Spam in the gallery/.test(cleoRow.detail) && show(cleoRow.buttons) === show(['Unsuspend', 'Set quota', 'Recount']), `the row says so, with the reason, and offers Unsuspend (${show(cleoRow && { title: cleoRow.title, buttons: cleoRow.buttons })})`);
    const notice2 = await mailAfter(server, 'cleo@example.com', mailed);
    t.ok(notice2?.subject === 'Your Bozzetto account is suspended' && /The reason given: Spam in the gallery/.test(notice2.body), `its holder is mailed the reason ("${notice2?.subject}")`);
    const refused = await cp.evaluate(async () => {
      const r = await fetch('/api/me');
      return { status: r.status, code: (await r.json().catch(() => ({}))).code };
    });
    t.ok(refused.status === 403 && refused.code === 'suspended', `and its browser is answered 403 suspended (${show(refused)})`);

    // An Unsuspend from a panel drawn before someone else lifted it: refused, said, drawn again.
    const lifted = await p.evaluate((id) => fetch(`/admin/api/users/${id}/unsuspend`, { method: 'POST' }).then((r) => r.status), cleo);
    t.eq(lifted, 200, 'lifted meanwhile, in another tab');
    await p.click(`${rowOf(cleo)} .admin-user__unsuspend`);
    t.eq(await panelSays(p, cleo, /active now/), '@cleo is active now, so that cannot be done. It is shown as it is now.', "the stale panel's Unsuspend is refused as a sentence (409 wrong_status)");
    cleoRow = await userRow(p, 'cleo');
    t.ok(cleoRow?.status === 'active' && show(cleoRow.buttons) === show(['Suspend', 'Revoke sessions', 'Set quota', 'Recount']), `and the account is drawn as it now is (${show(cleoRow && { status: cleoRow.status, buttons: cleoRow.buttons })})`);

    // The quota, in MiB.
    const quotas = writes(`/admin/api/users/${cleo}/quota`);
    await p.fill(`${rowOf(cleo)} .admin-user__quota`, '0');
    await p.click(`${rowOf(cleo)} .admin-user__setquota`);
    t.eq(await panelSays(p, cleo, /whole number/), 'A quota is a whole number of MiB from 1 to 102,400.', 'a quota out of range is said so');
    t.eq(writes(`/admin/api/users/${cleo}/quota`), quotas, 'and nothing is sent');
    await p.fill(`${rowOf(cleo)} .admin-user__quota`, '500');
    await p.click(`${rowOf(cleo)} .admin-user__setquota`);
    t.eq(await panelSays(p, cleo, /quota is/), "@cleo's quota is 500 MB.", 'Set quota changes it');
    cleoRow = await userRow(p, 'cleo');
    const stored = (await server.call('GET', `/api/dev/user?id=${cleo}`)).body?.user?.quota_bytes;
    t.ok(cleoRow?.usage === '0 of 500 MB used' && stored === 500 * MiB, `the bar and the account both have it (${cleoRow?.usage}; ${stored})`);

    // Recount: a count that drifted from what R2 holds.
    await manage(p, DRIFT.id);
    let drift = await userRow(p, 'drift');
    t.eq(drift?.usage, '5 of 250 MB used', 'an account whose count says 5 MB');
    await p.click(`${rowOf(DRIFT.id)} .admin-user__recount`);
    t.eq(await panelSays(p, DRIFT.id, /Counted again/), 'Counted again: 0 KB, where it said 5 MB.', 'Recount counts what it stores from the files themselves');
    drift = await userRow(p, 'drift');
    t.eq(drift?.usage, '0 of 250 MB used', 'and the row has the new count');

    // The owner's own account: neither suspended nor signed out from here.
    const ownerId = boss?.id ?? '';
    await manage(p, ownerId);
    const own = await userRow(p, 'boss');
    t.ok(
      show(own?.buttons) === show(['Set quota', 'Recount']) && /Your own account: it is not suspended, signed out everywhere or deleted from here\./.test(own?.detail ?? ''),
      `the owner's own account offers only its quota and a recount, and says why (${show(own?.buttons)})`,
    );
    const ownRefusal = await p.evaluate((id) => fetch(`/admin/api/users/${id}/suspend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"reason":"x"}' }).then(async (r) => ({ status: r.status, code: (await r.json()).code })), ownerId);
    t.ok(ownRefusal.status === 409 && ownRefusal.code === 'owner', `as the server would refuse (${show(ownRefusal)})`);

    // A deletion left waiting, finished.
    await manage(p, LEAVING.id);
    const half = await userRow(p, 'leaving');
    t.ok(show(half?.buttons) === show(['Finish deletion']) && /Its deletion began .+ and has not finished\./.test(half?.detail ?? ''), `an account being deleted offers Finish deletion alone (${show(half?.buttons)})`);
    await p.click(`${rowOf(LEAVING.id)} .admin-user__finish`);
    t.eq(await panelSays(p, LEAVING.id, /is deleted/), '@leaving is deleted, with everything in it.', 'Finish deletion carries it to its end');
    const after = await p.evaluate(() => ({ notice: !document.querySelector('.admin-users__pending').hidden }));
    const gone = (await server.call('GET', `/api/dev/user?id=${LEAVING.id}`)).body?.user ?? null;
    t.ok(!after.notice && gone === null, `the account is gone, and so is the flag (${show({ ...after, gone })})`);
  } finally {
    await c.ctx.close();
  }

  // --- Audit ---------------------------------------------------------------------------
  await ownerTab(o, 'audit', '.admin-audit__row');
  const log = () =>
    p.evaluate(() => ({
      rows: [...document.querySelectorAll('.admin-audit__row')].map((r) => ({
        id: Number(r.dataset.audit),
        action: r.querySelector('.admin-audit__action').textContent,
        subject: r.querySelector('.admin-audit__subjectbtn')?.textContent ?? null,
        detail: r.querySelector('.admin-audit__detail')?.textContent ?? '',
      })),
      more: !document.querySelector('.admin-audit__more').hidden,
      actions: [...document.querySelectorAll('.admin-audit__byaction option')].map((o2) => o2.value).filter(Boolean),
      search: location.search,
    }));
  let a = await log();
  t.ok(
    a.rows.length === 50 && a.more && a.rows[0].action === 'account.finish_deletion' && a.rows[0].subject === LEAVING.id,
    `the log, newest first, 50 a page: the deletion just finished on top (${show(a.rows.slice(0, 3))})`,
  );
  t.ok(
    ['invite.create', 'invite.revoke', 'account.suspend', 'account.unsuspend', 'account.quota', 'account.recount', 'account.revoke_sessions', 'test.seeded'].every((x) => a.actions.includes(x)),
    `the action filter offers what the log holds (${show(a.actions)})`,
  );
  await p.selectOption('.admin-audit__byaction', 'account.suspend');
  await p.click('.admin-audit__filter button[type=submit]');
  // The list has rows again, every one of them the filter's (an empty list, still loading, is not).
  await p
    .waitForFunction(
      () => {
        const rows = [...document.querySelectorAll('.admin-audit__row .admin-audit__action')];
        return rows.length > 0 && rows.every((x) => x.textContent === 'account.suspend');
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  a = await log();
  t.ok(a.rows.length >= 2 && a.rows.every((r) => r.action === 'account.suspend') && /action=account\.suspend/.test(a.search), `filtered by action: only suspensions, and the address keeps it (${a.rows.length}; ${a.search})`);
  await p.click('.admin-audit__row .admin-audit__subjectbtn');
  await p
    .waitForFunction(
      () => {
        const want = document.querySelector('.admin-audit__subject').value;
        const rows = [...document.querySelectorAll('.admin-audit__row')];
        return !!want && rows.length > 0 && rows.every((r) => r.querySelector('.admin-audit__subjectbtn')?.textContent === want);
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  a = await log();
  const subject = await p.evaluate(() => document.querySelector('.admin-audit__subject').value);
  t.ok(
    !!subject && a.rows.length > 1 && a.rows.every((r) => r.subject === subject) && new Set(a.rows.map((r) => r.action)).size > 1,
    `a row's subject, pressed, filters by it: everything about that account (${subject}: ${show([...new Set(a.rows.map((r) => r.action))])})`,
  );
  await p.selectOption('.admin-audit__byaction', 'test.seeded');
  await p.fill('.admin-audit__subject', '');
  await p.click('.admin-audit__filter button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.admin-audit__row').length === 50, null, { timeout: 15_000 }).catch(() => {});
  a = await log();
  t.ok(a.rows.length === 50 && a.more, `a filter with more than a page has Load more (${a.rows.length})`);
  await p.click('.admin-audit__more');
  await p.waitForFunction((n) => document.querySelectorAll('.admin-audit__row').length === n, SEEDED_ROWS, { timeout: 15_000 }).catch(() => {});
  a = await log();
  // The seed wrote row n a second before row n-1: newest first is n in order.
  const order = a.rows.map((r) => r.detail);
  t.ok(
    a.rows.length === SEEDED_ROWS && !a.more && order.every((d, i) => d === `n ${i}`) && new Set(a.rows.map((r) => r.id)).size === SEEDED_ROWS,
    `Load more brings the rest, newest first, none twice, and no more (${a.rows.length}: ${order.slice(48, 52).join(', ')})`,
  );
  await p.click('.admin-audit__clear');
  await p.waitForFunction(() => document.querySelectorAll('.admin-audit__row').length === 50 && document.querySelector('.admin-audit__byaction').value === '', null, { timeout: 15_000 }).catch(() => {});
  a = await log();
  t.ok(a.rows[0]?.action === 'account.finish_deletion' && a.search === '?tab=audit', `Clear shows the whole log again (${a.search})`);
}

export const suites = {
  async accounts(page, base, t) {
    const browser = page.context().browser();
    try {
      build(resolve('dist'), t);
    } catch (e) {
      t.ok(false, `the build checks threw: ${e?.stack ?? e}`);
    }
    const turnstile = await startTurnstileFake();
    const now = Date.now();
    const seed = [
      seedInvite({ id: 'inv-join', name: 'join', expires: now + 14 * DAY }),
      seedInvite({ id: 'inv-spent', name: 'spent', expires: now + 14 * DAY, maxUses: 1, uses: 1 }),
      seedInvite({ id: 'inv-join2', name: 'join2', expires: now + 14 * DAY }),
      ownerToolsSeed(now),
    ].join('\n');
    let server = null;
    try {
      server = await startAccountsServer({
        dist: resolve('dist'),
        seed,
        vars: { TURNSTILE_SECRET, TURNSTILE_VERIFY_URL: turnstile.url, TURNSTILE_SITE_KEY: SITE_KEY },
      });
    } catch (err) {
      t.ok(false, `the accounts server started: ${err?.message ?? err}`);
      await turnstile.close();
      return;
    }
    const part = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        t.ok(false, `${name} threw: ${e?.stack ?? e}`);
      }
    };
    clock.offset = 0;
    const a = await browserFor(browser, server.base, { ip: '203.0.113.11', authenticator: true });
    let o = null;
    try {
      await part('join', () => joinWithInvite(server, turnstile, a, t));
      await part('sign out', () => signOut(a, t));
      await part('passkey sign-in', () => passkeySignIn(a, t));
      await part('sign out again', () => signOut(a, t));
      await part('passkey fallback', () => passkeyFallback(a, t));
      await part('sign out once more', () => signOut(a, t));
      await part('code sign-in', () => codeSignIn(server, turnstile, a, t));
      await part('passkeys', () => accountPasskeys(server, a, t));
      await part('sessions', () => accountSessions(server, browser, a, t));
      await part('handle', () => accountHandle(a, t));
      await part('email', () => accountEmail(server, a, t));
      await part('codes only', () => codesOnly(server, browser, t));
      await part('mailed link', () => mailedLink(server, browser, t));
      await part('code resend', () => codeResend(server, turnstile, browser, t));
      await part('desktop window', () => desktopWindow(server, browser, t));
      await part('spent invite', () => spentInvite(browser, server.base, t));
      await part('legal pages', () => legalPages(browser, server.base, t));
      // The owner: Create your account, the second lock, Sculpt's saves.
      o = await browserFor(browser, server.base, { ip: '203.0.113.20', access: true, authenticator: true });
      let scene = '';
      await part('owner', async () => {
        scene = await owner(server, o, t);
      });
      await part('edit from projects', () => editFromProjects(o, scene, t));
      await part('suspension', () => suspension(server, browser, o, t));
      // The member's own projects (Batch 8), the owner's tools at hand for the quota and the sessions.
      await part('member library', () => memberLibrary(server, o, a, t));
      await part('my projects', () => myProjectsPage(server, a, t));
      await part('download my data', () => exportData(server, a, t));
      await part('delete account', () => deleteAccount(server, a, t));
      // The owner's tools over accounts (Batch 9): Invites, Users, Audit.
      await part('owner pages', () => ownerPages(server, browser, o, t));
      t.ok(!a.errors.length, `no page errors in the member's browser${a.errors.length ? `: ${a.errors.join(' | ')}` : ''}`);
      t.ok(!o.errors.length, `no page errors in the owner's browser${o.errors.length ? `: ${o.errors.join(' | ')}` : ''}`);
    } finally {
      await a.ctx.close();
      await o?.ctx.close();
      const log = server.log();
      await server.close();
      await turnstile.close();
      if (/Uncaught|Error:/.test(log) && process.env.E2E_ACCOUNTS_LOG) console.log(log.split('\n').slice(-80).join('\n'));
    }
  },
};
