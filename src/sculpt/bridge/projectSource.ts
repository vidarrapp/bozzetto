import type { ProjectSource } from './paintTools';

/**
 * What Project reads of the reference board: the pictures in the view and the
 * one drawn topmost at a point of the page (src/reference/ReferenceView.ts:
 * `picturesInView` and `imageAt`). Described here by what is used of them, so
 * the paint tools do not depend on the view.
 */
export interface PictureLookup {
  picturesInView(): Array<{ item: PictureItem }>;
  imageAt(clientX: number, clientY: number): { item: PictureItem; x: number; y: number } | null;
}

/** A picture of the board, as far as Project needs it. */
export interface PictureItem {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  /** In greys: Project takes the grey, not the colour. */
  grey: boolean;
}

interface Pixels {
  key: string;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Project's source: the pixel of the picture under a point of the page, as
 * the picture is stored (`imageAt` gives the place in its own pixels, with
 * a mirror already undone), in greys where the picture is. A picture's blend
 * mode and opacity, which only decide how it is drawn over the view, change
 * nothing here. The pictures are decoded once, when first wanted, and kept
 * while they stay the same.
 */
export function projectSource(view: PictureLookup): ProjectSource & { prefetch(): void } {
  const cache = new Map<string, Pixels>();
  const pending = new Set<string>();

  const keyOf = (item: PictureItem): string => `${item.blob.size}|${item.grey ? 1 : 0}|${item.width}x${item.height}`;

  const decode = async (item: PictureItem): Promise<void> => {
    const key = keyOf(item);
    if (cache.get(item.id)?.key === key || pending.has(`${item.id}|${key}`)) return;
    pending.add(`${item.id}|${key}`);
    try {
      const bitmap = await createImageBitmap(item.blob);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        if (item.grey) {
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            // Rec. 709 weights on the stored values, as the reference view draws a picture in greys.
            const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
            d[i] = d[i + 1] = d[i + 2] = y;
          }
        }
        cache.set(item.id, { key, data: img.data, width: bitmap.width, height: bitmap.height });
      } finally {
        bitmap.close();
      }
    } catch {
      // A picture that cannot be read gives no colour: the dab passes it by.
    } finally {
      pending.delete(`${item.id}|${key}`);
    }
  };

  const prefetch = (): void => {
    const live = new Set<string>();
    for (const p of view.picturesInView()) {
      live.add(p.item.id);
      void decode(p.item);
    }
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
  };

  return {
    prefetch,
    ready: () => {
      const any = view.picturesInView().length > 0;
      if (any) prefetch();
      return any;
    },
    sample: (clientX, clientY) => {
      const hit = view.imageAt(clientX, clientY);
      if (!hit) return null;
      const px = cache.get(hit.item.id);
      if (!px || px.key !== keyOf(hit.item)) {
        void decode(hit.item);
        return null;
      }
      const x = Math.min(px.width - 1, Math.max(0, Math.floor((hit.x * px.width) / hit.item.width)));
      const y = Math.min(px.height - 1, Math.max(0, Math.floor((hit.y * px.height) / hit.item.height)));
      const o = (y * px.width + x) * 4;
      if (px.data[o + 3] < 8) return null;
      return [px.data[o] / 255, px.data[o + 1] / 255, px.data[o + 2] / 255];
    },
  };
}
