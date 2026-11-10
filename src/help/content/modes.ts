import { h, options, p, type Topic } from '../types';

const G = 'Files and modes';

export const MODES: Topic[] = [
  {
    id: 'files',
    title: 'Files and publishing',
    group: G,
    blocks: [
      h('The File menu in Sculpt'),
      options(
        ['New sculpt', 'Starts over. It asks first if the current objects would be lost.'],
        ['Open…', 'Opens a .bozz file, the scene format. It asks first if the current objects would be replaced.'],
        ['Save file', 'Downloads the scene as a .bozz file with a time stamp in its name. A file is the copy that does not depend on this device\'s storage, so it is the safest one to keep.'],
        ['Save to library', 'Where it goes depends on who you are. Signed in, it saves to **My projects** on the site, where only you see it (the site\'s owner saves to **Projects**). Signed out, it downloads a .bozz file. The menu line under it says which one it will do.'],
        ['Keep on this device', 'Keeps a copy in this browser\'s storage and shows it on the gallery\'s device cards. "On this device only. A reinstall or clearing the browser loses it."'],
        ['Export OBJ', 'Downloads an .obj file. If the object was imported from an OBJ, you get its level 0 in the file\'s own vertex and face order, so another app can match it up. Otherwise you get every object as triangles, at the level on screen. The line under the item says which. Poly groups are written as `g` lines.'],
        ['Import OBJ…', 'Adds an .obj file to the scene. Its `g` and `o` lines become poly groups.'],
        ['Z-up OBJ import', 'A checkbox. Tick it for OBJ files from Blender and most 3D apps, which have Z pointing up, so that they are rotated to stand up in Sculpt.'],
      ),
      p('Save file, Save to library, Keep on this device and Export OBJ are greyed out when the scene is empty.'),
      h('Autosave'),
      p('Sculpt also saves your scene in this browser as you work, and a reload brings it back. If the browser is out of storage, a notice says that autosave has stopped; save a file to keep the work.'),
      h('Publish'),
      p('When you are signed in, a **Publish** chip appears in the top row. It opens a small window that you can move, and that does not block the work around it. **Publish model** puts the scene on the site as a model that opens in the viewer. The owner chooses a project id, a title and who can see it (**Public: a template in the gallery** or **Private: only you**). A member only gives a title, and the model goes to **My projects**. When you publish from Present mode, the camera and look you presented are stored with it.'),
      h('Timelapses'),
      p('Bozzetto Web plays timelapses and publishes ones made from frames, but does not record them while you sculpt. In the gallery, **Create**, then **Create timelapse**, takes OBJ or GLB frames made in another app and plays them back as a timelapse or a model. Signed in, it saves them to your projects; as a guest, nothing is uploaded. The viewer topic says how to play one.'),
    ],
  },
  {
    id: 'present',
    title: 'Present mode',
    group: G,
    blocks: [
      p('Present shows the model on its own, for looking at it and for showing it. Choose **Present** in the top row, or press **Shift+P**. **Esc**, **Done** or the chip again leaves it, and the interface comes back as it was.'),
      p('While you present, the toolbar, the brush rail, the Scene, Model and Tool panels, the brush ring and the object stats are hidden, and the brushes, the gizmo and the selection do not answer. You can still orbit, pan and zoom. The **Render** panel stays, with everything on the look. Nothing about the scene changes by going in or out.'),
      h('The bar along the bottom'),
      options(
        ['Turntable', 'Starts and stops a slow turn about the model\'s vertical axis. **Space** does the same. Any press or wheel on the view stops it.'],
        ['Speed', 'A slider from 2 to 60 degrees a second. It starts at 12.'],
        ['Save image', 'Saves a PNG of the view at twice the window, with none of the interface in it.'],
        ['Done', 'Leaves Present.'],
      ),
      h('Save turntable'),
      p('One row saves a clip of one full turn at the turntable\'s speed from the current view, so 36 degrees a second makes ten seconds.'),
      options(
        ['MP4 or GIF', 'The button names the format; press it to switch.'],
        ['1× or 2×', 'The size of the clip, as the window at 1× or 2×.'],
        ['Save turntable', 'Renders the clip and downloads it. A progress bar shows while it renders, and **Cancel** stops it with nothing saved.'],
      ),
    ],
  },
  {
    id: 'armature',
    title: 'Armature mode',
    group: G,
    blocks: [
      p('Armature is a posable figure, to use as a reference or to send to Sculpt as a base. Start it from the gallery with **Create**, then **New Armature**. The **Armature** panel is on the left and the **Render** panel on the right.'),
      h('The menus'),
      options(
        ['New armature', 'Starts over, and asks first if the pose and proportions would be lost.'],
        ['Open…', 'Opens an .armature file.'],
        ['Load model…', 'Loads a .glb or .gltf model as the figure.'],
        ['Save', 'Downloads an .armature file.'],
        ['Save to library', 'Saves to the site, as Sculpt\'s does.'],
        ['Send to Sculpt', 'The same as the panel\'s button. Hotkey **Ctrl+Enter**.'],
        ['Edit', 'Undo, Redo and Preferences…'],
      ),
      h('Figure'),
      options(
        ['Preset', 'Male or Female (placeholder blocks), or a Male or Female mannequin, realistic or stylized. A model you load joins the list.'],
        ['Height', 'How tall the figure stands.'],
        ['Floor offset', 'Raises or lowers the floor it stands on, in centimetres.'],
        ['Symmetry', 'Mirrors pose edits to the other side. The label shows its hotkey, **X** by default.'],
        ['Reset pose', 'Puts the pose back. Hotkey **Shift+R**.'],
        ['Copy L → R, Copy R → L', 'Copies the pose of one side onto the other.'],
      ),
      p('Tap a part to pose its joint. Tap off the figure to let it go. The pelvis moves the whole figure. The gizmo keys are **W** (move), **E** (rotate), **T** (move and rotate together) and **R** (scale the selected part).'),
      h('Joint'),
      options(
        ['Bend, Twist, Side', 'Angles of the selected joint in degrees, within its limits. An axis that is locked has no slider.'],
        ['Reset joint', 'Puts the joint back.'],
        ['Aim', 'For a knee or an elbow: which way it points as the limb reaches, from -180 to 180 degrees. The small ball in the view sets the same thing.'],
      ),
      h('Proportions'),
      options(
        ['Size', 'The selected part\'s size, from 50% to 200%.'],
        ['Length', 'Its length, from 50% to 200%.'],
        ['Reset all proportions', 'Puts every part back.'],
      ),
      h('Reach'),
      options(
        ['IK handles', 'Shows the handles. Drag one and the limb reaches for it, or tap it for a move gizmo. Dragging the violet one in the hips moves the whole figure.'],
        ['Plant feet', 'Stands a foot that is on the floor flat on it, marked by a ring on the floor. Off, the foot tilts with its shin.'],
        ['Pin left hand, Pin right hand, Pin left foot, Pin right foot, Pin head', 'A pinned handle stays put while the pelvis moves. Pins, not planting, keep a foot in its place.'],
      ),
      h('Send to Sculpt'),
      options(
        ['Resolution', 'The voxel grid, as in Sculpt\'s Remesh. The grid shows over the figure while you hold the slider.'],
        ['Send to Sculpt', 'Voxelises the posed figure into one object and opens it in Sculpt.'],
      ),
    ],
  },
];
