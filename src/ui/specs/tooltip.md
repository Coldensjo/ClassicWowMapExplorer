# Tooltips: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, read on
2026-10-30 (file version `2415936091135390495`):

| # | Figma component set | Node | What it is |
|---|---|---|---|
| 1 | Tooltip - Simple | `44:4881` | a one-line label on dark, with an optional keyboard shortcut |
| 2 | Tooltip - Complex | `44:4946` | a wrapping explanation on the accent colour, with an optional extra-content slot |

Both have `Nubbin orientation` Up / Down / Left / Right: the small triangle that points at the
anchor. **"Up" means the nubbin is on the top edge**, so the tooltip sits **below** its anchor.

Build `molecules/tooltip.{css,ts}` with `data-variant="simple" | "complex"`. The Key Command it
contains is specced in [key-command.md](key-command.md).

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `button-bg-outline` | `--color-bg-control` | `#181818` | **Simple** body and nubbin (opaque) |
| `button-bg-primary` | `--color-accent` | `#006FB4` | **Complex** body and nubbin |
| `content-primary` | `--color-text` | `#E7E7E7` | text in both |

Type, both: Figma `231:39937` `label/label`, 12px / 400 → **`--type-label`**.

## 2. Tooltip - Simple

| Part | Value |
|---|---|
| Body | fill `#181818`, radius **2px**, padding 4 × 8, horizontal, gap 6, items centred, hugs (70 × 24 with "Tooltip") |
| Text | 12px `#E7E7E7`, **one line**, ellipsis, hugs |
| Hotkey | `Show hotkey?` (default off): a **Small** Key Command after the text |
| Nubbin | 10 × 4px triangle (4 × 10 for Left/Right), `#181818`, centred on its edge, touching the body |
| Size with nubbin | 70 × 28 (Up/Down) or 74 × 24 (Left/Right) |

## 3. Tooltip - Complex

| Part | Value |
|---|---|
| Body | fill `#006FB4`, radius **14px**, padding 12, vertical, gap 6, items centred; **width 203px**, min 148, max 280 |
| Text | 12px `#E7E7E7`, left aligned, **wraps** (no line limit) |
| Extra content | `Show more info?` (default off) shows the `Additional Information` slot below the text (any content, stretched to the body width) |
| Nubbin | as Simple, in `#006FB4` |

**Build** the body width as `inline-size: max-content; min-inline-size: 148px;
max-inline-size: 280px` so short text gives a narrow tooltip and long text wraps at 280; Figma
fixes 203px only for the drawing.

## 4. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Nubbin orientation` | variant | `Up` | `placement: 'top' \| 'bottom' \| 'left' \| 'right'`: **where the tooltip sits** relative to the anchor (Up nubbin = `bottom`), auto-flipped to fit (§5) |
| `Show hotkey?` (Simple) | boolean | `false` | `shortcut?: string` |
| `Show more info?` + slot (Complex) | boolean + slot | `false` | `content?: Node` |
| (none) | | | `text: string` (required) |

**⚠ Figma issue.** The tooltip text ("Tooltip", "Example text goes here.") is **not a text
property** in either component.

## 5. Behaviour

- **Positioning:** 4px from the anchor edge to the nubbin tip (**Proposed**; not drawn), centred
  on the anchor; the nubbin stays pointing at the anchor's centre even if the body is shifted to
  stay on screen. Flip to the opposite side when there's no room. Render in the top layer (Popover
  API or a portal) so panels never clip it.
- **Simple** (labels and shortcuts for icon buttons, mode chips, swatches):
  - shows on hover after **~500ms**, immediately when moving between neighbouring tooltipped
    controls, and on keyboard focus; hides on pointer leave, blur or Escape;
  - `role="tooltip"`, linked with `aria-describedby` from the anchor (for icon-only buttons the
    accessible name stays the button's `aria-label`; the tooltip repeats it visually);
  - never interactive; never holds information that isn't also available another way.
- **Complex** (explanations, e.g. the radio row's info button): opens on **click** of an info
  button (and on focus + Enter), stays until clicked outside or Escape; if the slot holds
  interactive content, it is a non-modal dialog (`role="dialog"`), not a tooltip.
- Replaces the `title` attribute tooltips the editor uses today, once the molecule exists.

## 6. Component tokens

```css
--tooltip-bg: var(--color-bg-control);        /* simple */
--tooltip-bg-complex: var(--color-accent);
--tooltip-fg: var(--color-text);
--tooltip-radius: 2px;                         /* simple */
--tooltip-radius-complex: 14px;
--tooltip-nubbin: 10px 4px;                    /* base, height */
--tooltip-offset: 4px;
```

## 7. Open questions / feedback for design

1. **Text isn't a property** in either tooltip.
2. **Two very different looks**: Simple is dark and nearly square (2px), Complex is blue and
   round (14px; 12px elsewhere on toasts, tiles and the mode bar). Intended? Should Complex be 12px?
3. **Contrast**: 12px `#E7E7E7` on `#006FB4` is about 4.4:1, just under WCAG AA 4.5:1 for normal
   text (same as the Primary button and the toast).
4. **Simple tooltip is opaque `#181818`** while panels are 85% with blur; fine for legibility, just
   confirming.
5. **No offset, delay or max width for Simple** is drawn; spec proposes 4px, ~500ms, and one line.
6. **Orientation naming**: the variant names the nubbin side, the code names the tooltip side;
   consider renaming the Figma variant "Placement" to avoid flipped meanings.

### Acceptance checks

- Simple: `#181818`, radius 2, 4 × 8 padding, 12px `#E7E7E7` one line, optional small keycap 6px after, 10 × 4 nubbin pointing at the anchor.
- Complex: `#006FB4`, radius 14, padding 12, 148–280px wide, wrapping text, optional extra content 6px below.
- Tooltips flip to stay on screen, are never clipped, show on focus as well as hover, and close on Escape.
- No hex values in `tooltip.css`.
