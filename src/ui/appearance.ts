import { settings } from './settings';

/**
 * The panels' opacity (Preferences > Appearance): one CSS property,
 * --panel-alpha, that every panel's background reads (--panel-bg in
 * style.css), set on the root at once and on every change, so the slider
 * shows each value while it is dragged. Nothing behind a panel is blurred
 * at any setting: a blur over the 3D view had the browser redraw it on
 * every frame the view moved, on the GPU the frame itself needs. Each page
 * that shows panels calls this once; the stylesheet's own default (95%)
 * stands where none does, as in an embed.
 */
export function followPanelOpacity(): void {
  const apply = (): void => {
    document.documentElement.style.setProperty('--panel-alpha', String(settings.get('panelOpacity') / 100));
  };
  apply();
  settings.onChange(apply);
}
