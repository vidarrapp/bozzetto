import { h, list, options, p, type Topic } from '../types';

const G = 'The basics';

export const BASICS: Topic[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    group: G,
    tools: ['Hide the interface', 'Show the interface'],
    blocks: [
      p('Bozzetto Web is a browser app for sculpting, posing and playing back timelapses of sculpts. You find it in three places: the gallery, the viewer and the two editors, **Sculpt** and **Armature**.'),
      h('Start a sculpt'),
      p('In the gallery, choose **Create**. You can start a **New Sculpt** (a sphere of clay, brushes and paint), a **New Armature** (a posable figure), **Import OBJ** (one .obj file from another app, opened in Sculpt as a new scene) or **Create timelapse** (frames made elsewhere, played back as a timelapse or a model).'),
      h('What is on the screen in Sculpt'),
      list(
        'The **title strip** across the top has the **File**, **Edit**, **View** and **Help** menus at the left, the project and object readout in the middle, and, at the right, **Publish** (when you are signed in) and the hide button.',
        'The **tool bar** along the bottom holds the tools, each with its hotkey digit, which **View**, then **Hotkeys on tools**, shows or hides.',
        'The **edge controls** at the bottom left are, from the bottom, Carve (negative), Undo, Redo and Solo, with the brush size and strength fields above them while the Tool panel is closed.',
        'The **Scene** and **Model** panels share the left side, and **Tool** and **Render** the right. Each side has a row of two tabs at the top and one open panel: a tab opens its panel and closes the other, and the open panel\'s tab closes it.',
      ),
      h('Hide the interface'),
      p('Press **Tab** to close the open panels, then again to hide the whole interface, then again to bring it back. **Esc** brings a hidden interface back. The hide button at the right of the title strip does the same without a keyboard; it stays on screen while the rest is hidden.'),
      h('Undo and redo'),
      p('**Edit**, then **Undo** or **Redo**, the two buttons at the bottom left, or **Ctrl+Z** and **Ctrl+Shift+Z**. Holding a button walks back or forward through the history.'),
      h('Typing a value into a slider'),
      p('Every slider shows its value while you drag it. Double-click a slider (double-tap on touch) to type a value instead. Enter or a press anywhere else applies it, and **Esc** keeps what was there. A typed value may go past the end of the slider. It is held only to what the setting can be, so a strength never goes below zero and an angle wraps round.'),
      h('Your work is kept'),
      p('Sculpt saves your scene in this browser as you work, and a reload brings it back. To keep it safe, use **File**, then **Save file** or **Save to library**. See the Files topic.'),
    ],
  },
  {
    id: 'navigating',
    title: 'Navigating the view',
    group: G,
    blocks: [
      p('How you move the camera depends on the mode you are in.'),
      h('In Sculpt'),
      options(
        ['Orbit', 'Drag off the model. One finger orbits anywhere, in every tool, unless Preferences lets fingers sculpt.'],
        ['Pan', 'Hold **Cmd** or **Shift** and drag. Two fingers pan and zoom, even on the model.'],
        ['Zoom', 'Scroll, pinch, or hold **Ctrl** and drag off the model. Zooming goes toward your last stroke, which is also the point the orbit turns about.'],
        ['Turntable', 'The **left** and **right** arrow keys turn the model. The turn speeds up as you turn the wheel.'],
        ['Frame the model', 'Press **F**. It frames what shows when poly groups are hidden.'],
        ['Frame the whole scene', 'Press **A**.'],
      ),
      p('In the Select tool, **Alt** and drag orbits.'),
      h('In Armature'),
      p('The view moves as it does in Sculpt. Tapping a part selects its joint, and tapping off the figure lets it go, so turning the view keeps your selection.'),
      p('All of these keys can be changed. See the Hotkeys topic.'),
    ],
  },
];
