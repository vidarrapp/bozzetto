/**
 * Replaces SculptGL's drawables/Selection (the red brush-hover circle) for the
 * vendored code. SculptGL constructs it with a GL context and tools call
 * render(main) after a stroke step; Bozzetto draws overlays through its own
 * pipeline instead, so this WS0 stub is inert. WS3 replaces the stub with the
 * real brush ring / symmetry line overlays (plan section 6.5).
 */
export default class Overlays {
  // The vendored SculptManager passes main._gl (always null in Bozzetto).
  constructor(_gl: unknown) {}

  /** Called by SculptBase.postRender; the ring lands in WS3. */
  render(_main: unknown): void {}
}
