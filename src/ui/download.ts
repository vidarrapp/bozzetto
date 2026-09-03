/**
 * The one way Bozzetto hands a generated file to the browser. There were
 * three copies of this, and the one behind the single-file export - the
 * biggest download of the lot, hundreds of megabytes for a guest on an
 * iPad - was the weakest: it never appended the anchor and revoked the
 * object URL after a second, which on Safari can outrun the download
 * sheet and save nothing (review finding).
 *
 * Appending the anchor is what makes the click count in Safari, and the
 * URL has to outlive the sheet, so the revoke is generous.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
