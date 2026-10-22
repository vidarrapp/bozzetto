import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { parseTyped } from '../../ui/sliderEntry';
import { formatCentimetres, trimDecimals, type Units } from '../../viewer/units';

/**
 * The channel box (owner request, after Maya's): the active object's own
 * transform as nine typed rows - Translate, Rotate, Scale, each X Y Z -
 * shown in the Tool panel while the Select tool or the gizmo is up.
 *
 * Values are the object's matrix decomposed: its position (centimetres on
 * real units, plain numbers in a scene from before them), an Euler XYZ
 * rotation in degrees, and its scale as a factor. With several objects
 * selected a value they share shows and one that differs is left blank; a
 * typed value is set, as given, on every one of them, each keeping its
 * other channels. Each commit is one undo step, the gizmo's own kind
 * (TransformGizmo.applyMatrices).
 *
 * Nothing tells the box a matrix moved (the gizmo, undo, Set scale and the
 * rest each go their own way), so it is polled: refresh() reads the
 * objects' sixteen numbers and touches the DOM only when they changed. The
 * owner calls it once a frame, and only while the box can be seen.
 */

export interface ChannelHooks {
  /** What the box shows and edits: the active object first, then the rest of the selection. */
  targets(): SculptMesh[];
  /** Whether the targets take edits (the gizmo's rule: not hidden, not locked). */
  editable(): boolean;
  units(): Units | null;
  /** Set these matrices as one undo step. */
  commit(entries: Array<{ mesh: SculptMesh; after: ArrayLike<number> }>): void;
}

type Kind = 't' | 'r' | 's';
interface Channel {
  kind: Kind;
  axis: 0 | 1 | 2;
  input: HTMLInputElement;
  unit: HTMLSpanElement;
}

const AXES = ['X', 'Y', 'Z'] as const;
const KINDS: Array<[Kind, string]> = [
  ['t', 'Translate'],
  ['r', 'Rotate'],
  ['s', 'Scale'],
];
const DEG = 180 / Math.PI;

/** One object's channels: position, Euler XYZ (radians), scale. */
interface Trs {
  t: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
}

const mScratch = new Matrix4();
const pScratch = new Vector3();
const qScratch = new Quaternion();
const sScratch = new Vector3();
const eScratch = new Euler();

function decompose(m: ArrayLike<number>): Trs {
  mScratch.fromArray(Array.from(m));
  mScratch.decompose(pScratch, qScratch, sScratch);
  eScratch.setFromQuaternion(qScratch, 'XYZ');
  return {
    t: [pScratch.x, pScratch.y, pScratch.z],
    r: [eScratch.x, eScratch.y, eScratch.z],
    s: [sScratch.x, sScratch.y, sScratch.z],
  };
}

function compose(c: Trs): number[] {
  pScratch.set(...c.t);
  qScratch.setFromEuler(eScratch.set(c.r[0], c.r[1], c.r[2], 'XYZ'));
  sScratch.set(...c.s);
  return mScratch.compose(pScratch, qScratch, sScratch).toArray();
}

export class ChannelBox {
  readonly el: HTMLDivElement;
  private readonly channels: Channel[] = [];
  /** The matrices and the units the fields were last written from. */
  private seen: SculptMesh[] = [];
  private seenValues = new Float64Array(0);
  private seenUnits: Units | null | undefined = undefined;
  private seenEditable: boolean | undefined = undefined;
  /** The text a field held when it took focus, for Escape and a no-op commit. */
  private focusText = '';

  constructor(private readonly hooks: ChannelHooks) {
    this.el = document.createElement('div');
    this.el.className = 'channel-box';
    for (const [kind, name] of KINDS) {
      for (const [axis, letter] of AXES.entries()) {
        const row = document.createElement('label');
        row.className = 'channel-box__row';
        row.dataset.channel = `${kind}${letter.toLowerCase()}`;
        const label = document.createElement('span');
        label.className = 'channel-box__label';
        label.textContent = `${name} ${letter}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.className = 'channel-box__value';
        input.setAttribute('aria-label', `${name} ${letter}`);
        const unit = document.createElement('span');
        unit.className = 'channel-box__unit';
        row.append(label, input, unit);
        this.el.appendChild(row);
        const ch: Channel = { kind, axis: axis as 0 | 1 | 2, input, unit };
        this.channels.push(ch);
        this.wire(ch);
      }
    }
    this.refresh(true);
  }

  private wire(ch: Channel): void {
    const { input } = ch;
    let justFocused = false;
    input.addEventListener('focus', () => {
      this.focusText = input.value;
      input.select();
      justFocused = true;
    });
    // The press that focused a field would drop the selection on its
    // mouseup; keep the whole value selected then, and only then, so a
    // later click still places the caret.
    input.addEventListener('mouseup', (e) => {
      if (justFocused) e.preventDefault();
      justFocused = false;
    });
    input.addEventListener('blur', () => this.commitTyped(ch));
    input.addEventListener('keydown', (e) => {
      // Ours alone: nothing in the box is a hotkey.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitTyped(ch);
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = this.focusText;
        input.blur();
      } else if (e.key === 'Tab') {
        // Through the nine fields, wrapping, rather than off into the panel.
        e.preventDefault();
        const i = this.channels.indexOf(ch);
        const n = this.channels.length;
        this.commitTyped(ch);
        this.channels[(i + (e.shiftKey ? n - 1 : 1)) % n].input.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = this.step(ch.kind) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        this.apply(ch, (v) => v + step);
        this.refresh(true, true);
        this.focusText = input.value;
        input.select();
      }
    });
  }

  /** A nudge, in the field's own terms: 1 cm (0.1 unitless), 1 degree, 0.1 scale. */
  private step(kind: Kind): number {
    if (kind === 'r') return 1;
    if (kind === 's') return 0.1;
    return this.hooks.units() ? 1 : 0.1;
  }

  /** Commit what the field holds, if it changed: a number sets the channel, anything else is refused. */
  private commitTyped(ch: Channel): void {
    const text = ch.input.value;
    if (text === this.focusText) return;
    this.focusText = text;
    const v = parseTyped(text);
    if (Number.isFinite(v)) this.apply(ch, () => v);
    // Refused or applied, the fields say what the objects now hold.
    this.refresh(true, true);
    this.focusText = ch.input.value;
  }

  /**
   * Set one channel on every target from its current value (in the
   * field's terms: cm or units, degrees, a factor), one undo step. A scale
   * at or below zero is refused for all of them: zero collapses the object
   * and a negative one mirrors it (the gizmo's rule).
   */
  private apply(ch: Channel, next: (current: number) => number): void {
    if (!this.hooks.editable()) return;
    const targets = this.hooks.targets();
    if (!targets.length) return;
    const toField = this.fieldScale(ch.kind);
    const entries: Array<{ mesh: SculptMesh; after: number[] }> = [];
    for (const mesh of targets) {
      const trs = decompose(mesh.getMatrix());
      const v = next(trs[ch.kind][ch.axis] * toField);
      if (!Number.isFinite(v)) return;
      if (ch.kind === 's' && !(v > 0)) return;
      trs[ch.kind][ch.axis] = v / toField;
      entries.push({ mesh, after: compose(trs) });
    }
    this.hooks.commit(entries);
  }

  /** Engine value to field value: radians to degrees; a translate is centimetres (or units) as it stands. */
  private fieldScale(kind: Kind): number {
    return kind === 'r' ? DEG : 1;
  }

  private format(kind: Kind, engine: number): string {
    if (kind === 'r') return trimDecimals(engine * DEG, 1);
    if (kind === 's') return trimDecimals(engine, 3);
    return this.hooks.units() ? formatCentimetres(engine) : trimDecimals(engine, 3);
  }

  /**
   * Follow the objects: cheap when nothing moved (a compare of their
   * matrices). A field being typed in keeps its text unless `typed`
   * (a commit of its own).
   */
  refresh(force = false, typed = false): void {
    const targets = this.hooks.targets();
    const units = this.hooks.units();
    const editable = this.hooks.editable();
    const n = targets.length * 16;
    let same =
      !force &&
      units === this.seenUnits &&
      editable === this.seenEditable &&
      targets.length === this.seen.length &&
      this.seenValues.length === n &&
      targets.every((m, i) => m === this.seen[i]);
    if (same) {
      for (let i = 0; i < targets.length && same; i++) {
        const m = targets[i].getMatrix();
        for (let k = 0; k < 16; k++) {
          if (m[k] !== this.seenValues[i * 16 + k]) {
            same = false;
            break;
          }
        }
      }
    }
    if (same) return;
    this.seen = [...targets];
    this.seenUnits = units;
    this.seenEditable = editable;
    this.seenValues = new Float64Array(n);
    targets.forEach((m, i) => this.seenValues.set(m.getMatrix(), i * 16));

    const all = targets.map((m) => decompose(m.getMatrix()));
    const focused = document.activeElement;
    for (const ch of this.channels) {
      const texts = new Set(all.map((trs) => this.format(ch.kind, trs[ch.kind][ch.axis])));
      const text = texts.size === 1 ? [...texts][0] : '';
      ch.input.placeholder = targets.length ? 'mixed' : '';
      ch.input.disabled = !targets.length || !editable;
      ch.unit.textContent = ch.kind === 'r' ? '°' : ch.kind === 't' && units ? 'cm' : '';
      if (ch.input === focused && !typed) continue;
      if (ch.input.value !== text) ch.input.value = text;
    }
  }

  /** The text each field shows, for the tests: tx ty tz rx ry rz sx sy sz. */
  values(): string[] {
    return this.channels.map((c) => c.input.value);
  }

  dispose(): void {
    this.el.remove();
  }
}
