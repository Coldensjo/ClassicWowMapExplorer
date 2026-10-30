# Floating Window: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**,
component set **Texture Browser** (node `39:22383`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=39-22383>), read on
2026-10-30 (file version `2415962625477652269`), with the same frame on **Object Browser
Panel** (`18:5774`) and **NPC Library** (`35:13667`).

The frame those three browsers share: a translucent blurred panel floating over the scene with
a drag handle, a title, an expand/collapse button and a resize grip. `Expanded?` True/False.
What goes inside is each browser's own (see [texture-browser.md](texture-browser.md)).

Build `molecules/floating-window.{css,ts}`: `floatingWindow()`.

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `surface-transparent-primary` (`6:272`) | `--color-bg-panel` | `#181818` @ 85% | fill, with a 24px background blur (`--blur-panel`) |
| `6:273` (as the menu's border) | `--color-bg-surface` | `#383838` | 1px border; the divider under the header |
| `content-primary` (`6:274`) | `--color-text` | `#E7E7E7` | title; grip icon; ghost button icon |
| `surface-transparent-inverse` | `--color-bg-inverse` | `#E7E7E7` @ 40% | the three handle dots at rest (**Proposed**: Figma draws them unbound) |

Title: `231:39939` heading/h1, 18px / 600 → `--type-heading-1`.

## 2. Anatomy and sizes

```
┌────────────────────────────────────────┐  radius 12, 1px border, blur
│                 • • •                  │  8px top padding; three 4px dots, 6px apart: the drag handle
│  Texture browser                   —   │  title row 32px, 16px side padding; ghost icon button 32px (minus / plus)
├────────────────────────────────────────┤  16px below the row, then the divider
│  (the browser's content)               │
│                                     ⟋  │  24px grip, 4px from the right and bottom edges (drag-to-expand icon)
└────────────────────────────────────────┘
```

Drawn 450 × 589; placed in the mocks at 360 × 487, 28px from the right edge and 20px from the
top. Collapsed is the header alone: 70px tall, the same width, the button turned to a plus.

## 3. Behaviour (read from the flows, **Proposed** where the file is silent)

| Aspect | Build |
|---|---|
| Move | drag anywhere on the header (the dots are the affordance, the whole header the surface); arrow keys on the focused header move it 16px |
| Resize | drag the grip; arrow keys on the focused grip resize it 16px; a minimum size the caller sets (280 × 160 default) |
| Collapse | the header button toggles; Enter on the header too; collapsed hides the body and grip |
| Bounds | the window is kept inside the viewport (at least its header), also when the viewport resizes |
| Memory | with a storage key, place, size and collapsed state persist in localStorage |
| Stacking | `--z-window` (50): above the page's panels, below menus, tooltips and toasts |
| Showing | the owner shows it only in the mode it belongs to (the texture browser in Paint) |

### Acceptance checks

- Translucent blurred panel with 12px corners; header 70px with dots, title and a 32px ghost
  button; a 1px divider under it; the grip in the corner.
- Dragging the header moves it, the grip resizes it, the button collapses it to the header.
- Reload: it comes back where it was.
