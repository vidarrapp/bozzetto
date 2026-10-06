/**
 * Gzip, inflated a chunk at a time.
 *
 * Neither kind of file the app inflates - a .bozz scene, a timelapse frame -
 * can be trusted to say how big it becomes: a megabyte of gzip inflates to
 * about a gigabyte, and reading one whole (new Response(stream)) held all
 * of it before anything could look. Fed through here, the reader sees each
 * chunk as it is inflated and can stop at the first one past what it will
 * hold; the rest is never inflated.
 */

/**
 * Inflate `bytes`, handing every chunk to `take` in order. A throw from
 * `take` stops the inflating and is what this rejects with; a stream that
 * is not gzip, or is cut short, rejects with the browser's own error.
 */
export async function inflateEach(bytes: ArrayBuffer, take: (chunk: Uint8Array) => void): Promise<void> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      take(value);
    }
  } catch (err) {
    // Whatever the stream still holds is dropped, not inflated.
    void reader.cancel().catch(() => undefined);
    throw err;
  }
}

/** Inflate `bytes` whole, refusing (with `tooLarge`) once the output passes `max` bytes. */
export async function gunzipCapped(bytes: ArrayBuffer, max: number, tooLarge: string): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  await inflateEach(bytes, (chunk) => {
    total += chunk.length;
    if (total > max) throw new Error(tooLarge);
    parts.push(chunk);
  });
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}
