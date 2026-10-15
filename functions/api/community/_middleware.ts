import { accountsGate } from '../../_shared/auth/gate';

// /api/community and /api/community/* - the community gallery
// (docs/accounts.md §13): members' work, so not there while accounts are
// off (404 accounts_off), as /api/me is not. What a route says about
// caching stands (the public lists are kept a minute); anything else is
// no-store.
export const onRequest = accountsGate;
