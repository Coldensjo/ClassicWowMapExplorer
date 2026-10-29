# Dropdown select: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Controls**, read on
2026-10-29 (file version `2415918336314448768`):

| # | Figma component | Node | What it is | Variant axes |
|---|---|---|---|---|
| 1 | Dropdown | `7:750` | the labelled trigger, with the menu when open | `Open?` False/True × `State` Rest/Hover/Disabled |
| 2 | Dropdown Menu | `34:13458` (section `243:49521`) | the floating panel; an `Options` slot | none |
| 3 | Dropdown Menu Option - Selection | `34:13463` | an option that can be the selected value | `Selected?` False/True × `State` Rest/Hover |
| 4 | Dropdown Menu Option - Interactive | `7:765` | an action item (no selection), optionally destructive | `Type` Default/Destructive × `State` Rest/Hover |

The **Dropdown** is a select: it shows the current value ("No weather") and opens a menu of
**Selection** options. The **Interactive** options belong to *action* menus (e.g. a "more" ⋯
menu with "Delete" in red) that reuse the same panel; they are specced here (§6) because they
share the component, but they are a different control (`role="menu"`, not a select).

Build:
- `molecules/select.{css,ts}`: trigger (§3) + listbox popup (§4, §5);
- `molecules/menu.{css,ts}`: the panel (§4) + action items (§6), opened from any button.

The closed trigger reuses the label and field box of [text-input.md](text-input.md); read that
first. Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§10).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `content-secondary` | `--color-text-muted` | `#CACACA` | trigger label |
| `content-primary` | `--color-text` | `#E7E7E7` | trigger value; chevron; option text; checkmark; **open trigger border** (§3.4) |
| `surface-primary` | `--color-bg-surface` | `#383838` | trigger fill; **menu border** |
| `button-border-outline` | `--color-border` | `#646464` | trigger border (closed) |
| `surface-transparent-primary` | `--color-bg-panel` | `#181818` @ 85% | menu fill |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | trigger hover; option hover |
| `button-bg-destructive` | `--color-danger` | `#F45060` | destructive action text |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | trigger focus (**Proposed**, §3.4) |

### 1.2 Type tokens used

| Text | Figma style | Code token |
|---|---|---|
| Trigger label | `231:39937` `label/label`, 12px / 400 | `--type-label` |
| Trigger value; option text | `231:39938` `body/body-secondary`, 14px / 400 | `--type-body-secondary` |
| **Selected** option text | `234:39944` `body/body-secondary-bold`, 14px / **600 SemiBold** | `--type-body-secondary-bold` |

### 1.3 Effects

The menu has a **background blur of 24px** (Figma effect style `7:760`): build as
`backdrop-filter: blur(24px)` (with `-webkit-` prefix), so the 85% panel fill frosts what is
behind it. No drop shadow is drawn. Add a `--blur-panel: 24px` token (proposed for
`tokens/layout.css`), since panels elsewhere in the file likely use the same style.

### 1.4 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--menu-padding` | 12px | panel padding |
| `--menu-gap` | **4px** | between options (decided 2026-10-29; Figma still draws 12px) |
| `--menu-radius` | 8px | panel corners |
| `--menu-offset` | 4px | gap between trigger and panel |
| `--menu-option-height` | 26px | option block size |
| `--menu-option-padding` | 4px | option padding |
| `--menu-option-radius` | 4px | option corners (§5.3) |
| `--menu-option-gap` | 10px | option text ↔ checkmark |

The trigger uses the `--field-*` tokens from text-input.md §1.3.

---

## 2. Anatomy

```
Weather effects                         ← label, 12px #CACACA                     (Show label?)
                              4px
┌──────────────────────────────────┐
│ No weather                    ⌃  │    ← trigger: field box 40px, #383838, 1px #646464 (open: #E7E7E7), r 8
└──────────────────────────────────┘      value 14px #E7E7E7, chevron 16px (`down` closed, `up` open)
                              4px
┌──────────────────────────────────┐
│ ┌──────────────────────────────┐ │    ← menu: #181818@85% + blur 24, 1px #383838, r 8, padding 12
│ │ Option                       │ │       option 26px, padding 4
│ └──────────────────────────────┘ │
│               4px                │
│ ┌──────────────────────────────┐ │
│ │ Selected option (600)     ✓  │ │       selected: SemiBold + 16px checkmark
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

---

## 3. Dropdown trigger (`7:750`)

### 3.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Label` | text | "Weather effects" | `label?: string` |
| `Show label?` | boolean | `true` | shown when `label` is given; else `ariaLabel` required |
| `Value` | text | "No weather" | derived: the selected option's label |
| `Open?` | variant | `False` | internal state, not a prop |
| `State` | variant | `Rest` | `Hover` `:hover`; `Disabled` `disabled: boolean` |
| (none) | | | `options: { value; label; disabled? }[]`, `value: string`, `onChange(value)` |
| (none) | | | `placeholder?: string` (when nothing is selected; **Proposed**) |

### 3.2 Layout

Same as the text input (text-input.md §2): root vertical stack, gap 4, **fills its column**
(218px in the drawing); label one line with an ellipsis; field 40px, padding 10 × 12, gap 8,
radius 8, 1px border inside.

Inside the field: **value** (fills, one line, ellipsis) then **chevron** (16px,
`--icon-size-sm`, `flex: none`, colour `currentColor` = `--color-text`): the **`down`** icon
(Figma `7:743`) when closed and the **`up`** icon (Figma `18:5683`) when open (design decision,
2026-10-29; Figma's Open variants still show `down`). Swap the icon on `aria-expanded`; no
rotation animation is specified.

### 3.3 Visual spec by state

| State | Fill | Border | Overlay | Chevron | Opacity |
|---|---|---|---|---|---|
| Closed · Rest | `#383838` `--color-bg-surface` | 1px `#646464` `--color-border` | none | `down` | 1 |
| Closed · Hover | same | same | `interaction-hover` wash over the field | `down` | 1 |
| Closed · Disabled | same | same | none | `down` | **0.3**, whole component |
| Open · Rest | same | **1px `#E7E7E7`** (§3.4) | none | **`up`** | 1 |
| Open · Hover | same | 1px `#E7E7E7` | wash | **`up`** | 1 |

### 3.4 Open border and focus

When open, the trigger border is `content-primary` `#E7E7E7`, the same look as a focused text
input. There is **no separate Focused variant**. **Build:** the trigger shows the `#E7E7E7`
border both when open (`[aria-expanded="true"]`) and when keyboard-focused (`:focus-visible`),
using `--color-focus` (`button-border-outline-focus`, same value) rather than `content-primary`,
for the same reason as text-input.md §4.2. Rebind in Figma (§10.1).

---

## 4. Menu panel (`34:13458`)

| Property | Value |
|---|---|
| Position | absolutely positioned **4px below** the trigger field, left edges aligned |
| Width | **same as the trigger** (218px in the drawing); `min-width: 100%` of the trigger, may grow for long options (**Proposed**) |
| Height | hugs its options; **Proposed** `max-height` ~8 options (8 × 26 + 7 × 4 + 24 = 260px), then scrolls with the Scrollbar component |
| Fill | `surface-transparent-primary` → `--color-bg-panel` (`#181818` @ 85%) |
| Border | 1px `surface-primary` → `--color-bg-surface` `#383838`, inside |
| Radius | 8px |
| Padding | 12px |
| Gap | **4px** between options (design decision, 2026-10-29; Figma draws 12px) |
| Effect | background blur 24px (§1.3); no shadow |
| Layering | above panels and the 3D view: a `--z-popover` token (DESIGN_SYSTEM.md's `--z-*` scale) |
| Slot | `Options`; accepts only the two option components (Figma "preferred values only"), each stretched to full width |

**Proposed:** if there isn't room below (near the bottom of the viewport or a panel), flip it to
open **above** the trigger, 4px away. Render it in a top-layer container (the Popover API, or a
portal at the end of `<body>`) so a panel's `overflow: hidden` never clips it.

---

## 5. Selection option (`34:13463`), used by the select

### 5.1 Layout

| Property | Value |
|---|---|
| Size | fills the panel's content width; **26px** tall (fixed) |
| Padding | 4px all sides |
| Content | text (fills, one line, ellipsis) then, when selected, a 16px `checkmark` icon (Figma `35:13490`), gap 10px |
| Alignment | vertically centred; text left aligned |

### 5.2 States

| State | Text | Checkmark | Overlay |
|---|---|---|---|
| Unselected · Rest | 14px / 400 `--color-text` | none | none |
| Unselected · Hover | same | none | `interaction-hover` wash, radius 4 |
| Selected · Rest | **14px / 600** `--type-body-secondary-bold`, `--color-text` | 16px, `--color-text` | none |
| Selected · Hover | same | same | wash, radius 4 |

"Hover" also means **keyboard-active** (the option the arrow keys are on: `aria-activedescendant`
or roving focus), so keyboard users see the same wash.

### 5.3 ⚠ Figma issue: option radius

Selection options have **no radius at rest and 4px on hover**; Interactive options are **2px at
rest and 4px on hover**. Only the hover wash is visible, so build **4px always**
(`--menu-option-radius`).

---

## 6. Interactive option (`7:765`), used by action menus

| Property | Value |
|---|---|
| Layout | as §5.1, without a checkmark |
| Default text | 14px / 400 `--color-text` |
| Destructive text | 14px / 400 `button-bg-destructive` → `--color-danger` `#F45060` |
| Hover | `interaction-hover` wash, radius 4, for both types (destructive text stays red) |

Behaviour: activating an item runs its action and closes the menu. Destructive items need no
confirmation inside the menu itself; confirm in a Dialog if the action can't be undone (the
caller decides).

---

## 7. Behaviour and markup

### 7.1 Why not a native `<select>`

A native `<select>` can style its closed box but not its popup (no blur, checkmark or SemiBold
selected option on most platforms). **Build a custom select** following the WAI-ARIA
"select-only combobox" pattern. If a later browser baseline supports fully customizable native
selects in every target browser, the same CSS can move onto `<select>`.

```html
<div class="ds-select">
	<span class="ds-select-label" id="weather-label">Weather effects</span>
	<button class="ds-select-trigger" type="button" role="combobox"
		aria-labelledby="weather-label weather-value" aria-haspopup="listbox"
		aria-expanded="false" aria-controls="weather-list">
		<span class="ds-select-value" id="weather-value">No weather</span>
		<svg class="ds-icon" aria-hidden="true">…down…</svg>
	</button>
	<ul class="ds-menu" id="weather-list" role="listbox" aria-labelledby="weather-label" hidden>
		<li class="ds-menu-option" role="option" id="weather-none" aria-selected="true">No weather <svg …checkmark…></svg></li>
		<li class="ds-menu-option" role="option" id="weather-rain" aria-selected="false">Rain</li>
	</ul>
</div>
```

### 7.2 Keyboard and pointer (select)

| Input | Closed | Open |
|---|---|---|
| Click trigger | open, active = selected option | close |
| Enter / Space / ↓ / ↑ | open (↑ opens on the last option) | Enter/Space: select active, close |
| ↓ / ↑ | | move active option (skip disabled) |
| Home / End | | first / last option |
| Type a character | open and jump to the next option starting with it (typeahead) | jump |
| Escape | | close without changing; focus back to trigger |
| Tab | | close without changing the value, move focus on |
| Click option | | select, close, focus back to trigger |
| Click outside | | close without changing |

The selected option is scrolled into view on open. `onChange` fires only when the value changes.

### 7.3 Action menu (`role="menu"`)

Opened from a button with `aria-haspopup="menu"`; items are `role="menuitem"`. ↓/↑ move,
Enter/Space activate, Escape closes. Same panel, same item styling.

### 7.4 State ownership

Neither molecule owns the model: the select takes `value` and reports `onChange`; it exposes
`setValue(root, v)` and `setOptions(root, options)`.

### 7.5 Migrating existing markup

`index.html` has **35 `<select>` elements** (e.g. `#brush-falloff` with Linear / Smooth / Flat).
Two steps:

1. Immediately: per DESIGN_SYSTEM.md §5, style `.prop-row select` like the closed trigger
   (field box, chevron via a background SVG, `appearance: none`). The popup stays native.
2. Per panel: replace each `<select>` with `select()`, keeping its `id` and options; panel code
   that listened for `change` on the `<select>` uses `onChange` instead.

---

## 8. States not drawn in Figma (Proposed)

| State | Treatment |
|---|---|
| Trigger focus-visible (closed) | `#E7E7E7` border, as open (§3.4) |
| Disabled option | text at `opacity: var(--opacity-disabled)` (0.3), not selectable, skipped by arrows |
| Empty value | `placeholder` text in the field's placeholder colour (text-input.md §4.3) |
| Open animation | none drawn; fade + 4px slide over ~100ms, none under reduced motion |
| Group headings / dividers in the menu | not drawn; don't add until designed |

---

## 9. Component tokens

```css
/* .ds-select trigger: --field-* from text-input.md, plus */
--select-border-open: var(--color-focus);

/* .ds-menu */
--menu-bg: var(--color-bg-panel);
--menu-border: var(--color-bg-surface);
--menu-blur: var(--blur-panel);           /* 24px */
--menu-option-fg: var(--color-text);
--menu-option-fg-danger: var(--color-danger);
--menu-option-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.4 */
```

---

## 10. Open questions / feedback for design

1. **Open border token.** The open trigger border is bound to `content-primary`; the stepper's
   focus border is bound to `button-border-outline-focus`. Same colour; please bind to the focus
   variable. There is also no Focused (keyboard) state; spec uses the open look.
2. **Option radius** varies: 0 or 2px at rest, 4px on hover (§5.3). Spec builds 4px.
3. ~~**The chevron doesn't change when open.**~~ Decided: `up` when open (§3.2). Update the
   Figma Open variants to match.
4. **No max height / scrolling** for long lists; spec proposes ~8 options then scroll.
5. ~~**12px between options.**~~ Decided: 4px (§4). Update the Dropdown Menu's Options slot
   spacing in Figma to match.
6. **Menu border `#383838`** on an 85% `#181818` panel, plus blur, but **no shadow**: over the 3D
   view the edge may disappear. Consider a shadow.
7. **No disabled option, placeholder or group heading** designs.
8. **The `Value` text is a free text property**; in code it is always the selected option's
   label.
9. **Selected weight 600** vs the regular 400 elsewhere: fine, just confirming the checkmark plus
   weight change is the intended double signal.

---

## 11. Suggested code API

```ts
export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectOptions {
	label?: string;
	ariaLabel?: string;              // required when label is omitted
	options: SelectOption[];
	value: string | null;
	placeholder?: string;
	disabled?: boolean;
	title?: string;
	onChange?: (value: string) => void;
}

export function select(options: SelectOptions): { root: HTMLElement; trigger: HTMLButtonElement };
export function setValue(root: HTMLElement, value: string | null): void;
export function setOptions(root: HTMLElement, options: SelectOption[]): void;

export interface MenuItem { label: string; destructive?: boolean; disabled?: boolean; onSelect: () => void }
export function menu(anchor: HTMLElement, items: MenuItem[]): { open(): void; close(): void };
```

### Acceptance checks

- Closed trigger matches the text input box: 40px, `#383838`, 1px `#646464`, radius 8; value 14px; chevron 16px.
- Opening turns the border `#E7E7E7`, swaps the chevron from `down` to `up`, and shows the panel 4px below, same width, with blur and the `#383838` border.
- Options are 26px tall, 4px apart; hover and arrow-key focus show the same 4px-radius wash.
- The selected option is SemiBold with a trailing checkmark, and is scrolled into view on open.
- Keyboard: Enter/Space/↓ opens; arrows move; typeahead jumps; Enter selects; Escape and Tab close without changing.
- Clicking outside closes; the menu is never clipped by a scrolling panel.
- Destructive action items are `#F45060`; activating any action item closes the menu.
- Disabled trigger renders at 30% and doesn't open.
- No hex values in `select.css` or `menu.css`.
