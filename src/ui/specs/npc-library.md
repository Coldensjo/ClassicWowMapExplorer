# NPC Library: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**,
component set **NPC Library** (node `35:13667`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=35-13667>), its
parts **NPC Tile - Single Variant** (`34:13149`), **NPC Tile - Multi Variant** (`41:24380`),
**Variants Tag** (`35:13818`), **NPC Asset Grid** (`185:30300`), **Tile - Interactive**
(`234:39954`) and **NPC Dropdown** (`34:13458`), and the flows on page **-> NPCs** (`122:18988`,
frames 1.0 to 2.6.5), read on 2026-10-30 (file version `2415962625477652269`).

The NPCs tool's picker as its own window: the same floating window
([floating-window.md](floating-window.md)) as the Texture and Object browsers, holding a
**main view** of three doors (Local NPCs, Favorites, Existing NPCs) and a **Create new NPC**
button, and under each door a browser with the shared search and tile-size row over a scrolling
grid of NPC tiles. It is not a molecule: it is built by the editor (`src/editor/npcLibrary.ts`)
from the molecules, and its layout CSS is the shared `.asset-browser-*` rules plus
`.npc-library-*` in `src/viewer/viewer.css`. It shows only while the NPCs tool is active.

Variants: `State` Main / Local / Favorites / Existing / Variants × `Expanded?`; a
`Show selection toast?` boolean (default off).

---

## 1. Main view (State = Main)

Under the header, 16px side padding and 12px gaps, three interactive tiles
([interactive-tile.md](interactive-tile.md)) that open a sub-view:

| Tile | Description line | Opens |
|---|---|---|
| Local NPCs | Created in this scene. | §2 |
| Favorites | *(none)* | §3 |
| Existing NPCs | From the game files. | §4 |

Then, 12px lower, a full-width primary large button with the `plus` icon: **Create new NPC**.

**Decided (2026-10-30):** "Local" lists the user's whole custom NPC library (every preset
they have made, in any scene, as the old Custom tab did), plus presets embedded in the open
scene that are gone from the library, so its NPCs can still be re-dressed. Create new NPC opens
a small menu: **New custom NPC…** (the NPC studio, today's custom NPC editor) and
**Import .wnpc…**, which the design does not draw.

## 2. Sub-views (State = Local, Favorites, Existing, Variants)

A heading row (32px, 12px gaps): a secondary circular icon button with the `left` chevron
(back to Main), the view's heading (`--type-heading-2`), and in Local only a primary circular
`plus` button at the right (the same create menu). Under it the search text input
(placeholder "Search for NPCs...") and the 140px tile-size group, then the NPC asset grid
scrolling with the thin scrollbar. The grid's `Scale` is Max / Mid / Min = 3 / 4 / 5 columns,
16px gaps, as the other browsers.

Headings: "Local NPCs", "Favorites", "Existing NPCs", "Variants: [npc-name]".

### 2.1 NPC tile (NPC Tile - Single Variant)

An [asset tile](asset-tile.md) with two more parts: the picture has **no fill** (the thumbnail
is cut out on the panel), and a secondary circular 32px `more` button sits on the picture's
top-right corner and opens the tile's menu. `Selected?` × `Dropdown open?` × `State` (Rest,
Hover): hover washes the picture 10%; selected adds the 2px accent border, the 20% accent wash
and the bold accent caption. The caption is the NPC's name, one line.

The menu (NPC Dropdown, 224px, the menu molecule): **Edit**, **Remix**, **Add to favorites**.
A two-item variant exists for tiles that cannot be edited (game NPCs). **Decided:**

| Tile | Menu |
|---|---|
| a custom NPC (Local, or a Favorite that is one) | Edit · Remix · Add to / Remove from favorites · Export .wnpc · **Delete** (destructive; confirmed) |
| a game NPC (Existing, Variants, or a Favorite that is one) | Remix (only for pre-baked humanoids, disabled otherwise) · Add to / Remove from favorites |

Edit opens the preset in the NPC studio; Remix opens the studio on a **new** NPC prefilled from
the tile (the old "Customize as new"). Export and Delete are the old Custom tab's actions.

### 2.2 Multi-variant tile (NPC Tile - Multi Variant)

The same tile with a **Variants Tag** pill centred on the picture's bottom edge ("12 variants":
panel fill, 1px inverse border, radius 24, `--type-label-small`) and no menu button. Clicking
it opens the **Variants** view for that model, whose tiles are single tiles. Existing NPCs are
the client's creature displays grouped by model: a model with one skin is a single tile, with
more a multi-variant tile.

### 2.3 Picking and the toast (flows 2.3.1, 2.3.2)

Clicking a single tile arms it for placing (the selected look) and a toast appears at the
window's bottom centre: "Click in the scene to place selected NPC." After placing, the toast
is gone. Clicking the armed tile again disarms it. **Decided:** the toast stays four seconds
or until clicked, as the Object browser's, since an armed NPC stays armed for repeated placing.

### 2.4 Empty states (NPC Asset Grid `No local results`, `No favorites`)

A centred column under the tools: the `alert` icon (24px), a muted line, and for Local an
outline small **Create NPC** button (the create menu):

- Local, nothing made yet: "You haven't created any local NPCs yet."
- Favorites, none saved: "You haven't saved any favorites yet."
- a search with no match (**Proposed**): "No NPCs match your search."

## 3. Favorites

Not in the app before. **Decided:** "Add to favorites" on any single tile remembers its
appearance (a creature display or a custom preset) in localStorage under
`wdb.npc-library.favorites`; the Favorites view lists them with their own tiles and menus
("Remove from favorites"); a favorite whose preset no longer exists is skipped.

## 4. Kept from the old panel (not in Figma)

A muted footer line under the grid, as the other browsers have: the match count ("412 models,
1,203 displays", "Showing 120 of 412 — search to narrow", "8 custom NPCs"), "Placing murloc 2"
(or "Nothing picked yet"), and in Existing the ghost `reset` button that fetches the listfile
afresh. The Place / Select mode, the play-mode avatar buttons and the hint stay in the NPCs
panel until the whole panel migrates.

## 5. Not built

The Transform and Attributes bottom panels and the NPC Studio drawn in the flows are their own
components; the delete confirmation (flow 2.3.4) is not drawn, so Delete uses the
[dialog](dialog.md) in its destructive shape ("Delete "<name>"?" / Keep it · Delete).

### Acceptance checks

- Only in NPCs mode; opens top-right, 360 × 487, and remembers where it is left.
- Main shows the three doors and Create new NPC; each door opens its browser with a back
  button, search and the three-stop tile-size slider.
- Existing groups by model; a multi-variant tile shows the pill and opens the Variants view.
- Picking a tile arms it, marks it selected and shows the toast; picking it again disarms it.
- The tile menu edits, remixes, favourites, exports and deletes a custom NPC; a game NPC can
  be remixed (humanoids) and favourited; Favorites lists what was added.

## 6. Toolbar update read file version `2416211887664560962`, 2026-10-30: grid/list view

The toolbar row (`Frame 43`, 30px, gap 16) now starts with the **icon segmented control**
([segmented-control.md](segmented-control.md) §11) holding the `grid` and `list` icons, grid
selected; the search is the **small** text input ([text-input.md](text-input.md) §10) and the
tile-size slider the **small** fixed-step slider ([slider.md](slider.md) §12) between the 16px
minus and plus. Under the toolbar the gap is 12px (was 16). No frame shows the list itself; it
is built from the row tile ([asset-tile.md](asset-tile.md) §9): in the list the slider's three
stops are the row picture's size (48, 80, 120px) instead of the grid's columns, and the choice
is kept per window in `localStorage` (`wdb.<window>.view`) beside the tile size. The shared
toggle, stops and storage live in `src/editor/browserView.ts`.
