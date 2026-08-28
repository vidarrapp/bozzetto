# Toolbar icon overrides

Drop an SVG here named after a toolbar slot and it replaces that button's
Flaticon uicons font glyph at build time (raw-inlined, recolored via
currentColor, sized like the font glyphs):

    crease.svg  move.svg  standard.svg  inflate.svg  pinch.svg
    flatten.svg  smooth.svg  drag.svg  twist.svg  negative.svg

Pending files (icons missing from the npm uicons release, picked in
review): flatten.svg (Flaticon "scraper" 19010200) and negative.svg
(Flaticon "invert" 565536). Keep the plain single-color downloads;
fills are overridden by CSS. Flaticon attribution lives in the README
credits section.
