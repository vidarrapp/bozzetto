import { h, list, options, p, type Topic } from '../types';

export const BRUSH: Topic[] = [
  {
    id: 'brush-settings',
    title: 'Brush settings',
    group: 'Sculpt settings',
    blocks: [
      p('These rows are in the **Tool** panel, under a heading named for the active brush, and apply to the brushes (not to Select or Transform). The values are kept for each brush separately, so Clay can be big and soft while the Rake is small and firm.'),
      options(
        ['World-scale size', 'Off, the brush is a fixed number of screen pixels, so it covers less of the model up close and more far away. On, the brush is pinned to the model, so a size means the same thing wherever the camera is. On real units the size then reads in centimetres.'],
        ['Size', 'The brush radius, from 5 to 500 pixels on the slider. Type a bigger number to go past 500.'],
        ['Pressure: size', 'How much pen pressure changes the size, from 0 (none) to 1 (the full range).'],
        ['Size curve', 'How the size follows the pressure: **Linear**, **Soft (light touch)** or **Firm (press hard)**. The row only shows when Pressure: size is above 0.'],
        ['Strength', 'How much the brush does. Clay, Inflate, Crease and the Rake take it as a length in centimetres: how far one stroke at full pressure moves the surface at the brush centre, the same at any brush size. The slider runs from 0 to 5 cm and a typed value up to 50. Every other brush takes it as a share from 0 to 1. Drag has no Strength.'],
        ['Pressure: strength', 'How much pen pressure changes the strength, from 0 to 1. A mouse or a finger counts as a full press.'],
        ['Strength curve', 'How the strength follows the pressure, with the same three choices as Size curve. It shows when Pressure: strength is above 0.'],
        ['Spacing', 'How far the brush travels between dabs, as a share of its radius, from 0.02 to 0.6. A small value makes a smooth ribbon and a large one a row of separate dabs. A very small value makes the stroke slow.'],
      ),
      h('Changing size and strength quickly'),
      list(
        'The two fields at the left edge, which show while the Tool panel is closed, do the same as the rows in the Tool panel.',
        'Hold **B** and drag with the pen down to change the size. Hold **S** and drag up or down to change the strength.',
        '**[** and **]** step the size. **;** and **\'** step the strength (by 0.05 cm when the strength is a length).',
        'While you change the strength, a short line at the brush centre shows how far a stroke would push, with the value beside it. Brushes on 0 to 1 show a percentage.',
      ),
      h('Symmetry'),
      p('The **Symmetry** section is for the brushes only.'),
      options(
        ['Mirror sculpting', 'Mirrors every stroke across the chosen axis. The label shows its hotkey, **X** by default.'],
        ['X, Y, Z', 'The axis to mirror across. It is kept for each brush.'],
      ),
      h('Profile curves'),
      p('Clay, Crease, Polish, Paint and the Rake\'s tine draw their falloff as a curve you can edit. The plot runs from the centre of the brush on the left to its edge on the right. A row of presets sets a starting shape.'),
      list(
        'Drag an anchor or one of its handles to bend the curve.',
        'Tap the curve or the plot to add an anchor.',
        'Double-tap an anchor to make it a corner.',
        'Drag an anchor out of the box to remove it.',
        'With an anchor focused, the arrow keys move it, and Delete removes it.',
      ),
      p('Each brush\'s curve is saved with the scene.'),
      h('Smooth, mask and dynamic topology'),
      p('See the Smooth (Shift) and Mask (Ctrl) topics. Dynamic topology is in the Model panel.'),
    ],
  },
];
