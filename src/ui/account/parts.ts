import {
  AccountError,
  BotCheck,
  HANDLE_SHAPE,
  checkHandle,
  errorText,
  handleReasonText,
  inWait,
  readCode,
  resendCode,
  type AccountsConfig,
  type CodeSent,
} from '../../net/account';

/**
 * The pieces the sign-in dialog and the Account page share: labelled
 * fields, the handle field that says as you type whether a handle can be
 * had, the terms box, a line for what went wrong, and the step where a
 * mailed code is typed (with its resend and its countdown).
 */

/** The legal pages (docs/accounts.md §9), static and kept offline. */
export const LEGAL = {
  privacy: '/legal/privacy.html',
  terms: '/legal/terms.html',
  content: '/legal/terms.html#content',
  takedown: '/legal/terms.html#takedown',
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A link to one of the legal pages, opened beside the page so nothing typed is lost. */
export function legalLink(text: string, href: string): HTMLAnchorElement {
  const a = el('a', 'account-legal', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function button(label: string, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  return b;
}

/** A button that reads as a link, for the ways between steps. */
export const linkButton = (label: string): HTMLButtonElement => button(label, 'account-linkbtn');

/** A labelled input, the label above it. */
export function field(label: string, input: HTMLInputElement, hint?: HTMLElement): HTMLLabelElement {
  const wrap = el('label', 'account-field');
  wrap.append(el('span', 'account-field__label', label), input);
  if (hint) wrap.appendChild(hint);
  return wrap;
}

export function input(type: string, name: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = el('input', 'account-input');
  i.type = type;
  i.name = name;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

/** The line where a step says what went wrong (or, quieter, what it is doing). */
export class Say {
  readonly root = el('p', 'account-say');
  constructor() {
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
  }
  error(err: unknown): void {
    this.root.dataset.tone = 'error';
    this.root.textContent = typeof err === 'string' ? err : errorText(err);
  }
  note(text: string): void {
    this.root.dataset.tone = 'note';
    this.root.textContent = text;
  }
  clear(): void {
    delete this.root.dataset.tone;
    this.root.textContent = '';
  }
}

/** How long typing pauses before a handle is asked about. */
const HANDLE_DEBOUNCE_MS = 350;

/**
 * A handle field that says, as it is typed, whether the handle can be had:
 * its shape first, here, then the server (GET /api/auth/handle, debounced),
 * with the reason when not (§3). Lower-cased as it is read, as the server
 * stores it. `current` is a handle that is the account's already, which
 * needs no asking.
 */
export class HandleField {
  readonly input = input('text', 'handle', {
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    maxlength: '30',
    placeholder: 'yourname',
  });
  readonly hint = el('span', 'account-hint');
  readonly root: HTMLLabelElement;
  private timer = 0;
  private asked = '';
  /** The last answer, for the handle it was about, and the server's reason when it said no. */
  private known: { handle: string; ok: boolean; reason?: string | null } | null = null;

  /**
   * `owner`: the field is the owner's own (the bootstrap on /admin/). The
   * names the live check calls reserved are reserved to keep anyone else
   * from passing as the owner, so for the owner they are not a refusal:
   * the form goes on to the server, which allows the protected ones and
   * refuses the route names itself.
   */
  constructor(
    label = 'Handle',
    private readonly current: string | null = null,
    private readonly owner = false,
  ) {
    this.root = field(label, this.input, this.hint);
    this.input.addEventListener('input', () => this.changed());
  }

  /** The handle as typed, lower-cased and trimmed. */
  get value(): string {
    return this.input.value.trim().toLowerCase();
  }

  private say(text: string, tone: 'ok' | 'no' | 'quiet'): void {
    this.hint.textContent = text;
    this.hint.dataset.tone = tone;
  }

  private changed(): void {
    window.clearTimeout(this.timer);
    const handle = this.value;
    this.known = null;
    if (!handle) {
      this.say('', 'quiet');
      return;
    }
    if (!HANDLE_SHAPE.test(handle)) {
      this.say(handleReasonText('format'), 'no');
      return;
    }
    if (this.current && handle === this.current.toLowerCase()) {
      this.say('That is your handle now.', 'quiet');
      return;
    }
    this.say('Checking…', 'quiet');
    this.timer = window.setTimeout(() => void this.ask(handle), HANDLE_DEBOUNCE_MS);
  }

  private async ask(handle: string): Promise<boolean> {
    this.asked = handle;
    try {
      const answer = await checkHandle(handle);
      if (this.asked !== handle || this.value !== handle) return false;
      const reason = answer.available ? null : (answer.reason ?? 'taken');
      // Reserved means reserved for the owner; the owner's own form lets
      // the server decide between a protected name and a route's.
      const ok = answer.available || (this.owner && reason === 'reserved');
      this.known = { handle, ok, reason };
      if (answer.available) this.say(`@${handle} is free.`, 'ok');
      else if (ok) this.say(`@${handle} is kept for the owner, which is you.`, 'ok');
      else this.say(handleReasonText(reason ?? 'taken'), 'no');
      return ok;
    } catch (err) {
      if (this.value === handle) this.say(errorText(err), 'no');
      return false;
    }
  }

  /**
   * Whether the handle typed can be had, asking now if the answer is not in
   * yet; says why not. The server checks again when it is used.
   */
  async check(): Promise<boolean> {
    window.clearTimeout(this.timer);
    const handle = this.value;
    if (!HANDLE_SHAPE.test(handle)) {
      this.say(handleReasonText('format'), 'no');
      return false;
    }
    if (this.known?.handle === handle) return this.known.ok;
    return this.ask(handle);
  }

  /** The server's own refusal of the handle (a 409 or a 400 with its reason), said where it was typed. */
  refused(reason: string | null): void {
    this.known = { handle: this.value, ok: false };
    this.say(handleReasonText(reason ?? 'taken'), 'no');
    this.input.focus();
  }
}

/**
 * Join's consent (docs/accounts.md §9): required and unticked, in the
 * words the terms record; no birth date is asked or kept.
 */
export function termsBox(): { root: HTMLLabelElement; box: HTMLInputElement } {
  const root = el('label', 'account-check');
  const box = el('input');
  box.type = 'checkbox';
  box.name = 'terms';
  box.required = true;
  const words = el('span');
  words.append(
    'I am 13 or older and accept the ',
    legalLink('Terms', LEGAL.terms),
    ', including the ',
    legalLink('content policy', LEGAL.content),
  );
  root.append(box, words);
  return { root, box };
}

/** What the code step is for, as its caller completes it. */
export interface CodeStepOptions {
  config: AccountsConfig | null;
  /** What was sent, and where. */
  intro: string;
  sent: CodeSent;
  submitLabel: string;
  /**
   * Check the code: resolves when it did what it was for; throws (an
   * AccountError) to have the refusal said - a wrong code with its tries
   * left, a code run out. `extra` errors are the caller's own to say.
   */
  verify: (code: string) => Promise<void>;
  /** Something the step shows between the code and its button (Join's new handle, when one was taken meanwhile). */
  extra?: HTMLElement;
  /** The way back: another address, or another way. */
  back?: { label: string; go: () => void };
}

/**
 * The step where a mailed code is typed (§3): a one-time-code field, sent
 * as soon as six digits are in (a code may come with its space, or a
 * dash); "Send a new code" once the minute is up, at most twice more,
 * with Turnstile's widget for it; the tries left after a wrong code, and
 * the way back once the code is spent or run out.
 */
export class CodeStep {
  readonly root = el('form', 'account-step account-code');
  readonly code = input('text', 'code', {
    autocomplete: 'one-time-code',
    inputmode: 'numeric',
    maxlength: '9',
    placeholder: '123 456',
    spellcheck: 'false',
  });
  readonly say = new Say();
  private readonly submit: HTMLButtonElement;
  private readonly resend = linkButton('Send a new code');
  private readonly botHost = el('div', 'account-bot');
  private bot: BotCheck | null = null;
  private resendAt = 0;
  private resendsLeft: number;
  private ticker = 0;
  private busy = false;
  private lastSent = '';
  private dead = false;

  constructor(private readonly opts: CodeStepOptions) {
    this.resendsLeft = opts.sent.resendsLeft;
    this.root.noValidate = true;
    const intro = el('p', 'account-lede', opts.intro);
    this.submit = button(opts.submitLabel, 'btn btn--primary account-submit');
    this.submit.type = 'submit';
    const actions = el('div', 'account-actions');
    actions.append(this.submit);
    const more = el('div', 'account-more');
    more.append(this.resend);
    if (opts.back) {
      const back = linkButton(opts.back.label);
      back.addEventListener('click', () => opts.back?.go());
      more.append(back);
    }
    this.root.append(intro, field('Code', this.code));
    if (opts.extra) this.root.append(opts.extra);
    this.root.append(actions, this.botHost, this.say.root, more);

    this.root.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send(true);
    });
    this.code.addEventListener('input', () => {
      // A full code is sent as it lands - typed, pasted, or filled in from
      // the mail by the keyboard's suggestion.
      const code = readCode(this.code.value);
      if (code && code !== this.lastSent) void this.send(false);
    });
    this.resend.addEventListener('click', () => void this.again());
    this.counted(opts.sent);
  }

  /** Put the cursor in the field. */
  focus(): void {
    this.code.focus();
  }

  private counted(sent: CodeSent): void {
    this.resendAt = Date.now() + sent.resendAfter * 1000;
    this.resendsLeft = sent.resendsLeft;
    this.tick();
    window.clearInterval(this.ticker);
    this.ticker = window.setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (!this.root.isConnected && this.ticker) {
      // The step has gone: nothing more to count.
      window.clearInterval(this.ticker);
      this.bot?.dispose();
      return;
    }
    if (this.resendsLeft <= 0 || this.dead) {
      this.resend.hidden = true;
      return;
    }
    const wait = Math.ceil((this.resendAt - Date.now()) / 1000);
    this.resend.hidden = false;
    this.resend.disabled = wait > 0;
    this.resend.textContent = wait > 0 ? `Send a new code ${inWait(wait)}` : 'Send a new code';
    if (wait <= 0 && !this.bot && this.opts.config?.turnstileSiteKey) {
      // Drawn once a resend can be asked for, not before: most codes need none.
      this.bot = new BotCheck(this.botHost, this.opts.config.turnstileSiteKey, 'email-code');
      void this.bot.start().catch((err: unknown) => this.say.error(err));
    }
  }

  private async send(fromButton: boolean): Promise<void> {
    if (this.busy || this.dead) return;
    const code = readCode(this.code.value);
    if (!code) {
      if (fromButton) this.say.error('Type the six digits from the mail.');
      return;
    }
    this.lastSent = code;
    this.busy = true;
    this.submit.disabled = true;
    this.say.note('Checking…');
    try {
      await this.opts.verify(code);
      this.say.clear();
      this.stop();
    } catch (err) {
      this.say.error(err);
      if (err instanceof AccountError) {
        // Spent or run out: no code will do now, and nor will a resend.
        if ((err.code === 'code_invalid' && err.attemptsLeft === 0) || err.code === 'flow_expired') this.spent();
      }
      this.code.select();
    } finally {
      this.busy = false;
      this.submit.disabled = this.dead;
    }
  }

  /** The flow is over: say what can be done, which is to start again. */
  private spent(): void {
    this.dead = true;
    this.code.disabled = true;
    this.submit.disabled = true;
    this.resend.hidden = true;
  }

  private async again(): Promise<void> {
    if (this.resend.disabled) return;
    this.resend.disabled = true;
    this.say.note('Sending a new code…');
    try {
      const token = await this.bot?.take();
      const sent = await resendCode(token);
      this.counted(sent);
      this.say.note('A new code is on its way. The one before it no longer works.');
      this.code.value = '';
      this.lastSent = '';
      this.code.focus();
    } catch (err) {
      if (err instanceof AccountError && err.code === 'rate_limited') {
        const left = err.resendsLeft;
        if (left !== null) this.resendsLeft = left;
        if (left === 0) {
          this.say.error('No more codes for this one. Use the last code sent, or start again.');
        } else {
          this.resendAt = Date.now() + (err.retryAfter ?? 60) * 1000;
          this.say.error(`A new code can be sent ${inWait(err.retryAfter)}.`);
        }
      } else {
        this.say.error(err);
        if (err instanceof AccountError && err.code === 'flow_expired') this.spent();
      }
      this.tick();
    }
  }

  /** Stop counting: the step is done with. */
  stop(): void {
    window.clearInterval(this.ticker);
    this.ticker = 0;
    this.bot?.dispose();
    this.bot = null;
  }
}
