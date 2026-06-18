import type { Viewer } from '../viewer/Viewer';
import type { AspectId } from '../viewer/CaptureGuide';
import type { ReelFormat, ReelMotion, ReelOptions } from '../viewer/capture/types';
import { div, labelRow, selectEl } from './dom';

/**
 * Build the reel capture controls (editor only) — a video/GIF export of the
 * timelapse or a turntable spin, cropped to the active aspect guide. Returns a
 * DOM block to drop under the editor's Export header. The heavy encoder
 * pipeline is imported on demand at first capture, so it stays out of the
 * editor's initial bundle (and never reaches the viewer-only embed).
 */
export function mountReelControls(viewer: Viewer): HTMLElement {
  const root = div('reel');
  const hasMp4 = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

  const hint = document.createElement('p');
  hint.className = 'muted editor__hint';
  hint.textContent =
    'Record a video or GIF — the full timelapse, or a turntable spin of the current frame.';
  root.appendChild(hint);

  // Aspect drives both the on-screen crop guide and the capture framing.
  const aspect = selectEl(
    [
      ['off', 'Off'],
      ['9:16', '9:16 — vertical'],
      ['1:1', '1:1 — square'],
      ['16:9', '16:9 — wide'],
    ],
    viewer.getCaptureAspect() ?? 'off',
  );
  root.appendChild(labelRow('Aspect', aspect));

  // Motion: step the timeline, or spin the current frame in place (turntable).
  const motion = selectEl(
    [['timeline', 'Timeline'], ['turntable', 'Turntable (spin)']],
    'timeline',
  );
  root.appendChild(labelRow('Motion', motion));

  const spin = selectEl([['2', '2s'], ['4', '4s'], ['6', '6s'], ['8', '8s']], '4');
  const direction = selectEl([['1', 'Counter-clockwise'], ['-1', 'Clockwise']], '1');
  const turnBox = div('reel-turntable');
  turnBox.append(labelRow('Spin', spin), labelRow('Direction', direction));
  root.appendChild(turnBox);
  const syncMotion = (): void => {
    turnBox.hidden = motion.value !== 'turntable';
  };
  syncMotion();
  motion.addEventListener('change', syncMotion);

  // MP4 (H.264) where WebCodecs exists; animated GIF everywhere.
  const format = selectEl(
    hasMp4 ? [['mp4', 'MP4 (H.264)'], ['gif', 'GIF']] : [['gif', 'GIF']],
    hasMp4 ? 'mp4' : 'gif',
  );
  root.appendChild(labelRow('Format', format));

  const size = document.createElement('select');
  root.appendChild(labelRow('Size', size));
  const fillSizes = (): void => {
    const opts: [string, string][] =
      format.value === 'gif'
        ? [['480', '480p'], ['360', '360p']]
        : [['1080', '1080p'], ['720', '720p']];
    const keep = size.value;
    size.replaceChildren();
    for (const [v, l] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      size.appendChild(o);
    }
    size.value = opts.some(([v]) => v === keep) ? keep : opts[0][0];
  };
  fillSizes();
  format.addEventListener('change', fillSizes);

  const fps = selectEl([['12', '12 fps'], ['24', '24 fps'], ['30', '30 fps']], '24');
  root.appendChild(labelRow('FPS', fps));

  const record = document.createElement('button');
  record.type = 'button';
  record.className = 'btn reel-record';
  record.textContent = 'Record reel';
  const bar = document.createElement('progress');
  bar.hidden = true;
  const status = document.createElement('span');
  status.className = 'reel-status';
  root.append(record, bar, status);

  record.disabled = aspect.value === 'off';
  aspect.addEventListener('change', () => {
    const a = aspect.value === 'off' ? null : (aspect.value as AspectId);
    viewer.setCaptureAspect(a);
    record.disabled = a === null;
  });

  const controls = [aspect, motion, spin, direction, format, size, fps];
  const setBusy = (busy: boolean): void => {
    record.disabled = busy || aspect.value === 'off';
    record.textContent = busy ? 'Recording…' : 'Record reel';
    for (const c of controls) c.disabled = busy;
    bar.hidden = !busy;
  };

  const run = async (): Promise<void> => {
    if (aspect.value === 'off') return;
    setBusy(true);
    status.textContent = 'Preparing…';
    bar.removeAttribute('value'); // indeterminate until the first frame lands
    const a = aspect.value as AspectId;
    const fmt = format.value as ReelFormat;
    const common = { aspect: a, format: fmt, size: Number(size.value), fps: Number(fps.value) };
    const opts: ReelOptions =
      (motion.value as ReelMotion) === 'turntable'
        ? {
            ...common,
            motion: 'turntable',
            spinSeconds: Number(spin.value),
            direction: Number(direction.value) === -1 ? -1 : 1,
          }
        : { ...common, motion: 'timeline', from: 0, to: viewer.manifest.config.frameCount - 1 };
    try {
      const { recordReel, downloadBlob, reelFilename } = await import('../viewer/capture/recorder');
      const blob = await recordReel(viewer, opts, (done, total) => {
        bar.max = total;
        bar.value = done;
        status.textContent = `Rendering ${done} / ${total}`;
      });
      downloadBlob(blob, reelFilename(viewer.manifest.title, a, fmt));
      status.textContent = `Saved · ${formatBytes(blob.size)}`;
    } catch (err) {
      console.error('Reel capture failed', err);
      status.textContent = err instanceof Error ? err.message : 'Capture failed';
    } finally {
      setBusy(false);
    }
  };
  record.addEventListener('click', () => void run());

  return root;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
