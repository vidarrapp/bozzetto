import { div } from '../../ui/dom';
import { checkbox, section } from '../../ui/Panel';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';
import type { SnapshotRecorder } from '../bridge/SnapshotRecorder';
import type { SavedScene } from '../bridge/ScenePersist';
import type { LookState } from '../../viewer/Viewer';
import { downloadBlob, packScene, sceneToOBJ, stampName, unpackScene } from '../bridge/SceneFile';

/** How the panel reaches the viewer's look, so .bozz files carry it. */
export interface LookBridge {
  get(): LookState;
  apply(look: LookState): void;
}

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
  /** mode.ts hooks the material library onto save and open. */
  decorate: ((scene: SavedScene) => void) | null = null;
  adopt: ((scene: SavedScene) => void) | null = null;
  private readonly openInput: HTMLInputElement;
  private importInput!: HTMLInputElement;
  private importZUp = false;
  private recordCheckbox!: HTMLInputElement;
  private captureReadout!: HTMLDivElement;
  private captureStopReason = '';

  constructor(
    private readonly session: SculptSession,
    private readonly recorder: SnapshotRecorder,
    private readonly look: LookBridge | null = null,
  ) {
    super({ id: 'file', title: 'File', side: 'left', variant: 'panel--file' });

    const files = section(this.body, 'File');
    const filesCol = div('outliner__files');
    files.appendChild(filesCol);
    filesCol.appendChild(
      this.fileButton('New scene', null, async () => {
        // Everything in one confirmation: the objects AND the recording,
        // since a timelapse of a scene you just discarded is not much use.
        const frames = this.recorder.frameCount();
        const extra = frames > 0 ? ` and ${frames} captured frame${frames === 1 ? '' : 's'}` : '';
        if (!confirm(`Start a new scene? The current objects${extra} will be lost.`)) return;
        await this.recorder.clear();
        this.session.newScene();
      }),
    );
    filesCol.appendChild(
      this.fileButton('Save file', 'Saved', async () => {
        const scene = this.session.serializeScene();
        if (!scene) throw new Error('Nothing to save');
        // The look travels with the file: reopening it puts the work back
        // under the lighting, material and camera it was saved in.
        if (this.look) scene.look = this.look.get();
        this.decorate?.(scene);
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
    // Import an OBJ as a new object in the scene - below Export, so the
    // native .bozz round trip reads before the interchange path (owner
    // layout call). The toggle covers Z-up DCC exports (Blender and
    // friends): checked, the axes rotate to Y-up on the way in (the same
    // convention the timelapse uploader uses).
    this.importInput = document.createElement('input');
    this.importInput.type = 'file';
    this.importInput.accept = '.obj';
    this.importInput.hidden = true;
    this.importInput.addEventListener('change', () => {
      const file = this.importInput.files?.[0];
      this.importInput.value = '';
      if (file) void this.importObjFile(file);
    });
    filesCol.appendChild(
      this.fileButton('Import OBJ...', null, async () => {
        this.importInput.click();
      }),
    );
    filesCol.appendChild(this.importInput);
    const zup = checkbox('Z-up source (rotate to Y-up)', false, (on) => {
      this.importZUp = on;
    });
    filesCol.appendChild(zup);
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

  /** Import an OBJ as a new scene object (errors surface as alerts). */
  private async importObjFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const name = file.name.replace(/\.obj$/i, '').trim() || 'Imported';
      await this.session.importOBJ(text, this.importZUp, name);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  private async openFile(file: File): Promise<void> {
    try {
      const scene = await unpackScene(await file.arrayBuffer());
      this.session.replaceScene(scene);
      this.adopt?.(scene); // materials, before anything reads them back
      if (scene.look && this.look) this.look.apply(scene.look);
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
