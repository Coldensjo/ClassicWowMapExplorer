# Slider: build spec

Source: Figma file "Dungeon Builder", component **Slider** (node `8:899`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=8-899>), read on
2026-10-29 (file version `2415918336314448768`).

Unlike the other controls, Slider is a **single component, not a component set**: it has no
variants, so Figma draws **one state only** (rest, value at maximum). It is a labelled field:
a caption above, then a row with the slider track and a numeric **Text Input** (Figma component
`8:987`) showing the value.

Build it as the `slider` part of the `field` molecule DESIGN_SYSTEM.md §5 plans ("`field` with
`slider`, `number-input`, …"): `molecules/slider.css` and `molecules/slider.ts`. The Text Input
is its own component and gets its own spec; this one only covers it as configured inside the
slider (§5).

Conventions match the other specs in this folder ([buttons.md](buttons.md),
[switch.md](switch.md), [radio.md](radio.md), [segmented-control.md](segmented-control.md)):
Figma variable → code token in [tokens/color.css](../tokens/color.css) → value; sizes are **raw
numbers in Figma**; **⚠ Figma issue** marks an inconsistency and says what to build;
**Proposed** marks something not drawn that needs design sign-off (§9).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `content-secondary` | `--color-text-muted` | `#CACACA` | field label (caption above); value suffix ("%") |
| `content-primary` | `--color-text` | `#E7E7E7` | value text in the input |
| `button-border-outline` | `--color-border` | `#646464` | the rail; the input's border |
| `surface-primary` | `--color-bg-surface` | `#383838` | the input's fill |
| *(unbound)* | none | `#D9D9D9` | the thumb: **⚠ Figma issue**, §3.3 |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §7) |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | thumb hover (**Proposed**, §7) |

### 1.2 Type tokens used

| Text | Figma style | Size / weight | Code token |
|---|---|---|---|
| Field label (caption) | `231:39937` `label/label` | 12px / 400 | `--type-label` |
| Value and suffix in the input | `231:39938` `body/body-secondary` | 14px / 400 | `--type-body-secondary` |

Both are Atkinson Hyperlegible Mono, line height "auto" (measured 15.6px and 18.2px), letter
spacing 0. Use `font-variant-numeric: tabular-nums` on the value so it doesn't jitter while
dragging (the face is monospaced already, so this is a safeguard).

### 1.3 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--slider-rail-height` | 4px | rail thickness |
| `--slider-rail-radius` | 9999px | rail ends fully round (Figma 12px on a 4px bar) |
| `--slider-thumb-width` | 16px | thumb width |
| `--slider-thumb-height` | 32px | thumb height |
| `--slider-thumb-radius` | 4px | thumb corners |
| `--slider-row-height` | 40px | the row (matches the input's height) |
| `--slider-row-gap` | 8px | track ↔ input |
| `--slider-label-gap` | 4px | caption ↔ row |
| `--slider-input-width` | 80px | value input width |

---

## 2. Anatomy and layout

```
Label                                          ← caption, 12px, #CACACA          (Show label?)
                                       4px
┌───────────────── track area (fills) ──────────────┐ 8 ┌──── input 80 × 40 ────┐
│                                         ┌──┐      │   │ 100               %   │  (Show value input?)
│ ════════════ rail 4px #646464 ══════════│  │      │   │ #E7E7E7        #CACACA│
│                                         └──┘      │   └───────────────────────┘
└───────────────────────────────────────────────────┘     fill #383838, 1px #646464, r 8
                                    thumb 16 × 32, r 4
```

| Part | Layout |
|---|---|
| Root | vertical stack, gap 4px, width **fills the panel column** (fixed 212px in the drawing) |
| Label | fills the width, left aligned, one line truncated with an ellipsis (§2.1) |
| Row | horizontal, gap 8px, items vertically centred, 40px tall, fills width |
| Track area | fills the remaining width (`flex: 1 1 auto; min-width: 0`), 40px tall |
| Rail | 4px tall, fills the track area's width, vertically centred |
| Thumb | 16 × 32px, vertically centred on the rail; horizontal position from the value (§3.2) |
| Input | fixed 80 × 40px, `flex: none` |

Total height with label: 16 + 4 + 40 = **60px**; without: 40px.

### 2.1 Label sizing (decided)

The label **fills the component's width and truncates at one line** (design decision,
2026-10-29): `width: 100%; min-width: 0; white-space: nowrap; overflow: hidden;
text-overflow: ellipsis`, with `title` set to the full text when it truncates. In Figma it is
still a fixed 218px inside the 212px component, set to wrap; ignore that.

---

## 3. Track and thumb

### 3.1 Rail

| Property | Value |
|---|---|
| Height | 4px |
| Fill | `button-border-outline` → `--color-border` `#646464` |
| Radius | fully round |
| Border / shadow | none |
| Filled ("progress") part | **none drawn**: the rail is one colour on both sides of the thumb. See §9.2 |

### 3.2 Thumb position

The thumb is inside a slot that spans the rail exactly; in the drawing it is pinned to the
**right** edge, i.e. the value is at its maximum (the input shows "100 %"). So the thumb
**stays within the rail's ends**: at the minimum its left edge meets the rail's left end, at the
maximum its right edge meets the right end. Its centre travels from 8px to `width − 8px`:

```
thumbLeft = (value − min) / (max − min) × (trackWidth − 16px)
```

This is what a styled native `<input type="range">` does by default, so no extra maths is
needed when building on it (§6).

### 3.3 Thumb visual

| Property | Value |
|---|---|
| Size | 16 × 32px (a tall rounded bar, not a circle) |
| Radius | 4px |
| Fill | `#D9D9D9`, **unbound**: **⚠ Figma issue** |
| Border / shadow | none |

The thumb has the same unbound `#D9D9D9` as the switch's off knob and the radio's old dot,
which design resolved to `content-primary`. **Build it with `--color-text` (`#E7E7E7`) via
`--slider-thumb`** for consistency, and bind it in Figma (§9.1).

### 3.4 Figma slots

The component defines **three slot properties**, `Slider`, `Slider2` and `Slider3`, but only
`Slider` is placed (it holds the thumb). `Slider2` and `Slider3` are **leftovers** (design
confirmed, 2026-10-29): ignore them. Build a single thumb; there is no range (two-thumb) slider.

---

## 4. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Show label?` | boolean | `true` | `label?: string`: caption shown when given. The control always needs an accessible name; when hidden, pass it as `aria-label` |
| `Show value input?` | boolean | `true` | `showInput?: boolean`, default `true` |
| `Slider` (slot) | slot | thumb | not a prop: the thumb is built in |
| `Slider2`, `Slider3` (slots) | slot | empty | leftovers, not built (§3.4) |
| (none) | | | `value: number` (required) |
| (none) | | | `min: number`, `max: number`, `step: number` (defaults 0, 100, 1) |
| (none) | | | `suffix?: string` (e.g. "%", "yd"); `prefix?` exists on Text Input but is hidden here |
| (none) | | | `format?: (v: number) => string` for the input's displayed value |
| (none) | | | `onInput(value)` while dragging; `onChange(value)` on release / commit |
| (none) | | | `disabled?: boolean` (**Proposed**) |

---

## 5. The value input (Text Input `8:987`, as used here)

Configured on the instance: `Value` "100", `Suffix` "%" shown, label, prefix, leading icon and
supporting text **all hidden**, `State` Rest, `hasValue?` True.

| Part | Value |
|---|---|
| Box | 80 × 40px; fill `surface-primary` → `--color-bg-surface` `#383838`; 1px border `--color-border` `#646464` inside; radius **8px** |
| Padding | 10px top/bottom, 12px left/right |
| Gap | 8px between value and suffix |
| Value | `--type-body-secondary` 14px, `--color-text` `#E7E7E7`, left aligned, fills, one line with ellipsis |
| Suffix | `--type-body-secondary` 14px, `--color-text-muted` `#CACACA`, hugs |

Behaviour (**Proposed**; Figma has no interaction):
- Editable: typing a number and pressing Enter or leaving the field commits it, clamped to
  `min`/`max` and rounded to `step`, then the thumb moves.
- Invalid input (empty, not a number) reverts to the current value on blur.
- ↑/↓ in the field step by `step` (native `<input type="number">` behaviour); Shift+↑/↓ by
  10 × step.
- Dragging the thumb updates the field live.
- Hide the native number spinners; the suffix is a separate element, not part of the value.

Reuse the Text Input molecule once it exists rather than restyling an input here.

---

## 6. Markup and behaviour

Build the track on a native range input so keyboard, pointer, touch and accessibility come free:

```html
<div class="ds-slider">
	<label class="ds-slider-label" for="brush-radius">Radius</label>
	<div class="ds-slider-row">
		<input class="ds-slider-range" type="range" id="brush-radius" min="1" max="100" step="1" value="40">
		<div class="ds-text-input ds-slider-input">
			<input type="number" min="1" max="100" step="1" value="40" aria-label="Radius value">
			<span class="ds-text-input-suffix" aria-hidden="true">%</span>
		</div>
	</div>
</div>
```

- Style the rail with `::-webkit-slider-runnable-track` / `::-moz-range-track` and the thumb with
  `::-webkit-slider-thumb` / `::-moz-range-thumb` (`appearance: none` on the input and the thumb).
  Make the input itself 40px tall (the row height) and transparent, so the hit area is the full
  row height even though the rail is 4px.
- Keyboard (native): ←/↓ decrease and →/↑ increase by `step`; PageUp/PageDown by a larger amount
  (browser default 10%); Home/End jump to min/max.
- `aria-valuetext` should include the unit when there is one (e.g. "40 %"), set by the factory.
- The two inputs stay in sync: range `input` event → update the number field; number field
  commit → set the range value. The molecule keeps no model state; it reports through
  `onInput`/`onChange` and exposes `setValue(root, v)`.

**Migrating existing markup.** `index.html` has 16 sliders written as
`<label class="prop-row">Radius <input type="range" id="brush-radius" …><output id="brush-radius-out"></output></label>`,
with a read-only `<output>` instead of an editable field and the label inline to the left
rather than above. **All 16 move to the Figma layout** (design decision, 2026-10-29): label
above, editable value input beside the track. Each `.prop-row` slider is replaced by the
`slider()` factory (or equivalent `.ds-slider` markup), keeping its `id`, `min`, `max`, `step`
and `title`, and the panel code that read the `<output>` switches to the factory's
`onInput`/`onChange` and `setValue`. Until a panel is migrated, listing
`.prop-row input[type="range"]` beside `.ds-slider-range` (DESIGN_SYSTEM.md §5's legacy-selector
rule) gives its track and thumb the new look; remove that selector once all 16 are migrated.

---

## 7. States not drawn in Figma (Proposed)

Figma draws only rest. Proposed, reusing the system's existing treatments:

| State | Selector | Treatment |
|---|---|---|
| Thumb hover | `.ds-slider-range:hover::…-thumb` | `interaction-hover` wash over the thumb (barely visible on a light thumb); or `cursor: grab` only |
| Dragging | `:active` | `cursor: grabbing`; no visual change |
| Focus-visible | `.ds-slider-range:focus-visible::…-thumb` | 1px solid `--color-focus` outline, offset 2px, radius 4 |
| Input focus | Text Input's own focus state (its spec) | |
| Disabled | `:disabled` | whole field `opacity: var(--opacity-disabled)` (0.3, as radio.md §1.3), no hover, `cursor: not-allowed`; the number field disabled too |

---

## 8. Component tokens (tier 3, top of `.ds-slider`)

```css
--slider-rail: var(--color-border);
--slider-thumb: var(--color-text);        /* Figma: unbound #D9D9D9, §3.3 */
--slider-label-fg: var(--color-text-muted);
--slider-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.3; the input uses the Text Input molecule's own tokens */
```

---

## 9. Open questions / feedback for design

1. **Thumb is `#D9D9D9`, unbound.** Spec uses `content-primary`, as decided for the switch knob
   and radio dot. Please bind it.
2. **No filled track.** The rail is the same `#646464` on both sides of the thumb, so the value
   reads only from the thumb's position. Most sliders fill the part below the thumb (here that
   would be `button-bg-primary`, matching the on states). Intended?
3. ~~**Three slot properties, one used.**~~ Decided: `Slider2`/`Slider3` are leftovers (§3.4);
   they can be deleted from the Figma component.
4. **No states at all.** Slider is a plain component, not a set: no hover, focus, dragging or
   disabled. Proposals in §7.
5. ~~**Label is 218px in a 212px component** and can wrap.~~ Decided: fills the width and
   truncates at one line (§2.1). The Figma label should be set to Fill and 1 line too.
6. **Label colour** is `content-secondary` (#CACACA), while the switch and radio row labels are
   `content-primary`. Fine for a caption above a field, but confirm it's deliberate.
7. **Value input radius 8px** vs 4px on buttons and segments; same 8px as the segmented trough.
   Confirm the input radius in the Text Input spec.
8. **Thumb shape**: a 16 × 32 bar taller than the 4px rail and nearly as tall as the 40px input.
   Fine, just unusual; confirm it isn't a placeholder.
9. ~~**Existing panels show the label inline.**~~ Decided: all 16 sliders move to the Figma
   layout, label above and value editable (§6).
10. **Discrete stops** (§11) are built but not drawn: please draw the ticks and labels, or say
    how a stepped slider should look.

---

## 11. Discrete stops (Proposed, not drawn)

Added 2026-10-29 at the product's request: a slider whose thumb snaps to a **fixed set of
stops** rather than any value on the rail, for settings like quality levels, brush shapes or a
handful of named sizes. Figma draws only the continuous slider; this section proposes the
variant and needs design sign-off (§9.10).

| Property | Value (**Proposed**) |
|---|---|
| Stops | `stops`: a count of evenly spaced stops between `min` and `max`, or the stop values themselves, each with an optional label |
| Ticks | one per stop behind the rail: 2 × 8px, fully round, `--color-border` (the rail's colour), centred on the rail so it shows 2px above and below; positioned where the thumb's centre rests at that stop (half a thumb in from each rail end) |
| Labels | when stops have them: `label/label-small` (10px) in `content-secondary` under the ticks, centred on each, the first and last flush with the rail's ends; the row grows by the label line |
| Thumb | as §3.3, snapping to the nearest stop while dragging |
| Value field | numeric stops: as §5, typing commits to the **nearest stop**, ↑/↓ move one stop. Labelled stops: shows the current stop's **label**, read-only, no suffix |
| Keyboard | ←/→ ↑/↓ move one stop; Home/End to the first and last (native, since the range runs over the stop indexes) |
| Screen reader | the value text is the stop's label, or its value with the unit |
| Tokens | `--slider-stop`, `--slider-stop-width`, `--slider-stop-height`, `--slider-stop-label-fg` (tier 3) |

```
Quality
 ┃━━━━━━┃━━━━━━┃━━━━━━┃━━━━━━┃      ┌───────────┐
 Low           ┣━━━━━━━━━━━━┫      │ Medium    │   read-only, shows the label
 Low    Medium  High  Ultra  Max   └───────────┘
```

Open questions for design (also §9.10): tick colour and size (the rail colour keeps them
quiet; `content-secondary` would make them read as a scale), whether labels belong under the
rail or only in the field, and whether a stop that the value is on should look different.

---

## 10. Suggested code API

```ts
export interface SliderOptions {
	label?: string;                 // caption above; also the accessible name
	ariaLabel?: string;             // required when label is omitted
	value: number;
	min?: number;                   // default 0
	max?: number;                   // default 100
	step?: number;                  // default 1
	stops?: number | SliderStop[];  // discrete stops (§11); SliderStop = number | { value; label? }
	suffix?: string;                // shown in the value input, e.g. "%"
	format?: (value: number) => string;
	showInput?: boolean;            // default true ("Show value input?")
	disabled?: boolean;
	title?: string;                 // tooltip, e.g. the existing "[ and ] change it too" hints
	onInput?: (value: number) => void;    // while dragging / typing
	onChange?: (value: number) => void;   // on release / commit
}

export function slider(options: SliderOptions): { root: HTMLElement; range: HTMLInputElement };
export function setValue(root: HTMLElement, value: number): void;
```

### Acceptance checks

- Root is 60px tall with a label (16 + 4 + 40), 40px without; it fills its column.
- Rail 4px, centred in the 40px track; thumb 16 × 32, centred on the rail.
- At `min` the thumb's left edge meets the rail's left end; at `max` its right edge meets the
  right end.
- The whole 40px row height grabs the thumb, not just the 4px rail.
- Dragging updates the number field live; typing a number and pressing Enter moves the thumb,
  clamped and stepped.
- Arrow keys, PageUp/PageDown, Home/End work on the slider; the screen reader reads the value
  with its unit.
- Long labels fill the width and stay on one line with an ellipsis.
- All 16 existing sliders render with the label above and an editable value, and the panels
  still update their models from them.
- No hex values in `slider.css`.

## 12. Small size (update read file version `2416211887664560962`, 2026-10-30)

The set gained a **Size** axis next to Type: `Small` (`264:51927` continuous, `264:51935` fixed
step) is a **30px** row: the 4px rail as before, a **16 × 16** knob with 4px corners instead of
the 16 × 32 one, and the value field the small text input ([text-input.md](text-input.md) §10)
at the same 80px width, 8px from the rail. The label above is unchanged, so the component is
50px tall with it. The browser windows' tile-size sliders use it, labelless and without the
value field, between the minus and plus buttons.

**Built:** `slider({ size: 'sm' })` sets `data-size="sm"` on the `.ds-slider`; the field rule
makes the row and the value box 30px, and `slider.css` sets `--slider-thumb-height` to 16px.
