import { vec3 } from 'gl-matrix';
import Paint from '@sculpt-vendor/editing/tools/Paint';
import Tablet from '@sculpt-vendor/misc/Tablet';
import Picking from '@sculpt-vendor/math3d/Picking';
import { BYTE_TO_LINEAR, decodeSrgb } from '../../paint/blend';
import { hiddenFromCamera, releaseOcclusion } from './occlusion';
import { LayeredPaint, PaintBlurBrush, PaintBrush } from './tools';
import type { PaintStroke } from './paintLayers';
import type { SculptSession } from './SculptSession';

/** A picture's value (sRGB, 0..1) in linear light: its pixels are bytes, so the table has it. */
const linear = (v: number): number => {
  const b = Math.round(v * 255);
  return b >= 0 && b <= 255 && Math.abs(b - v * 255) < 1e-4 ? BYTE_TO_LINEAR[b] : decodeSrgb(v);
};

/**
 * The Paint workspace's tools beyond Paint itself (tools.ts): Erase, Blur,
 * Fill, Pick and Project. All of them are the same kind of stroke tool as
 * Paint, so the pointer, the dab spacing, the pressure, symmetry, masks and
 * hidden poly groups behave as they do for Paint; what differs is only what
 * a dab does to the active layer (or Base): `PaintStroke` has the operation.
 */

/** Erase: lowers the active layer's alpha under the brush. Base has no alpha, so it takes no erase. */
export class PaintEraseBrush extends PaintBrush {
  override stroke(picking: Picking): void {
    const layered = this.layered;
    if (!layered || layered.base) return;
    super.stroke(picking);
  }

  protected override layerDab(layered: PaintStroke, iVerts: ArrayLike<number>, picking: Picking, k: number): void {
    const w = this.dabWeights(iVerts, picking.getIntersectionPoint(), picking.getLocalRadius2(), k, this.curve);
    layered.erase(iVerts, w);
    this.session.paint.dabDone(this.getMesh(), iVerts, false);
  }
}

/** Blur as a tool of its own (Shift over Paint swaps in the same brush with Paint's size and strength). */
export class PaintBlurTool extends PaintBlurBrush {}

/**
 * Fill: a press on the model fills the active layer (Base when that is
 * the one active, the mesh's colours when the object has no layers) with the
 * colour, as much as the mask lets it: one undo step. Dragging does
 * nothing further.
 */
export class PaintFillTool extends LayeredPaint {
  /** The fill is a step of its own, pushed when it happens. */
  override pushState(): void {
    this.layered = null;
  }

  override startSculpt(): void {
    this.fill();
  }

  override update(): void {
    // One press, one fill.
  }

  override updateContinuous(): void {
    // One press, one fill.
  }

  override stroke(): void {
    // Not a stroke tool.
  }

  /** Fill the unmasked part of the active object with the colour. Public for the Tool panel's Fill button. */
  fill(): boolean {
    const mesh = this.getMesh();
    if (!mesh) return false;
    let iVerts = this.getUnmaskedVertices();
    const hidden = Picking.hiddenVertices?.(mesh) ?? null;
    if (hidden) iVerts = iVerts.filter((v) => !hidden[v]);
    if (!iVerts.length) return false;
    const session = this.session;
    const stroke = mesh.isDynamic ? null : session.paint.startStroke(mesh);
    if (!stroke) {
      // No layers: the vendor's own fill (it pushes its own undo state).
      this.paintAllIn(iVerts);
      return true;
    }
    const mAr = mesh.getMaterials();
    const w = new Float32Array(iVerts.length);
    for (let i = 0; i < iVerts.length; i++) w[i] = mAr[iVerts[i] * 3 + 2];
    stroke.over(iVerts, w, this._color);
    stroke.end();
    session.paint.dabDone(mesh, iVerts);
    this.updateRender();
    return true;
  }

  /** The vendor's fill, over the vertices given (the hidden ones left out). */
  private paintAllIn(iVerts: Uint32Array): void {
    const mesh = this.getMesh();
    super.pushState(true);
    this.session.getStateManager().pushVertices(iVerts);
    const cAr = mesh.getColors();
    const mAr = mesh.getMaterials();
    const color = this._color;
    for (let i = 0; i < iVerts.length; i++) {
      const ind = iVerts[i] * 3;
      const f = mAr[ind + 2];
      const g = 1 - f;
      cAr[ind] = cAr[ind] * g + color[0] * f;
      cAr[ind + 1] = cAr[ind + 1] * g + color[1] * f;
      cAr[ind + 2] = cAr[ind + 2] * g + color[2] * f;
    }
    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateDrawArrays();
    this.updateRender();
  }
}

/**
 * Pick: takes the colour under the Pencil (the object's composite, as it
 * shows) as the paint colour, and keeps taking it while the press moves.
 * It is the eyedropper Alt gives Paint, as a tool of its own.
 */
export class PaintPickTool extends Paint {
  constructor(session: SculptSession) {
    super(session);
    this._pickColor = true;
  }

  override end(): void {
    super.end();
    // The vendor clears the flag when a stroke ends; for this tool it is what the tool is.
    this._pickColor = true;
  }

  override pushState(): void {
    // Sampling edits nothing: no undo step.
  }

  override stroke(): void {
    // A press samples; it never lays colour down.
  }
}

/**
 * What Project reads: the reference pictures in the view. `sample` is the
 * colour (sRGB, 0..1) of the picture drawn topmost at a point of the page
 * (client pixels), with its mirror and greyscale applied, or null where
 * no picture is. `ready` says whether any picture is in the view and has been
 * read, so the tool can say what to do first.
 */
export interface ProjectSource {
  ready(): boolean;
  sample(clientX: number, clientY: number): [number, number, number] | null;
}

/**
 * Project: paints the colours of a reference picture that is in the view onto the
 * model under the brush. For each vertex in the dab, the picture's pixel
 * under that vertex's place on screen goes through the brush's falloff and
 * strength into the active layer (or Base). Only the vertices that face the
 * camera, within the dab the Pencil touches, that a picture covers, and
 * that the camera sees: a vertex with something nearer in front of it (the
 * model's own surface, or another visible object) takes nothing.
 */
export class PaintProjectBrush extends PaintBrush {
  source: ProjectSource | null = null;
  /** Whether a vertex something nearer hides is passed by (on; the tests turn it off to time what it costs). */
  depthTest = true;
  private readonly world = vec3.create();

  constructor(session: SculptSession) {
    super(session);
    // Only what faces the camera.
    this._culling = true;
  }

  /** A stroke starts with no tiles of the last one (the depth test keeps them while a stroke goes on). */
  override pushState(force?: boolean): void {
    releaseOcclusion();
    super.pushState(force);
  }

  override end(): void {
    releaseOcclusion();
    super.end();
  }

  /** Whether the tool can project now (a picture is in the view): the shell says otherwise. */
  canProject(): boolean {
    return !!this.source?.ready();
  }

  override stroke(picking: Picking): void {
    if (!this.source) return;
    if (this.layered) {
      super.stroke(picking);
      return;
    }
    // No layers: the mesh's own colours, with the vendor's undo state.
    let iVerts = picking.getPickedVertices();
    const intensity = Math.min(1, this._intensity * Tablet.getPressureIntensity());
    this.session.getStateManager().pushVertices(iVerts);
    if (this._culling) iVerts = this.getFrontVertices(iVerts, picking.getEyeDirection());
    const hit = this.colours(iVerts, picking);
    if (!hit.ids.length) return;
    const w = this.dabWeights(hit.ids, picking.getIntersectionPoint(), picking.getLocalRadius2(), intensity, this.curve);
    const mesh = this.getMesh();
    const cAr = mesh.getColors();
    for (let k = 0; k < hit.ids.length; k++) {
      const ind = hit.ids[k] * 3;
      const f = Math.min(1, w[k]);
      const g = 1 - f;
      cAr[ind] = cAr[ind] * g + hit.rgb[k * 3] * f;
      cAr[ind + 1] = cAr[ind + 1] * g + hit.rgb[k * 3 + 1] * f;
      cAr[ind + 2] = cAr[ind + 2] * g + hit.rgb[k * 3 + 2] * f;
    }
    mesh.updateDuplicateColorsAndMaterials(hit.ids);
    if (mesh.isUsingDrawArrays()) mesh.updateDrawArrays(mesh.getFacesFromVertices(hit.ids));
  }

  protected override layerDab(layered: PaintStroke, iVerts: ArrayLike<number>, picking: Picking, k: number): void {
    const hit = this.colours(iVerts, picking);
    if (!hit.ids.length) return;
    const w = this.dabWeights(hit.ids, picking.getIntersectionPoint(), picking.getLocalRadius2(), k, this.curve);
    layered.over(hit.ids, w, hit.rgb, true);
    this.session.paint.dabDone(this.getMesh(), hit.ids, false);
  }

  /** The vertices of the dab that a picture covers and the camera sees, with the linear colour of the picture under each. */
  private colours(iVerts: ArrayLike<number>, picking: Picking): { ids: Uint32Array; rgb: Float32Array } {
    const src = this.source!;
    const session = this.session;
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const m = mesh.getMatrix();
    const cam = session.getCamera();
    const ratio = session.getPixelRatio();
    const box = session.getCanvas().getBoundingClientRect();
    const ids: number[] = [];
    const rgb: number[] = [];
    const out = this.world;
    // The mirrored dab is picked with the mirrored ray, so what it faces is checked against the real camera too.
    const eye = this.depthTest && picking === session.getPickingSymmetry() ? cam.eye() : null;
    const nAr = mesh.getNormals();
    const here = vec3.create();
    // The camera's matrix once for the dab (its `project` makes it, and inverts another, for every vertex).
    const S = cam.screenMatrix();
    const H = cam.canvasHeight();
    for (let i = 0; i < iVerts.length; i++) {
      const v = iVerts[i];
      out[0] = vAr[v * 3];
      out[1] = vAr[v * 3 + 1];
      out[2] = vAr[v * 3 + 2];
      vec3.transformMat4(out, out, m as unknown as Float32Array);
      const w = S[3] * out[0] + S[7] * out[1] + S[11] * out[2] + S[15];
      const px = (S[0] * out[0] + S[4] * out[1] + S[8] * out[2] + S[12]) / w;
      const py = H - (S[1] * out[0] + S[5] * out[1] + S[9] * out[2] + S[13]) / w;
      const c = src.sample(box.left + px / ratio, box.top + py / ratio);
      if (!c) continue;
      if (eye) {
        vec3.sub(here, eye, out);
        const nx = nAr[v * 3];
        const ny = nAr[v * 3 + 1];
        const nz = nAr[v * 3 + 2];
        const wx = m[0] * nx + m[4] * ny + m[8] * nz;
        const wy = m[1] * nx + m[5] * ny + m[9] * nz;
        const wz = m[2] * nx + m[6] * ny + m[10] * nz;
        if (wx * here[0] + wy * here[1] + wz * here[2] <= 0) continue;
      }
      ids.push(v);
      rgb.push(linear(c[0]), linear(c[1]), linear(c[2]));
    }
    if (this.depthTest && ids.length) {
      // What the camera does not see at a vertex's place on screen takes nothing: tested against the
      // object's own surface and the other visible objects, only for the vertices a picture covers.
      const hidden = hiddenFromCamera(session, mesh, ids, Math.sqrt(picking.getLocalRadius2()));
      let k = 0;
      for (let i = 0; i < ids.length; i++) {
        if (hidden[i]) continue;
        ids[k] = ids[i];
        rgb[k * 3] = rgb[i * 3];
        rgb[k * 3 + 1] = rgb[i * 3 + 1];
        rgb[k * 3 + 2] = rgb[i * 3 + 2];
        k++;
      }
      ids.length = k;
      rgb.length = k * 3;
    }
    return { ids: Uint32Array.from(ids), rgb: Float32Array.from(rgb) };
  }
}
