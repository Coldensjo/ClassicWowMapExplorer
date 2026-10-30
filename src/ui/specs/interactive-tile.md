# Interactive Tile: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Controls**, component set
**Tile - Interactive** (node `234:39954`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=234-39954>), read on
2026-10-29 (file version `2415917481068854082`).

A full-width, outlined card with a title, an optional one-line description and a trailing `›`
chevron: e.g. "**Local NPCs** / Created in this scene. ›". It **navigates**: clicking it opens a
deeper view (a list, a sub-panel). `State` Rest/Hover, plus `Show body?`.

Build `molecules/tile.{css,ts}`.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§8).

---

## 1. Tokens used

### 1.1 Colour

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `surface-transparent-inverse` | `--color-bg-inverse` | `#E7E7E7` @ 40% | tile border |
| *(none)* | `transparent` | n/a | tile fill (the panel shows through) |
| `content-primary` | `--color-text` | `#E7E7E7` | title; chevron |
| `content-secondary` | `--color-text-muted` | `#CACACA` | description |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus (**Proposed**, §5) |

The border token is the same translucent white the Outline button uses (buttons.md §4).

### 1.2 Type

| Text | Figma style | Code token |
|---|---|---|
| Title | `234:39944` `body/body-secondary-bold`, 14px / **600 SemiBold** | `--type-body-secondary-bold` |
| Description | `231:39938` `body/body-secondary`, 14px / 400 | `--type-body-secondary` |

Atkinson Hyperlegible Mono, line height "auto" (18.2px), letter spacing 0, left aligned; both
**one line, ellipsis** (Figma max lines 1, truncation "ending").

### 1.3 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--tile-padding` | 16px | all sides |
| `--tile-gap` | 10px | text column ↔ chevron |
| `--tile-text-gap` | 4px | title ↔ description |
| `--tile-radius` | 12px | corners |
| `--tile-min-height` | 72px | minimum block size |

---

## 2. Anatomy and layout

```
┌──────────────────────────────────────────────────────────────┐  1px #E7E7E7@40% inside, r 12, no fill
│  Local NPCs                                                › │  title 14px/600 #E7E7E7
│  Created in this scene.                                      │  description 14px/400 #CACACA  (Show body?)
└──────────────────────────────────────────────────────────────┘  padding 16, min-height 72
```

| Part | Layout |
|---|---|
| Tile | horizontal, padding 16, gap 10, items vertically centred, **fills its column** (414px in the drawing), height hugs with **min 72px** (74 with both lines: 1 + 16 + 18 + 4 + 18 + 16 + 1), radius 12, 1px border inside, clips content |
| Text column | vertical, gap 4, **vertically centred**, fills the remaining width (`flex: 1 1 auto; min-width: 0`) |
| Title | fills, one line, ellipsis |
| Description | fills, one line, ellipsis; hidden when `Show body?` is off, and the title then centres in the 72px tile |
| Chevron | `right` icon (Figma `34:13064`) at **16px** (`--icon-size-sm`), `currentColor` = `--color-text`, `flex: none` |

The chevron instance is scaled from the 24px drawing, so Figma renders its stroke at 0.67px;
build with `--icon-stroke-width` (1px), as for every icon.

---

## 3. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `State` | variant | `Rest` | `Hover` is `:hover` |
| `Show body?` | boolean | `true` | `description?: string` (shown when given) |
| (none) | | | `title: string` (required) |
| (none) | | | `onActivate()` **or** `href` (§4) |
| (none) | | | `disabled?: boolean` (**Proposed**) |

**⚠ Figma issue.** Neither the title ("Local NPCs") nor the description ("Created in this
scene.") is a text property, so instances can only change them by overriding layers.

---

## 4. States and behaviour

| State | Border | Fill | Overlay |
|---|---|---|---|
| Rest | 1px `#E7E7E7` @ 40% | none | none |
| Hover | same | none | `interaction-hover` wash over the whole tile, clipped to radius 12 |
| Focus / pressed / disabled | **Proposed**, §5 | | |

Build hover as a background layer
(`background-image: linear-gradient(var(--tile-hover-wash), var(--tile-hover-wash))`), as
elsewhere.

**Element.** The whole tile is one control:
- a `<button type="button">` when it opens something in place (a sub-panel), with
  `onActivate`;
- an `<a href>` if the destination is a URL/route.

Its accessible name is the title; the description joins via `aria-describedby`. The chevron is
decorative (`aria-hidden`). Enter (and Space, for a button) activates.

```html
<button class="ds-tile" type="button" aria-describedby="tile-local-desc">
	<span class="ds-tile-text">
		<span class="ds-tile-title">Local NPCs</span>
		<span class="ds-tile-description" id="tile-local-desc">Created in this scene.</span>
	</span>
	<svg class="ds-icon" aria-hidden="true">…right…</svg>
</button>
```

Reset the button's default styles (font, background, text-align: left, width: 100%). Tiles
stack vertically in a panel; the gap between them is the panel's (**Proposed** 8px).

---

## 5. States not drawn in Figma (Proposed)

| State | Selector | Treatment |
|---|---|---|
| Focus-visible | `.ds-tile:focus-visible` | border recolours to `--color-focus`, like the text field (text-input.md §4.2), plus the hover wash |
| Pressed | `:active` | wash doubled (`#E7E7E7` @ 20%) for the press |
| Disabled | `:disabled` / `[aria-disabled="true"]` | `opacity: var(--opacity-disabled)` (0.3), no hover, `cursor: not-allowed` |

---

## 6. Component tokens (tier 3, top of `.ds-tile`)

```css
--tile-border: var(--color-bg-inverse);
--tile-border-focus: var(--color-focus);
--tile-title-fg: var(--color-text);
--tile-description-fg: var(--color-text-muted);
--tile-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.3 */
```

---

## 7. Suggested code API

```ts
export interface TileOptions {
	title: string;
	description?: string;          // "Show body?"
	href?: string;                 // renders <a>; otherwise <button>
	disabled?: boolean;
	onActivate?: () => void;
}

export function tile(options: TileOptions): HTMLElement;
```

### Acceptance checks

- The tile fills its column, is at least 72px tall (74px with a description), has 16px padding, 12px corners and a 1px `#E7E7E7`@40% border inside, and no fill.
- Title 14px SemiBold `#E7E7E7`, description 14px `#CACACA`, both one line with an ellipsis; without a description the title is vertically centred.
- A 16px `›` chevron sits 10px right of the text, vertically centred.
- Hover washes the whole tile; Enter/click activates; the screen reader reads title then description.
- No hex values in `tile.css`.

---

## 8. Open questions / feedback for design

1. **Title and description aren't text properties** (§3).
2. **No focus, pressed or disabled states.** Proposals in §5; the focus treatment follows the
   fields' border recolour.
3. **Spacing between stacked tiles** isn't specified; spec proposes 8px.
4. **Radius 12** matches the mode controller bar but not other controls (8px fields, 4px
   buttons). Intended for card-like surfaces?
5. **"Interactive" suggests a non-interactive Tile** exists or is planned; if so, it should share
   this layout minus the chevron and hover.
