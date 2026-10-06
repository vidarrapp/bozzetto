/**
 * What a project or shelf id looks like wherever one goes into a URL: the
 * server's slugs (lower-case letters, digits, hyphens) and the shelf's own
 * ids, which are letters and digits. Anything else that arrives - from the
 * address bar above all - is refused rather than encoded: `?tl=../x`
 * encoded is still a path somewhere, and nothing legitimate needs one.
 */
export const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export function isProjectId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}
