# Grab Bar: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component
**Grab Bar** (node `29:8356`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=29-8356>), read on
2026-10-30 (file version `2415936091135390495`).

A small horizontal handle that signals "drag me": in the file's "Bottom Controls" frame it sits
between the Mode Controller and the Tool Panel (a "Grab Bar Container"), so the tool panel can be
dragged to resize or collapse. A single component: no variants, no states.

Build `molecules/grab-bar.{css,ts}`.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Visual

| Property | Value |
|---|---|
| Size | **47 × 2px** |
| Fill | `content-primary` → `--color-text` `#E7E7E7` |
| Radius | 4px (fully rounded on a 2px bar) |
| Anything else | none |

**⚠ Figma issues.**
- **47px** is an odd width; build **48px** unless design says otherwise.
- The component is only the 2px bar, with **no hit area**. A 2px target is unusable.

## 2. Hit area and behaviour (Proposed)

| Aspect | Proposal |
|---|---|
| Element | the bar is drawn inside a `<div role="separator" aria-orientation="horizontal" tabindex="0">` that is the full width of the panel it resizes and **16px tall**, bar centred |
| Cursor | `ns-resize` (or `grab` / `grabbing` while dragging if it moves the panel rather than resizing) |
| Hover | the bar can't get brighter (it is already `#E7E7E7`); instead widen it to 64px, or add the `--color-bg-hover` wash to the 16px hit area |
| Drag | pointer drag resizes the tool panel between its min and max height; double-click collapses / restores |
| Keyboard | ↑/↓ resize by 16px, Home/End to min/max, Enter toggles collapsed; `aria-valuenow/min/max` give the panel height |
| Motion | snap animations none under reduced motion |

```html
<div class="ds-grab-bar" role="separator" aria-orientation="horizontal" aria-label="Resize tool panel"
	tabindex="0" aria-valuemin="120" aria-valuemax="480" aria-valuenow="280">
	<span class="ds-grab-bar-handle" aria-hidden="true"></span>
</div>
```

## 3. Component tokens

```css
--grab-bar-width: 48px;
--grab-bar-height: 2px;
--grab-bar-color: var(--color-text);
--grab-bar-hit-height: 16px;
```

## 4. Open questions

1. What exactly does dragging do: resize the tool panel, or move/collapse the whole bottom
   controls? Min/max sizes?
2. Is there a hover or dragging look?
3. 47px vs 48px?
4. Does it also need to work vertically (side panels)?

### Acceptance checks

- A 48 × 2px `#E7E7E7` rounded bar, centred in a 16px-tall, full-width hit area.
- Dragging the hit area resizes the panel; it is focusable and resizable with the arrow keys.
