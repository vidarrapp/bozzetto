import { SidePanel } from '../sculpt/ui/SidePanel';
import { statusToast } from '../sculpt/ui/statusToast';
import { section } from '../ui/Panel';
import { mountReelControls } from '../ui/reel';
import { downloadBlob } from '../ui/download';
import { imageName, stillRatio } from '../viewer/capture/still';
import type { Viewer } from '../viewer/Viewer';

/**
 * The Output tab of the owner's Present page for a published frame project
 * (present/): Reel, the editor's Record reel (a timelapse or a turntable as
 * MP4 or GIF, cropped to the aspect guide), and Image, a PNG of the view
 * as Sculpt's Present saves one (Viewer.captureStill). A model has no
 * frames to step through, so its reel is the turntable alone.
 */
export class OutputPanel extends SidePanel {
  constructor(viewer: Viewer, opts: { timelapse: boolean; title: () => string }) {
    super({ id: 'output', title: 'Output', side: 'right', variant: 'panel--output', collapsed: true });

    const reel = section(this.body, 'Reel');
    reel.appendChild(
      mountReelControls(viewer, {
        variant: 'present',
        motions: opts.timelapse ? ['timeline', 'turntable'] : ['turntable'],
        title: opts.title,
      }),
    );

    const image = section(this.body, 'Image');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn present-out__save';
    save.textContent = 'Save image';
    save.title = 'A PNG of the view at twice the window';
    save.addEventListener('click', () => {
      save.disabled = true;
      void saveImage(viewer, opts.title()).finally(() => {
        save.disabled = false;
      });
    });
    image.appendChild(save);
  }
}

/** Save image: a PNG of the view at twice the window, with no interface in it. */
async function saveImage(viewer: Viewer, title: string): Promise<void> {
  const status = statusToast('Rendering the image...');
  try {
    const blob = await viewer.captureStill(stillRatio(viewer));
    const name = `${imageName(title, 'Bozzetto')}.png`;
    downloadBlob(blob, name);
    status.done(`Saved ${name}`);
  } catch (err) {
    console.warn('present: image not saved', err);
    status.fail(`Could not save the image: ${err instanceof Error ? err.message : String(err)}`);
  }
}
