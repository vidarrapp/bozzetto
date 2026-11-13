/**
 * Where File > Close goes: back to the page the person came from.
 *
 * The page that opens the viewer, Sculpt, Armature or Present names itself
 * in the address as `from=`, as review mode already names the Review tab
 * it was opened from: `community`, `me`, `owner`, or `u:<handle>` for a
 * member's page. Nothing in the address (a shared link, a bookmark, a typed
 * address) is the gallery. document.referrer is not read: it is empty or
 * wrong on an installed app, after a reload and behind a redirect.
 *
 * Review mode keeps its own rule (`from=` is a Review tab there,
 * ui/community/reviewActions) and is not read here.
 */

export interface Origin {
  /** Where Close goes. */
  href: string;
  /** The Close item's hint line. */
  hint: string;
  /** The `from=` value that names it ('' for the gallery). */
  from: string;
}

const GALLERY: Origin = { href: '/', hint: 'Back to the gallery', from: '' };
const HANDLE = /^[A-Za-z0-9_.-]{1,40}$/;

/** The origin an address names (the current one by default). */
export function originOf(search: string = window.location.search): Origin {
  const raw = new URLSearchParams(search).get('from') ?? '';
  return originFromValue(raw);
}

export function originFromValue(raw: string): Origin {
  if (raw === 'community') return { href: '/?community', hint: 'Back to Community', from: raw };
  if (raw === 'me') return { href: '/?me', hint: 'Back to My projects', from: raw };
  if (raw === 'owner') return { href: '/admin/', hint: 'Back to Owner tools', from: raw };
  if (raw.startsWith('u:') && HANDLE.test(raw.slice(2))) {
    return { href: `/?u=${encodeURIComponent(raw.slice(2))}`, hint: 'Back to Community', from: raw };
  }
  return GALLERY;
}

/** An address with the origin added, for a link to a page that closes back here. */
export function withFrom(href: string, from: string): string {
  if (!from) return href;
  return `${href}${href.includes('?') ? '&' : '?'}from=${encodeURIComponent(from)}`;
}

/** The origin of the page the viewer was opened from, for the links it makes (Edit in Present keeps it). */
export const currentFrom = (): string => originOf().from;
