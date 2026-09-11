import { div, labelRow, selectEl } from '../ui/dom';
import { checkbox, compactRange, section } from '../ui/Panel';
import { SidePanel } from '../sculpt/ui/SidePanel';
import { RIG_PRESETS } from './rig';
import type { Armature } from './Armature';

export interface ArmaturePanelHooks {
  preset(id: string): void;
  symmetry(on: boolean): void;
  resetPose(): void;
  mirror(from: 'L' | 'R'): void;
  /** A joint slider moved: the angles asked for (the figure clamps them). */
  joint(name: string, xyz: [number, number, number]): void;
  proportions(name: string, p: { size?: number; length?: number }): void;
  resetProportions(): void;
  send(resolution: number): void;
}

/**
 * The Armature panel (right edge, under Render): the figure and its
 * symmetry, the selected joint's angles, the selected part's proportions,
 * and the way out to Sculpt. The joint and part sections rebuild on every
 * selection change, so their sliders always show the live values.
 */
export class ArmaturePanel extends SidePanel {
  private readonly presetSel: HTMLSelectElement;
  private readonly symBox: HTMLInputElement;
  private readonly jointBody: HTMLDivElement;
  private readonly partBody: HTMLDivElement;
  private selected: string | null = null;
  /** Voxel resolution for Send to Sculpt (the Model panel's range). */
  resolution = 120;

  constructor(
    private readonly figure: () => Armature,
    private readonly hooks: ArmaturePanelHooks,
  ) {
    super({ id: 'armature', title: 'Armature', side: 'right', variant: 'panel--armature' });

    const fig = section(this.body, 'Figure');
    this.presetSel = selectEl(
      RIG_PRESETS.map((p) => [p.id, p.label] as [string, string]),
      figure().rig.id,
    );
    this.presetSel.addEventListener('change', () => this.hooks.preset(this.presetSel.value));
    fig.appendChild(labelRow('Preset', this.presetSel));
    const sym = checkbox('Symmetry (x)', figure().symmetry, (on) => this.hooks.symmetry(on));
    this.symBox = sym.querySelector('input') as HTMLInputElement;
    fig.appendChild(sym);
    const poseRow = div('sculpt-panel__row');
    poseRow.append(
      this.opButton('Reset pose', () => this.hooks.resetPose()),
      this.opButton('Copy L → R', () => this.hooks.mirror('L')),
      this.opButton('Copy R → L', () => this.hooks.mirror('R')),
    );
    fig.appendChild(poseRow);
    const hint = div('sculpt-panel__hint muted');
    hint.textContent = 'Click a part to pose its joint; the pelvis moves the whole figure (w).';
    fig.appendChild(hint);

    const joint = section(this.body, 'Joint');
    this.jointBody = div('sculpt-panel__dynamics');
    joint.appendChild(this.jointBody);

    const part = section(this.body, 'Proportions');
    this.partBody = div('sculpt-panel__dynamics');
    part.appendChild(this.partBody);
    const resetRow = div('sculpt-panel__row');
    resetRow.appendChild(this.opButton('Reset all proportions', () => this.hooks.resetProportions()));
    part.appendChild(resetRow);

    const send = section(this.body, 'Send to Sculpt');
    send.appendChild(
      compactRange('Resolution', 16, 300, 2, this.resolution, (v) => {
        this.resolution = v;
      }),
    );
    const sendRow = div('sculpt-panel__row');
    const sendBtn = this.opButton('Send to Sculpt', () => this.hooks.send(this.resolution));
    sendBtn.classList.add('sculpt-panel__btn--wide');
    sendRow.appendChild(sendBtn);
    send.appendChild(sendRow);
    const sendHint = div('sculpt-panel__hint muted');
    sendHint.textContent = 'Voxelises the posed figure into one object and opens it in Sculpt mode.';
    send.appendChild(sendHint);

    this.refresh(null);
  }

  /** Reflect the figure (a preset swap, a file opened). */
  syncFigure(): void {
    this.presetSel.value = this.figure().rig.id;
    this.symBox.checked = this.figure().symmetry;
    this.refresh(this.selected);
  }

  /** Rebuild the joint and part sections for a selection (null: none). */
  refresh(selected: string | null): void {
    this.selected = selected;
    this.symBox.checked = this.figure().symmetry;
    this.jointBody.replaceChildren();
    this.partBody.replaceChildren();
    const armature = this.figure();
    const def = selected ? armature.def(selected) : undefined;
    if (!selected || !def) {
      const none = div('sculpt-panel__hint muted');
      none.textContent = 'No part selected.';
      this.jointBody.appendChild(none);
      const none2 = div('sculpt-panel__hint muted');
      none2.textContent = 'Select a part to change its size and length.';
      this.partBody.appendChild(none2);
      return;
    }
    const title = div('sculpt-panel__hint');
    title.textContent = prettyName(selected);
    this.jointBody.appendChild(title);
    if (def.kind === 'root') {
      const hint = div('sculpt-panel__hint muted');
      hint.textContent = 'The pelvis is the root: its gizmo moves and turns the whole figure.';
      this.jointBody.appendChild(hint);
    } else {
      const limits = armature.limitsOf(selected);
      const angles = armature.getPoseEuler(selected);
      const axes: Array<['x' | 'y' | 'z', string]> = [
        ['x', 'Bend'],
        ['y', 'Twist'],
        ['z', 'Side'],
      ];
      for (const [axis, label] of axes) {
        const [lo, hi] = limits[axis];
        if (hi <= lo) continue; // a locked axis has no slider
        const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        this.jointBody.appendChild(
          compactRange(`${label} (${axis})`, lo, hi, 1, Math.round(angles[i]), (v) => {
            const next = armature.getPoseEuler(selected);
            next[i] = v;
            this.hooks.joint(selected, next);
          }),
        );
      }
      const row = div('sculpt-panel__row');
      row.appendChild(this.opButton('Reset joint', () => this.hooks.joint(selected, [0, 0, 0])));
      this.jointBody.appendChild(row);
    }
    const p = armature.getProportions(selected);
    this.partBody.appendChild(
      compactRange('Size', 0.5, 2, 0.02, p.size, (v) => this.hooks.proportions(selected, { size: v })),
    );
    this.partBody.appendChild(
      compactRange('Length', 0.5, 2, 0.02, p.length, (v) => this.hooks.proportions(selected, { length: v })),
    );
  }

  private opButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
}

/** 'upperarm.L' -> 'Upper arm (left)'. */
export function prettyName(bone: string): string {
  const [base, side] = bone.split('.');
  const words: Record<string, string> = {
    upperarm: 'Upper arm',
    forearm: 'Forearm',
    hand: 'Hand',
    clavicle: 'Clavicle',
    thigh: 'Thigh',
    shin: 'Shin',
    foot: 'Foot',
    pelvis: 'Pelvis',
    spine: 'Spine',
    chest: 'Chest',
    neck: 'Neck',
    head: 'Head',
  };
  const name = words[base] ?? base[0].toUpperCase() + base.slice(1);
  return side === 'L' ? `${name} (left)` : side === 'R' ? `${name} (right)` : name;
}
