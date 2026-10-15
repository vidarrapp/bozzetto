import type { Env } from './env';
import type { ProjectMode, ProjectRow, SharedState, UserRow } from './types';
import { auditStatement } from './auth/audit';
import { enforce, type Limit } from './auth/ratelimit';
import { randomId } from './crypto';
import { HttpError, json } from './http';
import { cursorOf, type Cursor } from './owner';
import { closeReports, getProjectRow, mediaBase } from './projects';

/**
 * The community gallery (docs/accounts.md §13): members share their own
 * model and timelapse projects, a reviewer (the owner or a moderator)
 * approves them, and anyone may then see them - view only, from the
 * member's own folder, on the member's quota, nothing copied.
 *
 * A project's `shared` state moves so:
 *
 * - none → pending: its member shares it (and rejected → pending, after a change);
 * - pending → public: a reviewer approves it; pending → rejected: a reviewer rejects it, with a reason;
 * - public → pending: any write of its member's to its content or title (projects.ts UNLIST);
 * - public → hidden: a reviewer hides it, with a reason, or a second member's open report lands;
 * - hidden → public: a reviewer unhides it;
 * - anything → none: its member withdraws it.
 *
 * The row's `updated_at` moves on every change of state, so every ?v= its
 * files were served under is retired with the old state.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The modes a member may share: what the viewer plays. A scene or an armature is not shared (publish a model of it). */
export const SHARE_MODES: readonly ProjectMode[] = ['model', 'timelapse'];
/** Shares sent for review, per account: 20 a day. */
export const SHARES: Limit = { name: 'share', max: 20, windowMs: DAY };
/** Reports made, per account: 10 a day. */
export const REPORTS: Limit = { name: 'report', max: 10, windowMs: DAY };
/** What a report may say a project is. */
export const REPORT_REASONS = ['nudity', 'minors', 'stolen', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** The longest note a report, or reason a review, may carry, in characters. */
export const MAX_NOTE = 500;
/** Distinct members' open reports that take a public project off the list until a reviewer looks. */
export const HIDE_AFTER = 2;
/** What the author is shown of a project the reports hid. */
export const REPORTED = 'Reported by members, awaiting review';
/** Who the audit log names for a hide the reports made. */
export const REPORTS_ACTOR = 'system:reports';
/** How far back the reviewers' history goes. */
export const HISTORY_DAYS = 30;
/** A page of the public lists, unless ?limit= asks for another size (1 to MAX_PAGE). */
export const PAGE = 24;
export const MAX_PAGE = 48;

const notFound = (): HttpError => new HttpError('Not found', 404, 'not_found');

/** 409 wrong_state: the project's place in the gallery does not allow that; where it stands comes with it. */
function wrongState(shared: SharedState, message = 'The project is not in a state that allows this'): HttpError {
  return new HttpError(message, 409, 'wrong_state', { shared });
}

/**
 * Text a person wrote for another to read (a report's note, a review's
 * reason): control characters and runs of spaces made one space, trimmed,
 * and at most MAX_NOTE characters, else 400 bad_request {reason: name}.
 * `required` refuses none at all the same way.
 */
export function cleanText(raw: unknown, name: string, required: boolean): string {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    throw new HttpError(`${name}: expected text`, 400, 'bad_request', { reason: name });
  }
  // eslint-disable-next-line no-control-regex
  const text = (raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const length = [...text].length;
  if ((required && length < 1) || length > MAX_NOTE) {
    throw new HttpError(`${name}: ${required ? 1 : 0} to ${MAX_NOTE} characters`, 400, 'bad_request', { reason: name });
  }
  return text;
}

// --- the public lists -------------------------------------------------------------------

/** One card of the community gallery. */
export interface CommunityCard {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  shared_at: number;
  author: { handle: string };
  /** The thumbnail at the project's current version. */
  thumb: string;
  /** Where its files are read from: the open routes, as a template's. */
  media: string;
}

interface CardRow {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  shared_at: number;
  updated_at: number;
  handle: string;
}

/** A row as a card, its files under `media`. */
const card = (r: CardRow, media: string): CommunityCard => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  fps: r.fps,
  shared_at: r.shared_at,
  author: { handle: r.handle },
  thumb: `${media}/thumb.jpg?v=${r.updated_at}`,
  media,
});

/** ?limit=: a whole number from 1 to `max`, `page` when absent; anything else is 400 bad_request {reason: 'limit'}. */
export function listLimit(params: URLSearchParams, page = PAGE, max = MAX_PAGE): number {
  const raw = params.get('limit');
  if (raw === null || raw === '') return page;
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= max)) throw new HttpError(`limit: a whole number from 1 to ${max}`, 400, 'bad_request', { reason: 'limit' });
  return n;
}

/** A page of a list and where the next begins (`<shared_at>.<id>`), null at the end. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

/** A project id as a list's cursor names it. */
export const CURSOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A public list as it is answered: anyone's to see, kept a minute by the
 * browser and any cache between - a project hidden or withdrawn meanwhile
 * may stay on a kept page that long, while its files stop at once.
 */
export function communityAnswer<T>(page: Page<T>, extra: Record<string, unknown> = {}): Response {
  return json({ ...extra, items: page.items, next: page.next }, 200, { 'cache-control': 'public, max-age=60' });
}

/**
 * The community gallery, newest approval first (shared_at, then id), after
 * `after` - or one member's part of it, with `author`. Only what anyone may
 * see: approved, not a template, its author's account active.
 */
export async function listCommunity(
  env: Env,
  q: { after: Cursor<string> | null; limit: number; author?: string },
): Promise<Page<CommunityCard>> {
  const where = ["p.shared = 'public'", 'p.template = 0', "u.status = 'active'"];
  const binds: unknown[] = [];
  if (q.author) {
    where.push('p.owner_id = ?');
    binds.push(q.author);
  }
  if (q.after) {
    where.push('(p.shared_at < ? OR (p.shared_at = ? AND p.id < ?))');
    binds.push(q.after.at, q.after.at, q.after.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.mode, p.fps, p.shared_at, p.updated_at, u.handle
     FROM projects p JOIN users u ON u.id = p.owner_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.shared_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(...binds, q.limit + 1)
    .all<CardRow>();
  const shown = results.slice(0, q.limit);
  const items = shown.map((r) => card(r, mediaBase({ id: r.id, template: 0, visibility: 'private', shared: 'public' }, env)));
  const last = shown.at(-1);
  return { items, next: results.length > q.limit && last ? cursorOf(last.shared_at, last.id) : null };
}

/** An active account by its handle, in any capitals: whose author page it is. Null for none. */
export function findAuthor(env: Env, handle: string): Promise<{ id: string; handle: string } | null> {
  return env.DB.prepare("SELECT id, handle FROM users WHERE handle = ? AND status = 'active'")
    .bind(handle)
    .first<{ id: string; handle: string }>();
}

/** The handle of a project's author, for the manifest's byline. */
export async function authorOf(env: Env, row: Pick<ProjectRow, 'owner_id'>): Promise<{ handle: string } | null> {
  if (!row.owner_id) return null;
  const u = await env.DB.prepare('SELECT handle FROM users WHERE id = ?').bind(row.owner_id).first<{ handle: string }>();
  return u ? { handle: u.handle } : null;
}

// --- the member's side --------------------------------------------------------------------

/**
 * Share an account's own project to the community gallery, or withdraw it
 * (POST /api/me/projects/:id/share {shared}). Sharing sends it for review
 * (pending) from none or rejected: a model or timelapse only (400 reason
 * mode), at most SHARES a day (429), audited `project.share`. Asking to
 * share what is pending or public already changes nothing; a hidden one is
 * 409 wrong_state, under review until a reviewer acts or the member
 * withdraws it. Withdrawing takes it out at once, from any state, and
 * closes what members reported of it ('removed'), audited
 * `project.withdraw`; withdrawing what is not shared changes nothing.
 * Another's project, or a template, is 404, as everywhere on /api/me.
 */
export async function setShared(
  env: Env,
  user: UserRow,
  id: string,
  on: boolean,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<ProjectRow> {
  const row = await getProjectRow(env, id, { member: user.id });
  if (!row) throw notFound();
  if (row.template === 1) throw wrongState(row.shared, 'A template is not shared');
  if (on) {
    if (!SHARE_MODES.includes(row.mode)) {
      throw new HttpError('Only a model or a timelapse can be shared', 400, 'bad_request', { reason: 'mode' });
    }
    if (row.shared === 'pending' || row.shared === 'public') return row;
    if (row.shared === 'hidden') throw wrongState(row.shared, 'It is hidden and under review');
    await enforce(env, SHARES, user.id, now, waitUntil);
    const done = { sql: "SELECT 1 FROM projects WHERE id = ? AND shared = 'pending' AND updated_at = ?", binds: [id, now] };
    const [changed] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE projects SET shared = 'pending', shared_at = ?, review_reason = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND template = 0 AND shared IN ('none', 'rejected') AND mode IN ('model', 'timelapse')`,
      ).bind(now, now, id, user.id),
      auditStatement(env, { actor: user.id, at: now, action: 'project.share', subject: id, detail: { from: row.shared } }, done),
    ]);
    return settled(env, user, id, changed.meta.changes > 0, (s) => s === 'pending' || s === 'public');
  }
  if (row.shared === 'none') return row;
  const done = { sql: "SELECT 1 FROM projects WHERE id = ? AND shared = 'none' AND updated_at = ?", binds: [id, now] };
  const [changed] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE projects SET shared = 'none', shared_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND shared <> 'none'`,
    ).bind(now, id, user.id),
    closeReports(env, id, now, user.id, done.sql, done.binds),
    auditStatement(env, { actor: user.id, at: now, action: 'project.withdraw', subject: id, detail: { from: row.shared } }, done),
  ]);
  return settled(env, user, id, changed.meta.changes > 0, (s) => s === 'none');
}

/** The row after a change; if the change found nothing to do, it is fine only if what was asked holds anyway. */
async function settled(env: Env, user: UserRow, id: string, changed: boolean, holds: (s: SharedState) => boolean): Promise<ProjectRow> {
  const after = await getProjectRow(env, id, { member: user.id });
  if (!after) throw notFound();
  if (!changed && !holds(after.shared)) throw wrongState(after.shared, 'The project changed meanwhile; try again');
  return after;
}

/**
 * A member's report of a project in the community gallery (POST
 * /api/community/:id/report {reason, note}): `reason` one of
 * REPORT_REASONS, `note` up to 500 characters. Only of a project anyone
 * can see now (404 otherwise, hidden ones included), never of one's own
 * (400 reason own), once per member and project ('again', which the route
 * answers 200, counting nothing), REPORTS a day (429). Audited
 * `project.report` with the reason, never the note. When the report makes
 * HIDE_AFTER distinct members' open reports, the project is hidden in the
 * same batch, its author shown REPORTED, audited as a review the reports
 * made (REPORTS_ACTOR).
 */
export async function reportProject(
  env: Env,
  user: UserRow,
  id: string,
  body: Record<string, unknown>,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<'new' | 'again'> {
  const reason = body.reason;
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new HttpError(`reason: one of ${REPORT_REASONS.join(', ')}`, 400, 'bad_request', { reason: 'reason' });
  }
  const note = cleanText(body.note, 'note', false);
  const row = await env.DB.prepare(
    `SELECT id, owner_id FROM projects
     WHERE id = ? AND shared = 'public' AND template = 0 AND owner_id IN (SELECT id FROM users WHERE status = 'active')`,
  )
    .bind(id)
    .first<{ id: string; owner_id: string }>();
  if (!row) throw notFound();
  if (row.owner_id === user.id) throw new HttpError('That is your own project', 400, 'bad_request', { reason: 'own' });
  const before = await env.DB.prepare('SELECT 1 AS found FROM reports WHERE project_id = ? AND reporter_id = ?').bind(id, user.id).first();
  if (before) return 'again';
  await enforce(env, REPORTS, user.id, now, waitUntil);
  const rid = randomId('r');
  const hidden = {
    sql: "SELECT 1 FROM projects WHERE id = ? AND shared = 'hidden' AND updated_at = ? AND review_reason = ?",
    binds: [id, now, REPORTED],
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reports (id, project_id, reporter_id, reason, note, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND shared = 'public')
       ON CONFLICT (project_id, reporter_id) DO NOTHING`,
    ).bind(rid, id, user.id, reason, note, now, id),
    auditStatement(env, { actor: user.id, at: now, action: 'project.report', subject: id, detail: { reason } }, {
      sql: 'SELECT 1 FROM reports WHERE id = ?',
      binds: [rid],
    }),
    env.DB.prepare(
      `UPDATE projects SET shared = 'hidden', review_reason = ?, updated_at = ?
       WHERE id = ? AND shared = 'public'
         AND (SELECT COUNT(DISTINCT reporter_id) FROM reports WHERE project_id = ? AND resolved_at IS NULL) >= ?`,
    ).bind(REPORTED, now, id, id, HIDE_AFTER),
    auditStatement(
      env,
      { actor: REPORTS_ACTOR, at: now, action: 'project.review', subject: id, detail: { action: 'hide', from: 'public', to: 'hidden', reason: 'reports' } },
      hidden,
    ),
  ]);
  return 'new';
}

// --- the reviewers' side ------------------------------------------------------------------

/** Where a reviewer reads a shared project's files: private, on the session, kept nowhere. */
export const reviewMediaBase = (id: string): string => `/api/mod/media/${encodeURIComponent(id)}`;

/** What the Review chip counts: projects waiting for review, and projects with open reports. */
export async function reviewCounts(env: Env): Promise<{ pending: number; reports: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM projects WHERE shared = 'pending' AND template = 0) AS pending,
            (SELECT COUNT(DISTINCT project_id) FROM reports WHERE resolved_at IS NULL) AS reports`,
  ).first<{ pending: number; reports: number }>();
  return { pending: row?.pending ?? 0, reports: row?.reports ?? 0 };
}

/** One card of the reviewers' lists. */
export interface ReviewCard {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  shared: SharedState;
  shared_at: number | null;
  updated_at: number;
  review_reason: string | null;
  author: { handle: string } | null;
  /** Open reports of it. */
  reports: number;
  thumb: string;
  media: string;
}

interface ReviewRow {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  shared: SharedState;
  shared_at: number | null;
  updated_at: number;
  review_reason: string | null;
  handle: string | null;
  reports: number;
}

const reviewCard = (r: ReviewRow): ReviewCard => {
  const media = reviewMediaBase(r.id);
  return {
    id: r.id,
    title: r.title,
    mode: r.mode,
    fps: r.fps,
    shared: r.shared,
    shared_at: r.shared_at,
    updated_at: r.updated_at,
    review_reason: r.review_reason,
    author: r.handle === null ? null : { handle: r.handle },
    reports: r.reports,
    thumb: `${media}/thumb.jpg?v=${r.updated_at}`,
    media,
  };
};

const REVIEW_COLUMNS = `p.id, p.title, p.mode, p.fps, p.shared, p.shared_at, p.updated_at, p.review_reason, u.handle,
  (SELECT COUNT(*) FROM reports r WHERE r.project_id = p.id AND r.resolved_at IS NULL) AS reports`;

/** The review queue: projects waiting for review, oldest first (shared_at, then id), after `after`. */
export async function reviewQueue(env: Env, q: { after: Cursor<string> | null; limit: number }): Promise<Page<ReviewCard>> {
  const binds: unknown[] = [];
  let after = '';
  if (q.after) {
    after = 'AND (p.shared_at > ? OR (p.shared_at = ? AND p.id > ?))';
    binds.push(q.after.at, q.after.at, q.after.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT ${REVIEW_COLUMNS} FROM projects p LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.shared = 'pending' AND p.template = 0 ${after}
     ORDER BY p.shared_at, p.id LIMIT ?`,
  )
    .bind(...binds, q.limit + 1)
    .all<ReviewRow>();
  const shown = results.slice(0, q.limit);
  const last = shown.at(-1);
  return { items: shown.map(reviewCard), next: results.length > q.limit && last ? cursorOf(last.shared_at ?? 0, last.id) : null };
}

/** The open reports there are, at most this many. */
const MAX_OPEN_REPORTS = 500;

/** One project with open reports, as the Reports tab lists it. */
export interface ReportedProject {
  project: ReviewCard;
  reports: { id: string; reason: ReportReason; note: string; reporter: { handle: string }; created_at: number }[];
}

/**
 * The projects with open reports, the longest-reported first: each with
 * its open reports, oldest first - reason, note, who made it (by handle)
 * and when.
 */
export async function openReports(env: Env): Promise<ReportedProject[]> {
  const [{ results: reports }, { results: projects }] = (await env.DB.batch([
    env.DB.prepare(
      `SELECT r.id, r.project_id, r.reason, r.note, r.created_at, u.handle AS reporter
       FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.resolved_at IS NULL ORDER BY r.created_at, r.id LIMIT ?`,
    ).bind(MAX_OPEN_REPORTS),
    env.DB.prepare(
      `SELECT ${REVIEW_COLUMNS} FROM projects p LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.id IN (SELECT project_id FROM reports WHERE resolved_at IS NULL)`,
    ),
  ])) as [D1Result<{ id: string; project_id: string; reason: ReportReason; note: string; created_at: number; reporter: string }>, D1Result<ReviewRow>];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out = new Map<string, ReportedProject>();
  for (const r of reports) {
    const p = byId.get(r.project_id);
    if (!p) continue;
    let entry = out.get(p.id);
    if (!entry) {
      entry = { project: reviewCard(p), reports: [] };
      out.set(p.id, entry);
    }
    entry.reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: { handle: r.reporter }, created_at: r.created_at });
  }
  return [...out.values()];
}

/** One line of the reviewers' history. */
export interface HistoryItem {
  at: number;
  /** approve, reject, hide, unhide, dismiss or withdraw. */
  action: string;
  /** Who did it, by handle: the reviewer, or the member who withdrew it; null for a hide the reports made, or an account since deleted. */
  actor: { handle: string } | null;
  /** A hide the reports made, not a reviewer. */
  auto: boolean;
  /** What the project is now, while it is there; null once deleted. */
  project: { id: string; title: string; shared: SharedState; author: { handle: string } | null } | null;
  subject: string;
  /** The reason the author was shown, while this is still the project's latest review. */
  reason: string | null;
}

/**
 * The reviews and withdrawals of the last HISTORY_DAYS, newest first, from
 * the audit log: who did what to which project, and, where the project is
 * still there, what it is now. A reason is free text, so the log does not
 * keep it (§13); it is shown from the project's row while that row's
 * latest review is this one.
 */
export async function reviewHistory(env: Env, now: number, limit = 200): Promise<HistoryItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.at, a.actor, a.action, a.subject, a.detail, ua.handle AS actor_handle,
            p.id AS pid, p.title, p.shared, p.reviewed_at, p.review_reason, up.handle AS author
     FROM audit_log a
     LEFT JOIN users ua ON ua.id = a.actor
     LEFT JOIN projects p ON p.id = a.subject
     LEFT JOIN users up ON up.id = p.owner_id
     WHERE a.action IN ('project.review', 'project.withdraw') AND a.at >= ?
     ORDER BY a.at DESC, a.id DESC LIMIT ?`,
  )
    .bind(now - HISTORY_DAYS * DAY, limit)
    .all<{
      at: number;
      actor: string;
      action: string;
      subject: string;
      detail: string;
      actor_handle: string | null;
      pid: string | null;
      title: string | null;
      shared: SharedState | null;
      reviewed_at: number | null;
      review_reason: string | null;
      author: string | null;
    }>();
  return results.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail) as Record<string, unknown>;
    } catch {
      /* a row this did not write */
    }
    const action = r.action === 'project.withdraw' ? 'withdraw' : String(detail.action ?? 'review');
    const auto = r.actor === REPORTS_ACTOR;
    const latest = r.pid !== null && r.reviewed_at === r.at && (action === 'reject' || action === 'hide');
    return {
      at: r.at,
      action,
      actor: r.actor_handle === null ? null : { handle: r.actor_handle },
      auto,
      project: r.pid === null ? null : { id: r.pid, title: r.title ?? '', shared: r.shared ?? 'none', author: r.author === null ? null : { handle: r.author } },
      subject: r.subject,
      reason: auto ? REPORTED : latest ? r.review_reason : null,
    };
  });
}

/** A review: what it does, from which states, to which, and what becomes of the open reports. */
interface Transition {
  from: readonly SharedState[];
  to: SharedState | null;
  reason: boolean;
  reports: 'dismissed' | 'hidden' | 'removed' | null;
}

export const REVIEW_ACTIONS: Record<string, Transition> = {
  approve: { from: ['pending'], to: 'public', reason: false, reports: null },
  reject: { from: ['pending'], to: 'rejected', reason: true, reports: 'removed' },
  hide: { from: ['public'], to: 'hidden', reason: true, reports: 'hidden' },
  unhide: { from: ['hidden'], to: 'public', reason: false, reports: 'dismissed' },
  // The reports were unfounded: closed, and the project stays as it is.
  dismiss: { from: ['pending', 'public'], to: null, reason: false, reports: 'dismissed' },
};

/**
 * A reviewer's decision on a shared project (POST
 * /api/mod/projects/:id/review {action, reason?}), audited
 * `project.review` with the action and the states, not the reason:
 *
 * - approve: pending → public, listed from now (shared_at), the reason cleared;
 * - reject {reason}: pending → rejected, the author shown the reason; open reports removed;
 * - hide {reason}: public → hidden, the author shown the reason; open reports closed as hidden;
 * - unhide: hidden → public, its place in the list kept; open reports dismissed;
 * - dismiss: pending or public with open reports: the reports dismissed, nothing else.
 *
 * A reason is 1 to 500 characters (400 reason reason). An action the
 * project's state does not allow is 409 wrong_state {shared}; one on the
 * reviewer's own project 400 reason own; a project not shared, or not
 * there, 404. The row's updated_at moves on every change of state.
 */
export async function reviewProject(env: Env, by: UserRow, id: string, body: Record<string, unknown>, now: number): Promise<ProjectRow> {
  const name = typeof body.action === 'string' ? body.action : '';
  const t = Object.hasOwn(REVIEW_ACTIONS, name) ? REVIEW_ACTIONS[name] : undefined;
  if (!t) {
    throw new HttpError(`action: one of ${Object.keys(REVIEW_ACTIONS).join(', ')}`, 400, 'bad_request', { reason: 'action' });
  }
  const reason = t.reason ? cleanText(body.reason, 'reason', true) : null;
  const row = await getProjectRow(env, id, { reviewer: true });
  if (!row) throw notFound();
  if (row.owner_id === by.id) {
    throw new HttpError('Another reviewer decides on your own projects', 400, 'bad_request', { reason: 'own' });
  }
  if (!t.from.includes(row.shared)) throw wrongState(row.shared);
  const open = 'SELECT 1 FROM reports WHERE project_id = ? AND resolved_at IS NULL';
  if (name === 'dismiss' && !(await env.DB.prepare(open).bind(id).first())) {
    throw new HttpError('There are no open reports of it', 409, 'wrong_state', { shared: row.shared, reports: 0 });
  }
  const to = t.to ?? row.shared;
  const done = {
    sql: 'SELECT 1 FROM projects WHERE id = ? AND shared = ? AND reviewed_at = ? AND reviewed_by = ?',
    binds: [id, to, now, by.id],
  };
  const statements: D1PreparedStatement[] = [];
  if (t.to) {
    statements.push(
      env.DB.prepare(
        `UPDATE projects SET shared = ?, shared_at = CASE WHEN ? THEN ? ELSE shared_at END, review_reason = ?,
                reviewed_at = ?, reviewed_by = ?, updated_at = ?
         WHERE id = ? AND template = 0 AND shared = ?`,
      ).bind(t.to, name === 'approve' ? 1 : 0, now, reason, now, by.id, now, id, row.shared),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE projects SET reviewed_at = ?, reviewed_by = ?
         WHERE id = ? AND template = 0 AND shared = ? AND EXISTS (${open})`,
      ).bind(now, by.id, id, row.shared, id),
    );
  }
  if (t.reports) statements.push(closeReports(env, id, now, by.id, done.sql, done.binds, t.reports));
  statements.push(
    auditStatement(env, { actor: by.id, at: now, action: 'project.review', subject: id, detail: { action: name, from: row.shared, to } }, done),
  );
  const [changed] = await env.DB.batch(statements);
  const after = await getProjectRow(env, id, { reviewer: true });
  if (!after) throw notFound();
  if (!changed.meta.changes) throw wrongState(after.shared, 'The project changed meanwhile; look again');
  return after;
}
