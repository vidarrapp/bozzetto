import { div } from '../../ui/dom';
import { checkbox, section } from '../../ui/Panel';
import type { SculptSession } from '../bridge/SculptSession';
import type { SnapshotRecorder } from '../bridge/SnapshotRecorder';
import { downloadBlob, packScene, sceneToOBJ, stampName, unpackScene } from '../bridge/SceneFile';

/**
 * Scene panel (WS4 outliner + WS5, "my work" per the owner's layout call):
 * a LEFT-docked panel, collapsed by default. The outliner lists the
 * scene's objects with the active one highlighted (click selects) and a
 * plus button offering primitives. Below it, the File section (save/open
 * the .bozz scene, export OBJ - guest-safe, nothing uploads) and the
 * Capture section (the timelapse recorder's toggle/readout/clear). The
 * admin-only publish forms slot into their matching sections.
 */
export class ScenePanel {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  private readonly handleArrow: HTMLSpanElement;
  private readonly openInput: HTMLInputElement;
  /** mode.ts appends the admin-only "publish model" form here (WS5). */
  readonly filesSlot = div('sculpt-panel__slot');
  /** mode.ts appends the admin-only "publish timelapse" form here (WS5). */
  readonly captureSlot = div('sculpt-panel__slot');
  private recordCheckbox!: HTMLInputElement;
  private captureReadout!: HTMLDivElement;
  private captureStopReason = '';
  private collapsed = true;

  constructor(
    private readonly session: SculptSession,
    private readonly recorder: SnapshotRecorder,
  ) {
    this.root = div('panel panel--left panel--scene panel--collapsed');
    document.body.appendChild(this.root);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel__handle panel__handle--left';
    const label = document.createElement('span');
    label.className = 'handle__label';
    label.textContent = 'Scene';
    this.handleArrow = document.createElement('span');
    this.handleArrow.className = 'handle__arrow';
    handle.append(label, this.handleArrow);
    handle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(handle);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = 'Scene';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '‹';
    close.addEventListener('click', () => this.setCollapsed(true));
    header.append(title, close);
    this.root.appendChild(header);

    const body = div('panel__body');
    this.listEl = div('outliner');
    body.appendChild(this.listEl);

    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__add';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';
    this.addMenu = div('outliner__menu');
    this.addMenu.hidden = true;
    for (const [kind, label2] of [
      ['sphere', 'Sphere'],
      ['cube', 'Cube'],
      ['cylinder', 'Cylinder'],
      ['torus', 'Torus'],
    ] as const) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'outliner__menu-item';
      item.textContent = label2;
      item.addEventListener('click', () => {
        this.addMenu.hidden = true;
        this.session.addPrimitive(kind);
      });
      this.addMenu.appendChild(item);
    }
    addBtn.addEventListener('click', () => {
      this.addMenu.hidden = !this.addMenu.hidden;
    });
    footer.append(addBtn, this.addMenu);
    body.appendChild(footer);

    // File section (guest-safe: everything here stays on the device).
    const files = section(body, 'File');
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
    const openBtn = this.fileButton('Open file...', null, async () => {
      this.openInput.click();
    });
    filesCol.appendChild(openBtn);
    filesCol.appendChild(this.openInput);
    filesCol.appendChild(
      this.fileButton('Export OBJ', 'Exported', async () => {
        downloadBlob(new Blob([sceneToOBJ(this.session)], { type: 'text/plain' }), stampName('obj'));
      }),
    );
    this.filesSlot.dataset.slot = 'model';
    filesCol.appendChild(this.filesSlot);

    this.buildCapture(body);

    this.root.appendChild(body);
    this.applyCollapsed();
    this.refresh();
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

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    this.handleArrow.textContent = this.collapsed ? '›' : '‹';
    if (this.collapsed) this.addMenu.hidden = true;
  }

  /** Rebuild the object rows from the live scene (list/selection changes). */
  refresh(): void {
    const active = this.session.getMesh();
    this.listEl.replaceChildren(
      ...this.session.getMeshes().map((mesh) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'outliner__row';
        if (mesh === active) row.classList.add('outliner__row--active');
        row.textContent = this.session.getMeshName(mesh);
        row.addEventListener('click', () => {
          this.session.setMesh(mesh);
        });
        return row;
      }),
    );
  }

  dispose(): void {
    this.recorder.onChange = null;
    this.recorder.onStopped = null;
    this.root.remove();
  }
}
