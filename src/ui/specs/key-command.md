# Key Command: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component set
**Key Command** (node `44:4920`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=44-4920>), read on
2026-10-30 (file version `2415936091135390495`).

A keycap label for a keyboard shortcut ("SHIFT", "W", "1"). Used on its own in hint text and
inside **Tooltip - Simple** ([tooltip.md](tooltip.md)). Two sizes; no states (it isn't
interactive).

Build as styles for the native `<kbd>` element: `.ds-kbd` (and the bare `kbd` selector, per
DESIGN_SYSTEM.md §5's legacy rule, since `index.html` already uses `<kbd>` in the editor hints
and settings, e.g. `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly`). No TypeScript
factory is needed; a `kbd(label, size?)` helper is optional.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `content-primary` | `--color-text` | `#E7E7E7` | keycap fill |
| `surface-primary` | `--color-bg-surface` | `#383838` | key label |

The keycap is **inverted** (light cap, dark text), like the selected mode chip.

| Size | Figma style | Code token |
|---|---|---|
| Medium | `231:39942` `label/label-bold`, 12px / 700 | `--type-label-bold` |
| Small | `234:39945` `label/label-small-bold`, 10px / 700, **uppercase** | `--type-label-small-bold` + `text-transform: uppercase` |

## 2. Sizes

| Size | Padding (V × H) | Radius | Height | Example ("SHIFT") |
|---|---|---|---|---|
| Medium (default) | 4 × 8 | 2px | 24px | 54 × 24 |
| Small | 2 × 4 | 2px | 17px | 40 × 17 |

Layout: inline, hugs its label, label centred, one line (no wrap). Several keys in a row
(a chord like Shift + 1) sit 4px apart (**Proposed**; not drawn), with a "+" in
`--color-text-muted` between them if the chord is simultaneous.

Proposed tokens: `--kbd-radius: 2px`, `--kbd-padding-md: 4px 8px`, `--kbd-padding-sm: 2px 4px`.

## 3. Props

| Figma property | Type | Default | Code |
|---|---|---|---|
| `Key label` | text | "SHIFT" | the element's text content |
| `Size` | variant | `Medium` | `data-size="sm"` for Small; Medium is the default |

## 4. ⚠ Figma issues

1. **Only Small sets uppercase.** Medium shows "SHIFT" only because it was typed in caps. Build
   both as typed (no transform on Medium) unless design wants all keys uppercase; then add
   `text-transform: uppercase` to Medium too (§6.1).
2. **Contrast** `#383838` on `#E7E7E7` is about 9:1, fine.
3. **Radius 2px** appears nowhere else except Simple tooltips (also 2px); fine for keycaps.

## 5. Accessibility

`<kbd>` is semantic; screen readers read the text. Write the key names as users say them
("Shift", "Ctrl"), and let CSS uppercase them if needed, so screen readers don't spell out
"S-H-I-F-T".

```html
<kbd class="ds-kbd">Shift</kbd>
<kbd class="ds-kbd" data-size="sm">1</kbd>
```

## 6. Open questions

1. Should Medium keys be uppercase like Small (§4.1)?
2. How are chords shown (Shift + 1): adjacent keys, or with a "+"?
3. Mac vs Windows labels (⌘ vs Ctrl): who decides, the caller or the component?

### Acceptance checks

- Medium: 24px tall, 4 × 8 padding, `#E7E7E7` cap, 12px Bold `#383838` label, radius 2.
- Small: 17px tall, 2 × 4 padding, 10px Bold uppercase label.
- The existing `<kbd>` hints in `index.html` pick up the style without markup changes.
