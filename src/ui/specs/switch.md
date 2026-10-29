# Switch components: build spec

Source: Figma file "Dungeon Builder", section **Toggle Switch** (node `243:49517`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=243-49517>), read on
2026-10-29 (file version `2415918336314448768`). The section holds two component sets:

| # | Figma component set | Node | What it is | Variant axes |
|---|---|---|---|---|
| 1 | Toggle Switch | `7:798` | the bare on/off control | `Active?` True/False × `State` Rest/Hover |
| 2 | Toggle Switch Group | `234:40559` | a full-width row: label on the left, switch on the right | `Selected?` True/False |

Build them as one `switch` molecule (DESIGN_SYSTEM.md §5): `molecules/switch.css` and
`molecules/switch.ts`, consuming the tokens in `tokens/`. The row (§3) is the form the editor's
panels will use; the bare switch (§2) is its part and can also be used alone.

Conventions are the same as [buttons.md](buttons.md): each colour names its Figma variable,
the code token in [tokens/color.css](../tokens/color.css) it maps to, and the resolved value.
Sizes and offsets are **raw numbers in Figma** (no variables bound). **⚠ Figma issue** marks an
inconsistency in the file and says what to build; **Proposed** marks something not drawn in
Figma that needs design sign-off (§6).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `button-bg-primary` | `--color-accent` | `#006FB4` | track fill, on |
| `surface-primary` | `--color-bg-surface` | `#383838` | track fill, off |
| `button-border-outline` | `--color-border` | `#646464` | track border, on and off |
| `content-primary` | `--color-text` | `#E7E7E7` | knob fill, on and off (§2.4); row label text |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §5) |

### 1.2 Type token used

Only the row (§3) has text: the label uses the same text style as the buttons (Figma style id
`231:39938`, `body/body-secondary`): Atkinson Hyperlegible Mono, 400 Regular, 14px, line height
Figma "auto" (measured 18.2px), letter spacing 0, no case transform.

Code token: **`--type-body-secondary`**.

### 1.3 Proposed tokens for raw values

Figma binds no variables for size or spacing; `tokens/layout.css` has none yet. Declare these
as component (tier 3) tokens at the top of `.ds-switch`, or promote the spacing ones if
buttons.md §1.4's `--space-*` scale has been added by then:

| Token | Value | Meaning |
|---|---|---|
| `--switch-track-width` | 55px | track width |
| `--switch-track-height` | 23px | track height |
| `--switch-knob-width` | 30px | knob width |
| `--switch-knob-height` | 15px | knob height |
| `--switch-inset` | 4px | gap between knob and track edge, all sides |
| `--switch-border-width` | 1px | track border |
| `--switch-row-gap` | 8px | label ↔ switch in the row |

Derived: the knob travels `55 − 30 − 2 × 4 = 17px`.

---

## 2. Toggle Switch (`7:798`)

### 2.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Active?` | variant | **`True`** | `checked: boolean` (default `false` in code: see note) |
| `State` | variant | `Rest` | not a prop: `Hover` is `:hover` |
| (none) | | | `label: string`: accessible name, required when used without the row |
| (none) | | | `onChange(checked: boolean)` |
| (none) | | | `disabled?: boolean` (**Proposed**) |

Note: Figma's default variant is the on state, which is only the variant shown when an instance
is dropped in. In code, default `checked` to `false` so an unset switch never claims a setting
is on; callers pass the model's value.

### 2.2 Anatomy

```
┌───────────────────────────────────────────────┐  track 55 × 23, pill, 1px border inside
│ 4 ┌──────────────────────┐                    │
│   │  knob 30 × 15, pill  │ ← off: left 4      │
│   └──────────────────────┘   on:  left 21     │
└───────────────────────────────────────────────┘
```

- **Track**: 55 × 23px, corner radius 24px (fully rounded: build with `--radius-full` /
  `border-radius: 9999px`), 1px border drawn **inside** the box (`box-sizing: border-box`), clips
  its content.
- **Knob**: 30 × 15px, corner radius 24px (fully rounded). It is a **pill, not a circle**, which
  is unusual for a switch; build as drawn. Positioned absolutely, 4px from the top of the track
  (vertically centred: 4 + 15 + 4 = 23), and 4px from the left (off) or right (on) edge.

The 4px inset is measured from the track's outer edge, so it includes the 1px border (3px of
fill shows between border and knob).

### 2.3 Visual spec by state

| | Off (`Active?=False`) | On (`Active?=True`) |
|---|---|---|
| Track fill | `surface-primary` → `--color-bg-surface` `#383838` | `button-bg-primary` → `--color-accent` `#006FB4` |
| Track border | 1px `button-border-outline` → `--color-border` `#646464` | same |
| Knob fill | `content-primary` → `--color-text` `#E7E7E7` (§2.4) | `content-primary` → `--color-text` `#E7E7E7` |
| Knob position | `left: 4px` (x 4) | `left: 21px` (x 21, i.e. `right: 4px`) |
| Shadow / effects | none | none |

### 2.4 Knob colour (decided)

The knob is `content-primary` → `--color-text` (`#E7E7E7`) in **both** states; only the track
fill and the knob's position change between off and on. In the Figma file read on 2026-10-29 the
off knob was still an unbound `#D9D9D9`; design has decided it takes `content-primary`, so build
that and ignore the `#D9D9D9`. One component token, `--switch-knob`, serves both states.

### 2.5 Hover

As with every button: Hover = Rest + a rectangle named "Hover State" covering the whole track
(constraints left-right / top-bottom), fill `interaction-hover` (`#E7E7E7` @ 10%), clipped to the
track's rounded shape. It is the **top** layer, so it lies over the knob as well as the track.
Nothing else changes: no knob movement, no colour or border change.

Build it as a background layer on the track so only the track is washed, and let the knob show
through unchanged (a 10% `#E7E7E7` wash over a `#E7E7E7` knob is invisible anyway):

```css
.ds-switch:hover .ds-switch-track {
	background-image: linear-gradient(var(--switch-hover-wash), var(--switch-hover-wash));
}
/* --switch-hover-wash defaults to var(--color-bg-hover) */
```

Hover applies to both off and on. When the switch is inside a row (§3), hovering **anywhere on
the row** should show the switch's hover state, since the whole row toggles it.

### 2.6 Motion (Proposed)

Figma has no prototype interaction between the variants. Proposed: the knob slides between its
two positions (`transform: translateX(17px)`, not a change of `left`) and the track fill
cross-fades, both over ~120ms ease-out; with `prefers-reduced-motion: reduce`, no transition.

---

## 3. Toggle Switch Group (`234:40559`)

A labelled setting row: "Fog ······· [switch]". Despite the name it holds **one** switch; it is
not a group of several.

### 3.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected?` | variant | `True` | `checked: boolean` (default `false`, as §2.1) |
| (none) | | | `label: string` (required): the visible text, default in Figma "Fog" |
| (none) | | | `onChange(checked: boolean)` |
| (none) | | | `disabled?: boolean` (**Proposed**) |

**⚠ Figma issues.**
- The label text is **not bound to a text property**, so in Figma the text can only be changed
  by overriding the layer. Code takes it as `label`.
- The axis is named `Selected?` here but `Active?` on the switch. They mean the same thing;
  code uses `checked` for both.
- The row has **no Hover variant**; it inherits nothing from the switch's Hover. §2.5 specifies
  row hover.

### 3.2 Layout

| Property | Value |
|---|---|
| Direction | horizontal (`display: flex`) |
| Width | fixed 320px in Figma. In code: `width: 100%` of the panel column (the 320 is the panel's content width) |
| Height | hugs content: 23px (the switch's height) |
| Padding | 0 |
| Gap | 8px between label and switch |
| Cross-axis | items vertically centred |
| Label | fills remaining width (`flex: 1 1 auto; min-width: 0`) |
| Switch | fixed 55 × 23, never shrinks (`flex: none`) |

### 3.3 Label

| Property | Value |
|---|---|
| Colour | `content-primary` → `--color-text` `#E7E7E7` |
| Type | `--type-body-secondary` (14 / 400) |
| Alignment | left |
| Overflow | **single line, truncated with an ellipsis** (Figma: max lines 1, truncation "ending"): `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` |
| Colour change when off | none: the label looks the same in both states |

### 3.4 States

| State | Treatment |
|---|---|
| On (`Selected?=True`) | label + switch On (§2.3) |
| Off (`Selected?=False`) | label + switch Off |
| Hover | switch hover wash (§2.5) when the pointer is anywhere on the row; label unchanged |
| Focus-visible / disabled | **Proposed**: §5 |

---

## 4. Markup and behaviour

Build on a native checkbox so keyboard, form and accessibility behaviour come free, and so the
editor's existing checkbox rows can migrate (`index.html` has ~31 `<input type="checkbox">`, e.g.
`<label class="prop-row"><input type="checkbox" id="place-align"> Align to slope</label>`):

```html
<label class="ds-switch-row">
	<span class="ds-switch-label">Fog</span>
	<span class="ds-switch">
		<input class="ds-switch-input" type="checkbox" role="switch">
		<span class="ds-switch-track" aria-hidden="true"><span class="ds-switch-knob"></span></span>
	</span>
</label>
```

- The `<input>` is visually hidden but stays focusable (clip-path/size-0 pattern, never
  `display: none`); the track and knob are drawn from `:checked`:
  `.ds-switch-input:checked + .ds-switch-track { … on … }`.
- `role="switch"` makes screen readers announce "on/off" instead of "checked/unchecked".
- The `<label>` wrapper makes the whole row a click target and gives the input its accessible
  name. A bare switch (§2) without a row needs `aria-label`.
- Keyboard: Tab focuses; Space toggles (native). Enter does nothing (native checkbox behaviour).
- Fire `onChange` from the input's `change` event. The molecule owns no state beyond the DOM
  input; callers set it with a `setChecked(root, on)` setter (DESIGN_SYSTEM.md §5).
- Minimum target: the row is 23px tall, just under the 24px WCAG 2.2 AA target size; it passes
  via the spacing exception when rows are stacked with ≥ 1px gap, but **Proposed**: give the row
  `min-block-size: 24px` (or panel row spacing) to clear it outright.

---

## 5. States not drawn in Figma (Proposed)

| State | Selector | Proposed treatment |
|---|---|---|
| Focus-visible | `.ds-switch-input:focus-visible + .ds-switch-track` | 1px solid `--color-focus` outline, offset 2px, following the pill shape |
| Disabled | `:disabled` | whole row `opacity: var(--opacity-disabled)` (0.3, as the Radio components draw it: radio.md §1.3), `cursor: not-allowed`, no hover wash |
| Pressed | `:active` | none needed (the toggle itself is the feedback) |
| Mixed / indeterminate | n/a | not supported: a switch is strictly on/off; use a checkbox molecule for mixed |

---

## 6. Open questions / feedback for design

1. ~~**Off knob is `#D9D9D9`, unbound.**~~ Decided: `content-primary` in both states (§2.4).
   Bind the off knob to it in Figma too.
2. **Pill-shaped knob** (30 × 15 on a 55 × 23 track) instead of the usual circle. Intended?
3. **Row label is not a text property**, so it isn't editable per instance.
4. **Axis names differ**: `Active?` on the switch, `Selected?` on the row. Pick one.
5. **The row has no Hover variant**, and the switch's Hover isn't used in it. Spec makes the whole
   row hoverable and clickable.
6. **"Group" is a misnomer**: it is a single labelled row. Consider "Toggle Switch Row" /
   "Switch Field".
7. **No focus, disabled or motion spec.** Proposals in §2.6 and §5; the focus variable exists.
8. **Row height 23px** is 1px under the 24px WCAG target-size minimum.
9. **Border token reuse.** The track border uses `button-border-outline`, a button-named variable
   that no button actually uses (see buttons.md §9.4). Consider a neutral `border-control` name.
10. **No size scale.** There is one size only; fine, but say so if a compact one is planned.

---

## 7. Suggested code API

```ts
export interface SwitchOptions {
	label: string;                         // visible text in a row, aria-label when bare
	checked?: boolean;                     // default false
	disabled?: boolean;
	layout?: 'row' | 'bare';               // default 'row' (Toggle Switch Group); 'bare' = Toggle Switch
	onChange?: (checked: boolean) => void;
}

export function toggleSwitch(options: SwitchOptions): { root: HTMLElement; input: HTMLInputElement };
export function setChecked(root: HTMLElement, on: boolean): void;
```

(`switch` is a reserved word in TS, hence `toggleSwitch`; the files can still be
`molecules/switch.{ts,css}`.) Per DESIGN_SYSTEM.md §5, the layout is `data-layout="row" | "bare"`
and the on state is the input's `:checked`, not a class. The legacy `.prop-row` /
`.scene-check` checkbox rows can be listed in the same selectors once design decides whether
they become switches.

### Component tokens (tier 3, top of `.ds-switch`)

```css
--switch-track-off: var(--color-bg-surface);
--switch-track-on: var(--color-accent);
--switch-border: var(--color-border);
--switch-knob: var(--color-text);
--switch-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.3 */
```

### Acceptance checks

- Track renders 55 × 23 with the border inside; knob 30 × 15 at (4, 4) off and (21, 4) on.
- Clicking the label, the track or anywhere on the row toggles; Space toggles when focused.
- Screen reader announces "Fog, switch, off" / "on".
- Hover anywhere on the row washes the track only; the knob doesn't move or change colour.
- A long label truncates with an ellipsis and never pushes the switch out of the row.
- No hex values in `switch.css`: every colour is a `var(--color-*)` or `--switch-*` token.
