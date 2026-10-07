import type { Env } from '../env';
import type { RequestData } from '../principal';
import type { UserRow } from '../types';
import type { Me } from './account';
import type { FlowMatch, FlowRow, NewFlow } from './codes';
import type { MailContext, Transport } from './mail';
import type { Client } from './session';
import { MEMBER_LIMITS, TERMS_VERSION } from '../config';
import { HttpError } from '../http';
import { randomId, randomToken, sha256Hex, timingSafeEqual } from '../crypto';
import { meOf } from './account';
import { answer, noContent, requireUser } from './api';
import { auditStatement } from './audit';
import {
  CODE_TTL,
  MAX_ATTEMPTS,
  MAX_SENDS,
  RESEND_AFTER,
  attemptFlow,
  beginFlow,
  codeSecret,
  consumeFlow,
  dropFlow,
  flowExpired,
  flowToken,
  liveFlow,
  renewFlow,
} from './codes';
import { handleProblem } from './handles';
import { inviteInvalid } from './invites';
import { codeMail, dailyCap, deliver, mailTransport, notify, registeredMail, siteOrigin } from './mail';
import {
  CODE_CHECKS,
  MAIL_PER_ADDRESS,
  MAIL_PER_ADDRESS_DAY,
  MAIL_PER_IP,
  clientIp,
  enforce,
  tooMany,
} from './ratelimit';
import { clearFlow, flowCookie, newSession, signInCookies, userAgentOf, withCookies } from './session';
import { verifyTurnstile } from './turnstile';

/**
 * The email flows end to end (docs/accounts.md §3): what the routes under
 * /api/auth/register, /api/auth/email and /api/me/email share. A flow is
 * begun with its code mailed, may be sent again, and is checked by its code
 * or its link; a match completes it as its purpose says - an account made,
 * a sign-in, a re-authentication, an address changed.
 *
 * Whatever a start is asked, its answer is the same 202 and the same
 * cookie whether or not the address has an account: what differs is only
 * what the mailbox gets (a code, the notice that the address has an
 * account already, or nothing), and the mail itself leaves after the
 * answer. The limits are counted the same either way, so neither the
 * answer, nor its timing, nor a 429 tells anyone whose address it is.
 */

/** A request as the email routes have it. */
export interface FlowContext {
  request: Request;
  env: Env;
  data: RequestData;
  waitUntil: (p: Promise<unknown>) => void;
}

const mailContext = (ctx: FlowContext): MailContext => ({
  request: ctx.request,
  now: ctx.data.now,
  waitUntil: ctx.waitUntil,
});

/** What a send owes the flow's address: its code, the notice that it has an account already, or nothing. */
export type Outgoing = 'code' | 'registered' | 'none';

const seconds = (until: number, now: number): number => Math.max(1, Math.ceil((until - now) / 1000));

/**
 * 202 {expiresAt, resendAfter, resendsLeft} with the flow's cookie - set
 * again by a resend, so it outlives the new code.
 */
function sent(token: string, expiresAt: number, sends: number): Response {
  return withCookies(
    answer({ expiresAt, resendAfter: RESEND_AFTER / 1000, resendsLeft: MAX_SENDS - sends }, 202),
    [flowCookie(token)],
  );
}

/**
 * The limits on mail someone asks for (§3), counted whether or not a mail
 * goes out: per IP, then per address, its 15 minutes and its day. Each
 * stops the rest from counting when it refuses.
 */
async function mailLimits(ctx: FlowContext, address: string): Promise<void> {
  const { env, request, data, waitUntil } = ctx;
  await enforce(env, MAIL_PER_IP, clientIp(request), data.now, waitUntil);
  await enforce(env, MAIL_PER_ADDRESS, address, data.now, waitUntil);
  await enforce(env, MAIL_PER_ADDRESS_DAY, address, data.now, waitUntil);
}

/** Send what a flow's send owes its address, keyed `<flow id>:<send n>` for Resend. */
async function dispatch(
  ctx: FlowContext,
  via: Transport,
  flowId: string,
  address: string,
  outgoing: Outgoing,
  sendsSoFar: number,
  code: string,
  linkToken: string | null,
): Promise<void> {
  if (outgoing === 'none') return;
  const origin = siteOrigin(ctx.env, ctx.request);
  const letter = outgoing === 'code' ? codeMail(code, linkToken ? `${origin}/?link=${linkToken}` : null) : registeredMail(origin);
  await deliver(ctx.env, mailContext(ctx), via, { to: address, ...letter, idempotencyKey: `${flowId}:${sendsSoFar}` });
}

/**
 * Begin a flow and send what it owes (§3): the mail limits, the day's cap
 * (only looked at when nothing goes, so a send that is not made counts
 * against nothing Resend bills), the flow, the mail. Answers 202 with the
 * flow cookie. The route has checked Turnstile and whatever its purpose
 * asks before this.
 */
export async function startFlow(ctx: FlowContext, flow: NewFlow, outgoing: Outgoing): Promise<Response> {
  const via = mailTransport(ctx.env, ctx.request);
  await mailLimits(ctx, flow.email);
  await dailyCap(ctx.env, mailContext(ctx), outgoing !== 'none');
  const begun = await beginFlow(ctx.env, ctx.request, ctx.data.now, flow);
  await dispatch(ctx, via, begun.id, flow.email, outgoing, begun.sends, begun.code, begun.linkToken);
  return sent(begun.token, begun.expiresAt, begun.sends);
}

/**
 * What a flow's address is owed on a resend, found by one read whatever
 * the answer: a registration's or a new address's, the notice when it has
 * an account by now; a sign-in's, a code only while the account it began
 * for still has it and is active.
 */
async function owed(env: Env, flow: FlowRow): Promise<Outgoing> {
  if (flow.purpose === 'reauth') return 'code';
  const holder = await env.DB.prepare('SELECT id, status FROM users WHERE email = ?')
    .bind(flow.email)
    .first<Pick<UserRow, 'id' | 'status'>>();
  if (flow.purpose === 'sign_in') return holder && holder.status === 'active' && holder.id === flow.user_id ? 'code' : 'none';
  return holder ? 'registered' : 'code';
}

/**
 * POST /api/auth/email/resend: a new code for the flow this browser's
 * cookie names, whatever its purpose, at most 3 sends to a flow and 60 s
 * apart (429 with Retry-After otherwise, and `resendsLeft`). The flows of
 * an account (re-authentication, a new address) are its session's alone.
 * Turnstile (`email-code`) and the mail limits as a start's.
 */
export async function resendFlow(ctx: FlowContext, body: Record<string, unknown>): Promise<Response> {
  const { env, request, data } = ctx;
  const { now } = data;
  const token = flowToken(request);
  const flow = token ? await liveFlow(env, await sha256Hex(token), now) : null;
  if (!token || !flow) throw flowExpired();
  if ((flow.purpose === 'reauth' || flow.purpose === 'change_email') && requireUser(data.principal).user.id !== flow.user_id) {
    throw flowExpired(false);
  }
  const left = MAX_SENDS - flow.sends;
  if (left <= 0) {
    throw tooMany(seconds(flow.expires_at, now), { resendsLeft: 0 }, 'No more codes for this one: use the last, or start again');
  }
  const next = flow.expires_at - CODE_TTL + RESEND_AFTER;
  if (now < next) throw tooMany(seconds(next, now), { resendsLeft: left }, 'A new code can be sent in a moment');
  const via = mailTransport(env, request);
  await verifyTurnstile(env, request, { token: body.turnstile, action: 'email-code' });
  const outgoing = await owed(env, flow);
  await mailLimits(ctx, flow.email);
  await dailyCap(env, mailContext(ctx), outgoing !== 'none');
  const renewed = await renewFlow(env, flow, now);
  if (!renewed) {
    // Another request changed it first: a resend of its own (then this one
    // is too soon), or a check that spent it.
    const still = await liveFlow(env, flow.id, now);
    if (still) throw tooMany(RESEND_AFTER / 1000, { resendsLeft: MAX_SENDS - still.sends }, 'A new code can be sent in a moment');
    throw flowExpired();
  }
  await dispatch(ctx, via, flow.id, flow.email, outgoing, renewed.sends, renewed.code, renewed.linkToken);
  return sent(token, renewed.expiresAt, renewed.sends);
}

/** How a flow is proven: the code it mailed, or the link beside it. */
export type Proof = { code: string } | { link: string };

/** What completing a flow may take from the request. */
export interface Completion {
  client: Client;
  /** A registration's handle, replacing the flow's after a 409 handle_taken kept it. */
  handle?: string;
}

/**
 * Check a code or a link against this browser's flow, and complete the
 * flow on a match. Code checks are limited per IP (30 per 10 minutes);
 * then the attempt is counted before anything is compared (5 to a code),
 * and the HMACs compared in constant time.
 *
 * - No live flow that `match` allows: 410 flow_expired. The cookie is
 *   cleared when no live flow is behind it at all (none, expired, spent),
 *   and kept when there is one this request cannot complete (another
 *   purpose, another account's, a link where none was mailed), which
 *   costs that flow no attempt.
 * - No match: 400 code_invalid with `attemptsLeft`; at 0 the flow is
 *   spent, and its cookie cleared.
 */
export async function checkFlow(ctx: FlowContext, proof: Proof, match: FlowMatch, done: Completion): Promise<Response> {
  const { env, request, data, waitUntil } = ctx;
  await enforce(env, CODE_CHECKS, clientIp(request), data.now, waitUntil);
  const token = flowToken(request);
  const id = token ? await sha256Hex(token) : null;
  const flow = id ? await attemptFlow(env, id, data.now, { ...match, link: 'link' in proof }) : null;
  if (!id) throw flowExpired();
  if (!flow) throw flowExpired(!(await liveFlow(env, id, data.now)));
  const good =
    'code' in proof
      ? timingSafeEqual(await codeSecret(env, id, proof.code), flow.secret)
      : flow.link_hash !== null && timingSafeEqual(await sha256Hex(proof.link), flow.link_hash);
  if (!good) {
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - flow.attempts);
    throw new HttpError(
      'link' in proof ? 'That link is not right' : 'That code is not right',
      400,
      'code_invalid',
      { attemptsLeft },
      attemptsLeft === 0 ? { 'set-cookie': clearFlow() } : {},
    );
  }
  const method = 'link' in proof ? 'link' : 'email';
  switch (flow.purpose) {
    case 'register':
      return completeRegistration(ctx, flow, method, done);
    case 'sign_in':
      return completeSignIn(ctx, flow, method, done);
    case 'reauth':
      return completeReauth(ctx, flow);
    case 'change_email':
      return completeEmailChange(ctx, flow);
  }
}

/**
 * A registration's code matched (§3 step 4): the account, the invite's
 * use, the session, the audit row and the flow's end in one batch. The
 * account is inserted from the invite's row, so an invite that no longer
 * admits anyone (revoked, expired, its last use taken meanwhile) makes no
 * account; its use is counted only beside an account made, and its CHECK
 * (uses <= max_uses) rolls the whole batch back should a last use be raced
 * for all the same.
 *
 * - The invite admits nobody: 410 invite_invalid, and the flow is gone.
 * - The handle taken meanwhile: 409 handle_taken, and the flow is kept -
 *   the same code with another `handle` completes it.
 * - The address taken meanwhile, or the flow used by another request:
 *   410 flow_expired.
 * - Made: 201 {user} (as GET /api/me) with the session cookie, signed in
 *   by 'email' or 'link', which counts as recent authentication.
 */
async function completeRegistration(
  ctx: FlowContext,
  flow: FlowRow,
  method: 'email' | 'link',
  done: Completion,
): Promise<Response> {
  const { env, request, data } = ctx;
  const { now } = data;
  const handle = done.handle ?? flow.handle ?? '';
  const problem = await handleProblem(env, handle, now);
  if (problem === 'format' || problem === 'reserved') {
    throw new HttpError('That handle cannot be used', 400, 'bad_request', { reason: problem });
  }
  if (problem) throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: problem });
  const id = randomId('u');
  const made = { sql: 'SELECT 1 FROM users WHERE id = ?', binds: [id] };
  const session = await newSession(env, {
    userId: id,
    method,
    client: done.client,
    userAgent: userAgentOf(request),
    now,
    onlyIf: made,
  });
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO users (id, handle, email, webauthn_user_id, role, status, quota_bytes, bytes_used, invite_id,
                          terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'member', 'active', ?, 0, id, ?, ?, ?, ?, ?
       FROM invites
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses
         AND EXISTS (SELECT 1 FROM pending_auth WHERE id = ? AND kind = 'email')`,
    ).bind(
      id,
      handle,
      flow.email,
      randomToken(32),
      MEMBER_LIMITS.quotaBytes,
      TERMS_VERSION,
      now,
      now,
      now,
      now,
      flow.invite_id,
      now,
      flow.id,
    ),
    env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)').bind(
      flow.invite_id,
      id,
    ),
    session.insert,
    auditStatement(
      env,
      {
        actor: id,
        action: 'user.register',
        subject: id,
        at: now,
        detail: { invite: flow.invite_id, session: session.id, method, client: done.client },
      },
      made,
    ),
  ];
  // A session this browser held is replaced by the new account's.
  if (data.principal.kind === 'user') {
    statements.push(
      env.DB.prepare(
        `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND EXISTS (${made.sql})`,
      ).bind(now, data.principal.session.id, id),
    );
  }
  statements.push(env.DB.prepare("DELETE FROM pending_auth WHERE id = ? AND kind = 'email'").bind(flow.id));
  let results: D1Result[];
  try {
    results = await env.DB.batch(statements);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/UNIQUE/i.test(message) && /handle/i.test(message)) {
      // Taken since it was checked: all of the batch rolled back, the
      // flow's end with it, so another handle can be tried with this code.
      throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: 'taken' });
    }
    if (/UNIQUE/i.test(message) && /email/i.test(message)) {
      // An account has the address by now: this flow can make none.
      await dropFlow(env, flow.id);
      throw flowExpired();
    }
    if (/CHECK/i.test(message)) {
      await dropFlow(env, flow.id);
      throw inviteInvalid({ 'set-cookie': clearFlow() });
    }
    throw err;
  }
  if (!results[results.length - 1].meta.changes) throw flowExpired();
  if (!results[0].meta.changes) throw inviteInvalid({ 'set-cookie': clearFlow() });
  const user: Me = {
    id,
    handle,
    role: 'member',
    status: 'active',
    usage: { used: 0, reserved: 0, quota: MEMBER_LIMITS.quotaBytes },
  };
  return withCookies(answer({ user }, 201), signInCookies(session.token));
}

/**
 * A sign-in's code matched: the flow is consumed (DELETE … RETURNING, so of
 * two requests with it one gets it), and a session begins for its account,
 * if that is still active - 200 {user} (as GET /api/me) with the cookie,
 * the browser's previous session revoked, audited.
 */
async function completeSignIn(
  ctx: FlowContext,
  flow: FlowRow,
  method: 'email' | 'link',
  done: Completion,
): Promise<Response> {
  const { env, request, data } = ctx;
  const { now } = data;
  if (!(await consumeFlow(env, flow.id))) throw flowExpired();
  const user = flow.user_id
    ? await env.DB.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").bind(flow.user_id).first<UserRow>()
    : null;
  if (!user) throw flowExpired();
  const session = await newSession(env, { userId: user.id, method, client: done.client, userAgent: userAgentOf(request), now });
  const statements: D1PreparedStatement[] = [session.insert];
  if (data.principal.kind === 'user') {
    statements.push(
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, data.principal.session.id),
    );
  }
  statements.push(
    auditStatement(env, {
      actor: user.id,
      action: 'session.signin',
      subject: user.id,
      at: now,
      detail: { method, session: session.id, client: done.client },
    }),
  );
  await env.DB.batch(statements);
  return withCookies(answer({ user: await meOf(env, user) }), signInCookies(session.token));
}

/** A re-authentication's code matched: the flow is consumed, and this session counts as recent (204). */
async function completeReauth(ctx: FlowContext, flow: FlowRow): Promise<Response> {
  const { env, data } = ctx;
  const me = requireUser(data.principal);
  if (me.user.id !== flow.user_id || !(await consumeFlow(env, flow.id))) throw flowExpired();
  await env.DB.prepare('UPDATE sessions SET reauth_at = ? WHERE id = ?').bind(data.now, me.session.id).run();
  return withCookies(noContent(), [clearFlow()]);
}

/**
 * A new address's code matched: the address is swapped and audited (no
 * address in the row) as the flow ends, and the old address is told,
 * with the new one masked. 200 {email}. An account that has the address
 * by now makes it 410 flow_expired.
 */
async function completeEmailChange(ctx: FlowContext, flow: FlowRow): Promise<Response> {
  const { env, data } = ctx;
  const me = requireUser(data.principal);
  if (me.user.id !== flow.user_id) throw flowExpired();
  const pending = { sql: "SELECT 1 FROM pending_auth WHERE id = ? AND kind = 'email'", binds: [flow.id] };
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET email = ?, updated_at = ? WHERE id = ? AND EXISTS (${pending.sql})`).bind(
        flow.email,
        data.now,
        me.user.id,
        flow.id,
      ),
      auditStatement(env, { actor: me.user.id, action: 'account.email', subject: me.user.id, at: data.now }, pending),
      env.DB.prepare("DELETE FROM pending_auth WHERE id = ? AND kind = 'email'").bind(flow.id),
    ]);
  } catch (err) {
    if (!/UNIQUE/i.test(String((err as Error)?.message ?? err))) throw err;
    await dropFlow(env, flow.id);
    throw flowExpired();
  }
  if (!results[2].meta.changes) throw flowExpired();
  await notify(env, mailContext(ctx), me.user, { kind: 'email.changed', to: flow.email });
  return withCookies(answer({ email: flow.email }), [clearFlow()]);
}
