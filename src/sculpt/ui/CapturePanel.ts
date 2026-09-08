import { div } from '../../ui/dom';
import { checkbox, section } from '../../ui/Panel';
import { SidePanel } from './SidePanel';
import type { SnapshotRecorder } from '../bridge/SnapshotRecorder';

/**
 * Capture panel: the top-left docked panel, home of the timelapse
 * recorder's toggle, readout and clear, and of the admin-only publish
 * forms. File commands live in the top row's File menu (or the desktop
 * app's native one); the object list lives next door in Scene.
 */
export class CapturePanel extends SidePanel {
  /** mode.ts appends the admin-only "publish timelapse" form here. */
  readonly captureSlot = div('sculpt-panel__slot');
  /** mode.ts appends the admin-only "publish model" form here. */
  readonly publishSlot = div('sculpt-panel__slot');
  private recordCheckbox!: HTMLInputElement;
  private captureReadout!: HTMLDivElement;
  private captureStopReason = '';
  private readonly autosaveNote: HTMLDivElement;

  constructor(private readonly recorder: SnapshotRecorder) {
    super({ id: 'capture', title: 'Capture', side: 'left', variant: 'panel--capture' });

    // Empty until it has something to say (autosave stopping itself). Up
    // top, where the storage this panel spends is accounted for.
    this.autosaveNote = div('sculpt-panel__hint sculpt-panel__warn');
    this.autosaveNote.hidden = true;
    this.body.appendChild(this.autosaveNote);

    const sec = section(this.body, 'Capture');
    const rec = checkbox('Record timelapse', this.recorder.isEnabled(), (on) => {
      this.recorder.setEnabled(on);
      this.paintCapture();
    });
    this.recordCheckbox = rec.querySelector('input') as HTMLInputElement;
    sec.appendChild(rec);

    this.captureReadout = div('sculpt-panel__hint capture__readout');
    sec.appendChild(this.captureReadout);

    const col = div('outliner__files');
    col.appendChild(
      this.actionButton('Clear frames', async () => {
        if (this.recorder.frameCount() === 0) return;
        if (!confirm('Delete all captured timelapse frames?')) return;
        await this.recorder.clear();
      }),
    );
    this.captureSlot.dataset.slot = 'timelapse';
    col.appendChild(this.captureSlot);
    sec.appendChild(col);

    // The single-frame publish, beside the reel's: both need the sign-in.
    const publish = section(this.body, 'Publish');
    this.publishSlot.dataset.slot = 'model';
    const publishCol = div('outliner__files');
    publishCol.appendChild(this.publishSlot);
    publish.appendChild(publishCol);

    this.recorder.onChange = () => this.paintCapture();
    this.recorder.onStopped = (reason) => {
      this.captureStopReason =
        reason === 'budget' ? 'stopped: frame budget reached' : 'stopped: storage unavailable';
      this.paintCapture();
    };
    this.paintCapture();
  }

  /**
   * Autosave stopped itself. The way out of a full store is a saved file
   * (File menu) or fewer captured frames, and the frames are right here.
   */
  showAutosaveStopped(reason: 'quota' | 'error'): void {
    this.autosaveNote.textContent =
      reason === 'quota'
        ? 'Autosave stopped: this device is out of storage. Save a file (File menu), and clear captured frames to free space.'
        : 'Autosave stopped: this browser refused to store the scene. Save a file (File menu) to keep this work.';
    this.autosaveNote.hidden = false;
  }

  private paintCapture(): void {
    this.recordCheckbox.checked = this.recorder.isEnabled();
    const n = this.recorder.frameCount();
    const mb = this.recorder.bytes() / (1024 * 1024);
    const size = mb >= 100 ? Math.round(mb).toString() : mb.toFixed(1);
    const parts = [`${n} frame${n === 1 ? '' : 's'} - ${size} MB`];
    if (this.captureStopReason && !this.recorder.isEnabled()) parts.push(this.captureStopReason);
    this.captureReadout.textContent = parts.join(' - ');
  }

  /** A full-width action button, alert-on-error. */
  private actionButton(label: string, action: () => Promise<void>): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn outliner__filebtn';
    b.textContent = label;
    b.addEventListener('click', () => {
      b.disabled = true;
      void action()
        .catch((err: Error) => alert(err.message))
        .finally(() => {
          b.disabled = false;
        });
    });
    return b;
  }

  override dispose(): void {
    this.recorder.onChange = null;
    this.recorder.onStopped = null;
    super.dispose();
  }
}
