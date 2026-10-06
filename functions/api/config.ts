import type { Env } from '../_shared/env';
import { publicConfig } from '../_shared/config';
import { json } from '../_shared/http';

// GET /api/config — what this deployment is: accounts on or off, the
// passkey RP ID, the Turnstile site key, the files host, the terms version
// and the member limits. Public and the same for everyone, so a browser
// may reuse it for a minute; a flag switched on reaches clients within one.
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  json(publicConfig(env), 200, { 'cache-control': 'public, max-age=60' });
