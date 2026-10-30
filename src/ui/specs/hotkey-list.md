# Hotkey List: build spec

Source: Figma file "Dungeon Builder", page **Components**, components **Hotkeys Group**
(node `234:40698`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=234-40698>),
**Hotkey Row** (`234:40714`) and **Hotkey Asset** (`234:40706`), as placed in the **Bottom
Controls** variants (`29:7815`, [bottom-controls.md](bottom-controls.md)), read on 2026-10-30
(file version `2416178373996841357`).

A list of what the keys do in the active tool: a label on the left, the keycap chord on the
right. It appears two ways in the panel: **headed** ("Hotkeys" over the rows, indented behind a
thin rule) under the selected option of a radio group, and **plain** (no heading, no rule) as a
module of its own (Holes, Objects, NPCs).

Build `molecules/hotkey-list.{css,ts}`: `hotkeyList({ heading?, rows })`, `setHotkeyRows()`.
The caps are the key-command molecule ([key-command.md](key-command.md)).

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `content-primary` (`6:274`) | `--color-text` | `#E7E7E7` | row label |
| `content-secondary` (`6:384`) | `--color-text-muted` | `#CACACA` | heading; the "+" between keys and the "+ click" tail |
| `6:273` | `--color-bg-surface` | `#383838` | the rule beside headed rows |

| Text | Figma style | Code token |
|---|---|---|
| Heading "Hotkeys" | `231:39942` label/label-bold, 12px / 700 | `--type-label-bold` |
| Row label | `231:39938` body/body-secondary, 14px / 400, one line, truncates | `--type-body-secondary` |
| "+" and tail | label/label, 12px | `--type-label` |
| Keycap | Key Command, Medium (24px, 12px bold) | `.ds-kbd` |

## 2. Anatomy

```
Hotkeys                               heading, label-bold, muted
│ Raise                 SHIFT + click   row 24px: label fills, chord hugs; gap 16
│ Lower                  CTRL + click   rows 8px apart; rule 1px, rows 12px to its right
```

| Part | Layout |
|---|---|
| Group | vertical, gap 8 (heading ↔ rows), fills its column |
| Rows | vertical, gap 8; headed: 12px padding and a 1px `#383838` rule (radius 2) on the left |
| Row | horizontal, 24px tall, items centred, gap 16; label fills and truncates, chord hugs |
| Chord ("Hotkey Asset") | keycaps 8px apart in Figma with a muted "+" between simultaneous keys; an optional tail ("+ click", "+ drag") after the last cap |

**⚠ Figma issues.** The medium keycaps are typed in capitals ("SHIFT", "CMD") although the
Key Command spec builds Medium as typed; the list sets them in capitals with CSS, so the key
names are written as users say them ("Shift") and screen readers never spell them out. The
modifier is drawn as CTRL in Sculpt and CMD in Water, Holes and Objects; the editor shows the
platform's key and accepts both. The Strength module's rows read "+ size" twice in Sculpt and
"+ opacity" in Paint: built as "+ strength" / "- strength" with Shift, and Opacity got its own
Cmd + [ ] pair.

## 3. Props

| Figma property | Type | Code |
|---|---|---|
| `Show heading label?` | boolean (default true) | `heading?: string` (omitted: plain list) |
| `Hotkeys` (slot of Hotkey Rows) | slot | `rows: { label, keys: string[], tail? }[]` |
| Hotkey Asset `Show additional info?` | boolean | `tail` ("click", "drag"), shown as "+ click" |

```html
<div class="ds-hotkey-list" data-headed>
	<p class="ds-hotkey-heading">Hotkeys</p>
	<ul class="ds-hotkey-rows">
		<li class="ds-hotkey-row">
			<span class="ds-hotkey-label">Raise</span>
			<span class="ds-hotkey-keys"><kbd class="ds-kbd">Shift</kbd><span class="ds-hotkey-tail">+ click</span></span>
		</li>
	</ul>
</div>
```

Not interactive: no states. `setHotkeyRows(root, rows)` swaps the rows when the selected
option changes (the Sculpt setting's hotkeys follow the option).

## 4. Component tokens

```css
--hotkey-rule: var(--color-bg-surface);
--hotkey-label-fg: var(--color-text);
--hotkey-heading-fg: var(--color-text-muted);
--hotkey-tail-fg: var(--color-text-muted);
--hotkey-row-height: 24px;
```

### Acceptance checks

- A headed list shows "Hotkeys" in 12px bold muted text over rows indented 12px behind a 1px rule.
- Each row is 24px tall, label left in 14px text, capitals-set keycaps right with a muted "+" between keys and a muted "+ click" tail when given.
- A plain list has no heading and no rule.
- No hex values in `hotkey-list.css`.
