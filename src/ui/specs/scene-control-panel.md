# Scene Control Panel: build spec

Source: Figma file "Dungeon Builder", page **-> Environment Panel**, frame **Scene Settings**
(node `329:68940`,
<https://www.figma.com/design/BGcDYElmHi41sl4IxcpsVg/Dungeon-Builder?node-id=329-68940>), an
instance of the component **Scene Control Panel** (`296:67653`) with its **Dropdown Menu**
(`34:13458`) open, read on 2026-10-31 (file version `2416575165113818293`).

The floating panel at the **top left** of the viewport while a scene is open: the scene's name
with a menu button, Save and Play, Undo and Redo, in three groups divided by rules. It replaces
the bar that ran along the top of the screen (the name, Save, Undo, Redo, Play, Export, Scenes,
the save status and the key hints) and, with it, the status bar along the bottom (cursor
position, ground height, layer count, the ground effect scan's progress and the FPS) goes:
nothing in the design shows them, and the user asked for the bottom bar removed (2026-10-31).

It is not a molecule: `src/editor/sceneControls.ts` builds it from molecules (`SceneControls`),
`src/editor/scenesUi.ts` owns it and answers its buttons, `src/editor/editorPanels.ts` pushes
the play and undo state into it; the layout CSS is `#scene-controls` and `.scene-controls-*`
in `src/viewer/viewer.css`.

Conventions match the other specs in this folder (Figma variable → code token in
[tokens/color.css](../tokens/color.css) → value; **⚠ Figma issue**; **Proposed**; **Decided**).

---

## 1. Frame

```
┌──────────────────────┬──────────────────────┬────────────────┐  24px from the top and left; 480 wide
│ [Scene name]      ⌄  │ [💾 Save] [▷ Play]   │   ↶      ↷     │  12px padding, 8px gaps; rules between
└──────────────────────┴──────────────────────┴────────────────┘  1px border, radius 8, 85% fill + 24px blur
                        ┌──────────────────┐
                        │ Hotkey format    │  the menu, 218 wide, under the ⌄ button
                        │ Mac           ✓  │
                        │ Windows          │
                        │ ───────────────  │
                        │ ⚙ Settings       │
                        │ ⤓ Export         │
                        │ ⇤ Exit scene     │
                        └──────────────────┘
```

| Part | Figma | Build |
|---|---|---|
| Panel | 480 × hug (58), at 24, 24 in the 1280 × 832 frame; horizontal, items centred; `surface-transparent-primary` (`6:272`) → `--color-bg-panel` with a 24px background blur; 1px `6:273` → `--color-bg-surface` border inside; radius 8 | `#scene-controls`: `position: fixed; top: 24px; left: 24px` (`--space-6`); `inline-size: 480px` capped to the viewport less the insets; `--radius-md`; `--blur-panel`; the same `z-index` as the side panel |
| Name group | fills; 12px padding, gap 8: the name then the menu button | `.scene-controls-group[data-fills]` |
| Scene name | `[Scene name]`, 18px / 600 (heading/h1 → `--type-heading-1`), one line truncated with an ellipsis, fills; **⚠ Figma issue**: its fill is an unbound `#FFFFFF`, built as `content-primary` → `--color-text` like every other title | `h1.scene-controls-name`, `title` holds the full name |
| Menu button | Button - Icon – Ghost, X-Small (24px, 16px `down` icon) | `iconButton({ icon: 'down', variant: 'ghost', size: 'xs', label: 'Scene menu' })` |
| Rules | 1px `6:273` → `--color-bg-surface`, the panel's full height | `border-inline-start` on the second and third groups |
| Save | Button - Outline, Small (30px), `save` icon, "Save" | `button({ variant: 'outline', icon: 'save' })` |
| Play | Button - Primary, Small, `play` icon, "Play" | `button({ variant: 'primary', icon: 'play' })`; see §2 |
| History group | hug; 12px padding, gap 8 | `.scene-controls-group` |
| Undo, Redo | Button - Icon – Ghost, Small (32px, 24px icons `undo` `329:68802` and `redo` `329:68796`, new to the set) | `iconButton({ variant: 'ghost', size: 'sm' })`, disabled while there is nothing to undo or redo |

## 2. Behaviour

| Control | Does |
|---|---|
| Save | saves the scene to the library with a fresh thumbnail; the button is disabled while the save runs; a toast "Scene saved" confirms it (**Proposed**: the bar's "Saved 12:34:56" status line is not in the design, and autosaves stay silent); a failure shows the notice as before |
| Play | walks the scene as the character (spec 7.10); while playing the button reads **Edit** and comes back to editing with the camera where the player stands. **Proposed**: Edit keeps a leading icon (`scene`) so the button does not change width; the design draws only Play. Focus leaves the button after a click so Space jumps instead of pressing it again. The side panel hides while playing; this panel stays |
| Undo, Redo | the command history, as before; the tooltip names the command and the key (`Cmd+Z` or `Ctrl+Z` in the chosen hotkey format, §3) |
| Menu | opens below the button (the menu molecule's `bottom` placement, left edges aligned; Figma draws it 8px further left); Escape, a click outside or a choice closes it |

### 2.1 What the bar had that the panel does not

| Was | Now |
|---|---|
| "Export" button | the menu's **Export** (saves first, then downloads the `.wscene`) |
| "Scenes" button (save and go back) | the menu's **Exit scene** (saves, then the scene library) |
| save status text | the toast on a manual save (§2) |
| key hints (WASD fly, Shift/Cmd + click…) | gone: the hotkey lists in the side panel's modules say what the keys do per tool; the play-mode hints (Space jump, click an NPC) have no home yet (**Proposed**: a tooltip on Edit, or a toast when play starts) |
| status bar: cursor yards, height, layers, FPS, the ground effect scan with its pause button | gone, with the scan's pause control; the scan still runs in the background (spec 7.7.2) |

## 3. The menu (`Dropdown Menu` with headings, choices and a separator: [dropdown.md](dropdown.md) §11)

| Entry | Does |
|---|---|
| "Hotkey format" | a heading |
| Mac · Windows | choices with a checkmark on the current one: how the hotkey lists and tooltips write the command key (**Cmd** or **Ctrl**). The editor accepts both keys whatever the format. `src/editor/hotkeyFormat.ts` keeps the choice in `localStorage['foreverForge.hotkeyFormat']`, following the platform until chosen; the editor panels rewrite every hotkey list when it changes |
| Settings (`scene` icon) | the Scene settings dialog ([scene-dialogs.md](scene-dialogs.md) §3), the same one a scene card's menu opens; a rename shows in the panel at once |
| Export (`download`) | §2.1 |
| Exit scene (`log-out`) | §2.1 |

The menu is 218px wide (`.scene-controls-menu`), as drawn.

## 4. Around it

- The side panel controls' top moves from under the bar to **24px**, level with this panel
  ([side-panel-controls.md](side-panel-controls.md)); its bottom inset is 16px now that the status
  bar is gone, and the browser windows open 16px above the viewport's bottom edge
  ([floating-window.md](floating-window.md) §4).
- Play mode's target frame and the "game updated" notice, centred at the top, start 24px down.
- `viewer.css` lost `--bar` and `--status-bar-height`, the `#editor-bar` and `#status-bar` rules
  and the `kbd` rule the hints used.

### Acceptance checks

- A translucent blurred 480px panel at the top left with the name, ⌄, Save, Play, ↶ and ↷ and
  two rules; the name truncates with an ellipsis.
- ⌄ opens the menu: "Hotkey format" over Mac ✓ and Windows, a rule, Settings, Export, Exit scene
  with icons. Choosing Windows moves the checkmark and the side panel's hotkey chords read Ctrl.
- Save disables for the moment of saving and a "Scene saved" toast shows; Play becomes Edit and
  the side panel hides; Undo and Redo enable with the history.
- No bar along the top or the bottom of the viewport.
