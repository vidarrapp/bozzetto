import type { Env } from '../env';
import type { UserRow } from '../types';
import { appOrigin, isLoopback } from '../env';
import { HttpError } from '../http';
import { sha256Hex } from '../crypto';
import { MAIL_ALL, countOne, peekCount } from './ratelimit';

/**
 * Mail (docs/accounts.md §6): sign-in codes, the notice that an address
 * has an account already, and notices to an account's holder - a passkey
 * added or removed, the address changed (to the old one), the account
 * suspended or being deleted.
 *
 * Mail goes through Resend (RESEND_API_KEY, from MAIL_FROM), as text
 * alone: no HTML means no open-tracking pixel and no links rewritten
 * through Resend, whatever the domain's settings say. The answer does not
 * wait for Resend (the call runs on through waitUntil), so how long Resend
 * takes says nothing to whoever asked - whether an address has an
 * account, above all. A failure there is logged, never with the address
 * in it, and retried once under the same Idempotency-Key, so a mail Resend
 * did take is not sent twice.
 *
 * Without RESEND_API_KEY, a loopback host writes each mail to dev_outbox
 * at once (GET /api/dev/outbox reads it back, under the test hooks) and
 * logs that it did; any other host answers 503 not_configured, so no
 * deployment quietly sends nothing.
 *
 * Every mail counts against the day's cap, 90 per UTC day (Resend's free
 * tier allows 100), in rate_limits like the other limits; past it a mail
 * someone asked for is 503 mail_paused until midnight UTC, and a notice is
 * dropped and logged.
 */

/** One mail: to one address, in plain text. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Resend keeps it 24 hours: the same key again is the same mail, not another. */
  idempotencyKey: string;
}

/** What the mailer needs of the request it serves: the host, the time, and a way to finish after the answer. */
export interface MailContext {
  request: Request;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
}

/** How mail goes out from here. */
export type Transport = { kind: 'resend'; key: string; from: string } | { kind: 'stub' };

const RESEND_URL = 'https://api.resend.com/emails';
/** A Resend that hangs must not keep the request's remains alive for long. */
const RESEND_TIMEOUT_MS = 10_000;
/** The pause before the one retry of a mail Resend did not take. */
const RETRY_DELAY_MS = 500;

/** Each misconfiguration is logged once per isolate, not on every request. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(message);
}

// --- addresses ------------------------------------------------------------------------

/**
 * An address as <input type=email> takes one (the WHATWG rule), lower-cased
 * and with a dot in its domain. Nothing in it can start another address
 * or a display name: no spaces, commas, quotes or angle brackets.
 */
const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** The most an address may be, in characters (RFC 5321's path, less its brackets). */
export const MAX_EMAIL = 254;

/** An address as given, trimmed and lower-cased, or null when it is not one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= MAX_EMAIL && EMAIL.test(email) ? email : null;
}

/** An address shown without giving it away: `j…@example.com`. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 1 ? '…' : `${address[0]}…${address.slice(at)}`;
}

/** Text with anything shaped like an address taken out: what may be logged of a mail's fate. */
export function scrub(text: string): string {
  return text.replace(/[^\s@<>"',;:()[\]]+@[^\s@<>"',;:()[\]]+/g, '[address]');
}

// --- the transport and the day's cap -----------------------------------------------

/**
 * How mail goes out from here - Resend, or the dev_outbox stub on a
 * loopback host without RESEND_API_KEY - or a 503 not_configured. Asked
 * before anything is counted, and before Turnstile, so a deployment that
 * cannot mail spends nobody's token or limits.
 */
export function mailTransport(env: Env, request: Request): Transport {
  const key = env.RESEND_API_KEY?.trim();
  if (key) {
    const from = env.MAIL_FROM?.trim();
    if (from) return { kind: 'resend', key, from };
    warnOnce('from', 'Mail refused: RESEND_API_KEY is set but MAIL_FROM is not');
  } else if (isLoopback(new URL(request.url))) {
    return { kind: 'stub' };
  } else {
    warnOnce('key', 'Mail refused: set RESEND_API_KEY and MAIL_FROM');
  }
  throw new HttpError('Mail is not configured', 503, 'not_configured');
}

/**
 * The day's cap, for one mail about to go (`count`), or - not counting -
 * for an answer that must look like one that sent a mail without sending
 * it. Past it, 503 mail_paused with Retry-After, the seconds until
 * midnight UTC. What it refuses still counts, as every limit's does.
 */
export async function dailyCap(env: Env, ctx: MailContext, count: boolean): Promise<void> {
  const tally = count
    ? await countOne(env, MAIL_ALL, 'all', ctx.now, ctx.waitUntil)
    : await peekCount(env, MAIL_ALL, 'all', ctx.now);
  if (count ? tally.count <= MAIL_ALL.max : tally.count < MAIL_ALL.max) return;
  warnOnce('paused', `Mail paused: ${MAIL_ALL.max} mails went out today (UTC), the most a day may send`);
  throw new HttpError(
    'Mail is paused until tomorrow; try again then',
    503,
    'mail_paused',
    { retryAfter: tally.retryAfter },
    { 'retry-after': String(tally.retryAfter) },
  );
}

/** Write a mail to dev_outbox, and say so in the log - with its subject, a code's on loopback, never its address. */
async function toOutbox(env: Env, now: number, mail: Mail): Promise<void> {
  const { meta } = await env.DB.prepare('INSERT INTO dev_outbox (at, to_addr, subject, body) VALUES (?, ?, ?, ?)')
    .bind(now, mail.to, mail.subject, mail.text)
    .run();
  console.log(`mail (stub): dev_outbox #${meta.last_row_id}: ${mail.subject}`);
}

/** Hand a mail to Resend, once more on no answer, a 429 or a 5xx; a failure is logged without addresses. */
async function toResend(via: Extract<Transport, { kind: 'resend' }>, mail: Mail): Promise<void> {
  const body = JSON.stringify({
    from: via.from,
    to: [mail.to],
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let detail = '';
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${via.key}`,
          'content-type': 'application/json',
          'idempotency-key': mail.idempotencyKey,
          'user-agent': 'bozzetto',
        },
        body,
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      if (res.ok) return;
      status = res.status;
      detail = await res.text().catch(() => '');
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    if (attempt === 1 && (status === 0 || status === 429 || status >= 500)) {
      await new Promise((ok) => setTimeout(ok, RETRY_DELAY_MS));
      continue;
    }
    console.error(`Resend did not take a mail (${status || 'no answer'}): ${scrub(detail).slice(0, 300)}`);
    return;
  }
}

/**
 * Send a mail the cap has already counted: into dev_outbox now, or to
 * Resend without the answer waiting for it.
 */
export async function deliver(env: Env, ctx: MailContext, via: Transport, mail: Mail): Promise<void> {
  if (via.kind === 'stub') {
    await toOutbox(env, ctx.now, mail);
    return;
  }
  ctx.waitUntil(toResend(via, mail));
}

/**
 * Send one mail: 503 not_configured when nothing here can, 503 mail_paused
 * past the day's cap; else it goes (deliver).
 */
export async function sendMail(env: Env, ctx: MailContext, mail: Mail): Promise<void> {
  const via = mailTransport(env, ctx.request);
  await dailyCap(env, ctx, true);
  await deliver(env, ctx, via, mail);
}

// --- what is sent ----------------------------------------------------------------------

/** The origin mails link to: APP_ORIGIN, or this request's own while it is unset (local). */
export function siteOrigin(env: Env, request: Request): string {
  return appOrigin(env) ?? new URL(request.url).origin;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A moment as a mail says it: `7 October 2026 at 14:03 UTC`. */
export function when(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** A mail's words, before it is addressed. */
export interface Letter {
  subject: string;
  text: string;
}

/**
 * A code (§6): the six digits in the subject, so a notification shows
 * them, and spaced in the text. `link`, for a flow begun with link: true
 * (desktop browsers), is the same sign-in as a link that works only in the
 * browser that asked.
 */
export function codeMail(code: string, link: string | null): Letter {
  const lines = [`Your code is ${code.slice(0, 3)} ${code.slice(3)}. Type it where Bozzetto asked. It works once, for 10 minutes.`];
  if (link) lines.push('', `Or open ${link} in the same browser.`);
  lines.push('', 'Did not ask? Ignore this mail: the code is useless without the device that asked.');
  return { subject: `${code} is your Bozzetto code`, text: lines.join('\n') };
}

/**
 * What an address that has an account gets instead of a code, when it is
 * given for a new account or as an account's new address: the same 202
 * answers either way, and only the mailbox learns the difference.
 */
export function registeredMail(origin: string): Letter {
  return {
    subject: 'You already have a Bozzetto account',
    text: [
      'Someone, probably you, asked to use this address for a Bozzetto account, but it already has one.',
      '',
      `To sign in, open ${origin}/?signin and use your passkey, or ask for a code to this address.`,
      '',
      'Did not ask? Ignore this mail: nothing has changed.',
    ].join('\n'),
  };
}

/** Things an account's holder is told by mail. Batch 6's owner tools send the last two. */
export type Notice =
  | { kind: 'passkey.added'; name: string }
  | { kind: 'passkey.removed'; name: string }
  /** To the old address; `to` is the new one, shown masked. */
  | { kind: 'email.changed'; to: string }
  | { kind: 'account.suspended'; reason: string }
  /** When a deletion begins (its first call). */
  | { kind: 'account.deleted' };

/** The words of a notice to `user` at `now`. */
export function noticeMail(notice: Notice, user: Pick<UserRow, 'handle'>, now: number, origin: string): Letter {
  const account = `your Bozzetto account @${user.handle}`;
  const at = when(now);
  const notYou = `If it was not, sign in at ${origin}/?signin`;
  switch (notice.kind) {
    case 'passkey.added':
      return {
        subject: 'A passkey was added to your Bozzetto account',
        text: [
          `A passkey${named(notice.name)} was added to ${account} on ${at}.`,
          '',
          `If that was you, there is nothing to do. ${notYou}, remove it under Account, and sign out everywhere.`,
        ].join('\n'),
      };
    case 'passkey.removed':
      return {
        subject: 'A passkey was removed from your Bozzetto account',
        text: [
          `A passkey${named(notice.name)} was removed from ${account} on ${at}.`,
          '',
          `If that was you, there is nothing to do. ${notYou}, check your passkeys under Account, and sign out everywhere.`,
        ].join('\n'),
      };
    case 'email.changed':
      return {
        subject: 'Your Bozzetto account has a new address',
        text: [
          `The address of ${account} was changed from this one to ${maskAddress(notice.to)} on ${at}. Mail about the account goes there from now on.`,
          '',
          `If that was you, there is nothing to do. ${notYou} with your passkey, change the address back under Account, and sign out everywhere.`,
        ].join('\n'),
      };
    case 'account.suspended':
      return {
        subject: 'Your Bozzetto account is suspended',
        text: [
          `${capital(account)} was suspended on ${at}, and signed out everywhere. Your work is kept.`,
          '',
          `The reason given: ${notice.reason}`,
          '',
          "If you think this is a mistake, write to the site's owner to object.",
        ].join('\n'),
      };
    case 'account.deleted':
      return {
        subject: 'Your Bozzetto account is being deleted',
        text: [
          `${capital(account)} is being deleted, as asked on ${at}: its projects and files are removed, and then the account itself. Nothing can be brought back afterwards.`,
          '',
          "If you did not ask for this, write to the site's owner at once.",
        ].join('\n'),
      };
  }
}

const capital = (s: string): string => s[0].toUpperCase() + s.slice(1);
/** A passkey's name as a notice gives it, when it has one: `, "Safari on Mac",`. */
const named = (name: string): string => (name ? `, "${name}",` : '');

/**
 * Tell an account's holder something by mail, at the address they have
 * (for email.changed, the old one). A notice never fails what it tells of:
 * mail not configured, the day's cap reached, or a database error is
 * logged - with the account's id, never its address - and dropped.
 */
export async function notify(
  env: Env,
  ctx: MailContext,
  user: Pick<UserRow, 'id' | 'handle' | 'email'>,
  notice: Notice,
): Promise<void> {
  try {
    const letter = noticeMail(notice, user, ctx.now, siteOrigin(env, ctx.request));
    const idempotencyKey = `notice:${await sha256Hex(JSON.stringify([user.id, notice, ctx.now]))}`;
    await sendMail(env, ctx, { to: user.email, ...letter, idempotencyKey });
  } catch (err) {
    const why = err instanceof HttpError ? err.message : err instanceof Error ? err.message : String(err);
    console.error(`notice ${notice.kind} for ${user.id} not sent: ${scrub(why)}`);
  }
}
