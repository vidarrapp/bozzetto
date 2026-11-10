import { APP_VERSION } from '../../ui/version';
import { h, options, p, type Block, type Topic } from '../types';

export const SETTINGS: Topic[] = [
  {
    id: 'preferences',
    title: 'Preferences',
    group: 'Settings and reference',
    blocks: [
      p('Open **Edit**, then **Preferences…**, or press **Ctrl+,**. In the viewer, the hotkey guide has a **Customise hotkeys…** button. The settings are saved in this browser, and take effect at once.'),
      h('Touch (Sculpt)'),
      options(
        ['Fingers: navigate only', 'One finger orbits and two pan and zoom, in every tool. Only the pen and the mouse sculpt, select and move objects.'],
        ['Fingers sculpt too', 'For working without a pen: a finger on the model sculpts as the mouse does. Two fingers still pan and zoom.'],
      ),
      h('Appearance'),
      options(['Panel opacity', 'How much of the view shows through the panels, from 60% to 100%. At 100% they are solid. It starts at 95%.']),
      h('Performance'),
      p('The question here is how frames are drawn while you sculpt, pose or move the view.'),
      options(
        ['Fast frames', 'Ambient occlusion holds still under a stroke, and the fill and rim shadows redraw less often, so each frame keeps up with the pen. All of it is back as you let go. This is the default.'],
        ['Full look', 'Every frame is drawn in full, as a still one is.'],
      ),
      p('**Anti-aliasing** smooths the edges on screen:'),
      options(
        ['When still', 'Edges are smoothed once the view has been still for a second, over the next few frames, and drawn plain while anything moves. It costs nothing while you work.'],
        ['Always', 'Every frame is smoothed with 4× multisampling, at a cost on every frame.'],
        ['Off', 'Never smoothed on screen. Thumbnails and anything you publish are smoothed anyway.'],
      ),
      options(['Adaptive quality', 'When frames keep missing the display, ambient occlusion, then the shadows, then the resolution are lightened a step at a time, between strokes, and brought back when there is room.']),
      h('Diagnostics'),
      options(
        ['Frame meter', 'Frame rate, where each frame\'s time goes (CPU, GPU and the display\'s budget) and which side is short. **P** shows and hides it.'],
        ['Stall log', 'Every pause between frames longer than 300 ms, and how long the heavy jobs took, newest first.'],
        ['Input log', 'Pointer and touch events as the browser delivers them, and what Sculpt did with each.'],
        ['Passkey check…', 'Whether this device can sign in with a passkey, in the browser and from the Home Screen, and whether the bot check loads. It opens in place of this page.'],
      ),
      h('Hotkeys'),
      p('Every keyed action, in a **Sculpt** tab and a **Viewer** tab. Click a key, then press the new one; **Esc** cancels. If the key is taken, you are asked whether to take it. The arrow beside a key puts it back to its default, and **Reset all** puts every key back.'),
    ],
  },
  {
    id: 'hotkeys',
    title: 'Hotkeys',
    group: 'Settings and reference',
    blocks: [
      p('Press **H** (or the **?** button in the top right) to open the hotkey guide. It lists every key and gesture for the mode you are in, and it is drawn from the live keymap, so it always shows the keys you have set. That is why the table is not repeated here.'),
      p('Every default key named in this help can be changed under **Edit**, then **Preferences…**. The keys named here are the defaults.'),
      p('In the guide, **Customise hotkeys…** opens Preferences, and at its foot it names the version running, with **Check for updates** when the installed app can update itself.'),
    ],
  },
  {
    id: 'about',
    title: 'About and credits',
    group: 'Settings and reference',
    blocks: about,
  },
];

function about(): Block[] {
  return [
    p(`**Bozzetto Web** ${APP_VERSION}`),
    p('Made by Vidar Rapp. Bozzetto is released under the MIT licence.'),
    p('Bozzetto Web is built on the work of many people. Everything below ships with the app. Each entry says what it is used for, under which licence, and where to find it.'),
    p('Icons: Uicons by [Flaticon](https://www.flaticon.com/uicons).'),
    { kind: 'credits' },
    h('The full text'),
    p('The licence texts, with the copyright notices each licence asks to be kept with copies, are in the file THIRD_PARTY_NOTICES.md in the source of the app. That file is the full legal text. This page is a summary of it.'),
  ];
}
