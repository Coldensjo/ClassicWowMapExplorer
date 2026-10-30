# Asset Tile and Asset Grid: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panel Subcomponents**,
component set **Asset Tile** (node `17:4740`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=17-4740>) and
section **Panels and Windows**, component set **Asset Grid** (node `81:15008`), read on
2026-10-30 (file version `2415962625477652269`).

A square picture with a one-line caption under it: one texture, model or piece of gear in a
browser. The grid lays tiles out in equal columns; its `Scale` variants (Max, Mid, Min) are the
same 416px grid at 3, 4 and 5 columns, which is what the browser's tile-size slider changes.
Gear Asset Tile (`38:20667`) and the NPC tiles are the same idea with more parts and are not
covered here.

Build `molecules/asset-tile.{css,ts}`: `assetTile()`, `setAssetTileSelected()`, `assetGrid()`,
`setAssetGridColumns()`.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**.

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| *(none; image fill)* | `--color-bg-surface` | `#383838` | the picture's fill before a thumbnail is drawn (**Proposed**) |
| `content-secondary` | `--color-text-muted` | `#CACACA` | caption |
| `interaction-hover` (`41:23702`) | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash over the picture |
| `selection-overlay` (`17:4744`) | `--color-bg-selected` | `#006FB4` @ 20% | wash over a selected picture |
| `button-bg-primary` (`6:330`) | `--color-accent` | `#006FB4` | selected border (2px, inside) and selected caption |

| Text | Figma style | Code token |
|---|---|---|
| Caption | `231:39941` label/label-light, 12px / 200 | `--type-label-light` |
| Caption, selected | `231:39942` label/label-bold, 12px / 700 | `--type-label-bold` |

Both centred, one line, truncated with an ellipsis.

## 2. Anatomy

```
┌──────────────┐
│              │  picture: square (aspect 1), radius 12, fills the tile's width
│              │
└──────────────┘
  [asset-name]    8px below, centred, one line
```

Variants `Selected?` × `State` (Rest, Hover): hover adds the 10% wash over the picture only;
selected adds the 20% accent wash, a 2px accent border inside the picture and the bold accent
caption. Both can hold at once.

## 3. Grid

416px wide in every variant, tiles filling their columns, **16px** gap in both directions:
3 columns of 128px (Max), 4 of 92px (Mid), 5 of 70.4px (Min). The grid itself has no fill or
border; it scrolls inside the browser that holds it.

## 4. Decisions

- The tile is a `<button aria-pressed>`; the caller owns which tile is selected (the browser's
  model knows the texture) and moves the mark with the setter, as every molecule does.
- The picture slot takes a canvas or img the caller draws into, because the browsers decode
  thumbnails themselves; the molecule does not load images.
- Unavailable assets (not in the install) are `disabled` and dimmed with `--opacity-disabled`
  (**Proposed**: Figma has no such state).
- Focus: the ring is drawn around the picture (**Proposed**).

### Acceptance checks

- Square picture with 12px corners; caption 8px under it, light, truncated.
- Hover washes the picture 10% white; selected shows the 2px blue border, 20% blue wash and a
  bold blue caption; both together stack.
- A grid of 3, 4 or 5 columns at 416px gives 128, 92 and 70.4px tiles with 16px gaps.
