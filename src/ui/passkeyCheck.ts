import { div } from './dom';
import { installedMode } from './launch';
import { topChip, topbarLeft } from './topbar';
import { APP_VERSION } from './version';

/**
 * The passkey check (`/?passkeycheck`, or Preferences > Diagnostics >
 * Passkey check…): batch 0 of the accounts work (docs/accounts.md §7, §12).
 * Accounts will sign in with passkeys and guard sign-up with Turnstile, and
 * the device that matters most is the owner's iPad running Bozzetto from
 * the Home Screen, which has its own cookie jar and where passkey prompts
 * are reported to misbehave. So before anything is built on either, this
 * page tries both, in Safari and in the installed app, and says what
 * happened in rows that copy out as plain text.
 *
 * Nothing goes to any server of Bozzetto's. The challenges are random bytes
 * and nothing is verified, which is enough to learn whether the ceremonies
 * run and what the authenticator says. The test passkey is real all the
 * same, kept by the device's password manager, and the page says how to
 * delete it. main.ts imports this module only when the page is opened, so
 * none of it runs anywhere else.
 */

/** Cloudflare's test site key that always passes (docs/accounts.md §6). */
const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';
/** Rendered explicitly, as the sign-in dialog will load it. */
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** The test passkey's ids, for the sign-in steps: this tab's storage only. */
const STORE = 'bozzetto-passkey-check';
/** How long a passkey prompt may stay up, as the server will ask. */
const CEREMONY_MS = 120_000;
/** An availability question left unanswered this long reads as unknown. */
const ASK_MS = 5000;
/**
 * A prompt that failed just after the autofill request was stopped for it
 * may have failed for the stopping (each retry would stop it again): with
 * the request stopped by hand first, a retry rules that out.
 */
const STOPPED_THEN_FAILED = 'stopped while this ran; if this failed at once, stop it by hand in step 5 and try again';

/** How a value reads: a yes, a no (in the accent), unknown (muted), or plain. */
type Tone = 'yes' | 'no' | 'unknown' | 'plain';

interface Row {
  label: string;
  value: string;
  tone: Tone;
  /** A detail of the row above, indented (the client capabilities). */
  sub: boolean;
}

/** The passkey made in this tab: credential id and user id, base64url. */
interface TestPasskey {
  id: string;
  userId: string;
  name: string;
}

/** What a question to the browser came to. */
type Answer<T> =
  | { kind: 'missing' }
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' };

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
}

/**
 * One step: a heading, what it does, its buttons, and rows of what was
 * found, which are also its part of the report.
 */
class Step {
  readonly root: HTMLElement;
  readonly actions: HTMLElement;
  private readonly list: HTMLDListElement;
  private readonly rows = new Map<string, Row>();
  private readonly cells = new Map<string, HTMLElement>();
  private readonly tail = new Set<string>();

  constructor(
    key: string,
    private readonly title: string,
    notes: string[],
  ) {
    this.root = document.createElement('section');
    this.root.className = 'pkcheck__step';
    this.root.dataset.check = key;
    const h = document.createElement('h2');
    h.className = 'pkcheck__step-title';
    h.textContent = title;
    this.root.appendChild(h);
    for (const text of notes) this.root.appendChild(note(text));
    this.actions = div('pkcheck__actions');
    this.list = document.createElement('dl');
    this.list.className = 'pkcheck__rows';
    this.root.append(this.actions, this.list);
  }

  /** Put something above the buttons, which act on it: a field, a note. */
  above(...els: HTMLElement[]): void {
    for (const el of els) this.root.insertBefore(el, this.actions);
  }

  /** Put something below the buttons, above the rows: a widget. */
  below(...els: HTMLElement[]): void {
    for (const el of els) this.root.insertBefore(el, this.list);
  }

  /**
   * Set a row, added at the end the first time it is set: a `sub` row is
   * a detail of the one above, and a `last` row stays below every other.
   */
  set(key: string, label: string, value: string, tone: Tone = 'plain', { sub = false, last = false } = {}): void {
    const fresh = !this.rows.has(key);
    this.rows.set(key, { label, value, tone, sub });
    let row = this.cells.get(key);
    if (!row) {
      row = div(sub ? 'pkcheck__row pkcheck__row--sub' : 'pkcheck__row');
      row.dataset.row = key;
      row.append(document.createElement('dt'), document.createElement('dd'));
      this.list.appendChild(row);
      this.cells.set(key, row);
    }
    const [dt, dd] = [row.children[0] as HTMLElement, row.children[1] as HTMLElement];
    dt.textContent = label;
    dd.textContent = value;
    dd.className = `pkcheck__value pkcheck__value--${tone}`;
    if (last) this.tail.add(key);
    else if (fresh) {
      for (const k of this.tail) {
        const r = this.rows.get(k);
        const cell = this.cells.get(k);
        if (!r || !cell) continue;
        this.rows.delete(k);
        this.rows.set(k, r);
        this.list.appendChild(cell);
      }
    }
  }

  /** Drop every row: a new attempt replaces the last one's. */
  clear(): void {
    this.rows.clear();
    this.cells.clear();
    this.tail.clear();
    this.list.replaceChildren();
  }

  /** The step as plain text, for the report. */
  lines(): string[] {
    const out = [this.title];
    for (const r of this.rows.values()) out.push(`${r.sub ? '    ' : '  '}${r.label}: ${r.value}`);
    if (out.length === 1) out.push('  (not tried)');
    return out;
  }
}

export function renderPasskeyCheck(app: HTMLElement): void {
  document.title = 'Bozzetto: passkey check';
  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  topbarLeft().appendChild(topChip('← Gallery', '/'));

  const host = location.hostname;
  const pkc = typeof window.PublicKeyCredential === 'function' ? window.PublicKeyCredential : null;
  let testPasskey = loadTestPasskey();

  const page = div('pkcheck');
  const head = document.createElement('header');
  head.className = 'pkcheck__head';
  const title = document.createElement('h1');
  title.className = 'pkcheck__title';
  title.textContent = 'Passkey check';
  const lede = document.createElement('p');
  lede.className = 'pkcheck__lede';
  lede.textContent =
    'Whether this device can sign in to Bozzetto with a passkey, in the browser and in the Home Screen app, ' +
    'and whether the bot check loads, before accounts are built on either. Try the steps in order, then copy the report at the end.';
  head.append(title, lede);

  // --- 1. the browser ----------------------------------------------------
  const env = new Step('env', '1. This browser', []);

  // --- 2. create ----------------------------------------------------------
  const create = new Step('create', '2. Create a test passkey', [
    `Makes a real passkey for ${host || 'this page'}, named "Bozzetto passkey check" with today's date and time. ` +
      'The device asks for Face ID, Touch ID or its passcode, and may ask where to keep it.',
  ]);
  const createButton = button('Create a test passkey');
  create.actions.append(createButton);

  // --- 3. sign in with it ---------------------------------------------------
  const withTest = new Step('signin', '3. Sign in with the test passkey', [
    'Asks for the passkey step 2 made in this tab, by its id, with the device verifying you.',
  ]);
  const testNote = note('');
  withTest.above(testNote);
  const withTestButton = button('Sign in with the test passkey');
  withTest.actions.append(withTestButton);

  // --- 4. sign in with any passkey ------------------------------------------
  const withAny = new Step('signinany', '4. Sign in with any passkey for this site', [
    "Asks for no passkey in particular, so the device lists every one it has for this site. It is how the sign-in dialog's passkey button will ask, " +
      'and in the Home Screen app it shows whether a passkey made in Safari can be used there.',
  ]);
  const withAnyButton = button('Choose a passkey');
  withAny.actions.append(withAnyButton);

  // One passkey prompt at a time: a second, while one is up, is refused.
  let busy = false;
  const syncButtons = (): void => {
    createButton.disabled = busy;
    withAnyButton.disabled = busy;
    withTestButton.disabled = busy || !testPasskey;
    testNote.textContent = testPasskey
      ? `The test passkey: ${testPasskey.name} (id ${short(testPasskey.id)}).`
      : 'No test passkey in this tab yet: create one in step 2.';
  };

  // --- 5. autofill ----------------------------------------------------------
  const autofill = new Step('autofill', '5. Sign in from the email field', [
    'A request for a passkey starts when the page opens, as it will in the sign-in dialog, and waits for the field. ' +
      'Tap the field: if the device offers the test passkey (above the keyboard, or in a list under the field), pick it, ' +
      'and say below whether it was offered.',
    'Steps 2 to 4 stop this request while they run and start it again after, as a waiting request blocks another on some browsers. ' +
      'The button stops it by hand.',
  ]);
  const fieldRow = document.createElement('label');
  fieldRow.className = 'pkcheck__field';
  const fieldCaption = document.createElement('span');
  fieldCaption.textContent = 'Email';
  const field = document.createElement('input');
  field.type = 'email';
  field.name = 'email';
  // The token that asks the browser to offer passkeys in this field.
  field.setAttribute('autocomplete', 'username webauthn');
  field.setAttribute('autocapitalize', 'off');
  field.spellcheck = false;
  field.inputMode = 'email';
  field.className = 'pkcheck__input';
  fieldRow.append(fieldCaption, field);
  autofill.above(fieldRow);
  const stopButton = button('Stop the autofill request');
  const offeredYes = button('It was offered');
  const offeredNo = button('It was not offered');
  autofill.actions.append(stopButton, offeredYes, offeredNo);

  // --- 6. the bot check -------------------------------------------------------
  const bot = new Step('turnstile', '6. Bot check', [
    "Loads Cloudflare's Turnstile script and draws its widget with Cloudflare's test key, which always passes. " +
      'As in the sign-in dialog, the widget shows itself only if it needs a tap.',
    "The site's Content-Security-Policy only reports for now (public/_headers), so the script is allowed to load. " +
      'Before the policy is enforced it must allow https://challenges.cloudflare.com for scripts and frames; ' +
      'what it would block on this page is listed under Policy reports.',
  ]);
  const botButton = button('Load the bot check');
  bot.actions.append(botButton);
  const widget = div('pkcheck__widget');
  bot.below(widget);

  // --- 7. cleaning up -----------------------------------------------------------
  const cleanup = new Step('cleanup', '7. Cleaning up', [
    `The test passkey is a real entry in this device's password manager (iCloud Keychain on an iPad), named ` +
      `"Bozzetto passkey check" with the date and time it was made, for ${host || 'this site'}. Delete it there when you are done: ` +
      `Settings > Passwords, or the Passwords app from iPadOS 18, then search for ${host || 'the site'}.`,
    "Nothing is stored on any server. The passkey steps run on this device alone, and the page keeps the test passkey's id " +
      'in this tab only, until the tab or the app is closed.',
  ]);

  // --- the report -----------------------------------------------------------------
  const report = document.createElement('section');
  report.className = 'pkcheck__step pkcheck__report';
  report.dataset.check = 'report';
  const copyButton = button('Copy report');
  const copied = div('pkcheck__note pkcheck__copied');
  copied.setAttribute('role', 'status');
  const fallback = document.createElement('textarea');
  fallback.className = 'pkcheck__fallback';
  fallback.readOnly = true;
  fallback.hidden = true;
  const reportActions = div('pkcheck__actions');
  reportActions.append(copyButton);
  report.append(note('Copies every row above as plain text, to paste into a message.'), reportActions, copied, fallback);

  page.append(head, env.root, create.root, withTest.root, withAny.root, autofill.root, bot.root, cleanup.root, report);
  app.replaceChildren(page);
  syncButtons();
  // Kept from before a reload, whose rows went with the page.
  if (testPasskey) {
    create.set('result', 'Result', 'made earlier in this tab');
    create.set('name', 'Name', testPasskey.name);
    create.set('id', 'Credential id', short(testPasskey.id));
  }

  // What the Content-Security-Policy reports while the page is open: the
  // enforced policy will block exactly these.
  const reported = new Set<string>();
  const showPolicy = (): void =>
    bot.set('policy', 'Policy reports', reported.size ? [...reported].join('; ') : 'none so far', reported.size ? 'no' : 'plain', { last: true });
  document.addEventListener('securitypolicyviolation', (e) => {
    let where = e.blockedURI;
    try {
      where = new URL(e.blockedURI).origin;
    } catch {
      // 'inline', 'eval' and the like are not addresses.
    }
    reported.add(`${e.effectiveDirective} ${where}${e.disposition === 'report' ? ' (reported only)' : ' (blocked)'}`);
    showPolicy();
  });

  // --- the autofill request ---------------------------------------------------------
  /** A conditional request, and why it was stopped if it was. */
  interface Waiting {
    controller: AbortController;
    why: string | null;
  }
  let autofillAvailable = false;
  /** The request still waiting, if any. */
  let waiting: Waiting | null = null;
  /** The request whose outcome the rows show. */
  let shown: Waiting | null = null;
  let offered = 'not answered';
  const setOffered = (value: string, tone: Tone): void => {
    offered = value;
    autofill.set('offered', 'Offered in the field', value, tone);
  };
  const syncAutofill = (): void => {
    stopButton.textContent = waiting ? 'Stop the autofill request' : 'Start the autofill request';
    stopButton.disabled = !autofillAvailable;
  };
  const startAutofill = (): void => {
    if (!pkc || !autofillAvailable || waiting) return;
    const call: Waiting = { controller: new AbortController(), why: null };
    waiting = call;
    shown = call;
    autofill.clear();
    autofill.set('request', 'Request', 'waiting: tap the field');
    setOffered(offered, offered.startsWith('yes') ? 'yes' : offered.startsWith('no') ? 'no' : 'unknown');
    syncAutofill();
    const t0 = performance.now();
    let ask: Promise<Credential | null>;
    try {
      ask = navigator.credentials.get({
        mediation: 'conditional',
        signal: call.controller.signal,
        publicKey: {
          challenge: randomBytes(32),
          rpId: host,
          allowCredentials: [],
          userVerification: 'required',
        },
      });
    } catch (err) {
      ask = Promise.reject(err);
    }
    void ask
      .then(
        (cred) => {
          if (shown !== call) return;
          autofill.set('request', 'Request', 'completed: a passkey was picked from the field', 'yes');
          setOffered('yes (picked from the field)', 'yes');
          showAssertion(autofill, cred, t0, testPasskey);
        },
        (err) => {
          if (shown !== call) return;
          if (call.why) autofill.set('request', 'Request', `stopped ${call.why} (the browser ended it: ${errorName(err)})`);
          else autofill.set('request', 'Request', `failed after ${secs(t0)}: ${failure(err)}`, 'no');
        },
      )
      .finally(() => {
        if (waiting === call) waiting = null;
        syncAutofill();
      });
  };
  /** Stop the waiting request; true when there was one. */
  const stopAutofill = (why: string): boolean => {
    const call = waiting;
    if (!call) return false;
    waiting = null;
    call.why = why;
    call.controller.abort();
    if (shown === call) autofill.set('request', 'Request', `stopping ${why}…`);
    syncAutofill();
    return true;
  };
  stopButton.addEventListener('click', () => {
    if (!stopAutofill('by the button')) startAutofill();
  });
  offeredYes.addEventListener('click', () => setOffered('yes (as seen)', 'yes'));
  offeredNo.addEventListener('click', () => setOffered('no (as seen)', 'no'));
  syncAutofill();

  // --- 1: what the browser says -------------------------------------------------------
  void describeBrowser(env, pkc).then((conditional) => {
    autofillAvailable = conditional;
    if (conditional) startAutofill();
    else {
      autofill.set('request', 'Request', 'not started: this browser cannot offer passkeys in a field', 'no');
      syncAutofill();
    }
  });

  // --- 2: create ---------------------------------------------------------------------------
  createButton.addEventListener('click', () => {
    if (busy) return;
    create.clear();
    if (!pkc) {
      create.set('result', 'Result', 'not possible: this page has no Web Authentication', 'no');
      return;
    }
    const name = `Bozzetto passkey check ${when(new Date())}`;
    const userId = randomBytes(16);
    const stopped = stopAutofill('while step 2 ran');
    create.set('result', 'Result', 'waiting for the device…');
    if (stopped) create.set('autofill', 'Autofill request', 'stopped while this ran');
    busy = true;
    syncButtons();
    const t0 = performance.now();
    let made = false;
    let ask: Promise<Credential | null>;
    try {
      // Straight from the click, nothing awaited first: before iPadOS 17.4
      // Safari showed a passkey prompt only inside the gesture that asked.
      ask = navigator.credentials.create({
        publicKey: {
          rp: { id: host, name: 'Bozzetto' },
          user: { id: userId, name, displayName: name },
          challenge: randomBytes(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          attestation: 'none',
          timeout: CEREMONY_MS,
          // Asked by the server library's defaults too: says whether the
          // passkey is discoverable, which sign-in without an email needs.
          extensions: { credProps: true },
        },
      });
    } catch (err) {
      ask = Promise.reject(err);
    }
    void ask
      .then(
        (cred) => {
          const pk = cred as PublicKeyCredential | null;
          if (!pk?.rawId) {
            create.set('result', 'Result', 'nothing came back', 'no');
            create.set('time', 'Time', secs(t0));
            return;
          }
          const res = pk.response as AuthenticatorAttestationResponse;
          const id = b64url(pk.rawId);
          made = true;
          testPasskey = { id, userId: b64url(userId), name };
          saveTestPasskey(testPasskey);
          create.set('result', 'Result', 'created', 'yes');
          create.set('name', 'Name', name);
          create.set('id', 'Credential id', short(id));
          create.set('attachment', 'Attachment', pk.authenticatorAttachment ?? 'not reported', pk.authenticatorAttachment === 'platform' ? 'yes' : 'plain');
          const transports = typeof res.getTransports === 'function' ? res.getTransports() : null;
          create.set('transports', 'Transports', transports ? transports.join(', ') || 'none listed' : 'unknown (getTransports missing)', transports ? 'plain' : 'unknown');
          const alg = typeof res.getPublicKeyAlgorithm === 'function' ? res.getPublicKeyAlgorithm() : null;
          create.set('algorithm', 'Algorithm', alg === -7 ? 'ES256 (-7)' : alg === -257 ? 'RS256 (-257)' : alg === null ? 'unknown' : String(alg));
          const rk = pk.getClientExtensionResults().credProps?.rk;
          create.set('discoverable', 'Discoverable (credProps)', rk === undefined ? 'not reported' : rk ? 'yes' : 'no', rk === undefined ? 'unknown' : rk ? 'yes' : 'no');
          const data = typeof res.getAuthenticatorData === 'function' ? readAuthData(res.getAuthenticatorData()) : null;
          flagRows(create, data, 'getAuthenticatorData missing');
          create.set('time', 'Time', secs(t0));
        },
        (err) => {
          create.set('result', 'Result', `failed: ${failure(err)}`, 'no');
          if (stopped) create.set('autofill', 'Autofill request', STOPPED_THEN_FAILED);
          create.set('time', 'Time', secs(t0));
        },
      )
      .finally(() => {
        busy = false;
        syncButtons();
        // Started again, and after a new passkey even if it had ended, so
        // the field can offer the passkey just made.
        if (stopped || made) startAutofill();
      });
  });

  // --- 3 and 4: sign in ------------------------------------------------------------------
  const signIn = (step: Step, stepName: string, asked: string, allow: PublicKeyCredentialDescriptor[]): void => {
    step.clear();
    if (!pkc) {
      step.set('result', 'Result', 'not possible: this page has no Web Authentication', 'no');
      return;
    }
    const stopped = stopAutofill(`while ${stepName} ran`);
    step.set('result', 'Result', 'waiting for the device…');
    step.set('asked', 'Asked for', asked);
    if (stopped) step.set('autofill', 'Autofill request', 'stopped while this ran');
    busy = true;
    syncButtons();
    const t0 = performance.now();
    let ask: Promise<Credential | null>;
    try {
      // From the click, as create is.
      ask = navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          rpId: host,
          allowCredentials: allow,
          userVerification: 'required',
          timeout: CEREMONY_MS,
        },
      });
    } catch (err) {
      ask = Promise.reject(err);
    }
    void ask
      .then(
        (cred) => showAssertion(step, cred, t0, testPasskey),
        (err) => {
          step.set('result', 'Result', `failed: ${failure(err)}`, 'no');
          if (stopped) step.set('autofill', 'Autofill request', STOPPED_THEN_FAILED);
          step.set('time', 'Time', secs(t0));
        },
      )
      .finally(() => {
        busy = false;
        syncButtons();
        if (stopped) startAutofill();
      });
  };
  withTestButton.addEventListener('click', () => {
    if (!testPasskey || busy) return;
    signIn(withTest, 'step 3', `the test passkey (id ${short(testPasskey.id)})`, [{ id: fromB64url(testPasskey.id), type: 'public-key' }]);
  });
  withAnyButton.addEventListener('click', () => {
    if (!busy) signIn(withAny, 'step 4', 'any passkey for this site', []);
  });

  // --- 6: Turnstile ---------------------------------------------------------------------------
  botButton.addEventListener('click', () => {
    botButton.disabled = true;
    const t0 = performance.now();
    bot.set('script', 'Script', 'loading…');
    showPolicy();
    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.addEventListener('load', () => {
      bot.set('script', 'Script', `loaded in ${secs(t0)}`, 'yes');
      const turnstile = (window as { turnstile?: Partial<TurnstileApi> }).turnstile;
      if (typeof turnstile?.render !== 'function') {
        bot.set('widget', 'Widget', 'not drawn: the script left no turnstile object', 'no');
        return;
      }
      try {
        const id = turnstile.render(widget, {
          sitekey: TURNSTILE_TEST_KEY,
          appearance: 'interaction-only',
          callback: (token: string) => bot.set('token', 'Token', `received after ${secs(t0)} (${token.length} characters)`, 'yes'),
          // Handled, so Turnstile neither throws nor logs it again.
          'error-callback': (code: string) => {
            bot.set('error', 'Error', `code ${code}`, 'no');
            return true;
          },
          'expired-callback': () => bot.set('expired', 'Expired', 'the token ran out (they last 300 s)'),
          'timeout-callback': () => bot.set('timeout', 'Timed out', 'the challenge was not answered in time', 'no'),
          'before-interactive-callback': () => bot.set('interaction', 'Interaction', 'asked for: the widget showed itself'),
          'after-interactive-callback': () => bot.set('interaction', 'Interaction', 'asked for, and given'),
          'unsupported-callback': () => bot.set('supported', 'Supported', 'no: Turnstile does not support this browser', 'no'),
        });
        bot.set('widget', 'Widget', `drawn${id ? ` (id ${id})` : ''}`, 'yes');
      } catch (err) {
        bot.set('widget', 'Widget', `could not be drawn: ${failure(err)}`, 'no');
      }
    });
    script.addEventListener('error', () => {
      script.remove();
      bot.set('script', 'Script', `could not load (after ${secs(t0)}): offline, or blocked`, 'no');
      botButton.disabled = false;
    });
    document.head.appendChild(script);
  });

  // --- the report ---------------------------------------------------------------------------------
  const reportText = (): string => {
    const lines = [
      'Bozzetto passkey check',
      `When: ${when(new Date(), true)}`,
      `Build: Bozzetto ${APP_VERSION}`,
      `Address: ${location.href}`,
    ];
    for (const step of [env, create, withTest, withAny, autofill, bot]) lines.push('', ...step.lines());
    return lines.join('\n');
  };
  copyButton.addEventListener('click', () => {
    const text = reportText();
    const done = (): void => {
      copied.textContent = 'Copied. Paste it into a message.';
      fallback.hidden = true;
    };
    // The clipboard from the click itself; where it is refused, the text
    // in a box to copy by hand, selected.
    let write: Promise<void>;
    try {
      write = navigator.clipboard.writeText(text);
    } catch (err) {
      write = Promise.reject(err);
    }
    void write.then(done, () => {
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      fallback.setSelectionRange(0, text.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) done();
      else copied.textContent = 'This browser would not copy it: select the text below and copy it.';
    });
  });
}

/**
 * Step 1: how the page was opened, the user agent, the domain a passkey
 * would belong to, and what Web Authentication says it can do. Resolves
 * whether passkeys can be offered in a field (conditional mediation).
 */
async function describeBrowser(step: Step, pkc: typeof PublicKeyCredential | null): Promise<boolean> {
  const mode = installedMode();
  step.set('standalone', 'Opened from the Home Screen', mode ? `yes (${mode})` : 'no');
  const flag = (navigator as { standalone?: boolean }).standalone;
  step.set(
    'navstandalone',
    'navigator.standalone',
    flag === undefined ? 'unknown (only Apple browsers have it)' : flag ? 'yes' : 'no',
    flag === undefined ? 'unknown' : 'plain',
  );
  step.set('displaymode', 'Display mode', displayMode());
  step.set('ua', 'User agent', navigator.userAgent);
  // An iPad's Safari calls itself a Mac: its touch points tell them apart.
  const touch = navigator.maxTouchPoints ?? 0;
  step.set('touch', 'Touch points', `${touch}${touch > 1 && /Macintosh/.test(navigator.userAgent) ? ' (an iPad, whose Safari says Mac)' : ''}`);
  step.set('rpid', 'Passkey domain (RP ID)', location.hostname || '(none)');
  step.set('secure', 'Secure context', window.isSecureContext ? 'yes' : 'no', window.isSecureContext ? 'yes' : 'no');
  step.set('webauthn', 'Web Authentication (PublicKeyCredential)', pkc ? 'yes' : 'no', pkc ? 'yes' : 'no');
  step.set('platform', 'Built-in authenticator that verifies you', 'checking…', 'unknown');
  step.set('conditional', 'Passkeys offered in a field (conditional mediation)', 'checking…', 'unknown');
  step.set('capabilities', 'Client capabilities', 'checking…', 'unknown');

  const [platform, conditional, capabilities] = await Promise.all([
    ask(pkc && typeof pkc.isUserVerifyingPlatformAuthenticatorAvailable === 'function' ? () => pkc.isUserVerifyingPlatformAuthenticatorAvailable() : null),
    ask(pkc && typeof pkc.isConditionalMediationAvailable === 'function' ? () => pkc.isConditionalMediationAvailable() : null),
    ask(pkc && typeof pkc.getClientCapabilities === 'function' ? () => pkc.getClientCapabilities() : null),
  ]);
  const yesNo = (key: string, label: string, a: Answer<boolean>, missing: [string, Tone]): void => {
    if (a.kind === 'value') step.set(key, label, a.value ? 'yes' : 'no', a.value ? 'yes' : 'no');
    else if (a.kind === 'missing') step.set(key, label, ...missing);
    else step.set(key, label, a.kind === 'timeout' ? `unknown (no answer in ${ASK_MS / 1000} s)` : `unknown (${failure(a.error)})`, 'unknown');
  };
  yesNo('platform', 'Built-in authenticator that verifies you', platform, ['unknown (the browser has no such check)', 'unknown']);
  yesNo('conditional', 'Passkeys offered in a field (conditional mediation)', conditional, ['no (the browser has no such check)', 'no']);
  if (capabilities.kind === 'value') {
    const entries = Object.entries(capabilities.value ?? {}).sort(([a], [b]) => a.localeCompare(b));
    step.set('capabilities', 'Client capabilities', `${entries.length} reported`, 'plain');
    for (const [name, on] of entries) step.set(`cap-${name}`, name, on ? 'yes' : 'no', on ? 'yes' : 'no', { sub: true });
  } else if (capabilities.kind === 'missing') {
    step.set('capabilities', 'Client capabilities', 'unknown (not reported by this browser)', 'unknown');
  } else {
    step.set('capabilities', 'Client capabilities', capabilities.kind === 'timeout' ? 'unknown (no answer)' : `unknown (${failure(capabilities.error)})`, 'unknown');
  }
  return conditional.kind === 'value' && conditional.value;
}

/** Steps 3 to 5: what a sign-in brought back. */
function showAssertion(step: Step, cred: Credential | null, t0: number, testPasskey: TestPasskey | null): void {
  const got = cred as PublicKeyCredential | null;
  if (!got?.rawId) {
    step.set('result', 'Result', 'nothing came back', 'no');
    step.set('time', 'Time', secs(t0));
    return;
  }
  const res = got.response as AuthenticatorAssertionResponse;
  const id = b64url(got.rawId);
  const handle = res.userHandle ? b64url(res.userHandle) : null;
  step.set('result', 'Result', 'signed in', 'yes');
  step.set('id', 'Credential id', short(id));
  step.set('test', 'The test passkey', testPasskey ? (id === testPasskey.id ? 'yes' : 'no, another passkey for this site') : 'unknown (none made in this tab)');
  step.set(
    'user',
    'User handle',
    handle ? `${short(handle)}${testPasskey && handle === testPasskey.userId ? " (the test passkey's user)" : ''}` : 'none came back',
    handle ? 'plain' : 'no',
  );
  step.set('attachment', 'Attachment', got.authenticatorAttachment ?? 'not reported');
  flagRows(step, readAuthData(res.authenticatorData), 'no authenticator data');
  step.set('time', 'Time', secs(t0));
}

/** The authenticator data's flags byte and signature counter (WebAuthn §6.1). */
interface AuthData {
  flags: number;
  counter: number;
}

function readAuthData(buf: ArrayBuffer | null | undefined): AuthData | null {
  // 32 bytes of RP ID hash, the flags, then a 4-byte big-endian counter.
  if (!buf || buf.byteLength < 37) return null;
  const view = new DataView(buf);
  return { flags: view.getUint8(32), counter: view.getUint32(33) };
}

const FLAGS: ReadonlyArray<readonly [number, string]> = [
  [0x01, 'UP'],
  [0x04, 'UV'],
  [0x08, 'BE'],
  [0x10, 'BS'],
  [0x40, 'AT'],
  [0x80, 'ED'],
];

/**
 * The flags a server will look at: user verified (it is required), and
 * whether the passkey can be, and is, backed up (synced, in iCloud
 * Keychain's case); then the byte itself and the counter.
 */
function flagRows(step: Step, data: AuthData | null, why: string): void {
  if (!data) {
    step.set('flags', 'Flags', `unknown (${why})`, 'unknown');
    return;
  }
  const on = (bit: number): boolean => (data.flags & bit) !== 0;
  step.set('uv', 'User verified (UV)', on(0x04) ? 'yes' : 'no', on(0x04) ? 'yes' : 'no');
  step.set('be', 'Backup eligible (BE)', on(0x08) ? 'yes' : 'no');
  step.set('bs', 'Backed up (BS)', on(0x10) ? 'yes' : 'no');
  const names = FLAGS.filter(([bit]) => on(bit)).map(([, name]) => name);
  step.set('flags', 'Flags', `0x${data.flags.toString(16).padStart(2, '0')} (${names.join(' ') || 'none'})`);
  step.set('counter', 'Signature counter', String(data.counter));
}

/** Ask the browser something that may be missing, fail or never answer. */
async function ask<T>(question: (() => Promise<T>) | null): Promise<Answer<T>> {
  if (!question) return { kind: 'missing' };
  let timer = 0;
  const late = new Promise<Answer<T>>((ok) => {
    timer = window.setTimeout(() => ok({ kind: 'timeout' }), ASK_MS);
  });
  try {
    const asked = question().then(
      (value): Answer<T> => ({ kind: 'value', value }),
      (error: unknown): Answer<T> => ({ kind: 'error', error }),
    );
    return await Promise.race([asked, late]);
  } catch (error) {
    return { kind: 'error', error };
  } finally {
    clearTimeout(timer);
  }
}

/** Which display mode matches, of the ones a manifest can ask for. */
function displayMode(): string {
  for (const mode of ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay', 'browser']) {
    try {
      if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

/** What the common refusals mean, beside their names. */
const MEANING: Record<string, string> = {
  NotAllowedError: 'cancelled, timed out, or refused by the browser',
  SecurityError: 'this address cannot have passkeys: it needs HTTPS and a domain name',
  InvalidStateError: 'the authenticator already holds this passkey',
  NotSupportedError: 'nothing asked for is supported here',
  AbortError: 'stopped before it finished',
};

function errorName(err: unknown): string {
  return (err as { name?: unknown } | null)?.name ? String((err as { name: unknown }).name) : 'Error';
}

/** An error by name and message, and what the name usually means. */
function failure(err: unknown): string {
  const name = errorName(err);
  const message = (err as { message?: unknown } | null)?.message;
  const text = typeof message === 'string' && message ? message : String(err);
  return `${name}: ${text}${MEANING[name] ? ` (${MEANING[name]})` : ''}`;
}

function loadTestPasskey(): TestPasskey | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as Partial<TestPasskey> | null;
    if (raw && typeof raw.id === 'string' && typeof raw.userId === 'string' && typeof raw.name === 'string') {
      return { id: raw.id, userId: raw.userId, name: raw.name };
    }
  } catch {
    // Unreadable or refused: no test passkey in this tab.
  }
  return null;
}

function saveTestPasskey(p: TestPasskey): void {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    // Storage refused: step 3 still has it until the page goes.
  }
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The first 12 characters of an id, which is enough to tell two apart. */
function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function secs(t0: number): string {
  return `${((performance.now() - t0) / 1000).toFixed(1)} s`;
}

/** "2026-10-06 23:41", in this device's time; with its UTC offset when asked. */
function when(d: Date, offset = false): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (!offset) return stamp;
  const m = -d.getTimezoneOffset();
  return `${stamp} (UTC${m < 0 ? '-' : '+'}${p(Math.floor(Math.abs(m) / 60))}:${p(Math.abs(m) % 60)})`;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'pkcheck__note';
  p.textContent = text;
  return p;
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sculpt-panel__btn pkcheck__btn';
  b.textContent = text;
  return b;
}
