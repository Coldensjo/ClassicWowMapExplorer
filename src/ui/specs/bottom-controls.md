# Bottom Controls: build spec

Source: Figma file "Dungeon Builder", component set **Bottom Controls** (node `29:7815`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=29-7815>), its
parts **Mode Controller** ([mode-controller.md](mode-controller.md)), **Grab Bar**
([grab-bar.md](grab-bar.md)), **Mode Description** (`29:9173`), **Hotkeys Group**
([hotkey-list.md](hotkey-list.md)), **Transform - Selection** (`29:10428`) and **Object
Attributes - Selection** (`151:24183`), and the flow frames on the pages "-> Environment
Panel", "-> Sculpt Panel", "-> Paint Panel", "-> Water Panel", "-> Holes", "-> Objects" and
"-> NPCs", read on 2026-10-30 (file version `2416178373996841357`).

The editor's tool settings as one dock across the bottom of the viewport: the mode bar, a grab
bar, and the **tool panel**, a translucent panel whose **modules** (one column each) hold the
active mode's settings. It replaces the tool rail on the left and the properties panel on the
right. `Mode` = Environment / Sculpt / Paint / Water / Holes / Objects / NPC.

It is not a molecule: `src/editor/bottomControls.ts` builds the frame (the bar, the grab bar,
the panel, the module shell) from molecules and `src/editor/editorPanels.ts` fills it per tool;
the layout CSS is `#bottom-controls` and `.dock-*` in `src/viewer/viewer.css`.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**; **Decided**
marks a call made while building; every one was confirmed by the designer on 2026-10-30, §5).

---

## 1. Frame

```
                  ┌──────────────────────────────────┐
                  │ ☀  [⛰ Sculpt]  🖌  ≈  ✂  ▢  ☺   │  Mode Controller, centred, hugs
                  └──────────────────────────────────┘
                                ───                      Grab Bar, 4px above and below
┌──────────────────────────────────────────────────────────────────────────────┐
│                       Paint up to four textures per chunk.                   │  Mode Description (optional)
├───────────────────┬───────────────────┬───────────────────┬──────────────────┤
│ Tool              │ Size              │ Strength          │ Full chunk  ?    │  module title row 24px
├───────────────────┼───────────────────┼───────────────────┼──────────────────┤
│ (scrolls)         │                   │                   │                  │  module body, scrolls
└───────────────────┴───────────────────┴───────────────────┴──────────────────┘
```

| Part | Figma | Build |
|---|---|---|
| Dock | vertical, centred, fills the width up to **1280**, gap 4; 16px from the viewport's left, right and bottom in the flows | `position: fixed`, bottom `var(--status-bar-height) + 16px` (the status bar stays under it, §6), `max-inline-size: 1280px`, horizontally centred |
| Tool Panel | fill × **240** tall, `minHeight` 180; `surface-transparent-primary` → `--color-bg-panel` with a 24px background blur (`--blur-panel`), 1px `6:273` → `--color-bg-surface` border, radius 12, clips | the same tokens; its height is `--dock-panel-height` |
| Mode Description | 12px top padding, centred `body-secondary` text, then a 1px divider | `.bottom-controls-description`, hidden when the tool has none |
| Modules row | horizontal, fills the rest | `.bottom-controls-modules`, scrolls sideways if the modules don't fit |
| Module | 320 wide (`maxWidth` 320, fill where there is room), 16px top and bottom padding, gap 16: title row (24px, 16px side padding, `heading-2`, optional help button) → 1px divider → content (16px side padding, 12px gaps); 1px vertical divider between modules; a 4px scrollbar at the right of a body that overflows | `.dock-module`: `flex: 1 1 320px; max-inline-size: 320px; min-inline-size: 240px`; header padding 16, divider, body `.ds-scroll` padding 16 gap 12 |
| Help button | the `help` icon after some titles; the flows open a complex tooltip on it | ghost `xs` icon button + `attachTooltip({ variant: 'complex' })` |
| Empty state ("Object selected?" = False) | the fields drawn disabled with an info icon and "Make a selection to edit transform properties." / "… attributes." centred over them | `data-empty` dims the body to `--opacity-disabled` and makes it `inert`; `.dock-module-empty` shows the icon and text |

### 1.1 Resizing and collapsing (grab bar)

The flows show the panel at different heights with the bar and mode controller riding on top,
so (as the grab bar spec proposed) **dragging the grab bar resizes the panel**:

| Aspect | Build |
|---|---|
| Drag | `grows: 'start'`: dragging up makes the panel taller; between **180px** and the viewport height minus 220px (room for the top bar, the mode bar and some scene) |
| Keyboard | ↑/↓ 16px, Home/End to the limits, on the focused bar |
| Collapse | a double click or Enter on the bar hides the panel, leaving the mode bar and the grab bar; the same brings it back |
| Memory | height and collapsed state in `localStorage` (`wdb.bottom-controls`) |
| Hit area | the grab bar's 16px hit area is overridden to **10px** here, so the drawn 4px gaps above and below the 2px bar are kept |
| Playing | the whole dock hides with the other editing panels (`body.playing`) |

### 1.2 Stacking

The dock is `z-index: 30`: over the page's own panels, **under** the floating browser windows
(`--z-window`, 50), as the Paint flows show the Texture browser overlapping the panel.

---

## 2. Modules per mode

Each module's controls are the molecules named; "keys" means a hotkey list
([hotkey-list.md](hotkey-list.md)). Modules the design does not draw but the app needs are
marked **Proposed** (built in the same style; design may drop or redraw them).

### Environment (`29:7816`)

| Module | Contents |
|---|---|
| Weather effects | radio Clear / Rain / Snow / Sandstorm; switch rows Fog, Shadows |
| Ground clutter ? | switch Show clutter; slider Clutter density (0–200 %, built from the 0–2 multiplier); **Proposed** button "Apply ground effects to scene" |
| Time of day | slider with the value shown as **HH:MM** (the slider molecule gained a `format` option for it); dragging previews, letting go records one command |

Help: "Small shrubs or weeds that populate dynamically based on the textures you paint."

### Sculpt (`29:8179`)

| Module | Contents |
|---|---|
| Sculpt setting | radio Raise/lower, Smooth, Flatten, Noise ?, Ramp ?; under the selected option a headed hotkey list (Raise/lower: Raise Shift + click, Lower Cmd + click; the others: the option's name + Shift + click); **Proposed** under Flatten: a "Flatten to (yd)" stepper, empty for the height first touched |
| Size | slider in **yards** (1–100), keys `]` `[` |
| Strength | slider in % (0–100), keys Shift + `]` `[` |
| Falloff ? | radio Linear / Smooth / Flat |

Help copy: Noise "Roughen up terrain surface with randomized fractal noise."; Ramp "Ideal for
sculpting an angled surface into terrain. To use, click a starting point then an ending point
to create a smooth ramp between them."; Falloff "Determines how terrain is moved at the outer
edges of your brush." with a term per option (the file holds placeholders; the explanations are
**Proposed**).

### Paint (`29:8804`)

Description "Paint up to four textures per chunk." While sampling, and while no texture is
picked, the line carries that state instead (**Decided**: the old hint text lives here).

| Module | Contents |
|---|---|
| Tool | radio Brush, Eraser, Fill chunk, Set chunk base ?; the selected option's hotkey (Shift + click) under it |
| Size | slider in yards, keys |
| Strength | slider in %, keys Shift + `]` `[` |
| Opacity | slider in %, keys **Cmd** + `]` `[` (new; the file draws these under Strength) |
| Full chunk ? | radio Replace weakest / Block |

Help copy: Set chunk base "Set a chunk's base texture that you paint on top of. The eraser won't
affect a chunk's base texture."; Full chunk "Determines what happens if you try and paint a new
texture when a chunk is full." Replace weakest "Whichever texture is least prominent will be
replaced." Block "The new texture won't be applied until one of the existing textures is
removed."

### Water (`29:9407`)

Description "Note: Water is a little buggy." (as drawn).

| Module | Contents |
|---|---|
| Tool | radio Brush (Add water Shift + click, Remove water Cmd + click), **Flood fill** ("Flood scene" in the file; it fills one hollow, so named for what it does); the hotkeys under the selected option |
| Type | radio Water, Ocean, Magma (warning: ugly), Slime (broken) **disabled** as drawn |
| Size | slider in yards (1–30), keys |
| Height | note "(empty = just above the clicked ground)", a stepper (0.5 yd steps, empty = automatic), keys Shift + `]` `[` (new: they step the surface height) |

### Holes (`29:9936`)

Description "Cut a hole in terrain to allow passage into structures like cave networks."

| Module | Contents |
|---|---|
| Hotkeys | plain list: Cut hole Shift + click, Fill hole Cmd + click |
| Size | slider in yards (1–30), keys |

### Objects (`29:10209`) and NPCs (`32:12669`)

| Module | Contents |
|---|---|
| Hotkeys | plain list of the editor's real bindings (§4.1) |
| Transform | X, Y, Z number fields in a row; Rotation (degrees: an object's yaw, an NPC's facing); Scale, disabled with the note "Buildings can't be scaled." when only buildings are selected. Values apply to every selected entity; where they differ the field shows the placeholder **Mixed** (the "Multiple selections made" flow). Empty state when nothing is selected. |
| Attributes (Objects) | select **Doodad set** ("Asset style" in the file) for a single selected building, disabled otherwise; **Proposed**: Name set stepper (buildings), Locked switch, Group field, the selection count, Revert to base and Restore deleted buttons where they apply |
| Attributes (NPCs) | Name, Title fields; Pose and Idle animation selects (Mixed/Varies when the selection differs); **Proposed**: Change appearance to the picked one, the look's name, Locked, Group, count |
| Placement (Objects, **Proposed**) | switches Align to slope, Random facing, 15° angle snap; Scale range steppers; Grid snap select |
| Player avatar (NPCs, **Proposed**) | what is armed for placing, who the player plays as, buttons Play as the picked one / Default avatar |

### Revert to base (copied scenes; no chip, **Decided**)

Key **8** opens it with no chip selected: a description line, modules "What goes back" (five
switches), Hotkeys (Revert Shift + click) and Size.

---

## 3. Mode ↔ tool mapping

| Chip | Editor tool | Notes |
|---|---|---|
| Environment | `environment` (new) | no brush: the cursor ring hides |
| Sculpt, Paint, Water, Holes | the same | |
| Objects | `place` | |
| NPCs | `npcs` | |
| (none) | `revert` | key 8, copied scenes only |

Shortcuts 1–7 are the mode controller's; they are off while playing or while the dock is hidden.

---

## 4. Decisions made while building

1. **Holes and Water lose their mode buttons** (§2): Shift cuts / adds, Cmd fills / dries, as the
   hotkey lists say; the editor derives the stroke's mode from the modifier. Water keeps a
   Brush / Flood fill radio.
2. **Place / Select mode is gone** for Objects and NPCs: an armed asset places on click,
   otherwise clicks select; clicking the armed tile again disarms, as the browsers already do.
3. **Raise/lower is one option**: Shift raises, Cmd lowers (the editor already worked that way).
4. **Units**: Size sliders show yards, not the file's placeholder %; Strength, Opacity and
   Clutter density show %.
5. **Controls the file omits** are kept as the **Proposed** modules and rows above rather than
   dropped.

### 4.1 ⚠ Figma issue: the Objects hotkeys

The file lists Space (toggle 3d widget), Cmd + drag (rotate), Shift + drag (scale), Cmd + Space
(drop to ground), Cmd + D, Del. The editor's gizmo is driven by **W / E / R** (move, rotate,
scale), Shift + click adds to the selection and Shift + drag box-selects, so Cmd + drag and
Shift + drag would collide with selecting. Built: the list shows the real bindings, and
**Cmd + Space** was added for Drop to ground. Changing the drag model is a separate decision.

---

## 5. Questions put to design, and the answers

All eight defaults below were **confirmed by the designer on 2026-10-30**; the build stands as
described in §2 and §4.

1. The Objects drag model stays the editor's (W / E / R, Shift + click and drag to select); the
   file's Space / Cmd + drag / Shift + drag are not adopted. Cmd + Space drops to ground.
2. Holes and Water use Shift and Cmd instead of mode buttons; Water keeps Brush / Flood fill.
3. Place / Select mode is gone for Objects and NPCs.
4. The Proposed modules and rows (§2) stay, in the same style.
5. Revert to base is key 8 in copied scenes, with no chip.
6. Slime stays disabled as drawn.
7. The status bar stays under the dock.
8. Labels: "Doodad set" and "Flood fill"; Size sliders in yards.

## 6. Acceptance checks

- The mode bar sits centred over a grab bar over the panel; the panel fills the width up to
  1280px, 16px in from the edges, above the status bar.
- Dragging the grab bar changes the panel's height between 180px and the viewport's limit;
  double-clicking collapses it to the bar; both come back after a reload.
- Each module is at most 320px wide with a 24px title row, a divider and a body that scrolls
  on its own; a help button opens a blue complex tooltip.
- Each mode shows the modules in §2; the selected radio option's hotkeys sit under it.
- With nothing selected, Transform and Attributes dim and read "Make a selection…"; with a mixed
  selection the fields read "Mixed".
- Keys 1–7 switch modes; [ ] size the brush; Shift + [ ] change strength (or the water height);
  Cmd + [ ] change the paint opacity; Cmd + Space drops the selection to the ground.
- Playing hides the dock; Edit brings it back as it was.
