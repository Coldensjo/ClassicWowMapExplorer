# Segmented Control: build spec

Source: Figma file "Dungeon Builder", section **Segmented Control** (node `243:49520`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=243-49520>), read on
2026-10-29 (file version `2415918336314448768`). The section holds two component sets:

| # | Figma component set | Node | What it is | Variant axes |
|---|---|---|---|---|
| 1 | Chip - Segmented Control | `14:4047` | one segment | `Selected?` True/False × `State` Rest/Hover |
| 2 | Segmented Control | `38:15547` | a trough holding the segments, one selected | `Selected chip` 1/2 |

A segmented control picks **one of a few mutually exclusive modes** (e.g. Raise / Lower /
Smooth in the Sculpt panel). Build it as the `toggle-group` molecule DESIGN_SYSTEM.md §5 already
plans for "the `.mode-row` button rows": `molecules/toggle-group.css` and
`molecules/toggle-group.ts`. (Name it `segmented-control` instead if you prefer the Figma name;
pick one and update DESIGN_SYSTEM.md's list.)

Conventions match [buttons.md](buttons.md), [switch.md](switch.md) and [radio.md](radio.md):
each colour names its Figma variable, the code token in [tokens/color.css](../tokens/color.css)
and the resolved value; sizes are **raw numbers in Figma**; **⚠ Figma issue** marks an
inconsistency and says what to build; **Proposed** marks something not drawn that needs design
sign-off (§8).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `surface-primary` | `--color-bg-surface` | `#383838` | trough fill |
| `button-border-outline` | `--color-border` | `#646464` | trough border |
| `button-bg-outline` | `--color-bg-control` | `#181818` | **selected** segment fill |
| *(none)* | `transparent` | n/a | unselected segment fill (the trough shows through) |
| `content-primary` | `--color-text` | `#E7E7E7` | segment label, selected and unselected |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §6) |

The selected segment is shown by a **darker** fill, not the accent. See §8.1.

### 1.2 Type token used

The segment label uses a **different, smaller** style than the buttons, switch and radio: Figma
style `231:39937`, Atkinson Hyperlegible Mono, 400 Regular, **12px**, line height "auto"
(measured 15.6px), letter spacing 0, centred. That is Figma's `label/label`; code token
**`--type-label`** (`var(--font-weight-regular) var(--font-size-sm) / var(--line-height-normal)
var(--font-family-ui)`).

The label is the same weight and colour whether selected or not.

### 1.3 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--toggle-group-radius` | 8px | trough corner radius |
| `--toggle-group-padding` | 4px | trough padding inside its 1px border |
| `--toggle-group-gap` | 4px | gap between segments |
| `--toggle-group-segment-radius` | 4px | segment corner radius |
| `--toggle-group-segment-padding` | 6px 4px | segment padding (vertical, horizontal) |
| `--toggle-group-segment-height` | 28px | segment block size |
| `--toggle-group-border-width` | 1px | trough border |

If buttons.md §1.4's `--space-*` and `--radius-sm` tokens exist by then, use those for 4, 6 and
4px instead.

---

## 2. Anatomy

```
┌─ trough: fill #383838, 1px #646464 border inside, radius 8 ──────────────────┐
│ ┌─ segment (selected) ─────────────┐ 4 ┌─ segment (unselected) ───────────┐  │
│ │ fill #181818, radius 4           │   │ no fill, radius 4                │  │
│ │            Label                 │   │            Label                 │  │
│ └──────────────────────────────────┘   └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ 1px border + 4px padding = segments sit 5px in from the outer edge
```

---

## 3. Segment: Chip - Segmented Control (`14:4047`)

### 3.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected?` | variant | `True` | the segment whose `value` equals the group's value; not set per segment by the caller |
| `State` | variant | `Rest` | `Hover` is `:hover` |
| (none) | | | `label: string` (required): default text in Figma "Label" |
| (none) | | | `value: string` (required) |
| (none) | | | `disabled?: boolean` (**Proposed**) |

**⚠ Figma issue.** The label is **not a text property** (instances override the layer's text),
as with the switch row, radio row and Outline button.

### 3.2 Layout

| Property | Value |
|---|---|
| Direction | horizontal, content centred both ways |
| Width | fixed in the standalone component (62px); **fills an equal share** inside the control (§4.2) |
| Height | hugs: 6 + 16 + 6 = **28px** (the 15.6px line rounds to a 16px text box). Set `block-size: 28px` in code so it doesn't depend on font metrics |
| Padding | 6px top/bottom, 4px left/right |
| Gap | 4px (only one child today; would space a future icon from the label) |
| Radius | 4px |
| Clips content | yes |
| Label | fills the segment width, text centred |

**⚠ Figma issue.** The label is set to auto-height with **no line limit or truncation**, so a
long label would wrap onto a second line and make that segment taller than the others. Build
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, and set `title` to the full
label when it truncates.

### 3.3 Visual spec by state

| State | Fill | Label | Overlay |
|---|---|---|---|
| Unselected · Rest | none (trough `#383838` shows) | `#E7E7E7` `--color-text`, `--type-label` | none |
| Unselected · Hover | none | same | `interaction-hover` (`#E7E7E7` @ 10%) over the segment, radius 4 |
| Selected · Rest | `button-bg-outline` → `--color-bg-control` `#181818` | same | none |
| Selected · Hover | `#181818` | same | `interaction-hover` wash over it |
| Disabled | **Proposed** §6 | | |

No border, shadow or label weight change in any state.

Hover is drawn the usual way (a "Hover State" rectangle on top, constrained to all edges,
clipped by the segment). Build it as a background layer:

```css
.ds-toggle-group-segment:hover {
	background-image: linear-gradient(var(--toggle-group-hover-wash), var(--toggle-group-hover-wash));
}
```

Hovering the selected segment is drawn in Figma, but clicking it does nothing (it is already
selected). Keep the wash for consistency, with `cursor: default` on the selected segment
(**Proposed**).

---

## 4. Segmented Control (`38:15547`)

### 4.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected chip` | variant | `1` | `value: string`: the selected option's value |
| (none) | | | `options: { value; label; disabled? }[]` (required) |
| (none) | | | `label: string`: accessible group name (e.g. "Sculpt mode") |
| (none) | | | `onChange(value)` |

**⚠ Figma issue.** The component only exists with **two segments** (`Selected chip` 1/2). The
editor's existing mode rows have 2 to 6 options (Sculpt has six: Raise, Lower, Smooth, Flatten,
Noise, Ramp). Build for **any number of segments ≥ 2**; see §4.3 for what to do when they don't
fit.

### 4.2 Layout

| Property | Value |
|---|---|
| Direction | horizontal (`display: flex`) |
| Width | **fills its container** (Figma "Fill"; 203px in the drawing) |
| Height | hugs: 1 + 4 + 28 + 4 + 1 = **38px** (Figma includes the inside border in layout) |
| Padding | 4px inside the 1px border, so segments sit 5px from the outer edge |
| Gap | 4px between segments |
| Segments | each `flex: 1 1 0; min-width: 0`: equal widths regardless of label length (Figma: Fill, 94.5px each in a 203px control) |
| Cross-axis | centred |
| Radius | 8px; segments 4px |
| Fill / border | `--color-bg-surface` `#383838`; 1px `--color-border` `#646464`, inside (`box-sizing: border-box`) |
| Clips content | yes |

### 4.3 Many segments (Proposed)

Not in Figma. In a 320px panel column each of six segments gets about 46px, enough for 12px
labels of up to ~5 characters. Proposed, in order of preference:

1. Keep one row and let labels truncate (§3.2) with a `title` tooltip.
2. If design prefers, allow wrapping into rows of equal segments (`flex-wrap: wrap` with a
   per-control `--toggle-group-columns`, as the existing `.mode-row.two` does for two columns).

Ask design which (§8.3).

---

## 5. Markup and behaviour

This is a **single-select** control, so build it as a radio group with buttons as the visuals,
or as native radios like radio.md. Recommended, native radios:

```html
<div class="ds-toggle-group" role="radiogroup" aria-label="Sculpt mode">
	<label class="ds-toggle-group-segment">
		<input class="ds-toggle-group-input" type="radio" name="sculpt-mode" value="raise" checked>
		<span class="ds-toggle-group-label">Raise</span>
	</label>
	<label class="ds-toggle-group-segment">
		<input class="ds-toggle-group-input" type="radio" name="sculpt-mode" value="lower">
		<span class="ds-toggle-group-label">Lower</span>
	</label>
	…
</div>
```

- The input is visually hidden but focusable; style with `:has(:checked)` on the segment
  (`.ds-toggle-group-segment:has(.ds-toggle-group-input:checked)`) for the selected fill. The
  same rule also lists `[aria-pressed="true"]`, so the legacy button rows below get the
  selected look without radios.
- Keyboard (native radios): Tab enters on the selected segment; ←/→ (and ↑/↓) move **and
  select**; Tab leaves. Disabled segments are skipped.
- `onChange(value)` from the inputs' `change` event; the molecule keeps no state beyond the DOM.
  Provide `setValue(root, value)` for when the model changes from elsewhere (e.g. a shortcut).

**Migrating the existing `.mode-row` markup.** `index.html` has rows like
`<div class="mode-row" role="group" aria-label="Sculpt mode"><button id="sculpt-raise">Raise</button>…`
with the selection shown by a `.active` class. They can migrate without rewriting by styling the
buttons too, per DESIGN_SYSTEM.md §5's legacy-selector rule:

- `.ds-toggle-group, .tool-props .mode-row { … }` for the trough,
- `.ds-toggle-group-segment, .tool-props .mode-row > button { … }` for segments,
- the selected segment by `[aria-pressed="true"]` (DESIGN_SYSTEM.md requires an ARIA attribute,
  not a class), so the panel code switches from toggling `.active` to setting `aria-pressed`.

Some `.mode-row`s hold **actions**, not modes (e.g. "Selection actions": Drop to ground /
Duplicate / Delete). Those are not segmented controls: no segment is ever selected. Leave them as
a row of buttons (buttons.md) rather than this molecule.

---

## 6. States not drawn in Figma (Proposed)

| State | Selector | Proposed treatment |
|---|---|---|
| Focus-visible | `.ds-toggle-group-segment:has(:focus-visible)` | 1px solid `--color-focus` outline, offset −1px (inside the trough, so neighbours don't clip it), radius 4 |
| Disabled segment | `:has(:disabled)` | `opacity: var(--opacity-disabled)` (0.3, radio.md §1.3), no hover, `cursor: not-allowed` |
| Whole control disabled | `[aria-disabled="true"]` on the root | every segment as above; trough unchanged |
| Pressed | `:active` | none needed |
| Motion | selected fill | instant; or slide a single selection "thumb" between segments over ~120ms if design wants (not drawn) |

---

## 7. Component tokens (tier 3, top of `.ds-toggle-group`)

```css
--toggle-group-bg: var(--color-bg-surface);
--toggle-group-border: var(--color-border);
--toggle-group-segment-bg: transparent;
--toggle-group-segment-bg-selected: var(--color-bg-control);
--toggle-group-fg: var(--color-text);
--toggle-group-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.3 */
```

---

## 8. Open questions / feedback for design

1. **The selected segment doesn't use the accent.** The switch's on track and the radio's
   selected circle are now `button-bg-primary`; here the selected segment is a darker
   `button-bg-outline` (#181818) on the #383838 trough. Intentional (a quieter mode picker), or
   should it match the other "on" states?
2. **Only two segments are drawn.** The editor uses up to six. Please draw a 3+ example.
3. **What happens when segments don't fit** (§4.3): truncate, or wrap to more rows?
4. **The label is not a text property**, and **it wraps instead of truncating** (§3.2).
5. **Smaller type than the other controls**: segments use 12px `label/label` while buttons,
   switch and radio rows use 14px `body/body-secondary`. Intended?
6. **Naming.** "Chip - Segmented Control" vs the planned `toggle-group` molecule; `Selected?` is
   the axis name here and on the radio, `Active?` on the switch.
7. **Radii aren't concentric**: trough 8px with a 5px inset needs a 3px inner radius to look
   parallel; segments are 4px. Minor; build as drawn.
8. **No focus, disabled or motion states.** Proposals in §6.
9. **Segment height 28px** is fine for target size (≥ 24px), but six segments in a 320px column
   gives ~46px wide segments; check that labels survive.

---

## 9. Suggested code API

```ts
export interface ToggleGroupOption {
	value: string;
	label: string;
	title?: string;       // tooltip, e.g. a shortcut hint
	disabled?: boolean;
}

export interface ToggleGroupOptions {
	name: string;         // radio name, unique per control
	label: string;        // aria-label of the radiogroup
	options: ToggleGroupOption[];   // 2 or more
	value: string;        // selected option (a segmented control always has one)
	onChange?: (value: string) => void;
}

export function toggleGroup(options: ToggleGroupOptions): { root: HTMLElement };
export function setValue(root: HTMLElement, value: string): void;
export function setOptionDisabled(root: HTMLElement, value: string, disabled: boolean): void;
```

### Acceptance checks

- Trough is 38px tall with the border inside; segments 28px, 5px from every outer edge, 4px apart.
- Segments share the width equally whatever their labels.
- Selected segment `#181818`, unselected transparent on `#383838`; label `#E7E7E7` 12px in both.
- Hover adds the 10% wash to the hovered segment only; nothing shifts.
- ←/→ move the selection; Tab enters on the selected segment and leaves the control.
- A long label stays on one line with an ellipsis; all segments stay the same height.
- The legacy `.mode-row` markup renders the same as the molecule once `aria-pressed` replaces
  `.active`.
- No hex values in the molecule's CSS.

## 11. Icon variant (update read file version `2416211887664560962`, 2026-10-30)

Both sets gained a **Type** axis: `Text` is everything above; `Icon` (control `264:54225`,
`264:54222`; chips `264:54178`, `264:54180`, `264:54183`, `264:54185`) is a compact control for
two-way toggles such as grid/list. The trough keeps its fill, 1px border and 8px radius but
**hugs** its segments with **2px** padding and a 4px gap (58 × 30 for two segments); each
segment is **24 × 24** with 4px padding and 4px corners, holding a **16px** icon (an instance
swap, `list` `264:54166` and `grid` `264:54167` in the windows) and no label. Selected fill,
hover wash and the rest are as in §4. Used in the three browser windows' toolbars
([texture-browser.md](texture-browser.md) §5).

**Built:** `segmentedControl({ variant: 'icon', options: [{ value, label, icon }] })` sets
`data-variant="icon"`: the trough is `inline-size: auto` with `--space-0-5` padding, segments
are `--segmented-icon-segment-size` (24px) squares with `--space-1` padding showing
`icon(option.icon, { size: 'sm' })`; the label stays in the DOM visually hidden for the radio's
accessible name and is the segment's tooltip. Two new icons, `list` and `grid`, joined the set.
