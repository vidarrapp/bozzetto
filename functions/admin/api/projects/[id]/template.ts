import type { Env } from '../../../../_shared/env';
import { bodyLimit, error, handle, json, readJson } from '../../../../_shared/http';
import { ownerActor, ownerScope, requireAdmin, type RequestData } from '../../../../_shared/principal';
import { setTemplate, toOwnerRow } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/template {template: boolean} — the Template
// switch on the Projects page (docs/accounts.md §5), Access-gated. On, the
// project becomes the site's, belonging to no one, its bytes off its
// owner's usage; Public/Private then says whether the gallery lists it.
// Off, it is the owner's again, and private. Each switch is audited, with
// the Access identity as the actor. Answers the row as PUT does.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const tooBig = bodyLimit(request, 1024);
    if (tooBig) return tooBig;
    const { template } = await readJson(request);
    if (typeof template !== 'boolean') return error('template: expected true or false', 400);
    const row = await setTemplate(env, String(params.id), template, ownerScope(data.principal), ownerActor(data));
    return json(toOwnerRow(row, env));
  });
