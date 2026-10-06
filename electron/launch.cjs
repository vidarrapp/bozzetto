/**
 * Launch settings: the choices that only take effect when the app starts,
 * because they are Chromium switches, which must be set before the app is
 * ready. They live in <userData>/launch.json, are read here before ready,
 * and are edited from Preferences (Desktop) through launch:get/launch:set,
 * to apply at the next launch.
 *
 * - V-sync, off by default (owner call): Chromium normally holds every
 *   frame for the display, so a frame a little over one refresh waits for
 *   the next, a whole refresh of extra delay under the pen. Off, a frame
 *   is shown as soon as it is done; the page paces itself instead when
 *   idle or on battery (Viewer.scheduleNext), so nothing spins for no one.
 * - The high-performance GPU, on by default where the switch means
 *   anything (Windows laptops and Macs with two graphics chips): the
 *   compositor and WebGPU both run on the discrete one, rather than
 *   wherever the system's own per-app setting would put the app.
 *
 * The page learns what this process runs with from its arguments
 * (launchArguments, read by preload.cjs), and what launch.json now says,
 * which may differ until the next start, from launch:get.
 */
const { app, ipcMain } = require('electron');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./files.cjs');

const FILE = () => path.join(app.getPath('userData'), 'launch.json');
/** Where force_high_performance_gpu does anything: dual-GPU Windows laptops and Macs. */
const GPU_SWITCH = process.platform === 'win32' || process.platform === 'darwin';
const DEFAULTS = { vsync: false, highPerformanceGpu: GPU_SWITCH };

/** launch.json as it stands, any missing or malformed entry at its default. */
function readLaunch() {
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8'));
    return {
      vsync: typeof raw.vsync === 'boolean' ? raw.vsync : DEFAULTS.vsync,
      highPerformanceGpu: typeof raw.highPerformanceGpu === 'boolean' ? raw.highPerformanceGpu : DEFAULTS.highPerformanceGpu,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Read launch.json and append its switches. Must run before app ready; the
 * state it returns is what this process runs with until it exits.
 */
function applyLaunchSwitches() {
  const launch = readLaunch();
  if (!launch.vsync) {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');
  }
  const highPerformanceGpu = launch.highPerformanceGpu && GPU_SWITCH;
  if (highPerformanceGpu) app.commandLine.appendSwitch('force_high_performance_gpu');
  return { vsync: launch.vsync, highPerformanceGpu };
}

/** Preferences' way to read and change launch.json; registered once per process. */
function registerLaunchIpc(active) {
  ipcMain.handle('launch:get', () => ({ saved: readLaunch(), active, gpuSwitch: GPU_SWITCH }));
  ipcMain.handle('launch:set', async (_e, opts) => {
    const next = readLaunch();
    if (typeof opts?.vsync === 'boolean') next.vsync = opts.vsync;
    if (typeof opts?.highPerformanceGpu === 'boolean') next.highPerformanceGpu = opts.highPerformanceGpu;
    await atomicWrite(FILE(), Buffer.from(JSON.stringify(next)));
    return next;
  });
}

/**
 * What a window's page is told at load (webPreferences.additionalArguments,
 * read back from process.argv by preload.cjs): the launch state in force,
 * the display's refresh rate and whether the machine is on battery.
 */
function launchArguments(active, displayHz, onBattery) {
  return [
    `--bozzetto-vsync=${active.vsync ? 'on' : 'off'}`,
    `--bozzetto-hp-gpu=${active.highPerformanceGpu ? 'on' : 'off'}`,
    `--bozzetto-display-hz=${Math.round(displayHz) || 0}`,
    `--bozzetto-battery=${onBattery ? 1 : 0}`,
  ];
}

module.exports = { applyLaunchSwitches, registerLaunchIpc, launchArguments };
