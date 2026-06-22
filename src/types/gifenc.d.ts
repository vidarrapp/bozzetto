// gifenc ships no type declarations (package.json "types" is unset), so declare
// the small surface we use. Mirrors the API documented in the gifenc README.
declare module 'gifenc' {
  /** A colour table: an array of `[r, g, b]` (or `[r, g, b, a]`) byte tuples. */
  export type Palette = number[][];

  export type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    format?: PixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array;

  export interface WriteFrameOptions {
    palette?: Palette;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** Repeat count: -1 once, 0 forever (default), >0 explicit count. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export interface GifEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance;

  export default GIFEncoder;
}
