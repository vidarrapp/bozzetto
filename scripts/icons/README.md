# App-icon source

`sculpture.svg` is the Flaticon **uicons** "sculpture" glyph (`fi-ss-sculpture`),
supplied as a plain single-colour download. It is not in the npm
`@flaticon/flaticon-uicons` release, so it lives here rather than being
imported like the toolbar glyphs. Attribution is in the root README credits.

`node scripts/generate-icons.mjs` rasterises it into `public/icons/` and
writes the SVG favicon. To swap treatments, change `VARIANT` at the top of
that script; `--sheet` renders every treatment side by side for comparison.
