import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { loadTable } from './clientDb';
import type { GearAttachment, M2Options } from './objects';
import { ATTACH_HAND_LEFT, ATTACH_HAND_RIGHT, ATTACH_HELM, ATTACH_SHIELD, ATTACH_SHOULDER_LEFT, ATTACH_SHOULDER_RIGHT } from '../formats/m2Pose';

/** The page's URL; the character data files sit beside it, not beside this worker's script. */
let pageUrl = '';

export function setPageUrl(url: string): void {
	pageUrl = url;
}

/** A file under public/character, built from the community listfile. */
const characterFile = (name: string) => new URL(`character/${name}`, pageUrl || location.href).href;

/** Resolves creature display IDs to model files, textures and scale, and dresses character models. */
export class DisplayResolver {
	private tables: Promise<{
		creatureDisplay: Awaited<ReturnType<typeof loadTable>>;
		creatureModel: Awaited<ReturnType<typeof loadTable>>;
		displayExtra: Awaited<ReturnType<typeof loadTable>>;
		materials: Map<number, number>;
	}> | null = null;

	constructor(private readonly storage: CascStorage) {}

	private load() {
		this.tables ??= (async () => {
			const [creatureDisplay, creatureModel, displayExtra, textureFiles] = await Promise.all([
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfo),
				loadTable(this.storage, DISPLAY_FILES.CreatureModelData),
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfoExtra),
				loadTable(this.storage, DISPLAY_FILES.TextureFileData),
			]);
			// Material resources ID -> texture file (TextureFileData: ID is the file, field 2 the material).
			const materials = new Map<number, number>();
			for (const fdid of textureFiles.ids()) {
				const material = textureFiles.getInt(fdid, 2);
				if (material && !materials.has(material)) materials.set(material, fdid);
			}
			return { creatureDisplay, creatureModel, displayExtra, materials };
		})();
		return this.tables;
	}

	/**
	 * Model, textures, geosets and gear for a creature look. weapons is [main hand, off hand,
	 * off hand is a shield] as item display IDs.
	 */
	async creature(displayId: number, weapons: Weapons | null = null, hd = false): Promise<{ fdid: number; options: M2Options } | null> {
		return this.creatureLook(displayId, weapons, hd);
	}

	private async creatureLook(displayId: number, weapons: Weapons | null, hd: boolean): Promise<{ fdid: number; options: M2Options } | null> {
		const { creatureDisplay, creatureModel, displayExtra, materials } = await this.load();
		const modelId = creatureDisplay.getInt(displayId, 1);
		const fdid = modelId ? creatureModel.getInt(modelId, 2) : null;
		if (!fdid) return null;
		const extra = creatureDisplay.getInt(displayId, 7) ?? 0;
		const held = weapons ? await this.weaponAttachments(weapons) : [];
		if (extra && displayExtra.has(extra)) {
			// Humanoid NPCs: a character model with the outfit baked into one texture. Prefer the
			// original (SD) race model with its SD bake; fall back to the HD model the table names.
			const race = displayExtra.getInt(extra, 1) ?? 0;
			const sex = displayExtra.getInt(extra, 2) ?? 0;
			const sd = SD_CHARACTER_MODELS[race]?.[sex];
			const sdBake = materials.get(displayExtra.getInt(extra, 5) ?? 0);
			const [looks, gear] = await Promise.all([this.customization(extra), this.armor(extra, race, sex)]);
			// Gear geosets (gloves, boots, ...) win over appearance ones in the same group.
			const gearGroups = new Set(gear.geosets.map((g) => Math.floor(g / 100)));
			const geosets = [...gear.geosets, ...looks.geosets.filter((g) => !gearGroups.has(Math.floor(g / 100)))];
			const attachments = [...gear.attachments, ...held];
			const cape: Record<number, number> = gear.cape ? { 2: gear.cape } : {};
			// Goblins have only the one model, laid out for the HD bake; their SD bake was made for the
			// vanilla model this install doesn't have.
			if (!hd && sd && sd !== fdid && sdBake && this.storage.status(sd) === 'ok') {
				// SD hair textures are per race and colour (the HD ones don't fit SD geometry). Colours
				// beyond the old set fall back to the first.
				const hairSet = (await this.hairTextures())[race];
				const hair = hairSet?.[looks.hairColor] ?? hairSet?.[0] ?? 0;
				// The skin's extra texture (a tauren's horns, tail and mane) comes in fewer colours than
				// the skin: take the nearest one at or below.
				const extras = (await this.skinExtras())[race]?.[sex] ?? [];
				let extra8 = 0;
				for (let c = Math.min(looks.skinColor, extras.length - 1); c >= 0 && !extra8; c--) extra8 = extras[c] ?? 0;
				extra8 ||= extras.find((f) => f) ?? 0;
				const extraSkin: Record<number, number> = extra8 ? { 8: extra8 } : {};
				return { fdid: sd, options: { textures: { 1: sdBake, 6: hair, ...extraSkin, ...cape }, geosets, attachments, defaultGeosets: true, stand: true } };
			}
			const bake = materials.get(displayExtra.getInt(extra, 6) ?? 0) ?? sdBake ?? 0;
			// The goblin model's own hair textures fit it when the customization names none.
			let hair = looks.hdHair;
			if (!hair && sd === fdid) {
				const hairSet = (await this.hairTextures())[race];
				hair = hairSet?.[looks.hairColor] ?? hairSet?.[0] ?? 0;
			}
			const eyes: Record<number, number> = looks.hdEyes ? { 19: looks.hdEyes } : {};
			return { fdid, options: { textures: { 1: bake, 6: hair, ...eyes, ...cape }, geosets, attachments, defaultGeosets: true, stand: true } };
		}
		const skins = [0, 1, 2].map((k) => creatureDisplay.getInt(displayId, 27, k) ?? 0);
		return { fdid, options: { textures: { 11: skins[0], 12: skins[1], 13: skins[2] }, attachments: held, defaultGeosets: true, lowestVariant: true, stand: true } };
	}

	private itemTables: Promise<{ items: Db2; byResource: Map<number, number[]>; components: Db2; materials: Map<number, number>; helmetHides: Map<number, [number, number][]> }> | null = null;

	private loadItems() {
		this.itemTables ??= (async () => {
			const [items, modelFiles, components, helmetData, base] = await Promise.all([
				loadTable(this.storage, DISPLAY_FILES.ItemDisplayInfo),
				loadTable(this.storage, DISPLAY_FILES.ModelFileData),
				loadTable(this.storage, DISPLAY_FILES.ComponentModelFileData),
				loadTable(this.storage, DISPLAY_FILES.HelmetGeosetData),
				this.load(),
			]);
			// HelmetGeosetData (parent = a helmet's hide rule, ItemDisplayInfo field 15): [race, geoset group it hides].
			const helmetHides = new Map<number, [number, number][]>();
			for (const id of helmetData.ids()) {
				const rule = helmetData.getParent(id) ?? 0;
				const list = helmetHides.get(rule) ?? [];
				list.push([helmetData.getInt(id, 0) ?? 0, helmetData.getInt(id, 1) ?? 0]);
				helmetHides.set(rule, list);
			}
			// ModelFileData: model resources ID (field 4) -> the files that implement it.
			const byResource = new Map<number, number[]>();
			for (const file of modelFiles.ids()) {
				const resource = modelFiles.getInt(file, 4) ?? 0;
				const list = byResource.get(resource) ?? [];
				list.push(file);
				byResource.set(resource, list);
			}
			return { items, byResource, components, materials: base.materials, helmetHides };
		})();
		return this.itemTables;
	}

	/**
	 * The file for an item model resource: the one made for this race and sex (and shoulder side)
	 * according to ComponentModelFileData (0 sex, 2 race, 3 side), else any.
	 */
	private async itemModel(resource: number, race = 0, sex = 0, side = -1): Promise<number> {
		// Resource 0 is "no model"; ModelFileData rows with no resource (newer M3 files) share it.
		if (!resource) return 0;
		const { byResource, components } = await this.loadItems();
		const files = (byResource.get(resource) ?? []).filter((f) => this.storage.status(f) === 'ok');
		const score = (f: number) => {
			if (!components.has(f)) return 1;
			const fSex = components.getInt(f, 0) ?? 0, fRace = components.getInt(f, 2) ?? 0, fSide = components.getInt(f, 3) ?? -1;
			if (side >= 0 && fSide !== -1 && fSide !== side) return -1;
			return (fRace === race ? 4 : fRace === 0 ? 1 : 0) + (fSex === sex ? 2 : fSex > 1 ? 1 : 0);
		};
		let best = 0;
		let bestScore = -1;
		for (const f of files) {
			const sc = score(f);
			if (sc > bestScore) {
				best = f;
				bestScore = sc;
			}
		}
		return best;
	}

	/** Weapons held in the hands (or a shield on the arm). */
	private async weaponAttachments([mainHand, offHand, offHandIsShield]: Weapons): Promise<GearAttachment[]> {
		const { items, materials } = await this.loadItems();
		const out: GearAttachment[] = [];
		const add = async (display: number, point: number) => {
			if (!display || !items.has(display)) return;
			const fdid = await this.itemModel(items.getInt(display, 10, 0) ?? 0);
			if (fdid) out.push({ point, fdid, texture: materials.get(items.getInt(display, 11, 0) ?? 0) ?? 0 });
		};
		await add(mainHand, ATTACH_HAND_RIGHT);
		await add(offHand, offHandIsShield ? ATTACH_SHIELD : ATTACH_HAND_LEFT);
		return out;
	}

	/**
	 * A humanoid NPC's armour (NPCModelItemSlotDisplayInfo, parent = display extra): helmet and
	 * shoulder models at their attachment points, and the geosets other gear switches on
	 * (ItemDisplayInfo.GeosetGroup, field 13). A helmet hides what its own rule says for the
	 * race (HelmetGeosetData): a hood the hair, a mask only the beard, a bandana nothing.
	 */
	private async armor(extra: number, race: number, sex: number): Promise<{ attachments: GearAttachment[]; geosets: number[]; cape: number }> {
		const { items, materials, helmetHides } = await this.loadItems();
		const slots = await this.itemSlots();
		const attachments: GearAttachment[] = [];
		const geosets: number[] = [];
		let cape = 0;
		for (const [display, slot] of slots.get(extra) ?? []) {
			if (!items.has(display)) continue;
			const group = (k: number) => items.getInt(display, 13, k) ?? 0;
			const texture = (k: number) => materials.get(items.getInt(display, 11, k) ?? 0) ?? 0;
			const setGeoset = (base: number, value: number) => {
				if (value > 0) geosets.push(base + 1 + value);
			};
			switch (slot) {
				case SLOT_HEAD: {
					const fdid = await this.itemModel(items.getInt(display, 10, 0) ?? 0, race, sex);
					if (fdid) {
						attachments.push({ point: ATTACH_HELM, fdid, texture: texture(0) });
						// Field 15: the hide rule for each sex. Hidden, a group shows its bare default
						// (variant 1: no beard, no ears); the hair has none, so it gets no variant at all.
						const rule = items.getInt(display, HELMET_RULE, sex) ?? 0;
						for (const [r, group] of helmetHides.get(rule) ?? []) {
							if (r === race) geosets.push(group === 0 ? HIDE_HAIR : group * 100 + 1);
						}
					}
					break;
				}
				case SLOT_SHOULDER: {
					// Two models (or one resource with a left and a right file); side 0 left, 1 right.
					const left = await this.itemModel(items.getInt(display, 10, 0) ?? 0, race, sex, 0);
					const right = await this.itemModel(items.getInt(display, 10, 1) || (items.getInt(display, 10, 0) ?? 0), race, sex, 1);
					if (left) attachments.push({ point: ATTACH_SHOULDER_LEFT, fdid: left, texture: texture(0) });
					if (right) attachments.push({ point: ATTACH_SHOULDER_RIGHT, fdid: right, texture: texture(1) || texture(0) });
					break;
				}
				case SLOT_SHIRT:
				case SLOT_CHEST:
					setGeoset(800, group(0)); // sleeves
					setGeoset(1000, group(1)); // chest
					setGeoset(1300, group(2)); // robe skirt
					break;
				case SLOT_BELT:
					setGeoset(1800, group(0));
					break;
				case SLOT_LEGS:
					setGeoset(900, group(0)); // knee pads
					setGeoset(1300, group(2));
					break;
				case SLOT_FEET:
					setGeoset(500, group(0));
					break;
				case SLOT_HANDS:
					setGeoset(400, group(0));
					break;
				case SLOT_TABARD:
					setGeoset(1200, group(0));
					break;
				case SLOT_BACK:
					geosets.push(1500 + 1 + Math.max(1, group(0)));
					cape = texture(0);
					break;
			}
		}
		return { attachments, geosets, cape };
	}

	private slotIndex: Promise<Map<number, [number, number][]>> | null = null;

	/** NPCModelItemSlotDisplayInfo by display extra: [item display, slot]. */
	private itemSlots(): Promise<Map<number, [number, number][]>> {
		this.slotIndex ??= loadTable(this.storage, DISPLAY_FILES.NPCModelItemSlotDisplayInfo).then((table) => {
			const byExtra = new Map<number, [number, number][]>();
			for (const id of table.ids()) {
				const extra = table.getParent(id);
				if (extra === null) continue;
				const list = byExtra.get(extra) ?? [];
				list.push([table.getInt(id, 0) ?? 0, table.getInt(id, 1) ?? 0]);
				byExtra.set(extra, list);
			}
			return byExtra;
		});
		return this.slotIndex;
	}
	private customizationTables: Promise<{
		optionsByExtra: Map<number, [number, number][]>;
		elementsByChoice: Map<number, number[]>;
		element: Db2;
		geoset: Db2;
		choice: Db2;
		option: Db2;
		material: Db2;
	}> | null = null;

	private loadCustomization() {
		this.customizationTables ??= (async () => {
			const [displayOption, option, choice, element, geoset, material] = await Promise.all([
				DISPLAY_FILES.CreatureDisplayInfoOption, DISPLAY_FILES.ChrCustomizationOption, DISPLAY_FILES.ChrCustomizationChoice,
				DISPLAY_FILES.ChrCustomizationElement, DISPLAY_FILES.ChrCustomizationGeoset, DISPLAY_FILES.ChrCustomizationMaterial,
			].map((f) => loadTable(this.storage, f)));
			// CreatureDisplayInfoOption: (option, choice) rows whose parent is the display extra.
			const optionsByExtra = new Map<number, [number, number][]>();
			for (const id of displayOption.ids()) {
				const extra = displayOption.getParent(id);
				if (extra === null) continue;
				const list = optionsByExtra.get(extra) ?? [];
				list.push([displayOption.getInt(id, 0) ?? 0, displayOption.getInt(id, 1) ?? 0]);
				optionsByExtra.set(extra, list);
			}
			// ChrCustomizationElement field 0 is the choice it belongs to.
			const elementsByChoice = new Map<number, number[]>();
			for (const id of element.ids()) {
				const c = element.getInt(id, 0) ?? 0;
				const list = elementsByChoice.get(c) ?? [];
				list.push(id);
				elementsByChoice.set(c, list);
			}
			return { optionsByExtra, elementsByChoice, element, geoset, choice, option, material };
		})();
		return this.customizationTables;
	}

	/**
	 * An NPC's appearance choices (CreatureDisplayInfoOption -> ChrCustomizationChoice ->
	 * ChrCustomizationElement): the geosets they turn on (group * 100 + variant: hairstyle,
	 * facial hair, ears, ...), the hair and skin colours' indices in their options, and the HD
	 * models' hair and eye textures.
	 */
	private async customization(extra: number): Promise<{ geosets: number[]; hairColor: number; skinColor: number; hdHair: number; hdEyes: number }> {
		const [{ optionsByExtra, elementsByChoice, element, geoset, choice, option, material }, { materials }] = await Promise.all([this.loadCustomization(), this.load()]);
		const picks = optionsByExtra.get(extra) ?? [];
		const chosen = new Set(picks.map(([, c]) => c));
		const geosets: number[] = [];
		let hairColor = 0;
		let skinColor = 0;
		let hdHair = 0;
		let hdEyes = 0;
		for (const [optionId, choiceId] of picks) {
			// Choice field 5 is its order within the option, which matches the old colour index.
			const optionName = option.getString(optionId, 0);
			if (optionName === 'Hair Color') hairColor = choice.getInt(choiceId, 5) ?? 0;
			if (optionName === 'Skin Color') skinColor = choice.getInt(choiceId, 5) ?? 0;
			for (const e of elementsByChoice.get(choiceId) ?? []) {
				// Some elements only apply together with another choice (field 1).
				const related = element.getInt(e, 1) ?? 0;
				if (related && !chosen.has(related)) continue;
				// HD models: the hairstyle's material for the chosen colour is the hair texture.
				const materialId = element.getInt(e, 4) ?? 0;
				if (optionName === 'Hair Style' && related && material.has(materialId)) {
					hdHair = materials.get(material.getInt(materialId, 1) ?? 0) ?? hdHair;
				}
				// And the eye colour's is the eyeballs' texture.
				if (optionName === 'Eye Color' && material.has(materialId)) {
					hdEyes = materials.get(material.getInt(materialId, 1) ?? 0) ?? hdEyes;
				}
				const geosetId = element.getInt(e, 2) ?? 0;
				if (!geosetId || !geoset.has(geosetId)) continue;
				geosets.push((geoset.getInt(geosetId, 0) ?? 0) * 100 + (geoset.getInt(geosetId, 1) ?? 0));
			}
		}
		return { geosets, hairColor, skinColor, hdHair, hdEyes };
	}

	private hair: Promise<Record<number, number[]>> | null = null;

	/** SD hair textures by race and colour, from public/character/hair.json (built from the listfile). */
	private hairTextures(): Promise<Record<number, number[]>> {
		this.hair ??= fetch(characterFile('hair.json')).then((r) => (r.ok ? r.json() : {}), () => ({}));
		return this.hair;
	}

	private extras: Promise<Record<number, number[][]>> | null = null;

	/** SD skin extra textures by race, sex and skin colour, from public/character/skinExtra.json (built from the listfile). */
	private skinExtras(): Promise<Record<number, number[][]>> {
		this.extras ??= fetch(characterFile('skinExtra.json')).then((r) => (r.ok ? r.json() : {}), () => ({}));
		return this.extras;
	}

	private lookIndex: Promise<Map<string, number[]>> | null = null;

	/**
	 * Humanoid NPC looks by race, sex and model ('race:sex:sd' or 'race:sex:hd'): display IDs
	 * whose outfit texture is in the install, simply dressed first (see below), for the walking
	 * character to wear.
	 */
	private looks(): Promise<Map<string, number[]>> {
		this.lookIndex ??= (async () => {
			const [{ creatureDisplay, displayExtra, materials }, slots] = await Promise.all([this.load(), this.itemSlots()]);
			const scored = new Map<string, { id: number; score: number }[]>();
			const add = (key: string, id: number, score: number) => {
				const list = scored.get(key) ?? [];
				list.push({ id, score });
				scored.set(key, list);
			};
			const usable = (material: number) => {
				const file = materials.get(material);
				return !!file && this.storage.status(file) === 'ok';
			};
			for (const id of creatureDisplay.ids()) {
				const extra = creatureDisplay.getInt(id, 7) ?? 0;
				if (!extra || !displayExtra.has(extra)) continue;
				const race = displayExtra.getInt(extra, 1) ?? 0;
				const sex = displayExtra.getInt(extra, 2) ?? 0;
				if (!SD_CHARACTER_MODELS[race] || sex > 1) continue;
				// Dressed simply: a shirt or chest, trousers and boots, but no helmet, shoulders, cape or tabard.
				let score = 0;
				const worn = new Set((slots.get(extra) ?? []).map(([, slot]) => slot));
				for (const slot of worn) {
					if (slot === SLOT_HEAD || slot === SLOT_SHOULDER || slot === SLOT_BACK || slot === SLOT_TABARD) score -= 3;
				}
				if (worn.has(SLOT_SHIRT) || worn.has(SLOT_CHEST)) score += 1;
				if (worn.has(SLOT_LEGS)) score += 1;
				if (worn.has(SLOT_FEET)) score += 1;
				if (usable(displayExtra.getInt(extra, 5) ?? 0)) add(`${race}:${sex}:sd`, id, score);
				if (usable(displayExtra.getInt(extra, 6) ?? 0)) add(`${race}:${sex}:hd`, id, score);
			}
			const out = new Map<string, number[]>();
			for (const [key, list] of scored) out.set(key, list.sort((a, b) => b.score - a.score || a.id - b.id).map((l) => l.id));
			return out;
		})();
		return this.lookIndex;
	}

	/** The races the install has character models for, and how many looks each sex has, classic and HD. */
	async characterRaces(): Promise<CharacterRace[]> {
		const looks = await this.looks();
		const out: CharacterRace[] = [];
		for (const [race, models] of Object.entries(SD_CHARACTER_MODELS)) {
			const r = Number(race);
			const sexes = models.map((sd, sex) => ({
				sd: this.storage.status(sd) === 'ok' ? looks.get(`${r}:${sex}:sd`)?.length ?? 0 : 0,
				hd: looks.get(`${r}:${sex}:hd`)?.length ?? 0,
			})) as CharacterRace['sexes'];
			if (sexes.some((s) => s.sd || s.hd)) out.push({ race: r, name: RACE_NAMES[r] ?? `Race ${r}`, sexes });
		}
		return out;
	}

	/**
	 * The walking character: one of a race and sex's NPC looks (wrapping round), on the classic or
	 * HD model, with the sequences given. Null when there's no such look.
	 */
	async character(race: number, sex: number, hd: boolean, look: number, clips: number[], outfit: CharacterOutfit | null = null, torch = false): Promise<{ fdid: number; options: M2Options; displayId: number; looks: number } | null> {
		const list = (await this.looks()).get(`${race}:${sex}:${hd ? 'hd' : 'sd'}`) ?? [];
		if (!list.length) return null;
		// An outfit is one NPC's whole look, weapons and all; otherwise one of the race's looks.
		const worn = outfit && CHARACTER_OUTFITS[outfit].race === race ? CHARACTER_OUTFITS[outfit] : null;
		const displayId = worn ? worn.displays[sex] : list[wrap(look, list.length)];
		const resolved = await this.creature(displayId, worn?.weapons ?? null, hd);
		if (!resolved) return null;
		// The torch takes the right hand from any weapon; a model with no hand attachment point (an animal form) simply isn't given one.
		const attachments = torch
			? [...(resolved.options.attachments ?? []).filter((a) => a.point !== ATTACH_HAND_RIGHT), { point: ATTACH_HAND_RIGHT, fdid: TORCH_MODEL, texture: TORCH_TEXTURE, noGlow: true }]
			: resolved.options.attachments;
		return { ...resolved, options: { ...resolved.options, clips, attachments }, displayId, looks: list.length };
	}
}

/**
 * Original (pre-HD) character models by ChrRaces ID, [male, female] (file IDs from the community
 * listfile: character/<race>/<sex>/<race><sex>.m2). The display tables point at the HD models.
 */
const SD_CHARACTER_MODELS: Record<number, [number, number]> = {
	1: [119940, 119563], // human
	2: [121287, 121087], // orc
	3: [118355, 118135], // dwarf
	4: [120791, 120590], // night elf
	5: [121768, 121608], // undead
	6: [122055, 121961], // tauren
	7: [119159, 119063], // gnome
	8: [122560, 122414], // troll
	9: [119376, 119369], // goblin
	10: [117170, 116921], // blood elf
	11: [117721, 117437], // draenei
	12: [118653, 118652], // fel orc
	14: [117412, 117400], // broken
	15: [121942, 121941], // skeleton
	18: [118798, 118798], // forest troll
};

/** The torch a character holds (club_1h_torch_a_01, from the community listfile) and its texture. */
const TORCH_MODEL = 145304;
const TORCH_TEXTURE = 145303;

/** ChrRaces names for the races with character models. */
const RACE_NAMES: Record<number, string> = {
	1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll',
	9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei', 12: 'Fel Orc', 14: 'Broken', 15: 'Skeleton', 18: 'Forest Troll',
};

/**
 * Outfits the walking character can wear whole, as an NPC wears them: the race, the display for
 * each sex (male, female) and the weapons held, as the matching NPC carries them.
 */
export const CHARACTER_OUTFITS = {
	// creature_template 68.
	guard: { name: 'Stormwind City Guard', race: 1, displays: [3167, 5446], weapons: [7483, 2080, 1] as Weapons },
};

export type CharacterOutfit = keyof typeof CHARACTER_OUTFITS;

/** A race the walking character can be: its name, and how many looks each sex (male, female) has, classic and HD. */

export interface CharacterRace {
	race: number;
	name: string;
	sexes: [{ sd: number; hd: number }, { sd: number; hd: number }];
}

/** Non-negative remainder, for picking round a list. */
const wrap = (n: number, m: number) => ((n % m) + m) % m;

/** Client tables for display lookups (file IDs from the community listfile). */

export const DISPLAY_FILES = {
	CreatureDisplayInfo: 1108759,
	CreatureDisplayInfoExtra: 1264997,
	CreatureModelData: 1365368,
	TextureFileData: 982459,
	CreatureDisplayInfoOption: 3692043,
	ChrCustomizationOption: 3384247,
	ChrCustomizationChoice: 3450554,
	ChrCustomizationElement: 3512765,
	ChrCustomizationGeoset: 3456171,
	ChrCustomizationMaterial: 3459652,
	NPCModelItemSlotDisplayInfo: 1340661,
	ItemDisplayInfo: 1266429,
	HelmetGeosetData: 2821752,
	ModelFileData: 1337833,
	ComponentModelFileData: 1349053,
} as const;

/** NPCModelItemSlotDisplayInfo slots. */
const SLOT_HEAD = 0;
const SLOT_SHOULDER = 1;
const SLOT_SHIRT = 2;
const SLOT_CHEST = 3;
const SLOT_BELT = 4;
const SLOT_LEGS = 5;
const SLOT_FEET = 6;
const SLOT_HANDS = 8;
const SLOT_TABARD = 9;
const SLOT_BACK = 10;
/** A group-0 geoset no model has: choosing it hides every hairstyle (under a hood or helm). */
const HIDE_HAIR = 99;
/** ItemDisplayInfo field 15: a helmet's HelmetGeosetData rule for male and female wearers. */
const HELMET_RULE = 15;

/** [main hand, off hand, off hand is a shield] as item display IDs. */
export type Weapons = [number, number, number];

