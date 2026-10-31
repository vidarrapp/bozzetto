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
- [x] 2026-10-31: Strength in centimetres for the brushes that push the surface. Decided 2026-10-31: yes; Clay, Inflate, Crease and Rake get 0 to 5 cm; Move and Drag follow the pen and keep 0 to 1 (corrected 2026-10-31), as do the capped brushes
- [x] 2026-10-31: Strength indicator shown always or only while adjusting. Decided 2026-10-31: only while adjusting strength
- [x] 2026-10-31: Edge-loop mask with Ctrl+Shift drag. Decided 2026-10-31: as proposed; true edge loops on quads, and a geodesic ring on triangle meshes as well
- [x] 2026-10-31: Poly groups, how they are made. Decided 2026-10-31: from the mask (Ctrl+W), from and back out to OBJ g/o lines (Maya round trip), split by angle, and by UV islands
- [x] 2026-10-31: Poly groups, hiding. Decided 2026-10-31: as proposed; Ctrl+Shift+click isolates, again hides it and shows the rest, on empty space shows all; Ctrl+Shift+drag stays the edge-loop mask; a Groups list in the Model panel

## Notes for Bozzetto Studio

### Change of plan: poly groups on level 0 (2026-11-01)

On Vidar's call, Bozzetto Web stores poly groups on the LOWEST level (level 0, the base cage), not the top. The groups record becomes `v: 2`: one group per level-0 face (`faces.length` = `nbBaseFaces`), plus `names` and `hidden` as below. Every higher level inherits exactly: face `f` at level `k` belongs to level-0 face `floor(f / 4^k)`. No derivation between levels, and no tie rule, except when a new level 0 is built underneath (Rebuild): each new base face takes the majority of its children, the earliest child on a tie. Grouping from a higher level (a mask drawn at the top, then Ctrl+W) sets whole level-0 faces, each joining when most of its top-level faces qualify. Dynamic-topology and remeshed meshes are single-level, so their faces are level 0. A `v: 1` record (top level, written for one day) converts on open by majority per level-0 face. This section replaces the 2026-10-31 layout below once the change lands; the full v2 definition will be written here then.

### The .bozz poly group layout (2026-10-31)

Bozzetto Web writes poly groups per object as an optional field of the object record, `meshes[i].groups`, with a version of its own; the scene's `v` stays 4. A scene without the field opens with every face in group 0, named "Group 1". The web writes the field only when an object has groups worth keeping (more than one group, group 0 renamed, or something hidden), so a file from an object that was never grouped is byte-for-byte what it was before.

```
groups: {
  v: 1,
  faces: Uint32Array,   // one a face of the TOP subdivision level, each an index into names
  names: string[],      // 1 to 4096 names, each at most 200 characters; group 0 is "Group 1" until renamed
  hidden?: Uint8Array   // one a group (names.length), 1 = hidden; left out when nothing is hidden
}
```

- **Level.** Only the top level (`levels[levels.length - 1]`) is stored, whatever `sel` is. Its face count is `nbBaseFaces * 4^(levels.length - 1)`, and `faces.length` must equal it. Faces are in the engine's own order at that level, the order full subdivision produces from `baseFaces`.
- **Children.** Face `f` of a level has its children at `4f .. 4f+3` of the level above, triangles and quads alike (vendored SculptGL `editing/Subdivision.js`, `applyOddSmooth`, writes them there in face order). For a quad `(v1 v2 v3 v4)` child `4f+k` is the quad at corner `v(k+1)`: `(v1 m1 c m4)`, `(m1 v2 m2 c)`, `(c m2 v3 m3)`, `(m4 c m3 v4)`, `m` the edge midpoints and `c` the centre. For a triangle `(v1 v2 v3)` child `4f` is the middle triangle `(m1 m2 m3)` and `4f+1 .. 4f+3` the corner triangles at `v1`, `v2`, `v3`: the middle one comes first, so it wins a triangle's ties. Studio's own "level 1 is a base corner" reading matches quads exactly; for a triangle add the middle child first. So a face's descendants `k` levels up are the contiguous range `f*4^k .. (f+1)*4^k - 1`.
- **Derivation, never stored.** A lower level's groups are derived level by level down from the top: a face takes the group most of its four children have; on a tie, the group of the earliest child (lowest index) among the tied ones. Two levels down is derived from the derived level one down, not from the grandchildren.
- **Edits.** Assigning a group at a lower level assigns every top-level face under the face (its contiguous range). Subdividing gives each new face its parent's group. Deleting the top level makes the level below the top, its derived groups now its stored ones.
- **Other topology.** Dynamic topology on: each triangle takes the group of the face it came from (a quad's two triangles both); off: the static faces keep the dynamic faces' groups in order. Voxel remesh, quad remesh, merge and extract: each new face takes the group of the nearest old face centre (world space), from the old top level when it was the level on screen, else from the level on screen; merge unites names by name. Duplicate, mirror and radial copies carry the groups; a mirror copy renumbers its faces (its base is rewound) and each face's group goes with it.
- **The container.** `hidden` brings a third buffer kind to the `.bozz` buffers table, `t: 'u8'`: `len` counts bytes, the array still starts on a multiple of four in the blob region, and the region's size is each entry's `off + len * (t === 'u8' ? 1 : 4)`. `f32` and `u32` are as before. A reader without `u8` refuses only files that hide something.
- **OBJ.** On import, each file face is in the group the last `g` or `o` line before it names (the rest of the line, "default" when empty; a face before any such line in "Group 1"), groups numbered by first use. The numbered export writes the file back unchanged while every face's group name is still the one its own `g`/`o` lines give; otherwise it drops the file's `g` lines (keeping `o`, `usemtl`, `s`, `mtllib`) and writes `g <name>` before each face that starts another group. A file face that became several level-0 faces (a pentagon is a quad and a triangle) takes the majority of their groups, the earliest on a tie. The triangle export writes `g <name>` lines face by face at the level on screen when the object has groups.
- **Checks.** The web refuses a file whose groups are not version 1, whose `faces` is not a u32 array of the top level's face count, whose names are not 1 to 4096 strings of at most 200 characters, whose `hidden` is not a u8 array of one a name, or (the app, which reads the arrays) a face naming a group past the last.
