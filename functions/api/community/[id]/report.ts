import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { answer, api, noContent, readBody, requireUser } from '../../../_shared/auth/api';
import { reportProject } from '../../../_shared/community';

// POST /api/community/:id/report {reason, note?} - a signed-in member
// reports a project in the community gallery (docs/accounts.md §13):
// `reason` one of nudity, minors, stolen, spam, other (400 reason reason),
// `note` up to 500 characters (400 reason note). 204 when made; 200
// {reported: true} when this member reported it before (nothing more is
// counted). Only of a project anyone can see now (404 not_found
// otherwise), never of one's own (400 reason own), 10 a day per account
// (429). The second member's open report hides it until a reviewer looks.
// Signed out: 401 signin. Audited with the reason, never the note.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const made = await reportProject(env, user, String(params.id), await readBody(request), data.now, waitUntil);
    return made === 'new' ? noContent() : answer({ reported: true });
  });
