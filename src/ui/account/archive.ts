import { getMe, type AccountExport, type ExportProject } from '../../net/account';
import { apiFetch, type ApiResult } from '../../net/origin';
import type { ZipFile } from './zip';

/**
 * What goes into "Download my data" and a project's download, as files in
 * a zip (docs/accounts.md §3):
 *
 *   account.json                        the account, its passkeys, sessions and audit rows
 *   projects/<slug>-<id>/project.json   each project's settings and its list of files
 *   projects/<slug>-<id>/scene.bozz     a scene from Sculpt
 *   projects/<slug>-<id>/thumb.jpg      its card's picture
 *   projects/<slug>-<id>/frames/NNNN.glb a timelapse's or a model's frames
 *   README.txt                          what all this is, and anything that could not be had
 *
 * A project's own download, and each part of the export taken a project
 * at a time (for an iPad, which holds a zip in memory), use the same paths,
 * so the parts unpacked together are the whole.
 */

/** A title as a folder name: lower-case letters, digits and dashes; 'project' when none are left. */
export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'project';
}

/** A project's folder in the archive: its title, readable, and its id, so two of one title never meet. */
export const projectFolder = (p: { id: string; title: string }): string => `projects/${slug(p.title)}-${p.id}`;

/** A file's name in the archive: the server keeps frames under frames/sd/; the archive under frames/. */
export const archiveName = (name: string): string => name.replace(/^frames\/sd\//, 'frames/');

/** How far an archive has got: files written of all of them, and their bytes. */
export interface ArchiveProgress {
  files: number;
  of: number;
  bytes: number;
  total: number;
}

/** A file the server named that could not be had: gone since it was listed. */
interface Missing {
  path: string;
  why: string;
}

/**
 * The file's bytes, from the private route; null when it is not there any
 * more. A dropped connection or a server's hiccup is tried once more; a
 * sign-in gone, or a refusal, stops the archive. The private route answers
 * a file asked for without a session as it answers a missing one (404,
 * docs/accounts.md §4), so a 404 asks who is signed in before it counts a
 * file as gone.
 */
async function fetchFile(url: string): Promise<ArrayBuffer | null> {
  let last = new ArchiveError('The connection dropped. Check it, then start the download again.');
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: ApiResult;
    try {
      res = await apiFetch(url);
    } catch {
      continue;
    }
    if (res.ok && res.bytes) return res.bytes;
    if (res.status === 404) {
      if ((await getMe().catch(() => undefined)) === null) throw signedOut();
      return null;
    }
    if (res.status === 401) throw signedOut();
    // The desktop's proxy says a connection it could not make as status 0.
    if (res.status === 0) continue;
    if (res.status < 500) throw new ArchiveError(`The server refused a file (${res.status}).`);
    last = new ArchiveError(`The server could not send a file (${res.status}). Try again in a moment.`);
  }
  throw last;
}

/** A download that could not go on, said as a sentence. */
export class ArchiveError extends Error {}

const signedOut = (): ArchiveError => new ArchiveError('Your sign-in has expired. Sign in again, then start the download again.');

/** What a project's folder says of it (project.json). */
function projectJson(p: ExportProject): string {
  return JSON.stringify(
    {
      id: p.id,
      title: p.title,
      mode: p.mode,
      fps: p.fps,
      visibility: p.visibility,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      bytes: p.bytes,
      data: p.data,
      files: p.files.map((f) => ({ name: archiveName(f.name), size: f.size })),
    },
    null,
    2,
  );
}

/** The account's part (account.json): everything but the projects' own, which their folders hold. */
function accountJson(data: AccountExport): string {
  const { projects, ...rest } = data;
  return JSON.stringify(
    {
      ...rest,
      projects: projects.map((p) => ({ id: p.id, title: p.title, mode: p.mode, folder: projectFolder(p) })),
    },
    null,
    2,
  );
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** README.txt: what the archive holds, and anything it could not. */
function readme(data: AccountExport, missing: Missing[]): string {
  const lines = [
    'Bozzetto: your data',
    '===================',
    '',
    `Exported from ${window.location.host} for @${data.account.handle}, ${DATE.format(new Date(data.exportedAt))}.`,
    `Format: ${data.format}.`,
    '',
    'account.json',
    '    Your account: handle, email address, role, dates and the terms you accepted;',
    '    your passkeys (their names, dates and kind; never a key), where you have been',
    '    signed in, and the audit log\'s rows about the account. It lists each project',
    '    with its folder.',
    '',
    'projects/<title>-<id>/',
    '    One folder per project.',
    '    project.json      its settings: title, mode, frame rate, the look it opens with, its frames',
    '    scene.bozz        a scene from Sculpt; open it in Bozzetto with Sculpt > File > Open',
    '    thumb.jpg         the picture its card shows',
    '    frames/NNNN.glb   a timelapse\'s or a model\'s frames, in order, as glTF binary (GLB);',
    '                      any glTF viewer opens them',
  ];
  if (!data.complete) {
    lines.push(
      '',
      'Some projects had too many files to list in one go: their files were named from the',
      "projects' own records instead, and their sizes in project.json are null.",
    );
  }
  if (missing.length) {
    lines.push('', 'Not included', '------------', 'These were gone from the server when the archive was made:');
    for (const m of missing) lines.push(`    ${m.path} (${m.why})`);
  }
  return `${lines.join('\n')}\n`;
}

/** The bytes the archive's files come to, as far as the export knows them. */
export const archiveBytes = (projects: ExportProject[]): number =>
  projects.reduce((n, p) => n + p.files.reduce((m, f) => m + (f.size ?? 0), 0), 0);

/**
 * The archive's files, in order, each fetched as the zip reaches it: with
 * `account`, account.json first and README.txt last; then each project's
 * folder - project.json, then its files. A file gone since the export
 * listed it is left out and said in the README (or, without one, simply
 * left out); anything else stops the archive with an ArchiveError.
 */
export async function* archiveFiles(
  data: AccountExport,
  opts: { account: boolean; projects: ExportProject[] },
  onProgress: (p: ArchiveProgress) => void = () => {},
): AsyncGenerator<ZipFile> {
  const lastModified = new Date(data.exportedAt);
  const of = opts.projects.reduce((n, p) => n + p.files.length, 0);
  const progress: ArchiveProgress = { files: 0, of, bytes: 0, total: archiveBytes(opts.projects) };
  const missing: Missing[] = [];
  onProgress({ ...progress });
  if (opts.account) yield { name: 'account.json', input: accountJson(data), lastModified };
  for (const p of opts.projects) {
    const folder = projectFolder(p);
    const modified = new Date(p.updatedAt);
    yield { name: `${folder}/project.json`, input: projectJson(p), lastModified: modified };
    for (const f of p.files) {
      const path = `${folder}/${archiveName(f.name)}`;
      const bytes = await fetchFile(f.url);
      progress.files++;
      if (bytes) {
        progress.bytes += bytes.byteLength;
        onProgress({ ...progress });
        yield { name: path, input: bytes, lastModified: modified };
      } else {
        missing.push({ path, why: 'not found' });
        onProgress({ ...progress });
      }
    }
  }
  if (opts.account) yield { name: 'README.txt', input: readme(data, missing), lastModified };
}

/**
 * A timelapse's or a model's frames, for My projects' Download: the files a
 * manifest names, under the project's folder as the export lays one out,
 * with project.json from the manifest.
 */
export async function* frameFiles(
  project: { id: string; title: string; updated_at: number },
  manifest: unknown,
  frames: { index: number; url: string }[],
  thumb: string | null,
  onProgress: (done: number, of: number) => void = () => {},
): AsyncGenerator<ZipFile> {
  const folder = projectFolder(project);
  const lastModified = new Date(project.updated_at);
  yield { name: `${folder}/project.json`, input: JSON.stringify(manifest, null, 2), lastModified };
  if (thumb) {
    const bytes = await fetchFile(thumb).catch(() => null);
    if (bytes) yield { name: `${folder}/thumb.jpg`, input: bytes, lastModified };
  }
  let done = 0;
  onProgress(done, frames.length);
  for (const f of frames) {
    const bytes = await fetchFile(f.url);
    if (!bytes) throw new ArchiveError(`Frame ${f.index + 1} is not on the server any more.`);
    done++;
    onProgress(done, frames.length);
    yield { name: `${folder}/frames/${String(f.index).padStart(4, '0')}.glb`, input: bytes, lastModified };
  }
}
