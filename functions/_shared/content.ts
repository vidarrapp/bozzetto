import { HttpError } from './http';
import { SceneFileError, checkHeader, damaged, readLayout, type Layout } from '../../shared/bozz';

/**
 * What an upload must be before R2 sees a byte of it (docs/accounts.md §4):
 * checked in memory, from the bytes the request brought.
 *
 * - A scene's first part starts as gzip (1f 8b 08) or as the bare
 *   container (BOZ1). Its header is inflated - that alone, never the
 *   arrays after it - and must read (readLayout) and pass checkHeader:
 *   422 bad_scene, with the reason, if not. The size the header says the
 *   file unpacks to is what the last part's gzip trailer must say too.
 * - A thumbnail starts as a JPEG (FF D8 FF).
 * - A frame is glTF 2.0 binary, as it is or gzipped: the magic, the
 *   version, and the length its header gives.
 *
 * Anything else is 415 bad_type.
 */

/**
 * The most of a scene's header the server inflates: 1 MiB. The app's own
 * reader allows 16 (shared/bozz.ts); a header is kilobytes in practice, and
 * this is read inside a request's ten milliseconds.
 */
export const MAX_SERVER_HEADER = 1024 * 1024;

/** The gzip of anything, as it starts: magic and the deflate method. */
const GZIP = [0x1f, 0x8b, 0x08];
/** The bare scene container's magic, 'BOZ1'. */
const BOZ1 = [0x42, 0x4f, 0x5a, 0x31];
/** glTF binary's magic, 'glTF'. */
const GLTF = [0x67, 0x6c, 0x54, 0x46];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

export const isGzip = (bytes: Uint8Array): boolean => startsWith(bytes, GZIP);

const badType = (what: string): HttpError => new HttpError(`Not ${what}`, 415, 'bad_type');
/** 422 bad_scene, its reason worded as the app words its own (shared/bozz.ts). */
export const badScene = (reason: string): HttpError => new HttpError(reason, 422, 'bad_scene', { reason });
export const damagedScene = (why: string): HttpError => badScene(`This scene file is damaged (${why})`);

/**
 * How much compressed input is handed to the inflater at a time. Deflate
 * inflates at most about a thousandfold, so no step of it can hold more
 * than some 16 MB, however the input was made, before the reader has the
 * bytes it wanted and stops.
 */
const FEED = 16 * 1024;

/** What inflating the start of a gzip stream came to. */
interface Inflated {
  /** The bytes, up to the most asked for. */
  bytes: Uint8Array;
  /** Whether the stream failed before `enough` was had: not gzip, damaged, or (a first part) cut short. */
  broke: boolean;
}

/**
 * The start of what `gz` inflates to: chunks are read until `enough` says
 * the bytes so far will do, or `max` bytes are in, and the rest is never
 * inflated. The whole input is offered, trailer and all: an inflater that
 * meets the end of a stream without its trailer may drop what it had not
 * yet handed on, and the header of a small file is in that last stretch.
 * A trailer that disagrees with what came before breaks the stream there,
 * which is a damaged file whatever its header says.
 */
async function inflateStart(gz: Uint8Array, enough: (have: number) => boolean, max: number): Promise<Inflated> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const feeding = (async () => {
    for (let at = 0; at < gz.length; at += FEED) await writer.write(gz.subarray(at, at + FEED));
    await writer.close();
  })();
  feeding.catch(() => {}); // a break below, or a bad stream, ends it; either is answered there
  const chunks: Uint8Array[] = [];
  let have = 0;
  let broke = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      have += value.byteLength;
      if (have >= max || enough(have)) break;
    }
  } catch {
    broke = !enough(have);
  } finally {
    void reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(have, max));
  let at = 0;
  for (const c of chunks) {
    if (at >= out.length) break;
    out.set(c.subarray(0, out.length - at), at);
    at += c.byteLength;
  }
  return { bytes: out, broke };
}

/** What a scene's first part says of the file it starts. */
export interface SceneStart {
  /** Gzipped, as the app writes it; else the bare container. */
  gzip: boolean;
  /** What the whole file unpacks to, as its header says: the gzip trailer's ISIZE, or the bare file's length. */
  size: number;
}

/** A readLayout or checkHeader refusal as the 422 it answers; anything else as it was. */
function sceneError(err: unknown): never {
  if (err instanceof SceneFileError) throw badScene(err.message);
  throw err;
}

/**
 * The header at the start of `head`, read and checked: `more` gives the
 * container's bytes, at least as many as asked for, or fewer when there are
 * no more. The header is held to MAX_SERVER_HEADER before any of it is read.
 */
async function sceneHeader(more: (need: number) => Promise<Uint8Array>): Promise<Layout> {
  try {
    let read = readLayout(await more(8));
    if (typeof read === 'number') {
      // What the header's length says it takes: the magic and the length checked, nothing read yet.
      const need = read;
      if (need > 8 + MAX_SERVER_HEADER) throw badScene(`This scene's header is over the ${MAX_SERVER_HEADER / 1024 / 1024} MiB the server reads`);
      const head = await more(need);
      read = head.length < need ? need : readLayout(head.subarray(0, need));
      if (typeof read === 'number') throw damagedScene('its header is cut short');
    }
    checkHeader(read);
    return read;
  } catch (err) {
    return sceneError(err);
  }
}

/**
 * Check a scene's first part, as it came: 415 bad_type unless it starts as
 * gzip or the bare container; 422 bad_scene unless its header reads and
 * passes checkHeader. Answers what the header says of the whole file.
 */
export async function checkSceneStart(part: Uint8Array): Promise<SceneStart> {
  if (isGzip(part)) {
    const layout = await sceneHeader(async (need) => {
      const { bytes, broke } = await inflateStart(part, (have) => have >= need, need);
      // The app's own words for a stream that fails under it (SceneFile.ts).
      if (broke) throw damaged('it does not decompress');
      return bytes;
    });
    return { gzip: true, size: layout.size };
  }
  if (startsWith(part, BOZ1)) {
    const layout = await sceneHeader(async (need) => part.subarray(0, Math.min(need, part.length)));
    return { gzip: false, size: layout.size };
  }
  throw badType('a Bozzetto scene');
}

/**
 * Whether a gzipped file's last part ends with the size its header said:
 * the trailer's ISIZE, the unpacked size mod 2^32, little-endian in the
 * last four bytes. A last part shorter than four bytes carries only the
 * end of it, and that much is compared. 422 bad_scene if not.
 */
export function checkSceneEnd(last: Uint8Array, unpacked: number): void {
  const expect = new Uint8Array(4);
  new DataView(expect.buffer).setUint32(0, unpacked % 2 ** 32, true);
  const n = Math.min(4, last.length);
  for (let i = 1; i <= n; i++) {
    if (last[last.length - i] !== expect[4 - i]) throw damagedScene('it does not end where its header says');
  }
}

/** A thumbnail: a JPEG, as every client encodes one (Viewer.captureThumbnail); 415 bad_type if not. */
export function checkThumb(bytes: Uint8Array): void {
  if (!startsWith(bytes, JPEG)) throw badType('a JPEG');
}

/** glTF binary's 12-byte header: 'glTF', version 2, and the length of the whole. */
function gltfHeader(head: Uint8Array, length: number): boolean {
  if (head.length < 12 || !startsWith(head, GLTF)) return false;
  const dv = new DataView(head.buffer, head.byteOffset, 12);
  return dv.getUint32(4, true) === 2 && dv.getUint32(8, true) === length;
}

/**
 * A frame: glTF 2.0 binary, as it is or gzipped (as the capture clients
 * send it). Its header must say version 2 and the length it is - for a
 * gzipped one, the length the gzip trailer says it inflates to. Only the
 * first twelve inflated bytes are made. 415 bad_type if not.
 */
export async function checkFrame(bytes: Uint8Array): Promise<void> {
  if (isGzip(bytes)) {
    if (bytes.length < 18) throw badType('a glTF 2.0 binary');
    const isize = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0, true);
    const { bytes: head } = await inflateStart(bytes, (have) => have >= 12, 12);
    if (gltfHeader(head, isize)) return;
    throw badType('a glTF 2.0 binary');
  }
  if (!gltfHeader(bytes, bytes.length)) throw badType('a glTF 2.0 binary');
}
