import { headsText, type ProportionGuide } from '../bridge/guide';
import type { Vec3 } from '../bridge/measure';

/** What the guide's drawing needs of the overlay it shares with the calipers (MeasureOverlay): its canvas, its camera and its label boxes. */
export interface GuideHost {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** A world point on the page, in client px, or null behind the camera. */
  screenOf(world: Vec3): [number, number] | null;
  /** The camera's right-hand side along the floor, a unit vector (x, z). */
  right(): [number, number];
  /** A box of the overlay for `key`, made when it is not there yet and marked as still in use. */
  box(key: string, tag: 'div' | 'button', className: string): HTMLElement;
  /** The interface's orange. */
  orange: string;
  /** The faint shade under a light line. */
  halo: string;
  grey: string;
}

const TICK = 12;
const LANDMARK_TICK = 10;
const TARGET_HALF = 30;

/** A length as the guide says it: centimetres, to one decimal, without a trailing ".0". */
export const cmText = (cm: number): string => `${headsText(cm)} cm`;

/**
 * The proportion guide drawn over the view (docs/plans/reference-and-measure.md): a vertical
 * line beside the subject, from its bottom to its top, standing on the floor at the side the
 * camera's right-hand side points to (so it turns with the view and always reads), with its
 * height at the top, a numbered tick every head from the top, the canon's faint target line and,
 * when asked for, the canon's landmark ticks, each labelled on hover or tap. Grey; orange only
 * for the tick that was tapped. Drawn on the calipers' canvas, so no render pass has it and no
 * saved picture holds it.
 */
export function drawGuide(guide: ProportionGuide, host: GuideHost): void {
  const b = guide.bounds();
  if (!b) return;
  const height = Math.max(0, b.max[1] - b.min[1]);
  if (!(height > 0)) return;
  const [rx, rz] = host.right();
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const half = Math.abs(rx) * ((b.max[0] - b.min[0]) / 2) + Math.abs(rz) * ((b.max[2] - b.min[2]) / 2);
  const gap = Math.max(6, height * 0.08);
  const gx = cx + rx * (half + gap);
  const gz = cz + rz * (half + gap);
  const at = (cm: number): [number, number] | null => host.screenOf([gx, b.min[1] + cm, gz]);
  const foot = at(0);
  const top = at(height);
  if (!foot || !top) return;
  // For the tests: where the guide stands in the world, beside the subject.
  const root = host.box('guide-root', 'div', 'guide-root');
  root.dataset.role = 'guide-root';
  root.dataset.at = `${gx.toFixed(2)},${gz.toFixed(2)}`;

  const { ctx } = host;
  const stroke = (a: [number, number], c: [number, number], color: string, dashed = false, alpha = 1): void => {
    ctx.save();
    ctx.setLineDash(dashed ? [4, 4] : []);
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.strokeStyle = host.halo;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };
  stroke(foot, top, host.grey);
  stroke([foot[0] - TICK, foot[1]], [foot[0] + TICK, foot[1]], host.grey);

  const place = (el: HTMLElement, x: number, y: number): void => {
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  };

  // The height at the top, and how many heads that is.
  const count = guide.headCount();
  const total = host.box('guide-height', 'div', 'guide-label');
  total.dataset.role = 'guide-height';
  let value = total.querySelector<HTMLElement>('.guide-label__value');
  let heads = total.querySelector<HTMLElement>('.guide-label__heads');
  if (!value || !heads) {
    total.replaceChildren();
    value = document.createElement('span');
    value.className = 'guide-label__value';
    value.dataset.role = 'guide-value';
    heads = document.createElement('span');
    heads.className = 'guide-label__heads';
    heads.dataset.role = 'guide-heads';
    total.append(value, heads);
  }
  value.textContent = cmText(height);
  heads.textContent = count === null ? '' : `${headsText(count)} heads`;
  heads.hidden = count === null;
  place(total, Math.min(host.width - total.offsetWidth / 2 - 6, Math.max(total.offsetWidth / 2 + 6, top[0])), Math.max(total.offsetHeight + 6, top[1] - 8));

  // A numbered tick every head, counted from the top.
  guide.tickHeights().forEach((cm, i) => {
    const p = at(cm);
    if (!p) return;
    stroke([p[0] - TICK, p[1]], p, host.grey);
    const el = host.box(`guide-tick-${i + 1}`, 'div', 'guide-tick');
    el.dataset.role = 'guide-tick';
    el.dataset.n = String(i + 1);
    el.textContent = String(i + 1);
    place(el, p[0] - TICK - 3, p[1]);
  });

  // The canon's target line: faint, a button so it can be picked.
  const target = guide.targetHeight();
  if (target !== null) {
    const p = at(target);
    if (p) {
      const picked = guide.selected === 'canon';
      stroke([p[0] - TARGET_HALF, p[1]], [p[0] + TARGET_HALF, p[1]], picked ? host.orange : host.grey, true, picked ? 1 : 0.55);
      const el = host.box('guide-canon', 'button', 'guide-canon');
      el.dataset.role = 'guide-canon';
      el.dataset.cm = target.toFixed(2);
      el.classList.toggle('guide-pick--on', picked);
      el.textContent = `Canon ${headsText(guide.canonHeads())}`;
      (el as HTMLButtonElement).type = 'button';
      el.title = 'Where the canon says the top should be';
      bindPick(el, () => guide.select('canon'));
      place(el, p[0] + TARGET_HALF + 4, p[1]);
    }
  }

  // The canon's landmarks, to the right of the line; a label on hover or tap.
  if (guide.landmarks) {
    for (const l of guide.landmarkHeights()) {
      const p = at(l.cm);
      if (!p) continue;
      const picked = guide.selected === l.id;
      stroke(p, [p[0] + LANDMARK_TICK, p[1]], picked ? host.orange : host.grey);
      const el = host.box(`guide-landmark-${l.id}`, 'button', 'guide-landmark');
      el.dataset.role = 'guide-landmark';
      el.dataset.id = l.id;
      el.dataset.cm = l.cm.toFixed(2);
      el.classList.toggle('guide-pick--on', picked);
      (el as HTMLButtonElement).type = 'button';
      el.title = l.label;
      el.setAttribute('aria-label', l.label);
      let name = el.querySelector<HTMLElement>('.guide-landmark__label');
      if (!name) {
        name = document.createElement('span');
        name.className = 'guide-landmark__label';
        name.dataset.role = 'guide-landmark-label';
        el.appendChild(name);
      }
      name.textContent = l.label;
      bindPick(el, () => guide.select(l.id));
      place(el, p[0] + LANDMARK_TICK + 6, p[1]);
    }
  }
}

/** A tap or a click on a box of the guide picks its tick; bound once. */
function bindPick(el: HTMLElement, pick: () => void): void {
  const holder = el as HTMLElement & { __pick?: () => void };
  holder.__pick = pick;
  if (el.dataset.bound === '1') return;
  el.dataset.bound = '1';
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    holder.__pick?.();
  });
  // A name shows while a mouse is over its tick; a touch leaves no hover behind to hide it again.
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') el.classList.add('guide-landmark--hover');
  });
  el.addEventListener('pointerleave', () => el.classList.remove('guide-landmark--hover'));
}
