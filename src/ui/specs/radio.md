# Radio components: build spec

Source: Figma file "Dungeon Builder", section **Radio** (node `243:49519`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=243-49519>), read on
2026-10-29 (file version `2415918336314448768`). The section holds two component sets:

| # | Figma component set | Node | What it is | Variant axes |
|---|---|---|---|---|
| 1 | Radio Control | `8:1214` | the bare 24px circle | `Selected?` False/True × `State` Rest/Hover/Disabled |
| 2 | Radio Group | `234:40361` | one labelled option row: circle, label, optional info button | `State` Rest/Disabled × `Selected?` True/False, plus `Show info button?` |

Build them as one `radio` molecule (DESIGN_SYSTEM.md §5): `molecules/radio.css` and
`molecules/radio.ts`. Despite its name, Figma's "Radio Group" is **one option**; a real group is
several of those rows stacked in a container that code adds (§4).

Conventions match [buttons.md](buttons.md) and [switch.md](switch.md): each colour names its
Figma variable, the code token in [tokens/color.css](../tokens/color.css) and the resolved value;
sizes are **raw numbers in Figma**; **⚠ Figma issue** marks an inconsistency and says what to
build; **Proposed** marks something not drawn that needs design sign-off (§7).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `surface-primary` | `--color-bg-surface` | `#383838` | circle fill, selected **and** unselected |
| `button-border-outline` | `--color-border` | `#646464` | circle border |
| *(unbound)* | none | `#D9D9D9` | selected dot: **⚠ Figma issue**, §2.4 |
| `content-primary` | `--color-text` | `#E7E7E7` | option label; info icon stroke (via the Ghost button) |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §6) |

The accent (`button-bg-primary`) is **not** used: a selected radio is shown only by its dot.
See §7.2.

### 1.2 Type token used

The option label uses the same text style as the buttons and switch row (Figma style
`231:39938`, `body/body-secondary`): Atkinson Hyperlegible Mono, 400 Regular, 14px, line height
"auto" (measured 18.2px), letter spacing 0. Code token: **`--type-body-secondary`**.

### 1.3 Disabled treatment

This is the first component in the file with a drawn **Disabled** state: every part is set to
**30% layer opacity** (`opacity: 0.3`), nothing else changes. Use a shared token for it,
`--opacity-disabled: 0.3` (proposed for `tokens/layout.css`), so the buttons and switch, whose
specs only propose a disabled look, can use the same value.

### 1.4 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--radio-size` | 24px | circle diameter |
| `--radio-dot-size` | 12px | selected dot diameter |
| `--radio-border-width` | 1px | circle border |
| `--radio-row-gap` | 8px | gap between circle, label and info button |
| `--opacity-disabled` | 0.3 | §1.3 |

---

## 2. Radio Control (`8:1214`)

### 2.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected?` | variant | `False` | `checked: boolean`, default `false` |
| `State` | variant | `Rest` | `Hover` is `:hover`; `Disabled` is `disabled: boolean` |
| (none) | | | `name: string`, `value: string` (native radio group wiring) |
| (none) | | | `label: string`: accessible name when used without the row |

### 2.2 Anatomy

```
 ┌──────────── 24 ────────────┐
 │  ╭──────────────────────╮  │   circle: 24 × 24, fully round, 1px border inside
 │  │      ╭────────╮      │  │   dot:    12 × 12, fully round, centred (6px from each edge)
 │  │      │  dot   │      │  │           only when selected
 │  │      ╰────────╯      │  │
 │  ╰──────────────────────╯  │
 └────────────────────────────┘
```

- **Circle**: 24 × 24px, corner radius 24px (build `border-radius: 50%`), fill
  `--color-bg-surface`, 1px border `--color-border` drawn **inside** (`box-sizing: border-box`),
  clips its content. Figma gives it auto-layout padding 4px, which has no visible effect
  (the dot is absolutely positioned); ignore it.
- **Dot**: 12 × 12px circle, centred both ways (Figma constraints centre/centre): 6px from the
  outer edge, so 5px of fill shows between border and dot.

### 2.3 Visual spec by state

| State | Circle fill | Border | Dot | Overlay | Opacity |
|---|---|---|---|---|---|
| Unselected · Rest | `#383838` `--color-bg-surface` | 1px `#646464` `--color-border` | none | none | 1 |
| Unselected · Hover | same | same | none | `interaction-hover` wash over the whole circle | 1 |
| Unselected · Disabled | same | same | none | none | **0.3** |
| Selected · Rest | same | same | 12px `#D9D9D9` (§2.4) | none | 1 |
| Selected · Hover | same | same | same | wash over circle **and** dot | 1 |
| Selected · Disabled | same | same | same | none | **0.3** |

### 2.4 ⚠ Figma issue: dot colour

As with the switch's off knob, the dot is `#D9D9D9` with **no variable bound**. Build it with
`--radio-dot: var(--color-text)` (`content-primary`, `#E7E7E7`), the same light value the
switch's *on* knob uses, since a selected radio is the "on" state; confirm with design (§7.1).

### 2.5 Hover

Hover = Rest + a "Hover State" rectangle covering the whole control (left-right/top-bottom
constraints), fill `interaction-hover` (`#E7E7E7` @ 10%), clipped to the circle. It is the top
layer, so it sits over the dot too; the result over a light dot is invisible. Build as a
background layer on the circle:

```css
.ds-radio:hover .ds-radio-circle {
	background-image: linear-gradient(var(--radio-hover-wash), var(--radio-hover-wash));
}
```

No hover when disabled (Figma has no Disabled + Hover variant). Inside a row (§3), hovering
anywhere on the row shows the circle's hover.

### 2.6 Motion (Proposed)

None in Figma. Proposed: the dot scales in from 0 to 1 over ~100ms ease-out when selected;
none under `prefers-reduced-motion: reduce`.

---

## 3. Radio Group, i.e. one option row (`234:40361`)

### 3.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected?` | variant | **`True`** | `checked: boolean`, default `false` in code (an unset option must not claim to be chosen) |
| `State` | variant | `Rest` | `Disabled` is `disabled: boolean`; no Hover variant (see §3.4) |
| `Show info button?` | boolean | `false` | `info?: { label: string; onClick(): void }`: shows the button when given |
| (none) | | | `label: string` (required): default text in Figma "Raise/lower" |
| (none) | | | `value: string` |

**⚠ Figma issues.**
- The label text is **not a text property** (same as the switch row and the Outline button).
- `Selected?` defaults to True here but False on Radio Control.
- The axis order differs: `State, Selected?` here, `Selected?, State` on the control.

### 3.2 Anatomy and layout

`[ circle 24 ] —8— [ label ] —8— [ info button 24 (optional) ]`

| Property | Value |
|---|---|
| Direction | horizontal (`display: flex`) |
| Width | fixed **267.25px** in Figma: **⚠ Figma issue** (fractional, and narrower than the switch row's 320px). Build `width: 100%` of the panel column |
| Height | hugs: 24px |
| Padding | 0 |
| Gap | 8px |
| Cross-axis | vertically centred |
| Circle | fixed 24 × 24, `flex: none` |
| Label | **hugs its text** (Figma "Hug"), single line, truncation "ending" set |
| Info button | directly after the label (not pushed to the right edge), `flex: none` |

Label sizing: Figma sets the label to Hug width *and* to truncate with an ellipsis, which can't
happen in a hug box (it never runs out of room; it would overflow the row instead). **Build**
`flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`,
so the label hugs short text, keeps the info button next to it, and truncates only when the row
runs out of space.

### 3.3 Info button

An instance of **Button - Icon – Ghost** (see buttons.md §7) at **X-Small** (24 × 24, 4px
padding, 4px radius, no fill) showing the **`help`** icon (Figma component `17:4854`) at 16px in
`--color-text`. It has the Ghost button's own hover wash. In the file the instance overrides the
icon's stroke weight (the override value isn't exposed by the API); build with the system's
`--icon-stroke-width` (1px), as for every other icon.

It is a **separate control**: clicking it must not select the option. Render it as a sibling
`<button type="button">` outside the `<label>` (§5), with `aria-label` e.g. "About Raise/lower".
It opens whatever help the caller supplies (tooltip/popover is out of scope for this molecule).

### 3.4 States

| State | Circle | Label | Info button |
|---|---|---|---|
| Rest · Selected | Selected · Rest (§2.3) | `--color-text`, opacity 1 | Ghost Rest |
| Rest · Unselected | Unselected · Rest | same | same |
| Hover (not drawn) | circle hover wash when the pointer is anywhere on the label/circle area; **Proposed** | unchanged | its own Ghost hover, only when it is hovered |
| Disabled · Selected | Selected · Disabled (opacity 0.3) | opacity 0.3 | opacity 0.3, not interactive |
| Disabled · Unselected | Unselected · Disabled (opacity 0.3) | opacity 0.3 | opacity 0.3, not interactive |

In code, apply `opacity: var(--opacity-disabled)` once on the row rather than on each part;
the result is the same because nothing in the row overlaps. Whether the info button should stay
usable when the option is disabled (help is often still useful) is a question for design (§7.6);
Figma dims it.

---

## 4. The group (code only, not in Figma)

Figma has no container for several options. Code needs one for semantics and keyboard:

| Property | Value |
|---|---|
| Element | `<fieldset class="ds-radio-group">` with a `<legend>` (or `role="radiogroup"` + `aria-labelledby` pointing at a panel heading) |
| Direction | vertical stack |
| Gap between options | **Proposed** 8px (matches the row's inner gap; not specified in Figma) |
| Group label | uses the panel's own heading/label style, not part of this spec |
| Fieldset reset | no border, no padding, no margin; `min-inline-size: 0` |

---

## 5. Markup and behaviour

Build on native radios so arrow-key navigation, single selection and form behaviour come free:

```html
<fieldset class="ds-radio-group">
	<legend class="ds-radio-group-label">Sculpt mode</legend>
	<div class="ds-radio-row">
		<label class="ds-radio">
			<input class="ds-radio-input" type="radio" name="sculpt-mode" value="raise" checked>
			<span class="ds-radio-circle" aria-hidden="true"><span class="ds-radio-dot"></span></span>
			<span class="ds-radio-label">Raise/lower</span>
		</label>
		<button class="ds-icon-button" data-variant="ghost" data-size="xs" type="button" aria-label="About Raise/lower">…help icon…</button>
	</div>
	…
</fieldset>
```

- The `<input>` is visually hidden but focusable (never `display: none`); circle and dot are
  drawn from `:checked`, `:disabled`, `:focus-visible` on it.
- All options in a group share one `name`. Keyboard (native): Tab enters the group on the
  checked option (or the first); ↑/↓/←/→ move **and select**; Space selects the focused one;
  Tab leaves the group. Disabled options are skipped.
- `onChange(value)` fires from the inputs' `change` event; the molecule keeps no state beyond
  the DOM. Provide `setValue(group, value)` and `setDisabled(row, on)` setters.
- Target size: row and circle are 24px, which meets WCAG 2.2 AA (24px minimum).
- The info button is a sibling of the `<label>`, never inside it, so its click doesn't select.

---

## 6. States not drawn in Figma (Proposed)

| State | Selector | Proposed treatment |
|---|---|---|
| Focus-visible | `.ds-radio-input:focus-visible + .ds-radio-circle` | 1px solid `--color-focus` outline, offset 2px, round |
| Row hover | `.ds-radio:hover .ds-radio-circle` | circle hover wash (§2.5) |
| Pressed | `:active` | none needed |
| Error / required | n/a | not supported until design draws one |

---

## 7. Open questions / feedback for design

1. **The dot is `#D9D9D9`, unbound**, same as the switch's off knob. Bind it; spec uses
   `content-primary` (`#E7E7E7`).
2. **Selected radios don't use the accent**, while an on switch fills with
   `button-bg-primary`. Mixed in one panel, "on" will look different between the two
   controls. Intended? If not, the selected circle could take the accent fill or border.
3. **"Radio Group" is one option.** Consider "Radio Option" / "Radio Row", and drawing an actual
   group (spacing between options, group label).
4. **Label not a text property**, so it isn't editable per instance.
5. **Row width 267.25px** is fractional and differs from the switch row's 320px.
6. **Should the info button stay active when the option is disabled?** Figma dims it to 30%.
7. **Label is Hug + truncate**, which can't truncate; spec makes it shrinkable.
8. **Defaults and axis order differ** between the control and the row.
9. **No row Hover variant, no focus state.** Proposals in §2.5 and §6.
10. **Disabled = 30% opacity** here. The button and switch specs should use the same value;
    worth making it a variable.

---

## 8. Suggested code API

```ts
export interface RadioOption {
	value: string;
	label: string;
	disabled?: boolean;
	info?: { label: string; onClick: () => void };   // "Show info button?"
}

export interface RadioGroupOptions {
	name: string;
	legend: string;                 // accessible group name (visually hidden if the panel has its own heading)
	options: RadioOption[];
	value?: string;                 // the checked option; none checked when omitted
	onChange?: (value: string) => void;
}

export function radioGroup(options: RadioGroupOptions): { root: HTMLFieldSetElement };
export function setValue(root: HTMLElement, value: string): void;
export function setOptionDisabled(root: HTMLElement, value: string, disabled: boolean): void;
```

### Component tokens (tier 3, top of `.ds-radio`)

```css
--radio-bg: var(--color-bg-surface);
--radio-border: var(--color-border);
--radio-dot: var(--color-text);           /* pending §7.1 */
--radio-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.4 */
```

### Acceptance checks

- Circle 24 × 24 with the border inside; dot 12 × 12, exactly centred.
- Selected and unselected circles have the same fill and border; only the dot differs.
- Clicking the circle or label selects; clicking the info button does not.
- Arrow keys move the selection within a group and skip disabled options.
- Disabled rows render at 30% opacity, show no hover, and can't be selected.
- A long label truncates with an ellipsis and keeps the info button visible.
- No hex values in `radio.css`: every colour is a `var(--color-*)` or `--radio-*` token.
