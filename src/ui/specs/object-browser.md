# Object Browser: build spec

Source: Figma file "Dungeon Builder", page **Components**, component set **Object Browser
Panel** (node `18:5774`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=18-5774>), and the
flows on page **-> Objects** (`81:18670`, frames 2.0 to 2.4.1), read on 2026-10-30 (file
version `2415962625477652269`).

The Place tool's model picker as its own window: the same floating window
([floating-window.md](floating-window.md)) as the Texture browser, holding a Doodads /
Buildings segmented control, the search and tile-size row, and a scrolling asset grid
([asset-tile.md](asset-tile.md)). Built by the editor (`src/editor/modelBrowser.ts`) from the
molecules; its layout CSS is the shared `.asset-browser-*` rules in `src/viewer/viewer.css`.
It shows only while the Place tool is active.

---

## 1. Anatomy

Under the header, 16px side padding and 16px gaps: the segmented control (two segments, full
width, `Selected chip` 1 = Doodads, 2 = Buildings), then the same search + tile-size row as the
texture browser, then the asset grid (Max/Mid/Min = 3/4/5 columns, 16px gaps) scrolling with
the thin scrollbar. No sampled section.

## 2. Behaviour (from the flows)

| Frame | What it shows | Build |
|---|---|---|
| 2.0 / 2.0.1 | the Doodads tab, then Buildings | the segmented control switches the list; each tab's listfile loads the first time it is shown |
| 2.1 | search | substring/token search over the tab's paths |
| 2.2 to 2.2.2 | asset scale max, mid, min | the three-stop tile-size slider |
| 2.3 | browser asset selected | the tile gets the selected look and a **toast** appears at the window's bottom centre: "Click in the scene to place selected object." (`Show selection toast?` on) |
| 2.3.1 | browser asset place | after placing, the toast is gone |
| 2.4 / 2.4.1 | browser expanded, minimized | the window's collapse button |

**Decided (2026-10-30):** the toast shows for four seconds after a pick (or until clicked)
rather than until the object is placed, because an armed asset stays armed for repeated
placing, as the editor already works. Clicking the armed tile again disarms it, as in the
texture browser. The window is remembered under its own storage key, apart from the texture
browser's.

## 3. Kept from the old panel

The footer line as in the texture browser: the match count ("1,204 doodads", or "Showing 200
of 5,311 — search to narrow"), "Placing trees / elwynntreecanopy04" or "Nothing picked yet",
and the ghost `reset` button that fetches the listfile afresh.

### Acceptance checks

- Only in Place mode; opens top-right, 360 × 487, and remembers where it is left.
- Doodads and Buildings switch the list; the tile-size slider steps 3, 4 and 5 columns.
- Picking a tile arms it, marks it selected and shows the toast; picking it again disarms it.

## 5. Toolbar update read file version `2416211887664560962`, 2026-10-30: grid/list view

The toolbar row (`Frame 43`, 30px, gap 16) now starts with the **icon segmented control**
([segmented-control.md](segmented-control.md) §11) holding the `grid` and `list` icons, grid
selected; the search is the **small** text input ([text-input.md](text-input.md) §10) and the
tile-size slider the **small** fixed-step slider ([slider.md](slider.md) §12) between the 16px
minus and plus. Under the toolbar the gap is 12px (was 16). No frame shows the list itself; it
is built from the row tile ([asset-tile.md](asset-tile.md) §9): in the list the slider's three
stops are the row picture's size (48, 80, 120px) instead of the grid's columns, and the choice
is kept per window in `localStorage` (`wdb.<window>.view`) beside the tile size. The shared
toggle, stops and storage live in `src/editor/browserView.ts`.
