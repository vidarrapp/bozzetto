// A stand-in for Turnstile's siteverify (docs/accounts.md §10), on
// node:http, which the harness names as TURNSTILE_VERIFY_URL (honoured on
// a loopback host only). It answers by the token it is handed, as the real
// one answers by what the widget did:
//
//   pass:<action>          success, for APP_ORIGIN's host name and <action>:
//                          a token from a widget rendered with that action
//                          (siteverify names the widget's action, which a
//                          fake can only learn from the token)
//   pass-other-action      success, for the right host but another action
//   pass-other-host:<a>    success, for <a> but another host name
//   down                   500, as an outage would
//   error:<code>           failure with that error code (internal-error,
//                          invalid-input-secret, timeout-or-duplicate...)
//   anything else          failure: invalid-input-response
//
// A secret other than the harness's is refused (invalid-input-secret), as
// Cloudflare refuses one. Every request is kept, form and all, so a suite
// can see what the server sent: secret, response, remoteip, idempotency_key.
import { createServer } from 'node:http';

/** The secret the harness gives the servers (TURNSTILE_SECRET). */
export const TURNSTILE_SECRET = 'test';
/** A passing token for an action: what a widget rendered with it would hand over. */
export const pass = (action) => `pass:${action}`;

export function startTurnstileFake({ hostname = 'localhost', secret = TURNSTILE_SECRET } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
      let form = {};
      try {
        form = type === 'application/json' ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      } catch {
        /* a body that does not parse fails below, as a bad request */
      }
      requests.push({ method: req.method, path: req.url, type, ...form });
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const fail = (code) => send(200, { success: false, 'error-codes': [code], messages: [] });
      const ok = (extra) =>
        send(200, {
          success: true,
          challenge_ts: new Date().toISOString(),
          hostname,
          'error-codes': [],
          action: '',
          cdata: '',
          metadata: { ephemeral_id: 'x:fake' },
          ...extra,
        });
      const token = String(form.response ?? '');
      if (req.method !== 'POST') return send(405, { success: false, 'error-codes': ['bad-request'] });
      if (token === 'down') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('siteverify is down');
        return;
      }
      if (form.secret !== secret) return fail('invalid-input-secret');
      if (token.startsWith('pass:')) return ok({ action: token.slice('pass:'.length) });
      if (token === 'pass-other-action') return ok({ action: 'other-action' });
      if (token.startsWith('pass-other-host:')) return ok({ hostname: 'elsewhere.example', action: token.slice('pass-other-host:'.length) });
      if (token.startsWith('error:')) return fail(token.slice('error:'.length));
      return fail('invalid-input-response');
    });
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        url: `http://127.0.0.1:${port}/turnstile/v0/siteverify`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
