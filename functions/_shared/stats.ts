import type { Env } from './env';
import type { Principal } from './principal';
import type { UserRow } from './types';
import { authSecret, clientIp, countOne, enforce, type Limit } from './auth/ratelimit';
import { hmacHex } from './crypto';
import { HttpError } from './http';
import { cursorOf, type Cursor } from './owner';
import { CARD_COLUMNS, CURSOR_ID, publicCard, type CardRow, type CommunityCard, type Page } from './community';

/**
 * Views and stars in the community gallery (docs/accounts.md §13).
 *
 * - A **view** is one visitor opening a public work in the viewer, counted
 *   once a day: the first open of the day leaves a mark, an HMAC under
 *   AUTH_SECRET of the day, the project and the visitor - the account's id
 *   when signed in, else the address and the browser (User-Agent) - so no
 *   address or identity is kept, only the code, and the marks go after two
 *   days. The author's own opens and reviewers' (the owner, moderators)
 *   never count. The route always answers 204, whatever was counted.
 * - A **star** is a signed-in member's favourite: one row per member and
 *   project, and a counter on the project kept in step in the same batch
 *   (recounted, so it can never drift). Only of public work, never one's own.
 *
 * Only the author (My projects) and reviewers (the Gallery tab) see the
 * counts; the public lists carry none.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Views counted per address: generous, 300 an hour; past it nothing more is counted (and nothing said). */
export const VIEWS: Limit = { name: 'view', max: 300, windowMs: HOUR };
/** Star and unstar, per account: 200 changes a day. */
export const STAR_CHANGES: Limit = { name: 'star', max: 200, windowMs: DAY };
/** The share of counted views that also sweep the marks older than yesterday. */
export const PRUNE_SHARE = 1 / 50;

/** A project anyone may see now: approved, not a template, its author's account active. */
const PUBLIC = `shared = 'public' AND template = 0 AND owner_id IN (SELECT id FROM users WHERE status = 'active')`;

/** The UTC day a time falls on, as a whole number of days. */
export const dayOf = (now: number): number => Math.floor(now / DAY);

/** Delete the view marks older than yesterday: a mark lives two days at most. */
export function pruneViewMarks(env: Env, now: number): Promise<unknown> {
  return env.DB.prepare('DELETE FROM view_marks WHERE day < ?').bind(dayOf(now) - 1).run();
}

/**
 * A view of a public work (POST /api/community/:id/view). Counts one at most
 * per visitor, project and day; nothing for the author, a reviewer, a
 * project not public now, or an address past VIEWS this hour. Never throws
 * for any of those; the route answers 204 whatever happened. `prune`
 * decides whether this one also sweeps old marks (PRUNE_SHARE of them).
 * Answers whether it counted, for the tests.
 */
export async function countView(
  env: Env,
  principal: Principal,
  request: Request,
  id: string,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
  prune: boolean = Math.random() < PRUNE_SHARE,
): Promise<boolean> {
  if (!CURSOR_ID.test(id)) return false;
  let who: string;
  let self = '';
  if (principal.kind === 'user') {
    if (principal.user.role === 'owner' || principal.user.role === 'moderator') return false;
    who = `u:${principal.user.id}`;
    self = principal.user.id;
  } else {
    who = `g:${clientIp(request)}\u0000${request.headers.get('user-agent') ?? ''}`;
  }
  const tally = await countOne(env, VIEWS, clientIp(request), now, waitUntil);
  if (tally.count > VIEWS.max) return false;
  const day = dayOf(now);
  const key = await hmacHex(authSecret(env), `view\u0000${day}\u0000${id}\u0000${who}`, 16);
  const mark = await env.DB.prepare(
    `INSERT INTO view_marks (key, day)
     SELECT ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id <> ? AND ${PUBLIC})
     ON CONFLICT (key) DO NOTHING RETURNING key`,
  )
    .bind(key, day, id, self)
    .first<{ key: string }>();
  if (mark) await env.DB.prepare('UPDATE projects SET views = views + 1 WHERE id = ?').bind(id).run();
  if (prune) {
    const sweep = pruneViewMarks(env, now).catch((err: unknown) => console.error('view mark sweep failed:', err));
    if (waitUntil) waitUntil(sweep);
    else await sweep;
  }
  return mark !== null;
}

const notFound = (): HttpError => new HttpError('Not found', 404, 'not_found');

/** The statement that sets a project's star count to the stars it has. */
const recount = (env: Env, id: string): D1PreparedStatement =>
  env.DB.prepare('UPDATE projects SET stars = (SELECT COUNT(*) FROM stars WHERE project_id = ?) WHERE id = ?').bind(id, id);

/**
 * Star (`on`) or unstar a project for a member (PUT and DELETE
 * /api/me/stars/:id), idempotent: starring what is starred, or unstarring
 * what is not, changes and counts nothing. Starring wants a project public
 * now (404 otherwise) and not the member's own (400 reason own). Unstarring
 * removes the member's star whatever the project's state now (a hidden one
 * included); with no star to remove it answers as starring would (404 for
 * one not public, 400 own). Each change counts against STAR_CHANGES (429
 * past it), and moves the project's `stars` in the same batch.
 */
export async function setStar(
  env: Env,
  user: UserRow,
  id: string,
  on: boolean,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  if (!CURSOR_ID.test(id)) throw notFound();
  const had = await env.DB.prepare('SELECT 1 AS found FROM stars WHERE user_id = ? AND project_id = ?').bind(user.id, id).first();
  if (!on && had) {
    await enforce(env, STAR_CHANGES, user.id, now, waitUntil);
    await env.DB.batch([env.DB.prepare('DELETE FROM stars WHERE user_id = ? AND project_id = ?').bind(user.id, id), recount(env, id)]);
    return;
  }
  const row = await env.DB.prepare(`SELECT owner_id FROM projects WHERE id = ? AND ${PUBLIC}`).bind(id).first<{ owner_id: string }>();
  if (!row) throw notFound();
  if (row.owner_id === user.id) throw new HttpError('That is your own work', 400, 'bad_request', { reason: 'own' });
  if (!on || had) return;
  await enforce(env, STAR_CHANGES, user.id, now, waitUntil);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO stars (user_id, project_id, created_at)
       SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id <> ? AND ${PUBLIC})
       ON CONFLICT (user_id, project_id) DO NOTHING`,
    ).bind(user.id, id, now, id, user.id),
    recount(env, id),
  ]);
}

/** Whether a member starred a project (GET /api/me/stars/:id), whatever its state now. */
export async function isStarred(env: Env, userId: string, id: string): Promise<boolean> {
  if (!CURSOR_ID.test(id)) return false;
  return (await env.DB.prepare('SELECT 1 AS found FROM stars WHERE user_id = ? AND project_id = ?').bind(userId, id).first()) !== null;
}

/** Which of `ids` a member starred: one query, whatever the page's size. */
export async function starredAmong(env: Env, userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT project_id FROM stars WHERE user_id = ? AND project_id IN (${ids.map(() => '?').join(', ')})`,
  )
    .bind(userId, ...ids)
    .all<{ project_id: string }>();
  return new Set(results.map((r) => r.project_id));
}

/** A page of public cards with `starred` on each, for the member asking. */
export async function withStarred(env: Env, userId: string, page: Page<CommunityCard>): Promise<Page<CommunityCard>> {
  const starred = await starredAmong(env, userId, page.items.map((i) => i.id));
  return { items: page.items.map((i) => ({ ...i, starred: starred.has(i.id) })), next: page.next };
}

/**
 * A member's starred works (GET /api/me/stars): the most recently starred
 * first (then by id), after `after` (`<starred_at>.<id>`), as community
 * cards with `starred: true`. Only what is public now: a hidden or
 * withdrawn one drops out, its star kept until the project is deleted.
 */
export async function listStars(env: Env, userId: string, q: { after: Cursor<string> | null; limit: number }): Promise<Page<CommunityCard>> {
  const binds: unknown[] = [userId];
  let after = '';
  if (q.after) {
    after = 'AND (s.created_at < ? OR (s.created_at = ? AND p.id < ?))';
    binds.push(q.after.at, q.after.at, q.after.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS}, s.created_at AS starred_at
     FROM stars s JOIN projects p ON p.id = s.project_id JOIN users u ON u.id = p.owner_id
     WHERE s.user_id = ? AND p.shared = 'public' AND p.template = 0 AND u.status = 'active' ${after}
     ORDER BY s.created_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(...binds, q.limit + 1)
    .all<CardRow & { starred_at: number }>();
  const shown = results.slice(0, q.limit);
  const last = shown.at(-1);
  return {
    items: shown.map((r) => ({ ...publicCard(r, env), starred: true })),
    next: results.length > q.limit && last ? cursorOf(last.starred_at, last.id) : null,
  };
}

/**
 * What an account's deletion does to the stars it gave, in its final batch
 * before the account row goes: each project it starred one star fewer, and
 * its stars gone (the cascade would take them, but not the counts).
 */
export function unstarAll(env: Env, userId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('UPDATE projects SET stars = MAX(0, stars - 1) WHERE id IN (SELECT project_id FROM stars WHERE user_id = ?)').bind(userId),
    env.DB.prepare('DELETE FROM stars WHERE user_id = ?').bind(userId),
  ];
}
