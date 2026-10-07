import { downloadZip } from 'client-zip';
import { downloadBlob } from '../download';

/**
 * Zips made in the browser (docs/accounts.md §3): the account's data, and a
 * timelapse's frames, with client-zip 2.5.1. The server could not make
 * them: a zip needs a CRC-32 over every byte, far past the CPU a Function
 * may spend on one request. client-zip stores rather than compresses (the
 * files are gzip, GLB and JPEG already), and asks for each file only as
 * the archive reaches it, so the files are fetched one at a time and none
 * is held longer than it takes to write it.
 */

/** One file in a zip: its path in the archive, and its bytes or its text. */
export interface ZipFile {
  name: string;
  input: ArrayBuffer | Uint8Array | string | Blob;
  lastModified?: Date;
}

/**
 * Where a zip goes: a file the person picked, written as the zip is made,
 * so its size is never held in memory; or a download, handed over once it
 * is whole - which Safari, an iPad above all, holds in memory meanwhile.
 */
export type ZipTarget =
  | { kind: 'file'; writable: WritableStream<Uint8Array>; name: string }
  | { kind: 'download'; name: string };

/** The File System Access API's save dialog, where the browser has one (Chromium). */
type SaveFilePicker = (options: {
  suggestedName: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name?: string; createWritable(): Promise<WritableStream<Uint8Array>> }>;

/**
 * Where to put a zip, asked first thing in a click: the browser shows its
 * Save dialog only in answer to one. Where it can, the person picks a file
 * and the zip streams into it (showSaveFilePicker); elsewhere it is a
 * download once it is whole. Null when the dialog was closed instead.
 */
export async function zipTarget(name: string): Promise<ZipTarget | null> {
  const pick = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof pick !== 'function') return { kind: 'download', name };
  try {
    const handle = await pick({
      suggestedName: name,
      types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
    });
    return { kind: 'file', writable: await handle.createWritable(), name: handle.name ?? name };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    // Refused - the click's gesture spent, a policy - so the download stands in.
    return { kind: 'download', name };
  }
}

/**
 * Make the zip of `files` and hand it over to `target`. The files are an
 * iterable the zip asks for one at a time as it writes, so a generator
 * that fetches each in turn fetches it only then. A failure part way stops
 * the zip: a picked file is abandoned rather than left half written, and
 * nothing is downloaded.
 */
export async function writeZip(target: ZipTarget, files: AsyncIterable<ZipFile> | Iterable<ZipFile>): Promise<void> {
  const zip = downloadZip(files, { buffersAreUTF8: true });
  if (target.kind === 'file') {
    if (!zip.body) throw new Error('This browser cannot write a zip');
    await zip.body.pipeTo(target.writable);
    return;
  }
  downloadBlob(await zip.blob(), target.name);
}
