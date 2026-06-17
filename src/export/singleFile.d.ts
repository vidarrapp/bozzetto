export interface Asset {
  /** Exact path the viewer requests this asset by (registry key). */
  path: string;
  bytes: Uint8Array;
}

export interface SingleFileInput {
  /** The raw manifest object, embedded unchanged. */
  manifest: unknown;
  /** Every asset the viewer will request, gathered by the caller. */
  assets: Asset[];
  /** The viewer bundled as a classic IIFE. */
  viewerJs: string;
  /** The viewer's stylesheet, inlined into a <style> tag. */
  css?: string;
  /** Document <title> (defaults to the manifest title). */
  title?: string;
}

/** Emit one self-contained HTML document with everything inlined. */
export function buildSingleFileHtml(input: SingleFileInput): string;
