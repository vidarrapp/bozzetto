import type { Pacing } from '../viewer/Viewer';

/**
 * The desktop app's launch settings (electron/launch.cjs, through
 * preload.cjs): kept apart from the rest of the desktop module so the
 * viewer can read them without pulling in the document model. Inert in a
 * browser, where there is no bridge.
 */

/** What this window runs with, from its launch arguments. */
export interface LaunchState {
  vsync: boolean;
  highPerformanceGpu: boolean;
  displayHz: number;
  onBattery: boolean;
}

/** What launch.json can say; it applies at the next start. */
export interface LaunchOptions {
  vsync: boolean;
  highPerformanceGpu: boolean;
}

interface LaunchBridge {
  launch?: LaunchState;
  getLaunchOptions?: () => Promise<{ saved: LaunchOptions; active: LaunchOptions; gpuSwitch: boolean }>;
  setLaunchOptions?: (opts: Partial<LaunchOptions>) => Promise<LaunchOptions>;
  onBattery?: (fn: (onBattery: boolean) => void) => () => void;
  onDisplayHz?: (fn: (hz: number) => void) => () => void;
  powerNow?: () => Promise<{ onBattery: boolean; displayHz: number }>;
}

function bridge(): LaunchBridge | null {
  return (window as { bozzettoDesktop?: LaunchBridge }).bozzettoDesktop ?? null;
}

/** The launch state in force, or null outside the desktop app. */
export function launchState(): LaunchState | null {
  const launch = bridge()?.launch;
  // The preload's plain object, nothing else: a bridge without launch
  // arguments (a stand-in, say) leaves the page as a browser has it.
  return launch && typeof launch === 'object' && typeof launch.vsync === 'boolean' ? launch : null;
}

/** launch.json's settings, for Preferences; null outside the desktop app. */
export async function launchOptions(): Promise<{ saved: LaunchOptions; active: LaunchOptions; gpuSwitch: boolean } | null> {
  const b = bridge();
  return b?.getLaunchOptions ? b.getLaunchOptions() : null;
}

/** Change launch.json (Preferences > Desktop); it applies at the next start. */
export async function setLaunchOptions(opts: Partial<LaunchOptions>): Promise<LaunchOptions | null> {
  const b = bridge();
  return b?.setLaunchOptions ? b.setLaunchOptions(opts) : null;
}

/**
 * Give the viewer the desktop app's frame pacing (Viewer.setPacing) and keep
 * it current as the battery and the display change. With v-sync off the
 * viewer draws as fast as frames finish while you work, and paces itself to
 * the display when idle or on battery.
 */
export function followDesktopPacing(viewer: { setPacing(p: Partial<Pacing>): void }): void {
  const b = bridge();
  const launch = launchState();
  if (!launch) return;
  viewer.setPacing({ uncapped: !launch.vsync, displayHz: launch.displayHz, onBattery: launch.onBattery });
  b?.onBattery?.((onBattery) => viewer.setPacing({ onBattery }));
  b?.onDisplayHz?.((displayHz) => viewer.setPacing({ displayHz }));
  // The arguments are the window's, from when it was made: after a reload
  // the battery or the display may have changed since.
  void b?.powerNow?.().then(
    (now) => {
      if (now && typeof now.onBattery === 'boolean') viewer.setPacing({ onBattery: now.onBattery, displayHz: now.displayHz || 0 });
    },
    () => {},
  );
}
