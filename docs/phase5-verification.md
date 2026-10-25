# Phase 5 client verification (spec §12, Phase 5; Q8 and Q9)

Phase 5 asked two things to be verified against a real client before the NPC features were
built: where gear names come from (Q8), and whether a humanoid creature display's baked outfit
maps back to the custom NPC editor's inputs (Q9). `bun run npccheck -- [wowDir] [product]`
runs the check (tools/npcCheck.ts); this file records the results and the decisions made on them.

## Checked build

| | |
|---|---|
| Product | `wow_classic_beta` (Forever beta) |
| Version | 1.60.1.70532 (`WOW-70532patch1.60.1_Beta`) — the client updated since the Phase 1 check (70450) |
| Date | 2026-10-25 |
| Result | **11/11 checks pass** |

## Q8: where do gear names come from?

**Answer: ItemSparse.db2, through ItemModifiedAppearance → ItemAppearance → ItemDisplayInfo, as
expected — but only for gear that is an item.** 

- ItemSparse is a **sparse** (offset map) table whose strings are inline: 19,179 rows, every one
  named. The DB2 reader did not support sparse tables; it does now (`Db2Options.inlineStrings`,
  registered per table in npcTables.ts). In Forever's layout the five strings come first in the
  record: description, three unused names, then the name (field 4).
- Of 42,524 item displays, 9,024 are reachable from an item and **4,450 carry a name**. Items
  also give the slot (Item.InventoryType), so named gear can be browsed per equipment slot.
- What NPCs wear is mostly NPC-only gear with no item behind it: of the 15,234 distinct displays
  in NPCModelItemSlotDisplayInfo, only 1,158 have a name. The Stormwind guard's helm is
  "Imperial Plate Helm"; its shoulders, chest, belt, legs, boots, gloves and tabard are unnamed.

**Decision:** ship both halves of the spec. The gear browser lists named displays by name, per
slot from Item.InventoryType, and NPC-worn displays as well, with their slot from
NPCModelItemSlotDisplayInfo and a label from their texture or model path in the community
listfile's item part (the path-based fallback). Named entries sort first.

## Q9: "Customize as new" on humanoid displays

**Answer: it maps cleanly; the feature ships.**

- 9,099 creature displays are humanoid (they have a CreatureDisplayInfoExtra). Race and sex come
  from the extra row; the customization choices from CreatureDisplayInfoOption; worn gear from
  NPCModelItemSlotDisplayInfo.
- For **9,098 of 9,099** displays every customization choice belongs to an option of the race and
  sex's ChrModel (via ChrRaceXChrModel), so the choices drop straight into
  `NpcPreset.customization` (option ID → choice ID). One display has a stray choice, which is
  simply left out.
- NPC gear slots are 0 head, 1 shoulder, 2 shirt, 3 chest, 4 waist, 5 legs, 6 feet, 7 wrist,
  8 hands, 9 tabard, 10 back, each an ItemDisplayInfo ID, so they fill `NpcPreset.equipment`
  directly. Weapons are not in the client (they come from server data), so a customized display
  starts with empty hands.

## The character pipeline the custom NPCs are built on

Everything the custom NPC editor needs joins up with Forever's native layouts (field numbers in
src/explorer/npcTables.ts):

- **Models:** ChrRaceXChrModel lists 116 race/sex models; every one resolves through ChrModel →
  CreatureDisplayInfo → CreatureModelData to a readable M2 (the HD models; e.g. human male →
  1011653). 26 rows belong to sexless forms whose ChrModel says sex 3; the playable races say 0/1.
- **Customization:** human male has 10 options (Skin Color 19 choices, Face 12, Hair Style 17,
  Hair Color 14, Eye Color 41, Face Shape 3, Eyebrows 12, Eye Style 3, Ears 1, Facial Hair 9).
  ChrCustomizationOption.ChrModelID (field 4) ties options to models; choices carry a swatch
  colour (field 10, ARGB) where they have no name.
- **Textures:** every ChrModel has a CharComponentTextureLayout (2048×1024 for the playable HD
  models; 1024×1024, 1024×512 and 512×512 elsewhere) with body sections 0–7 (arms, hands,
  torso, legs, feet) and, on HD layouts, face sections 9 and 10. ChrModelTextureLayer lists the
  skin's layers (texture type 1) in order, each with the section mask it paints and a blend mode
  (1 base copy; 6, 7, 9 and 15 seen for the rest, all drawn as alpha blends), and the hair (6)
  and eye (19) textures that bind directly. 2,999/3,000 sampled customization materials and
  3,000/3,000 sampled gear texture sections resolve to readable textures; gear textures come per
  sex where the item has them (ComponentTextureFileData).
- **Creature displays:** 14,200 displays have a model, 14,186 are readable, over 1,017 distinct
  model files (the NPCs tab groups displays by model). CreatureModelData's collision width and
  height fields read the same for every model in this build (0.611 / 2.031), so NPC capsules are
  sized from the model's bounds instead.

## Gaps and notes

1. ChrModelTextureTarget.db2 is not in this build's root; it isn't needed (ChrModelTextureLayer
   names the targets directly).
2. Blend modes 6, 7 and 9 of ChrModelTextureLayer are not documented; they are drawn as plain
   alpha blends, which may shade some skin overlays slightly differently from the client.
3. The Phase 1 compatibility check should be re-run on build 70532 (`bun run compat`); see
   forever-compat.md.
