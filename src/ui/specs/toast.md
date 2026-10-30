# Toast: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Misc**, component **Toast**
(node `151:23213`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=151-23213>), read on
2026-10-30 (file version `2415936091135390495`).

A short, transient status message ("Scene saved.") that appears over the editor and goes away
by itself. A single component: no variants, no states.

Build `molecules/toast.{css,ts}`: the toast plus a small manager that stacks and dismisses them.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**).

---

## 1. Tokens used

| Figma variable | Code token | Value | Used for |
|---|---|---|---|
| `button-bg-primary` | `--color-accent` | `#006FB4` | toast fill |
| `content-primary` | `--color-text` | `#E7E7E7` | message |

Type: Figma `231:39937` `label/label`, 12px / 400 → **`--type-label`**, **centred**.

## 2. Layout

| Part | Value |
|---|---|
| Toast | vertical stack, padding **12 × 16**, gap 6, items centred, radius **12px**, hugs, **max-width 280px** |
| Message | 12px `#E7E7E7`, centred |
| Additional Information | a hidden, empty frame (179px wide) below the message: room for extra content such as an Undo button (§6.2) |

With "Message goes here." the toast is 169 × 40.

**⚠ Figma issue.** The message is set to auto **width** (never wraps), so with the 280px max
width a long message would overflow. **Build** the message to wrap (`text-wrap: balance`, centred)
within 280px. Also, the message is **not a text property**.

## 3. Behaviour (Proposed: none of this is drawn)

| Aspect | Proposal |
|---|---|
| Position | bottom centre of the editor viewport, above the Mode Controller bar, 16px clear of it |
| Stacking | newest at the bottom, 8px apart, at most 3; older ones leave first |
| Duration | 4s, plus 1s per 20 characters over 40; paused while hovered or focused |
| Enter / exit | fade + 8px rise over ~150ms; fade out ~150ms; none under reduced motion |
| Dismiss | auto; also click to dismiss (`cursor: pointer`) |
| Semantics | `role="status"` (`aria-live="polite"`) on a persistent container, so the message is announced without stealing focus; errors that need action use a Dialog instead |

## 4. API

```ts
export interface ToastOptions {
	message: string;
	durationMs?: number;
	action?: { label: string; onClick: () => void };   // uses "Additional Information" (§6.2)
}
export function showToast(options: ToastOptions | string): { dismiss(): void };
```

## 5. Component tokens

```css
--toast-bg: var(--color-accent);
--toast-fg: var(--color-text);
--toast-radius: 12px;
--toast-padding: 12px 16px;
--toast-max-width: 280px;
```

## 6. Open questions / feedback for design

1. **Contrast**: 12px `#E7E7E7` on `#006FB4` is about 4.4:1, under AA for small text.
2. **What goes in "Additional Information"?** An Undo/View action, a second line? It's an empty
   frame, not a slot.
3. **No variants**: success, warning (`#F45060` danger exists) and progress toasts aren't drawn.
4. **Position, timing, stacking and dismissal** aren't designed (§3).
5. **Message isn't a text property** and doesn't wrap (§2).

### Acceptance checks

- Toast is `#006FB4`, radius 12, padding 12 × 16, at most 280px wide; message 12px `#E7E7E7` centred and wrapping.
- `showToast('Scene saved.')` shows one, announces it to screen readers, and removes it after the duration.
- No hex values in `toast.css`.
