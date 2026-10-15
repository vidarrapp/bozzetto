import { refuse } from '../../_shared/http';

// /api/mod/* - any path the reviewers' routes do not have, or a method a
// route does not answer: 404 not_found, as under /api/me.
export const onRequest: PagesFunction = () => Promise.resolve(refuse(404, 'not_found', 'Not found'));
