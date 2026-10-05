/**
 * The version a build says it is: package.json's version and the commit it
 * was built from, as "0.5.3 (2e735c6)". Vite injects it (vite.config.ts,
 * vite.embed.config.ts) for the hotkey guide and the update notices, and the
 * desktop build writes it beside the app for the About panel.
 *
 * package.json's version alone moves only with a desktop release, while the
 * site redeploys on every push to main: two deploys a day apart would both
 * call themselves 0.5.3, and "which one is this iPad running?" is exactly
 * the question the version has to answer. The commit tells them apart.
 *
 * The commit comes from Cloudflare Pages' CF_PAGES_COMMIT_SHA where the site
 * is built, from git anywhere else (a laptop, the desktop release workflow),
 * and is "dev" where neither is available - a source tarball, say. An
 * unknown commit must never fail a build.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The short hash of the commit being built, or "dev". */
export function buildCommit() {
  const sha = process.env.CF_PAGES_COMMIT_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  try {
    const head = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return head || 'dev';
  } catch {
    return 'dev';
  }
}

/** package.json's version. */
export function packageVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

/** "0.5.3 (2e735c6)": what the app shows as its version. */
export function appVersion() {
  return `${packageVersion()} (${buildCommit()})`;
}
