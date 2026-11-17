import type { SculptSession } from '../bridge/SculptSession';
import { settings } from '../../ui/settings';
import './details.css';

/**
 * The details overlay: plain text over the top left of the 3D view, one fact
 * to a line, no box and no background (details.css). The object's numbers
 * that used to stand in the title strip, and more: what the person sculpting
 * wants to glance at without opening a panel. View > Details shows and hides
 * it, and the choice is kept on the device (settings 'details').
 *
 * It takes no input at all (pointer-events none in the sheet), so the Pencil
 * and fingers reach the model through it. It is written only when its text
 * changed: `set` compares a signature of the lines with the last one, and the
 * mode calls it on its events and on the readout's slow timer, never per frame.
 */

export interface DetailLine {
  /** A stable name for the fact (tests and the sheet read it): name, tris, quads, verts, level... */
  id: string;
  /** The label before the value ("Tris"); none for a name, which stands alone. */
  key?: string;
  value: string;
}

export class DetailsOverlay {
  readonly el: HTMLDivElement;
  private sig = '';
  private readonly offSettings: () => void;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'bz-details';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = !DetailsOverlay.wanted();
    document.body.appendChild(this.el);
    this.offSettings = settings.onChange(() => {
      const on = DetailsOverlay.wanted();
      if (this.el.hidden === !on) return;
      this.el.hidden = !on;
    });
  }

  /** Whether View > Details is on. */
  static wanted(): boolean {
    return settings.get('details') === 'on';
  }

  /** Whether the overlay is showing, so the mode can skip the work of its numbers when it is not. */
  isOn(): boolean {
    return !this.el.hidden;
  }

  /** Put the lines up; nothing is touched when they are the ones already there. */
  set(lines: readonly DetailLine[]): void {
    let sig = '';
    for (const l of lines) sig += `${l.id}\u0001${l.key ?? ''}\u0001${l.value}\u0002`;
    if (sig === this.sig) return;
    this.sig = sig;
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      const row = document.createElement('div');
      row.className = 'bz-details__line';
      row.dataset.fact = l.id;
      if (l.key) {
        const k = document.createElement('span');
        k.className = 'bz-details__key';
        k.textContent = l.key;
        row.appendChild(k);
      }
      const v = document.createElement('span');
      v.className = l.key ? 'bz-details__val' : 'bz-details__name';
      v.textContent = l.value;
      row.appendChild(v);
      frag.appendChild(row);
    }
    this.el.replaceChildren(frag);
  }

  dispose(): void {
    this.offSettings();
    this.el.remove();
  }
}

/** A size in centimetres to a tenth. */
const cm1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

/** The state a Sculpt reading is cached on, so a count that costs a scan is not made again for nothing. */
interface GroupCache {
  mesh: object | null;
  version: number;
  hidden: number;
}

/**
 * Sculpt's facts, one reader per session. Cheap on purpose: counts come off
 * the mesh, the size off its octree's bound, the hidden groups are counted
 * only when the groups record moved, and the mask is one pass over the
 * vertices' mask values (no allocation), made when the overlay asks - the
 * mode asks on its events and twice a second, never per frame.
 */
export function makeSculptDetails(session: SculptSession): () => DetailLine[] {
  const groups: GroupCache = { mesh: null, version: -1, hidden: 0 };
  return () => {
    const mesh = session.getMesh();
    if (!mesh) return [{ id: 'name', value: 'Empty scene' }];
    const lines: DetailLine[] = [{ id: 'name', value: session.activeName() }];
    const tris = mesh.getNbTriangles();
    lines.push({ id: 'tris', key: 'Tris', value: tris.toLocaleString('en-US') });
    const quads = mesh.getNbQuads();
    if (quads > 0) lines.push({ id: 'quads', key: 'Quads', value: quads.toLocaleString('en-US') });
    const nbV = mesh.getNbVertices();
    lines.push({ id: 'verts', key: 'Verts', value: nbV.toLocaleString('en-US') });
    const levels = session.getLevels();
    if (levels && levels.levels > 0) {
      lines.push({ id: 'level', key: 'Level', value: `${levels.sel + 1} of ${levels.levels}` });
    }
    const all = session.getMeshes().length;
    const picked = session.getSelectedMeshes().length;
    lines.push({ id: 'objects', key: 'Objects', value: picked > 1 ? `${all}, ${picked} selected` : String(all) });
    // Real units only: a scene from before them has no centimetres to say.
    if (session.getUnits() === 'cm') {
      const b = mesh.computeWorldBound();
      const w = b[3] - b[0];
      const h = b[4] - b[1];
      const d = b[5] - b[2];
      if (Number.isFinite(w + h + d)) lines.push({ id: 'size', key: 'Size', value: `${cm1(h)} × ${cm1(w)} × ${cm1(d)} cm` });
    }
    if (session.getSymmetry()) {
      lines.push({ id: 'symmetry', key: 'Symmetry', value: session.getSymmetryAxis().toUpperCase() });
    }
    const mat = mesh.getMaterials();
    let masked = 0;
    for (let i = 0, at = 2; i < nbV; i++, at += 3) if (mat[at] < 0.5) masked++;
    if (masked > 0) {
      const pct = Math.round((masked / nbV) * 100);
      lines.push({ id: 'masked', key: 'Masked', value: pct < 1 ? 'under 1%' : `${pct}%` });
    }
    const v = session.groups.version(mesh);
    if (groups.mesh !== mesh || groups.version !== v) {
      groups.mesh = mesh;
      groups.version = v;
      let n = 0;
      for (const h of session.groups.hiddenGroups(mesh)) if (h) n++;
      groups.hidden = n;
    }
    if (groups.hidden > 0) lines.push({ id: 'hidden', key: 'Hidden groups', value: String(groups.hidden) });
    if (session.layers.has(mesh)) {
      lines.push({ id: 'layer', key: 'Layer', value: session.layers.active(mesh)?.name ?? 'Base' });
    }
    return lines;
  };
}
