# Switching Bozzetto to Gestalt v2

The plan for moving Bozzetto Web from its current look to the Gestalt v2
design system. Written 2026-11-10 against the system as it stood that day
(its README and `bozzetto-interface.md`). The mockups are the "Bozzetto in
Gestalt v2" canvas; its "Controls and states" board is the reference for
every control.

Nothing here is built yet.

## What the system asks for, in short

- Black, white, orange and lime. No grey, no tints, no ink at reduced
  opacity. Orange means active or pressed; lime means a switch that is on
  or the one recommended action.
- Two type families: Familjen Grotesk (titles at 700, everything else at
  400) and Martian Mono (values, keys, numerals, in caps). The earlier
  third face is gone from the system.
- Square corners, 1px lines used as marks and never as dividers, no
  shadows, no gradients. Groups are separated by space.
- Hover changes only the pointer. A hovered menu row turns bold.
- Focus is a 2px outline. No text under 11px. Every control answers to a
  44px target, however small it is drawn.
- Four named departures for Bozzetto: translucent panels, the view axis
  colours, the viewport's own background, and no underlines.

## Where the app stands

- One stylesheet, `src/style.css`, about 6,000 lines, driven by a small
  set of variables (`--bg`, `--text`, `--muted`, `--accent`, `--panel-bg`,
  `--panel-border`, `--control-bg`, `--hover`, three font variables and
  `--radius`). That is good news: much of the look can move by changing
  what those variables mean.
- What does not move by variables: 106 rounded corners, 22 shadows, 55
  hover rules, 79 uses of the muted grey, 105 border lines used as
  dividers, and side tabs set sideways.
- Three fonts ship today (Manrope, Instrument Serif, JetBrains Mono).
  None of them survives.
- The icons are already Flaticon Uicons, which is what the system names.
- The loading splash is already done in the new style.

## The approach

**Build the new look beside the old one, behind a switch, and flip the
default at the end.** A "Look" choice in Preferences (Classic, Gestalt
preview) sets one attribute on the page. Each phase below lands on `main`
with the default unchanged, so the app stays shippable and can be tried on
the iPad after every phase. The alternative, one long branch switched in a
single step, hides problems until the end and cannot be tried on a real
device along the way.

The risk in this approach is a half-finished preview that looks broken.
That is acceptable because it is a preview nobody is put on by default.

**Rebuild the controls once, in one place.** The panels build their rows
through a few shared helpers. The new field, switch, select, panel button,
presets and folding section are made there, so every panel changes
together and no panel is restyled by hand.

**Take the tokens from the system, never retype them.** The system's
`tokens.css` and its two font files are copied into the repo as they are,
with the version noted, and the app's own variables point at them.

## Phases

Sizes are rough: S is a day or two of agent work with tests, M about a
week, L more.

### 0. Foundations (S)

No visible change.

- Copy in `tokens.css`, Familjen Grotesk and Martian Mono, with their
  licences in `THIRD_PARTY_NOTICES.md`.
- Add the Look switch and the page attribute it sets.
- Let the browser tests run with either look.

### 1. Skin (M)

With the preview on, the whole app changes colour and type at once.

- Colours: `--bg` and `--text` become ground and ink. The muted grey goes;
  secondary text is smaller or lighter instead. The Sculpt viewport stays
  #222 in both themes.
- Type: Familjen Grotesk at 13px for labels and menus, Martian Mono in
  caps at 11px for values and keys, panel names at 20px bold.
- Shape: every corner square, every shadow gone, divider lines replaced by
  space.
- States: hover rules reduced to the pointer; pressed and active become
  orange with black type; switches that are on become lime; the focus
  outline becomes 2px.
- The browser's `theme-color` moves from #1c1814 to black or white.

### 2. Controls (M)

The shared controls are rebuilt to the Controls board.

- Field (label left, value right, a line with the amount in orange),
  switch, select with a chevron, panel button (outlined; dashed when
  unavailable), presets, folding section header, the 4px scrollbar.
- The states the spec does not cover yet are on the board as proposals
  and need a yes or no first (see Decisions).

### 3. The Sculpt screen (L)

The layout changes, and two things are new features.

- The 24px menu bar: File, Edit and View on the left, the object readout
  in the centre, help and hide-interface icons on the right. "← Gallery"
  becomes File › Close, Publish moves into File, Present into View, and
  the theme button into View or Preferences.
- Menus: hung under their name, the open name inverted, the hovered row
  bold, submenus for Mirror and Radial copies, reasons shown on
  unavailable items.
- Panels: docked to the edges at content height, scrolling above the
  corner controls; closed panels as horizontal tabs.
- Toolbar: flush to the bottom edge, 44px tools with the hotkey in the
  corner, labels off by default, the tool name shown above on hover.
- Corner controls with no box, drawn black or white from the brightness
  of the viewport behind them. This needs a cheap brightness read of the
  picture: new work.
- Brush size and strength as upright fields, shown only while the Tool
  panel is closed or while they change by hotkey.
- Viewport hints above the toolbar, with their switch in View and in
  Preferences.
- The view axes with the symmetry plane, bottom right: a new feature.

### 4. Gallery and viewer (M)

- Gallery: the hand-drawn logotype, the Create tile, cards with a title
  and a plate of keys and values, quiet Install and Log in.
- Viewer: the same menu bar, the picture treated as an image with its
  controls outside it, Play or Pause as the one primary button, the frame
  index as ticks with the current one orange.
- Community, account, create and admin pages take the skin and controls
  from phases 1 and 2 and need a layout pass each.

### 5. Windows and the rest (M)

Preferences, Help, the Publish window, Set scale, sign-in, the install
and update notices, toasts, the colour and matcap pickers, the curve
editor, the channel box, the outliner, the Armature panel, Present mode
and the frame meter.

### 6. Touch (M)

The mockups are all 1440 by 900 with a mouse. Bozzetto is used on an iPad
with a Pencil, and on phones.

- Before phase 3 is built, add two boards: iPad landscape and a phone in
  portrait.
- Questions those boards must answer: how a 24px menu bar is tapped
  (a taller hit area under it), whether a phone shows one panel at a time
  as a sheet, and where the corner controls go when the toolbar is as
  wide as the screen.
- Then a pass on the device: targets, the Pencil's long-press tool name,
  panel scrolling against the corner controls.

### 7. Switch over (S)

- Gestalt becomes the default look and Classic is removed, with its CSS
  and its three fonts.
- README screenshots, the PWA manifest colours and the docs are updated.

## Order and dependencies

0 comes first. 1 and 2 follow in that order. The touch boards from 6 are
drawn before 3 is built. 3, 4 and 5 can then run one after another in any
order; 3 is the largest and the one you will use most, so it goes first.
7 is last.

## Decisions needed

They are also in `docs/HANDOFF.md`.

1. **Rollout.** A preview switch with the default flipped at the end
   (recommended), or one branch switched in a single step.
2. **Proposed states** on the Controls board, which the spec does not
   cover: a selected list row is inverted; a selected swatch or matcap
   gets four corner brackets; a notice is an outlined box; something gone
   wrong is an orange box; a tip is a lime box; a window has one primary
   button and a quiet Cancel.
3. **Errors and destructive actions.** The system has no red. Proposed:
   errors use orange (its "warning" meaning), and Delete is confirmed
   with the ordinary primary button.
4. **Where the theme choice lives** once the "Ink" button leaves the top
   bar: View, Preferences, or both.
5. **Flaticon credit.** The system notes that Uicons need a credit line
   or a Premium subscription. Today the credit is in
   `THIRD_PARTY_NOTICES.md`; proposed: also one line in Help.
6. **Panel corner brackets** (open since 2026-11-08). The system now
   keeps brackets for the selected or hovered thing, so the proposal is
   none on panels.

## What is already settled

Dark theme by default with paper as an option; the hand-drawn logotype;
the splash; File › Close in place of "← Gallery"; the bold hovered menu
row; fields in the Blender manner; panel opacity as a preference, 60 to
100 percent with 95 as the default.
