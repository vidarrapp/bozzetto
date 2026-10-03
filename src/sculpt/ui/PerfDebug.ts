import { formatMs, perfLog, STALL_MS, type PerfEntry } from '../../viewer/perfLog';

/**
 * On-device perf log (`?perfdebug=1`): the last stalls and heavy operations
 * from perfLog, newest first, so a freeze on the iPad reads as what it was -
 * "autosave write 2.41 s" just under "stall 2.43 s" - rather than as a
 * guess. The console has the same entries as `__bozzettoPerf.recent()`.
 *
 * It draws on a timer, never from the operations it reports, so nothing
 * being measured ever waits on the DOM; it looks like the input log
 * (`?inputdebug=1`) and sits on the other side, so both can be on at once.
 */

const MAX_LINES = 16;
const REDRAW_MS = 500;

export class PerfDebug {
  private readonly root: HTMLDivElement;
  private readonly timer: number;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'perf-debug';
    document.body.appendChild(this.root);
    this.draw();
    // Every tick, not only on news: the ages move even when nothing happens.
    this.timer = window.setInterval(() => this.draw(), REDRAW_MS);
  }

  private draw(): void {
    const now = performance.now();
    const lines = [`perf log, newest first (stalls past ${STALL_MS} ms)`];
    for (const e of perfLog.recent(MAX_LINES)) lines.push(line(e, now));
    if (lines.length === 1) lines.push('nothing yet');
    this.root.textContent = lines.join('\n');
  }

  dispose(): void {
    clearInterval(this.timer);
    this.root.remove();
  }
}

/** "  3.2s  autosave write  2.41 s  49k tris  put 1.90 s" */
function line(e: PerfEntry, now: number): string {
  const age = `${((now - e.t) / 1000).toFixed(1)}s`.padStart(6);
  const what = e.n > 1 ? `${e.what} ×${e.n}` : e.what;
  const parts = [age, what.padEnd(20), formatMs(e.ms).padStart(8)];
  if (e.tris > 0) parts.push(`${formatTris(e.tris)} tris`);
  if (e.note) parts.push(e.note);
  return parts.join('  ');
}

function formatTris(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
