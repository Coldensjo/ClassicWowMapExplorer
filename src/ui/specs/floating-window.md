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

## Update read file version `2416211887664560962`, 2026-10-30: condensed header

The three windows (`18:5399`, `17:4739`, `35:13664`) now have a **24px** title row: the title is
`heading/h2` (**16px**, `--type-heading-2`) instead of h1, and the collapse button is the ghost
icon button at **X-Small** (24px, 16px icon) instead of 32px. The 8px above the dots and 16px
below the row stay, so the header is **60px** (was 70). The body's gap under the toolbar is now
12px and the window's bottom padding 12px (the texture browser's is drawn 16; built 12 for all
three). Radius, border, blur and the grip are unchanged.

**Built:** `.ds-floating-window-title-row` is `min-block-size: 24px`, the title
`--type-heading-2`, the toggle `iconButton({ variant: 'ghost', size: 'xs' })` with `sm` icons.

## 4. Default placement (decided 2026-10-30): the bottom left

With the tool panel on the right ([side-panel-controls.md](side-panel-controls.md)), the three
browsers open at the **bottom left**: 16px from the left edge, 16px above the status bar, still
360 × 487. `WindowRect` gained `bottom` (the distance from the viewport's bottom edge, used when
`y` is omitted), `src/editor/windowDefaults.ts` gives the three the same rect, and their storage
keys moved to `wdb.window.<name>.2` so a place remembered from the old default is not kept.

**Update 2026-10-31:** the status bar is gone ([scene-control-panel.md](scene-control-panel.md)),
so the windows open 16px above the viewport's bottom edge; the stored places are untouched.

## 5. Title and height fit (2026-11-04, for [texture-swap.md](texture-swap.md) §4.4)

The handle gained two display-only calls, so one window can serve as the Texture browser and
the Texture swap window without a second frame:

- `setTitle(title)` changes the heading and every label built from it (the header's "Move …",
  the grip's "Resize …", the toggle's "Collapse …" / "Expand …").
- `setHeightFit(fit)` overrides how tall the window shows without changing its stored height:
  `'hug'` follows the content and hides the grip (`data-hug`; on a short viewport the body
  scrolls rather than clips); `{ minHeight }` shows `max(stored, minHeight)`, limited to the
  viewport, and a grip drag or arrow-key resize starts from the displayed height and commits as
  usual; `null` is today's behaviour. Under a fit the **bottom edge of the stored rect stays
  put**: the window grows and shrinks upward and its top never leaves the viewport, which suits
  the bottom-left default. The window re-anchors itself whenever its content height changes.
