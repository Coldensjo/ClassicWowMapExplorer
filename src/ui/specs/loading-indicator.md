# Loading GIF: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component
**Loading GIF** (node `47:6185`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=47-6185>), read on
2026-10-30 (file version `2415936091135390495`).

A loading animation: a 124 × 124 rectangle filled with an **animated GIF** (Figma image ref
`77925466…`, GIF ref `64f9bddb…`, source 540 × 540, scale "fill", aspect ratio locked). There are
no tokens, text or states; the look lives entirely in the GIF.

Build `molecules/loading.{css,ts}`.

---

## 1. Visual

| Property | Value |
|---|---|
| Size | 124 × 124 (square, scales with its container; aspect locked) |
| Content | the GIF, cropped to fill |
| Background | none |

The GIF itself can't be read from the Figma API as anything but a raster. **The builder needs the
file exported from Figma** (select the layer, Export → original image) and placed in
`public/` (or `src/ui/assets/`). Ask design for it.

## 2. Recommended build

1. **Preferred:** re-create the animation in CSS or as an animated SVG, coloured with tokens
   (e.g. `--color-text`), so it is crisp at any size, tiny, themeable and controllable. Use the
   GIF as the visual reference.
2. **If the GIF must be used as is:** `<img src="loading.gif" alt="" width="124" height="124">`.
   Provide a static fallback frame for reduced motion (§3); a 540px GIF is heavy, so compress it.

## 3. Behaviour and accessibility

- Wrap it in a status region: `<div role="status" aria-live="polite"><img … alt=""><span
  class="visually-hidden">Loading…</span></div>`, with a caller-provided label ("Loading models…").
- Show it only after ~300ms, so fast loads don't flash.
- `prefers-reduced-motion: reduce`: show a static frame (or a non-moving "Loading…" label).
- **Relation to existing UI:** the app's start screen has a progress bar
  (`.loading-bar` / `#loading-fill` in `index.html`). Use the bar when progress is known and this
  indicator only when it isn't.

## 4. API

```ts
export function loading(options?: { label?: string; size?: number }): HTMLElement;
```

## 5. Open questions

1. Can design supply the GIF (or the animation it was made from, for a CSS/SVG rebuild)?
2. Sizes: is 124px the only size, or is a small inline version (16–24px, e.g. in buttons or the
   asset grid) needed?
3. Should it replace the start screen's progress bar, or sit beside it?

### Acceptance checks

- The indicator renders at 124 × 124, announces its label, appears only after a short delay, and stops moving under reduced motion.
