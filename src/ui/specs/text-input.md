# Text Input: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Controls**, component set
**Text Input** (node `14:2450`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=14-2450>), read on
2026-10-29 (file version `2415918336314448768`).

A labelled single-line field: optional caption (with an optional "Optional" suffix) above, a
40px field with optional leading icon, prefix, value and suffix, and optional supporting text
below. The slider's value input ([slider.md](slider.md) §5) and the stepper's field
([stepper.md](stepper.md)) are this same box; build this molecule first and reuse it there.

Build it as the `text-input` part of the `field` molecule DESIGN_SYSTEM.md §5 plans:
`molecules/text-input.css` and `molecules/text-input.ts`. The Dropdown's closed trigger
([dropdown.md](dropdown.md)) shares the label and field box too.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§9).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `content-secondary` | `--color-text-muted` | `#CACACA` | label; prefix; suffix; supporting text |
| `surface-transparent-inverse` | `--color-bg-inverse` | `#E7E7E7` @ 40% | "Optional" label suffix |
| `content-primary` | `--color-text` | `#E7E7E7` | value text; leading icon; **Focused border** (§4.2) |
| `button-border-outline` | `--color-border` | `#646464` | field border; **placeholder text** (§4.3) |
| `surface-primary` | `--color-bg-surface` | `#383838` | field fill |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |

### 1.2 Type tokens used

| Text | Figma style | Code token |
|---|---|---|
| Label, "Optional", supporting text | `231:39937` `label/label`, 12px / 400 | `--type-label` |
| Value, placeholder, prefix, suffix | `231:39938` `body/body-secondary`, 14px / 400 | `--type-body-secondary` |

Atkinson Hyperlegible Mono, line height "auto" (15.6px / 18.2px), letter spacing 0, left aligned.

### 1.3 Proposed tokens for raw values

Shared with the slider input and stepper field, so name them for the field, not this molecule:

| Token | Value | Meaning |
|---|---|---|
| `--field-height` | 40px | field block size |
| `--field-padding` | 10px 12px | field padding (vertical, horizontal) |
| `--field-gap` | 8px | between icon, prefix, value and suffix |
| `--field-radius` | 8px | field corners |
| `--field-border-width` | 1px | field border, inside |
| `--field-label-gap` | 4px | label ↔ field ↔ supporting text |
| `--field-label-suffix-gap` | 4px | label ↔ "Optional" |

---

## 2. Anatomy and layout

```
Label  Optional                                  ← 12px #CACACA / "Optional" #E7E7E7@40%   (Show label?, Show label suffix?)
                                         4px
┌──────────────────────────────────────────────┐
│ [icon] $  Value                          %   │  ← field 40px, #383838, 1px #646464, r 8
└──────────────────────────────────────────────┘    padding 10 × 12, gap 8
                                         4px
Supporting text                                  ← 12px #CACACA                            (Show supporting text?)
```

| Part | Layout |
|---|---|
| Root | vertical stack, gap 4px, width **fills its column** (fixed 238px in the drawing) |
| Label row | horizontal, gap 4px, fills width; label fills, "Optional" hugs |
| Field | horizontal, items vertically centred, padding 10 × 12, gap 8, 40px tall (1 + 10 + 18 + 10 + 1: Figma counts the inside border in layout; set `block-size: 40px`), radius 8, 1px border **inside**, clips content, fills width |
| Leading icon | 16px (`--icon-size-sm`), `flex: none`; default glyph `search` (Figma `17:4629`) |
| Prefix | hugs, `flex: none`; default "$" |
| Value / placeholder | fills (`flex: 1 1 auto; min-width: 0`), one line, ellipsis |
| Suffix | hugs, `flex: none`; default "%" |
| Supporting text | fills width |

Order inside the field: **icon, prefix, value, suffix**.

**⚠ Figma issues in the layout**
- In the `hasValue?=False` variants the prefix comes **before** the leading icon
  ($, icon, placeholder, %), while the `hasValue?=True` variants have icon first. Build icon first
  in every state.
- The label and supporting text have **no line limit** (they wrap); the supporting text is also a
  fixed 238 × 16px box, so a second line would overlap whatever is below. **Build:** label on one
  line with an ellipsis (as decided for the slider, slider.md §2.1); supporting text **wraps** and
  grows (it is explanatory text), width 100%.

---

## 3. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Label` | text | "Label" | `label?: string` |
| `Show label?` | boolean | **`true`** | shown when `label` is given; without it, pass `ariaLabel` |
| `Show label suffix?` | boolean | `false` | `optional?: boolean`: shows "Optional" (fixed text, **not** a property in Figma; §9.4) |
| `Value` | text | "100" | `value?: string` |
| `Placeholder` | text | "Placeholder" | `placeholder?: string` |
| `hasValue?` | variant | **`False`** | not a prop: derived from whether `value` is empty (`:placeholder-shown`) |
| `Show leading icon?` | boolean | `false` | `icon?: IconName` (shown when given) |
| `Leading icon` | instance swap | `search` | (same `icon` prop) |
| `Show prefix?` / `Prefix` | boolean / text | `false` / "$" | `prefix?: string` |
| `Show suffix?` / `Suffix` | boolean / text | `false` / "%" | `suffix?: string` |
| `Show supporting text?` | boolean | `false` | `hint?: string` (the supporting text is **not** a text property in Figma; §9.4) |
| `State` | variant | `Rest` | `Hover` `:hover`, `Focused` `:focus-within`, `Disabled` `disabled` |
| (none) | | | `type?: 'text' \| 'search' \| 'number'`, `maxLength?`, `autocomplete?`, `spellcheck?` |
| (none) | | | `onInput(value)`, `onChange(value)` |

---

## 4. States

States apply to the field box; label, prefix/suffix and supporting text don't change except in
Disabled.

| State | Fill | Border | Overlay | Text | Opacity |
|---|---|---|---|---|---|
| Rest | `#383838` | 1px `#646464` `--color-border` | none | value `#E7E7E7` / placeholder §4.3 | 1 |
| Hover | same | same | `interaction-hover` wash over the field, clipped to radius 8 | same | 1 |
| Focused | same | **1px `#E7E7E7`** (§4.2) | none | same | 1 |
| Disabled | same | same | none | same | **0.3** on the whole component (label and hint too) |

Disabled has no Hover or Focused (it can't take either). Hover + Focused at once isn't drawn;
show both (focus border plus wash).

### 4.1 Hover

The usual "Hover State" rectangle over the field (left-right/top-bottom constraints). Build as a
background layer: `.ds-text-input-field:hover { background-image: linear-gradient(var(--field-hover-wash), var(--field-hover-wash)); }`.

### 4.2 Focused border

The Focused border is bound to **`content-primary`**, while the stepper's Focused border is bound
to **`button-border-outline-focus`**. Both resolve to `#E7E7E7`. **⚠ Figma issue:** build both
with `--color-focus` (`button-border-outline-focus`), the token that means focus, so a future
change to the focus colour reaches every field; rebind in Figma (§9.1).

```css
.ds-text-input-field:focus-within { border-color: var(--field-border-focus); } /* var(--color-focus) */
```

There is no outline ring for fields: the border recolour **is** the focus indicator. Remove the
browser's default outline on the inner `<input>`.

### 4.3 Placeholder colour

The placeholder is filled with `button-border-outline` `#646464` on the `#383838` field: about
**2:1 contrast**, which is hard to read and uses a border token for text. **⚠ Figma issue.**
Build with `--field-placeholder` defaulting to `--color-border` as drawn, and flag it (§9.2): a
text token such as `content-secondary` (`#CACACA`, ~7:1) would be readable, though then the
placeholder looks like the prefix/suffix.

---

## 5. Markup and behaviour

```html
<div class="ds-text-input">
	<div class="ds-text-input-label-row">
		<label class="ds-text-input-label" for="scene-name">Name</label>
		<span class="ds-text-input-optional">Optional</span>
	</div>
	<div class="ds-text-input-field">
		<svg class="ds-icon" aria-hidden="true">…</svg>
		<span class="ds-text-input-prefix" aria-hidden="true">$</span>
		<input class="ds-text-input-control" id="scene-name" type="text" placeholder="My dungeon" aria-describedby="scene-name-hint">
		<span class="ds-text-input-suffix" aria-hidden="true">%</span>
	</div>
	<p class="ds-text-input-hint" id="scene-name-hint">Shown in the scene list</p>
</div>
```

- The `<input>` has no border, background or outline of its own; it fills the space between the
  adornments. The `.ds-text-input-field` box draws fill, border, hover and focus.
- Clicking anywhere in the field box (icon, prefix, suffix, padding) focuses the input: put the
  pointer handler on the field, or make the field a `<label>` for the input.
- Prefix and suffix are visual; if the unit matters for meaning, include it in the label or
  `aria-describedby` (e.g. "Surface, yards").
- "Optional" is part of the accessible name only through the visible text; if it's important,
  add it to `aria-describedby` too.
- `type="search"`: hide the browser's clear button and decoration (`::-webkit-search-cancel-button`,
  `::-webkit-search-decoration`) unless design wants a clear affordance (§9.6).
- The molecule owns no model state: `onInput` per keystroke, `onChange` on commit (Enter / blur),
  and a `setValue(root, v)` setter.

### 5.1 Migrating existing markup

`index.html` has 10 text/search inputs (e.g. `#scene-name`, the texture/model/creature search
boxes, `#sel-npc-name`), mostly inside `.prop-row` labels, plus the 8 number inputs the stepper
spec covers. Per DESIGN_SYSTEM.md §5, list `.prop-row input[type="text"]`,
`input[type="search"]` beside `.ds-text-input-field` so they get the field box at once. The
asset-browser search boxes are the `search-box` molecule DESIGN_SYSTEM.md plans: this
component with `icon: 'search'`, `type: 'search'` and no label (`ariaLabel` instead).

---

## 6. States not drawn in Figma (Proposed)

| State | Selector | Treatment |
|---|---|---|
| Invalid | `[aria-invalid="true"]` | border `--color-danger` (`button-bg-destructive`, `#F45060`); supporting text in `--color-danger` as the error message |
| Read-only | `readonly` | as Rest, no hover wash, `cursor: default` |

---

## 7. Component tokens (tier 3, top of `.ds-text-input`)

```css
--field-bg: var(--color-bg-surface);
--field-border: var(--color-border);
--field-border-focus: var(--color-focus);
--field-fg: var(--color-text);
--field-placeholder: var(--color-border);     /* as drawn; see §4.3 */
--field-adornment-fg: var(--color-text-muted); /* prefix, suffix */
--field-label-fg: var(--color-text-muted);
--field-optional-fg: var(--color-bg-inverse);
--field-hint-fg: var(--color-text-muted);
--field-hover-wash: var(--color-bg-hover);
```

These `--field-*` knobs are shared by the slider's value input, the stepper's field and the
dropdown trigger.

---

## 8. Relationship to other specs

| Spec | Reuses |
|---|---|
| [slider.md](slider.md) §5 | the field box with a suffix, no label (80px wide) |
| [stepper.md](stepper.md) | the field box, value centred, no label, number type |
| [dropdown.md](dropdown.md) | the label and field box as the closed trigger, with a chevron instead of a suffix |

---

## 9. Open questions / feedback for design

1. **Focused border token.** Text Input binds it to `content-primary`; Stepper binds it to
   `button-border-outline-focus`. Same colour, but please bind both to the focus variable.
2. **Placeholder is `#646464`** (a border token) on `#383838`: ~2:1 contrast. Use a text token?
3. **Icon and prefix order** differs between `hasValue?` True and False (§2).
4. **"Optional" and the supporting text aren't text properties**, so neither can be changed per
   instance; the supporting text box is fixed-height.
5. **Label wraps**; spec makes it one line with an ellipsis like the slider's. Confirm.
6. **No clear button** for search fields, no Invalid state. Proposals in §5 and §6.
7. **Default `hasValue?` is False** (placeholder shown) while the default `Value` is "100";
   harmless, just noting the default variant shows the placeholder.

---

## 10. Suggested code API

```ts
export interface TextInputOptions {
	label?: string;
	ariaLabel?: string;            // required when label is omitted
	optional?: boolean;            // "Optional" after the label
	value?: string;
	placeholder?: string;
	type?: 'text' | 'search' | 'number';
	icon?: IconName;               // leading 16px icon
	prefix?: string;
	suffix?: string;
	hint?: string;                 // supporting text
	disabled?: boolean;
	maxLength?: number;
	autocomplete?: string;
	spellcheck?: boolean;
	title?: string;
	onInput?: (value: string) => void;
	onChange?: (value: string) => void;
}

export function textInput(options: TextInputOptions): { root: HTMLElement; input: HTMLInputElement };
export function setValue(root: HTMLElement, value: string): void;
export function setInvalid(root: HTMLElement, message: string | null): void;
```

### Acceptance checks

- Field is 40px tall with the border inside; radius 8; 12px horizontal padding; adornments 8px apart.
- Label 12px `#CACACA`, one line; supporting text 12px `#CACACA`, wraps.
- Hover adds the wash; Focus turns the border `#E7E7E7` with no extra ring; Disabled is the whole component at 30%.
- Clicking the icon, prefix or suffix focuses the input.
- Empty field shows the placeholder; a long value ends in an ellipsis when not focused and scrolls while editing.
- Search fields show the search icon and no browser clear/decoration.
- No hex values in `text-input.css`.

## 10. Small size (update read file version `2416211887664560962`, 2026-10-30)

The set gained a **Size** axis: `Regular` is everything above; `Small` (variants `264:51273`,
`264:51304` and their Hover, Focused and Disabled siblings) is the same field at **30px**: padding
6px top and bottom and **8px** at the sides, 8px between adornments, value and placeholder in
`label/label` (**12px**, `--type-label`), prefix and suffix 12px too. The label row, the
"Optional" suffix, the supporting text, the radius (8) and every state are unchanged; the whole
component is 50px tall with a label (16 + 4 + 30). The browser windows' search boxes use it
([texture-browser.md](texture-browser.md) §5).

**Built:** `textInput({ size: 'sm' })` sets `data-size="sm"` on the `.ds-field`; `field.css`
lowers `--field-height` to 30px and `--field-padding-inline` to `--space-2` and gives the box
`--type-label`, declared for the box used on its own too (`.ds-field-box[data-size='sm']`), so
the slider's and stepper's value fields can take it.
