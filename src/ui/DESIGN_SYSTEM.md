# Design system

How the UI of WoW Dungeon Builder is styled and built, and how to extend it. Read this before
adding a colour, a font size or a control anywhere in the app. The system is plain CSS custom
properties and plain TypeScript factories, with no framework, because that is how the rest of
the app is built (DOM made by hand in `src/editor` and `src/viewer`, one stylesheet in
`src/viewer/viewer.css`).

**Status:** the colour tokens are defined (from the Figma file "Dungeon Builder", mode
"Mode 1"); type and layout tokens, the game theme's overrides and the molecules are not yet. The
placeholder files say what goes in them. Fill them in the order of §7.

## 1. Layout

```
src/ui/
├── DESIGN_SYSTEM.md      this file
├── index.css             the one stylesheet index.html links: tokens → themes → molecules
├── index.ts              the one import for code: re-exports molecules/
├── tokens/
│   ├── color.css         palette (tier 1) and semantic colours (tier 2)
│   ├── type.css          families, sizes, weights, line heights, and the type roles
│   └── layout.css        spacing, radii, line widths, motion, z-index
├── themes/
│   └── wow.css           the game's look: semantic tokens overridden under body.wow-ui
└── molecules/
    ├── index.ts          one export line per molecule
    ├── <name>.ts         a factory returning an element  (added per molecule)
    └── <name>.css        its styles, on .ds-<name>        (added per molecule)
```

Rules of the layout:

- A file holds one kind of thing. Tokens never style an element; a molecule never defines a
  raw colour; a theme never contains a selector other than its scope.
- `index.css` and `index.ts` are the only entry points. Nothing outside `src/ui` imports a
  token or molecule file directly.
- New kinds of file (a second theme, an "organism" folder for composed panels) are added at
  this level and listed here.

## 2. Cascade and consumption

`index.html` links `src/ui/index.css` before `src/viewer/viewer.css`. Vite inlines the
`@import`s. The order inside `index.css` is the cascade:

1. **Tokens** declare custom properties on `:root`.
2. **Themes** redeclare semantic tokens on a scope (a class on `<body>`, or any element).
3. **Molecules** read tokens and style their own class, and the bare element where the static
   markup in `index.html` should look the same (see §5).

Page CSS (`viewer.css` and any future per-screen stylesheet) comes after, so a screen can
override a molecule for its own layout with an ordinary selector. Page CSS takes tokens with
`var(--…)` and never restates a value a token holds.

Code imports from `src/ui` only:

```ts
import { button } from '../ui';
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

Primitives, then roles:

- Families: `--font-family-ui`, `--font-family-display` (headings, names), `--font-family-book`
  (pages of prose), `--font-family-numeric`, `--font-family-mono`.
- Sizes `--font-size-xs … -3xl` on a fixed scale; weights `--font-weight-regular/medium/semibold`
  plus `--font-weight-heading`; line heights `--line-height-tight/normal/relaxed`.
- Roles `--type-<role>` (`body`, `caption`, `label`, `heading`, `title`, `display`, `mono`,
  `book`): each a complete `font` shorthand, so a rule reads `font: var(--type-caption)` and a
  theme can change a role's whole look at once.

The file ends with the few utility classes markup may use directly (`.muted`, `.small`, and a
`.type-<role>` per role). Nothing else in the system is a utility class.

### 3.3 Layout (`tokens/layout.css`)

`--space-1 … -8` on a 2px-based scale, `--radius-sm/md/lg/xl`, `--border-width`,
`--focus-ring`, `--duration-fast/slow`, and `--z-<layer>` for stacking. A molecule pads, gaps
and layers only with these.

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
- Where `index.html` has static markup for the same control, the rule also lists the bare
  element or the legacy class so both render the same: `button, .ds-button { … }`,
  `.ds-field, .prop-row { … }`. This is how the static markup migrates without rewriting it.
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

The first molecules to make, from the controls the editor's panels already use: `button`
(default, primary, plain; pressed state), `toggle-group` (the `.mode-row` button rows),
`field` with `slider`, `number-input`, `select`, `text-input`, `checkbox` (the `.prop-row`
rows), and `search-box` (the asset browsers' `.browser-top`).

## 6. Migrating what exists

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

## 7. Adding things: checklists

**A token**
1. Does an existing role mean the same thing? Use it.
2. Put it in the right file and tier, named by convention, with a one-line comment.
3. Give the theme(s) an override if the game look differs.

**A theme**
1. One file in `themes/`, one scope, semantic and type tokens only (§4).
2. Import it in `index.css` after the tokens.
3. Say here how the scope is set.

**A molecule**
1. `molecules/<name>.css` and `molecules/<name>.ts` as in §5.
2. Export from `molecules/index.ts`; import the CSS in `index.css`.
3. If static markup has the same control, list its element or class in the root rule.
4. Add it to a gallery page once one exists (a dev-only `gallery.html` showing every molecule
   in the default look is the intended way to eyeball changes without loading the game).

**Checks before committing:** `bun run build` (type check plus Vite build) passes; no raw
colour or size in a molecule; nothing outside `src/ui` imports a molecule file directly.
