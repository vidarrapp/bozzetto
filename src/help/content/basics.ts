import { h, list, options, p, type Topic } from '../types';

const G = 'The basics';

export const BASICS: Topic[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    group: G,
    tools: ['Hide the interface', 'Show the interface'],
    blocks: [
      p('Bozzetto Web is a browser app for posing, sculpting and presenting. **Armature** is a posable figure you pose and send to Sculpt as a base. **Sculpt** is clay, brushes and paint. **Present** lights and frames the finished work, and publishes it. You find it in three places: the gallery, the viewer and the editors.'),
      h('Start a sculpt'),
      p('In the gallery, choose **Create**. You can start a **New Sculpt** (a sphere of clay, brushes and paint), a **New Armature** (a posable figure) or **Import OBJ** (one .obj file from another app, opened in Sculpt as a new scene).'),
      p('The gallery and the other pages (Community, My projects, Account, Review, Owner tools) have the same title strip as the editors. **File** starts a new sculpt, a new armature or an OBJ import, **View** lists the pages you may visit with the one you are on checked, **Help** is the same everywhere, the page\'s name is in the middle, and **Sign in**, or your @handle menu with **Account** and **Sign out**, is at the right. When you are signed in, the @handle menu is at the right end of the strip in the editors and the viewer too.'),
      h('What is on the screen in Sculpt'),
      list(
        'The **title strip** across the top has the **File**, **Edit**, **View** and **Help** menus at the left, then the workspace path **Armature › Sculpt › Paint › Present**, the scene\'s name and where it is kept in the middle, and, at the right, your @handle menu when you are signed in, then the hide button (and **Publish**, in Present only, when you are signed in).',
        'The **details** at the top left of the view are plain text: in Sculpt and Paint the object\'s name, **Tris**, **Verts**, **Level**, its **Size** in cm, the active **Layer** and more, in Armature the figure\'s name, height and selected joint. **View**, then **Details**, or **Shift + I**, shows and hides them, and the Pencil works straight through them.',
        'The **tool bar** along the bottom holds the tools, each with its hotkey digit, which **View**, then **Hotkeys on tools**, shows or hides.',
        'The **edge controls** at the bottom left are, from the bottom, Carve (negative), Undo, Redo and Solo, with the brush size and strength fields above them while the Tool panel is closed. A field names itself (Size, Strength) only while you press it or point at it, and a button shows its name when you point at it or hold it.',
        'The **Scene**, **Model** and **Layers** panels share the left side, and **Tool**, **Material** and **Reference** the right. Each side has a row of tabs at the top and one open panel: a tab opens its panel and closes the other, and the open panel\'s tab closes it.',
      ),
      h('Arrange the tool bar'),
      p('**Press and hold** a tool on the tool bar for a moment, with the Pencil or a finger, and it lifts: a larger copy follows you, with the tool\'s name above it, and its place stays open. With a mouse, press and drag. Move along the bar and the others slide aside to make room; let go and the tool stays there. The number keys **1** to **0** follow the order, so the tool in the first place is on **1**, and every place shows its digit while you hold a tool. Press **Esc** while you hold it, and the tool goes back. Select, Transform and Calipers stay where they are. Sculpt and Paint each keep their own order, and it is kept on this device when saving is on.'),
      h('Take a tool off the tool bar'),
      p('Drag a tool off the bar, up or to the side, and the copy you hold dims. Let go and the tool is off the bar. It is still in the **Asset library**, and a notice with an **Undo** puts it back where it was. The bar can be left empty. **View**, then **Reset tool bar**, puts the default tools back in the default order, with an **Undo**.'),
      p('A tool in hand that is not on the bar, because you took it from the library, shows as one extra tile at the end of the tools. It has no number and a dashed line inside it. Drag it onto the bar to keep it; pick another tool and it goes.'),
      p('**Press and hold** a tool without moving and let go, and a small menu opens at it: **Tool settings** opens the Tool panel on that tool, and **Remove from tool bar** takes it off. For the extra tile, **Add to tool bar** keeps it.'),
      h('What is on the screen in the viewer'),
      list(
        'The **title strip** has the same menus as everywhere else, in the same order: **File**, **Edit**, **View** and **Help**, with a **Moderation** menu between **View** and **Help** when you are signed in and there is something in it. **Edit** holds **Preferences…**, and **View** has **Frame all**, **Wireframe**, **Shadows**, **Move light**, the panels and **Hide interface**. At the right are the star, for a member looking at shared work, and the hide button.',
        '**File** has **New sculpt from this** on the site\'s own templates, which starts a new sculpt from the frame on screen; **Edit in Present**, for the owner; and **Close**, which goes back to the page you came from. Shared work from Community is to look at only.',
        '**Moderation** has **Report…**, which sends a reviewer a report about shared work, and, in review mode, **Approve**, **Reject…**, **Hide…** and **Unhide**, as the work allows.',
      ),
      h('Hide the interface'),
      p('Press **Tab** to close the open panels, then again to hide the whole interface, then again to bring it back. **Esc** brings a hidden interface back. The hide button at the right of the title strip does the same without a keyboard; it stays on screen while the rest is hidden.'),
      h('Undo and redo'),
      p('**Edit**, then **Undo** or **Redo**, the two buttons at the bottom left, or **Ctrl+Z** and **Ctrl+Shift+Z**. Holding a button walks back or forward through the history.'),
      h('Typing a value into a slider'),
      p('Every slider shows its value while you drag it. Double-click a slider (double-tap on touch) to type a value instead. Enter or a press anywhere else applies it, and **Esc** keeps what was there. A typed value may go past the end of the slider. It is held only to what the setting can be, so a strength never goes below zero and an angle wraps round.'),
      h('Your work is kept'),
      p('Sculpt saves your scene in this browser as you work, and a reload brings it back. To keep it safe, use **File**, then **Save file** or **Save to library**. The word after the name in the top bar says where it is kept. See the Files topic.'),
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
