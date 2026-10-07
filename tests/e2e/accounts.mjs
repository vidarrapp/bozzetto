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
// verification; a code sign-in with a wrong
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
// goes again once signed in from its notice; an account the owner
// suspends is told so, in the top row, the gallery, Sculpt and Account,
// offered Sign out and never Sign in. First of all, the build: the
// worker's rules for the account and the site's settings, the legal pages
// in its precache on the built stylesheet, and the policy admitting
// Turnstile.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSculpt, startAccountsServer } from './lib.mjs';
import { workerRoutes } from './smoke.mjs';
import { TURNSTILE_SECRET, startTurnstileFake } from '../functions/turnstile-fake.mjs';
import { inviteToken, seedInvite } from '../functions/lib.mjs';

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
 * Counted, so the suite can see one was asked for, and stopped.
 */
function waitingAutofill() {
  const real = navigator.credentials.get.bind(navigator.credentials);
  window.__autofill = { asked: 0, ended: 0 };
  navigator.credentials.get = (options) => {
    if (options?.mediation !== 'conditional') return real(options);
    window.__autofill.asked++;
    return new Promise((_, reject) => {
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
  await p.evaluate(() => caches.open('bozzetto-me').then((c) => c.put('/api/me', new Response('{}'))));
  await p.click(`.topbar--right .topchip:text-is("@${label}")`);
  await p.click('.account-menu button:text-is("Sign out")');
  await p.waitForURL((u) => u.pathname === '/' && !u.search, { timeout: 15_000 }).catch(() => {});
  await p.waitForSelector('#landing-grid .card--new', { timeout: 30_000 }).catch(() => {});
  t.ok(await chipShown(p, 'Sign in'), `signed out, the top row says Sign in (${(await chips(p)).join(', ')})`);
  const cookies = (await a.ctx.cookies()).map((c) => c.name);
  t.ok(!cookies.includes('__Host-bz_session') && (await me(p)).status === 401, `the session cookie is gone, and /api/me says signed out (${show(cookies)})`);
  t.ok(a.requests.some((r) => r.method === 'POST' && r.path === '/api/auth/signout'), 'through POST /api/auth/signout');
  t.ok(!(await p.evaluate(() => caches.has('bozzetto-me'))), 'and the kept copy of the account goes with it');
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
  // Without user verification the browser refuses, and the dialog says so and stays.
  await a.auth.cdp.send('WebAuthn.setUserVerified', { authenticatorId: a.auth.id, isUserVerified: false });
  await press(p, '.account-card', 'Use a passkey');
  t.eq(await saidLike(p, /cancelled/), 'The passkey request was cancelled, or timed out.', 'a passkey that cannot verify its user signs nobody in, and the dialog says so');
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
  const later = await p.evaluate(() => [...document.querySelectorAll('[data-section="data"] .account-item')].map((r) => ({ meta: r.querySelector('.account-item__meta').textContent, disabled: r.querySelector('button').disabled })));
  t.ok(later.length === 2 && later.every((r) => r.disabled && /Arrives with the next update\.$/.test(r.meta)), `Download my data and Delete account say they arrive with the next update (${show(later)})`);
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
  const never = ['/api/me/account', '/api/auth/passkey/options', '/api/me/media/p-abc/scene.bozz'].filter((u) => route(u)?.handler !== 'NetworkOnly');
  t.ok(!never.length, `and still sends the account's details, the ceremonies and a member's files to the network${never.length ? `: not ${never.join(', ')}` : ''}`);
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
async function owner(server, browser, t) {
  const o = await browserFor(browser, server.base, { ip: '203.0.113.20', access: true, authenticator: true });
  try {
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

    // Sculpt: Save to library goes to Projects; with the session gone it is
    // kept here, and Sign in again from the notice signs in and saves.
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
    t.ok(/^Saved to Projects: /.test(first), `the owner's Save to library uploads ("${first}")`);
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
    t.ok(again.some((x) => /^done: Saved to Projects: /.test(x)), `signed in, the save goes again by itself (${show(again)})`);
    const unsent = await p.evaluate(() => window.__sculpt.fileActions.unsentCopy);
    t.eq(unsent, null, 'and the copy kept on the device is let go');
    await suspension(server, browser, o, t);
    t.ok(!o.errors.length, `no page errors in the owner's browser${o.errors.length ? `: ${o.errors.join(' | ')}` : ''}`);
  } finally {
    await o.ctx.close();
  }
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
    try {
      await part('join', () => joinWithInvite(server, turnstile, a, t));
      await part('sign out', () => signOut(a, t));
      await part('passkey sign-in', () => passkeySignIn(a, t));
      await part('sign out again', () => signOut(a, t));
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
      t.ok(!a.errors.length, `no page errors in the member's browser${a.errors.length ? `: ${a.errors.join(' | ')}` : ''}`);
    } finally {
      await a.ctx.close();
    }
    try {
      await part('owner', () => owner(server, browser, t));
    } finally {
      const log = server.log();
      await server.close();
      await turnstile.close();
      if (/Uncaught|Error:/.test(log) && process.env.E2E_ACCOUNTS_LOG) console.log(log.split('\n').slice(-80).join('\n'));
    }
  },
};
