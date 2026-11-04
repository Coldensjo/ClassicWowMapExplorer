# Texture Browser: build spec

Source: Figma file "Dungeon Builder", page **Components**, component set **Texture Browser**
(node `39:22383`), its parts **Current textures** (`18:5492`), **Asset Tile** (`17:4740`),
**Asset Grid** (`81:15008`), and the flows on page **-> Paint Panel** (`45:5498`, frames 1.0 to
5.3.2), read on 2026-10-30 (file version `2415962625477652269`).

The Paint tool's texture picker as its own window: a floating window
([floating-window.md](floating-window.md)) holding a collapsible **Sampled textures** section
and the texture **browser** (search, tile size, grid of asset tiles,
[asset-tile.md](asset-tile.md)). It is not a molecule: it is built by the editor
(`src/editor/textureBrowser.ts`) from the molecules, and its layout CSS lives in
`src/viewer/viewer.css` under "Texture browser window". It shows only while the Paint tool
is active.

---

## 1. Sampled textures (component `Current textures`, variants `Sampled`)

A section under the header: a row with the heading "Sampled textures" (`--type-heading-2`) and
a ghost chevron button (`up` open, `down` closed) that collapses the section's body; 16px side
padding; a divider under it. The body is a centred column, 12px gaps:

| Variant | Body |
|---|---|
| Unsampled | "Sample a chunk in your scene to see textures that are being used." (body-secondary, muted, centred) and a primary small button **Sample chunk** |
| Sampling active | the loading indicator (48px), "Click a chunk in your scene to sample its textures." and an outline small button **Cancel (ESC)** |
| Four / Three / Two / One | a row of that many asset tiles, 10px apart, filling the width (104px tiles at four), and an outline button **Sample another chunk** |
| None | the `alert` icon (24px), "No textures found on the sampled chunk." and **Sample another chunk** |

Read from the flows: Sample chunk arms one sample; the next plain click on the ground takes it
and disarms; Escape or Cancel disarms without a sample (**decided**: back to the previous
result if there was one, else Unsampled). Sampled tiles pick like browser tiles.

## 2. Browser

A row, 16px gaps: the search text input (leading `search` icon, placeholder "Search...",
fills) and a 140px tile-size group (ghost `minus` button, a slider with no value field, ghost
`plus` button). The slider has three stops matching the Asset Grid's `Scale`: Min, Mid, Max
= 5, 4, 3 columns; Max is the default. Under it the asset grid scrolls (`.ds-scroll`), 16px
side padding, 16px below the row.

Clicking a tile selects it (accent border, wash, bold caption); clicking the selected tile
again un-selects it, leaving **no texture** (flows 5.0.1 → 5.0.2 → 5.0). **Decided
(2026-10-30):** with no texture the brush's Paint, Fill chunk and Set base do nothing and the
hint says to pick one; Erase still works.

## 3. Kept from the old panel (decided 2026-10-30, not in Figma)

A muted footer line under the grid: how many textures match ("412 textures", or "Showing 400
of 1,203 — search to narrow"), "Painting with elwynn / elwynngrassbase01" (or "No texture
selected"), and a ghost `reset` button that fetches the listfile afresh.

## 4. Not built

The optional selection toast drawn at the window's bottom (`Show selection toast?`, default
off): the footer line already names the picked texture. Add it when design turns it on.

### Acceptance checks

- Only in Paint mode; opens top-right, 360 × 487, and remembers where it is left.
- The sampled section walks its seven states; collapsing it keeps the browser.
- The tile-size slider and its buttons step the grid between 3, 4 and 5 columns.
- Clicking a tile selects it; clicking it again un-selects; the brush then refuses to paint.

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

## 6. The Texture swap window (2026-11-04)

In the Paint tool's **Swap texture** mode this same window becomes the Texture swap window:
two slots above the sampler, the sampler and browser shown only for an active slot, and the
window hugging its content when no browser is needed. The behaviour, states and heights are in
[texture-swap.md](texture-swap.md) §4.2 to §4.4.
