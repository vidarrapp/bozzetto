import { CustomBlending, HalfFloatType, OneFactor, AddEquation, Vector2 } from 'three';
import { NodeMaterial, QuadMesh, RenderTarget, RendererUtils, TempNode, type Node, type NodeBuilder, type NodeFrame } from 'three/webgpu';
import { NodeUpdateType, passTexture } from 'three/tsl';

// The published TSL typings are narrower than what the runtime accepts.
type N = any;

const _quad = /*@__PURE__*/ new QuadMesh();
const _size = /*@__PURE__*/ new Vector2();
// Reused between passes, as three's own pass nodes do; filled on first use.
let _state = undefined as unknown as ReturnType<typeof RendererUtils.resetRendererState>;

/**
 * three r184's WebGL2 fallback gives each attachment of an MRT pass (the
 * scene pass: colour and normals) its blend function straight through
 * OES_draw_buffers_indexed, without telling the blend state it caches for
 * every other draw. After such a pass the cache could say One/One was set
 * while the context held the scene's normal blending, so the next draw
 * asking for One/One (the sum's) was not given it, and each sample
 * overwrote the sum instead of adding to it (measured: the held image was
 * the last sample at a sixteenth of its alpha). Forgetting the cache after
 * every MRT draw makes the next draw set its blending in full. WebGPU keeps
 * blending in each pipeline and needs none of this. Once per renderer,
 * checked for, so a three upgrade that moves these leaves it alone.
 */
const _patched = /*@__PURE__*/ new WeakSet<object>();
function forgetBlendAfterMrt(renderer: N): void {
  const backend = renderer.backend;
  const state = backend?.state;
  if (!backend?.isWebGLBackend || !state || typeof state.setMRTBlending !== 'function' || _patched.has(state)) return;
  _patched.add(state);
  const setMRTBlending = state.setMRTBlending.bind(state);
  state.setMRTBlending = (...args: unknown[]): void => {
    setMRTBlending(...args);
    state.currentBlending = null;
    state.currentBlendEquation = null;
    state.currentBlendEquationAlpha = null;
    state.currentBlendSrc = null;
    state.currentBlendDst = null;
    state.currentBlendSrcAlpha = null;
    state.currentBlendDstAlpha = null;
  };
}

/**
 * What the accumulation does this frame. 'replace' writes the frame as it
 * is (the moving view, and the first sample of a still one); 'add' adds a
 * jittered sample to the ones before; 'hold' draws nothing, and the sum
 * already there stays on screen.
 */
export type AccumulateMode = 'replace' | 'add' | 'hold';

/**
 * The still frame's anti-aliasing (Viewer.updateAntialias): the picture
 * summed, sample by sample, into a half-float target the output divides by
 * the count. Moving, every frame replaces the sum, so what shows is the
 * frame itself; still, each frame adds one drawn through a sub-pixel camera
 * offset, and once there are enough, nothing is drawn at all and the
 * average holds. The target is sized with the drawing buffer at the first
 * frame and kept: only a resize or a pixel-ratio change reallocates it.
 *
 * One pipeline does all three: additive blending onto a target that is
 * cleared first ('replace') or not ('add'), so going still or moving again
 * builds and compiles nothing.
 */
export class AccumulateNode extends TempNode {
  mode: AccumulateMode = 'replace';
  /** Passes drawn since the viewer was built (the latency suite counts them). */
  renders = 0;
  private input: Node;
  private readonly target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly material = new NodeMaterial();
  private readonly textureNode: N;

  constructor(input: Node) {
    super('vec4');
    this.input = input;
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.target.texture.name = 'Accumulate';
    this.material.name = 'Accumulate';
    this.material.blending = CustomBlending;
    this.material.blendSrc = OneFactor;
    this.material.blendDst = OneFactor;
    this.material.blendEquation = AddEquation;
    this.material.blendSrcAlpha = OneFactor;
    this.material.blendDstAlpha = OneFactor;
    this.material.blendEquationAlpha = AddEquation;
    this.textureNode = passTexture(this as N, this.target.texture);
  }

  /** The picture to sum: the output's composite, as rebuildOutput chooses it. */
  setInput(input: Node): void {
    this.input = input;
  }

  /** The sum, for the output to divide by the count. */
  getTextureNode(): N {
    return this.textureNode;
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    // undefined, not false: false asks the frame to try the node again.
    if (this.mode === 'hold') return undefined;
    const renderer = frame.renderer as N;
    forgetBlendAfterMrt(renderer);
    _state = RendererUtils.resetRendererState(renderer, _state);
    const size = renderer.getDrawingBufferSize(_size);
    if (this.target.width !== size.width || this.target.height !== size.height) {
      this.target.setSize(size.width, size.height);
    }
    renderer.setRenderTarget(this.target);
    // The reset leaves autoClear on: a replace starts from nothing, an add
    // keeps the sum and blends onto it.
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = this.mode === 'replace';
    _quad.material = this.material;
    _quad.name = 'Accumulate';
    _quad.render(renderer);
    this.renders++;
    RendererUtils.restoreRendererState(renderer, _state);
    return undefined;
  }

  override setup(builder: NodeBuilder): N {
    this.material.fragmentNode = (this.input as N).context((builder as N).getSharedContext());
    this.material.needsUpdate = true;
    return this.textureNode;
  }

  override dispose(): void {
    this.target.dispose();
    this.material.dispose();
    super.dispose();
  }
}

/**
 * Sub-pixel offsets for a still frame's samples, in pixels about the pixel
 * centre: the first is the plain frame (no offset, so going still does not
 * shift the picture), then a Halton (2, 3) run, which spreads any count of
 * them evenly over the pixel and averages near its centre.
 */
export function stillOffsets(count: number): Array<[number, number]> {
  const halton = (i: number, base: number): number => {
    let f = 1;
    let r = 0;
    while (i > 0) {
      f /= base;
      r += f * (i % base);
      i = Math.floor(i / base);
    }
    return r;
  };
  const out: Array<[number, number]> = [[0, 0]];
  for (let i = 1; i < count; i++) out.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);
  return out;
}
