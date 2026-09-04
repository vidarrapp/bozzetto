import { isDesktop } from '../net/origin';

/**
 * Desktop downloads for the Install card.
 *
 * The installers live on GitHub Releases, not here: they are 150-450 MB
 * and Cloudflare Pages caps a file at around 25 MB, so the site could not
 * serve them even if it should. GitHub also carries the bandwidth.
 *
 * The asset list is fetched rather than hard-coded because every release
 * puts its version in the filename - Bozzetto-0.1.0.AppImage - so static
 * links rot on the next tag, silently, and usually months later when
 * nobody is looking at the download page.
 *
 * Nothing here runs until someone opens the Install card. The rest of the
 * app makes no requests at all, and this should not be the exception that
 * quietly changes that.
 */

const REPO = 'vidarrapp/bozzetto';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
/** One lookup per tab: the card can be opened repeatedly, the answer will not move. */
const CACHE_KEY = 'bozzetto-latest-release';

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  assets: Asset[];
}

type Platform = 'mac' | 'windows' | 'linux' | null;

/**
 * Which build to lead with. A guess, so the other two stay visible and one
 * wrong sniff costs a visitor nothing.
 */
function guessPlatform(): Platform {
  const hint = (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent
  ).toLowerCase();
  if (hint.includes('mac')) return 'mac';
  if (hint.includes('win')) return 'windows';
  if (hint.includes('linux') || hint.includes('x11')) return 'linux';
  return null;
}

const MATCH: Record<Exclude<Platform, null>, { label: string; test: (n: string) => boolean }> = {
  mac: { label: 'macOS', test: (n) => n.endsWith('.dmg') },
  windows: { label: 'Windows', test: (n) => n.endsWith('.exe') },
  linux: { label: 'Linux', test: (n) => n.endsWith('.AppImage') },
};

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

async function latestRelease(): Promise<Release | null> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached) as Release;
  } catch {
    /* private mode: just fetch again */
  }
  try {
    const res = await fetch(API, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return null; // includes 404 before the first release exists
    const body = (await res.json()) as Release;
    if (!Array.isArray(body.assets)) return null;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(body));
    } catch {
      /* not worth failing over */
    }
    return body;
  } catch {
    return null; // offline, rate-limited, or GitHub down
  }
}

/**
 * The Desktop block for the Install card. Renders a placeholder at once and
 * fills it in when the release lookup lands, so opening the card never
 * waits on the network.
 */
export function desktopDownloads(): HTMLElement | null {
  // Already in the app: offering to download it is nonsense.
  if (isDesktop()) return null;

  const box = document.createElement('div');
  box.className = 'install-desktop';
  box.innerHTML = `
    <h3>Or install the desktop app</h3>
    <p class="muted">Native files, and it works with no connection at all.</p>
    <p class="install-dl-status muted">Looking for the latest release…</p>`;
  const status = box.querySelector<HTMLElement>('.install-dl-status')!;

  void latestRelease().then((release) => {
    const assets = release?.assets ?? [];
    if (!release || assets.length === 0) {
      // No release yet, offline, or rate-limited. A link to the releases
      // page is honest and always works.
      status.replaceChildren();
      const a = document.createElement('a');
      a.href = RELEASES;
      a.rel = 'noopener';
      a.target = '_blank';
      a.textContent = 'Downloads on GitHub';
      status.appendChild(a);
      return;
    }

    const guess = guessPlatform();
    const order: Exclude<Platform, null>[] = ['mac', 'windows', 'linux'];
    if (guess) order.sort((a, b) => (a === guess ? -1 : b === guess ? 1 : 0));

    const list = document.createElement('div');
    list.className = 'install-dl-list';
    for (const key of order) {
      const asset = assets.find((x) => MATCH[key].test(x.name));
      if (!asset) continue; // that platform was not built for this release
      const a = document.createElement('a');
      a.className = `install-dl${key === guess ? ' install-dl--yours' : ''}`;
      a.href = asset.browser_download_url;
      a.rel = 'noopener';
      a.append(
        Object.assign(document.createElement('strong'), { textContent: MATCH[key].label }),
        Object.assign(document.createElement('span'), {
          className: 'muted',
          textContent: `${release.tag_name} · ${mb(asset.size)}`,
        }),
      );
      list.appendChild(a);
    }

    status.replaceWith(list);

    // Unsigned builds: say so here rather than let someone meet Gatekeeper
    // with no idea why, which is the version of this that generates email.
    const note = document.createElement('p');
    note.className = 'muted install-dl-note';
    note.textContent =
      'These builds are unsigned. macOS: right-click the app and choose Open the first ' +
      'time. Windows: More info, then Run anyway.';
    list.after(note);
  });

  return box;
}
