import type { CascStorage, FileStatus } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import type { EquipSlot, NpcAppearance, NpcPreset } from '../scene/types';
import { CharacterBuilder, NPC_SLOT, SLOT_BY_NPC, type BuiltLook, type CharacterModelInfo, type CustomizationOption } from './characterBuilder';
import { loadTable } from './clientDb';
import { DISPLAY_FILES, type DisplayResolver } from './display';
import type { M2Options } from './objects';
import {
	APPEARANCE_DISPLAY, APPEARANCE_ICON, CREATURE_EXTRA, CREATURE_MODEL, CREATURE_SCALE, EXTRA_RACE, EXTRA_SEX, ITEM_ICON, ITEM_INVENTORY_TYPE, ITEM_SPARSE_NAME, MODEL_FILE, MODIFIED_APPEARANCE,
	MODIFIED_ITEM, NPC_FILES, NPC_SLOT_DISPLAY, NPC_SLOT_SLOT,
} from './npcTables';
import { VirtualTextures } from './virtualTextures';

export type { CharacterModelInfo, CustomizationChoice, CustomizationOption } from './characterBuilder';

/** A CreatureDisplayInfo entry for the NPCs tab (spec 7.9.2): one model plus one skin variant. */
export interface CreatureDisplaySummary {
	id: number;
	/** The model's file, which the tab groups by. */
	model: number;
	/** The display's own scale (CreatureModelScale). */
	scale: number;
	/** A pre-baked humanoid (CreatureDisplayInfoExtra): offers "Customize as new". */
	humanoid: boolean;
	status: FileStatus;
}

/** An item display the gear browser offers for a slot (spec 7.9.3, Q8). */
export interface GearDisplay {
	id: number;
	slot: EquipSlot;
	/** The item's name, where an item carries this display; null for NPC-only gear, labelled by path instead. */
	name: string | null;
	/** A file of the display (a texture section or its model), for the path label and the local status. */
	file: number;
	/** The item's icon (ItemAppearance's, else Item's), for the gear browser's pictures; 0 for NPC-only gear. */
	icon: number;
	status: FileStatus;
}

/** What a humanoid creature display maps back to for "Customize as new" (Q9). */
export interface HumanoidPreset {
	race: number;
	sex: 0 | 1;
	customization: Record<string, number>;
	equipment: Partial<Record<EquipSlot, number>>;
}

/** Item.InventoryType -> the equipment slot it fills (others, like rings, dress nothing). */
const INVENTORY_SLOTS: Record<number, EquipSlot> = {
	1: 'head', 3: 'shoulder', 4: 'shirt', 5: 'chest', 20: 'chest', 6: 'waist', 7: 'legs', 8: 'feet', 9: 'wrist', 10: 'hands', 16: 'back', 19: 'tabard',
	13: 'mainHand', 17: 'mainHand', 21: 'mainHand', 14: 'offHand', 22: 'offHand', 23: 'offHand', 15: 'ranged', 25: 'ranged', 26: 'ranged',
};
const INVENTORY_SHIELD = 14;

interface GearTables {
	byDisplay: Map<number, GearDisplay>;
	shields: Set<number>;
}

/**
 * The worker's NPC data (spec 7.9): the creature displays to place, the character models to dress
 * and their customization, the gear to browse with its names (Q8), humanoid displays turned back
 * into presets (Q9), and the look of any NPC appearance for the model loader.
 */
export class NpcTables {
	private readonly virtual = new VirtualTextures();
	readonly builder: CharacterBuilder;
	/** Custom presets the page has defined, by the handle it loads them under. */
	private readonly presets = new Map<number, NpcPreset>();

	constructor(private readonly storage: CascStorage, private readonly displays: DisplayResolver) {
		this.builder = new CharacterBuilder(storage, displays, this.virtual, async (display) => (await this.gear()).shields.has(display));
	}

	/** A composited texture the renderer asked for by its virtual file ID, or null. */
	virtualTexture(fdid: number) {
		return VirtualTextures.isVirtual(fdid) ? this.virtual.get(fdid) : null;
	}

	private creatureTables: Promise<{ creatureDisplay: Db2; creatureModel: Db2; displayExtra: Db2; displayOption: Db2; slots: Db2 }> | null = null;

	private creature() {
		this.creatureTables ??= (async () => {
			const [creatureDisplay, creatureModel, displayExtra, displayOption, slots] = await Promise.all([
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfo), loadTable(this.storage, DISPLAY_FILES.CreatureModelData), loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfoExtra),
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfoOption), loadTable(this.storage, DISPLAY_FILES.NPCModelItemSlotDisplayInfo),
			]);
			return { creatureDisplay, creatureModel, displayExtra, displayOption, slots };
		})();
		return this.creatureTables;
	}

	/** Every creature display with a model file, readable or not (greyed when not local, spec 7.1). */
	async listCreatureDisplays(): Promise<CreatureDisplaySummary[]> {
		const { creatureDisplay, creatureModel, displayExtra } = await this.creature();
		const out: CreatureDisplaySummary[] = [];
		for (const id of creatureDisplay.ids()) {
			const model = creatureModel.getInt(creatureDisplay.getInt(id, CREATURE_MODEL) ?? 0, MODEL_FILE) ?? 0;
			if (!model) continue;
			const extra = creatureDisplay.getInt(id, CREATURE_EXTRA) ?? 0;
			const scale = creatureDisplay.getFloat(id, CREATURE_SCALE) ?? 1;
			out.push({ id, model, scale: scale > 0 && Number.isFinite(scale) ? scale : 1, humanoid: !!extra && displayExtra.has(extra), status: this.storage.status(model) });
		}
		return out;
	}

	characterModels(): Promise<CharacterModelInfo[]> {
		return this.builder.characterModels();
	}

	customizationOptions(race: number, sex: number): Promise<CustomizationOption[]> {
		return this.builder.customizationOptions(race, sex);
	}

	private gearTables: Promise<GearTables> | null = null;

	/**
	 * The gear browser's displays (spec 7.9.3): item-backed displays named from ItemSparse with
	 * their slot from the item, plus everything NPCs wear (NPCModelItemSlotDisplayInfo), which is
	 * mostly nameless and keeps its slot from the NPC's (docs/phase5-verification.md, Q8).
	 */
	private gear(): Promise<GearTables> {
		this.gearTables ??= (async () => {
			const t = (fdid: number) => loadTable(this.storage, fdid);
			const [item, sparse, modified, appearance, displayInfo, materialRes, textureFiles, { slots }] = await Promise.all([
				t(NPC_FILES.Item), t(NPC_FILES.ItemSparse), t(NPC_FILES.ItemModifiedAppearance), t(NPC_FILES.ItemAppearance), t(DISPLAY_FILES.ItemDisplayInfo), t(NPC_FILES.ItemDisplayInfoMaterialRes),
				t(DISPLAY_FILES.TextureFileData), this.creature(),
			]);
			const materials = await this.displays.materialTextures();
			// A texture file per material resource, for the display's label and status.
			const fileByResource = new Map<number, number>();
			for (const file of textureFiles.ids()) {
				const m = textureFiles.getInt(file, 2) ?? 0;
				if (m && !fileByResource.has(m)) fileByResource.set(m, file);
			}
			const sectionFile = new Map<number, number>();
			for (const id of materialRes.ids()) {
				const display = materialRes.getParent(id);
				if (display === null || sectionFile.has(display)) continue;
				const file = fileByResource.get(materialRes.getInt(id, 1) ?? 0) ?? 0;
				if (file) sectionFile.set(display, file);
			}
			const appearanceDisplay = new Map<number, number>();
			const appearanceIcon = new Map<number, number>();
			for (const id of appearance.ids()) {
				appearanceDisplay.set(id, appearance.getInt(id, APPEARANCE_DISPLAY) ?? 0);
				appearanceIcon.set(id, appearance.getInt(id, APPEARANCE_ICON) ?? 0);
			}
			const byDisplay = new Map<number, GearDisplay>();
			const shields = new Set<number>();
			const fileOf = async (display: number): Promise<number> => sectionFile.get(display) ?? materials.get(displayInfo.getInt(display, 11, 0) ?? 0) ?? (await this.displays.itemFile(display));
			// Item-backed displays: the item names the slot and ItemSparse names the item.
			for (const id of modified.ids()) {
				const itemId = modified.getInt(id, MODIFIED_ITEM) ?? 0;
				const appearanceId = modified.getInt(id, MODIFIED_APPEARANCE) ?? 0;
				const display = appearanceDisplay.get(appearanceId) ?? 0;
				if (!display || !displayInfo.has(display)) continue;
				const type = item.getInt(itemId, ITEM_INVENTORY_TYPE) ?? 0;
				if (type === INVENTORY_SHIELD) shields.add(display);
				const slot = INVENTORY_SLOTS[type];
				if (!slot) continue;
				const name = sparse.getString(itemId, ITEM_SPARSE_NAME) || null;
				const have = byDisplay.get(display);
				if (have && (have.name || !name)) continue;
				const file = await fileOf(display);
				// The appearance's icon shows this display; the item's is for the item as a whole.
				const icon = appearanceIcon.get(appearanceId) || (item.getInt(itemId, ITEM_ICON) ?? 0);
				byDisplay.set(display, { id: display, slot, name, file, icon: this.storage.status(icon) === 'ok' ? icon : 0, status: file ? this.storage.status(file) : 'ok' });
			}
			// NPC-worn displays: their slot is the NPC's.
			for (const id of slots.ids()) {
				const display = slots.getInt(id, NPC_SLOT_DISPLAY) ?? 0;
				const slot = SLOT_BY_NPC[slots.getInt(id, NPC_SLOT_SLOT) ?? -1];
				if (!display || !slot || byDisplay.has(display) || !displayInfo.has(display)) continue;
				const file = await fileOf(display);
				byDisplay.set(display, { id: display, slot, name: null, file, icon: 0, status: file ? this.storage.status(file) : 'ok' });
			}
			return { byDisplay, shields };
		})();
		return this.gearTables;
	}

	/** The gear browser's list: named displays first, then the path-labelled rest. */
	async gearDisplays(): Promise<GearDisplay[]> {
		const { byDisplay } = await this.gear();
		return [...byDisplay.values()].sort((a, b) => Number(!a.name) - Number(!b.name) || (a.name ?? '').localeCompare(b.name ?? '') || a.id - b.id);
	}

	/** Names for item displays a preset wears (null where the display has none). */
	async gearNames(displays: number[]): Promise<(string | null)[]> {
		const { byDisplay } = await this.gear();
		return displays.map((d) => byDisplay.get(d)?.name ?? null);
	}

	/**
	 * "Customize as new" (spec 7.9.2, Q9): a humanoid display's race, sex, customization choices
	 * (those of its race and sex's model) and worn gear as a preset's fields; null for other displays.
	 */
	async humanoidPreset(displayId: number): Promise<HumanoidPreset | null> {
		const { creatureDisplay, displayExtra, displayOption, slots } = await this.creature();
		const extra = creatureDisplay.getInt(displayId, CREATURE_EXTRA) ?? 0;
		if (!extra || !displayExtra.has(extra)) return null;
		const race = displayExtra.getInt(extra, EXTRA_RACE) ?? 0;
		const sex = displayExtra.getInt(extra, EXTRA_SEX) ?? 0;
		if (sex > 1) return null;
		const options = await this.builder.optionIds(race, sex);
		if (!options.size) return null;
		const customization: Record<string, number> = {};
		for (const id of displayOption.ids()) {
			if (displayOption.getParent(id) !== extra) continue;
			const option = displayOption.getInt(id, 0) ?? 0;
			if (options.has(option)) customization[String(option)] = displayOption.getInt(id, 1) ?? 0;
		}
		const equipment: Partial<Record<EquipSlot, number>> = {};
		for (const id of slots.ids()) {
			if (slots.getParent(id) !== extra) continue;
			const slot = SLOT_BY_NPC[slots.getInt(id, NPC_SLOT_SLOT) ?? -1];
			const display = slots.getInt(id, NPC_SLOT_DISPLAY) ?? 0;
			if (slot && display) equipment[slot] = display;
		}
		return { race, sex: sex as 0 | 1, customization, equipment };
	}

	/** A custom preset the page will load models for under this handle. */
	definePreset(handle: number, preset: NpcPreset): void {
		this.presets.set(handle, preset);
	}

	/** The model and dressing of an appearance, or null when the client lacks it (a placeholder stands in). */
	async look(appearance: NpcAppearance | { kind: 'npcPreset'; handle: number }): Promise<{ fdid: number; options: M2Options; missing?: string[] } | null> {
		if (appearance.kind === 'creature') return this.displays.creature(appearance.displayId);
		const preset = appearance.kind === 'npcPreset' ? this.presets.get(appearance.handle) : null;
		if (!preset) return null;
		const built: BuiltLook | null = await this.builder.look(preset);
		return built;
	}
}

export { NPC_SLOT, SLOT_BY_NPC };
