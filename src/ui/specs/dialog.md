# Dialog: build spec

Source: Figma file "Dungeon Builder", page **Components**, section **Panels and Windows**,
component **Dialog** (node `204:39244`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=204-39244>), as used
in the flow "NPC - 2.6.5 - exit dialog" (`204:38718`) on page **-> NPCs**, read on 2026-10-30
(file version `2416270716900656388`).

A modal question: a title, a sentence, and two buttons that share the width. The one instance
drawn asks "Exit NPC studio?" over the blurred studio; the NPC library's delete confirmation
(npc-library.md §5) is the same shape with a destructive confirm.

Build `molecules/dialog.{css,ts}`: `dialog()` and `confirmDialog()`.

---

## 1. Tokens used

| Figma | Code token | Value | Used for |
|---|---|---|---|
| `6:361` (as the outline button's fill) | `--color-bg-control` | `#181818` | the card: opaque, no blur |
| `6:273` | `--color-bg-surface` | `#383838` | 1px border; the two dividers |
| `content-primary` (`6:274`) | `--color-text` | `#E7E7E7` | title, message |
| *(unbound rectangle "Rectangle 3")* | `--color-scrim` (**Proposed**) | ink-950 @ 60% | the veil over the page; the flow also blurs what is under it, which the backdrop does not |

Title `heading/h1` 18/600 → `--type-heading-1`; message `body/body-primary` 16/400 →
`--type-body`.

## 2. Anatomy and sizes

```
┌──────────────────────────────────────┐  400 wide, radius 12, 1px border
│  Exit NPC studio?                 ×  │  16px top; 24px title row, 16px side padding; ghost X-Small close
├──────────────────────────────────────┤  divider 16px under the row
│  Any changes you’ve made will be     │  16px padding all round
│  lost.                               │
├──────────────────────────────────────┤  divider
│ [      Go back     ] [     Exit     ] │  16px padding, 16px gap; Secondary + Outline, Medium (38px), both Fill
└──────────────────────────────────────┘
```

The card hugs its content. Drawn 400 × 202.

## 3. Behaviour

- Opened modally on the native `<dialog>` (`showModal()`): the browser supplies the top layer,
  focus containment and Escape. The scrim is `::backdrop`.
- The left button is the safe choice and has focus when the dialog opens, so Enter never
  commits by accident. Escape, the close button and the left button all resolve "no".
- **Decided (2026-10-30):** the NPC studio shows it only when there are unsaved changes; with
  nothing changed, Exit closes at once.
- **Proposed:** a destructive variant (the right button's text in `--color-danger`) for
  confirmations that delete, since the Figma menu already draws destructive items that way.
  The NPC library's Delete uses it (decided 2026-10-30).

## 4. API

```ts
const yes = await confirmDialog({
	title: 'Exit NPC studio?',
	message: 'Any changes you’ve made will be lost.',
	cancel: { label: 'Go back' },
	confirm: { label: 'Exit' },
});
```

`dialog()` returns `{ root, result, close }` for a caller that needs to close it itself.
