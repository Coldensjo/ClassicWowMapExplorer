# Side Panel Controls: build spec

Source: Figma file "Dungeon Builder", component set **Side Panel Controls** (node `267:54680`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=267-54680>), its
parts **Mode Controller** (Orientation=Vertical, [mode-controller.md](mode-controller.md) §13),
**Grab Bar** (Orientation=Vertical, [grab-bar.md](grab-bar.md)) and the module parts the bottom
controls already used, read on 2026-10-30 (file version `2416248821189540021`).

The editor's tool settings as one column down the **right** of the viewport: the mode column, a
grab bar, and the **tool panel**, a translucent panel with the mode's name as its title, its
description line, and its **modules** stacked one above the other. It replaces the bottom
controls ([bottom-controls.md](bottom-controls.md)), which docked the same modules side by side
across the bottom; the modules themselves (what each mode shows, the hotkeys, the help copy, the
decisions behind them) are unchanged and still written up there in §2 to §5.

It is not a molecule: `src/editor/sideControls.ts` builds the frame (the column, the grab bar,
the panel, the module shell) from molecules and `src/editor/editorPanels.ts` fills it per tool;
the layout CSS is `#side-controls` and `.dock-*` in `src/viewer/viewer.css`.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**; **Decided**
marks a call made while building and confirmed by the designer, §5).

---

## 1. Frame

```
                                 ┌──┐ │ ┌──────────────────────────────┐
                                 │☀ │ │ │ Sculpt terrain               │  title row: 16px over, 16 under, divider
                                 │⛰ │ │ ├──────────────────────────────┤
                                 │🖌│ │ │ (description, when the mode   │  pinned under the title
                                 │≈ │ │ │  has one)                     │
                                 │✂ │ │ ├──────────────────────────────┤
                                 │▢ │ │ │ Sculpt setting               │  module: 12px over the title,
                                 │☺ │ │ │  ◉ Raise/lower …             │  12 between, 12 under; divider
                                 └──┘ │ ├──────────────────────────────┤
                            mode    grab │ Size                         │  the modules scroll as one
                           column    bar │  ───────────────────  [100 yd]│
                                         └──────────────────────────────┘
```

| Part | Figma | Build |
|---|---|---|
| Dock | horizontal, gap 4: "Mode and Grab" (the mode controller, 4px, a 2px grab bar as tall as the controller) then the tool panel; hugs | `#side-controls`: `position: fixed`, 16px from the right, from under the editor bar and from above the status bar; `display: flex`, `align-items: flex-start`, gap 4; `pointer-events: none` with the children `auto` |
| Mode column | Mode Controller, Orientation=Vertical: 40 × 256, every chip icon-only | `modeController({ orientation: 'vertical' })` |
| Grab bar | Orientation=Vertical, 2 × 48, centred in a container as tall as the mode column | `grabBar({ orientation: 'vertical', grows: 'start' })` in `.side-controls-rail`, which stretches it to the column's height; hit area 10px so the drawn 4px gaps either side stay |
| Tool Panel | **320** wide, hugs its content, `minHeight` 180; 16px top padding, 8px bottom; `surface-transparent-primary` → `--color-bg-panel` with a 24px background blur (`--blur-panel`), 1px `6:273` → `--color-bg-surface` border, radius 12, clips; a 4px scrollbar at the right when it overflows | `.side-controls-panel`: `inline-size: var(--dock-panel-width)` (320 until dragged, §1.1), `min-block-size: 180px`, `max-block-size: 100%` of the dock's height, so it hugs its modules until the viewport runs out and then scrolls |
| Title | `heading/h2` 16px / 600, 16px side padding, 16px below, one line truncated; then a 1px divider | `.side-controls-header` / `.side-controls-title`, `--type-heading-2` |
| Description | under the title divider, 12px over and under, `label` 12px, left aligned; then a divider | `.side-controls-description`, `--type-label`; **Decided**: pinned under the title, the modules scroll beneath it |
| Modules column | vertical, each module `maxWidth` 320, a 1px divider between modules | `.side-controls-modules.ds-scroll`: one scrolling column, `overflow: hidden auto` |
| Module | 12px top and bottom padding, gap 12: title row (18px line, 16px side padding, `body/body-secondary-bold` 14px / 600, optional help button) then the content (16px side padding, 12px gaps); no divider between a module's title and its body any more | `.dock-module`: `padding-block: 12px; gap: 12px; border-block-end` (none on the last); `.dock-module-header` and `.dock-module-body` pad 16px inline |
| Help button | the `help` icon after the title | ghost `xs` icon button, complex tooltip opening to the **left** |
| Empty state | as before | `data-empty` dims and inerts the body; `.dock-module-empty` over it |
| Playing | hidden with the other editing panels | `body.playing #side-controls { display: none }` |

### 1.1 Resizing and collapsing (grab bar)

**Decided (2026-10-30):** dragging the grab bar sets the panel's **width**, remembered across
sessions; dragging it narrower than the minimum collapses the panel.

| Aspect | Build |
|---|---|
| Drag | `grows: 'start'`: dragging left widens the panel, between **120px** and **320px**; narrower than 120 collapses it to the mode column and the bar, dragging back out past 120 brings it back |
| Keyboard | ←/→ 16px, Home collapses, End to 320, on the focused bar |
| Toggle | a double click or Enter on the bar collapses the panel or restores its last width |
| Memory | width and collapsed state in `localStorage` (`wdb.side-controls`) |
| Collapsed | the mode column and the grab bar stay on the right edge alone |

### 1.2 Stacking

The dock is `z-index: 30`: over the page's own panels, **under** the floating browser windows
(`--z-window`, 50), which open at the **bottom left** now
([floating-window.md](floating-window.md) §4) and overlap the panel when the viewport is narrow.

---

## 2. Modules per mode

Unchanged from [bottom-controls.md](bottom-controls.md) §2, with these additions the side panel
variants draw:

| Mode | Title | What the side panel adds |
|---|---|---|
| Environment | Environment | — |
| Sculpt | Sculpt terrain | hotkey lists under the Size and Strength sliders |
| Paint | Paint terrain | hotkey lists under Size, Strength and Opacity |
| Water | Water | hotkey lists under Size and Height |
| Holes | Cut holes | a hotkey list under Size |
| Objects | Objects | — |
| NPCs | NPCs | — |
| (Revert to base, key 8) | Revert to base | a hotkey list under Size |

The hotkey lists under the sliders were already built for the bottom controls (`sizeModule`,
`percentModule` in `editorPanels.ts`), so **Decided**: they stay under every slider as drawn.

### 2.1 ⚠ Figma issues (built as the code already has them)

- Sculpt's Strength hotkeys read "+ size" twice (Shift + ], Ctrl + ]); built "+ strength" /
  "- strength" with Shift. Paint's Strength module draws the Opacity hotkeys and Opacity none;
  built each under its own slider.
- Water's Brush hotkeys have "…" labels; built "Add water" / "Remove water". "Flood scene" is
  drawn where "Flood fill" was decided. The Height note reads "0 = just above default ground";
  built "(empty = just above the clicked ground)", as the stepper's empty value is the automatic
  one.
- Lower uses CTRL where every other row uses CMD; built the platform key throughout.
- Full chunk's help button sits at the far right, Ground clutter's beside its title; built beside
  the title everywhere.
- The Objects variant is named `Mode=Mode8`; its hotkeys still list Space / Cmd + drag /
  Shift + drag, which bottom-controls.md §4.1 settled against.
- Size sliders still show % placeholders; yards stand.

---

## 3. Mode ↔ tool mapping

As [bottom-controls.md](bottom-controls.md) §3. Shortcuts 1–7 are the mode column's; they are
off while playing or while the dock is hidden.

---

## 4. Floating windows

The texture browser, object browser and NPC library open at the **bottom left**: 16px from the
left edge, 16px above the status bar, 360 × 487 as before. Their stored places were reset
(storage keys `wdb.window.<name>.2`) so every user sees the new default once. Toasts stay at the
bottom centre, 16px up: nothing is in their way any more.

## 5. Questions put to design, and the answers (2026-10-30)

1. Placement: 16px from the right edge, under the editor bar with a 16px gap, the mode column at
   the top of the stack on the panel's left. **Yes.**
2. Height: hug content up to the viewport, then scroll as one; the description pinned under the
   title. **Yes.**
3. Vertical grab bar: dragging sets the width, remembered; 320 max, 120 min, narrower collapses.
4. Collapsed: the mode column and grab bar stay on the right edge alone. **Yes.**
5. Hotkeys under every slider, as drawn. **Yes.**
6. Narrow viewports: the windows overlap the panel as before. **Yes.**
7. Windows open at the bottom left at their old size; stored positions reset. **Yes.**
8. Toasts drop to the bottom margin. **Yes.**

## 6. Acceptance checks

- The mode column sits at the top right under the editor bar, a grab bar beside it, the 320px
  panel to its right, 16px in from the edge and above the status bar.
- The panel shows the mode's title, its description where it has one, then the modules stacked
  with dividers; it hugs them, and when they don't fit it scrolls as one column with the title
  and description staying put.
- Dragging the grab bar left or right changes the panel's width between 120 and 320px; dragging
  it narrower than 120 collapses the panel; double-clicking collapses or restores it; width and
  collapsed state come back after a reload.
- Each Size, Strength, Opacity and Height slider has its hotkey list beneath it.
- The texture browser, object browser and NPC library open at the bottom left.
- Keys 1–7 switch modes; playing hides the dock; Edit brings it back as it was.

## Update 2026-10-31: no bars above or below

The editor bar along the top became the scene control panel at the top left
([scene-control-panel.md](scene-control-panel.md)) and the status bar along the bottom went. The
dock's top inset is now **24px** (`--space-6`), level with that panel's top, and its bottom inset
16px from the viewport's edge; §1's "from under the editor bar and from above the status bar"
reads so.
