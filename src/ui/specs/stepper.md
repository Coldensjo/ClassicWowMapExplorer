# Stepper: build spec

Source: Figma file "Dungeon Builder", component set **Stepper** (node `41:24032`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=41-24032>), read on
2026-10-29 (file version `2415918336314448768`).

A stepper is a numeric field with a **minus** button on the left and a **plus** button on the
right: `[ − ] [ 12 ] [ + ]`. It is built from two existing components, so read those specs
first:

- the buttons are **Button - Icon - Secondary**, size **Medium** ([buttons.md](buttons.md) §6);
- the field is the same box as the slider's value input ([slider.md](slider.md) §5), here with
  the value centred and no suffix.

Build it as the `number-input` part of the `field` molecule DESIGN_SYSTEM.md §5 plans:
`molecules/stepper.css` and `molecules/stepper.ts` (or `number-input.*`; pick one and update
DESIGN_SYSTEM.md's list). It reuses the icon-button molecule for its buttons rather than
restyling them.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§9).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `surface-transparent-primary` | `--color-bg-panel` | `#181818` @ 85% | minus / plus button fill |
| `content-primary` | `--color-text` | `#E7E7E7` | value text; button icons |
| `surface-primary` | `--color-bg-surface` | `#383838` | field fill |
| `button-border-outline` | `--color-border` | `#646464` | field border, Rest and Hover |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | field border, **Focused** |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | field hover wash; button hover (from buttons.md) |

### 1.2 Type token used

Value: Figma style `231:39938` `body/body-secondary`, Atkinson Hyperlegible Mono 400, 14px,
line height "auto" (measured 18.2px), letter spacing 0, **centred**, one line with an ellipsis.
Code token **`--type-body-secondary`**, plus `font-variant-numeric: tabular-nums` so the value
doesn't shift as digits change.

### 1.3 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--stepper-gap` | 4px | between button, field and button |
| `--stepper-height` | 40px | whole control (buttons and field) |
| `--stepper-field-min-width` | 72px | field minimum width |
| `--stepper-field-padding` | 10px 12px | field padding (vertical, horizontal) |
| `--stepper-field-radius` | 8px | field corners |

The buttons take their sizes from the icon-button molecule (Medium: 40 × 40, 8px padding,
24px icon, fully round).

---

## 2. Anatomy and layout

```
┌────┐ 4 ┌──────────────────┐ 4 ┌────┐
│ −  │   │        12        │   │ +  │      height 40
└────┘   └──────────────────┘   └────┘
 40×40     min 72 × 40, r 8      40×40
 circle    #383838, 1px #646464  circle
 #181818@85%                     #181818@85%
```

| Part | Layout |
|---|---|
| Root | horizontal, gap 4px, items vertically centred, **hugs** its content (160 × 40 at minimum width) |
| Minus button | Icon-Secondary Medium: 40 × 40, padding 8, `minus` icon (Figma `14:3922`) at 24px, `flex: none` |
| Field | hugs its value with **min-width 72px**, 40px tall, padding 10 × 12, gap 8, radius 8, 1px border inside, clips content |
| Value | fills the field, centred, one line, ellipsis |
| Plus button | as minus, `plus` icon (Figma `14:3923`) |

Width: the field hugs in Figma, so a long value would widen the control. **Build the field with a
fixed width** (`inline-size: var(--stepper-field-min-width)`, overridable per use, e.g. wider for
"16384") so the control doesn't change size while the value changes; the ellipsis covers
overflow. **Proposed**, §9.3.

---

## 3. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `State` | variant | `Rest` | `Hover` is `:hover`; `Focused` is `:focus-within` on the field (§4) |
| (none) | | | `value: number \| null` (required; `null` = empty, §6.3) |
| (none) | | | `min?`, `max?` (default unbounded), `step?` (default 1) |
| (none) | | | `label: string`: accessible name (the stepper has no visible label of its own) |
| (none) | | | `format?: (v) => string`, `suffix?: string` (**Proposed**, §9.5) |
| (none) | | | `placeholder?: string` |
| (none) | | | `onChange(value)` |
| (none) | | | `disabled?: boolean` (**Proposed**) |

**⚠ Figma issues.**
- The value ("12") is **not a text property**, so instances can't change it from the
  properties panel.
- The minus and plus icons are fixed instances, not exposed; fine, they should never change.

---

## 4. States

States apply to the **field**; the two buttons stay at their own Rest state in every variant and
carry their own hover from buttons.md.

| State | Field fill | Field border | Overlay | Buttons |
|---|---|---|---|---|
| Rest | `#383838` `--color-bg-surface` | 1px `#646464` `--color-border` | none | Rest |
| Hover (pointer over the field) | same | same | `interaction-hover` wash (`#E7E7E7` @ 10%) over the field, clipped to radius 8 | Rest |
| Focused (caret in the field) | same | **1px `#E7E7E7` `--color-focus`** | none | Rest |
| Disabled | **Proposed** §7 | | | |

Build the hover wash as a background layer, as elsewhere:

```css
.ds-stepper-field:hover {
	background-image: linear-gradient(var(--stepper-hover-wash), var(--stepper-hover-wash));
}
.ds-stepper-field:focus-within {
	border-color: var(--stepper-border-focus);
}
```

Hover and Focused at once isn't drawn; show the focus border and the wash together.

**This is the first drawn focus state in the file**: a field takes focus by **changing its
border colour** to `button-border-outline-focus`, with no ring or offset. The other specs
propose a 1px outline ring offset 2px for buttons, switches, radios and segments; that is still
reasonable for those (they have no border to recolour), but see §9.1.

---

## 5. Buttons

| Property | Value |
|---|---|
| Component | Button - Icon - Secondary, Medium, Rest (buttons.md §6) |
| Fill | `surface-transparent-primary` → `--color-bg-panel` (`#181818` @ 85%) |
| Shape | circle, 40 × 40 |
| Icon | `minus` / `plus`, 24px, `--color-text`. The instances override the icon stroke weight (value not exposed); build with `--icon-stroke-width` (1px) as everywhere |
| Hover | the icon button's own hover wash |
| Accessible names | `aria-label="Decrease"` / `"Increase"` (or "Decrease Facing" when several steppers share a panel) |

---

## 6. Behaviour

### 6.1 Markup

```html
<div class="ds-stepper">
	<button class="ds-icon-button" data-variant="secondary" data-size="md" type="button" aria-label="Decrease" tabindex="-1">…minus icon…</button>
	<div class="ds-stepper-field">
		<input class="ds-stepper-input" type="number" inputmode="decimal" min="0" max="10" step="1" value="12" aria-label="Name set">
	</div>
	<button class="ds-icon-button" data-variant="secondary" data-size="md" type="button" aria-label="Increase" tabindex="-1">…plus icon…</button>
</div>
```

- The `<input type="number">` is the real control (role `spinbutton`); hide its native spinner
  arrows (`appearance: textfield` and the `::-webkit-inner/outer-spin-button` reset) and remove its
  own border/background so the `.ds-stepper-field` box draws them.
- **Proposed:** the buttons take `tabindex="-1"` so the stepper is one Tab stop; keyboard users
  step with ↑/↓ in the field, which the native input already supports. If design wants the
  buttons reachable by Tab, drop the attribute.

### 6.2 Stepping

- Minus/plus change the value by `step`, then clamp to `min`/`max` and round to the step's
  precision (avoid `0.1 + 0.2` artefacts: round to the number of decimals in `step`).
- ↑/↓ in the field: ±`step` (native). **Proposed:** Shift+↑/↓ ±10 × `step`; PageUp/PageDown the
  same.
- **Proposed:** press-and-hold on a button repeats after 400ms, then every 60ms, until release.
- At `min` the minus button is disabled (and at `max` the plus button), with the disabled
  treatment from §7.

### 6.3 Typing

- Typing doesn't fire `onChange` on every key; commit on Enter, on blur, or after a step.
  Clamp and round on commit.
- Invalid text reverts to the last valid value on blur.
- **Empty value**: some existing fields treat empty as meaningful (e.g. "Flatten to" with
  placeholder "first touch", "Surface" with "above click"). The stepper allows `null` when the
  caller passes a `placeholder`; then minus/plus start from `min` (or 0) on first press.
  Otherwise empty reverts.

### 6.4 State ownership

The molecule owns no model state: it reports `onChange(value)` and exposes
`setValue(root, value)`.

### 6.5 Migrating existing markup

`index.html` has 8 `<input type="number">` fields inside `.prop-row` labels (Flatten to,
Surface, Scale min/max, Name set, Facing, NPC Scale, Resolution W/H). Per DESIGN_SYSTEM.md §5,
listing `.prop-row input[type="number"]` beside `.ds-stepper-input` gives them the field box at
once. The minus/plus buttons arrive only when a row moves to the factory. Some of them carry a
unit after the input (`yd`, `°`); see §9.5.

---

## 7. States not drawn in Figma (Proposed)

| State | Selector | Treatment |
|---|---|---|
| Disabled (whole stepper) | `[aria-disabled="true"]` on the root, input `disabled` | whole control `opacity: var(--opacity-disabled)` (0.3, radio.md §1.3), no hover, `cursor: not-allowed` |
| Button disabled at a limit | the button's `:disabled` | that button alone at 0.3 opacity (buttons.md §8) |
| Invalid | `[aria-invalid="true"]` | not drawn; `--color-danger` border if design wants one |
| Pressed button | `:active` | the icon button's own pressed treatment |

---

## 8. Component tokens (tier 3, top of `.ds-stepper`)

```css
--stepper-field-bg: var(--color-bg-surface);
--stepper-border: var(--color-border);
--stepper-border-focus: var(--color-focus);
--stepper-fg: var(--color-text);
--stepper-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.3; buttons use the icon-button molecule's tokens */
```

---

## 9. Open questions / feedback for design

1. **Focus style.** The stepper's Focused state recolours the field border to
   `button-border-outline-focus`; the other specs propose a 1px outline ring offset 2px for
   controls with no border. Use one for fields and the other for everything else, or one style
   everywhere?
2. **The value is not a text property**, so it can't be set per instance.
3. **Field width hugs the value** (min 72px). The spec fixes the width so the control doesn't
   jump as the value changes; confirm, and say what width long values (e.g. 16384) should get.
4. **No disabled state**, and nothing for the buttons at min/max. Proposals in §7 and §6.2.
5. **Units.** Existing fields show units after the value (`yd`, `°`); the slider's input has a
   suffix but this field doesn't. Should the stepper field take a suffix like the slider's?
6. **Button fill** is the translucent `surface-transparent-primary`; over a panel that is itself
   `#181818` @ 85%, the buttons will barely stand out from the background (contrast comes only
   from the icon). Intended?
7. **No visible label.** Fine inside a labelled row, but a `Show label?` like the slider's would
   make it self-contained.

---

## 10. Suggested code API

```ts
export interface StepperOptions {
	label: string;                  // accessible name (aria-label of the input)
	value: number | null;
	min?: number;
	max?: number;
	step?: number;                  // default 1
	placeholder?: string;           // allows an empty (null) value
	format?: (value: number) => string;
	disabled?: boolean;
	title?: string;
	fieldWidth?: string;            // CSS length; default var(--stepper-field-min-width)
	onChange?: (value: number | null) => void;
}

export function stepper(options: StepperOptions): { root: HTMLElement; input: HTMLInputElement };
export function setValue(root: HTMLElement, value: number | null): void;
```

### Acceptance checks

- The control is 40px tall; buttons 40 × 40 circles; field at least 72px wide, 4px from each button.
- The value is centred, 14px, `#E7E7E7`, and long values end in an ellipsis without resizing the control.
- Hovering the field adds the 10% wash; focusing it turns its border `#E7E7E7`; neither changes the buttons.
- Minus/plus step by `step`, clamp to min/max and disable at the limits; no floating-point noise (0.3, not 0.30000000000000004).
- ↑/↓ in the field step; typing commits on Enter/blur; invalid text reverts.
- The native number spinners are hidden.
- Screen readers announce a spin button with the label and value.
- No hex values in `stepper.css`.
