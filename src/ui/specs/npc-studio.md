# NPC Studio: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**,
component set **NPC Studio** (node `38:15826`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=38-15826>), its
parts **Gear Asset Grid** (`204:37729`), **Gear Asset Tile** (`38:20667`) and **Dialog**
(`204:39244`), and the flows on page **-> NPCs** (`122:18988`, frames 2.6 to 2.6.5), read on
2026-10-30 (file version `2416270716900656388`).

The custom NPC editor (spec 7.9.3) as a modal over the scene: a live preview column beside a
right rail that shows one of three views. Variants: `View` Appearance / Gear / Browse Piece.
It is not a molecule: `src/editor/npcEditor.ts` builds it from the molecules (the Browse
Piece view in `src/editor/gearBrowser.ts`), and its layout CSS is `.npc-studio-*` in
`src/viewer/viewer.css`. It replaced the static `#npc-editor` markup and the `.npc-editor-*`,
`.npc-option`, `.npc-swatches`, `.npc-slot*` and `.npc-browse-*` rules.

---

## 1. Frame

```
┌───────────────────────────────────────────────────────────────┐  925 × 787, radius 12, 1px border (6:273),
│  NPC studio                                               ×   │  panel fill (6:272) @ 85% + 24px blur; 16px top pad;
├──────────────────────┬────────────────────────────────────────┤  title row 24px, 16px sides: heading/h1 + ghost X-Small close
│                      │  Right Rail: 16px padding, 16px gaps   │
│  Preview 371 wide    │                                        │  the body fills; a 1px line between the columns
│  (image fill)        │                                        │
├──────────────────────┴────────────────────────────────────────┤  divider
│                                    [ Exit ] [ Save to library ]│  16px above; Outline + Primary, Medium (38px), 12px apart, right-aligned; 16px bottom pad
└───────────────────────────────────────────────────────────────┘
```

Tokens: title `--type-heading-1`; frame `--color-bg-panel`, `--color-bg-surface` (border and
dividers), `--blur-panel`, `--radius-lg`. The flow frames put the studio centred over the scene
behind a dark veil (an unbound rectangle): `--color-scrim` (**Proposed**). The frame scales
down to the viewport (`min(925px, 100%)` × `min(787px, 100%)`) with 16px round it.

The preview's backdrop is a photo-like dark blue gradient in Figma; built as a radial gradient
of `--color-accent` mixed into `--color-bg-surface`, fading to `--color-bg-page`. The model
plays its Stand loop and turns when dragged (unchanged); a muted status line at the preview's
bottom says what the studio is doing (loading, building, gear left off) (**kept**, not drawn).

## 2. Appearance (View=Appearance)

Under a full-width text **segmented control** (Appearance | Gear), fields two to a row, 16px
apart:

| Row | Left | Right |
|---|---|---|
| 1 | Text input **Default name**, placeholder "Custom NPC 1" | Text input **Default title** with the "Optional" suffix and the supporting text "i.e. <High Chieftain> or <King of Stormwind>" |
| 2 | **Gender** radio group: Male, Female | **Skin color** swatch picker |
| 3… | **Face** dropdown, **Face shape** dropdown; **Hair style**, **Hair color** swatches; **Facial hair**, **Eyebrows**; **Eye style**, **Ears** | |

**Decided (2026-10-30):**

- **Race:** not drawn. A **Race** dropdown goes in row 2 before Gender (the drawing's Gender |
  Skin color row becomes Race | Gender, and the options follow). A race with one model greys
  the other gender.
- **Default title** is stored on the preset (`NpcPreset.title`); an NPC placed from the preset
  starts with the preset's name and title as its name and `subName`, editable per NPC in the
  Attributes module.
- The option labels in the drawing are illustrative: the options come from the client's
  ChrCustomization tables in their order, colour options (half their choices carry a swatch
  and none a name) as swatch pickers, the rest as dropdowns.
- The name placeholder counts the library: "Custom NPC 3" when two exist; saving with the
  field empty uses that name.

## 3. Gear (View=Gear)

The same segmented control, then the slot fields two to a row, scrolling (the drawing shows the
thin scrollbar). Each slot is a **Text Input** with the slot's name as its label and "None" as
its placeholder, then two **Secondary icon buttons** (32px, 8px after the field, bottom-aligned
on the box's line): `search` and `reset`.

Order as drawn: Main hand, Off-hand, Ranged, Head, Shoulders, Back, Chest, Shirt, Tabard,
Wrists, Hands, Waist, Legs, Feet (**⚠ Figma issue:** "Wrists" is drawn twice; the second is
read as Hands, which is otherwise missing, so the 14 slots match the preset's).

**Decided (2026-10-30):** typing in the field searches the slot's gear by name (named items
first, then gear known by its texture or model), listing matches under the field; the
magnifier opens the Browse Piece view (§4); the reset button wears nothing in the slot. The
field shows the worn piece's name when it is not being typed in.

## 4. Browse Piece (View=Browse Piece)

In the rail's place (the tabs are gone; the footer stays):

- A heading row (32px, 12px gap): a **Secondary icon button** `left` (back to the Gear tab)
  and the slot's name in body/body-primary-bold (16/700, `--type-body-bold`).
- The tools row (16px gap): the regular **Text Input** with the `search` icon and "Search for
  assets..." filling, and the 140px tile-size group: `minus` 16px, the small fixed-step
  **Slider**, `plus` 16px.
- The **Gear Asset Grid**: `Scale` Min / Mid / Max = 5 / 4 / 3 columns, 16px gaps; the
  **Gear Asset Tile** is the [asset tile](asset-tile.md) (a radius-12 picture over a one-line
  label/label-light caption; `Selected?` adds the 2px accent border, the 20% accent wash and
  the bold accent caption), without the NPC tile's menu button. No grid/list toggle is drawn.
- **Kept:** a muted count line under the grid ("412 to choose from, 80 with a name"), as the
  other browsers have, and a "Show 200 more" outline button at the grid's end for long slots.

The tile size is kept across sessions (`wdb.npc-studio.scale`). Clicking a tile wears it at
once (the preview shows it); Back or Escape returns to the Gear tab.

## 5. Exit (flow 2.6.5)

Exit, the close button, Escape and a click on the veil all ask **"Exit NPC studio?"** / "Any
changes you've made will be lost." / Go back · Exit (the [dialog](dialog.md)). **Decided
(2026-10-30):** only when something changed since opening; otherwise they close at once.
Save to library saves and closes, as before.

### Acceptance checks

- Opens centred over the scene behind the veil at 925 × 787 (smaller viewports shrink it);
  the preview fills the left column and reframes when the window is resized.
- Appearance: name, title, race, gender, then the options two to a row; a change rebuilds the
  preview a moment later.
- Gear: fourteen slots in the drawn order; typing lists matches; the magnifier opens the
  browse view on that slot with what is worn selected; reset clears the slot.
- Browse: search filters, the slider changes the columns (5/4/3), a click wears the piece,
  Back returns to Gear with the field showing it.
- Exit asks only after a change; Save closes and the library shows the new NPC.
