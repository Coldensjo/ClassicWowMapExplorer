# Colour input: build spec (proposed)

**Not drawn in Figma.** Added 2026-11-05 for the Environment panel's sky colour (the first free
colour in the app; the swatch picker offers a fixed set). Everything here is **Proposed** and
needs design sign-off; the molecule is built so a drawn version can replace its styles without
changing its API.

Build `molecules/color-input.{css,ts}`.

## 1. What it is

A full-width row, the switch row's layout (switch.md §3): the text label on the left, and on
the right one swatch, the swatch picker's 32 × 32 square with radius 4 (color-swatch.md §2),
filled with the colour. Clicking anywhere on the row, or Space on the focused swatch, opens
the **browser's own colour picker**: a native `<input type="color">` laid invisibly over the
swatch, so there is no picker UI to draw and the control works on every platform.

## 2. Tokens used

| Code token | Used for |
|---|---|
| `--color-text`, `--type-body-secondary` | the label (as the switch row) |
| `--radius-sm` | the swatch's corners |
| `--color-border` | hover outline (as the swatch picker's) |
| `--color-focus`, `--focus-ring-width`, `--focus-ring-offset` | focus ring on the swatch |
| `--opacity-disabled` | disabled |

The swatch fill is the value, set inline (`--swatch-color`): the one raw colour the design
system takes from data (color-swatch.md §1.1).

## 3. Behaviour

- `colorInput({ label, value, onInput, onChange })`: `onInput` fires with each colour while the
  picker is open (the slider's live preview), `onChange` with the one it closes on, so a caller
  can preview and then record one undoable change. `setColorValue(root, hex)` moves it silently.
- The value is `#rrggbb`, what the native input takes and gives.
- Keyboard: Tab reaches the swatch; Space or Enter opens the picker; the picker is the
  browser's, with its own keyboard handling.

## 4. Open for design

- Whether the swatch should carry a border on near-panel colours (a dark sky colour on the
  dark panel), as the swatch picker's issue (color-swatch.md §3.1).
- Whether the hex value should show as text beside the swatch.
