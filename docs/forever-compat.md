# Forever compatibility check (spec §7.1.1)

Phase 1 requires verifying every parser reused from ClassicWowMapExplorer against a real WoW
Forever client before Phase 2 starts. `bun run compat -- [wowDir] [product]` runs the check
(tools/compat.ts); this file records the results.

## Checked build

| | |
|---|---|
| Product | `wow_classic_beta` (Forever beta) |
| Version | 1.60.1.70532 (`WOW-70532patch1.60.1_Beta`); first checked on 70450 (2026-10-20) |
| Date | 2026-10-25 |
| Result | **40/40 checks pass** (on both builds) |

## What was verified

- **CASC storage** opens the install: 2,472,017 index entries, 20,647 encoding pages,
  1,244,512 root files.
- **Every DB2 table the spec relies on** parses as WDC5 with its **native layout** — the field
  numbering the code uses is Forever's own, so no field map is needed (db2Layouts.ts maps other
  versions *to* Forever numbering): Map, Light/LightData/LightParams, LiquidType, AreaTable,
  AreaPOI, TerrainType, UiMap/UiMapAssignment, WMOAreaTable, GroundEffectTexture/Doodad,
  CreatureDisplayInfo (+Extra, +Option), CreatureModelData, ItemDisplayInfo,
  NPCModelItemSlotDisplayInfo, HelmetGeosetData, ModelFileData, ComponentModelFileData, and the
  five ChrCustomization* tables.
- **Table contents join up:** 69 maps resolve to readable WDTs (Azeroth and Kalimdor among
  them); 57 liquid types with an ocean type (1250); all 1,981 sampled GroundEffectTexture doodad
  references resolve against GroundEffectDoodad.
- **ADT** (Elwynn 32_48): root parses to 256 chunks with finite 145-vertex height grids, 43 MH2O
  liquid instances; `_tex0` parses to 7 textures, 4-layer chunks with 64×64 alpha maps and 893
  layers carrying ground effect IDs; `_obj0` parses to 785 doodad and 8 WMO placements.
- **BLP** decodes a tileset texture (256×256 RGBA).
- **M2** parses a placed doodad (version 272) with vertices, a skin and a collision mesh.
- **WMO** parses a placed building's root (289 groups, 195 materials, doodad sets) and a group's
  geometry.
- **Characters:** 10 playable races resolve looks, 9 with SD models and all 10 with HD — both
  sides of Forever's SD/HD model toggle are present and resolve. 198/200 sampled
  CreatureDisplayInfo entries resolve through CreatureModelData to readable M2s.

## Gaps and notes (recorded per §7.1.1)

1. **Encrypted DB2 sections are skipped**, as designed (clientDb.ts): Map (3 sections),
   AreaTable (3), Light (2), CreatureDisplayInfo (10), CreatureDisplayInfoExtra (1),
   CreatureDisplayInfoOption (1), ItemDisplayInfo (7), NPCModelItemSlotDisplayInfo (1). These
   hide unreleased content behind license keys; the rows the builder needs are in open sections.
   Matches the EncryptedError edge case in spec §11.
2. **2 of 200 sampled creature displays** point at models not readable locally (encrypted or
   not in local storage). The missing-reference handling in spec §7.11 covers this: such
   displays render as labeled placeholders.
3. **No layout gaps.** Risk R1 (Forever files differing from what the parsers expect) has not
   materialized for this build: every table reads with its native Forever layout, and the file
   formats (ADT/BLP/M2/WMO, M2 version 272) parse cleanly.

## Re-running

The check should be re-run when the client updates, and at Forever's launch (spec Q10 — the
launch product code and folder name go in src/viewer/clientConfig.ts):

```
bun run compat -- "/Volumes/SANDISK SSD/World of Warcraft" wow_classic_beta
```
