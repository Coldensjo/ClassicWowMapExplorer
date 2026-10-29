# Mode Controller: build spec

Source: Figma file "Dungeon Builder", section **Mode controller** (node `243:49522`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=243-49522>), read on
2026-10-29 (file version `2415917481068854082`). The section holds eight component sets:

| # | Figma component set | Node | Icon (Figma id) | Label |
|---|---|---|---|---|
| 1 | Chip - Environment | `7:422` | `sun` (`29:7373`) | Environment |
| 2 | Chip - Sculpt | `7:428` | `sculpt` (`6:24`) | Sculpt |
| 3 | Chip - Paint | `7:434` | `paint` (`6:27`) | Paint |
| 4 | Chip - Water v2 | `7:440` | `water` (`6:22`) | Water |
| 5 | Chip - Hole | `7:446` | `hole` (`6:25`) | Holes |
| 6 | Chip - Object | `7:452` | `container` (`6:26`) | Objects |
| 7 | Chip - NPCs | `29:7388` | `npc` (`29:7414`) | NPCs |
| 8 | Mode Controller | `7:470` | the bar holding all seven chips | `Mode` = Environment / Sculpt / Paint / Water / Holes / Objects / NPC |

Each chip set has `Selected?` True/False × `State` Rest/Hover. The **Mode Controller** is the
editor's main tool switcher: a floating bar of seven chips, exactly one selected. Unselected
chips show only their icon; the selected chip **expands** to show its label and **inverts**
(light fill, dark content).

Build one `mode-controller` molecule (`molecules/mode-controller.{css,ts}`) with a single
generic chip part. The seven Figma chip sets are the same component with a different icon and
label; don't build seven.

Conventions match the other specs in this folder: Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; sizes are **raw numbers in Figma**;
**⚠ Figma issue** marks an inconsistency and says what to build; **Proposed** marks something
not drawn that needs design sign-off (§9).

---

## 1. Shared foundations

### 1.1 Colour tokens used

| Figma variable | Code token (tier 2) | Value | Used for |
|---|---|---|---|
| `surface-transparent-primary` | `--color-bg-panel` | `#181818` @ 85% | bar fill |
| `content-primary` | `--color-text` | `#E7E7E7` | **selected** chip fill; unselected icon stroke (§1.4) |
| `button-bg-outline` | `--color-bg-control` | `#181818` | **selected** chip icon and label |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash |
| `button-border-outline-focus` | `--color-focus` | `#E7E7E7` | focus ring (**Proposed**, §7) |

### 1.2 Type token used

Selected chip label: Figma style `234:39943`, Atkinson Hyperlegible Mono **Bold 700, 16px**,
line height "auto" (measured 20.8px), letter spacing 0. That is Figma's
`body/body-primary-bold`; code token **`--type-body-bold`**
(`var(--font-weight-bold) var(--font-size-lg) / var(--line-height-normal) var(--font-family-ui)`).
It is the largest, heaviest text of any control so far.

### 1.3 Effects

The bar has a **background blur of 8px** (`backdrop-filter: blur(8px)`). The dropdown menu
blurs 24px; see §9.4.

### 1.4 ⚠ Figma issue: unbound icon colour

In **unselected** chips the icon stroke is a raw `#E7E7E7` override with **no variable bound**
(selected chips bind theirs to `button-bg-outline`). Build unselected icons with `currentColor`
= `--color-text` (`content-primary`, the same value) and bind it in Figma (§9.1).

### 1.5 Proposed tokens for raw values

| Token | Value | Meaning |
|---|---|---|
| `--mode-bar-padding` | 8px | bar padding |
| `--mode-bar-gap` | 12px | between chips |
| `--mode-bar-radius` | 12px | bar corners |
| `--mode-bar-blur` | 8px | bar backdrop blur |
| `--mode-chip-size` | 40px | chip height; unselected chip width |
| `--mode-chip-padding` | 8px | chip padding (8px 10px 8px 8px when selected, §3.2) |
| `--mode-chip-gap` | 4px | icon ↔ label |
| `--mode-chip-radius` | 8px | chip corners |
| `--mode-chip-icon-stroke` | 2px | selected icon stroke (§3.4) |

---

## 2. Anatomy and layout

```
┌──────────────────────────────────────────────────────────────────────────┐  bar: #181818@85%, blur 8, r 12
│ ┌────┐ ┌────────────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                 │  padding 8, gap 12
│ │ ☀ │ │ ⛰  Sculpt  │ │ 🖌 │ │ ≈  │ │ ◯  │ │ ▢  │ │ ☺  │                 │  height 56
│ └────┘ └────────────┘ └────┘ └────┘ └────┘ └────┘ └────┘                 │
└──────────────────────────────────────────────────────────────────────────┘
 40×40   selected: #E7E7E7 fill, dark icon + 16px Bold label, hugs width
```

| Part | Layout |
|---|---|
| Bar | horizontal, padding 8, gap 12, items vertically centred, **hugs** its chips (435 × 56 with Sculpt selected), radius 12 |
| Unselected chip | 40 × 40, padding 8, radius 8, icon only, clips content |
| Selected chip | 40px tall, padding 8 / 10 / 8 / 8, gap 4, icon then label, **hugs** its width (Sculpt 107px, Environment 162px), radius 8 |
| Icon | 24px (`--icon-size-lg`), `flex: none` |
| Label | hugs, one line, no wrap |

Chip order is fixed: **Environment, Sculpt, Paint, Water, Holes, Objects, NPCs**.

Because the bar hugs and the selected chip shows its label, **the bar's width changes when the
mode changes** (e.g. 435px with Sculpt, wider with Environment). See §9.3.

---

## 3. Chip

### 3.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Selected?` | variant | `False` | derived: the chip whose `mode` equals the controller's value |
| `State` | variant | `Rest` | `Hover` is `:hover` |
| (set name) | | | `mode: ModeId`, `icon: IconName`, `label: string`, `shortcut?: string` |

The icon and label are fixed per chip set in Figma (not properties), which is right for this
control.

### 3.2 ⚠ Figma issues in chip spacing

The selected chips don't agree:

| Chip | Gap icon ↔ label | Right padding | Width |
|---|---|---|---|
| Environment | **8px** | 10px | hug |
| Sculpt, Paint, Objects | 4px | 10px | hug |
| Water | 4px | 10px | **fixed** 97px |
| Holes, NPCs | 4px | **8px** | hug |

**Build** gap 4px, padding 8px 10px 8px 8px, width hugs, for every chip (the majority). The
extra 2px on the right balances the label's side bearing against the icon on the left.

### 3.3 Visual spec by state

| State | Fill | Icon | Label | Overlay |
|---|---|---|---|---|
| Unselected · Rest | none (the bar shows) | 24px, stroke **1px** `#E7E7E7` `--color-text` | hidden | none |
| Unselected · Hover | none | same | hidden | `interaction-hover` wash (`#E7E7E7` @ 10%), radius 8 |
| Selected · Rest | `content-primary` → `--color-text` `#E7E7E7` | 24px, stroke **2px** `button-bg-outline` → `--color-bg-control` `#181818` | 16px Bold `#181818`, `--type-body-bold` | none |
| Selected · Hover | `#E7E7E7` | same | same | wash, drawn but **invisible** (§3.5) |

### 3.4 Icon stroke weight

Selected icons override the stroke to **2px**; unselected keep the drawing's 1px. This is a
deliberate weight change (heavier on the light fill), so build it with a chip-level override,
`--icon-stroke-width: var(--mode-chip-icon-stroke)` on the selected chip, not by changing the
global token. All seven icons are drawn on the 24px grid with round caps/joins, so 2px renders
cleanly.

### 3.5 Hover on the selected chip

The hover wash is 10% `#E7E7E7` over a `#E7E7E7` fill, so it changes nothing. Clicking the
selected chip also does nothing. **Build** no hover on the selected chip and `cursor: default`;
see §9.2.

---

## 4. Mode Controller bar (`7:470`)

### 4.1 Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Mode` | variant | `Environment` | `value: ModeId` (required) |
| (none) | | | `onChange(mode)` |
| (none) | | | `modes?: ModeId[]`: which chips to show (default all seven, in order) |
| (none) | | | `disabledModes?: ModeId[]` (**Proposed**) |

`ModeId` = `'environment' | 'sculpt' | 'paint' | 'water' | 'holes' | 'objects' | 'npcs'`.

### 4.2 Visual

| Property | Value |
|---|---|
| Fill | `surface-transparent-primary` → `--color-bg-panel` (`#181818` @ 85%) |
| Border | none |
| Radius | 12px |
| Padding | 8px |
| Gap | 12px |
| Effect | background blur 8px; no shadow |
| Placement | floating over the 3D view (in Figma it sits in the "Bottom Controls" frame above a grab bar and the tool panel); the molecule doesn't position itself, the editor layout does |

### 4.3 Motion (Proposed)

Not drawn. When the mode changes, the old chip collapses to 40px and the new one expands; if
animated, animate `width` (or a `grid-template-columns` trick) over ~150ms ease-out, label
fading in after the expansion; none under `prefers-reduced-motion`.

---

## 5. Behaviour and markup

A single-select control whose options switch the editor's tool: a **radio group** semantically,
like the segmented control.

```html
<div class="ds-mode-controller" role="radiogroup" aria-label="Editor mode">
	<label class="ds-mode-chip" title="Environment">
		<input class="ds-mode-chip-input" type="radio" name="editor-mode" value="environment">
		<svg class="ds-icon" aria-hidden="true">…sun…</svg>
		<span class="ds-mode-chip-label">Environment</span>
	</label>
	<label class="ds-mode-chip" title="Sculpt the ground (1)">
		<input class="ds-mode-chip-input" type="radio" name="editor-mode" value="sculpt" checked>
		<svg class="ds-icon" aria-hidden="true">…sculpt…</svg>
		<span class="ds-mode-chip-label">Sculpt</span>
	</label>
	…
</div>
```

- The label text is **always in the DOM** and is the accessible name; unselected chips hide it
  visually (`.ds-mode-chip:not(:has(:checked)) .ds-mode-chip-label` gets the visually-hidden
  pattern, not `display: none`, so screen readers still read "Sculpt").
- Unselected chips need a tooltip with the name and shortcut (the existing buttons' `title`s, e.g.
  "Sculpt the ground (1)"), since they show only an icon. Use the file's **Tooltip - Simple**
  component when it is specced; `title` until then.
- Keyboard (native radios): Tab enters on the selected chip; ←/→ move **and switch mode**; Tab
  leaves. The editor's number-key shortcuts (1–6 today) call `setValue` and work from anywhere.
- `onChange(mode)` fires from the inputs' `change` event; the editor owns the current mode and
  calls `setValue(root, mode)` when it changes elsewhere (shortcut, undo).

### 5.1 Relation to the existing tool rail

`index.html` has `#tool-rail`: a **vertical** `role="toolbar"` of text buttons (Sculpt, Paint,
Holes, Water, Place, NPCs, and a hidden Revert), with shortcuts 1–6. The Mode Controller
replaces it, with these differences the editor code must absorb:

| | Tool rail today | Mode Controller |
|---|---|---|
| Orientation | vertical, left | horizontal bar |
| Modes | 6 (+ Revert) | 7: adds **Environment** |
| Order | Sculpt, Paint, **Holes, Water**, Place, NPCs | Environment, Sculpt, Paint, **Water, Holes**, Objects, NPCs |
| Names | "Place" | "Objects" |
| Revert | a hidden tool button | not in the controller; see §9.5 |
| Semantics | toolbar of buttons | radio group |

Keep the `tool-*` ids' behaviour (panel switching in `src/editor/editorPanels.ts`) and map
`objects` ↔ the existing `place` tool. Shortcut numbers should follow the new order once design
confirms it (§9.6).

---

## 6. Component tokens (tier 3, top of `.ds-mode-controller`)

```css
--mode-bar-bg: var(--color-bg-panel);
--mode-chip-fg: var(--color-text);              /* unselected icon */
--mode-chip-bg-selected: var(--color-text);
--mode-chip-fg-selected: var(--color-bg-control);
--mode-chip-hover-wash: var(--color-bg-hover);
/* plus the size tokens in §1.5 */
```

---

## 7. States not drawn in Figma (Proposed)

| State | Selector | Treatment |
|---|---|---|
| Focus-visible | `.ds-mode-chip:has(:focus-visible)` | 1px solid `--color-focus` outline, offset 2px, radius 8 (offset so it shows against the light selected fill) |
| Disabled mode | `:has(:disabled)` | chip at `opacity: var(--opacity-disabled)` (0.3), no hover, skipped by arrow keys |
| Pressed | `:active` on an unselected chip | none needed (it becomes selected) |

---

## 8. Acceptance checks

- Bar is 56px tall, radius 12, 8px padding, 12px between chips, translucent `#181818` with an 8px backdrop blur.
- Unselected chips are 40 × 40 with a 24px, 1px-stroke `#E7E7E7` icon and no fill.
- The selected chip is `#E7E7E7` with a 2px-stroke `#181818` icon and a 16px Bold `#181818` label, padding 8/10/8/8, gap 4.
- Every chip uses the same spacing (no 8px gap on Environment, no fixed width on Water).
- Hovering an unselected chip shows the wash; hovering the selected chip shows nothing.
- ←/→ switch modes; number shortcuts switch modes from anywhere; the screen reader reads each chip's name even when its label is hidden.
- Unselected chips show a tooltip with name and shortcut.
- The editor's tool panel follows the controller (including Objects = the old Place tool).
- No hex values in `mode-controller.css`.

---

## 9. Open questions / feedback for design

1. **Unselected icon colour is unbound** (`#E7E7E7` override). Bind it to `content-primary`.
2. **Selected chip hover is invisible** (10% light wash on a light fill). Drop it, or should the
   selected chip have a hover (e.g. 10% dark wash)?
3. **The bar changes width when the mode changes**, since the selected chip shows its label
   (Environment is ~55px wider than Sculpt). If the bar is centred, the chips will shift under
   the pointer. Keep it, pin the bar's left edge, or reserve the widest label's width?
4. **Blur differs**: 8px here, 24px on the dropdown menu. Should panels share one blur value?
5. **Revert** is a tool in today's rail but not in the controller. Where does it go?
6. **Order and shortcuts.** The controller swaps Water and Holes compared with the current rail
   and adds Environment first. Confirm the order, and whether shortcuts become 1–7 in this order
   (Environment = 1).
7. **Chip spacing inconsistencies** (§3.2): Environment's 8px gap, Water's fixed width, Holes' and
   NPCs' 8px right padding. Please align them.
8. **No focus, disabled or motion states** (§4.3, §7).
9. **Chip names vs labels**: "Chip - Hole" is labelled "Holes", "Chip - Object" "Objects",
   "Chip - Water v2" (is there a v1 to delete?), and the controller variant is "NPC" while the
   label is "NPCs".
