// The passkey check (/?passkeycheck, accounts batch 0): the page the owner
// opens on the iPad, in Safari and in the installed app, to learn whether
// passkeys and Turnstile work there. Here it runs against Chromium's
// virtual authenticator (CDP WebAuthn: an internal, user-verifying one
// with resident keys whose passkeys say they are backed up), at the
// harness's localhost origin, since WebAuthn takes localhost as an RP ID
// and refuses an IP address. The browser's own rows read sensibly; a test
// passkey is created and shows its attachment, transports and flags; both
// modal sign-ins verify the user; the autofill request is reported
// whether or not anything is offered, never hangs, and is stopped and
// started again around the modal prompts; the bot check's script is
// injected (answered here by a stand-in that calls back), with what a
// report-only policy would block listed; and Copy report carries it all.
// Preferences > Diagnostics leads there, and the installed app opens it
// offline from its shell.
import { openSculpt } from './lib.mjs';
import { workerActivated } from './smoke.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const show = (o) => JSON.stringify(o);

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

const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** A policy that, like the site's, lets nothing from Cloudflare in: report-only. */
const POLICY = "script-src 'self'; frame-src 'self'";

/**
 * Turnstile's stand-in: a widget drawn as Turnstile draws one, a frame from
 * challenges.cloudflare.com, then the callback with the test keys' token.
 */
const TURNSTILE_STUB = `
  window.__turnstile = [];
  window.turnstile = {
    render(el, opts) {
      window.__turnstile.push({
        sitekey: opts.sitekey,
        appearance: opts.appearance,
        callbacks: Object.keys(opts).filter((k) => typeof opts[k] === 'function').sort(),
      });
      const frame = document.createElement('iframe');
      frame.src = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/stub';
      frame.title = 'stub';
      el.appendChild(frame);
      setTimeout(() => opts.callback('XXXX.DUMMY.TOKEN.XXXX'), 50);
      return 'stub-widget';
    },
  };
`;

/**
 * A browser whose autofill request waits for the field, as Safari's and
 * Chrome's do with their pickers, until it is stopped. The virtual
 * authenticator never waits there: it fails such a request at once with
 * no passkey and completes it at once with one.
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

/** A row's value on the page, by its step and key, or null. */
const value = (p, step, key) =>
  p.evaluate(([s, k]) => document.querySelector(`[data-check="${s}"] [data-row="${k}"] dd`)?.textContent ?? null, [step, key]);

/** A step's rows, as { key: value }. */
const rows = (p, step) =>
  p.evaluate(
    (s) => Object.fromEntries([...document.querySelectorAll(`[data-check="${s}"] [data-row]`)].map((r) => [r.dataset.row, r.querySelector('dd').textContent])),
    step,
  );

/** Wait (bounded) for a row to match; its value either way. */
async function until(p, step, key, re, timeout = 15_000) {
  await p
    .waitForFunction(
      ([s, k, src]) => new RegExp(src).test(document.querySelector(`[data-check="${s}"] [data-row="${k}"] dd`)?.textContent ?? ''),
      [step, key, re.source],
      { timeout },
    )
    .catch(() => {});
  return value(p, step, key);
}

const press = (p, label) => p.click(`button:text-is("${label}")`);
const enabled = (p, label) => p.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.textContent === l)?.disabled === false, label);

/** The page loaded and step 1 answered. */
async function openCheck(p, origin) {
  await p.goto(`${origin}/?passkeycheck`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-check="env"] [data-row="capabilities"]', { timeout: 30_000 });
  await until(p, 'env', 'capabilities', /^(?!checking)/);
}

/** A page whose errors are kept, and a virtual authenticator on it. */
async function authenticated(ctx) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
  return { p, errors, cdp, authenticatorId };
}

/** Copy report, and what it put on the clipboard. */
async function copyReport(p) {
  await p.bringToFront();
  await p.evaluate(() => {
    document.querySelector('.pkcheck__copied').textContent = '';
  });
  await p.click('button:text-is("Copy report")');
  await p.waitForFunction(() => !!document.querySelector('.pkcheck__copied')?.textContent, null, { timeout: 10_000 }).catch(() => {});
  const said = await p.evaluate(() => document.querySelector('.pkcheck__copied')?.textContent ?? '');
  const text = await p.evaluate(() => navigator.clipboard.readText()).catch((e) => `unread: ${e}`);
  return { said, text };
}

const base64url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// --- the parts -------------------------------------------------------------

/** Every step against the virtual authenticator, then the report. */
async function ceremonies(browser, origin, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const { p, errors, cdp, authenticatorId } = await authenticated(ctx);
    const cloudflare = [];
    await ctx.route('https://challenges.cloudflare.com/**', (route) => {
      const url = route.request().url();
      cloudflare.push(url);
      if (url.startsWith('https://challenges.cloudflare.com/turnstile/')) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_STUB });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    });
    // The site's policy reports what it would block; so does this one.
    await ctx.route(
      (url) => url.origin === origin && url.pathname === '/' && url.searchParams.has('passkeycheck'),
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy-report-only': POLICY } });
      },
    );

    // 1. The browser.
    await openCheck(p, origin);
    const env = await rows(p, 'env');
    t.eq(await p.title(), 'Bozzetto: passkey check', 'the page names itself');
    t.ok(
      env.rpid === 'localhost' && env.secure === 'yes' && env.webauthn === 'yes' && env.platform === 'yes',
      `the browser's rows: RP ID localhost, a secure context, Web Authentication and a verifying built-in authenticator (${show([env.rpid, env.secure, env.webauthn, env.platform])})`,
    );
    t.ok(
      env.standalone === 'no' && /^unknown/.test(env.navstandalone) && env.displaymode === 'browser' && /HeadlessChrome/.test(env.ua) && env.touch === '0',
      `opened in a tab, not from the Home Screen, with the user agent and touch points (${show([env.standalone, env.navstandalone, env.displaymode, env.touch])})`,
    );
    const caps = Object.keys(env).filter((k) => k.startsWith('cap-'));
    t.ok(
      env.conditional === 'yes' && /^\d+ reported$/.test(env.capabilities) && env['cap-conditionalGet'] === 'yes' && env['cap-passkeyPlatformAuthenticator'] === 'yes' && caps.every((k) => /^(yes|no)$/.test(env[k])),
      `autofill sign-in available, and the client capabilities each a yes or a no (${env.capabilities}: ${caps.map((k) => `${k.slice(4)} ${env[k]}`).join(', ')})`,
    );
    // Asked for as the page opened; with no passkey yet, the virtual
    // authenticator ends it at once, where a real picker waits.
    const asked = await until(p, 'autofill', 'request', /^(waiting|failed|completed)/, 10_000);
    t.ok(/^(waiting|failed|completed)/.test(asked ?? ''), `the autofill request is made as the page opens, and reported without hanging (${asked})`);
    t.ok(!(await enabled(p, 'Sign in with the test passkey')), 'with no test passkey yet, step 3 waits for step 2');

    // 2. Create.
    await press(p, 'Create a test passkey');
    await until(p, 'create', 'result', /^(created|failed|nothing)/);
    const made = await rows(p, 'create');
    t.ok(made.result === 'created' && /^Bozzetto passkey check \d{4}-\d\d-\d\d \d\d:\d\d$/.test(made.name), `a test passkey is created, named for the day (${made.result}; ${made.name})`);
    t.ok(
      made.attachment === 'platform' && made.transports === 'internal' && made.algorithm === 'ES256 (-7)' && made.discoverable === 'yes',
      `on the built-in authenticator, ES256 and discoverable (${show([made.attachment, made.transports, made.algorithm, made.discoverable])})`,
    );
    t.ok(
      made.uv === 'yes' && made.be === 'yes' && made.bs === 'yes' && made.flags === '0x5d (UP UV BE BS AT)' && /^\d+\.\d s$/.test(made.time),
      `with its flags read: verified, backup eligible and backed up, and the time taken (${made.flags}, ${made.time})`,
    );
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    const stored = await p.evaluate(() => JSON.parse(sessionStorage.getItem('bozzetto-passkey-check') ?? 'null'));
    const cred = credentials[0] ?? {};
    t.ok(
      credentials.length === 1 && cred.isResidentCredential && cred.rpId === 'localhost' && cred.userName === made.name && cred.userDisplayName === made.name,
      `the authenticator holds one resident passkey for localhost, by that name (${show({ n: credentials.length, resident: cred.isResidentCredential, rpId: cred.rpId, userName: cred.userName })})`,
    );
    t.ok(
      !!stored && base64url(cred.credentialId ?? '') === stored.id && base64url(cred.userHandle ?? '') === stored.userId && made.id === `${stored.id.slice(0, 12)}…`,
      `its id and its user's id are kept in this tab for the next step, the page showing the id's first 12 characters (${made.id})`,
    );
    t.eq(base64url(cred.userHandle ?? '').length, 22, 'the user id is 16 random bytes');

    // 3. Sign in with it.
    t.ok(await enabled(p, 'Sign in with the test passkey'), 'step 3 can now ask for it');
    await press(p, 'Sign in with the test passkey');
    await until(p, 'signin', 'result', /^(signed|failed|nothing)/);
    const modal = await rows(p, 'signin');
    t.ok(
      modal.result === 'signed in' && modal.test === 'yes' && /\(the test passkey's user\)$/.test(modal.user) && /^the test passkey \(id /.test(modal.asked),
      `the modal sign-in, asked for the test passkey by id, signs in with it (${modal.result}; ${modal.asked}; ${modal.user})`,
    );
    t.ok(
      modal.uv === 'yes' && modal.flags === '0x1d (UP UV BE BS)' && /^[1-9]\d*$/.test(modal.counter) && /^\d+\.\d s$/.test(modal.time),
      `with the user verified, the flags byte, the signature counter and the time (${show([modal.flags, modal.counter, modal.time])})`,
    );

    // 4. Any passkey for this site.
    await press(p, 'Choose a passkey');
    await until(p, 'signinany', 'result', /^(signed|failed|nothing)/);
    const any = await rows(p, 'signinany');
    t.ok(
      any.result === 'signed in' && any.asked === 'any passkey for this site' && any.test === 'yes' && any.uv === 'yes' && Number(any.counter) > Number(modal.counter),
      `asked for no passkey in particular, the device's own one comes back, verified, its counter on (${show([any.result, any.test, any.counter])})`,
    );

    // 5. Autofill. With a passkey for the site the virtual authenticator
    // picks it at once, so the request completes rather than waits.
    if (!/^waiting/.test((await value(p, 'autofill', 'request')) ?? '')) await press(p, 'Start the autofill request');
    await until(p, 'autofill', 'request', /^completed/, 5000);
    const filled = await rows(p, 'autofill');
    t.ok(
      /^waiting/.test(filled.request) || (/^completed/.test(filled.request) && filled.offered === 'yes (picked from the field)' && filled.result === 'signed in' && filled.uv === 'yes' && filled.test === 'yes'),
      `started again, the autofill request is offered-or-not without hanging (${filled.request}; offered ${filled.offered})`,
    );
    const field = await p.evaluate(() => {
      const f = document.querySelector('[data-check="autofill"] input');
      return `${f.type} ${f.getAttribute('autocomplete')}`;
    });
    t.eq(field, 'email username webauthn', 'the field is an email field that asks for passkeys');
    await press(p, 'It was not offered');
    t.eq(await value(p, 'autofill', 'offered'), 'no (as seen)', 'what the owner saw is recorded');

    // 6. The bot check.
    t.ok(!cloudflare.length, 'nothing is fetched from Cloudflare until asked');
    await press(p, 'Load the bot check');
    const token = await until(p, 'turnstile', 'token', /^received/);
    const bot = await rows(p, 'turnstile');
    const widget = await p.evaluate(() => window.__turnstile);
    t.ok(cloudflare[0] === TURNSTILE && /^loaded in/.test(bot.script) && /^drawn/.test(bot.widget), `the script is injected from ${TURNSTILE} and the widget drawn (${bot.script}; ${bot.widget})`);
    t.ok(
      widget?.length === 1 && widget[0].sitekey === '1x00000000000000000000AA' && widget[0].appearance === 'interaction-only' &&
        ['after-interactive-callback', 'before-interactive-callback', 'callback', 'error-callback', 'expired-callback', 'timeout-callback', 'unsupported-callback'].every((c) => widget[0].callbacks.includes(c)),
      `with the always-pass test key, interaction only, and every event heard (${show(widget)})`,
    );
    t.ok(/^received after \d+\.\d s \(21 characters\)$/.test(token ?? ''), `the callback's token is reported (${token})`);
    const policy = await until(p, 'turnstile', 'policy', /frame-src/);
    t.ok(
      /script-src-elem https:\/\/challenges\.cloudflare\.com \(reported only\)/.test(policy ?? '') && /frame-src https:\/\/challenges\.cloudflare\.com \(reported only\)/.test(policy ?? ''),
      `what a report-only policy would block is listed: Cloudflare's script and frame (${policy})`,
    );

    // 7. The report.
    const { said, text } = await copyReport(p);
    const wanted = [
      'Bozzetto passkey check',
      `Address: ${origin}/?passkeycheck`,
      '1. This browser',
      '  Passkey domain (RP ID): localhost',
      '    conditionalGet: yes',
      '2. Create a test passkey',
      '  Attachment: platform',
      '  Transports: internal',
      '  Backed up (BS): yes',
      '3. Sign in with the test passkey',
      '  Flags: 0x1d (UP UV BE BS)',
      `  Signature counter: ${modal.counter}`,
      '4. Sign in with any passkey for this site',
      `  Signature counter: ${any.counter}`,
      '5. Sign in from the email field',
      '  Offered in the field: no (as seen)',
      '6. Bot check',
      '  Token: received after',
      '  Policy reports: script-src-elem https://challenges.cloudflare.com (reported only)',
    ];
    const missing = wanted.filter((w) => !text.includes(w));
    t.ok(said === 'Copied. Paste it into a message.' && !missing.length, `Copy report puts every step's rows on the clipboard as plain text (${said}${missing.length ? `; missing: ${show(missing)}` : ''})`);

    // A reload keeps the test passkey for step 3, and step 2 says so.
    await openCheck(p, origin);
    const kept = await rows(p, 'create');
    t.ok(
      (await enabled(p, 'Sign in with the test passkey')) && kept.result === 'made earlier in this tab' && kept.name === made.name && kept.id === made.id,
      `after a reload the tab still has the test passkey, and step 2 says it was made earlier (${show(kept)})`,
    );
    await press(p, 'Sign in with the test passkey');
    t.eq(await until(p, 'signin', 'result', /^(signed|failed)/), 'signed in', 'and step 3 still signs in with it');

    // A sign-in the authenticator cannot verify is refused, and said so.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await press(p, 'Sign in with the test passkey');
    const refused = await until(p, 'signin', 'result', /^failed/);
    t.ok(/^failed: NotAllowedError: .+ \(cancelled, timed out, or refused by the browser\)$/.test(refused ?? '') && /^\d+\.\d s$/.test((await value(p, 'signin', 'time')) ?? ''), `without user verification it fails, by name and message (${refused})`);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    const again = (await copyReport(p)).text;
    t.ok(
      again.includes(`2. Create a test passkey\n  Result: made earlier in this tab\n  Name: ${made.name}`) && /\n3\. Sign in with the test passkey\n {2}Result: failed: NotAllowedError/.test(again) && again.includes('6. Bot check\n  (not tried)'),
      'the report gives each step its latest attempt',
    );
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

/**
 * The autofill request waiting, as it does with a real picker: the button
 * stops it and starts it again, and a modal prompt stops it while it runs
 * and starts it again after.
 */
async function waitingRequest(browser, origin, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    await ctx.addInitScript(waitingAutofill);
    const { p, errors, cdp, authenticatorId } = await authenticated(ctx);
    await openCheck(p, origin);
    let request = await until(p, 'autofill', 'request', /^waiting/);
    t.ok(request === 'waiting: tap the field' && (await p.evaluate(() => window.__autofill.asked)) === 1, `the request waits for the field (${request})`);
    await press(p, 'Stop the autofill request');
    request = await until(p, 'autofill', 'request', /^stopped/);
    t.eq(request, 'stopped by the button (the browser ended it: AbortError)', 'the button stops it, and the browser ends it');
    t.ok(await enabled(p, 'Start the autofill request'), 'and offers to start it again');
    await press(p, 'Start the autofill request');
    request = await until(p, 'autofill', 'request', /^waiting/);
    t.ok(/^waiting/.test(request ?? '') && (await enabled(p, 'Stop the autofill request')), `started again, it waits (${request})`);

    await press(p, 'Create a test passkey');
    await until(p, 'create', 'result', /^(created|failed)/);
    const made = await rows(p, 'create');
    await until(p, 'autofill', 'request', /^waiting/);
    const counts = await p.evaluate(() => window.__autofill);
    t.ok(
      /^created/.test(made.result) && made.autofill === 'stopped while this ran' && counts.asked === 3 && counts.ended === 2 && /^waiting/.test(await value(p, 'autofill', 'request')),
      `a modal prompt stops the waiting request first and starts it again after (${made.result}; ${made.autofill}; ${show(counts)})`,
    );
    // One that fails just after says how to rule the stopping out.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await press(p, 'Choose a passkey');
    await until(p, 'signinany', 'result', /^failed/);
    const failed = await rows(p, 'signinany');
    t.ok(
      /^failed: NotAllowedError/.test(failed.result) && failed.autofill === 'stopped while this ran; if this failed at once, stop it by hand in step 5 and try again',
      `a prompt that fails after stopping the request says to stop it by hand and try again (${failed.autofill})`,
    );
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

/** An IP address can have no passkey: refused, and the page says why. */
async function ipAddress(browser, base, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    const { p, errors } = await authenticated(ctx);
    await openCheck(p, base);
    await press(p, 'Create a test passkey');
    const result = await until(p, 'create', 'result', /^failed/);
    t.ok(
      (await value(p, 'env', 'rpid')) === '127.0.0.1' && /^failed: SecurityError: .+ \(this address cannot have passkeys: it needs HTTPS and a domain name\)$/.test(result ?? ''),
      `at 127.0.0.1 the create is refused as a SecurityError, said plainly (${result})`,
    );
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

/** Preferences > Diagnostics > Passkey check… leaves Sculpt for the page. */
async function fromPreferences(browser, origin, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    const dialogs = [];
    p.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    await openSculpt(p, origin, '&q=low');
    await p.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await p.keyboard.press('Control+Comma');
    const entry = await p.evaluate(() => {
      const row = document.querySelector('.prefs__body [data-setting="passkeyCheck"]');
      if (!row) return null;
      const groups = [...document.querySelectorAll('.prefs__body > .prefs__group')];
      const diag = groups.find((g) => g.textContent === 'Diagnostics');
      const keys = groups.find((g) => g.textContent === 'Hotkeys');
      const inputLog = document.querySelector('.prefs__body [data-setting="inputLog"]');
      const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        tag: row.tagName,
        title: row.querySelector('.prefs__choice-title')?.textContent,
        hint: row.querySelector('.prefs__choice-hint')?.textContent,
        placed: after(diag, row) && after(inputLog, row) && after(row, keys),
        toggle: row.classList.contains('prefs__toggle'),
      };
    });
    t.ok(
      entry?.tag === 'BUTTON' && entry.title === 'Passkey check…' && entry.placed && !entry.toggle && /passkey/.test(entry.hint ?? ''),
      `Preferences > Diagnostics ends with Passkey check…, a button rather than a box to tick (${show(entry)})`,
    );
    await p.click('[data-setting="passkeyCheck"]');
    await p.waitForURL((url) => url.search === '?passkeycheck', { timeout: 30_000 }).catch(() => {});
    await p.waitForSelector('[data-check="env"]', { timeout: 30_000 }).catch(() => {});
    const there = await p.evaluate(() => ({ search: location.search, steps: document.querySelectorAll('.pkcheck__step').length, back: document.querySelector('.topbar--left .topchip')?.getAttribute('href') }));
    t.ok(there.search === '?passkeycheck' && there.steps === 8 && there.back === '/', `it opens the page in place of Sculpt, with the way back to the gallery (${show(there)})`);
    t.eq(dialogs.join(' | '), '', 'Sculpt stored its work and left without asking');
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

/** The installed app: the worker answers the page from its shell, offline. */
async function offline(browser, origin, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${origin}/?passkeycheck`, { waitUntil: 'load' });
    t.ok(await workerActivated(p), 'the worker installs from the page');
    await ctx.setOffline(true);
    let shown = false;
    try {
      await openCheck(p, origin);
      shown = true;
    } catch {
      shown = false;
    }
    const state = await p.evaluate(() => ({ controlled: !!navigator.serviceWorker.controller, rpid: document.querySelector('[data-row="rpid"] dd')?.textContent ?? null })).catch(() => null);
    t.ok(shown && state?.controlled && state.rpid === 'localhost', `offline, the worker opens /?passkeycheck from its shell (${show(state)})`);
    await ctx.setOffline(false);
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

export const suites = {
  async passkeyCheck(page, base, t) {
    const browser = page.context().browser();
    // WebAuthn takes localhost as an RP ID but not an IP address.
    const origin = base.replace('127.0.0.1', 'localhost');
    const part = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        t.ok(false, `${name} threw: ${e?.stack ?? e}`);
      }
    };
    await part('the ceremonies', () => ceremonies(browser, origin, t));
    await part('a waiting request', () => waitingRequest(browser, origin, t));
    await part('an IP address', () => ipAddress(browser, base, t));
    await part('from Preferences', () => fromPreferences(browser, origin, t));
    await part('offline', () => offline(browser, origin, t));
  },
};
