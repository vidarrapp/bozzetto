import { CanvasTexture, LinearFilter, NoColorSpace, Vector4 } from 'three';
import type { Node } from 'three/webgpu';
import { Fn, If, abs, dot, float, max, min, screenUV, select, sqrt, texture as tslTexture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { BLEND_MODES } from '../ui/blendModes';

// The published TSL typings are narrower than what the runtime accepts.
type N = any;

/**
 * Reference pictures blended over the model inside the viewer's own frame.
 *
 * A fixed number of slots (the topmost SLOTS pictures in the view), each a
 * texture, a place, an opacity and a mode, all uniforms: moving, sizing,
 * changing the mode, opacity, flip or greyscale never builds a shader, and
 * neither does a different number of pictures (unused slots are skipped by
 * one uniform test). The composite runs on the tone-mapped, sRGB-encoded
 * colour, which is the space a browser blends in, with the W3C compositing
 * formulas for every mode in `CSS_BLEND_MODES` (the modes the Reference
 * panel offers); a mode of `BLEND_MODES` outside that list draws as Normal.
 */
export const OVERLAY_SLOTS = 4;

export interface OverlayPicture {
  canvas: HTMLCanvasElement;
  opacity: number;
  /** An id of `BLEND_MODES`. */
  mode: string;
  /** Left, top, width and height as fractions of the view, from the top down. */
  rect: { x: number; y: number; w: number; h: number };
}

const MODE_INDEX = new Map(BLEND_MODES.map((m, i) => [m.id, i]));
const modeIndex = (id: string): number => MODE_INDEX.get(id) ?? 0;

// --- the formulas (scalars per channel, display space, values 0 to 1) ---------

const screenCh = (cb: N, cs: N): N => cb.add(cs).sub(cb.mul(cs));
const hardLightCh = (cb: N, cs: N): N => select(cs.lessThanEqual(0.5), cb.mul(cs).mul(2), screenCh(cb, cs.mul(2).sub(1)));
const burnCh = (cb: N, cs: N): N => select(cb.greaterThanEqual(1), float(1), select(cs.lessThanEqual(0), float(0), float(1).sub(min(float(1), float(1).sub(cb).div(max(cs, float(1e-5)))))));
const dodgeCh = (cb: N, cs: N): N => select(cb.lessThanEqual(0), float(0), select(cs.greaterThanEqual(1), float(1), min(float(1), cb.div(max(float(1).sub(cs), float(1e-5))))));
const softLightCh = (cb: N, cs: N): N => {
  const d = select(cb.lessThanEqual(0.25), cb.mul(16).sub(12).mul(cb).add(4).mul(cb), sqrt(cb));
  return select(cs.lessThanEqual(0.5), cb.sub(float(1).sub(cs.mul(2)).mul(cb).mul(float(1).sub(cb))), cb.add(cs.mul(2).sub(1).mul(d.sub(cb))));
};

const perChannel = (cb: N, cs: N, f: (b: N, s: N) => N): N => vec3(f(cb.r, cs.r), f(cb.g, cs.g), f(cb.b, cs.b));

const lum = (c: N): N => dot(c, vec3(0.3, 0.59, 0.11));
const clipColor = (c: N): N => {
  const l = lum(c);
  const n = min(min(c.r, c.g), c.b);
  const x = max(max(c.r, c.g), c.b);
  const lowFixed = l.add(c.sub(l).mul(l).div(max(l.sub(n), float(1e-6))));
  const c1 = select(n.lessThan(0), lowFixed, c);
  const highFixed = l.add(c1.sub(l).mul(float(1).sub(l)).div(max(x.sub(l), float(1e-6))));
  return select(x.greaterThan(1), highFixed, c1);
};
const setLum = (c: N, l: N): N => clipColor(c.add(l.sub(lum(c))));
const sat = (c: N): N => max(max(c.r, c.g), c.b).sub(min(min(c.r, c.g), c.b));
const setSat = (c: N, s: N): N => {
  const lo = min(min(c.r, c.g), c.b);
  const range = max(sat(c), float(1e-6));
  return select(sat(c).greaterThan(0.001), c.sub(lo).mul(s).div(range), vec3(0));
};

/** B(Cb, Cs) for the mode index, backdrop and source (display space). */
const blendFn = Fn(([cb, cs, mode]: N[]) => {
  const out = vec3(0).toVar();
  const is = (id: string): N => mode.equal(float(modeIndex(id)));
  const chain = If(is('normal'), () => {
    out.assign(cs);
  });
  const add = (id: string, f: () => N): void => {
    chain.ElseIf(is(id), () => {
      out.assign(f());
    });
  };
  add('darken', () => min(cb, cs));
  add('multiply', () => cb.mul(cs));
  add('color-burn', () => perChannel(cb, cs, burnCh));
  add('lighten', () => max(cb, cs));
  add('screen', () => perChannel(cb, cs, screenCh));
  add('color-dodge', () => perChannel(cb, cs, dodgeCh));
  add('linear-dodge', () => min(cb.add(cs), vec3(1)));
  add('overlay', () => perChannel(cb, cs, (b, s) => hardLightCh(s, b)));
  add('soft-light', () => perChannel(cb, cs, softLightCh));
  add('hard-light', () => perChannel(cb, cs, hardLightCh));
  add('difference', () => abs(cb.sub(cs)));
  add('exclusion', () => cb.add(cs).sub(cb.mul(cs).mul(2)));
  add('hue', () => setLum(setSat(cs, sat(cb)), lum(cb)));
  add('saturation', () => setLum(setSat(cb, sat(cs)), lum(cb)));
  add('color', () => setLum(cs, lum(cb)));
  add('luminosity', () => setLum(cb, lum(cs)));
  return out;
});

/** The slots' uniforms and textures, and the node that composes them over a colour. */
export class RefOverlay {
  /** Something is to be drawn: a pipeline built with the composite in it stays in it. */
  private slots: { rect: Node; opacity: Node; mode: Node; on: Node; tex: Node }[] = [];
  private readonly blank = new CanvasTexture(document.createElement('canvas'));
  private readonly textures = new Map<HTMLCanvasElement, CanvasTexture>();
  private readonly used: (HTMLCanvasElement | null)[] = new Array(OVERLAY_SLOTS).fill(null);
  /** 1 while the view is on screen; 0 for anything that leaves it. */
  private readonly gate = uniform(1);
  private built: Node | null = null;
  private composed = new WeakMap<object, Node>();

  constructor() {
    this.blank.colorSpace = NoColorSpace;
    this.blank.needsUpdate = true;
    for (let i = 0; i < OVERLAY_SLOTS; i++) {
      this.slots.push({
        rect: uniform(new Vector4(0, 0, 1, 1)),
        opacity: uniform(0),
        mode: uniform(0),
        on: uniform(0),
        tex: tslTexture(this.blank, vec2(0, 0), 0),
      });
    }
  }

  setGate(on: boolean): boolean {
    const v = on ? 1 : 0;
    if (this.gate.value === v) return false;
    this.gate.value = v;
    return true;
  }

  /** Put these pictures (lowest first, the topmost SLOTS kept) in the slots. */
  set(pictures: readonly OverlayPicture[]): void {
    const top = pictures.slice(-OVERLAY_SLOTS);
    for (let i = 0; i < OVERLAY_SLOTS; i++) {
      const s = this.slots[i] as N;
      const p = top[i];
      if (!p) {
        s.on.value = 0;
        if (this.used[i]) {
          s.tex.value = this.blank;
          this.used[i] = null;
        }
        continue;
      }
      let tex = this.textures.get(p.canvas);
      if (!tex) {
        tex = new CanvasTexture(p.canvas);
        // The picture's own bytes, blended as the display's: no colour conversion on the way in.
        tex.colorSpace = NoColorSpace;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.generateMipmaps = false;
        this.textures.set(p.canvas, tex);
      }
      if (this.used[i] !== p.canvas) {
        s.tex.value = tex;
        this.used[i] = p.canvas;
      }
      s.rect.value.set(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
      s.opacity.value = Math.min(1, Math.max(0, p.opacity));
      s.mode.value = modeIndex(p.mode);
      s.on.value = 1;
    }
    // Textures of pictures no slot holds any more.
    const held = new Set(this.used);
    for (const [canvas, tex] of [...this.textures]) {
      if (!held.has(canvas)) {
        tex.dispose();
        this.textures.delete(canvas);
      }
    }
  }

  /** How many slots hold a picture (what the tests read). */
  count(): number {
    return this.slots.filter((s) => (s.on as N).value > 0.5).length;
  }

  /**
   * The colour node (display space, already tone mapped and encoded) with the
   * pictures blended over it. Built once for a given base.
   */
  compose(base: Node): Node {
    const have = this.composed.get(base);
    if (have) return have;
    const b = base as N;
    const out = Fn(() => {
    const col = vec3(b.rgb).toVar();
    for (const s of this.slots as N[]) {
      If(s.on.mul(this.gate as N).greaterThan(0.5), () => {
        const r = s.rect;
        const u = screenUV.x.sub(r.x).div(r.z);
        const down = screenUV.y.sub(r.y).div(r.w);
        const inside = min(min(u, float(1).sub(u)), min(down, float(1).sub(down))).greaterThanEqual(0);
        // screenUV runs from the top of the view down on both backends; a texture's v runs up.
        s.tex.uvNode = vec2(u, float(1).sub(down)).clamp(0, 1);
        // The sample is taken once, here, into a variable: used lazily inside the mode's branches it would be
        // declared in the first branch that reads it and be out of scope in the others.
        const px: N = vec4(s.tex as N).toVar();
        const cs: N = px.rgb.toVar();
        const alpha = px.a.mul(s.opacity);
        const blended = blendFn(col, cs, s.mode);
        col.assign(col.add(blended.sub(col).mul(select(inside, alpha, float(0)))));
      });
    }
    return vec4(col, b.a);
    })() as unknown as Node;
    this.composed.set(base, out);
    this.built = out;
    return out;
  }

  /** True once a composite has been built (the pipeline then carries it). */
  isBuilt(): boolean {
    return this.built !== null;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.blank.dispose();
  }
}
