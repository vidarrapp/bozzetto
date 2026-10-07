import {
  AccountError,
  BotCheck,
  addPasskey,
  autofillAvailable,
  cancelPasskeyRequest,
  checkInvite,
  dayOf,
  errorText,
  finishEmailReauth,
  finishEmailSignIn,
  finishJoin,
  followLink,
  forDesktopApp,
  forgetInvite,
  getMe,
  handlePasskeyOptions,
  handleReasonText,
  inSafariBesideApp,
  loadConfig,
  newPasskeyOptions,
  noPasskeysWhy,
  passkeyAborted,
  passkeyErrorText,
  passkeyNotAllowed,
  passkeyOptions,
  passkeyReauth,
  passkeySignIn,
  passkeysHere,
  readHandle,
  readInvite,
  rememberInvite,
  rememberedInvite,
  startEmailReauth,
  startEmailSignIn,
  startJoin,
  type AccountsConfig,
  type CodeSent,
  type Me,
} from '../../net/account';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { statusToast } from '../../sculpt/ui/statusToast';
import { CodeStep, HandleField, LEGAL, Say, button, el, field, input, legalLink, linkButton, termsBox } from './parts';
import type { AccountLink } from './links';

/**
 * The sign-in dialog (docs/accounts.md §7). Signing in is a dialog over
 * whatever page asked - the gallery's Sign in, a save in Sculpt that found
 * the sign-in gone, the owner tools - so the page and the work on it stay
 * put; there is no round trip.
 *
 * - Sign in: a passkey button, whose click is the browser's prompt (iPadOS
 *   before 17.4 wants the gesture), the email field offering passkeys among
 *   its suggestions where the browser can (autofill), and "Email me a code".
 *   Where the browser offers no passkey, the handle, to name its passkeys.
 * - Join with an invite: the invite checked as the dialog opens, a handle
 *   checked as it is typed, the address, the 13+ and terms box and the bot
 *   check; then the code; then a passkey.
 * - A passkey is offered after every sign-in by code, where passkeys work:
 *   skipping it is fine, and it comes back next time.
 *
 * Where the page's host is not the passkeys' (a preview, an IP address),
 * only codes are offered. Opening the dialog asks for passkey options at
 * once, which both the autofill and the button use: a browser has one
 * ceremony at a time, and each request for options ends the one before.
 */

export interface SignInOptions {
  /** Which way in to show first. */
  view?: 'signin' | 'join';
  /** Why the dialog is up, said above everything: "Your sign-in has expired." */
  reason?: string;
}

/** Passkey options last five minutes on the server; asked again before then. */
const OPTIONS_FRESH_MS = 4 * 60 * 1000;

let current: Promise<Me | null> | null = null;

/**
 * Open the sign-in dialog. Resolves with the account once signed in (or
 * joined), or null when it is closed first. One at a time: asked again
 * while open, the same answer comes back.
 */
export function openSignIn(opts: SignInOptions = {}): Promise<Me | null> {
  current ??= new Dialog().signIn(opts).finally(() => {
    current = null;
  });
  return current;
}

/**
 * Ask the person to confirm it is them (docs/accounts.md §3): adding or
 * removing a passkey, or changing the address, needs an authentication in
 * the last ten minutes. A passkey, where the account has one and they work
 * here, or a code to the account's own address. True once confirmed.
 */
export function confirmIdentity(opts: { hasPasskey: boolean }): Promise<boolean> {
  return new Dialog().reauth(opts.hasPasskey);
}

/** Offer a passkey on its own (after the owner's account is made): true when one was added. */
export async function offerPasskey(me: Me): Promise<boolean> {
  return new Dialog().offer(me);
}

/**
 * What a sign-in link brought (§7): `/?signin` opens the dialog, `/?invite=`
 * opens Join, and `/?link=` - the link in a code mail, in the browser that
 * asked for the code - completes that sign-in or Join here. Resolves with
 * the account when it signed someone in. Nothing happens while accounts
 * are off.
 */
export async function openAccountLink(link: AccountLink): Promise<Me | null> {
  const config = await loadConfig();
  if (!config?.accounts) return null;
  if (link.kind === 'signin') {
    // Already signed in, or signed in and suspended (which the page says,
    // and no sign-in would lift): nothing to do.
    const here = await getMe().catch((err: unknown) => (err instanceof AccountError && err.code === 'suspended' ? 'suspended' : null));
    if (here) return null;
    return openSignIn();
  }
  if (link.kind === 'join') return openSignIn({ view: 'join' });
  return new Dialog().link(link.token);
}

class Dialog {
  private readonly overlay = el('div', 'install-overlay account-overlay');
  private readonly card = el('div', 'install-card account-card');
  private readonly body = el('div', 'account-body');
  private config: AccountsConfig | null = null;
  private resolve: (me: Me | null) => void = () => {};
  /** What runs when the step on show is left: its widgets, its timers, its listeners. */
  private leave: Array<() => void> = [];
  private reason = '';
  /** Closed or done: nothing more is drawn, should an answer come in late. */
  private gone = false;

  constructor() {
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    const close = button('×', 'install-close');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    this.card.append(close, this.body);
    this.overlay.appendChild(this.card);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private show(): void {
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
  }

  /** Close without an answer: null for a sign-in, and not confirmed. */
  private close(): void {
    this.resolve(null);
    this.dispose();
  }

  private dispose(): void {
    this.gone = true;
    this.clearStep();
    cancelPasskeyRequest();
    document.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
  }

  /** Done: signed in as `me`. */
  private finish(me: Me): void {
    this.resolve(me);
    this.dispose();
  }

  private clearStep(): void {
    for (const undo of this.leave.splice(0)) undo();
  }

  /**
   * Put a step in the card: a heading, the reason the dialog is up (on the
   * first step only), and the step. Each show* clears the step before it
   * first (clearStep), then sets up its own widgets and timers.
   */
  private step(title: string, ...content: HTMLElement[]): void {
    const h = el('h2', 'account-title', title);
    h.id = 'account-title';
    this.card.setAttribute('aria-labelledby', h.id);
    this.body.replaceChildren(h);
    if (this.reason) {
      this.body.appendChild(el('p', 'account-reason', this.reason));
      this.reason = '';
    }
    this.body.append(...content);
  }

  private bot(host: HTMLElement, action: 'register' | 'email-code'): BotCheck {
    const bot = new BotCheck(host, this.config?.turnstileSiteKey ?? null, action);
    this.leave.push(() => bot.dispose());
    return bot;
  }

  // --- signing in --------------------------------------------------------------------

  async signIn(opts: SignInOptions): Promise<Me | null> {
    this.reason = opts.reason ?? '';
    const answer = new Promise<Me | null>((resolve) => {
      this.resolve = resolve;
    });
    this.show();
    this.body.replaceChildren(el('p', 'account-lede', 'One moment…'));
    this.config = await loadConfig();
    if (this.gone) return answer;
    if (!this.config?.accounts) {
      this.step('Sign in', el('p', 'account-lede', 'Accounts are not open on this site.'));
      return answer;
    }
    if (opts.view === 'join') this.showJoin();
    else this.showSignIn();
    return answer;
  }

  private showSignIn(email = ''): void {
    this.clearStep();
    const passkeys = passkeysHere(this.config);
    // The desktop app's sign-in window leads with the code (§2): passkeys
    // made in it are unproven, and its autofill would offer this computer's
    // own. A passkey on a phone, or a security key, still signs in.
    const desktop = forDesktopApp();
    const form = el('form', 'account-step');
    form.noValidate = true;
    const say = new Say();
    const address = input('email', 'email', {
      // Where the browser can, the field's suggestions offer the passkeys
      // this site has on the device as well as addresses (§3).
      autocomplete: passkeys && !desktop ? 'username webauthn' : 'username',
      autocapitalize: 'none',
      spellcheck: 'false',
      placeholder: 'you@example.com',
    });
    address.value = email;
    const codeFirst = !passkeys || desktop;
    const codeButton = button('Email me a code', codeFirst ? 'btn btn--primary account-submit' : 'btn account-submit');
    codeButton.type = 'submit';
    const botHost = el('div', 'account-bot');
    const bot = this.bot(botHost, 'email-code');
    void bot.start().catch((err: unknown) => say.error(err));

    const before: HTMLElement[] = [];
    const after: HTMLElement[] = [];
    if (passkeys) {
      const passkeyButton = button('Use a passkey', `btn ${desktop ? '' : 'btn--primary '}account-passkey`);
      // The handle, asked for once the browser has offered no passkey.
      const retry = el('form', 'account-step account-retry');
      if (desktop) {
        after.push(el('p', 'account-or', 'or'), passkeyButton, el('p', 'account-small', 'On your phone, or a security key.'), retry);
      } else {
        before.push(passkeyButton, retry, el('p', 'account-or', 'or'));
      }
      this.passkeySignIn(passkeyButton, retry, address, say, { autofill: !desktop });
    } else {
      const why = noPasskeysWhy(this.config);
      if (why) before.push(el('p', 'account-note', `${why}. Sign in with a code sent to your email address.`));
    }
    if (desktop) before.unshift(el('p', 'account-lede', 'Sign in to your account for the Bozzetto app. This window closes by itself once you are in.'));
    const actions = el('div', 'account-actions');
    actions.append(codeButton);
    form.append(field('Email', address), botHost, actions, say.root);
    const join = linkButton('Join with an invite');
    join.addEventListener('click', () => this.showJoin());
    const foot = el('p', 'account-foot');
    foot.append('New here? ', join);
    this.step('Sign in', ...before, form, ...after, foot);
    (codeFirst ? address : (before.find((p) => p instanceof HTMLButtonElement) ?? address)).focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        const typed = address.value.trim();
        if (!typed || !address.checkValidity()) {
          say.error('Type the email address of your account.');
          address.focus();
          return;
        }
        codeButton.disabled = true;
        say.note('Sending a code…');
        try {
          const sent = await startEmailSignIn(typed, await bot.take());
          this.showCode({
            intro:
              `If there is an account for ${typed}, a code is on its way to it. ` +
              'It works once, for 10 minutes.',
            sent,
            submitLabel: 'Sign in',
            verify: async (code) => this.signedIn(await finishEmailSignIn(code), 'code'),
            back: { label: 'Use another address', go: () => this.showSignIn(typed) },
            watch: true,
          });
        } catch (err) {
          say.error(err);
          codeButton.disabled = false;
        }
      })();
    });
  }

  /**
   * The passkey ways in: options asked for as the step shows, used by the
   * email field's autofill where the browser has it and by the button,
   * whose click makes the browser's request before anything is awaited.
   * Asked again every four minutes while the step is up (a challenge lasts
   * five), and after anything that spent or stopped the ceremony.
   *
   * A browser may offer no passkey for a request that names none: Safari
   * with 1Password on an iPad refused the button's, and a pick from the
   * field's suggestions, yet let through one that named the passkey. So
   * when either fails in the browser (other than by being stopped), `retry`
   * asks for the handle, and its Try again asks for options naming that
   * account's passkeys, then makes the request from its click.
   */
  private passkeySignIn(
    trigger: HTMLButtonElement,
    retry: HTMLFormElement,
    address: HTMLInputElement,
    say: Say,
    { autofill: withAutofill }: { autofill: boolean },
  ): void {
    let options: PublicKeyCredentialRequestOptionsJSON | null = null;
    let fetchedAt = 0;
    let alive = true;
    /** A prompt is up: new options now would end its ceremony under it. */
    let prompting = false;
    let asking: Promise<void> | null = null;
    /** The field has had focus since the autofill's request began: a pick is made among its suggestions. */
    let inField = false;

    const why = el('p', 'account-note', 'Your browser did not offer the passkey. Enter your handle and try again.');
    why.id = 'account-retry-why';
    const handle = input('text', 'handle', {
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      placeholder: 'yourname',
      'aria-describedby': why.id,
    });
    const again = button('Try again');
    again.type = 'submit';
    const actions = el('div', 'account-actions');
    actions.append(again);
    retry.noValidate = true;
    retry.hidden = true;
    retry.append(why, field('Handle', handle), actions);
    const askHandle = (): void => {
      say.clear();
      if (!retry.hidden) return;
      retry.hidden = false;
      handle.focus();
    };
    /** One prompt at a time, whichever button asked. */
    const busy = (on: boolean): void => {
      prompting = on;
      trigger.disabled = on;
      again.disabled = on;
    };

    const prepare = (): Promise<void> => {
      asking ??= (async () => {
        try {
          options = await passkeyOptions();
          fetchedAt = Date.now();
          if (alive && withAutofill && (await autofillAvailable())) autofill();
        } catch (err) {
          options = null;
          if (alive) say.error(err);
        } finally {
          asking = null;
        }
      })();
      return asking;
    };
    const autofill = (): void => {
      if (!options || !alive) return;
      inField = document.activeElement === address;
      passkeySignIn(options, { autofill: true }).then(
        (me) => this.signedIn(me, 'passkey'),
        (err: unknown) => {
          // Stopped for the button's prompt, or by the dialog closing: nothing to say.
          if (passkeyAborted(err) || !alive) return;
          if (err instanceof AccountError) {
            // The server turned the passkey down, and its ceremony with it.
            say.error(err);
            void prepare();
          } else if (inField) {
            // A passkey picked among the suggestions, and then none offered.
            askHandle();
          }
          // Anything else - no passkey here to offer, the request refused at
          // once, before the field was in use - leaves the field for an
          // address; asking again would only fail again.
        },
      );
    };
    address.addEventListener('focus', () => {
      inField = true;
    });
    trigger.addEventListener('click', () => {
      void (async () => {
        if (!options || Date.now() - fetchedAt > OPTIONS_FRESH_MS) await prepare();
        if (!options) return;
        say.note('Waiting for the passkey…');
        busy(true);
        try {
          // Its own ceremony takes the autofill's place.
          const me = await passkeySignIn(options);
          say.clear();
          this.signedIn(me, 'passkey');
        } catch (err) {
          if (!alive) return;
          if (passkeyAborted(err)) say.clear();
          else if (err instanceof AccountError) say.error(err);
          else askHandle();
          options = null;
          prompting = false;
          void prepare();
        } finally {
          busy(false);
        }
      })();
    });
    retry.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        const named = readHandle(handle.value);
        if (!named) {
          say.error(handle.value.trim() ? handleReasonText('format') : 'Type your handle.');
          handle.focus();
          return;
        }
        say.note('Waiting for the passkey…');
        busy(true);
        try {
          // Options on their way for the button would end this ceremony under it.
          await asking;
          const me = await passkeySignIn(await handlePasskeyOptions(named));
          say.clear();
          this.signedIn(me, 'passkey');
        } catch (err) {
          if (!alive) return;
          if (passkeyAborted(err)) say.clear();
          else if (passkeyNotAllowed(err)) say.error('The passkey did not work. Check the handle, or sign in with an email code instead.');
          else say.error(passkeyErrorText(err));
          // Its ceremony took the place of the one the button and the autofill had.
          options = null;
          prompting = false;
          void prepare();
        } finally {
          busy(false);
        }
      })();
    });
    const refresh = window.setInterval(() => {
      if (!prompting) void prepare();
    }, OPTIONS_FRESH_MS);
    this.leave.push(() => {
      alive = false;
      window.clearInterval(refresh);
      cancelPasskeyRequest();
    });
    void prepare();
  }

  /**
   * Signed in: after a code, a passkey is offered where they work (not in
   * the desktop app's window, where one made is unproven); then done.
   */
  private signedIn(me: Me, how: 'code' | 'passkey'): void {
    if (how === 'code' && passkeysHere(this.config) && !forDesktopApp()) this.showOffer(me);
    else this.finish(me);
  }

  // --- the code -----------------------------------------------------------------------

  private showCode(opts: {
    intro: string;
    sent: CodeSent;
    submitLabel: string;
    verify: (code: string) => Promise<void>;
    back: { label: string; go: () => void };
    extra?: HTMLElement;
    /** A sign-in or Join, which another tab may finish (the mail's link): look when the page is back in front. */
    watch?: boolean;
  }): void {
    this.clearStep();
    const code = new CodeStep({ config: this.config, ...opts });
    this.step('Check your email', code.root);
    this.leave.push(() => code.stop());
    code.focus();
    if (opts.watch) {
      // The mail's link opens another tab, which signs this browser in; the
      // code here is spent by then. Back on this page, the account says so
      // - one other than whoever was signed in as the step began (a
      // member's session over the owner tools, say), which is not this.
      let was: string | null | undefined;
      void getMe().then(
        (m) => {
          was = m?.id ?? null;
        },
        () => {
          was = null;
        },
      );
      const look = (): void => {
        if (document.visibilityState !== 'visible' || was === undefined) return;
        void getMe()
          .then((me) => {
            if (me && me.id !== was && this.overlay.isConnected) this.finish(me);
          })
          .catch(() => undefined);
      };
      document.addEventListener('visibilitychange', look);
      this.leave.push(() => document.removeEventListener('visibilitychange', look));
    }
  }

  // --- Join ---------------------------------------------------------------------------

  private showJoin(): void {
    this.clearStep();
    const form = el('form', 'account-step');
    form.noValidate = true;
    const say = new Say();
    let invite = rememberedInvite();
    let inviteOk = false;
    const inviteLine = el('p', 'account-invite');
    const inviteInput = input('text', 'invite', {
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      placeholder: 'https://…/?invite=…',
    });
    const inviteField = field('Invite link', inviteInput);
    const checkIt = async (): Promise<void> => {
      if (!invite) {
        inviteOk = false;
        return;
      }
      inviteLine.dataset.tone = 'quiet';
      inviteLine.textContent = 'Checking the invite…';
      try {
        const until = await checkInvite(invite);
        inviteOk = true;
        inviteLine.dataset.tone = 'ok';
        inviteLine.textContent = `Your invite works until ${dayOf(until)}.`;
      } catch (err) {
        inviteOk = false;
        inviteLine.dataset.tone = 'no';
        inviteLine.textContent = errorText(err);
        // Room for another link, should the person have one.
        inviteField.hidden = false;
      }
    };
    inviteField.hidden = !!invite;
    inviteInput.addEventListener('input', () => {
      const token = readInvite(inviteInput.value);
      if (token === invite) return;
      invite = token;
      if (token) {
        rememberInvite(token);
        void checkIt();
      } else {
        inviteOk = false;
        inviteLine.dataset.tone = inviteInput.value.trim() ? 'no' : 'quiet';
        inviteLine.textContent = inviteInput.value.trim() ? 'That is not an invite link.' : '';
      }
    });
    if (!invite) {
      inviteLine.dataset.tone = 'quiet';
      inviteLine.textContent = 'Joining takes an invite: paste the link you were sent.';
    }

    const handle = new HandleField('Handle');
    const address = input('email', 'email', { autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false' });
    const terms = termsBox();
    const privacy = el('p', 'account-small');
    privacy.append('What is kept, and why: the ', legalLink('privacy notice', LEGAL.privacy), '.');
    const botHost = el('div', 'account-bot');
    const bot = this.bot(botHost, 'register');
    void bot.start().catch((err: unknown) => say.error(err));
    const submit = button('Join', 'btn btn--primary account-submit');
    submit.type = 'submit';
    const actions = el('div', 'account-actions');
    actions.append(submit);
    form.append(
      inviteLine,
      inviteField,
      handle.root,
      field('Email', address),
      terms.root,
      privacy,
      botHost,
      actions,
      say.root,
    );
    const back = linkButton('Sign in');
    back.addEventListener('click', () => this.showSignIn());
    const foot = el('p', 'account-foot');
    foot.append('Have an account? ', back);
    this.step('Join Bozzetto', form, foot);
    if (invite) void checkIt();
    (invite ? handle.input : inviteInput).focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        say.clear();
        if (!invite) {
          say.error('Paste the invite link you were sent.');
          inviteField.hidden = false;
          inviteInput.focus();
          return;
        }
        if (!inviteOk) {
          await checkIt();
          if (!inviteOk) {
            say.error(inviteLine.textContent ?? 'This invite does not work.');
            return;
          }
        }
        if (!(await handle.check())) {
          handle.input.focus();
          return;
        }
        const email = address.value.trim();
        if (!email || !address.checkValidity()) {
          say.error('Type your email address: the code to finish joining goes there.');
          address.focus();
          return;
        }
        if (!terms.box.checked) {
          say.error('Tick the box to confirm you are 13 or older and accept the Terms.');
          terms.box.focus();
          return;
        }
        submit.disabled = true;
        say.note('Sending a code…');
        try {
          const sent = await startJoin({ invite, handle: handle.value, email, turnstile: await bot.take() });
          this.joinCode(email, sent);
        } catch (err) {
          submit.disabled = false;
          if (err instanceof AccountError && (err.code === 'handle_taken' || err.reason)) {
            handle.refused(err.reason);
            say.clear();
            return;
          }
          if (err instanceof AccountError && err.code === 'invite_invalid') {
            inviteOk = false;
            inviteLine.dataset.tone = 'no';
            inviteLine.textContent = err.message;
          }
          say.error(err);
        }
      })();
    });
  }

  /**
   * Join's code. The handle can be taken by someone else between the start
   * and the code (409): then the same code finishes it with another one,
   * chosen here.
   */
  private joinCode(email: string, sent: CodeSent): void {
    const again = new HandleField('Another handle');
    again.root.hidden = true;
    this.showCode({
      intro: `A code is on its way to ${email}. It works once, for 10 minutes.`,
      sent,
      submitLabel: 'Join',
      extra: again.root,
      verify: async (code) => {
        const replacing = !again.root.hidden;
        if (replacing && !(await again.check())) throw new AccountError('Choose another handle first.', 409, 'handle_pick');
        let me: Me;
        try {
          me = await finishJoin(code, replacing ? again.value : undefined);
        } catch (err) {
          if (err instanceof AccountError && err.code === 'handle_taken') {
            again.root.hidden = false;
            again.refused(err.reason);
            throw new AccountError(
              'That handle was taken meanwhile. Choose another, then Join with the same code.',
              409,
              'handle_taken',
            );
          }
          throw err;
        }
        forgetInvite();
        this.signedIn(me, 'code');
      },
      back: { label: 'Start again', go: () => this.showJoin() },
      watch: true,
    });
  }

  // --- the passkey offer --------------------------------------------------------------

  /** The offer on its own, as the owner's bootstrap makes it. */
  async offer(me: Me): Promise<boolean> {
    const answer = new Promise<Me | null>((resolve) => {
      this.resolve = resolve;
    });
    this.show();
    this.config = await loadConfig();
    if (this.gone) return false;
    let added = false;
    this.showOffer(me, () => {
      added = true;
    });
    return answer.then(() => added);
  }

  /**
   * "Add a passkey?" (§3 step 5): the new session counts as recent, so no
   * check comes first. Its options are asked for as it shows, so the click
   * makes the browser's request straight away.
   */
  private showOffer(me: Me, onAdded?: () => void): void {
    this.clearStep();
    const say = new Say();
    const add = button('Add a passkey', 'btn btn--primary account-submit');
    const skip = button('Not now', 'btn');
    const actions = el('div', 'account-actions');
    actions.append(add, skip);
    this.step(
      'Add a passkey?',
      el(
        'p',
        'account-lede',
        `Signed in as @${me.handle}. Next time, sign in with this device's screen lock (your face, your fingerprint or its PIN) instead of a code.`,
      ),
      el('p', 'account-small', 'You can add one later in Account, and remove it there.'),
      ...(inSafariBesideApp()
        ? [
            el(
              'p',
              'account-small',
              'Bozzetto on your Home Screen keeps a sign-in of its own: open it there and sign in too, with this passkey or a code.',
            ),
          ]
        : []),
      actions,
      say.root,
    );
    let options: PublicKeyCredentialCreationOptionsJSON | null = null;
    const prepare = async (): Promise<void> => {
      try {
        options = await newPasskeyOptions();
      } catch (err) {
        options = null;
        say.error(err);
      }
    };
    void prepare();
    skip.addEventListener('click', () => this.finish(me));
    add.addEventListener('click', () => {
      void (async () => {
        if (!options) await prepare();
        if (!options) return;
        add.disabled = true;
        say.note('Waiting for the passkey…');
        try {
          await addPasskey(options);
          onAdded?.();
          statusToast('').done('Passkey added. Next time, sign in with it.');
          this.finish(me);
        } catch (err) {
          add.disabled = false;
          if (passkeyAborted(err)) say.clear();
          else say.error(passkeyErrorText(err));
          options = null;
          void prepare();
        }
      })();
    });
    add.focus();
  }

  // --- confirming it is you -------------------------------------------------------------

  async reauth(hasPasskey: boolean): Promise<boolean> {
    let confirmed = false;
    const answer = new Promise<Me | null>((resolve) => {
      this.resolve = resolve;
    });
    this.show();
    this.config = await loadConfig();
    if (this.gone) return false;
    const done = (): void => {
      confirmed = true;
      this.resolve(null);
      this.dispose();
    };
    this.showReauth(hasPasskey && passkeysHere(this.config), done);
    return answer.then(() => confirmed);
  }

  private showReauth(withPasskey: boolean, done: () => void): void {
    this.clearStep();
    const say = new Say();
    const parts: HTMLElement[] = [
      el(
        'p',
        'account-lede',
        withPasskey
          ? 'This needs a fresh check that it is you: use your passkey, or a code sent to your email address.'
          : 'This needs a fresh check that it is you: a code goes to your email address.',
      ),
    ];
    if (withPasskey) {
      const passkey = button('Use a passkey', 'btn btn--primary account-passkey');
      let options: PublicKeyCredentialRequestOptionsJSON | null = null;
      let fetchedAt = 0;
      const prepare = async (): Promise<void> => {
        try {
          options = await passkeyOptions(true);
          fetchedAt = Date.now();
        } catch (err) {
          options = null;
          say.error(err);
        }
      };
      void prepare();
      passkey.addEventListener('click', () => {
        void (async () => {
          if (!options || Date.now() - fetchedAt > OPTIONS_FRESH_MS) await prepare();
          if (!options) return;
          passkey.disabled = true;
          say.note('Waiting for the passkey…');
          try {
            await passkeyReauth(options);
            done();
          } catch (err) {
            passkey.disabled = false;
            if (passkeyAborted(err)) say.clear();
            else say.error(passkeyErrorText(err));
            options = null;
            void prepare();
          }
        })();
      });
      parts.push(passkey);
    }
    const botHost = el('div', 'account-bot');
    const bot = this.bot(botHost, 'email-code');
    void bot.start().catch((err: unknown) => say.error(err));
    const byCode = button('Email me a code', withPasskey ? 'btn account-submit' : 'btn btn--primary account-submit');
    byCode.addEventListener('click', () => {
      void (async () => {
        byCode.disabled = true;
        say.note('Sending a code…');
        try {
          const sent = await startEmailReauth(await bot.take());
          this.showCode({
            intro: 'A code is on its way to your email address. It works once, for 10 minutes.',
            sent,
            submitLabel: 'Confirm',
            verify: async (code) => {
              await finishEmailReauth(code);
              done();
            },
            back: { label: 'Another way', go: () => this.showReauth(withPasskey, done) },
          });
        } catch (err) {
          byCode.disabled = false;
          say.error(err);
        }
      })();
    });
    parts.push(botHost, byCode, say.root);
    this.step('Confirm it is you', ...parts);
  }

  // --- the mail's sign-in link -----------------------------------------------------------

  async link(token: string): Promise<Me | null> {
    const answer = new Promise<Me | null>((resolve) => {
      this.resolve = resolve;
    });
    this.show();
    this.config = await loadConfig();
    this.step('Signing in', el('p', 'account-lede', 'One moment…'));
    try {
      const { joined, user } = await followLink(token);
      if (joined) forgetInvite();
      if (this.gone) return user;
      if (user) {
        this.signedIn(user, 'code');
      } else {
        // A re-authentication's link: the page that asked for it carries on.
        this.dispose();
        this.resolve(null);
        statusToast('').done('Confirmed. Go back to the page that asked, and carry on there.');
      }
    } catch (err) {
      if (this.gone) return null;
      this.clearStep();
      const say = new Say();
      say.error(err);
      const signIn = button('Sign in', 'btn btn--primary');
      signIn.addEventListener('click', () => this.showSignIn());
      const actions = el('div', 'account-actions');
      actions.append(signIn);
      this.step(
        'That link did not work',
        el('p', 'account-lede', 'A sign-in link works once, for 10 minutes, and only in the browser that asked for the code.'),
        say.root,
        actions,
      );
    }
    return answer;
  }
}
