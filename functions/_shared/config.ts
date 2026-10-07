import type { Env } from './env';
import { accountsOn, filesOrigin } from './env';

/** The terms Join asks a new account to accept; a change asks again (phase 2). */
export const TERMS_VERSION = '2026-10';

const MiB = 1024 * 1024;

/**
 * What a member may store (docs/accounts.md §4). The server holds members
 * to these; the client reads them from /api/config to refuse what would be
 * refused before sending it. Owner tools keep their own, larger caps.
 */
export const MEMBER_LIMITS = {
  /** A scene file. */
  sceneBytes: 100 * MiB,
  /** The part size an upload is asked to send... */
  partBytes: 8 * MiB,
  /** ...and the most a part may be. */
  partMaxBytes: 32 * MiB,
  frameBytes: 32 * MiB,
  thumbBytes: 1 * MiB,
  projects: 500,
  framesPerProject: 10_000,
  /** An account's storage, the users.quota_bytes default (the owner's is 10 GiB). */
  quotaBytes: 250 * MiB,
  passkeys: 10,
} as const;

/**
 * What the client needs to know of this deployment before it knows who is
 * using it: whether there are accounts at all, where passkeys work, the
 * Turnstile widget to show, where public files come from, the terms in
 * force, and the limits. Nothing in it is secret, and none of it depends
 * on who asks.
 */
export function publicConfig(env: Env) {
  return {
    accounts: accountsOn(env),
    rpId: env.RP_ID || null,
    // A widget whose tokens nothing can check would only be in the way.
    turnstileSiteKey: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY : null,
    // Where manifests name public files: the files host, once APP_ORIGIN
    // lets it answer the app's pages (filesOrigin), else null: /media here.
    mediaOrigin: filesOrigin(env),
    termsVersion: TERMS_VERSION,
    limits: MEMBER_LIMITS,
  };
}
