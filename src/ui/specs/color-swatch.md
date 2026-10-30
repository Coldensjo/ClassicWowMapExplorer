# Color Swatch selector: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Controls**, component set
**Color Swatch** (node `37:15295`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=37-15295>), read on
2026-10-29 (file version `2415917481068854082`).

One square of colour that can be picked: `Selected?` True/False. A **selector** is a group of
swatches with exactly one selected (e.g. an NPC's skin or hair colour). Figma draws the swatch
only; the group is code (§4).

Build `molecules/swatch-picker.{css,ts}` with the swatch as its part.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§8).

---

## 1. Tokens used

### 1.1 Colour

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| *(content)* | none | `#E6C09E` in the drawing | the swatch fill: **the colour being offered**, a value from data, never a token |
| `button-bg-primary` | `--color-accent` | `#006FB4` | selected ring **and** selected dot |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §5) |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover (**Proposed**, §5) |

The swatch fill is set inline from the option's colour
(`style="--swatch-color: #e6c09e"`), the one place in the design system a raw colour value is
expected.

### 1.2 Type

None: swatches have no visible text (each needs an accessible name, §4).

### 1.3 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--swatch-size` | 32px | swatch width and height |
| `--swatch-radius` | 4px | swatch corners |
| `--swatch-ring-width` | 3px | selected ring, outside the swatch |
| `--swatch-dot-size` | 12px | selected dot |
| `--swatch-gap` | 8px | between swatches in a picker (**Proposed**, §4) |

---

## 2. Anatomy

```
 Unselected                 Selected
 ┌──────────┐            ┏━━━━━━━━━━━━┓   3px #006FB4 ring, OUTSIDE the 32px box
 │          │            ┃┌──────────┐┃
 │  colour  │            ┃│    ●     │┃   12px #006FB4 dot, centred
 │          │            ┃└──────────┘┃
 └──────────┘            ┗━━━━━━━━━━━━┛
  32 × 32, r 4             renders 38 × 38; layout stays 32 × 32
```

| Part | Value |
|---|---|
| Swatch | 32 × 32, radius 4, fill = option colour, no border, clips content |
| Selected ring | 3px solid `--color-accent`, **outside** the swatch (render bounds 38 × 38), following the 4px corners (so its outer radius is 7px) |
| Selected dot | 12 × 12 circle, `--color-accent`, centred (10px from each edge) |

---

## 3. States

| State | Ring | Dot | Notes |
|---|---|---|---|
| Unselected | none | none | the colour alone |
| Selected | 3px `#006FB4` outside | 12px `#006FB4` centred | |
| Hover, focus, disabled | **Proposed**, §5 | | not drawn |

Build the ring without affecting layout, like the Outline button's border (buttons.md §4):
`box-shadow: 0 0 0 var(--swatch-ring-width) var(--swatch-ring)`. Neighbouring swatches must be at
least 3px apart or the ring overlaps them; the proposed 8px gap leaves 5px clear.

### 3.1 ⚠ Figma issue: the accent on accent-like colours

Ring and dot are both `button-bg-primary` `#006FB4`. On a blue swatch the dot disappears, and the
ring is the only sign of selection; on a near-black swatch the dark blue ring is low contrast.
Build as drawn and flag (§8.1). A common fix is a 2px gap between swatch and ring (a
`--color-bg-panel` inner ring) and a dot in `--color-text` with a dark outline, which reads on
any colour.

---

## 4. The selector (group), code only

| Property | Value (**Proposed**: not drawn) |
|---|---|
| Layout | `display: flex; flex-wrap: wrap; gap: var(--swatch-gap)` (8px), or a grid of fixed columns if a panel needs aligned rows |
| Label | the group needs a visible label above (the slider/text-input caption style: `--type-label`, `--color-text-muted`) or `aria-label` |
| Selection | exactly one selected; may start with none if the value is unset |

Markup: native radios, like the radio and segmented-control specs.

```html
<div class="ds-swatch-picker" role="radiogroup" aria-labelledby="skin-label">
	<span class="ds-swatch-picker-label" id="skin-label">Skin colour</span>
	<label class="ds-swatch" style="--swatch-color: #e6c09e" title="Skin colour 1">
		<input class="ds-swatch-input" type="radio" name="skin" value="1" aria-label="Skin colour 1">
		<span class="ds-swatch-dot" aria-hidden="true"></span>
	</label>
	…
</div>
```

- Each swatch needs an **accessible name** (a colour name if the data has one, otherwise
  "Skin colour 3 of 10"), also shown as a tooltip, because colour alone means nothing to a
  screen reader and little to colour-blind users.
- Keyboard (native radios): Tab enters on the selected swatch; arrows move **and select**; Tab
  leaves.
- The molecule owns no model state: `onChange(value)`, `setValue(root, value)`.

---

## 5. States not drawn in Figma (Proposed)

| State | Selector | Treatment |
|---|---|---|
| Hover (unselected) | `.ds-swatch:hover` | 1px `--color-border` outline outside (a wash would change the colour being judged, so no overlay) |
| Focus-visible | `.ds-swatch:has(:focus-visible)` | 1px `--color-focus` outline at offset 5px, outside the selected ring |
| Disabled / unavailable | `:has(:disabled)` | `opacity: var(--opacity-disabled)` (0.3), no hover, skipped by arrows |

---

## 6. Component tokens (tier 3, top of `.ds-swatch-picker`)

```css
--swatch-ring: var(--color-accent);
--swatch-dot: var(--color-accent);
--swatch-hover-outline: var(--color-border);
/* --swatch-color is set per swatch from data; plus the size tokens in §1.3 */
```

---

## 7. Suggested code API

```ts
export interface SwatchOption { value: string; color: string; name?: string; disabled?: boolean }

export interface SwatchPickerOptions {
	label?: string;
	ariaLabel?: string;           // required when label is omitted
	name: string;
	options: SwatchOption[];
	value: string | null;
	onChange?: (value: string) => void;
}

export function swatchPicker(options: SwatchPickerOptions): { root: HTMLElement };
export function setValue(root: HTMLElement, value: string | null): void;
```

### Acceptance checks

- Swatches are 32 × 32 with 4px corners, filled with their option colour, 8px apart.
- The selected swatch has a 3px `#006FB4` ring outside (layout unchanged) and a 12px `#006FB4` dot centred.
- Arrow keys move the selection; each swatch announces its name; hovering shows its name.
- The only raw colours in the CSS are the per-swatch `--swatch-color` values from data.

---

## 8. Open questions / feedback for design

1. **Ring and dot are both the accent**, so selection is hard to see on blue or very dark
   swatches (§3.1). Add a gap ring, or a light dot?
2. **Ring and dot together** is a double signal; is the dot needed if the ring stays?
3. **No group (selector) component**: gap, wrapping, label and maximum per row aren't drawn;
   spec proposes 8px gap, wrapping, label above.
4. **No hover, focus or disabled.** Proposals in §5 avoid a wash, since it would alter the colour
   the user is choosing.
5. **Names.** Where do swatch names come from (the colour data, or "Colour 3 of 10")?
