# Texture Swap: build spec

Written 2026-11-04 from the product owner's outline and a review of the code. **There is no Figma
design:** the "-> Paint Panel" page (`45:5498`, file version `2416627902457405778`) has no swap
frames. Tags follow the other specs here: **Decided** means the product owner chose it, **Proposed**
means a default from this spec that they have not confirmed. Build Proposed items as written and
list them in your final report. If a design arrives, it wins on layout.

Read first: `CLAUDE.md`, `src/ui/DESIGN_SYSTEM.md`, [texture-browser.md](texture-browser.md),
[floating-window.md](floating-window.md), [asset-tile.md](asset-tile.md).

---

## 1. Summary

**Swap texture** is a new option in the Paint tool's Tool module. While it is on, the Texture
browser window becomes the **Texture swap** window, with two slots: the **existing texture** and
the **replacement texture**. Once both are filled, Shift+click on the ground replaces the existing
texture with the replacement across the whole chunk under the cursor. The chunk's blend does not
change: only which texture a layer points at.

**The user flow**

1. Choose **Swap texture** in the Tool module. The window shows two empty slots and no browser.
2. Click the Existing slot. The chunk sampler appears below. Sample a chunk and click a texture.
3. The Replacement slot becomes active. The sampler and the full browser appear. Click a texture.
4. Both slots are filled, so the browser closes and the window shrinks to the slots.
5. Shift+click or Shift+drag over chunks. Each chunk that uses the existing texture is swapped.
   One stroke is one undo step. The slots stay filled for further swaps.

## 2. Behaviour

### 2.1 Decisions

| # | Topic | Rule | Status |
|---|---|---|---|
| 1 | Reach | The chunk under the cursor only, like Fill chunk and Set chunk base. Dragging swaps each chunk crossed, once. | **Decided** |
| 2 | Replacement already in the chunk | Merge the layers so the texture is not listed twice (§3.3). | **Decided** |
| 3 | Chunk without the existing texture | Unchanged. One notice at stroke end, only if the whole stroke changed nothing. | **Decided** |
| 4 | After a pick | If the other slot is empty it becomes active. If both are filled, no slot is active, the browser hides and the window shrinks. | **Decided** |
| 5 | Empty slot on paint | A notice, no stroke (§2.3). | **Decided** |
| 6 | Existing slot's picker | The chunk sampler only. | **Decided** |
| 7 | Replacement slot's picker | The chunk sampler and the full browser. | **Decided** |
| 8 | Strength | The swap is always complete. Strength, Opacity, Size and Full chunk do not apply, and their modules are hidden in this mode. | **Proposed** |
| 9 | Clutter | The swapped layer takes the replacement's usual ground effect (`effectFor`), as Set base does. In a merge, a replacement layer already in the chunk keeps its `effectId`. | **Proposed** |
| 10 | Same texture in both slots | Allowed to be picked, but painting gives a notice and no stroke. | **Proposed** |
| 11 | Clearing a slot | Click its selected tile again, matching the browser's un-select. The slot stays active. | **Proposed** |
| 12 | Clicking the active slot | Deactivates it: the browser hides and the window shrinks. | **Proposed** |
| 13 | Esc | Cancels sampling if armed; otherwise deactivates the active slot. | **Proposed** |
| 14 | Sample results | One shared sample: results stay when moving between the slots and the normal browser. They are not refreshed after a swap, like painting today. | **Proposed** |
| 15 | Lifetime | Slots persist while switching tools and modes, and reset with the scene (`editor.paint` is per scene). They do not touch the brush's texture, `paint.fdid`. | **Proposed** |
| 16 | Unavailable textures | In the Existing slot, a sampled texture that is not in the local install **stays pickable**, since replacing it is a likely use. It stays dimmed and disabled for the Replacement slot (§4.3). | **Proposed** |

### 2.2 Input

Shift+click and Shift+drag run the swap. Cmd/Ctrl+click also runs it, because the Paint tool
already ignores which modifier started the stroke (`sceneEditor.ts:1617`); leave that as it is. The
ground ring is the small fixed ring Fill chunk uses (`updateRings` already gives radius 2 to every
mode except paint and erase).

### 2.3 Notices (Proposed copy)

All go through `editor.onNotice`, the existing notice box.

| When | Text |
|---|---|
| Both slots empty | Choose the existing and replacement textures in the Texture swap window first |
| Existing empty | Choose the existing texture in the Texture swap window first |
| Replacement empty | Choose the replacement texture in the Texture swap window first |
| Same texture in both | The existing and replacement textures are the same |
| Stroke changed nothing | That chunk doesn't use the existing texture |

## 3. Data: `src/editor/paint.ts`

### 3.1 Types

- Add `'swap'` to `PaintMode`, and `swap: 'Swap texture'` to `PAINT_LABELS`.
- Add `swapFrom: number` and `swapTo: number` to `PaintSettings`, FileDataIDs with 0 for empty, like
  `fdid`. Initialise both to 0 in `sceneEditor.ts:308`.
- `tests/paint.test.ts:18` builds a whole `PaintSettings`, and `tsc` includes `tests`, so add the
  fields there too.

### 3.2 `swapChunk`

Add `case 'swap'` to `PaintStroke.apply`. `apply` already gives every non-brush mode a 0.01 reach,
so the chunk selection needs no change. Follow `setBase`:

1. Skip the chunk if `visited` has it; otherwise add it.
2. Find layers by **FileDataID**, `model.textures[layer.texture]`, not by palette index:
   `from` = those equal to `swapFrom`, `to` = those equal to `swapTo`. A chunk can hold the same
   texture twice, because Set base allows it (`paint.ts:329`), so expect more than one match.
3. If `from` is empty, return without touching anything. Do not call `touch` or `textureIndex`
   before this point: the palette only grows, so an early call would leave an unused entry.
4. `touch` the chunk and get `paletteIndex = model.textureIndex(swapTo)`.
5. If there is one `from` layer and no `to` layer, repoint it:
   `layers[i] = { texture: paletteIndex, effectId: effectFor(swapTo) || undefined }`. Alpha is
   untouched. Layer 0 needs no special case.
6. Otherwise merge (§3.3).
7. Call `model.markDirty(tile)`. This is a structural change, so `markAlphaDirty` is not enough.

`finish()` needs no change: it already snapshots layers and alpha, drops no-ops, and undo goes
through `restorePaint`, which handles a changed layer count.

### 3.3 Merge

The group is every `from` and `to` layer. The shader weighs layers 1-3 by alpha and layer 0 by the
remainder, so merging can be exact:

1. The survivor is the group's **lowest** index, `k`.
2. If `k` is 0, the other members are simply removed: their weight falls through to layer 0, whose
   weight is 255 minus the sum of the rest.
3. If `k` is 1 or more, for each texel set the survivor's alpha to the sum of the group's alphas,
   clamped to 255.
4. `layers[k] = { texture: paletteIndex, effectId }`, where `effectId` is that of the first `to`
   layer if there is one, else `effectFor(swapTo) || undefined`.
5. Remove the other members from `layers`, and rebuild `alpha` from the remaining slices, in order.
6. **If one layer is left, `alpha` must be `null`, not an empty array.** `wscene.ts:95` writes any
   truthy alpha, and loading then throws "has one layer but an alpha map" (`wscene.ts:327`), so the
   scene would save but never reopen.

| Before (layer: per-texel weight) | After |
|---|---|
| `BASE`:105, `OLD`:100, `NEW`:50 | `BASE`:105, `NEW`:150 |
| `OLD`:155, `A`:60, `NEW`:40 | `NEW`:195, `A`:60 |
| `NEW`, `OLD` | `NEW` alone, `alpha` null |
| `OLD`:155, `X`:60, `OLD`:40 | `NEW`:195, `X`:60 |

This is the first edit that removes a layer directly. Undoing a paint that added a layer already
reduces the count through `restorePaint`, so the tile rebuild and the atlas cope with fewer layers.

### 3.4 `sceneEditor.ts`

In `beginStroke` (`:1500`), check swap first. The current gate would otherwise show "Pick a texture
in the Texture browser" whenever the brush has no texture, and would wrongly block a valid swap:

```ts
if (this.tool === 'paint') {
	if (this.paint.mode === 'swap') {
		// notices per §2.3; return if a slot is empty or both are the same
	} else if (this.paint.fdid === 0 && this.paint.mode !== 'erase') {
		// existing notice and return
	}
	this.stroke = new PaintStroke(this.model, this.paint, this.effectFor);
	return;
}
```

In `endStroke` (`:1546`), if the stroke was a swap and `finish()` returned null, show the
"Stroke changed nothing" notice. Read the mode from `this.paint` before clearing the stroke.

## 4. UI

### 4.1 Tool panel: `editorPanels.ts`, `buildPaint` (`:521`)

- Add `{ value: 'swap', label: 'Swap texture', info: {...} }` after Set chunk base, and an `infoTips`
  entry. **Proposed** tip: "Replace one texture with another across a whole chunk, keeping its blend."
- `PAINT_KEYS.swap = [SHIFT_CLICK('Swap')]` (`:102`).
- In `sync`, hide the Size, Strength, Opacity and Full chunk modules when `paint.mode === 'swap'`,
  and call `this.textures.setSwapMode(paint.mode === 'swap')`. Check the last visible module still
  looks right: `.dock-module:last-child` (`viewer.css:292`) still matches a hidden module.
- `description` (`:583`) **Proposed** copy for swap mode, replacing "Paint up to four textures per
  chunk.", which is wrong here:
  - sampling: "Click a chunk to list the textures it uses; click one to fill the slot. Esc cancels."
  - a slot empty: "Choose the existing and replacement textures in the Texture swap window."
  - both filled: "Shift + click a chunk to swap its texture, keeping the blend."
- `wireKeys` (`:1196`): after the sampling check, add the Esc rule from §2.1 #13, only while the
  Paint tool is in swap mode with an active slot.

`setSampling` and `onChunkClick` (`:596`) need no change.

### 4.2 Window: `textureBrowser.ts`

Use the **same window and class** as the Texture browser, so the list, thumbnails, position and
search are shared, and nothing loads twice. Keep the id `texture-browser`, which also means
`body.playing` hides it as before.

**Proposed layout:**

```
┌ Texture swap ─────────────── – ┐
│ Existing        Replacement    │   slots section: always shown, flex: none
│ ┌──────┐   →    ┌──────┐       │   each slot: heading above an asset tile
│ │ tile │        │ tile │       │   `right` icon between them
│ └──────┘        └──────┘       │
├────────────────────────────────┤
│ Sampled textures             ^ │   existing .texture-browser-sample section
├────────────────────────────────┤
│ grid/list, search, tile size   │   existing .asset-browser-main
│ grid                           │
│ count, refresh, picked         │
└────────────────────────────────┘
```

| State | Slots | Sampled textures | Browser | Window height |
|---|---|---|---|---|
| No active slot | shown | hidden | hidden | hugs content |
| Existing active | shown | shown, forced open, chevron hidden | hidden | hugs content |
| Replacement active | shown | shown, collapsible | shown | stored height, at least the minimum below |
| Swap mode off | hidden | shown | shown | stored height (today's window) |

If sampling is armed when the sampler hides (the active slot goes to none), disarm it through
`onSampleRequest(false)`; otherwise the next ground click would sample invisibly.

**Slots.** Each is an `assetTile` in the grid layout, with its own canvas and a heading
(`--type-label`) above it. `selected` means active. Empty shows the inset fill and the caption
"Empty"; filled shows the thumbnail and `labelOf(fdid) ?? textureName(fdid)`, set through the tile
handle's `label` and `root.title`. Refresh the captions at the end of `loadEntries`, as a slot can
be filled before the list arrives. Factor the canvas-drawing half of `draw` (`:379`) into a helper
that takes a canvas and FileDataID, loading through `thumbCache` so both tiles and slots use it.

**Picks.** `this.selected` is read in several places (`:237`, `:248`, `:267`, `:272`). Add a
`currentPick()` that returns the active slot's FileDataID in swap mode and `this.selected` otherwise,
and use it where tiles show selection. Then branch in `pick`:

- Not swap mode: unchanged.
- Swap mode with an active slot: if the slot already has this texture, clear it and keep it active.
  Otherwise set it and apply §2.1 #4. Report through a new callback,
  `onSwapPick(slot: 'existing' | 'replacement', fdid: number)`, where `EditorPanels` writes
  `paint.swapFrom` or `paint.swapTo` and calls `syncActive()`. Never call `onPick` here, as that
  would overwrite the brush texture.

The active slot is UI state and lives in `TextureBrowser`; the two FileDataIDs live in
`editor.paint`, where the stroke needs them. Footer `syncPicked` (`:271`) in swap mode: "Swapping in
{name}" or "No replacement chosen".

**Title.** "Texture swap" in swap mode, "Texture browser" otherwise.

### 4.3 Sampled tiles in the Existing slot

`makeItem` (`:238`) fixes `disabled` when the tile is built, from the file's status. A sampled tile
for a texture missing from the local install therefore could not be picked, which breaks §2.1 #16.
Add `setAssetTileDisabled(root, disabled)` beside `setAssetTileSelected` in `asset-tile.ts`, and
in `renderSample` set each sampled tile to enabled when the Existing slot is active, otherwise by
its status. A picked unavailable texture has no thumbnail: the slot shows the inset fill and name.

### 4.4 `floating-window.ts`: two additions

The handle has no way to change its title or display height. Add both, and document them in
[floating-window.md](floating-window.md):

- `setTitle(title: string)`: updates the heading and the labels built from it, on the header, the
  grip and the collapse toggle. `setCollapsed` currently reads `options.title`, so hold it in a
  variable.
- `setHeightFit(fit: 'hug' | { minHeight: number } | null)`: a display-only override. It never
  changes the stored height, so the normal browser keeps its size.
  - `'hug'`: height follows content, and the grip is hidden.
  - `{ minHeight }`: displayed height is `max(stored, minHeight)`, limited to the viewport. A grip
    drag starts from the displayed height and commits normally.
  - `null`: today's behaviour.
  - **The bottom edge stays put** in every case, since the window lives at the bottom left: it grows
    and shrinks upward, and its top never leaves the viewport.

**Minimum height: Proposed 680px.** At the default 487px, the slots, the sampler with results, the
toolbar and the footer are estimated from the CSS to leave the grid little or no room (not
measured). Measure it in the browser pane and adjust the number so the grid shows at least two rows
of tiles at the default tile size. On a short viewport the body should scroll rather than clip.

**Measured 2026-11-04 (built as 790px):** at 680px, with one sampled texture showing, the grid had
97px, one row of the 92px tiles the 360px window gives at the default tile size; two rows with
their gap need 201px, so the minimum is 790px (`SWAP_MIN_HEIGHT` in `textureBrowser.ts`). On a
900px viewport that reaches the top bar; collapsing the sampler gives the grid the room instead.

### 4.5 CSS

Add the slots section beside `.texture-browser-sample` in `viewer.css`, tokens only, following the
"browser windows" block's convention (`viewer.css:533`). Introduce no raw colours.

## 5. Files

| File | Change |
|---|---|
| `src/editor/paint.ts` | §3.1 to §3.3 |
| `src/editor/sceneEditor.ts` | §3.1 initial values, §3.4 |
| `src/editor/editorPanels.ts` | §4.1 |
| `src/editor/textureBrowser.ts` | §4.2, §4.3 |
| `src/ui/molecules/floating-window.ts` | §4.4 |
| `src/ui/molecules/asset-tile.ts` | §4.3 |
| `src/viewer/viewer.css` | §4.5 |
| `tests/paint.test.ts` | §6, and the §3.1 helper fields |
| `src/ui/specs/texture-browser.md`, `floating-window.md`, `asset-tile.md` | Point to this spec; document the new APIs |
| `../wow-dungeon-builder-spec.md` line 500 | Replace "Replace texture in selection" with this tool. The file is outside the git repository. |

**Suggested commits** (`CLAUDE.md` asks for one per feature): the stroke and its tests, then the two
molecule additions, then the window and panel.

## 6. Tests

Add to `tests/paint.test.ts`, under `describe('texture swap')`. Each builds its chunk with
`paintAt`, then runs a swap stroke at a point inside the chunk.

1. Painted layer: repointed, alpha byte-identical, layer count unchanged.
2. Base layer: `layers[0]` repointed, other layers and alpha untouched.
3. Chunk without `swapFrom`: `finish()` is null, and `model.textures` did not grow.
4. Merge between two painted layers: one fewer layer, sums correct, other layers intact.
5. Merge with `swapTo` as base: the `swapFrom` layer is removed, base weight absorbs it.
6. Merge with `swapFrom` as base: `layers[0]` becomes `swapTo`, the old `swapTo` layer is removed.
7. Merge down to one layer: `alpha === null`, and the scene survives a save and load through
   `wscene`, following `tests/wscene.test.ts`.
8. Duplicate `swapFrom` layers (made with `mode: 'base'`): all go, none remain.
9. Every merge keeps each texel's painted-layer sum at most 255.
10. Effect: `effectFor(swapTo)` is applied on repoint; a merge keeps the existing `swapTo` layer's.
11. A stroke over two chunks, with repeated `apply` calls: both swap, one command, and undo then redo
    restore both exactly.

## 7. Acceptance

Run `bun run build` and `bun test` (bun is at `~/.bun/bin`). `CLAUDE.md` limits browser testing, so
use it for the window states and heights, which reading code cannot settle, and ask the product
owner to judge the feel.

**Window**

- [ ] Swap texture appears in the Tool module with a Shift + click hotkey row beneath it.
- [ ] Choosing it retitles the window and shows two empty slots with no browser, and hides the Size,
      Strength, Opacity and Full chunk modules.
- [ ] Clicking Existing shows only the sampler; clicking Replacement shows the sampler and browser.
- [ ] A pick advances to an empty slot; with both filled, the browser hides and the window shrinks,
      with its bottom edge unmoved.
- [ ] Clicking a slot's selected tile clears it. Clicking the active slot closes the browser.
- [ ] Leaving swap mode restores the normal browser at its stored size, with the brush texture and
      "Painting with" line unchanged.
- [ ] A missing-from-install sampled texture can fill Existing but not Replacement.

**Painting**

- [ ] Shift+click with an empty slot gives the matching notice and changes nothing, including when
      the brush has no texture.
- [ ] A swap keeps the chunk's blend visibly identical apart from the texture.
- [ ] Shift+drag swaps each matching chunk crossed; one undo reverts all of them.
- [ ] A stroke over no matching chunk gives one notice; a stroke with at least one match gives none.
- [ ] A chunk that already had the replacement merges with no visible seam in the blend.
- [ ] Ground clutter updates to the replacement's after the stroke, when Show clutter is on.
- [ ] A swapped scene saves and reopens, including a chunk merged down to one layer.
- [ ] In a copied scene, the Revert tool's Textures channel restores a swapped chunk.

## 8. Out of scope

Swapping across a whole tile or scene, a button that exchanges the two slots, a hotkey for the mode,
choosing a layer's ground effect by hand, and a live refresh of sampled results after a swap.
