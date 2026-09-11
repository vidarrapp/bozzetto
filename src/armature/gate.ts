/**
 * The Armature mode is the owner's for now (owner call: shipped on main,
 * shown only when signed in). The test build opens it to everyone so the
 * suites can reach it without a backend, and pretends to be a guest when
 * the address says ?guest=1, so the gate itself can be tested.
 */
export function armatureAllowed(admin: string | null): boolean {
  if (admin) return true;
  if (import.meta.env.MODE !== 'test') return false;
  return !new URLSearchParams(window.location.search).has('guest');
}
