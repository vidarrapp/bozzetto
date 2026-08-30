import { div } from '../../ui/dom';
import { checkbox, section } from '../../ui/Panel';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';
import type { SnapshotRecorder } from '../bridge/SnapshotRecorder';
import { downloadBlob, packScene, sceneToOBJ, stampName, unpackScene } from '../bridge/SceneFile';

/**
 * File panel: the top-left docked panel, everything about getting work IN
 * and OUT. The File section saves/opens the whole scene as a .bozz file and
 * exports OBJ (all device-local - the sculpt page is public and nothing
 * uploads); the Capture section owns the timelapse recorder's toggle,
 * readout and clear. The admin-only publish forms slot into whichever
 * section they belong to. The object list lives next door in Scene.
 */
export class FilePanel extends SidePanel {
  /** mode.ts appends the admin-only "publish model" form here. */
  readonly filesSlot = div('sculpt-panel__slot');
  /** mode.ts appends the admin-only "publish timelapse" form here. */
  readonly captureSlot = div('sculpt-panel__slot');
  private readonly openInput: HTMLInputElement;
  private recordCheckbox!: HTMLInputElement;
  private captureReadout!: HTMLDivElement;
  private captureStopReason = '';

  constructor(
    private readonly session: SculptSession,
    private readonly recorder: SnapshotRecorder,
  ) {
    super({ id: 'file', title: 'File', side: 'left', variant: 'panel--file' });

    const files = section(this.body, 'File');
    const filesCol = div('outliner__files');
    files.appendChild(filesCol);
    filesCol.appendChild(
      this.fileButton('Save file', 'Saved', async () => {
        const scene = this.session.serializeScene();
        if (!scene) throw new Error('Nothing to save');
        downloadBlob(await packScene(scene), stampName('bozz'));
      }),
    );
    this.openInput = document.createElement('input');
    this.openInput.type = 'file';
    this.openInput.accept = '.bozz';
    this.openInput.hidden = true;
    this.openInput.addEventListener('change', () => {
      const file = this.openInput.files?.[0];
      this.openInput.value = '';
      if (file) void this.openFile(file);
    });
    filesCol.appendChild(
      this.fileButton('Open file...', null, async () => {
        this.openInput.click();
      }),
    );
    filesCol.appendChild(this.openInput);
    filesCol.appendChild(
      this.fileButton('Export OBJ', 'Exported', async () => {
        downloadBlob(new Blob([sceneToOBJ(this.session)], { type: 'text/plain' }), stampName('obj'));
      }),
    );
    this.filesSlot.dataset.slot = 'model';
    filesCol.appendChild(this.filesSlot);

    this.buildCapture(this.body);
  }

  // --- Capture (the sculpt-to-timelapse recorder) -------------------------

  private buildCapture(body: HTMLElement): void {
    const sec = section(body, 'Capture');
    const rec = checkbox('Record timelapse', this.recorder.isEnabled(), (on) => {
      this.recorder.setEnabled(on);
      this.paintCapture();
    });
    this.recordCheckbox = rec.querySelector('input') as HTMLInputElement;
    sec.appendChild(rec);

    this.captureReadout = div('sculpt-panel__hint');
    sec.appendChild(this.captureReadout);

    const col = div('outliner__files');
    col.appendChild(
      this.fileButton('Clear frames', null, async () => {
        if (this.recorder.frameCount() === 0) return;
        if (!confirm('Delete all captured timelapse frames?')) return;
        await this.recorder.clear();
      }),
    );
    this.captureSlot.dataset.slot = 'timelapse';
    col.appendChild(this.captureSlot);
    sec.appendChild(col);

    this.recorder.onChange = () => this.paintCapture();
    this.recorder.onStopped = (reason) => {
      this.captureStopReason =
        reason === 'budget' ? 'stopped: frame budget reached' : 'stopped: storage unavailable';
      this.paintCapture();
    };
    this.paintCapture();
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

  /** A full-width action button with done-flash and alert-on-error. */
  private fileButton(
    label: string,
    doneLabel: string | null,
    action: () => Promise<void>,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn outliner__filebtn';
    b.textContent = label;
    b.addEventListener('click', () => {
      b.disabled = true;
      void action()
        .then(() => {
          if (doneLabel) {
            b.textContent = doneLabel;
            setTimeout(() => {
              b.textContent = label;
            }, 1200);
          }
        })
        .catch((err: Error) => alert(err.message))
        .finally(() => {
          b.disabled = false;
        });
    });
    return b;
  }

  private async openFile(file: File): Promise<void> {
    try {
      const scene = await unpackScene(await file.arrayBuffer());
      this.session.replaceScene(scene);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  override dispose(): void {
    this.recorder.onChange = null;
    this.recorder.onStopped = null;
    super.dispose();
  }
}
