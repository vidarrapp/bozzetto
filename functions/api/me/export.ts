import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import type { CredentialRow, ProjectRow, SessionRow } from '../../_shared/types';
import { json } from '../../_shared/http';
import { api, requireRecentAuth } from '../../_shared/auth/api';
import { listSizes } from '../../_shared/quota';
import { PROJECT_FILE, SCENE_FILE, THUMB_FILE, frameFile, memberMediaBase, prefixFor } from '../../_shared/projects';

// GET /api/me/export - everything the site keeps of the account, as
// `bozzetto-export/1` JSON (docs/accounts.md §3), for the client to zip
// with the files it names: one file per request, so no request here reads
// one. It needs recent authentication (401 reauth). Never cached.
//
//   {format: 'bozzetto-export/1', exportedAt, complete,
//    account: {id, handle, email, role, status, createdAt, updatedAt, handleChangedAt,
//              termsVersion, termsAcceptedAt, ageConfirmedAt, usage: {used, reserved, quota}},
//    passkeys: [{name, createdAt, lastUsedAt, deviceType, backedUp, aaguid}],
//    sessions: [{id, client, userAgent, method, createdAt, lastSeenAt, expiresAt, revokedAt, current}],
//    projects: [{id, title, mode, fps, visibility, createdAt, updatedAt, bytes, data,
//                files: [{name, size, url}]}],
//    audit: [{at, actor, action, subject, detail}]}
//
// `files` are what R2 holds under the project, listed: `name` under the
// project (scene.bozz, thumb.jpg, frames/sd/0000.glb), `size` in bytes,
// `url` the private route with ?download=1. The listings are bounded by
// what one request may ask of R2; an account past that (tens of thousands
// of files) gets `complete: false`, and the projects not listed name their
// files from their data instead, with `size: null`. `audit` holds the rows
// about the account and those it acted in, oldest first.

/** R2 listings one export makes, at the most: a thousand files each. */
const LISTINGS = 40;

export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    const { user, session } = requireRecentAuth(data.principal);
    const [passkeys, sessions, projects, audit, usage] = await env.DB.batch([
      env.DB.prepare(
        'SELECT name, created_at, last_used_at, device_type, backed_up, aaguid FROM credentials WHERE user_id = ? ORDER BY created_at, id',
      ).bind(user.id),
      env.DB.prepare(
        `SELECT id, client, user_agent, method, created_at, last_seen_at, expires_at, revoked_at
         FROM sessions WHERE user_id = ? ORDER BY created_at, id`,
      ).bind(user.id),
      env.DB.prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at, id').bind(user.id),
      env.DB.prepare('SELECT at, actor, action, subject, detail FROM audit_log WHERE subject = ?1 OR actor = ?1 ORDER BY id').bind(
        user.id,
      ),
      env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS reserved FROM upload_parts WHERE user_id = ?').bind(user.id),
    ]);
    const rows = (projects.results ?? []) as ProjectRow[];
    const files = await filesOf(env, user.id, rows);
    const body = {
      format: 'bozzetto-export/1',
      exportedAt: data.now,
      complete: rows.every((r) => files.has(r.id)),
      account: {
        id: user.id,
        handle: user.handle,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        handleChangedAt: user.handle_changed_at,
        termsVersion: user.terms_version,
        termsAcceptedAt: user.terms_accepted_at,
        ageConfirmedAt: user.age_confirmed_at,
        usage: {
          used: user.bytes_used,
          reserved: ((usage.results ?? [])[0] as { reserved: number } | undefined)?.reserved ?? 0,
          quota: user.quota_bytes,
        },
      },
      passkeys: ((passkeys.results ?? []) as Pick<CredentialRow, 'name' | 'created_at' | 'last_used_at' | 'device_type' | 'backed_up' | 'aaguid'>[]).map(
        (k) => ({
          name: k.name,
          createdAt: k.created_at,
          lastUsedAt: k.last_used_at,
          deviceType: k.device_type,
          backedUp: k.backed_up === 1,
          aaguid: k.aaguid,
        }),
      ),
      sessions: ((sessions.results ?? []) as Omit<SessionRow, 'token_hash' | 'user_id' | 'reauth_at'>[]).map((s) => ({
        id: s.id,
        client: s.client,
        userAgent: s.user_agent,
        method: s.method,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        revokedAt: s.revoked_at,
        current: s.id === session.id,
      })),
      projects: rows.map((r) => ({
        id: r.id,
        title: r.title,
        mode: r.mode,
        fps: r.fps,
        visibility: r.visibility,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        bytes: r.bytes,
        data: parse(r.data),
        files: (files.get(r.id) ?? fromData(r)).map((f) => ({ ...f, url: `${memberMediaBase(r.id)}/${f.name}?download=1` })),
      })),
      audit: ((audit.results ?? []) as { at: number; actor: string; action: string; subject: string | null; detail: string }[]).map((a) => ({
        ...a,
        detail: parse(a.detail),
      })),
    };
    return json(body, 200, {
      'cache-control': 'private, no-store',
      'content-disposition': 'attachment; filename="bozzetto-export.json"',
    });
  });

type FileEntry = { name: string; size: number | null };

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The files a name under a project may be (PROJECT_FILE's set), in the order the zip wants them. */
const order = (name: string): string => (name === SCENE_FILE ? '0' : name === THUMB_FILE ? '1' : `2${name}`);

/**
 * Each project's files, as R2 lists them, by project id: one listing of
 * the account's folder for the projects under it, one each for any kept
 * elsewhere (the owner's from before 0.6), while LISTINGS lasts. A project
 * not reached is missing from the map.
 */
async function filesOf(env: Env, userId: string, rows: ProjectRow[]): Promise<Map<string, FileEntry[]>> {
  const out = new Map<string, FileEntry[]>();
  const home = `users/${userId}/projects/`;
  const byPrefix = new Map(rows.map((r) => [prefixFor(r), r.id]));
  const add = (sizes: Map<string, number>, prefix: string, id: string) => {
    const list: FileEntry[] = [];
    for (const [key, size] of sizes) {
      // What the private route serves, and nothing else that may be there.
      const name = key.slice(prefix.length);
      if (key.startsWith(prefix) && PROJECT_FILE.test(name)) list.push({ name, size });
    }
    out.set(id, list.sort((a, b) => order(a.name).localeCompare(order(b.name))));
  };
  let calls = 0;
  if (rows.some((r) => prefixFor(r).startsWith(home))) {
    const listed = await listSizes(env, home, LISTINGS);
    calls = listed.calls;
    if (listed.complete) {
      // Grouped by folder in one pass, as the recount does.
      const folders = new Map<string, Map<string, number>>();
      for (const [key, size] of listed.sizes) {
        const folder = `${home}${key.slice(home.length).split('/')[0]}/`;
        if (!folders.has(folder)) folders.set(folder, new Map());
        folders.get(folder)!.set(key, size);
      }
      for (const [prefix, id] of byPrefix) if (prefix.startsWith(home)) add(folders.get(prefix) ?? new Map(), prefix, id);
    }
  }
  for (const [prefix, id] of byPrefix) {
    if (out.has(id) || prefix.startsWith(home)) continue;
    if (calls >= LISTINGS) break;
    const listed = await listSizes(env, prefix, LISTINGS - calls);
    calls += listed.calls;
    if (listed.complete) add(listed.sizes, prefix, id);
  }
  return out;
}

/** A project's files as its data names them, for one the listings did not reach: sizes unknown but a scene's. */
function fromData(row: ProjectRow): FileEntry[] {
  const data = parse(row.data) as { scene?: { bytes?: number }; frames?: { index: number }[] } | null;
  const out: FileEntry[] = [];
  if (data?.scene) out.push({ name: SCENE_FILE, size: data.scene.bytes ?? null });
  out.push({ name: THUMB_FILE, size: null });
  for (const f of data?.frames ?? []) out.push({ name: frameFile(f.index), size: null });
  return out;
}
