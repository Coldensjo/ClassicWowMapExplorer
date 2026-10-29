# Button components: build spec

Source: Figma file "Dungeon Builder", section **Buttons** (node `39:23665`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=39-23665>), read on
2026-10-29 (file version `2415917042501837782`). Six component sets live in that section:

| # | Figma component set | Node | Kind | Sizes | States in Figma |
|---|---|---|---|---|---|
| 1 | Button - Primary | `34:13092` | text (+ optional icon) | Small, Medium, Large | Rest, Hover |
| 2 | Button - Secondary | `41:24147` | text (+ optional icon) | Small, Medium, Large | Rest, Hover |
| 3 | Button - Outline | `37:15269` | text (+ optional icon) | Small, Medium, Large | Rest, Hover |
| 4 | Button - Icon - Primary | `34:13042` | icon only, circular | Small, Medium, Large | Rest, Hover |
| 5 | Button - Icon - Secondary | `29:7150` | icon only, circular | Small, Medium, Large | Rest, Hover |
| 6 | Button - Icon – Ghost | `41:24267` | icon only, square | X-Small, Small, Medium, Large | Rest, Hover |

Build them as the `button` molecule described in [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) §5: plain
CSS custom properties and a TypeScript factory, consuming the tokens in `tokens/`. Every colour
below is bound to a Figma variable; the spec names the Figma variable, the code token it already
maps to in [tokens/color.css](../tokens/color.css), and the resolved value. Spacing, radii and
sizes are **raw numbers in Figma** (no variables bound); §1.4 proposes tokens for them.

Items marked **⚠ Figma issue** are inconsistencies in the file; the spec says which value to build
and why. Items marked **Proposed** are not drawn in Figma and need design sign-off (see §9).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `button-bg-primary` | `--color-accent` | `#006FB4` | Primary and Icon-Primary fill |
| `button-bg-outline` | `--color-bg-control` | `#181818` | Secondary and Outline fill |
| `surface-transparent-primary` | `--color-bg-panel` | `#181818` @ 85% | Icon-Secondary fill |
| `surface-transparent-inverse` | `--color-bg-inverse` | `#E7E7E7` @ 40% | Outline border |
| `content-primary` | `--color-text` | `#E7E7E7` | Label text and icon stroke, every button |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | Hover wash, every button |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | Focus ring (**Proposed**, token exists, no state drawn) |
| `button-bg-destructive` | `--color-danger` | `#F45060` | Not used by any button yet (see §9) |
| `button-border-outline` | `--color-border` | `#646464` | Not used: the Outline button uses `surface-transparent-inverse` instead (see §9) |

Opacity note: in Figma the translucent values are a solid paint with paint opacity (e.g.
`#E7E7E7`, opacity 0.40), not an alpha colour. The code tokens already express them with
`color-mix(... transparent)`, which renders identically.

### 1.2 Type token used

All text buttons use one text style (Figma style id `231:39938`):

| Property | Value |
|---|---|
| Family | Atkinson Hyperlegible Mono |
| Weight / style | 400 Regular |
| Size | 14px |
| Line height | Figma "auto" (intrinsic), measured 18.2px (130%) |
| Letter spacing | 0 |
| Case | as typed (no transform) |
| Alignment | left within the label box; the label is centred in the button |

Code token: **`--type-body-secondary`** (`font: var(--font-weight-regular) var(--font-size-md) /
var(--line-height-normal) var(--font-family-ui)`), i.e. Figma `body/body-secondary`.

Because `--line-height-normal` is `normal`, the rendered line height depends on the font's
metrics. Do not rely on it to produce the button heights: set the height explicitly (§1.4,
`block-size`) so Small/Medium/Large are exactly 30/38/48px.

### 1.3 Icons

- Use the existing `icon(name, { size })` factory from `icons/index.ts`.
- Text buttons: icon is 16px (`--icon-size-sm`), default glyph `play` (Figma component `29:7282`),
  **hidden by default** (`Show icon?` = false). Sits before the label.
- Icon-only buttons: default glyph `close` (Figma component `17:4853`); size per variant (§5–7).
- Icon stroke colour is `content-primary` → `--color-text`. Set it through `currentColor` (the
  button sets `color: var(--button-fg)`).
- Icons are decorative inside a labelled button (`aria-hidden="true"`); icon-only buttons need
  an accessible name (§8).

Stroke width: the drawings are 24px with a 1px stroke. Figma *scales* the stroke when the icon
is resized, so in the file the 16px icon in text buttons has a 0.67px stroke and the Icon-Primary
/ Icon-Secondary icons have a 2px (24px) or 1.33px (16px) stroke, while Ghost keeps 1px.
**⚠ Figma issue.** Build with the system's `--icon-stroke-width: 1px` everywhere (as icon.css
already does) unless design confirms the heavier 2px stroke on the circular icon buttons is
intended; if it is, add a `--button-icon-stroke` knob for those two components.

### 1.4 Spacing, size and radius (raw in Figma)

Figma binds no variables here. `tokens/layout.css` defines no spacing or radius tokens yet.
Either use the raw values in `button.css` with a comment, or add these (proposed names):

| Proposed token | Value | Used by |
|---|---|---|
| `--space-1` | 4px | Ghost Small/X-Small padding |
| `--space-1-5` | 6px | text-button gap; Small vertical padding |
| `--space-2` | 8px | icon-button Medium/Small padding |
| `--space-2-5` | 10px | Medium vertical padding |
| `--space-3` | 12px | text-button horizontal padding (S/M); icon Large padding |
| `--space-4` | 16px | Large horizontal padding |
| `--radius-sm` | 4px | text buttons, Ghost |
| `--radius-full` | 9999px | circular icon buttons (Figma draws 24px, which is ≥ half of every size) |
| `--button-height-sm/md/lg` | 30 / 38 / 48px | text-button block size |

### 1.5 Layout model (all buttons)

- Horizontal flex (`display: inline-flex`), items centred on both axes.
- Width hugs content (Figma "Hug"). Height hugs content in Figma; build with a fixed
  `block-size` per size so it doesn't drift with font metrics.
- `overflow: hidden` / clipping on: the hover wash is clipped to the corner radius.
- No shadows or other effects on any button.
- Label does not wrap (`white-space: nowrap`).

### 1.6 Hover state (identical mechanism on every button)

In Figma, Hover = Rest + an absolutely positioned rectangle named "Hover State" that fills the
whole button (constraints left-right / top-bottom) with `interaction-hover`
(`#E7E7E7` @ 10%), stacked *above* the fill and the content. Nothing else changes: no change to
fill, border, text, icon, size or radius.

Build it as a layered background so it never covers the content:

```css
.ds-button:hover {
	background-image: linear-gradient(var(--button-hover-wash), var(--button-hover-wash));
}
/* --button-hover-wash defaults to var(--color-bg-hover) */
```

(Visually equivalent to the Figma overlay because the wash is a translucent white over the fill;
a `::after` overlay also works if it gets `pointer-events: none`.)

Apply hover only for `(hover: hover)` pointers if the app needs to avoid sticky hover on touch.
No transition is specified in Figma; **Proposed:** `background-color`/`background-image` change
instantly, or with a short (≤ 100ms) ease if the app has a motion token for it.

---

## 2. Button - Primary (`34:13092`)

The main call to action (e.g. "Save").

### Props (from Figma component properties)

| Figma property | Type | Default | Code prop |
|---|---|---|---|
| `Label` | text | `"Save"` | `label: string` (required) |
| `Show icon?` | boolean | `false` | `icon?: IconName` (icon shown when given) |
| `Icon` | instance swap | `play` | (same `icon` prop) |
| `Size` | variant | `Small` | `size: 'sm' \| 'md' \| 'lg'`, default `'sm'` |
| `State` | variant | `Rest` | not a prop: `Hover` is `:hover` |

### Anatomy

`[ icon 16px (optional) ] —6px— [ label ]`, inside a 4px-radius container.

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | `button-bg-primary` → `--color-accent` `#006FB4` |
| Container | border | none |
| Container | radius | 4px |
| Label | colour | `content-primary` → `--color-text` `#E7E7E7` |
| Label | type | `--type-body-secondary` (14 / 400 / Atkinson Hyperlegible Mono) |
| Icon | size / colour | 16px, `--color-text` |
| Gap | icon ↔ label | 6px |

### Sizes

| Size | Padding (V × H) | Height | Example width ("Save", no icon) |
|---|---|---|---|
| Small (default) | 6 × 12 | 30px | 60px |
| Medium | 10 × 12 | 38px | 60px |
| Large | 15 × 16 | 48px | 68px |

### States

| State | Change from Rest |
|---|---|
| Rest | as above |
| Hover | + `interaction-hover` wash (§1.6): `#E7E7E7` @ 10% over `#006FB4` |
| Focus-visible | **Proposed**: §8 |
| Active / pressed | **Proposed**: §8 |
| Disabled | **Proposed**: §8 |

### Component tokens (tier 3)

```css
--button-bg: var(--color-accent);
--button-fg: var(--color-text);
--button-border: transparent;
```

---

## 3. Button - Secondary (`41:24147`)

A lower-emphasis text button: dark fill, no border.

### Props

Same as Primary: `Label` (default "Save"), `Show icon?` (false), `Icon` (`play`),
`Size` (default `Small`), `State` (Rest/Hover).

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | `button-bg-outline` → `--color-bg-control` `#181818` |
| Container | border | none |
| Container | radius | 4px |
| Label | colour / type | `--color-text` `#E7E7E7`, `--type-body-secondary` |
| Icon | size / colour | 16px, `--color-text` |
| Gap | | 6px |

### Sizes

| Size | Padding (V × H) | Height | Example width |
|---|---|---|---|
| Small (default) | 6 × 12 | 30px | 60px |
| Medium | 10 × 12 | 38px | 60px |
| Large | 16 × 12 | **50px** | 60px |

**⚠ Figma issue.** Secondary Large is 16 × 12 (50px tall), while Primary and Outline Large are
15 × 16 (48px tall). Placed side by side they will not line up. **Build 15 × 16 / 48px** to match
the other text buttons, and confirm with design (§9).

### States

| State | Change from Rest |
|---|---|
| Hover | + `interaction-hover` wash: `#E7E7E7` @ 10% over `#181818` |
| Others | **Proposed**: §8 |

### Component tokens

```css
--button-bg: var(--color-bg-control);
--button-fg: var(--color-text);
--button-border: transparent;
```

---

## 4. Button - Outline (`37:15269`)

Secondary's fill plus a light translucent 1px border.

### Props

| Figma property | Type | Default | Code prop |
|---|---|---|---|
| `Show icon?` | boolean | `false` | `icon?: IconName` |
| `Icon` | instance swap | `play` | (same) |
| `Size` | variant | `Small` | `size` |
| `State` | variant | `Rest` | `:hover` |

**⚠ Figma issue.** Outline has **no `Label` text property**; the "Save" text is not wired to a
prop, so instances can't change it from the properties panel. Build the code component with the
same `label` prop as the others.

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | `button-bg-outline` → `--color-bg-control` `#181818` |
| Container | border | 1px solid `surface-transparent-inverse` → `--color-bg-inverse` (`#E7E7E7` @ 40%) |
| Container | border alignment | **outside** the box in Figma |
| Container | radius | 4px |
| Label | colour / type | `--color-text` `#E7E7E7`, `--type-body-secondary` |
| Icon | size / colour | 16px, `--color-text` |
| Gap | | 6px |

Border alignment: Figma's outside stroke does not change the layout box, so the button occupies
the same 30/38/48px slot as Primary but *paints* 1px beyond it. To keep the three text buttons
the same layout size, draw the border without affecting layout:
`box-shadow: 0 0 0 1px var(--button-border)` (or `outline` + `outline-offset: 0`, but `outline`
is better kept for focus). A regular `border` with padding reduced by 1px is also acceptable
and paints inside; pick one and use it consistently.

Note on the token: the border uses the *surface* token `surface-transparent-inverse`, not
`button-border-outline` (`#646464`), which sounds like the intended one. See §9.

### Sizes

| Size | Padding (V × H) | Height (layout) | Example width |
|---|---|---|---|
| Small (default) | 6 × 12 | 30px (+1px painted border each side) | 60px |
| Medium | 10 × 12 | 38px | 60px |
| Large | 15 × 16 | 48px | 68px |

### States

| State | Change from Rest |
|---|---|
| Hover | + `interaction-hover` wash over the fill; border unchanged |
| Others | **Proposed**: §8 |

**⚠ Figma issue (minor).** Outline variants don't clip content, so the square hover rectangle
pokes past the 4px corners in Figma. Code should clip/round the wash like every other button
(the background-layer approach in §1.6 does this automatically).

### Component tokens

```css
--button-bg: var(--color-bg-control);
--button-fg: var(--color-text);
--button-border: var(--color-bg-inverse);
```

---

## 5. Button - Icon - Primary (`34:13042`)

Circular, accent-filled, icon-only button (e.g. a floating confirm/close action).

### Props

| Figma property | Type | Default | Code prop |
|---|---|---|---|
| `Icon` | instance swap | `close` | `icon: IconName` (required) |
| `Size` | variant | **`Large`** | `size`, default `'lg'` |
| `State` | variant | `Rest` | `:hover` |
| (none) | | | `label: string` (required, becomes `aria-label`) |

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | `button-bg-primary` → `--color-accent` `#006FB4` |
| Container | border | none |
| Container | shape | circle (Figma radius 24px → `--radius-full`) |
| Icon | colour | `content-primary` → `--color-text` `#E7E7E7` |

### Sizes

| Size | Box | Padding | Icon size |
|---|---|---|---|
| Large (default) | 48 × 48 | 12 | 24px (`--icon-size-lg`) |
| Medium | 40 × 40 | 8 | 24px (`--icon-size-lg`) |
| Small | 32 × 32 | 8 | 16px (`--icon-size-sm`) |

### States

| State | Change from Rest |
|---|---|
| Hover | + `interaction-hover` wash, clipped to the circle |
| Others | **Proposed**: §8 |

### Component tokens

```css
--button-bg: var(--color-accent);
--button-fg: var(--color-text);
--button-radius: var(--radius-full);
```

---

## 6. Button - Icon - Secondary (`29:7150`)

Same geometry as Icon-Primary with the translucent panel fill; for icon actions floating over
the 3D view.

### Props

Same as Icon-Primary: `Icon` (default `close`), `Size` (default **Large**), `State`;
plus the required accessible `label`.

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | `surface-transparent-primary` → `--color-bg-panel` (`#181818` @ 85%) |
| Container | border | none |
| Container | shape | circle (`--radius-full`) |
| Icon | colour | `--color-text` `#E7E7E7` |

Because the fill is 85% opaque, the scene behind shows through slightly; no backdrop blur is
specified.

### Sizes

Identical to §5: Large 48 / pad 12 / icon 24, Medium 40 / pad 8 / icon 24, Small 32 / pad 8 /
icon 16.

### States

| State | Change from Rest |
|---|---|
| Hover | + `interaction-hover` wash over the translucent fill |
| Others | **Proposed**: §8 |

### Component tokens

```css
--button-bg: var(--color-bg-panel);
--button-fg: var(--color-text);
--button-radius: var(--radius-full);
```

---

## 7. Button - Icon – Ghost (`41:24267`)

No fill, no border: an icon that gains a wash on hover. For toolbars, panel headers and close
buttons inside panels. (Note the set name uses an en dash: "Icon – Ghost".)

### Props

| Figma property | Type | Default | Code prop |
|---|---|---|---|
| `Icon` | instance swap | `close` | `icon: IconName` (required) |
| `Size` | variant | **`X-Small`** | `size: 'xs' \| 'sm' \| 'md' \| 'lg'`, default `'xs'` |
| `State` | variant | `Rest` | `:hover` |
| (none) | | | `label: string` (required, `aria-label`) |

### Visual spec

| Part | Property | Value / token |
|---|---|---|
| Container | fill | none (`transparent`) |
| Container | border | none |
| Container | radius | 4px (square-ish, unlike the circular icon buttons) |
| Icon | colour | `--color-text` `#E7E7E7` |
| Icon | stroke | 1px at every size (matches `--icon-stroke-width`) |

### Sizes

| Size | Box | Padding | Icon size |
|---|---|---|---|
| Large | 48 × 48 | 12 | 24px |
| Medium | 40 × 40 | 8 | 24px |
| Small | 32 × 32 | 4 | **24px** |
| X-Small (default) | 24 × 24 | 4 | 16px |

**⚠ Figma issue.** Ghost Small puts a 24px icon in a 32px box (padding 4), while the circular
icon buttons' Small puts a 16px icon in a 32px box (padding 8). Build as drawn (each component's
own values) and flag it; if design wants them aligned, Ghost Small should become padding 8 /
icon 16.

### States

| State | Change from Rest |
|---|---|
| Hover | the only visible background: `interaction-hover` (`#E7E7E7` @ 10%) fills the 4px-radius box |
| Others | **Proposed**: §8 |

### Component tokens

```css
--button-bg: transparent;
--button-fg: var(--color-text);
--button-radius: var(--radius-sm);
```

---

## 8. States not drawn in Figma (Proposed)

Figma defines only Rest and Hover. A shippable button also needs the following; these are
proposals that reuse existing tokens, to be confirmed by design.

| State | Selector | Proposed treatment | Basis |
|---|---|---|---|
| Focus-visible | `:focus-visible` | 1px solid `--color-focus` (`button-border-outline-focus`, `#E7E7E7`) outline, offset 2px, following the radius. Hover wash not added. | the focus token exists in Figma but no variant uses it |
| Active / pressed | `:active` | the hover wash, doubled (`#E7E7E7` @ 20%) | no token; add `--color-bg-active` if adopted |
| Toggled on | `[aria-pressed="true"]` | `--color-bg-selected` wash (`selection-overlay`) | DESIGN_SYSTEM.md already plans a pressed state (`setPressed`) for toolbar buttons |
| Disabled | `:disabled` / `[aria-disabled="true"]` | `opacity: var(--opacity-disabled)` (0.3), `cursor: not-allowed`, no hover wash | the Radio components' drawn Disabled state (radio.md §1.3) |

Behaviour and accessibility (all buttons):

- Render a native `<button type="button">`, never a `div`.
- Keyboard: Enter and Space activate (native behaviour). Tab-focusable unless disabled.
- Icon-only buttons (§5–7) require an accessible name: `aria-label` from the `label` prop, and a
  `title` tooltip with the same text is recommended.
- Decorative icons get `aria-hidden="true"`.
- Contrast: `#E7E7E7` on `#006FB4` ≈ 4.4:1, slightly under WCAG AA 4.5:1 for 14px text; on
  `#181818` it's ≈ 14:1. Flag Primary's contrast to design (§9).
- Target size: X-Small Ghost (24px) meets WCAG 2.2 AA's 24px minimum but nothing smaller should
  be added.

---

## 9. Open questions / feedback for design

1. **Missing states.** Only Rest and Hover exist. Focus, pressed, toggled and disabled are
   proposed in §8; please confirm or draw them. The focus token
   (`button-border-outline-focus`) already exists unused.
2. **Secondary Large height** is 50px (padding 16 × 12) vs 48px (15 × 16) for Primary and
   Outline Large. Assumed a mistake; spec builds 48px.
3. **Outline has no `Label` property**, so its text isn't editable per instance.
4. **Outline border token.** It uses `surface-transparent-inverse` (#E7E7E7 @ 40%), not
   `button-border-outline` (#646464), which is otherwise unused. Which is intended?
5. **Naming.** Secondary's fill variable is called `button-bg-outline`; Secondary and Outline
   differ only by the border. Consider renaming to `button-bg-secondary`.
6. **Destructive.** `button-bg-destructive` (#F45060) exists but there is no destructive button.
   Should there be a `Button - Destructive` (same shape as Primary)?
7. **Icon stroke weight.** Icon-Primary/Secondary icons render a 2px (24px) / 1.33px (16px)
   stroke because the instances are scaled; Ghost and the system use 1px. Intended?
8. **Icon padding at Small.** Ghost Small = 24px icon / 4px padding; the circular Small = 16px
   icon / 8px padding.
9. **Defaults differ by set**: text buttons default to Small, circular icon buttons to Large,
   Ghost to X-Small. Fine for Figma, but the code factory should pick one rule (spec follows
   each set's own default).
10. **Primary contrast** is ≈ 4.4:1 (#E7E7E7 on #006FB4), just under AA for 14px regular text.
11. **No spacing/radius variables.** Every padding, gap and radius is a raw number; binding them
    to variables (§1.4) would let code and Figma stay in step.

---

## 10. Suggested code API

```ts
type ButtonVariant = 'primary' | 'secondary' | 'outline';
type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

button(options: {
	label: string;
	variant?: ButtonVariant;        // default 'secondary'? (choose; Figma has no single default)
	size?: 'sm' | 'md' | 'lg';      // default 'sm'
	icon?: IconName;                // leading 16px icon; omitted = no icon
	disabled?: boolean;
	onClick?: (e: MouseEvent) => void;
}): HTMLButtonElement;

iconButton(options: {
	icon: IconName;
	label: string;                  // aria-label + title
	variant?: IconButtonVariant;
	size?: 'xs' | 'sm' | 'md' | 'lg'; // 'xs' only for ghost; default 'lg' (primary/secondary), 'xs' (ghost)
	disabled?: boolean;
	onClick?: (e: MouseEvent) => void;
}): HTMLButtonElement;
```

Class names, following DESIGN_SYSTEM.md's `ds-` prefix: `.ds-button` with modifiers
`.ds-button--primary | --secondary | --outline`, `.ds-button--sm | --md | --lg`; `.ds-icon-button`
with `--primary | --secondary | --ghost` and `--xs | --sm | --md | --lg`. Each modifier only sets
the tier 3 knobs (`--button-bg`, `--button-fg`, `--button-border`, `--button-radius`,
`--button-hover-wash`, padding, height, icon size); the base rule consumes them.

### Acceptance checks

- Each variant × size renders at exactly the box sizes in §2–7 (measure with devtools).
- Hover adds only the 10% white wash; nothing shifts by a pixel.
- Outline's border does not change its layout size versus Primary at the same size.
- Icon-only buttons expose an accessible name; Tab shows a visible focus ring.
- No hex values in `button.css`: every colour is a `var(--color-*)` or `--button-*` token.
