# Handoff

## Open questions for Vidar

- [x] 2026-10-24: Rake tines, what happens between the grooves: cut only, cut and level the ridges, or a "Level between" slider. Decided 2026-10-24: a "Level between" slider from 0 to 1
- [x] 2026-10-24: Profile curves in the Tool panel: an editable curve or presets plus a hardness slider. Decided 2026-10-24: a draggable curve with presets; tap to add a point, pull a point outside the editor to remove it
- [x] 2026-10-24: Clay without alphas: replace the Strip plateau slider with a profile curve or keep both. Decided 2026-10-24: replace it, the default preset being today's plateau shape
- [x] 2026-10-24: Move Crease, Polish and Paint's falloffs to profile curves now or later. Decided 2026-10-24: now
- [x] 2026-10-24: Rake flatten control: one "Scrape" slider replacing Plateau, or keep Plateau beside it. Decided 2026-10-24: Scrape, replacing Plateau
- [x] 2026-10-24: Smooth on voxel-remeshed surfaces: a "Surface" smooth mode as default or as an option. Decided 2026-10-24: an option; "Average" stays the default
- [x] 2026-10-24: QuadriFlow's flow solver in Bozzetto Web. Decided 2026-10-24: Boykov-Kolmogorov max flow (QuadriFlow's default path, no network-simplex min-cost flow, no Gurobi); the heavier solving is for Studio
- [x] 2026-10-24: Quad remesh in Bozzetto Web: offer QuadriFlow's adaptive quad sizing as an option. Decided 2026-10-24: include it, off by default
- [x] 2026-10-27: Where Smooth's Mode and Relax go. Decided 2026-10-27: a Smooth group in every brush's Tool panel, one shared setting for all tools
- [ ] 2026-10-31: Strength in centimetres: only the brushes that push the surface (Clay, Inflate, Crease, Rake, Move, Drag) get a 0 to 5 cm Strength, meaning how far one full-pressure stroke raises or cuts; Smooth, Flatten, Polish, Pinch, Paint and Mask keep 0 to 1, since above 1 they overshoot (blocks: the strength rework)
- [ ] 2026-10-31: Strength indicator: a short line along the surface normal at the brush centre, as tall as the stroke would push at the current pressure, with the cm value beside it while the strength key is held, or always shown (blocks: the strength rework)
- [ ] 2026-10-31: Edge-loop mask: Ctrl+Shift and drag across a loop masks the side the drag moves toward, adding to the mask; Ctrl+Shift+Alt unmasks that side instead. Quad topology only (subdivided or quad-remeshed); on triangles it says so (blocks: the loop mask)
