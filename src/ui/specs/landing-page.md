# Landing page: build spec

Source: Figma file "Dungeon Builder", page **-> Main Screen** (node `271:60135`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=271-60135>): the
frames **No folder connected** (`293:60588`), **Folder connection lost** (`296:66179`),
**Connected, no scenes** (`293:60540`) and **Connected with scenes** (`280:60319`), the
components **Home page card - V2** (`313:68650`), **Dashboard Card - Scene** (`280:60398`,
variants Menu open? False `280:60397` / True `280:60409`), **Logo - Vertical** (`276:60177`) and
**Landscape** (`293:61420`), read on 2026-10-31 (file version `2416591438204456429`, after the
ForeverForge rebrand).

The first screen: the logo and tagline over one of two things, the folder card (until a World
of Warcraft folder is open) or the scene library (the empty state, or the actions over a grid
of scene cards). Not a molecule: a screen built from molecules, art and page CSS.

Built as `index.html` (the markup), `src/viewer/landing.css` (the layout),
`src/editor/landing.ts` (art, icons, feature cards, the lost-folder memory), with
`src/viewer/main.ts` driving the folder card and `src/editor/scenesUi.ts` the library.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **Decided** marks what the user settled on
2026-10-31; **Proposed** marks a best guess at something the frames do not draw.

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `screen` (`280:60314`) | `--color-bg-screen` (**new**) | `#181818` | the page, the folder card, the feature cards |
| `surface-primary` | `--color-bg-surface` | `#383838` | every card's 1px border; the thumbnail placeholder |
| `surface-transparent-primary` | `--color-bg-panel` | ink-900 @ 85% | a scene card's fill |
| `selection-overlay` | `--color-bg-selected` | blue @ 20% | the note at the foot of the folder card; the lost-connection banner |
| `button-bg-primary` | `--color-accent` | `#006FB4` | the feature icons and their rings; the logo mark and the landscape's lines; the card border while a folder is dragged over it |
| `content-primary` | `--color-text` | `#E7E7E7` | all text; the logo's wordmark |
| `button-bg-destructive` | `--color-danger` | `#F45060` | the Delete menu item; a folder error |

Type: tagline and card details `label/label` 12/400 → `--type-label`; body copy
`body/body-secondary` 14/400 → `--type-body-secondary`; card titles and the scene name 16/600 →
`--type-heading-2`; feature titles 16/700 → `--type-body-bold`; the empty state's question
16/400 → `--type-body`.

## 2. Layout

The frame is 1249 wide with 80px top padding; the content is one centred column, 920 max, with
24px between its parts.

```
                 [logo 112 wide]                 Logo - Vertical, the mark in the accent
            Build your ideas on Azeroth.         12px, 12 under the logo

┌──────────── 480 max ────────────┐
│ ⚠ We lost connection … (banner)  │  only in the lost state, flush at the top, selection fill
│     Connect your WoW folder      │  16px top padding (none under the banner), 16 side
│  ForeverForge references your …  │
│  [       Choose folder        ]  │  Primary, Large (48), fills; 12 × 24 around it
│ ⓘ Your browser may ask you …     │  the note: selection fill, 12 padding, 10 gap, rounded with the card
└──────────────────────────────────┘

         What is ForeverForge?                   16/600, then the one-line description
   A free, browser-based map editor for …
┌──── 224 ────┐┌──── 224 ────┐┌──── 224 ────┐  720 wide, 3 columns, 24 gaps
│   ( icon )  ││   ( icon )  ││   ( icon )  │  42px ring in the accent, 24px icon
│ Create …    ││ Sculpt …    ││ Set the …   │  16/700, then 12/400, centred, 12 padding
└─────────────┘└─────────────┘└─────────────┘
┌─────────────┐┌─────────────┐┌─────────────┐
│ Build …     ││ Populate    ││ Explore     │
└─────────────┘└─────────────┘└─────────────┘
        ┌──────────── 560 ────────────┐
        │ ( icon )  Share …           │  the seventh card spans the row, 80 in from each side
        └─────────────────────────────┘
```

Feature cards: `Home page card - V2`, fill `screen`, 1px `surface-primary` border, radius 12,
vertical, 4 gap, 12 padding, everything centred. Their icons are the set's own: `plus`,
`paint`, `sun`, `container`, `npc`, `play`, `download`.

The library replaces the folder card and the "What is" section under the same logo:

```
   [+ New scene] [⤓ Import scene]               Primary and Outline, Small (30), 8 gap
┌──── 290 ────┐┌──── 290 ────┐┌──── 290 ────┐  920 wide, 3 columns, 25 gaps
│ thumbnail   ││             ││             │  162 tall at 290 (16:9), fills the width
│ Scene name …││             ││             │  16/600, one line, ellipsis
│ Last edited ││             ││             │  12/400
│ 2x2 tiles   ││             ││             │  12/400; the "…" ghost button (32) at the right
└─────────────┘└─────────────┘└─────────────┘
```

Scene card: `Dashboard Card - Scene`, `surface-transparent-primary` fill, 1px border, radius
12; the lower content is 12 × 16 × 12 × 12 padding with 4 gap. Its menu (`Menu open?=True`)
lists Scene settings, Duplicate, Export and Delete (destructive), opened from the `more`
ghost icon button, Small.

Empty state: the Landscape (280 × 129 drawn, shown 240 wide), "No scenes created yet - how do
you want to start?" and the same two buttons.

## 3. States

| State | Figma frame | When |
|---|---|---|
| No folder connected | `293:60588` | the first visit, or any visit without the launcher |
| Folder connection lost | `296:66179` | a later visit: a folder opened here before, and the browser can't keep it (**Decided:** remembered as a flag in `localStorage`, `foreverForge.folderLinked`, set once the folder opens; the File System Access API, which could reconnect with one click, is a later task) |
| Connected, no scenes | `293:60540` | the folder is open and the library is empty |
| Connected with scenes | `280:60319` | the folder is open and holds scenes, newest first |

With the launcher (or the dev server) serving the game under `/__wow/`, the folder card never
shows: the page goes straight to the library.

## 4. What the frames do not draw (Proposed, accepted 2026-10-31)

- **Loading:** after Choose folder, the button's row becomes the loading bar (text over a
  4px accent bar with a passing glint), so the card keeps its size.
- **Errors:** a folder that can't be read swaps the note's info icon for the alert icon and
  its text for the error, in `--color-danger`.
- **Several game versions, none Classic:** a "Game version" select and an Open button appear
  under the folder button.
- **Dragging a folder over the page** still works: the card's border turns the accent.
- **No thumbnail yet:** the landscape, half the card's width at the disabled opacity, on a
  `surface-primary` fill.
- **Opening a scene:** clicking the card. The scene name is the button, stretched over the
  whole card by CSS; the "…" button sits above it.
- **Scene settings** opens the Scene settings dialog ([scene-dialogs.md](scene-dialogs.md) §3,
  built 2026-10-31 in place of the placeholder): rename, and grow a blank scene. **Duplicate**
  copies the saved file under a new id as "<name> copy".
  **Delete** asks with the destructive dialog instead of the browser's `confirm()`.
- Dropped from the old library: the "Explore the world" button (**Decided:** the world explorer
  is not part of this product), the game build label and the footnote about where scenes are
  kept. New scene opens the dialog in [scene-dialogs.md](scene-dialogs.md) §2 (built 2026-10-31).
- The copy keeps Figma's `--` where a dash goes (**Decided**).
