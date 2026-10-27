/**
 * Client tables for NPCs, character models and gear (spec 7.9), beyond the display tables in
 * display.ts: file IDs from the community listfile, and the field numbers Forever lays them out
 * with, as verified against a real install by tools/npcCheck.ts (see docs/phase5-verification.md).
 */
export const NPC_FILES = {
	ChrRaces: 1305311,
	ChrModel: 3384313,
	ChrRaceXChrModel: 3490304,
	ChrModelTextureLayer: 3548976,
	ChrModelMaterial: 3566562,
	CharComponentTextureLayouts: 1360262,
	CharComponentTextureSections: 1360263,
	ItemDisplayInfoMaterialRes: 1280614,
	ComponentTextureFileData: 1278239,
	Item: 841626,
	ItemSparse: 1572924,
	ItemAppearance: 982462,
	ItemModifiedAppearance: 982457,
} as const;

/** ChrRaces: the race's name. */
export const CHR_RACES_NAME = 2;

/** ChrModel: the sex the model is for, its CreatureDisplayInfo (which names the M2), and its texture layout. */
export const CHR_MODEL_SEX = 3;
export const CHR_MODEL_DISPLAY = 4;
export const CHR_MODEL_LAYOUT = 5;

/** ChrRaceXChrModel: race, model and sex. */
export const RACE_MODEL_RACE = 0;
export const RACE_MODEL_MODEL = 1;
export const RACE_MODEL_SEX = 2;

/** ChrCustomizationOption: name, the ChrModel it belongs to, its sort order and its category. */
export const OPTION_NAME = 0;
export const OPTION_MODEL = 4;
export const OPTION_SORT = 5;
export const OPTION_CATEGORY = 6;

/** ChrCustomizationChoice: name, its option, its order within the option, and its swatch colours (ARGB). */
export const CHOICE_NAME = 0;
export const CHOICE_OPTION = 2;
export const CHOICE_ORDER = 5;
export const CHOICE_SWATCH = 10;

/** ChrCustomizationElement: the choice it belongs to, the choice it also needs, its geoset and its material. */
export const ELEMENT_CHOICE = 0;
export const ELEMENT_RELATED = 1;
export const ELEMENT_GEOSET = 2;
export const ELEMENT_MATERIAL = 4;

/** ChrCustomizationGeoset: group and variant. */
export const GEOSET_GROUP = 0;
export const GEOSET_VARIANT = 1;

/** ChrCustomizationMaterial: the texture target it paints, and the material resource (texture) it paints with. */
export const MATERIAL_TARGET = 0;
export const MATERIAL_RESOURCE = 1;

/**
 * ChrModelTextureLayer (parent = CharComponentTextureLayouts ID): the runtime texture type it
 * goes into (1 skin, 6 hair, 19 eyes, ...), its order within that texture, its blend mode, the
 * bit mask of the texture sections it covers (all ones = the whole texture), and the targets it
 * takes its material from.
 */
export const LAYER_TEXTURE_TYPE = 0;
export const LAYER_ORDER = 1;
export const LAYER_BLEND = 3;
export const LAYER_SECTION_MASK = 4;
export const LAYER_TARGETS = 7;

/** CharComponentTextureLayouts: the composited skin's size. */
export const LAYOUT_WIDTH = 0;
export const LAYOUT_HEIGHT = 1;

/** CharComponentTextureSections (parent = layout): section type and its rectangle. */
export const SECTION_LAYOUT = 0;
export const SECTION_TYPE = 1;
export const SECTION_X = 2;
export const SECTION_Y = 3;
export const SECTION_WIDTH = 4;
export const SECTION_HEIGHT = 5;

/** ItemDisplayInfoMaterialRes (parent = ItemDisplayInfo): which section a gear texture covers, and its material resource. */
export const ITEM_MATERIAL_SECTION = 0;
export const ITEM_MATERIAL_RESOURCE = 1;

/** ComponentTextureFileData (ID = the texture file): the sex (0 male, 1 female, 3 either) and race (0 any) it is made for. */
export const COMPONENT_TEXTURE_SEX = 0;
export const COMPONENT_TEXTURE_RACE = 2;

/** TextureFileData: ID = the file; field 2 (and the parent) = its material resource. */
export const TEXTURE_FILE_MATERIAL = 2;

/** Item: the inventory slot the item goes in (see INVENTORY_SLOTS) and its icon. */
export const ITEM_INVENTORY_TYPE = 3;
export const ITEM_ICON = 7;

/** ItemSparse (sparse; strings inline, see SPARSE_STRINGS): the item's description and name. */
export const ITEM_SPARSE_DESCRIPTION = 0;
export const ITEM_SPARSE_NAME = 4;

/** ItemAppearance: the display it shows, and its icon (DefaultIconFileDataID). */
export const APPEARANCE_DISPLAY = 1;
export const APPEARANCE_ICON = 2;

/** ItemModifiedAppearance: the item, and its appearance. */
export const MODIFIED_ITEM = 1;
export const MODIFIED_APPEARANCE = 3;

/** ItemDisplayInfo: model resources, material resources, geoset groups and the helmet hide rule. */
export const DISPLAY_MODELS = 10;
export const DISPLAY_MATERIALS = 11;
export const DISPLAY_GEOSETS = 13;

/** CreatureDisplayInfo: model, scale, display extra (humanoids) and skin textures. */
export const CREATURE_MODEL = 1;
export const CREATURE_SCALE = 4;
export const CREATURE_EXTRA = 7;
export const CREATURE_TEXTURES = 27;

/** CreatureModelData: the model file. */
export const MODEL_FILE = 2;

/** CreatureDisplayInfoExtra: race and sex. */
export const EXTRA_RACE = 1;
export const EXTRA_SEX = 2;

/** NPCModelItemSlotDisplayInfo (parent = display extra): the item display and the NPC slot it's worn in. */
export const NPC_SLOT_DISPLAY = 0;
export const NPC_SLOT_SLOT = 1;

/**
 * Sparse tables keep their strings inline, and the file doesn't say which fields those are
 * (see Db2Options): ItemSparse's are its description, three unused names and the name.
 */
export const SPARSE_STRINGS: Record<number, number[]> = {
	[NPC_FILES.ItemSparse]: [0, 1, 2, 3, 4],
};
