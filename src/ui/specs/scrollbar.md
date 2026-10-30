# Scrollbar: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component set
**Scrollbar** (node `41:24275`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=41-24275>), read on
2026-10-30 (file version `2415936091135390495`).

The scrollbar for scrolling panels and lists (asset grids, the dropdown menu, long tool panels).
Figma draws **only the thumb**: no track, no arrows. `State` Rest/Hover.

Build it as **CSS on native scrolling**, not a custom scroller: a `.ds-scroll` class (and the
scrolling panel selectors) styled with `scrollbar-width` / `scrollbar-color` and the
`::-webkit-scrollbar` pseudo-elements. A JavaScript scrollbar would break native momentum,
keyboard and assistive-technology scrolling.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `surface-transparent-inverse` | `--color-bg-inverse` | `#E7E7E7` @ 40% | thumb |
| `interaction-hover` | `--color-bg-hover` | `#E7E7E7` @ 10% | hover wash over the thumb |
| *(none)* | `transparent` | n/a | track |

## 2. Visual

| Part | Value |
|---|---|
| Thumb | **4px** wide, fully rounded (radius 24 on a 4px bar), `#E7E7E7` @ 40%; length = the visible fraction of the content (196px in the drawing is a sample) |
| Track | none (transparent); the thumb floats over the panel |
| Hover | the thumb gets the 10% wash on top, i.e. about `#E7E7E7` @ 46% |
| Horizontal | not drawn; same thumb, 4px tall (**Proposed**) |

Build hover as a single colour, `color-mix(in srgb, var(--color-text) 46%, transparent)`, rather
than a layered wash: scrollbar pseudo-elements can't take overlays.

**⚠ Figma issue.** The Hover State rectangle has square corners and the component doesn't clip,
so in Figma the hovered thumb loses its rounding. Build it rounded in both states.

## 3. CSS

```css
.ds-scroll {
	scrollbar-width: thin;
	scrollbar-color: var(--scrollbar-thumb) transparent;
}
.ds-scroll::-webkit-scrollbar { width: 8px; height: 8px; }          /* 4px thumb + 2px each side */
.ds-scroll::-webkit-scrollbar-track { background: transparent; }
.ds-scroll::-webkit-scrollbar-thumb {
	background: var(--scrollbar-thumb);
	border: 2px solid transparent;
	background-clip: padding-box;
	border-radius: 9999px;
}
.ds-scroll::-webkit-scrollbar-thumb:hover { background-color: var(--scrollbar-thumb-hover); }
```

`scrollbar-width: thin` gives the closest native match in browsers that don't support the
`::-webkit-` pseudo-elements; it can't be exactly 4px there. The 2px transparent border keeps a
larger hit area than the visible 4px.

**Proposed:** keep the scrollbar visible while content overflows (don't auto-hide), so users can
see a panel scrolls. Don't add custom arrows.

## 4. Component tokens

```css
--scrollbar-thumb: var(--color-bg-inverse);
--scrollbar-thumb-hover: color-mix(in srgb, var(--color-text) 46%, transparent);
```

## 5. Open questions

1. **No track, no inset**: how far from the panel's edge does the thumb sit? Spec centres it in
   an 8px gutter.
2. **Hover**: the 10% wash over a 40% thumb is subtle; a clearer hover (e.g. 60%) or widening to
   6px on hover would help.
3. **Dragging state** isn't drawn; spec uses the hover look.

### Acceptance checks

- Scrolling panels show a 4px rounded `#E7E7E7`@40% thumb and no track; it brightens slightly on hover.
- Native wheel, touch, keyboard and screen-reader scrolling all still work.
