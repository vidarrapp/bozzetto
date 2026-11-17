import { isTextField } from '../ui/dom';
import { statusToast } from '../sculpt/ui/statusToast';
import { setPanel } from '../sculpt/ui/panelMemory';
import type { ReferenceBoard, RefItem } from './board';

/**
 * The ways a picture reaches the board besides the panel's own picker:
 * the clipboard (Ctrl/Cmd+V while the Reference panel is open, and the
 * Edit menu's Paste picture) and dropping files onto the panel or the
 * view. All of it ends in board.add, which scales and re-encodes.
 */

const isPicture = (f: Blob): boolean => f.type.startsWith('image/');

/** Add these, saying how it went. Resolves to the pictures that went in, the first added first. */
export async function addPictures(board: ReferenceBoard, files: Iterable<Blob>): Promise<RefItem[]> {
  const added: RefItem[] = [];
  let failure = '';
  const list = [...files].filter(isPicture);
  // Oldest first, so the newest of a batch ends up first on the board.
  for (const file of list) {
    try {
      added.push(await board.add(file, (file as File).name || 'Picture'));
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  if (failure && !added.length) statusToast('').fail(failure);
  else if (failure) statusToast('').fail(`Added ${added.length}. ${failure}`);
  return added;
}

/** Whether a drag or a paste carries a picture. */
function hasPicture(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  for (const item of dt.items ?? []) if (item.kind === 'file' && item.type.startsWith('image/')) return true;
  return [...(dt.files ?? [])].some(isPicture);
}

/**
 * The clipboard's picture, read on a press (Edit > Paste picture, the
 * panel's Paste): browsers ask the person, and answer an error when it
 * holds no picture. Says so on a toast in either case.
 */
export async function pasteFromClipboard(board: ReferenceBoard): Promise<boolean> {
  try {
    if (!navigator.clipboard?.read) throw new Error('unsupported');
    const items = await navigator.clipboard.read();
    const blobs: Blob[] = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) blobs.push(await item.getType(type));
    }
    if (!blobs.length) {
      statusToast('').fail('There is no picture on the clipboard.');
      return false;
    }
    const n = (await addPictures(board, blobs)).length;
    if (n) statusToast('').done(n === 1 ? 'Picture added' : `${n} pictures added`);
    return n > 0;
  } catch {
    statusToast('').fail('The clipboard could not be read. Press Ctrl or Cmd+V with the Reference panel open instead.');
    return false;
  }
}

/**
 * Listen for pastes and drops for as long as a mode is mounted. A paste
 * counts while the Reference panel is open and no text field has the
 * focus; a drop of a picture counts anywhere: on the view it is put in the
 * view where it fell (and Arrange turns on), elsewhere it opens the panel so
 * the new tile shows. Returns the way out.
 */
export function installIntake(
  board: ReferenceBoard,
  panelOpen: () => boolean,
  /** A drop: put these in the view where they fell. False when the drop was not on the view. */
  placeDropped?: (items: RefItem[], x: number, y: number) => boolean,
): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    if (!panelOpen() || isTextField(e.target) || !hasPicture(e.clipboardData)) return;
    e.preventDefault();
    const files = [...(e.clipboardData?.files ?? [])].filter(isPicture);
    void addPictures(board, files).then((got) => {
      const n = got.length;
      if (n) statusToast('').done(n === 1 ? 'Picture added' : `${n} pictures added`);
    });
  };
  const onDragOver = (e: DragEvent): void => {
    if (!hasPicture(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasPicture(e.dataTransfer)) return;
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter(isPicture);
    const { clientX, clientY } = e;
    void addPictures(board, files).then((got) => {
      if (!got.length) return;
      // Dropped on the view: placed where it fell. Anywhere else (the panel): a tile on the board.
      if (placeDropped?.(got, clientX, clientY)) return;
      setPanel('reference', true);
    });
  };
  window.addEventListener('paste', onPaste);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
