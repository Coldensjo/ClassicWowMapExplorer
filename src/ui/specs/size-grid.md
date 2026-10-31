# Size grid: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**,
component set **Grid Cell** (node `311:67967`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=311-67967>), as
laid out 3×3 inside "Dialog - New Scene" (`311:68266`) and "In-scene Settings" (`44:4697`),
read on 2026-10-31 (file version `2416585335604315430`).

A grid of tile cells on which the user picks how many tiles a scene has, and in Scene settings
where new tiles go around the ones it already has. Figma draws the cell only; the grid, the
picking gesture and the caption are read from how the dialogs use it.

Build `molecules/size-grid.{css,ts}`: `sizeGrid()` and `setSizeGridValue()`.

---

## 1. Tokens used

| Figma | Code token | Value | Used for |
|---|---|---|---|
| `content-secondary` (`6:384`) | `--color-text-muted` | `#CACACA` | a cell's fill |
| `6:330` | `--color-accent` | `#006FB4` | the picked cell's 3px inside border and 12px dot |
| `selection-overlay` (`17:4744`) | `--color-bg-selected` | accent @ 20% | the wash over a picked cell |
| *(variant opacity 0.5)* | `--opacity-disabled` | 0.3 | a locked or unreachable cell (§3); Figma dims to 50%, the system's disabled opacity is 30% |
| `content-primary` (`6:274`) | `--color-text` | `#E7E7E7` | the caption |

Cell radius 4 → `--radius-sm`; the dot is a circle (`--radius-full`). Caption `label/label`
12/400 → `--type-label`.

## 2. Anatomy and sizes

```
 ┌──┐ ┌──┐ ┌──┐      cells 32 × 32, 8px apart (a 3×3 grid is 112 square)
 └──┘ └──┘ └──┘
 ┌──┐ ┏━━┓ ┌──┐      picked: 3px accent border inside, 20% accent wash, 12px accent dot
 └──┘ ┗━━┛ └──┘
 ┌──┐ ┌──┐ ┌──┐
 └──┘ └──┘ └──┘
     1 x 1           caption: columns x rows of the pick, 12px, centred, 12px under the cells
```

Variants: `Selected?` (False / True) × `State` (Enabled / Disabled). Disabled is the same cell
at 50% opacity, picked or not.

## 3. Behaviour

- **Decided (2026-10-31):** picking is a rectangle, not a set of toggles: a click picks that
  one cell (1×1), dragging across cells (or Shift+click on a second cell) spans the rectangle
  between them. The pick is held to `max` cells each way: the far corner stops where a fourth
  row or column would start, like the map picker's drag.
- **Locked cells** (Scene settings): the tiles a scene already has stay in every pick and
  can't be dropped. **Decided (2026-10-31):** a scene may grow on any side, so the grid is the
  locked block plus `max − size` cells on each side of it (a 1×1 scene gets a 5×5 grid, a 2×1
  a 4×5, a 3×3 just 3×3), with the block in the middle. A click picks that cell *and* the
  block; dragging spans from the anchor over the block. While dragging, the cells the pick
  can't reach without passing `max` are drawn disabled (the Figma Disabled state); they come
  back when the pointer lifts. Locked cells draw as Selected + Disabled, as the settings
  drawing shows.
- Keyboard: the cells are buttons with a roving tabindex (the pick's top-left cell is in the
  tab order); arrows move focus, Enter or Space picks the focused cell, Shift+Enter extends
  from the anchor.
- The caption reads `W x H` (Figma's plain x) and names the group through `aria-describedby`.

## 4. API

```ts
const grid = sizeGrid({ max: 3 });                                   // a new scene: 3×3 cells
const grown = sizeGrid({ max: 3, locked: { tilesX: 2, tilesY: 1 } }); // settings: 4×5 cells
grid.value();        // { x0, y0, x1, y1 } in grid cells, both corners inclusive
grown.locked;        // where the locked block sits, so the caller knows the offset of the old tiles
setSizeGridValue(grid.root, rect);
```

`onChange(rect)` fires on every change of the pick, including during a drag.

## 5. Not in Figma

- A grid larger than 3×3 (§3): the drawings show 3×3 for both dialogs, with the 1×1 scene in the
  middle; growing a bigger scene on any side needs the extra ring.
- The unreachable-while-dragging dimming (§3) is this spec's use of the Disabled state; Figma
  draws no drag.
