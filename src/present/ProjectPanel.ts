import { SidePanel } from '../sculpt/ui/SidePanel';
import { numberedRange, section } from '../ui/Panel';
import { div, labelRow, selectEl } from '../ui/dom';
import { VISIBILITY_HINT, type Visibility } from '../admin/api';
import { stageIndexAt, type Stage } from '../admin/projectEdit';
import type { ProjectMode } from '../types/manifest';

/**
 * The Project tab of the owner's Present page for a published frame
 * project (present/): what the editor's sidebar had as Settings, Stages
 * and Save thumbnail, as a left-hand tab. It holds the working copy of
 * what is edited here (title, mode, visibility, frames a second, the stages)
 * and says when something changed; saving it is the page's one Save. Create
 * opens it with no project on the site yet: no visibility, no card picture.
 */

export interface ProjectValues {
  title: string;
  /** Timelapse (frames, a rate, stages) or Model (one still thing). */
  mode: ProjectMode;
  /** Null where the project is not on the site yet: Create makes it private, and says so on Save. */
  visibility: Visibility | null;
  fps: number;
  /** In frame order; a stage with no name is dropped when saved. */
  stages: Stage[];
}

export interface ProjectHooks {
  /** The picture on the gallery card: for a project that is on the site. */
  card: boolean;
  /** Whether there are frames to stand on (stages and the card picture need one). */
  hasFrames(): boolean;
  /** The mode was changed: what plays follows. */
  modeChanged(mode: ProjectMode): void;
  /** The frame on show. */
  frameAt(): number;
  /** Go to a frame (a stage's row). */
  seek(frame: number): void;
  /** The stage list changed: the viewer and the transport follow. */
  stagesChanged(stages: Stage[]): void;
  fpsChanged(fps: number): void;
  /** Anything was edited. */
  edited(): void;
  /** Card picture: the frame on show goes to the gallery card. */
  useFrame(): Promise<void>;
}

export class ProjectPanel extends SidePanel {
  readonly values: ProjectValues;
  private readonly hooks: ProjectHooks;
  private readonly list = div('bz-stages');
  private readonly none = document.createElement('p');
  private readonly addBtn = button('Add stage here');
  private readonly removeBtn = button('Remove');
  private readonly fields = div('bz-stagefields');
  private readonly nameInput = textInput('Stage name');
  private readonly descInput = textInput('Note under the name');
  private readonly cardBtn = button('Use this frame');
  private fpsRow: HTMLElement | null = null;
  private stagesSec: HTMLElement | null = null;
  private rows: Array<{ row: HTMLButtonElement; name: HTMLElement; stage: Stage }> = [];
  /** The stage the name and note fields are bound to. */
  private bound: Stage | null = null;

  constructor(values: ProjectValues, hooks: ProjectHooks) {
    super({ id: 'project', title: 'Project', side: 'left', variant: 'panel--project', collapsed: true });
    this.values = { ...values, stages: values.stages.map((s) => ({ ...s })) };
    this.hooks = hooks;
    this.setHeading(values.title);
    this.buildSettings();
    this.buildStages();
    if (hooks.card) this.buildCard();
    this.setMode(values.mode);
    this.syncFrame(hooks.frameAt());
  }

  private buildSettings(): void {
    const sec = section(this.body, 'Settings');
    const title = textInput('Title');
    title.setAttribute('aria-label', 'Title');
    title.value = this.values.title;
    title.addEventListener('input', () => {
      this.values.title = title.value;
      this.setHeading(title.value.trim() || 'Untitled');
      this.hooks.edited();
    });
    const mode = selectEl(
      [
        ['timelapse', 'Timelapse'],
        ['model', 'Model'],
      ],
      this.values.mode,
    );
    mode.setAttribute('aria-label', 'Mode');
    mode.addEventListener('change', () => {
      this.values.mode = mode.value === 'model' ? 'model' : 'timelapse';
      this.setMode(this.values.mode);
      this.hooks.modeChanged(this.values.mode);
      this.hooks.edited();
    });
    const titleRow = labelRow('Title', title);
    titleRow.classList.add('bz-field');
    sec.append(titleRow, labelRow('Mode', mode));
    if (this.values.visibility !== null) {
      const vis = selectEl(
        [
          ['public', 'Public'],
          ['private', 'Private'],
        ],
        this.values.visibility,
      );
      vis.setAttribute('aria-label', 'Visibility');
      vis.title = VISIBILITY_HINT;
      vis.addEventListener('change', () => {
        this.values.visibility = vis.value === 'private' ? 'private' : 'public';
        this.hooks.edited();
      });
      sec.appendChild(labelRow('Visibility', vis));
    }
    {
      const fps = numberedRange(
        'Frames per second',
        1,
        30,
        1,
        this.values.fps,
        (v) => {
          this.values.fps = v;
          this.hooks.fpsChanged(v);
          this.hooks.edited();
          return String(v);
        },
        { limits: { min: 1, max: 30 } },
      );
      fps.input.setAttribute('aria-label', 'Frames per second');
      this.fpsRow = fps.row;
      sec.appendChild(fps.row);
    }
  }

  /** A model has no frames a second and no stages. */
  private setMode(mode: ProjectMode): void {
    const timelapse = mode === 'timelapse';
    if (this.fpsRow) this.fpsRow.hidden = !timelapse;
    if (this.stagesSec) this.stagesSec.hidden = !timelapse;
  }

  /** Frames came or went: the stage buttons and the card picture follow. */
  refreshFrames(): void {
    this.cardBtn.disabled = !this.hooks.hasFrames();
    this.syncFrame(this.hooks.frameAt());
  }

  private buildStages(): void {
    const sec = section(this.body, 'Stages');
    this.stagesSec = sec;
    this.none.className = 'bz-stages__none';
    this.none.textContent = 'No stages yet. A stage names a stretch of the timelapse.';
    const actions = div('bz-stages__actions');
    this.addBtn.addEventListener('click', () => this.addStage());
    this.removeBtn.addEventListener('click', () => this.removeStage());
    actions.append(this.addBtn, this.removeBtn);

    this.nameInput.setAttribute('aria-label', 'Stage name');
    this.descInput.setAttribute('aria-label', 'Stage note');
    this.nameInput.addEventListener('input', () => {
      if (!this.bound) return;
      this.bound.name = this.nameInput.value;
      this.rows.find((r) => r.stage === this.bound)?.name.replaceChildren(this.nameInput.value || 'Unnamed');
      this.hooks.stagesChanged(this.values.stages);
      this.hooks.edited();
    });
    this.descInput.addEventListener('input', () => {
      if (!this.bound) return;
      this.bound.desc = this.descInput.value;
      this.hooks.stagesChanged(this.values.stages);
      this.hooks.edited();
    });
    const name = labelRow('Name', this.nameInput);
    name.classList.add('bz-field');
    const note = labelRow('Note', this.descInput);
    note.classList.add('bz-field');
    this.fields.append(name, note);
    this.fields.hidden = true;
    sec.append(this.list, this.none, actions, this.fields);
    this.renderStages();
  }

  private buildCard(): void {
    const sec = section(this.body, 'Card picture');
    const note = document.createElement('p');
    note.className = 'bz-note';
    note.textContent = 'The picture on the gallery card.';
    this.cardBtn.addEventListener('click', () => {
      this.cardBtn.disabled = true;
      void this.hooks.useFrame().finally(() => {
        this.cardBtn.disabled = false;
      });
    });
    sec.append(note, this.cardBtn);
  }

  /** Put a stage list in whole (a save tidied it). */
  setStages(stages: Stage[]): void {
    this.values.stages = stages.map((s) => ({ ...s }));
    this.renderStages();
    this.syncFrame(this.hooks.frameAt());
  }

  private renderStages(): void {
    this.values.stages.sort((a, b) => a.frame - b.frame);
    this.rows = this.values.stages.map((stage) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bz-stage';
      const name = document.createElement('span');
      name.textContent = stage.name || 'Unnamed';
      const frame = document.createElement('span');
      frame.className = 'bz-stage__frame';
      frame.textContent = String(stage.frame);
      row.append(name, frame);
      row.addEventListener('click', () => this.hooks.seek(stage.frame));
      return { row, name, stage };
    });
    this.list.replaceChildren(...this.rows.map((r) => r.row));
    this.none.hidden = this.rows.length > 0;
  }

  /** The playhead moved (or the stages did): mark the stage in force, and bind the fields to it. */
  syncFrame(frame: number): void {
    const stages = this.values.stages;
    const at = stageIndexAt(stages, frame);
    this.rows.forEach((r, i) => {
      r.row.classList.toggle('bz-stage--on', i === at);
      if (i === at) r.row.setAttribute('aria-current', 'true');
      else r.row.removeAttribute('aria-current');
    });
    const has = this.hooks.hasFrames();
    this.addBtn.disabled = !has || stages.some((s) => s.frame === frame);
    this.addBtn.title = !has
      ? 'Add frames first'
      : this.addBtn.disabled
        ? 'A stage already starts at this frame'
        : `Start a stage at frame ${frame + 1}`;
    this.removeBtn.disabled = at < 0;
    this.fields.hidden = at < 0;
    const stage = at < 0 ? null : stages[at];
    // Not under the hand that is typing in them.
    const typing = document.activeElement === this.nameInput || document.activeElement === this.descInput;
    if (stage !== this.bound && !(typing && this.bound)) {
      this.bound = stage;
      this.nameInput.value = stage?.name ?? '';
      this.descInput.value = stage?.desc ?? '';
    }
  }

  private addStage(): void {
    const frame = this.hooks.frameAt();
    if (!this.hooks.hasFrames()) return;
    if (this.values.stages.some((s) => s.frame === frame)) return;
    const stage: Stage = { name: `Stage ${this.values.stages.length + 1}`, frame, desc: '' };
    this.values.stages.push(stage);
    this.renderStages();
    this.bound = null;
    this.syncFrame(frame);
    this.hooks.stagesChanged(this.values.stages);
    this.hooks.edited();
    this.nameInput.focus();
    this.nameInput.select();
  }

  private removeStage(): void {
    const at = stageIndexAt(this.values.stages, this.hooks.frameAt());
    if (at < 0) return;
    this.values.stages.splice(at, 1);
    this.renderStages();
    this.bound = null;
    this.syncFrame(this.hooks.frameAt());
    this.hooks.stagesChanged(this.values.stages);
    this.hooks.edited();
  }
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  return b;
}

function textInput(placeholder: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'bz-input';
  i.placeholder = placeholder;
  i.autocomplete = 'off';
  i.spellcheck = false;
  return i;
}
