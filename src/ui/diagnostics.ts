import { PerfDebug } from './PerfDebug';
import { settings } from './settings';

/**
 * Whether a URL flag forces a diagnostic overlay on for this page
 * (`?perfdebug=1`, `?inputdebug=1`), whatever Preferences says: links
 * written before the Diagnostics group still work.
 */
export function forcedByUrl(name: string): boolean {
  return new URLSearchParams(location.search).get(name) === '1';
}

/**
 * The stall log, in every mode: up while Preferences > Diagnostics says so
 * or `?perfdebug=1` asks, and following the setting live. Returns the way
 * to take it down.
 */
export function mountStallLog(): () => void {
  const forced = forcedByUrl('perfdebug');
  let log: PerfDebug | null = null;
  const sync = (): void => {
    const on = forced || settings.get('stallLog') === 'on';
    if (on && !log) log = new PerfDebug();
    else if (!on && log) {
      log.dispose();
      log = null;
    }
  };
  sync();
  const off = settings.onChange(sync);
  return () => {
    off();
    log?.dispose();
    log = null;
  };
}
