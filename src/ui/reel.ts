import type { Viewer } from '../viewer/Viewer';
import type { AspectId } from '../viewer/CaptureGuide';
import type { ReelFormat, ReelMotion, ReelOptions } from '../viewer/capture/types';
import { div, labelRow, selectEl } from './dom';

/** How a place uses the reel controls. */
export interface ReelControlsOptions {
  /** The motions on offer; a one-frame model has nothing to step through, so only the turntable. */
  motions?: ReelMotion[];
  /** The project's name for the file, read when a clip is saved (it may have been renamed since). */
  title?: () => string;
}

/**
 * Build the reel capture controls — a video/GIF export of the timelapse or
 * a turntable spin, cropped to the active aspect guide. Returns a DOM block
 * for Present's Output tab (the owner's pages only). It has no lead
 * sentence, Motion first, a line saying how many frames and how long the
 * clip is, a Cancel while it records, and the guide on from the start
 * (4:5). The heavy encoder pipeline is imported on demand at first
 * capture, so it stays out of the bundle until a reel is recorded, and
 * never reaches the viewer-only page.
 */
export function mountReelControls(viewer: Viewer, opts: ReelControlsOptions = {}): HTMLElement {
  const motions: ReelMotion[] = opts.motions?.length ? opts.motions : ['timeline', 'turntable'];
  const root = div('reel');
  const hasMp4 = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

  // Aspect drives both the on-screen crop guide and the capture framing.
  const aspect = selectEl(
    [
      ['off', 'Off'],
      ['9:16', '9:16 — vertical'],
      ['4:5', '4:5 — portrait'],
      ['1:1', '1:1 — square'],
      ['16:9', '16:9 — wide'],
    ],
    viewer.getCaptureAspect() ?? '4:5',
  );
  aspect.setAttribute('aria-label', 'Aspect');
  // Present shows the guide from the start: it is what a reel is framed by.
  if (!viewer.getCaptureAspect()) viewer.setCaptureAspect(aspect.value as AspectId);

  // Motion: step the timeline, or spin the current frame in place (turntable).
  const motion = selectEl(
    motions.map((m): [string, string] =>
      m === 'timeline' ? ['timeline', 'Timelapse'] : ['turntable', 'Turntable (spin)'],
    ),
    motions[0],
  );
  motion.setAttribute('aria-label', 'Motion');
  root.append(labelRow('Motion', motion), labelRow('Aspect', aspect));

  const spin = selectEl([['2', '2s'], ['4', '4s'], ['6', '6s'], ['8', '8s']], '4');
  spin.setAttribute('aria-label', 'Spin');
  const direction = selectEl([['1', 'Counter-clockwise'], ['-1', 'Clockwise']], '1');
  direction.setAttribute('aria-label', 'Direction');
  const turnBox = div('reel-turntable');
  turnBox.append(labelRow('Spin', spin), labelRow('Direction', direction));
  root.appendChild(turnBox);

  // MP4 (H.264) where WebCodecs exists; animated GIF everywhere.
  const format = selectEl(
    hasMp4 ? [['mp4', 'MP4 (H.264)'], ['gif', 'GIF']] : [['gif', 'GIF']],
    hasMp4 ? 'mp4' : 'gif',
  );
  format.setAttribute('aria-label', 'Format');
  root.appendChild(labelRow('Format', format));

  const size = document.createElement('select');
  size.setAttribute('aria-label', 'Size');
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
  fps.setAttribute('aria-label', 'FPS');
  root.appendChild(labelRow('FPS', fps));

  // How long the clip will be, for what is chosen.
  const info = document.createElement('p');
  info.className = 'reel-info';
  const frameTotal = (): number =>
    motion.value === 'turntable' ? Math.max(2, Math.round(Number(spin.value) * Number(fps.value))) : viewer.manifest.config.frameCount;
  const paintInfo = (): void => {
    const n = frameTotal();
    const seconds = Math.round((n / Number(fps.value)) * 10) / 10;
    info.textContent = `${n} frame${n === 1 ? '' : 's'}, ${seconds} second${seconds === 1 ? '' : 's'} at ${fps.value} fps.`;
  };
  root.appendChild(info);

  const syncMotion = (): void => {
    turnBox.hidden = motion.value !== 'turntable';
    paintInfo();
  };
  syncMotion();
  motion.addEventListener('change', syncMotion);
  spin.addEventListener('change', paintInfo);
  fps.addEventListener('change', paintInfo);

  const record = document.createElement('button');
  record.type = 'button';
  record.className = 'btn reel-record';
  record.textContent = 'Record reel';
  const bar = document.createElement('progress');
  bar.hidden = true;
  const status = document.createElement('span');
  status.className = 'reel-status';
  status.setAttribute('role', 'status');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn reel-cancel';
  cancel.textContent = 'Cancel';
  cancel.hidden = true;
  // The button and, while it records, the progress with its Cancel in its place.
  const running = div('reel-running');
  running.hidden = true;
  running.append(bar, cancel);
  root.append(record, running, status);

  record.disabled = aspect.value === 'off';
  aspect.addEventListener('change', () => {
    const a = aspect.value === 'off' ? null : (aspect.value as AspectId);
    viewer.setCaptureAspect(a);
    record.disabled = a === null;
  });

  let abort: AbortController | null = null;
  const controls = [aspect, motion, spin, direction, format, size, fps];
  const setBusy = (busy: boolean): void => {
    record.disabled = busy || aspect.value === 'off';
    record.textContent = busy ? 'Recording…' : 'Record reel';
    for (const c of controls) c.disabled = busy;
    bar.hidden = !busy;
    record.hidden = busy;
    cancel.hidden = !busy;
    running.hidden = !busy;
  };
  cancel.addEventListener('click', () => abort?.abort());

  const run = async (): Promise<void> => {
    if (aspect.value === 'off') return;
    setBusy(true);
    status.textContent = 'Preparing…';
    bar.removeAttribute('value'); // indeterminate until the first frame lands
    const a = aspect.value as AspectId;
    const fmt = format.value as ReelFormat;
    const common = { aspect: a, format: fmt, size: Number(size.value), fps: Number(fps.value) };
    const reel: ReelOptions =
      (motion.value as ReelMotion) === 'turntable'
        ? {
            ...common,
            motion: 'turntable',
            spinSeconds: Number(spin.value),
            direction: Number(direction.value) === -1 ? -1 : 1,
          }
        : { ...common, motion: 'timeline', from: 0, to: viewer.manifest.config.frameCount - 1 };
    abort = new AbortController();
    try {
      const { recordReel, downloadBlob, reelFilename, ReelCancelled } = await import('../viewer/capture/recorder');
      try {
        const blob = await recordReel(
          viewer,
          reel,
          (done, total) => {
            bar.max = total;
            bar.value = done;
            status.textContent = `Rendering ${done} / ${total}`;
          },
          abort.signal,
        );
        downloadBlob(blob, reelFilename(opts.title?.() ?? viewer.manifest.title, a, fmt));
        status.textContent = `Saved · ${formatBytes(blob.size)}`;
      } catch (err) {
        if (err instanceof ReelCancelled) {
          status.textContent = 'Cancelled, nothing saved';
          return;
        }
        throw err;
      }
    } catch (err) {
      console.error('Reel capture failed', err);
      status.textContent = err instanceof Error ? err.message : 'Capture failed';
    } finally {
      abort = null;
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
