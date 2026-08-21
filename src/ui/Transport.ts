import type { Viewer } from '../viewer/Viewer';

/**
 * Bottom transport bar for the viewer: the current stage's title + description
 * sit above a full-width scrubber with a play/pause button. A slim bar under
 * the scrubber shows which frames are decoded (the streamer's sliding window),
 * and a "Buffering…" pill appears while playback waits for frames. Frame
 * stepping is keyboard-only (installShortcuts). Owns viewer.onFrame,
 * onPlayStateChange, onBufferChange and onBufferingChange.
 */
export class Transport {
  private readonly root: HTMLDivElement;
  private readonly scrubber: HTMLInputElement;
  private readonly buffer: HTMLDivElement;
  private readonly buffering: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly stageName: HTMLSpanElement;
  private readonly stageDesc: HTMLSpanElement;
  private readonly frameLabel: HTMLSpanElement;

  constructor(private readonly viewer: Viewer) {
    const m = viewer.manifest;

    this.root = el('div', 'transport');

    const info = el('div', 'transport__info');
    this.stageName = el('span', 'transport__stage-name');
    this.stageDesc = el('span', 'transport__stage-desc');
    info.append(this.stageName, this.stageDesc);

    const bar = el('div', 'transport__bar');
    this.playButton = el('button', 'transport__play');
    this.playButton.type = 'button';
    this.playButton.addEventListener('click', () => this.viewer.togglePlay());

    // The scrubber and its buffer bar stack in a wrapper so the bar tracks the
    // scrubber's width exactly (the play button and frame label sit outside).
    const scrub = el('div', 'transport__scrub');
    this.scrubber = el('input', 'transport__scrubber');
    this.scrubber.type = 'range';
    this.scrubber.min = '0';
    this.scrubber.max = String(Math.max(0, m.config.frameCount - 1));
    this.scrubber.step = '1';
    this.scrubber.value = String(m.defaults.frame);
    this.scrubber.addEventListener('input', () =>
      this.viewer.scrubTo(Number(this.scrubber.value)),
    );
    this.buffer = el('div', 'transport__buffer');
    scrub.append(this.scrubber, this.buffer);

    this.frameLabel = el('span', 'transport__frame');
    bar.append(this.playButton, scrub, this.frameLabel);

    this.buffering = el('div', 'transport__buffering');
    this.buffering.append(el('span', 'transport__spinner'), document.createTextNode('Buffering…'));

    this.root.append(info, bar, this.buffering);
    document.body.appendChild(this.root);

    this.viewer.onFrame = (ordinal) => this.syncFrame(ordinal);
    this.viewer.onPlayStateChange = (playing) => this.setPlay(playing);
    this.viewer.onBufferChange = () => this.syncBuffer();
    this.viewer.onBufferingChange = () => this.syncBuffer();
    this.syncFrame(m.defaults.frame);
    this.setPlay(viewer.timeline.playing);
  }

  private syncFrame(ordinal: number): void {
    this.scrubber.value = String(ordinal);
    this.frameLabel.textContent = `${ordinal + 1} / ${this.viewer.manifest.config.frameCount}`;
    const stage = this.viewer.timeline.stageAt(ordinal);
    this.stageName.textContent = stage ? stage.name : '';
    this.stageDesc.textContent = stage ? stage.desc : '';
    this.syncBuffer(); // playhead moves shift the streamer's window (evictions)
  }

  /** Repaint the decoded-frames bar and the buffering pill. */
  private syncBuffer(): void {
    const count = this.viewer.manifest.config.frameCount;
    const stops = this.viewer
      .getBufferedRanges()
      .map(([start, end]) => {
        const a = ((start / count) * 100).toFixed(2);
        const b = (((end + 1) / count) * 100).toFixed(2);
        return `transparent ${a}%, var(--accent) ${a}% ${b}%, transparent ${b}%`;
      })
      .join(', ');
    this.buffer.style.backgroundImage = stops
      ? `linear-gradient(to right, ${stops})`
      : 'none';
    this.buffering.classList.toggle(
      'transport__buffering--show',
      this.viewer.isAwaitingFrame(),
    );
  }

  private setPlay(playing: boolean): void {
    this.playButton.textContent = playing ? '❚❚' : '▶';
    this.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  dispose(): void {
    this.viewer.onFrame = null;
    this.viewer.onPlayStateChange = null;
    this.viewer.onBufferChange = null;
    this.viewer.onBufferingChange = null;
    this.root.remove();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
