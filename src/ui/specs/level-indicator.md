# Level Indicator: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component set
**Level Indicator** (node `38:16327`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=38-16327>), read on
2026-10-30 (file version `2415936091135390495`).

The nesting guide in a tree list: the **Group Outline** panel (scene outline of groups, objects
and NPCs; Panel Subcomponents "Outline - Group Name / NPC Name / Object Name") indents child
rows with these 16px cells. `Type` = **Bend** (an └ elbow pointing at the child) or **Blank**
(an empty 16px indent).

Build as part of the outline/tree molecule (`molecules/tree.{css,ts}` when the outline is
specced), not as a standalone component.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Visual

| Property | Bend | Blank |
|---|---|---|
| Cell | 16 × 16, clips | 16 × 16, empty |
| Mark | an elbow vector in a 6 × 6px box at x 8, y 3 inside the cell. The API exposes only its bounding box, so the **└** shape (down from y 3 to y 9, then right to x 14) is inferred from the name "Bend" and the outline layout: check it against the Figma drawing before building | none |
| Stroke | 1px, round caps, `surface-transparent-inverse` → `--color-bg-inverse` (`#E7E7E7` @ 40%) | |
| Fill | none | |

Build the elbow as CSS (a 6 × 6 box with `border-left` and `border-bottom` 1px in
`--color-bg-inverse` and `border-bottom-left-radius: 1px`) or an inline SVG path
`M8.5 3.5 V9.5 H14.5`; either way `aria-hidden="true"`.

## 2. Use in a tree row (Proposed)

```
Group A
└ Object 1          ← one Bend cell, then the row
└ Group B
  └ Object 2        ← Blank cell (for Group B's level), then Bend
```

- Each row starts with `depth − 1` Blank cells and one Bend cell (top-level rows have none).
- The nesting depth must also be in the semantics: the outline is a `role="tree"` with
  `role="treeitem"` rows and `aria-level`, so screen readers don't depend on the drawing.

**⚠ Figma issue.** The component frame declares a 27:27 target aspect ratio but is 16 × 16; harmless
(both square). The elbow doesn't connect between siblings (no continuous vertical line); if the
outline should show a continuous guide line for siblings, a **Pipe** (│) and **Tee** (├) type are
needed (§3).

## 3. Open questions

1. Should siblings be connected with a continuous line (needs │ and ├ types), or is the single
   elbow per row the intended, lighter look?
2. Is 16px the indent per level everywhere the tree appears?

### Acceptance checks

- Child rows in the outline are indented 16px per level, the last cell showing a 6 × 6 elbow in `#E7E7E7`@40%.
- Tree semantics (`aria-level`) match the drawn indentation.
