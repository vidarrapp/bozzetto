/**
 * A picture taken in as a reference: decoded, scaled down, and written out
 * again, which is what drops everything the file carried besides its
 * pixels (EXIF, with its place and time, included). Nothing here reads or
 * keeps the original bytes.
 */

/** The longest side a reference keeps, in pixels. */
export const MAX_SIDE = 2048;
/** JPEG quality of a reference that has no transparency. */
export const JPEG_QUALITY = 0.85;

export interface PreparedPicture {
  blob: Blob;
  width: number;
  height: number;
}

/** The flags that decide how a reference is drawn. */
export interface PictureLook {
  mirror: boolean;
  grey: boolean;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honour the camera's rotation: the pixels are written upright, and the tag is gone.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to the element route (a type createImageBitmap does not take).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Decode `file`, scale it to at most MAX_SIDE on its long side, and encode
 * it: JPEG at JPEG_QUALITY, or PNG when any pixel is not opaque. Throws
 * with a sentence for the person when the file is not a picture.
 */
export async function preparePicture(file: Blob): Promise<PreparedPicture> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error('That file is not a picture this browser can read.');
  }
  try {
    const { width: sw, height: sh } = decoded;
    if (!sw || !sh) throw new Error('That picture is empty.');
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser cannot read pictures.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    // Transparency is the one reason to keep PNG: a JPEG would turn it black.
    const data = ctx.getImageData(0, 0, width, height).data;
    let clear = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        clear = true;
        break;
      }
    }
    const blob = clear ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    if (!blob) throw new Error('That picture could not be kept.');
    return { blob, width, height };
  } finally {
    decoded.close();
  }
}

/**
 * The picture as it is drawn: mirrored left to right and/or in greys. A
 * canvas at the picture's own size. The one place the two flags are
 * applied, so beside, behind and in front all show the same thing.
 */
export async function drawLook(blob: Blob, look: PictureLook): Promise<HTMLCanvasElement> {
  const dec = await decode(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = dec.width;
    canvas.height = dec.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return canvas;
    if (look.mirror) {
      ctx.translate(dec.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(dec.source, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (look.grey) {
      const img = ctx.getImageData(0, 0, dec.width, dec.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        // Rec. 709 weights on the stored values: what "values alone" means to a painter.
        const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = y;
      }
      ctx.putImageData(img, 0, 0);
    }
    return canvas;
  } finally {
    dec.close();
  }
}
