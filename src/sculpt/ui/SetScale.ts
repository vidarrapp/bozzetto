import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from '../bridge/SculptSession';
import { parseTyped } from '../../ui/sliderEntry';
import { formatUnitless } from '../../viewer/units';

/** What the banner asks of the mount: the scaling itself, and the dismissal kept with the scene. */
export interface ScaleBannerHooks<T = SculptMesh> {
  /** Put the scene on real units: `subject` is `cm` tall, everything else in proportion. */
  apply(subject: T, cm: number): void;
  /** The offer was turned down: the scene record keeps that (SavedScene.scaleDismissed). */
  dismissed(): void;
}

/**
 * What the banner measures and offers, so one banner serves Sculpt's scene
 * (its objects) and the editor's project (its one model, whatever frame is
 * showing): the choices, their names and heights in their own units, and
 * whether the offer stands at all.
 */
export interface ScaleSubjects<T> {
  /** The objects to pick from, the largest picked to start with. */
  list(): T[];
  name(subject: T): string;
  /** Its height now, in the scene's own units. */
  height(subject: T): number;
  /** Its size, for picking the largest (the diagonal of its box). */
  size(subject: T): number;
  /** Whether the offer stands: no units yet, and not turned down. */
  needed(): boolean;
}

/** The banner's words, where a project is not a scene. */
export interface ScaleBannerWords {
  /** The line along the top. */
  intro: string;
  /** Not now's tooltip. */
  dismiss: string;
  /** Under the form. */
  hint: string;
}

const SCENE_WORDS: ScaleBannerWords = {
  intro: 'This scene has no real-world scale yet. Set it to work in centimetres.',
  dismiss: 'Keep the scene as it is; this is not offered again for it',
  hint: 'Everything is scaled by the same amount and set on the floor. Undo history starts over from here.',
};

/** Sculpt's scene as the banner's subjects: its objects, by their world boxes. */
export function sceneSubjects(session: SculptSession): ScaleSubjects<SculptMesh> {
  return {
    list: () => [...session.getMeshes()],
    name: (m) => session.getMeshName(m),
    height: (m) => {
      const b = m.computeWorldBound();
      return b[4] - b[1];
    },
    size: (m) => {
      const b = m.computeWorldBound();
      return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    },
    needed: () => !session.getUnits() && !session.isScaleDismissed(),
  };
}

/** The tallest a typed height may be: a 100 m object is past anything sculpted here. */
const MAX_CM = 10000;

/**
 * Set scale (owner decision): a scene from before real units opens exactly
 * as it was, on its old canonical scale with the floor following it, and
 * this banner offers - once, until dismissed - to put it on real units.
 * Pick an object (the largest to start with), type how tall it really is
 * in centimetres, and the whole scene is scaled by the one factor that
 * makes it so, set on the floor and marked (the mount's apply). The banner
 * then goes, as it does for a scene that has its scale already.
 */
export class ScaleBanner<T = SculptMesh> {
  private readonly root: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly select: HTMLSelectElement;
  private readonly height: HTMLInputElement;
  private readonly note: HTMLSpanElement;
  private readonly error: HTMLDivElement;
  private choices: T[] = [];

  constructor(
    private readonly subjects: ScaleSubjects<T>,
    private readonly hooks: ScaleBannerHooks<T>,
    words: ScaleBannerWords = SCENE_WORDS,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'scale-banner';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Set scale');
    const intro = document.createElement('span');
    intro.className = 'scale-banner__words';
    intro.textContent = words.intro;
    const open = button('Set scale', 'scale-banner__open');
    const dismiss = button('Not now', 'scale-banner__dismiss');
    dismiss.title = words.dismiss;
    const head = document.createElement('div');
    head.className = 'scale-banner__head';
    head.append(intro, open, dismiss);

    // The form: which object, and how tall it really is.
    this.form = document.createElement('form');
    this.form.className = 'scale-banner__form';
    this.form.hidden = true;
    this.select = document.createElement('select');
    this.select.className = 'scale-banner__object';
    this.select.setAttribute('aria-label', 'Object');
    this.height = document.createElement('input');
    this.height.className = 'scale-banner__height';
    this.height.type = 'text';
    this.height.inputMode = 'decimal';
    this.height.setAttribute('aria-label', 'Real height in centimetres');
    this.height.placeholder = 'e.g. 25';
    // Typing a height must not reach the sculpt hotkeys.
    this.height.addEventListener('keydown', (e) => e.stopPropagation());
    this.note = document.createElement('span');
    this.note.className = 'scale-banner__note';
    const unit = document.createElement('span');
    unit.textContent = 'cm tall';
    const apply = button('Apply', 'scale-banner__apply');
    apply.type = 'submit';
    const cancel = button('Cancel', 'scale-banner__cancel');
    this.error = document.createElement('div');
    this.error.className = 'scale-banner__error';
    this.error.hidden = true;
    const row = document.createElement('div');
    row.className = 'scale-banner__row';
    row.append(this.select, this.height, unit, apply, cancel);
    const hint = document.createElement('div');
    hint.className = 'scale-banner__hint';
    hint.textContent = words.hint;
    this.form.append(row, this.note, hint, this.error);
    this.select.addEventListener('change', () => this.describe());

    open.addEventListener('click', () => this.openForm());
    cancel.addEventListener('click', () => {
      this.form.hidden = true;
      open.hidden = false;
    });
    dismiss.addEventListener('click', () => {
      this.hooks.dismissed();
      this.refresh();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.root.append(head, this.form);
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.refresh();
  }

  /** Shown for a scene without units that has not turned the offer down; gone otherwise. */
  refresh(): void {
    const show = this.subjects.needed();
    this.root.hidden = !show;
    if (!show) {
      this.form.hidden = true;
      this.root.querySelector<HTMLButtonElement>('.scale-banner__open')!.hidden = false;
    }
  }

  isShown(): boolean {
    return !this.root.hidden;
  }

  /** The form, with the objects listed and the largest picked. */
  openForm(): void {
    this.choices = this.subjects.list();
    let largest = 0;
    let most = -1;
    this.choices.forEach((m, i) => {
      const d = this.subjects.size(m);
      if (d > most) {
        most = d;
        largest = i;
      }
    });
    this.select.replaceChildren(
      ...this.choices.map((m, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = this.subjects.name(m);
        return o;
      }),
    );
    this.select.value = String(largest);
    this.height.value = '';
    this.error.hidden = true;
    this.root.querySelector<HTMLButtonElement>('.scale-banner__open')!.hidden = true;
    this.form.hidden = false;
    this.describe();
    this.height.focus();
  }

  /** Under the row: how tall the object is now, in the scene's own units. */
  private describe(): void {
    const subject = this.choices[Number(this.select.value)];
    if (subject === undefined) return;
    this.note.textContent = `Now ${formatUnitless(this.subjects.height(subject))} tall.`;
  }

  private submit(): void {
    const subject = this.choices[Number(this.select.value)];
    const cm = parseTyped(this.height.value.replace(/cm$/i, ''));
    if (subject === undefined || !this.subjects.list().includes(subject)) {
      this.fail('Pick an object in the scene.');
      return;
    }
    if (!(cm > 0) || cm > MAX_CM) {
      this.fail(`Type a height in centimetres, above 0 and up to ${MAX_CM}.`);
      return;
    }
    this.hooks.apply(subject, cm);
    this.refresh();
  }

  private fail(text: string): void {
    this.error.textContent = text;
    this.error.hidden = false;
  }

  dispose(): void {
    this.root.remove();
  }
}

function button(text: string, className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `sculpt-toast__btn ${className}`;
  b.textContent = text;
  return b;
}
