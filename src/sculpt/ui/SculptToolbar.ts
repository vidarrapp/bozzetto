// Flaticon uicons, solid straight (fi-ss-*), for the brushes and for the
// Negative button (circle-half-stroke: one style for every icon, owner
// call); toolIcon.ts draws them. Attribution lives in the README.
import type { InputShell } from '../bridge/InputShell';
import { onTap } from '../../ui/dom';
import { ArmButton } from './armButton';
import { setTip } from './edgeTip';
import { chordLabel, keymap } from '../../ui/keymap';
import { slotAction, toolBars } from '../tools/bars';
import { toolByEngine, toolById, type ToolDef, type Workspace } from '../tools/registry';
import { Dock } from './dockDrag';
import { addToBar, removeFromBar, tellNotKept } from './dockNotes';
import { setPanel } from './panelMemory';
import { openTileMenu } from './tileMenu';
import { toolIcon } from './toolIcon';

/**
 * The tool bar: the Select tool, the brushes and Transform in one
 * box at the bottom centre, each showing its icon with its hotkey
 * as a corner badge (View > Hotkeys on tools shows or hides the digits)
 * and its name, with the hotkey, in a tooltip above it. The tools and
 * their order are the registry's and the bars' (tools/registry.ts,
 * tools/bars.ts); a brush's key is its place on the bar, read from the
 * keymap, so a rebind shows here. Most iPads have
 * no keyboard, so this is the native way to swap brushes; buttons and
 * hotkeys stay in sync.
 *
 * Negative is built here, because its press logic is, but it stands in
 * the edge controls (BrushSliders takes `negativeEl`). It carves two
 * ways, and neither keeps a finger on the glass while the Pencil draws: on
 * an iPad a fingertip anywhere in the page hides the Pencil from it until
 * the finger lifts, below anything a web page can reach (plan 6.6e), so
 * hold-to-carve cannot be offered there at all. A TAP arms carving for the
 * next stroke, which spends it; a LONG PRESS latches carving on until a
 * tap lets go. Alt does the opposite of whatever the button says, so
 * keyboard users lose nothing either way.
 */
export class SculptToolbar {
  /** Toolbar transform toggle (mode.ts owns the gizmo). */
  onToggleTransform: (() => void) | null = null;
  private transformBtn!: HTMLButtonElement;
  /** Toolbar select toggle (the shell owns the mode). */
  onToggleSelect: (() => void) | null = null;
  private selectBtn!: HTMLButtonElement;
  private selectOn = false;
  /** Toolbar calipers toggle (the shell owns the mode). */
  onToggleMeasure: (() => void) | null = null;
  private measureBtn!: HTMLButtonElement;
  private measureOn = false;

  setMeasureActive(on: boolean): void {
    this.measureOn = on;
    this.measureBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.refresh();
  }

  setTransformActive(on: boolean): void {
    this.transformBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.keepInView();
  }

  setSelectActive(on: boolean): void {
    this.selectOn = on;
    this.selectBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.refresh();
  }
  private readonly root: HTMLDivElement;
  private readonly negativeBtn: HTMLButtonElement;
  /** The buttons by tool id: Sculpt's brushes, the Paint workspace's tools once it has been entered, and the three modes. */
  private readonly btns = new Map<string, HTMLButtonElement>();
  private paintOn = false;
  private readonly smoothBtn: HTMLButtonElement;
  private readonly maskBtn: HTMLButtonElement;
  private readonly arms: ArmButton[] = [];
  /** What the Smooth button is named now: Blur over the Paint tool. */
  private smoothName = 'Smooth';
  /** The Mask, Smooth and Negative buttons, top down, for the edge controls to stand. */
  get edgeEls(): HTMLButtonElement[] {
    return [this.maskBtn, this.smoothBtn, this.negativeBtn];
  }

  /** The Smooth or Mask button: Carve's press (a tap for the next stroke, a long press until a tap), on the key it stands for. */
  private keyButton(which: 'smooth' | 'mask', icon: string): HTMLButtonElement {
    const word = which === 'smooth' ? 'Smooth (hold Shift)' : 'Mask (hold Ctrl)';
    const btn = toolButton(
      '',
      `${word}: tap for the next stroke, long-press to keep it on until a tap`,
      which,
      icon,
      word,
    );
    btn.classList.add('sculpt-toolbar__mode');
    btn.dataset.arm = which;
    const input = this.input;
    this.arms.push(
      new ArmButton(
        btn,
        {
          latched: () => input.getStrokeKey(which, 'base'),
          armed: () => input.getStrokeKey(which, 'armed'),
          setLatched: (on) => input.setStrokeKey(which, 'base', on),
          setArmed: (on) => input.setStrokeKey(which, 'armed', on),
        },
        () => this.refresh(),
      ),
    );
    return btn;
  }

  /** Smooth and Mask as the state stands: the look of an arm or a latch, Blur's name and place in Paint. */
  private refreshKeys(): void {
    for (const [which, btn] of [['smooth', this.smoothBtn], ['mask', this.maskBtn]] as const) {
      const latched = this.input.getStrokeKey(which, 'base');
      btn.classList.toggle('sculpt-toolbar__btn--active', latched);
      btn.classList.toggle('sculpt-toolbar__btn--armed', !latched && this.input.getStrokeKey(which, 'armed'));
    }
    // In Paint, Shift does something over the Paint tool alone, where it blurs.
    const paintTool = toolById('bz.paint')?.engine;
    this.smoothBtn.hidden = this.paintOn && this.input.currentToolIndex() !== paintTool;
    const name = this.paintOn ? 'Blur (hold Shift)' : 'Smooth (hold Shift)';
    if (name !== this.smoothName) {
      this.smoothName = name;
      this.smoothBtn.setAttribute('aria-label', `${name}: tap for the next stroke, long-press to keep it on until a tap`);
      setTip(this.smoothBtn, name);
    }
  }
  /** Lifting a tool off the bar and putting it elsewhere on it (dockDrag.ts). */
  private readonly dock = new Dock({
    bar: () => this.center,
    workspace: () => (this.paintOn ? 'paint' : 'sculpt'),
    tile: (id) => this.btns.get(id),
    isStroking: () => this.input.isStroking(),
    nameOf: (id) => toolById(id)?.name ?? '',
    previewOrder: (ids) => this.previewOrder(ids),
    inHand: (id) => this.inHandId() === id,
    extra: () => this.extraTile(),
    fixed: () => ({
      lead: [this.selectBtn].filter((b) => !b.hidden),
      trail: [this.extraTile(), this.transformBtn, this.measureBtn].filter((b): b is HTMLButtonElement => !!b && !b.hidden),
    }),
    menu: (id, tile) => this.openMenu(id, tile),
  });

  constructor(private readonly input: InputShell) {
    toolBars.onNotKept = tellNotKept;
    this.root = document.createElement('div');
    this.root.className = 'sculpt-toolbar';
    // With a transport bar present (?tl=...&sculpt=1), sit above it.
    if (document.querySelector('.transport')) this.root.classList.add('sculpt-toolbar--raised');

    // Carve: a tap for the next stroke, a long press for every stroke
    // until a tap (see the class comment for why there is no hold).
    this.negativeBtn = toolButton(
      '',
      'Carve (negative): tap to carve the next stroke, long-press to keep carving until a tap. Alt + drag does the opposite of the button',
      'negative',
      'fi-ss-circle-half-stroke',
      'Negative',
    );
    this.negativeBtn.classList.add('sculpt-toolbar__neg');
    this.arms.push(
      new ArmButton(
        this.negativeBtn,
        {
          latched: () => input.getNegativeBase(),
          armed: () => input.getNegativeArmed(),
          setLatched: (on) => input.setNegativeBase(on),
          setArmed: (on) => input.setNegativeArmed(on),
        },
        () => this.refresh(),
      ),
    );
    this.smoothBtn = this.keyButton('smooth', 'fi-ss-water');
    this.maskBtn = this.keyButton('mask', 'fi-ss-mask-carnival');

    const center = document.createElement('div');
    center.className = 'sculpt-toolbar__group sculpt-toolbar__brushes';
    this.center = center;
    // Select at the far left, Transform at the far right (owner call): the
    // two tools that are not brushes bracket the row. They are not brushes:
    // Transform has letter keys (t, and w/e/r for one kind of handle) and a
    // gizmo instead of strokes, Calipers measures and edits nothing, and
    // each keeps a button and an active state of its own rather than a
    // place on the bar. Their keys show as badges like every other tool's.
    this.selectBtn = this.modeButton('bz.select', () => this.onToggleSelect?.());
    this.transformBtn = this.modeButton('bz.transform', () => this.onToggleTransform?.());
    this.measureBtn = this.modeButton('bz.calipers', () => this.onToggleMeasure?.());
    this.layout();

    this.root.append(center);
    document.body.appendChild(this.root);

    this.input.onToolChange = () => this.refresh();
    // The arm clears when its stroke ends, which the shell sees first.
    this.input.onNegativeChange = () => this.refresh();
    // A rebound key and a changed order both show on the badges and the tips.
    this.offKeys = keymap.onChange(() => this.paintKeys());
    this.offBars = toolBars.onChange(() => {
      this.layout();
      this.refresh();
    });
    this.refresh();
  }

  /** The bar's own box of buttons, which the Paint workspace adds its tools to. */
  private center!: HTMLDivElement;
  private offKeys: (() => void) | null = null;
  private offBars: (() => void) | null = null;

  /** A button for Select, Transform or Calipers: the registry's icon and words, the tool's own key. */
  private modeButton(id: string, onPress: () => void): HTMLButtonElement {
    const btn = this.toolButtonFor(toolById(id) as ToolDef);
    onTap(btn, onPress);
    return btn;
  }

  /** A button for a registry tool: its icon, its name, and data-tool for whoever has to find it by name. */
  private toolButtonFor(def: ToolDef): HTMLButtonElement {
    const btn = toolButton('', def.label, def.slot ?? def.id, def.icon ?? '', def.name);
    btn.dataset.tool = def.id;
    this.btns.set(def.id, btn);
    return btn;
  }

  /** The button of a brush on a workspace's bar, made on first need. */
  private brushButton(id: string, ws: Workspace): HTMLButtonElement | null {
    const have = this.btns.get(id);
    if (have) {
      // A tile that was the extra one is a tool of the bar now.
      have.classList.remove('sculpt-toolbar__btn--extra');
      return have;
    }
    const def = toolById(id);
    if (!def || def.kind !== 'brush' || def.engine === null || !def.icon) return null;
    const engine = def.engine;
    const btn = this.toolButtonFor(def);
    if (ws === 'paint') {
      btn.classList.add('sculpt-toolbar__btn--paint');
      btn.hidden = true;
    }
    // A press that lifts the tile, or slips, is not a tap (the dock decides, on its own window listeners).
    onTap(btn, () => this.input.selectBrush(engine), () => this.dock.swallowing);
    btn.addEventListener('pointerdown', (e) => this.dock.begin(e, id));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    return btn;
  }

  /**
   * Put the buttons in the bars' order: Select, Sculpt's brushes, Transform,
   * Calipers, then the Paint workspace's tools once they exist. The order
   * is the bars' (tools/bars.ts); nothing here names a tool.
   */
  private layout(): void {
    const ordered: HTMLButtonElement[] = [this.selectBtn];
    const extra = this.extraId();
    const extraBtn = (ws: Workspace): HTMLButtonElement | null => {
      if (!extra || toolById(extra)?.workspace !== ws) return null;
      const b = this.brushButton(extra, ws);
      b?.classList.add('sculpt-toolbar__btn--extra');
      return b;
    };
    for (const id of toolBars.order('sculpt')) {
      const b = this.brushButton(id, 'sculpt');
      if (b) ordered.push(b);
    }
    const sculptExtra = extraBtn('sculpt');
    if (sculptExtra) ordered.push(sculptExtra);
    ordered.push(this.transformBtn, this.measureBtn);
    // Paint's buttons wait for the first time Paint is entered; after that they follow the bar too.
    if (this.paintBuilt) {
      for (const id of toolBars.order('paint')) {
        const b = this.brushButton(id, 'paint');
        if (b) ordered.push(b);
      }
      const paintExtra = extraBtn('paint');
      if (paintExtra) ordered.push(paintExtra);
    }
    // Buttons of a tool taken off a bar go away; they come back by being put on one again.
    const keep = new Set(ordered);
    for (const [id, b] of this.btns) {
      if (!keep.has(b)) {
        b.remove();
        this.btns.delete(id);
      }
    }
    this.center.append(...ordered);
    this.shownExtra = extra;
    this.applyVisibility();
    this.paintKeys();
  }

  /** The tool whose tile stands as the extra one, as the last layout had it. */
  private shownExtra: string | null = null;

  /**
   * The tool in hand, when there is one: the engine's tool, unless the Select
   * tool or the Calipers are up, and only one of this workspace.
   */
  private inHandId(): string | null {
    if (this.selectOn) return null;
    const def = toolByEngine(this.input.currentToolIndex());
    if (!def || def.kind !== 'brush') return null;
    if (def.workspace === 'paint' ? !this.paintOn : this.paintOn || this.measureOn) return null;
    return def.id;
  }

  /** The tool in hand that is on no bar of its workspace: it stands as one extra tile, with no digit, until another tool is picked. */
  private extraId(): string | null {
    const id = this.inHandId();
    const def = id ? toolById(id) : undefined;
    if (!id || !def?.workspace || def.engine === null || !def.icon) return null;
    return toolBars.placeOf(def.workspace, id) > 0 ? null : id;
  }

  /** The extra tile on show, or undefined. */
  private extraTile(): HTMLButtonElement | undefined {
    const id = this.shownExtra;
    const b = id ? this.btns.get(id) : undefined;
    return b && b.classList.contains('sculpt-toolbar__btn--extra') && !b.hidden ? b : undefined;
  }

  private paintBuilt = false;

  /** Which workspace a button belongs to, for hiding it outside it. */
  private applyVisibility(): void {
    const paint = this.paintOn;
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def) continue;
      if (def.kind === 'mode') btn.hidden = paint && id !== 'bz.select';
      else btn.hidden = def.workspace === 'paint' ? !paint : paint;
    }
  }

  /**
   * Badges, tips and accessible names from the keymap: a brush's key is its
   * place on the bar, so what a person bound in Preferences is what shows.
   */
  private paintKeys(): void {
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def) continue;
      let action: string | null = null;
      let place = 0;
      if (def.kind === 'mode') action = def.keyAction ?? null;
      else {
        const own: Workspace = def.workspace === 'paint' ? 'paint' : 'sculpt';
        place = toolBars.placeOf(own, id);
        action = place >= 1 && place <= 10 ? slotAction(place) : null;
      }
      const chord = action ? keymap.chordFor(action) : null;
      setButtonKey(btn, chord);
      if (place) btn.dataset.place = String(place);
      else delete btn.dataset.place;
      const extra = btn.classList.contains('sculpt-toolbar__btn--extra');
      btn.setAttribute('aria-label', extra ? `${def.name}, not on the tool bar` : keyedName(def.label, chord));
      const tipName = btn.querySelector('.bz-tip__name');
      if (tipName) tipName.textContent = extra ? `${def.name} \u00b7 not on the tool bar` : def.name;
    }
  }

  /**
   * The badges and tips the tools would have with the bar in this order, for
   * the dock to show while a tool is lifted; null puts the real ones back.
   */
  private previewOrder(ids: readonly string[] | null): void {
    if (!ids) {
      this.paintKeys();
      return;
    }
    ids.forEach((id, i) => {
      const btn = this.btns.get(id);
      if (!btn) return;
      const place = i + 1;
      const chord = place <= 10 ? keymap.chordFor(slotAction(place)) : null;
      setButtonKey(btn, chord);
      btn.dataset.place = String(place);
    });
  }

  /**
   * The Paint workspace's bar, or Sculpt's: in Paint the Select tool and the
   * paint tools stand, and the brushes, Transform and Calipers are put away;
   * Sculpt has the brushes, Transform and Calipers and no paint tool. The
   * Paint buttons are made the first time Paint is entered.
   */
  setWorkspace(paint: boolean): void {
    if (paint && !this.paintBuilt) {
      this.paintBuilt = true;
      this.layout();
    }
    this.paintOn = paint;
    this.applyVisibility();
    this.root.classList.toggle('sculpt-toolbar--paint', paint);
    this.layout();
    this.refresh();
    window.dispatchEvent(new Event('bozzetto:shell-layout'));
  }

  /** Reflect the active brush, and Negative's arm or latch, on the buttons. */
  private refresh(): void {
    // A tool in hand that is not on the bar gets its tile; another tool in hand takes it away.
    if (this.extraId() !== this.shownExtra) this.layout();
    const active = this.input.currentToolIndex();
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def || def.kind !== 'brush') continue;
      const onPaint = def.workspace === 'paint';
      // With the Select tool up no brush is the active one, whatever the
      // vendor's current tool index still says (nor with the Calipers up,
      // on Sculpt's bar).
      const on = def.engine === active && !this.selectOn && (onPaint ? this.paintOn : !this.measureOn);
      btn.classList.toggle('sculpt-toolbar__btn--active', on);
    }
    // Latched fills the button like any active tool; armed is the lighter
    // look, since it lasts one stroke.
    const latched = this.input.getNegativeBase();
    this.negativeBtn.classList.toggle('sculpt-toolbar__btn--active', latched);
    this.negativeBtn.classList.toggle('sculpt-toolbar__btn--armed', !latched && this.input.getNegativeArmed());
    this.refreshKeys();
    this.keepInView();
    for (const fn of [...this.listeners]) fn();
  }

  private readonly listeners = new Set<() => void>();

  /** Hear the tool in hand, the workspace or the bar change (the Asset library marks its tiles by it). */
  onState(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The workspace whose bar is showing. */
  workspace(): Workspace {
    return this.paintOn ? 'paint' : 'sculpt';
  }

  /** The tool in hand, by id, or null (the Select tool, the Calipers, none). */
  inHand(): string | null {
    return this.inHandId();
  }

  /** Take a tool in hand, as a tap on its tile does. */
  pick(id: string): void {
    const engine = toolById(id)?.engine;
    if (engine !== undefined && engine !== null) this.input.selectBrush(engine);
  }

  /** Nothing is lifted or picked while a stroke is under way. */
  isStroking(): boolean {
    return this.input.isStroking();
  }

  /** A press on a tile of the Asset library that may lift (dockDrag.ts); `menu` is what its long press without moving opens. */
  liftFromLibrary(e: PointerEvent, id: string, tile: HTMLElement, menu: () => void): void {
    this.dock.beginFromWindow(e, id, tile, menu);
  }

  /** Whether the last press on a library tile was a lift or a slip, and so not a tap. */
  get swallowing(): boolean {
    return this.dock.swallowing;
  }

  /** Take a tool in hand and open the Tool panel on it. */
  showSettings(id: string): void {
    this.pick(id);
    setPanel('sculpt', true);
  }

  /** The menu of a tile on the bar: its settings, and taking it off the bar (or keeping it, if it is the extra tile). */
  private openMenu(id: string, tile: HTMLElement): void {
    const def = toolById(id);
    if (!def?.workspace) return;
    const ws = def.workspace;
    const kept = toolBars.placeOf(ws, id) > 0;
    openTileMenu(
      tile,
      [
        { label: 'Tool settings', action: () => this.showSettings(id) },
        kept ? { label: 'Remove from tool bar', action: () => removeFromBar(ws, id) } : { label: 'Add to tool bar', action: () => addToBar(ws, id) },
      ],
      true,
    );
  }

  /** Where the bar scrolls sideways (a phone), the tool in hand is brought to its middle. */
  private keepInView(): void {
    const bar = this.root.querySelector<HTMLElement>('.sculpt-toolbar__brushes');
    const on = bar?.querySelector<HTMLElement>('.sculpt-toolbar__btn--active');
    if (!bar || !on || bar.scrollWidth <= bar.clientWidth) return;
    const b = bar.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    bar.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }

  dispose(): void {
    for (const a of this.arms) a.dispose();
    this.input.onToolChange = null;
    this.input.onNegativeChange = null;
    this.offKeys?.();
    this.offBars?.();
    this.dock.dispose();
    if (toolBars.onNotKept === tellNotKept) toolBars.onNotKept = null;
    this.root.remove();
  }
}

function toolButton(key: string, title: string, slot: string, icon: string, tip?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sculpt-toolbar__btn';
  btn.appendChild(toolIcon(slot, icon));
  if (key) {
    // The hotkey digit stays visible as a corner badge (and as the button
    // text the headless suite matches on).
    const badge = document.createElement('span');
    badge.className = 'sculpt-toolbar__key';
    badge.textContent = key;
    btn.appendChild(badge);
  }
  btn.setAttribute('aria-label', title);
  if (tip) {
    // A tool is named by a box above it (shell.css), not the browser's
    // title: its name, and its hotkey in the mono face.
    const box = document.createElement('span');
    box.className = 'bz-tip';
    box.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'bz-tip__name';
    name.textContent = tip;
    box.appendChild(name);
    if (key) {
      const k = document.createElement('kbd');
      k.className = 'bz-tip__key';
      k.textContent = key;
      box.appendChild(k);
    }
    btn.appendChild(box);
  } else {
    btn.title = title;
  }
  return btn;
}

/** What a key looks like on a badge and in a tip: a plain key as it is, a named key spelt out; a chord with a modifier is not a badge's. */
function keyText(chord: string | null): { badge: string | null; tip: string | null } {
  if (!chord) return { badge: null, tip: null };
  const plain = chord.length === 1 ? chord : chordLabel(chord);
  return { badge: chord.includes('+') ? null : plain, tip: plain };
}

/** A button's name with its key in it where the label says `{key}`, and without the brackets when it has none. */
function keyedName(label: string, chord: string | null): string {
  const tip = keyText(chord).tip;
  return tip ? label.replace('{key}', tip) : label.replace(' ({key})', '');
}

/** Show, change or remove a button's key: the corner badge, and the key beside the name in the tip. */
function setButtonKey(btn: HTMLElement, chord: string | null): void {
  const { badge: badgeText, tip: tipText } = keyText(chord);
  const box = btn.querySelector<HTMLElement>('.bz-tip');
  let badge = btn.querySelector<HTMLElement>('.sculpt-toolbar__key');
  if (badgeText) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sculpt-toolbar__key';
      btn.insertBefore(badge, box);
    }
    badge.textContent = badgeText;
  } else badge?.remove();
  if (!box) return;
  let k = box.querySelector<HTMLElement>('.bz-tip__key');
  if (tipText) {
    if (!k) {
      k = document.createElement('kbd');
      k.className = 'bz-tip__key';
      box.appendChild(k);
    }
    k.textContent = tipText;
  } else k?.remove();
}
