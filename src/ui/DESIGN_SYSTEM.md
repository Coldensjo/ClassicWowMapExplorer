# Design system

How the UI of WoW Dungeon Builder is styled and built, and how to extend it. Read this before
adding a colour, a font size or a control anywhere in the app. The system is plain CSS custom
properties and plain TypeScript factories, with no framework, because that is how the rest of
the app is built (DOM made by hand in `src/editor` and `src/viewer`, one stylesheet in
`src/viewer/viewer.css`).

**Status:** the colour tokens are defined (from the Figma file "Dungeon Builder", mode
"Mode 1"), so are the type tokens (from its text styles), the layout tokens (§3.3) and the icon
set (§6). Every molecule the specs in `specs/` describe is built (§5), and `gallery.html` shows
them all (§8). The game theme's overrides are not written yet. The first piece of a screen has
migrated: the Paint tool's texture browser is a floating window built from molecules (§7.1);
the rest of the existing screens still use their own markup.

## 1. Layout

```
src/ui/
├── DESIGN_SYSTEM.md      this file
├── index.css             the one stylesheet index.html links: fonts → tokens → themes → icons → molecules
├── index.ts              the one import for code: re-exports icons/ and molecules/
├── dom.ts                el(), uid() and small helpers the molecules (and migrated screens) build DOM with
├── popover.ts            positioning and closing of floating panels (menu, select, tooltip)
├── gallery.ts            the script of /gallery.html, the dev-only page showing every molecule
├── specs/
│   └── <name>.md         one build spec per Figma component, read from the file
├── tokens/
│   ├── color.css         palette (tier 1) and semantic colours (tier 2)
│   ├── type.css          families, sizes, weights, line heights, and the type roles
│   └── layout.css        spacing, radii, line widths, motion, z-index
├── themes/
│   └── wow.css           the game's look: semantic tokens overridden under body.wow-ui
├── icons/
│   ├── <name>.svg        one 24×24 line icon per file, from Figma, drawn in currentColor
│   ├── index.ts          icon(name, options) and the IconName type
│   └── icon.css          .ds-icon: size and line width from tokens
└── molecules/
    ├── index.ts          one export line per molecule
    ├── base.css          rules every molecule shares (.ds-visually-hidden)
    ├── field.{css,ts}    the labelled field shell and field box the inputs build on
    ├── <name>.ts         a factory returning an element  (one per molecule)
    └── <name>.css        its styles, on .ds-<name>        (one per molecule)
```

`gallery.html` sits at the project root beside `index.html`; Vite serves it in development only.

Rules of the layout:

- A file holds one kind of thing. Tokens never style an element; a molecule never defines a
  raw colour; a theme never contains a selector other than its scope.
- `index.css` and `index.ts` are the only entry points. Nothing outside `src/ui` imports a
  token or molecule file directly. `index.ts` also re-exports `el()`, `append()` and `uid()`
  from `dom.ts`, so a screen built from molecules makes its own DOM the same way.
- New kinds of file (a second theme, an "organism" folder for composed panels) are added at
  this level and listed here.

## 2. Cascade and consumption

`index.html` links `src/ui/index.css` before `src/viewer/viewer.css`. Vite inlines the
`@import`s. The order inside `index.css` is the cascade:

0. **Fonts**: the `@font-face` rules of the self-hosted faces (§3.2).
1. **Tokens** declare custom properties on `:root`.
2. **Themes** redeclare semantic tokens on a scope (a class on `<body>`, or any element).
3. **Icons** (`icons/icon.css`) size `.ds-icon` from layout tokens.
4. **Molecules** read tokens and style their own class, and the bare element where the static
   markup in `index.html` should look the same (see §5).

Page CSS (`viewer.css` and any future per-screen stylesheet) comes after, so a screen can
override a molecule for its own layout with an ordinary selector. Page CSS takes tokens with
`var(--…)` and never restates a value a token holds.

Code imports from `src/ui` only:

```ts
import { button, icon } from '../ui';
```

## 3. Tokens

Tokens are CSS custom properties. Each has one home file, a stable name and a one-line
comment saying what it is for. Rename a token only with a project-wide search; there is no
alias layer.

### 3.1 Colour (`tokens/color.css`)

Three tiers, so a customisation touches one tier and nothing below it:

| Tier | Prefix | Holds | Used by |
|---|---|---|---|
| 1 Palette | `--palette-<hue>-<step>` | raw values, e.g. `--palette-ink-700` | `color.css` and `themes/` only |
| 2 Semantic | `--color-<role>` | what a colour is for, e.g. `--color-bg-panel`, `--color-text-muted`, `--color-accent` | molecules and page CSS |
| 3 Component | `--<molecule>-<part>` | a molecule's own knobs, e.g. `--button-bg`, defaulting to a semantic token | that molecule's CSS; a scope may override one |

Semantic roles are grouped by purpose: surfaces (`bg-page`, `bg-panel`, `bg-surface` (opaque),
`bg-inverse` (light on dark), `bg-control`, `bg-inset`, `bg-hover`, `bg-selected`, `scrim`),
lines (`border`, `border-strong`), text
(`text`, `text-muted`, `text-heading`, `text-on-accent`), and the accent with its states
(`accent`, `accent-hover`, `active`, `danger`, `focus`, `link`). Add a role when two or more
places need the same meaning, not for one element's one-off.

Figma is the source of the values: each semantic token's comment names the Figma variable it
came from, and a translucent Figma colour is written as `color-mix()` of a palette token with
`transparent`, so the palette holds only opaque values. Figma's `button-*` variables become
the button molecule's tier 3 tokens, defaulting to the semantic roles they were mapped to.

Hue steps run dark to light with a larger number meaning darker, like `ink-950` for the page
and `ink-100` for body text, so a theme can slide a role by one step.

### 3.2 Type (`tokens/type.css`)

Primitives, then roles. Figma's text styles are the source: each role's comment names the
style it came from, and the role name follows the style's name.

- Families: `--font-family-ui` (Atkinson Hyperlegible Mono, the one face Figma uses), with
  `--font-family-display` (headings, names), `--font-family-numeric` and `--font-family-mono`
  as aliases of it, so a theme can give any of them its own face. A family for pages of prose
  (`--font-family-book`) is added when a screen needs one.
- Sizes `--font-size-xs/sm/md/lg/xl` (10, 12, 14, 16, 18px); weights
  `--font-weight-light/regular/semibold/bold` plus `--font-weight-heading` (semibold);
  `--line-height-normal` (`normal`, Figma's "auto"). Add a size or line height to the scale
  only when Figma gains a style that uses it.
- Roles `--type-<role>`, each a complete `font` shorthand, so a rule reads
  `font: var(--type-label)` and a theme can change a role's whole look at once:

  | Role | Figma style | Use |
  |---|---|---|
  | `heading-1` | heading/h1 | a panel's or dialog's title |
  | `heading-2` | heading/h2 | a section within a panel |
  | `body`, `body-bold` | body/body-primary(-bold) | running text |
  | `body-secondary`, `body-secondary-bold` | body/body-secondary(-bold) | denser text: list rows, descriptions |
  | `label`, `label-bold`, `label-light` | label/label(-bold, -light) | a control's label; a leading label; a hint or value beside one |
  | `label-small`, `label-small-bold` | label/label-small(-bold) | captions and badges; small section headers in capitals |

  `label-small-bold` is set in capitals in Figma, which `font` cannot carry: a rule using it
  also sets `text-transform: uppercase` (its utility class does).

The file ends with the utility classes markup may use directly, a `.type-<role>` per role.
`.muted` and `.small` still live in `viewer.css` and move here with the colour migration
(§7). Nothing else in the system is a utility class.

The face is self-hosted, so the app needs no network for it: `index.css` imports
`@fontsource-variable/atkinson-hyperlegible-mono` first, whose upright variable font (weights
200–800, Latin and Latin Extended) Vite bundles, and the browser fetches a subset only when
text uses it. Its family name is "Atkinson Hyperlegible Mono Variable"; the token lists that
first. A new face is added the same way: a `@fontsource` package imported at the top of
`index.css`, and a family token naming it.

### 3.3 Layout (`tokens/layout.css`)

A molecule pads, gaps and layers only with these. Figma binds no variables for any of them;
the values are the ones the specs collected from the drawings.

- Spacing `--space-0-5 … -8`: a 4px scale (`--space-1` = 4px) with the half steps the drawings
  use (`--space-1-5` = 6px, `--space-2-5` = 10px).
- Radii `--radius-xs/sm/md/lg/xl` (2, 4, 8, 12, 14px) and `--radius-full` for pills and circles.
- Lines `--border-width` (1px), `--focus-ring-width` (1px) and `--focus-ring-offset` (2px): the
  keyboard focus outline on controls that have no border to recolour. A field shows focus by
  recolouring its border to `--color-focus` instead, with no ring.
- Motion `--duration-fast` (100ms: washes, a dot, a knob), `--duration-slow` (150ms: a panel or
  toast appearing) and `--easing-out`. Every transition and animation is removed under
  `prefers-reduced-motion: reduce`.
- Stacking `--z-window` (floating windows such as the texture browser, above the page's own
  panels) and `--z-popover`, `--z-tooltip`, `--z-toast` above anything the page draws.
- `--opacity-disabled` (0.3) for any disabled control and `--blur-panel` (24px) for the backdrop
  blur of translucent floating panels.
- Icons `--icon-size-sm/md/lg` (16, 20, 24px) and `--icon-stroke-width` (1px), used by
  `icons/icon.css` (§6).

### 3.4 Tokens that stay local

A variable that only one component or screen reads, and that no theme would change, is not a
token: it stays in that component's CSS, named for the component (`viewer.css` already has
`--bar`, `--ui-unit`, `--mm-*`, `--slope`, `--beacon`; `uiAssets.ts` sets the `--wow-*`
picture variables at runtime). Promote one to `tokens/` when a second place needs it.

## 4. Themes

A theme is one file in `themes/`, one scope selector, and inside it only semantic (tier 2) and
type tokens. It never selects a component, never sets a palette value directly if a palette
token exists, and never changes layout tokens.

- The default look is the tokens themselves on `:root`; it has no theme file.
- `themes/wow.css` is the game's look, scoped to `body.wow-ui`. The class is set by
  `src/viewer/uiAssets.ts` once the game's interface pictures are read. The rules that depend
  on those pictures (border images for buttons, panels, sliders, the minimap) stay in
  `viewer.css` under `.wow-ui`, because they are tied to the art rather than to tokens.
- A theme that sets a font family on its scope must also restate `font-family` there, since
  `:root`'s `font` is computed above the scope.

To add a theme: copy the shape of `wow.css`, pick a scope (`[data-theme='name']` on `<body>`
is the convention for a user-chosen theme; a class is fine for one set by code), override only
the roles that differ, and import it in `index.css` after the tokens.

## 5. Molecules

A molecule is a small control that brings tokens together: a button, a toggle group, a labelled
field with its slider or select, a search box. It is the lowest level a screen builds with.
Composed panels (a whole tool's properties) are not molecules; they live with the feature that
owns them and are built from molecules.

Each molecule is a pair of files in `molecules/`:

**`<name>.css`**
- Styles one root class, `.ds-<name>`, and its parts as `.ds-<name>-<part>`.
- Declares its component tokens at the top of the root rule, each defaulting to a semantic
  token: `--button-bg: var(--color-bg-control);`.
- Variants are `data-variant`, sizes `data-size`, layouts `data-layout`; a state that is on is
  `aria-pressed="true"` or the matching ARIA attribute, never a bespoke class.
- Where `index.html` has static markup for the same control, the rule may also list the bare
  element or the legacy class so both render the same: `button, .ds-button { … }`,
  `.ds-field, .prop-row { … }`. This is how the static markup migrates without rewriting it.
  No molecule does this yet (decided 2026-10-29): they are standalone, and a legacy selector is
  added when its screen migrates, together with the `viewer.css` rule it replaces.
- Takes every colour, size and space from a token. A raw value in a molecule is a defect.

**`<name>.ts`**
- Exports one factory, `name(options): HTMLElement` (or `{ root, …handles }` when callers
  need an inner element or a setter), typed options, and setters for state the caller changes
  later (`setPressed(button, on)`).
- Builds DOM with `document.createElement`, or a shared `el()` helper once one is added to
  `src/ui`; never with `innerHTML`.
- Owns no app state: it takes values and callbacks and reports changes. The caller keeps the
  model, as the editor's tools already do.
- Is exported from `molecules/index.ts`; its stylesheet is imported in `index.css`.

### 5.1 The molecules

Each has a spec in `specs/` with the same name, read from the Figma file; the spec says what
was drawn, what was decided and what is proposed. File names follow the specs (so
`segmented-control`, not the `toggle-group` once planned here, and `stepper`, not
`number-input`).

| Molecule | Factory | What it is |
|---|---|---|
| `button` | `button()`, `iconButton()`, `setPressed()` | text buttons (primary, secondary, outline) and icon buttons (primary, secondary, ghost) |
| `switch` | `toggleSwitch()`, `setChecked()` | an on/off row or bare switch, on a native checkbox with `role="switch"` |
| `radio` | `radioGroup()`, `setRadioValue()` | a fieldset of options, each with an optional info button |
| `segmented-control` | `segmentedControl()`, `setSegmentedValue()` | one of a few modes in a trough |
| `field` | `fieldShell()`, `fieldBox()`, `setFieldInvalid()` | the labelled stack and 40px box the inputs share; not used on its own |
| `text-input` | `textInput()`, `setTextValue()`, `setInvalid()` | a text or search field with icon, prefix, suffix and hint; the search box is this with `icon: 'search'` |
| `slider` | `slider()`, `setSliderValue()` | a range with a caption and an editable value field |
| `stepper` | `stepper()`, `setStepperValue()` | a number field between minus and plus buttons |
| `menu` | `menu()`, `menuPanel()`, `menuOption()` | the floating panel, and an action menu on any button |
| `select` | `select()`, `setSelectValue()`, `setSelectOptions()` | a select-only combobox on the field box and the menu panel |
| `swatch-picker` | `swatchPicker()`, `setSwatchValue()` | a radiogroup of colour squares |
| `tile` | `tile()` | an outlined card that navigates |
| `mode-controller` | `modeController()`, `setMode()`, `bindModeShortcuts()` | the editor's tool bar of seven chips |
| `key-command` | `kbd()`, `kbdChord()` | keycaps |
| `tooltip` | `tooltip()`, `attachTooltip()` | simple and complex tooltips on any anchor |
| `toast` | `showToast()`, `dismissToasts()` | transient status messages in one live region |
| `scrollbar` | (CSS only: `.ds-scroll`) | the thin thumb on native scrolling |
| `grab-bar` | `grabBar()`, `setGrabBarValue()` | a separator that resizes a panel |
| `loading` | `loading()` | the turning ring, in place of the Figma GIF |
| `asset-tile` | `assetTile()`, `setAssetTileSelected()`, `assetGrid()`, `setAssetGridColumns()` | a square picture with a caption, and the grid of them the browsers scroll |
| `floating-window` | `floatingWindow()` | the movable, resizable, collapsible panel the texture, object and NPC browsers share |

The Level Indicator spec is not a molecule: it belongs inside the outline tree when that is
built. Floating panels (menu, select list, tooltip, toast) are appended to `<body>` and
positioned by `popover.ts`, so a scrolling panel never clips them.

### 5.2 Conventions the molecules follow

- A drawn control sits on a native input that is visually hidden (`.ds-visually-hidden` in
  `base.css`), never `display: none`, so keyboard and assistive technology get the native
  behaviour: `:checked`, `:disabled` and `:focus-visible` on the input drive the drawing, through
  `:has()` on the wrapper where the input is not a sibling of the drawn part.
- Hover, pressed and selected states are layered background washes
  (`background-image: linear-gradient(wash, wash)`) over the fill, so nothing moves by a pixel.
  Hover rules sit under `@media (hover: hover)`.
- A setter never fires the molecule's `onChange`; it only moves the DOM to match the model.

## 6. Icons

The icon set is a folder of SVG files exported from the Figma file "Dungeon Builder", plus a
factory that turns a name into an inline `<svg>` element. Icons are not molecules: they hold
no state and no tokens of their own beyond size, and molecules and screens put them inside
buttons, rows and headings.

### 6.1 The set

All icons are 24×24 line drawings with round caps, drawn at a 1px line (`more` is three filled
dots). Names are the Figma layer names:

| Group | Icons |
|---|---|
| Tools | `sculpt`, `paint`, `hole`, `water`, `npc`, `container` (objects), `eyedropped` (eyedropper / pick) |
| Scene and file | `scene`, `save`, `download`, `play`, `reset`, `log-out`, `sun` (time of day / lighting) |
| Actions | `plus`, `minus`, `close`, `checkmark`, `search`, `menu`, `more`, `drag-to-expand` (resize grip) |
| Direction | `up`, `down`, `left`, `right` |
| Status | `info`, `help`, `alert` |

`eyedropped` keeps the Figma layer's spelling so a re-export overwrites it; rename it in Figma
and here together.

### 6.2 Using an icon

```ts
import { icon } from '../ui';

saveButton.prepend(icon('save'));                       // decorative, 20px
toolRow.append(icon('sculpt', { size: 'lg' }));          // 24px
closeButton.append(icon('close', { label: 'Close' }));   // the button's only content: name it
```

- `icon(name, { size?, label? })` returns `<svg class="ds-icon" data-icon="name">`. `name` is
  typed (`IconName`), so a missing icon is a type error; `iconNames` lists them all.
- **Colour** is `currentColor`: the icon takes the `color` of its parent (a button's text
  colour, a hovered row's, `--color-danger` for an error). Never set `fill` or `stroke` on an
  icon; set `color`.
- **Size** is `data-size`: `sm` 16px, `md` 20px (default), `lg` 24px, from
  `--icon-size-sm/md/lg`. A scope may override `--icon-size` on `.ds-icon` for a one-off.
- **Line width** is `--icon-stroke-width` (1px), kept in screen pixels at every size with
  `vector-effect: non-scaling-stroke`, so a 16px icon is as crisp as a 24px one.
- **Accessibility**: without `label` the icon is `aria-hidden` (the text next to it names the
  control). An icon-only button must pass `label`, or set `aria-label` on the button itself.
- In static markup in `index.html`, where no factory runs, call `icon()` from the code that
  wires that markup up rather than pasting SVG into the HTML.

### 6.3 Adding or updating an icon

1. Export it from Figma as SVG, 24×24, outlined to strokes, in the set's style (1px line,
   round caps and joins).
2. Normalise the file before adding it to `icons/`: remove `width`/`height` (keep
   `viewBox="0 0 24 24"`), replace the hex colour on `stroke`/`fill` with `currentColor`,
   remove any `stroke-width` (the token sets it), and remove Figma's `clip-path` wrapper and
   `<defs>`. Nothing in the file may name a colour.
3. Name the file in kebab case after the Figma layer, then add one `?raw` import and one entry
   to `sources` in `icons/index.ts`.
4. Updating an icon is replacing its file; its name and every use stay the same.

The files are inlined into the bundle at build time and parsed once each on first use (with
`DOMParser`, since they are the folder's own files, never user input); each `icon()` call
clones the parsed element.

## 7. Migrating what exists

`viewer.css` predates the system. It defines six colour variables on `:root` (`--panel`,
`--line`, `--text`, `--muted`, `--accent`, `--bad`), re-declares them under `#start` and
`body.wow-ui`, and hardcodes most other colours and sizes. The plan:

1. When the colour tokens land, point those six names at semantic tokens or rename their uses
   with a project-wide replace, and move the `body.wow-ui` block's values into `themes/wow.css`.
2. Move the base element rules (`button, select`, `button.primary`, `button.plain`, `.muted`,
   `.small`, `.bad`, `a`, `code`) into the molecule and type files as those are written.
3. Leave the remaining hardcoded values in place; replace each with a token when its rule is
   next touched. Do not sweep the file in one change.

The static markup in `index.html` keeps its class names (`.prop-row`, `.mode-row`,
`.browser-top`, `.primary`, `.plain`, `.active`); molecule CSS lists them beside the `.ds-*`
class (§5). New UI is built with factories. The one ad-hoc helper in code, `button()` in
`src/editor/scenesUi.ts`, is replaced by the button molecule when it exists.

### 7.1 Screens that have migrated

A screen (or a piece of one) migrates by building its DOM from molecules in the feature's own
module and keeping only its layout rules in page CSS, written with tokens. The pattern so far:

| Piece | Built by | Layout CSS | Spec |
|---|---|---|---|
| The Paint tool's texture browser (2026-10-30): a floating window with the sampled-chunk section and the texture grid, shown only in Paint mode | `src/editor/textureBrowser.ts` | `viewer.css`, "The browser windows" (`.asset-browser-*`) | `specs/texture-browser.md` |
| The Place tool's object browser (2026-10-30): the same window with a Doodads / Buildings segmented control, the model grid and a selection toast, shown only in Place mode | `src/editor/modelBrowser.ts` | the same `.asset-browser-*` rules | `specs/object-browser.md` |

Their markup left `index.html` and their old rules left `viewer.css`; the Paint and Place
panels keep their settings until the whole panel migrates.

## 8. Adding things: checklists

**A token**
1. Does an existing role mean the same thing? Use it.
2. Put it in the right file and tier, named by convention, with a one-line comment.
3. Give the theme(s) an override if the game look differs.

**A theme**
1. One file in `themes/`, one scope, semantic and type tokens only (§4).
2. Import it in `index.css` after the tokens.
3. Say here how the scope is set.

**An icon**
1. Normalise the SVG and add it to `icons/` as in §6.3.
2. One import and one `sources` entry in `icons/index.ts`.
3. List it in the table in §6.1.

**A molecule**
1. `molecules/<name>.css` and `molecules/<name>.ts` as in §5.
2. Export from `molecules/index.ts`; import the CSS in `index.css`.
3. If static markup has the same control, list its element or class in the root rule.
4. Add it to `gallery.html` (a section in `gallery.ts`), the dev-only page that shows every
   molecule in the default look. Open it at `/gallery.html` on the dev server.

**Checks before committing:** `bun run build` (type check plus Vite build) passes; no raw
colour or size in a molecule; nothing outside `src/ui` imports a molecule file directly.
