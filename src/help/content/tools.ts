import { h, list, options, p, type Topic } from '../types';

const G = 'Sculpt tools';

/**
 * One topic per toolbar button. The brushes share the rows of the Brush
 * settings topic (Size, Strength, the pressure rows and Spacing); each
 * topic here lists what is special to the tool. Hotkeys are the defaults.
 */
export const TOOLS: Topic[] = [
  {
    id: 'tool-select',
    title: 'Select',
    group: G,
    tools: ['Select'],
    blocks: [
      p('Picks objects so that you can move, copy, mirror or delete several together. It is not a brush. Default hotkey: **Q**.'),
      options(
        ['Click an object', 'Selects it.'],
        ['Shift + click or drag', 'Adds to the selection.'],
        ['Ctrl + click or drag', 'Removes from the selection.'],
        ['Ctrl + Shift + drag', 'Adds with a marquee.'],
        ['Drag on the view', 'Draws a marquee around the objects to select. Use the pen or the mouse; a finger orbits.'],
        ['Alt + drag', 'Orbits the view.'],
      ),
      p('In the Scene list, **Ctrl** and click toggles an object and **Shift** and click takes a range.'),
      h('In the Tool panel'),
      options(
        ['Mode', 'Marquee is the one mode today. The list also shows "Lasso (soon)", which is not available yet.'],
        ['Translate, Rotate, Scale', 'The channel box: nine typed rows (X, Y, Z for each) for the active object. Position is in centimetres on real units. Rotation is in degrees. Scale is a factor. With several objects selected, a value they share shows and one that differs is left blank. A value you type is set on every selected object. Each change is one undo step.'],
      ),
      p('A hidden or locked object cannot be moved, so the channel box shows it read-only.'),
    ],
  },
  {
    id: 'tool-crease',
    title: 'Crease',
    group: G,
    tools: ['Crease'],
    blocks: [
      p('Cuts a sharp groove and gathers the surface toward it. Use it for folds, wrinkles and lines between forms. Default hotkey: **1**.'),
      options(
        ['Profile', 'The shape of the cut across the stroke, with the presets Sharp, Medium and Soft. See Profile curves in the Brush settings topic.'],
        ['Pinch', 'How much the surface is gathered in toward the groove, from 0 to 2.5. At 0 the stroke only carves a groove.'],
      ),
      p('**Strength** is a length in centimetres: how far one stroke at full pressure moves the surface.'),
    ],
  },
  {
    id: 'tool-move',
    title: 'Move',
    group: G,
    tools: ['Move'],
    blocks: [
      p('Moves the surface inside the brush along with the pointer. Use it to push a form to a new place without adding or removing material. Default hotkey: **2**.'),
      options(['Falloff (sharp-soft)', 'How the pull fades toward the rim of the brush. Sharp, on the left, moves the middle of the brush almost as one piece and lets go quickly at the rim. Soft, on the right, is a smooth bell.']),
      p('**Strength** runs from 0 to 1.'),
    ],
  },
  {
    id: 'tool-clay',
    title: 'Standard (clay)',
    group: G,
    tools: ['Standard (clay)'],
    blocks: [
      p('Builds the surface up, as if you laid strips of clay on it. It follows the form under the brush, so strokes blend instead of stamping flat facets. Default hotkey: **3**. The Tool panel names this brush "Standard clay".'),
      options(
        ['Profile', 'The shape of the strip, with the presets Plateau, Soft, Flat and Round. **Plateau**, the default, keeps a flat-topped strip with a firm edge. **Soft** gives a rounded build that goes about half as high for the same Strength.'],
      ),
      p('**Strength** is a length in centimetres: about how much one stroke at full pressure builds. One stroke cannot build taller than about two thirds of the brush radius, so with a small brush a high Strength changes nothing past that point. Go over the place again, or use a bigger brush. Strength 0 does nothing.'),
      p('Hold **Alt** to carve instead of building, or use the Carve button.'),
    ],
  },
  {
    id: 'tool-inflate',
    title: 'Inflate',
    group: G,
    tools: ['Inflate'],
    blocks: [
      p('Pushes the surface out along its own direction, so a region swells like a balloon. Carve (Alt, or the Carve button) deflates it. Default hotkey: **4**.'),
      p('**Strength** is a length in centimetres. It has no settings of its own beyond the shared brush rows.'),
    ],
  },
  {
    id: 'tool-pinch',
    title: 'Pinch',
    group: G,
    tools: ['Pinch'],
    blocks: [
      p('Draws the surface toward the middle of the stroke, which sharpens ridges and tightens creases. Default hotkey: **5**.'),
      p('**Strength** runs from 0 to 1. It has no settings of its own beyond the shared brush rows.'),
    ],
  },
  {
    id: 'tool-flatten',
    title: 'Flatten',
    group: G,
    tools: ['Flatten'],
    blocks: [
      p('Planes the surface under the brush toward a flat level. Use it for flat faces and cuts. Default hotkey: **6**.'),
      p('**Strength** runs from 0 to 1. It has no settings of its own beyond the shared brush rows.'),
    ],
  },
  {
    id: 'tool-rake',
    title: 'Rake',
    group: G,
    tools: ['Rake'],
    blocks: [
      p('Cuts a row of parallel grooves with tines across the stroke, like a comb or a toothed chisel. Use it for hair, fur, fabric and texture. Default hotkey: **7**. **Shift** still smooths while the Rake is in hand.'),
      h('Presets'),
      p('**Fine**, **Comb**, **Coarse**, **Chisel** and **Scraper** set all the rows below, the Strength included. Any row can be changed after. The preset lights up while the settings are still exactly the preset\'s.'),
      h('Rows'),
      options(
        ['Tines', 'How many grooves a dab cuts.'],
        ['Tine width', 'How wide each tine is, from 0.1 to 1.'],
        ['Scrape', 'How flat each dab planes the surface before the tines cut, from 0 (the grooves follow the form) to 1 (scraped flat, with the grooves cut into the flat).'],
        ['Taper', 'Makes the tines toward the edges of the row cut shallower than the middle ones, from 0 (all alike) to 1.'],
        ['Invert (raise ridges)', 'Raises ridges instead of cutting grooves, on any form.'],
        ['Stop at depth', 'On, the tines cut down to the Strength below the surface around them and stop. Going over a place again adds next to nothing, and a bump that stands proud is cut a little further by each pass. Off, every pass cuts deeper.'],
        ['Tine profile', 'The cross-section of a groove, with the presets Round, V, Flat and Soft.'],
      ),
      p('**Strength** is a length in centimetres: the depth of the groove. The ring that shows the brush size also shows the tines.'),
    ],
  },
  {
    id: 'tool-drag',
    title: 'Drag',
    group: G,
    tools: ['Drag'],
    blocks: [
      p('Pulls the surface along behind the pointer as you drag, and the area it works on follows the pointer. Use it for large, quick changes of shape. Default hotkey: **8**.'),
      p('Drag has no Strength row and no pressure rows. Only the brush size matters.'),
    ],
  },
  {
    id: 'tool-polish',
    title: 'Polish',
    group: G,
    tools: ['Polish'],
    blocks: [
      p('Flattens and cleans up small bumps while keeping edges sharp. Use it to prepare a surface or to finish a hard-surface form. Default hotkey: **9**.'),
      options(
        ['Plane lock (follow-flatten)', 'From 0 to 0.95. High values flatten the surface hardest and remove chatter. Low values follow gentle curves without flattening them.'],
        ['Profile', 'The shape of the polish across the brush, with the presets Default, Wide and Narrow.'],
        ['Build-up', 'How quickly the effect builds as you pass over a place, from 0.2 to 2. A low value smooths the effect across the stroke instead of stepping it.'],
      ),
    ],
  },
  {
    id: 'tool-paint',
    title: 'Paint',
    group: G,
    tools: ['Paint'],
    blocks: [
      p('Paints colour onto the surface, stored on the object. Default hotkey: **0**.'),
      options(
        ['Colour', 'The colour swatch opens a colour picker. Drag the swatch over the view to pick a colour off the screen.'],
        ['Fill', 'The button beside the swatch (its tooltip says "Fill the object with this colour") covers the whole object in the colour, in one undo step.'],
        ['Alt + click', 'Picks a colour from the surface ("Alt+click for color picker").'],
        ['Profile', 'The falloff of the paint across the brush, with the presets Hard, Default, Soft and Airbrush.'],
      ),
      p('Hold **Shift** to blur the paint instead of smoothing the shape. The blur uses the same profile. **Strength** runs from 0 to 1.'),
      p('Change the object\'s base look in the Material panel under **Surface**. See the Material panel topic.'),
    ],
  },
  {
    id: 'tool-transform',
    title: 'Transform',
    group: G,
    tools: ['Transform'],
    blocks: [
      p('Moves, rotates and scales whole objects with a gizmo. It is not a brush. Default hotkey: **T**, which shows every handle you have ticked. **W**, **E** and **R** show one kind at a time: move, rotate and scale. **T** again, or a brush key, returns to sculpting.'),
      p('Click an object to move the gizmo to it. **Shift** and click adds it to the selection and **Ctrl** and click removes it. The selection moves together. The centre of the unified gizmo moves the object across the screen.'),
      h('In the Tool panel'),
      p('Tick the handles you want the gizmo to show:'),
      list('Move arrows', 'Move planes', 'Rotate rings', 'Scale boxes', 'Screen move (centre)', 'Uniform scale (in R)'),
      p('The channel box (Translate, Rotate, Scale) sits above them, as it does for Select.'),
    ],
  },
  {
    id: 'tool-negative',
    title: 'Carve (negative)',
    group: G,
    tools: ['Carve (negative)'],
    blocks: [
      p('The button at the left end of the toolbar turns a brush around so that it cuts where it would build, or deflates where it would inflate.'),
      list(
        '**Tap** it to carve the next stroke only.',
        '**Long-press** it to keep carving on every stroke until you tap again.',
        'Hold **Alt** while you drag to do the opposite of whatever the button says.',
      ),
      p('It exists for the pen on an iPad, where a finger on the screen would hide the pen from the page, so nothing has to be held.'),
    ],
  },
  {
    id: 'tool-smooth',
    title: 'Smooth (Shift)',
    group: G,
    blocks: [
      p('Smooth has no toolbar button and no number key. Hold **Shift** while you drag with any brush to smooth instead. With the Paint brush, **Shift** blurs the paint.'),
      p('The settings are one set for every brush, in the **Smooth (Shift)** group at the foot of each brush\'s Tool panel. A change made under Clay shows under the Rake.'),
      options(
        ['Strength', 'From 0 to 1.'],
        ['Mode', '**Average** is the plain umbrella average, the default. **Surface** fits the surface to the nearby points and moves each vertex onto it. Use it on voxel-remeshed objects, where Average can leave bumps and dents at the points where three, five or more edges meet.'],
        ['Relax', 'Only in Surface mode, from 0 to 1. It evens the triangles along the surface.'],
      ),
    ],
  },
  {
    id: 'tool-mask',
    title: 'Mask (Ctrl)',
    group: G,
    blocks: [
      p('Mask protects part of the surface from every brush. Masked areas are tinted. It has no toolbar button: hold **Ctrl** and drag with any brush to paint the mask, and add **Alt** to unmask.'),
      options(
        ['Ctrl + drag', 'Paints the mask.'],
        ['Ctrl + Shift + drag across the model', 'Masks one side of an edge loop, the side the drag moves toward. Add **Alt** to unmask.'],
        ['Ctrl + click off the mesh', 'Inverts the mask.'],
        ['Ctrl + click on the model', 'Masks the poly group you clicked. Add **Alt** to unmask it.'],
        ['Ctrl+A, Ctrl+C, Ctrl+I', 'Mask the whole object, clear the mask, invert the mask.'],
        ['Ctrl+H', 'Shows or hides the mask tint.'],
        ['Ctrl+E', 'Extracts the masked region as a new object, at the Extract thickness set in the Model panel.'],
      ),
      p('The Mask section of the Model panel has the other controls: **Darken**, **Blur**, **Sharpen**, **Invert**, **Clear**, **Extract thickness** and **Extract masked**. See the Model panel topic.'),
    ],
  },
];
