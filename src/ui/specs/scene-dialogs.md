# Scene dialogs (New scene, Scene settings): build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**:
component set **Dialog - New Scene** (node `311:68266`, variants `Mode=Blank terrain`
`311:67956` and `Mode=Copy from world` `311:68319`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=311-68266>) and
component **In-scene Settings** (`44:4697`), read on 2026-10-31 (file version
`2416585335604315430`). Both are built on the dialog molecule's form shape (dialog.md §5) with
the size grid (size-grid.md) and the field molecules.

Built: `src/editor/newSceneDialog.ts`, `src/editor/sceneSettingsDialog.ts`, the map picker in
`src/editor/copyPicker.ts`, growth in `src/scene/resizeScene.ts`; layout CSS in
`src/viewer/landing.css` ("The scene dialogs").

---

## 1. Shared shell

A 400-wide panel, radius 12, 1px `6:273` border, filled with `6:272` at 85% over a 24px backdrop
blur (unlike the question dialog's opaque card: the form dialog takes `look: 'panel'`). Title
row (`heading/h1`, ghost X-Small close), divider, a body column padded 16 with 16 between
items, and in New scene a divider over a footer holding one Primary Medium button that fills
the width. Fields are the Text Input, Dropdown and Toggle Switch Group molecules at full width.
When the window is shorter than the dialog, the body scrolls (the Copy from world variant is
drawn 972 tall).

Inside the body, a **panel** (`.scene-dialog-panel`): `6:272` at 85% again, radius 8, padded
12, 12 between its rows, everything centred; a 12px hint line on top.

## 2. New scene

```
New scene                                  ×
──────────────────────────────────────────────
Scene name            [ my_scene_01        ]   placeholder as drawn; empty → "Untitled scene" (blank) or the map's name (copy)
Start from            [ Blank terrain    ⌄ ]   Blank terrain | Copy from world
```

### 2.1 Blank terrain

```
Base texture          [ Grass (Elwynn…)  ⌄ ]   the BASE_TEXTURES list (Figma writes "Elywnn grass")
┌────────────────────────────────────────────┐
│ Choose the size of your scene by selecting │   hint in --color-text
│ tiles on grid below:                       │
│            [size grid 3×3]                 │
│                 1 x 1                      │
└────────────────────────────────────────────┘
──────────────────────────────────────────────
[              Create scene                 ]
```

Create makes a flat scene of the picked size at height 0 painted with the base texture (its
usual clutter where the ground effect scan knows it), saves it and opens the editor.

### 2.2 Copy from world

```
Map                   [ Kalimdor          ⌄ ]   every map with tiles, by name (a repeated name gets its directory)
┌────────────────────────────────────────────┐
│ Drag a rectangle of up to 3x3 tiles on the │   muted hint; after a drag: "3x2 tiles · 1600x1067 yd · tiles 32_27 to 34_28 (· n empty tiles (void))"
│ map.                                       │
│  –  ────●──────────────────────────────  + │   zoom row: minus, Small continuous slider, plus
│ ┌────────────────────────────────────────┐ │   the map: a square viewport the overview scrolls in,
│ │        (minimap pictures of the tiles) │ │   running to the panel's sides and foot (no bottom padding)
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
Include doodads (objects)                [●-]   on
Include buildings                        [●-]   on
──────────────────────────────────────────────
[              Create scene                 ]
```

- **Decided (2026-10-31):** the copy limit is 3×3 tiles, as the hint says; it was 6×6. Scenes
  copied at up to 6×6 before still open (`MAX_SCENE_TILES`), they just can't be made any more.
- **Zoom** (not drawn beyond the row): zoom 1 fits the map's tiles (their bounding box, at least
  8 tiles) to the viewport; the slider runs 1–8, minus and plus step by 1, Ctrl/Cmd + wheel (a
  trackpad pinch) zooms about the cursor, and plain scrolling pans. Zooming keeps what was in
  the middle in the middle. The viewport is square, capped at 32% of the window's height so the
  whole form fits a laptop screen.
- **Picking:** left-drag on the map spans a tile-aligned rectangle, held to 3×3 from where the
  drag started; tiles the map doesn't have may be inside and become void. The pick is drawn in
  the accent (a 20% wash and a 2px line), the tiles in `--color-bg-surface` until their minimap
  picture arrives, over `--color-bg-page`.
- Create reads the source tiles (progress as a status line under the switches: "Reading tile 2
  of 6 (32_27)…", "Building the scene…"), with Create disabled meanwhile; closing the dialog
  while it reads drops the result. A failure shows as a notice and the dialog stays.

## 3. Scene settings

```
Scene settings                             ×
──────────────────────────────────────────────
Scene name            [ Dialog test        ]   the present name, selected for retyping
┌────────────────────────────────────────────┐
│ Edit the size of your scene by selecting   │
│ tiles on grid below:                       │
│      [size grid, the scene's tiles locked] │   see size-grid.md §3: grow on any side
│                 2 x 1                      │
└────────────────────────────────────────────┘
[              Save settings                ]   in the body, no footer divider (as drawn)
```

Opened from a scene card's "…" menu on the landing page and from the scene control panel's
menu in the editor (the placeholder both opened before is gone).

- **Decided (2026-10-31):** a scene only grows, never shrinks: the locked cells are its tiles.
  New tiles are flat at height 0 and paint the scene's base layer; where a new tile meets an
  old one the shared edge keeps the old heights, so no seam opens, and the new tile's first
  cell slopes down from it. Everything placed (objects, NPCs, the spawn) moves with the tiles
  when new ones come before them.
- **Decided (2026-10-31):** a scene copied from the world renames only; in place of the grid
  its panel says "This scene copies 2x2 tiles of <map>, so its size can't change here."
- In the editor a rename shows in the control panel at once; a bigger size rebuilds the editor
  around the grown scene, which clears the undo history (**assumed**: growing is not an
  undoable edit). Either way the scene is saved; a failed save keeps the dialog open.
- From a card the saved file is rewritten in place: a rename without decoding it (so a copied
  scene renames without its source map), a growth by decoding, growing and saving. The card's
  size line and the list order follow.
- An empty name keeps the old one.

## 4. Not in Figma, and open

- The map's zoom and pan behaviour (§2.2) and the viewport's height cap.
- The grids larger than 3×3 in Scene settings (size-grid.md §5).
- Figma's base texture is "Elywnn grass"; the app keeps its own texture names.
- The Map list shows names only (Figma: "Kalimdor"); the old form showed tile counts.
