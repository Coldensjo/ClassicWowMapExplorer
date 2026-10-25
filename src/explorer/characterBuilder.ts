import type { CascStorage } from '../casc/storage';
import type { FileStatus } from '../casc/storage';
import { decodeBlp, type Image } from '../formats/blp';
import type { Db2 } from '../formats/db2';
import type { EquipSlot, NpcPreset } from '../scene/types';
import { loadTable } from './clientDb';
import { DISPLAY_FILES, type DisplayResolver } from './display';
import type { M2Options } from './objects';
import {
	CHOICE_NAME, CHOICE_OPTION, CHOICE_ORDER, CHOICE_SWATCH, CHR_MODEL_DISPLAY, CHR_MODEL_LAYOUT, CHR_MODEL_SEX, CHR_RACES_NAME, COMPONENT_TEXTURE_RACE, COMPONENT_TEXTURE_SEX, CREATURE_MODEL,
	ELEMENT_CHOICE, ELEMENT_GEOSET, ELEMENT_MATERIAL, ELEMENT_RELATED, GEOSET_GROUP, GEOSET_VARIANT, ITEM_MATERIAL_RESOURCE, ITEM_MATERIAL_SECTION, LAYER_BLEND, LAYER_ORDER, LAYER_SECTION_MASK,
	LAYER_TARGETS, LAYER_TEXTURE_TYPE, LAYOUT_HEIGHT, LAYOUT_WIDTH, MATERIAL_RESOURCE, MATERIAL_TARGET, MODEL_FILE, NPC_FILES, OPTION_MODEL, OPTION_NAME, OPTION_SORT, RACE_MODEL_MODEL,
	RACE_MODEL_RACE, RACE_MODEL_SEX, SECTION_HEIGHT, SECTION_LAYOUT, SECTION_TYPE, SECTION_WIDTH, SECTION_X, SECTION_Y, TEXTURE_FILE_MATERIAL,
} from './npcTables';
import { ATTACH_HAND_LEFT } from '../formats/m2Pose';
import type { VirtualTextures } from './virtualTextures';

/** The NPC slot (NPCModelItemSlotDisplayInfo) each equipment slot is worn in; weapons have none. */
export const NPC_SLOT: Partial<Record<EquipSlot, number>> = { head: 0, shoulder: 1, shirt: 2, chest: 3, waist: 4, legs: 5, feet: 6, wrist: 7, hands: 8, tabard: 9, back: 10 };
/** The equipment slot of each NPC slot. */
export const SLOT_BY_NPC: EquipSlot[] = ['head', 'shoulder', 'shirt', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'tabard', 'back'];

/** The order gear textures are laid onto the skin: later covers earlier (trousers under a robe, gloves over sleeves, a belt over all). */
const COMPOSITE_ORDER: EquipSlot[] = ['shirt', 'legs', 'chest', 'wrist', 'hands', 'feet', 'waist', 'tabard'];
/** Composited skins are made no wider than this: the layouts are 2048 wide, and an NPC is small on screen. */
const MAX_COMPOSITE = 1024;
/** The skin's runtime texture type, the one composited; others (hair 6, eyes 19) bind directly. */
const SKIN_TEXTURE = 1;
/** A layer mask of all ones covers the whole texture rather than listed sections. */
const WHOLE = 0xffffffff;

/** A character model the custom NPC editor can dress: a playable race and sex (spec 7.9.3). */
export interface CharacterModelInfo {
	race: number;
	name: string;
	sex: 0 | 1;
	/** ChrModel ID. */
	model: number;
	fdid: number;
	status: FileStatus;
}

export interface CustomizationChoice {
	id: number;
	name: string;
	/** The colour the game's picker shows for it (0xRRGGBB), where it has one instead of a name. */
	swatch: number | null;
}

export interface CustomizationOption {
	id: number;
	name: string;
	choices: CustomizationChoice[];
}

/** A dressed custom NPC: which model to load, how, and what couldn't be found. */
export interface BuiltLook {
	fdid: number;
	options: M2Options;
	/** Gear the client lacks ("chest: display 1234"), left off the model (spec 7.11). */
	missing: string[];
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface Layer {
	textureType: number;
	order: number;
	blend: number;
	mask: number;
	targets: [number, number];
}

interface Layout {
	width: number;
	height: number;
	sections: Map<number, Rect>;
	layers: Layer[];
}

interface Tables {
	chrModel: Db2;
	races: Db2;
	option: Db2;
	choice: Db2;
	element: Db2;
	geoset: Db2;
	material: Db2;
	creatureDisplay: Db2;
	creatureModel: Db2;
	modelByRaceSex: Map<string, number>;
	optionsByModel: Map<number, number[]>;
	choicesByOption: Map<number, number[]>;
	elementsByChoice: Map<number, number[]>;
	textureByMaterial: Map<number, number>;
	componentFilesByMaterial: Map<number, number[]>;
	componentTextures: Db2;
	layouts: Map<number, Layout>;
	materialResByDisplay: Map<number, { section: number; resource: number }[]>;
}

/**
 * Dresses the playable race models from the modern character tables (spec 7.9.3): the chosen
 * customization's geosets and textures, the skin composited from its layers plus the worn gear's
 * texture sections, and gear models at the attachment points. Only these models can be dressed;
 * every other model keeps its CreatureDisplayInfo skins.
 */
export class CharacterBuilder {
	private tables: Promise<Tables> | null = null;

	constructor(
		private readonly storage: CascStorage,
		private readonly displays: DisplayResolver,
		private readonly virtual: VirtualTextures,
		/** Whether an item display is a shield, which goes on the arm rather than in the hand. */
		private readonly isShield: (display: number) => Promise<boolean>,
	) {}

	private load(): Promise<Tables> {
		this.tables ??= (async () => {
			const t = (fdid: number) => loadTable(this.storage, fdid);
			const [chrModel, raceModel, races, option, choice, element, geoset, material, creatureDisplay, creatureModel, textureFiles, componentTextures, layoutTable, sectionTable, layerTable, materialRes] = await Promise.all([
				t(NPC_FILES.ChrModel), t(NPC_FILES.ChrRaceXChrModel), t(NPC_FILES.ChrRaces), t(DISPLAY_FILES.ChrCustomizationOption), t(DISPLAY_FILES.ChrCustomizationChoice),
				t(DISPLAY_FILES.ChrCustomizationElement), t(DISPLAY_FILES.ChrCustomizationGeoset), t(DISPLAY_FILES.ChrCustomizationMaterial), t(DISPLAY_FILES.CreatureDisplayInfo),
				t(DISPLAY_FILES.CreatureModelData), t(DISPLAY_FILES.TextureFileData), t(NPC_FILES.ComponentTextureFileData), t(NPC_FILES.CharComponentTextureLayouts),
				t(NPC_FILES.CharComponentTextureSections), t(NPC_FILES.ChrModelTextureLayer), t(NPC_FILES.ItemDisplayInfoMaterialRes),
			]);
			const push = <K>(map: Map<K, number[]>, key: K, value: number) => {
				const list = map.get(key);
				if (list) list.push(value);
				else map.set(key, [value]);
			};
			// Race and sex -> ChrModel; models listed with a sex their ChrModel disagrees with (sexless forms) are left out.
			const modelByRaceSex = new Map<string, number>();
			for (const id of raceModel.ids()) {
				const model = raceModel.getInt(id, RACE_MODEL_MODEL) ?? 0;
				const sex = raceModel.getInt(id, RACE_MODEL_SEX) ?? 0;
				if (sex > 1 || chrModel.getInt(model, CHR_MODEL_SEX) !== sex) continue;
				modelByRaceSex.set(`${raceModel.getInt(id, RACE_MODEL_RACE)}:${sex}`, model);
			}
			const optionsByModel = new Map<number, number[]>();
			for (const id of option.ids()) push(optionsByModel, option.getInt(id, OPTION_MODEL) ?? 0, id);
			for (const list of optionsByModel.values()) list.sort((a, b) => (option.getInt(a, OPTION_SORT) ?? 0) - (option.getInt(b, OPTION_SORT) ?? 0) || a - b);
			const choicesByOption = new Map<number, number[]>();
			for (const id of choice.ids()) push(choicesByOption, choice.getInt(id, CHOICE_OPTION) ?? 0, id);
			for (const list of choicesByOption.values()) list.sort((a, b) => (choice.getInt(a, CHOICE_ORDER) ?? 0) - (choice.getInt(b, CHOICE_ORDER) ?? 0) || a - b);
			const elementsByChoice = new Map<number, number[]>();
			for (const id of element.ids()) push(elementsByChoice, element.getInt(id, ELEMENT_CHOICE) ?? 0, id);
			const textureByMaterial = new Map<number, number>();
			for (const file of textureFiles.ids()) {
				const m = textureFiles.getInt(file, TEXTURE_FILE_MATERIAL) ?? 0;
				if (m && !textureByMaterial.has(m)) textureByMaterial.set(m, file);
			}
			// Gear textures come per sex and race: ComponentTextureFileData's ID is the file, TextureFileData says its material.
			const componentFilesByMaterial = new Map<number, number[]>();
			for (const file of componentTextures.ids()) {
				const m = textureFiles.getInt(file, TEXTURE_FILE_MATERIAL) ?? textureFiles.getParent(file) ?? 0;
				if (m) push(componentFilesByMaterial, m, file);
			}
			const layouts = new Map<number, Layout>();
			const layoutOf = (id: number): Layout => {
				let layout = layouts.get(id);
				if (!layout) {
					layout = { width: layoutTable.getInt(id, LAYOUT_WIDTH) ?? 0, height: layoutTable.getInt(id, LAYOUT_HEIGHT) ?? 0, sections: new Map(), layers: [] };
					layouts.set(id, layout);
				}
				return layout;
			};
			for (const id of layoutTable.ids()) layoutOf(id);
			for (const id of sectionTable.ids()) {
				const layout = layouts.get(sectionTable.getInt(id, SECTION_LAYOUT) ?? 0);
				layout?.sections.set(sectionTable.getInt(id, SECTION_TYPE) ?? 0, { x: sectionTable.getInt(id, SECTION_X) ?? 0, y: sectionTable.getInt(id, SECTION_Y) ?? 0, w: sectionTable.getInt(id, SECTION_WIDTH) ?? 0, h: sectionTable.getInt(id, SECTION_HEIGHT) ?? 0 });
			}
			for (const id of layerTable.ids()) {
				const layout = layouts.get(layerTable.getParent(id) ?? 0);
				layout?.layers.push({
					textureType: layerTable.getInt(id, LAYER_TEXTURE_TYPE) ?? 0,
					order: layerTable.getInt(id, LAYER_ORDER) ?? 0,
					blend: layerTable.getInt(id, LAYER_BLEND) ?? 0,
					mask: (layerTable.getInt(id, LAYER_SECTION_MASK) ?? 0) >>> 0,
					targets: [layerTable.getInt(id, LAYER_TARGETS, 0) ?? 0, layerTable.getInt(id, LAYER_TARGETS, 1) ?? 0],
				});
			}
			for (const layout of layouts.values()) layout.layers.sort((a, b) => a.order - b.order);
			const materialResByDisplay = new Map<number, { section: number; resource: number }[]>();
			for (const id of materialRes.ids()) {
				const display = materialRes.getParent(id);
				if (display === null) continue;
				const list = materialResByDisplay.get(display) ?? [];
				list.push({ section: materialRes.getInt(id, ITEM_MATERIAL_SECTION) ?? 0, resource: materialRes.getInt(id, ITEM_MATERIAL_RESOURCE) ?? 0 });
				materialResByDisplay.set(display, list);
			}
			return { chrModel, races, option, choice, element, geoset, material, creatureDisplay, creatureModel, modelByRaceSex, optionsByModel, choicesByOption, elementsByChoice, textureByMaterial, componentFilesByMaterial, componentTextures, layouts, materialResByDisplay };
		})();
		return this.tables;
	}

	/** A ChrModel's M2 file (0 when it hasn't one). */
	private modelFile(t: Tables, model: number): number {
		const display = t.chrModel.getInt(model, CHR_MODEL_DISPLAY) ?? 0;
		return t.creatureModel.getInt(t.creatureDisplay.getInt(display, CREATURE_MODEL) ?? 0, MODEL_FILE) ?? 0;
	}

	/** The dressable models: every race and sex with a ChrModel, playable races first. */
	async characterModels(): Promise<CharacterModelInfo[]> {
		const t = await this.load();
		const out: CharacterModelInfo[] = [];
		for (const [key, model] of t.modelByRaceSex) {
			const [race, sex] = key.split(':').map(Number);
			const fdid = this.modelFile(t, model);
			if (!fdid) continue;
			out.push({ race, name: t.races.getString(race, CHR_RACES_NAME) || `Race ${race}`, sex: sex as 0 | 1, model, fdid, status: this.storage.status(fdid) });
		}
		return out.sort((a, b) => a.race - b.race || a.sex - b.sex);
	}

	/** A race and sex's customization options with their choices, in the game's order; empty for a race without a model. */
	async customizationOptions(race: number, sex: number): Promise<CustomizationOption[]> {
		const t = await this.load();
		const model = t.modelByRaceSex.get(`${race}:${sex}`);
		if (!model) return [];
		const out: CustomizationOption[] = [];
		for (const id of t.optionsByModel.get(model) ?? []) {
			const choices = (t.choicesByOption.get(id) ?? []).map((c): CustomizationChoice => {
				const swatch = t.choice.getInt(c, CHOICE_SWATCH, 0) ?? 0;
				return { id: c, name: t.choice.getString(c, CHOICE_NAME) ?? '', swatch: swatch ? swatch & 0xffffff : null };
			});
			if (!choices.length) continue;
			out.push({ id, name: t.option.getString(id, OPTION_NAME) || `Option ${id}`, choices });
		}
		return out;
	}

	/** Which option IDs a race and sex's model has, for checking a humanoid display's choices. */
	async optionIds(race: number, sex: number): Promise<Set<number>> {
		const t = await this.load();
		const model = t.modelByRaceSex.get(`${race}:${sex}`);
		return new Set(model ? t.optionsByModel.get(model) ?? [] : []);
	}

	/**
	 * The gear texture file for a material resource: the one made for the sex and race (or for
	 * either sex, or any race), else none.
	 */
	private componentTexture(t: Tables, resource: number, sex: number, race: number): number {
		let best = 0;
		let bestScore = -1;
		for (const file of t.componentFilesByMaterial.get(resource) ?? []) {
			if (this.storage.status(file) !== 'ok') continue;
			const fileSex = t.componentTextures.getInt(file, COMPONENT_TEXTURE_SEX) ?? 3;
			const fileRace = t.componentTextures.getInt(file, COMPONENT_TEXTURE_RACE) ?? 0;
			if (fileSex !== 3 && fileSex !== sex) continue;
			const score = (fileRace === race ? 4 : fileRace === 0 ? 1 : -9) + (fileSex === sex ? 2 : 1);
			if (score > bestScore) {
				best = file;
				bestScore = score;
			}
		}
		return best;
	}

	/** Dresses a preset; null when the client has no model for its race and sex (a placeholder stands in). */
	async look(preset: NpcPreset): Promise<BuiltLook | null> {
		const t = await this.load();
		const model = t.modelByRaceSex.get(`${preset.race}:${preset.sex}`);
		if (!model) return null;
		const fdid = this.modelFile(t, model);
		if (!fdid || this.storage.status(fdid) !== 'ok') return null;
		const layout = t.layouts.get(t.chrModel.getInt(model, CHR_MODEL_LAYOUT) ?? 0) ?? null;
		const missing: string[] = [];

		// The choice per option: the preset's where it names one of the option's choices, else the first.
		const chosen = new Set<number>();
		for (const optionId of t.optionsByModel.get(model) ?? []) {
			const choices = t.choicesByOption.get(optionId) ?? [];
			if (!choices.length) continue;
			const want = preset.customization[String(optionId)];
			chosen.add(want && choices.includes(want) ? want : choices[0]);
		}
		// What the choices turn on: geosets, skin layers to composite, and textures that bind directly.
		const geosets: number[] = [];
		const skinLayers: { order: number; blend: number; mask: number; file: number }[] = [];
		const textures: Record<number, number> = {};
		const textureOrder: Record<number, number> = {};
		for (const c of chosen) {
			for (const e of t.elementsByChoice.get(c) ?? []) {
				const related = t.element.getInt(e, ELEMENT_RELATED) ?? 0;
				if (related && !chosen.has(related)) continue;
				const g = t.element.getInt(e, ELEMENT_GEOSET) ?? 0;
				if (g && t.geoset.has(g)) geosets.push((t.geoset.getInt(g, GEOSET_GROUP) ?? 0) * 100 + (t.geoset.getInt(g, GEOSET_VARIANT) ?? 0));
				const m = t.element.getInt(e, ELEMENT_MATERIAL) ?? 0;
				if (!m || !t.material.has(m) || !layout) continue;
				const target = t.material.getInt(m, MATERIAL_TARGET) ?? 0;
				const file = t.textureByMaterial.get(t.material.getInt(m, MATERIAL_RESOURCE) ?? 0) ?? 0;
				if (!file) continue;
				for (const layer of layout.layers) {
					if (layer.targets[0] !== target && layer.targets[1] !== target) continue;
					if (layer.textureType === SKIN_TEXTURE) skinLayers.push({ order: layer.order, blend: layer.blend, mask: layer.mask, file });
					else if ((textureOrder[layer.textureType] ?? -1) <= layer.order) {
						textures[layer.textureType] = file;
						textureOrder[layer.textureType] = layer.order;
					}
				}
			}
		}

		// Gear: models and geosets as a baked humanoid gets them, weapons in the hands, and the
		// texture sections laid over the skin.
		const worn: [number, number][] = [];
		for (const [slot, npcSlot] of Object.entries(NPC_SLOT) as [EquipSlot, number][]) {
			const display = preset.equipment[slot];
			if (!display) continue;
			if (!(await this.displays.itemExists(display))) {
				missing.push(`${slot}: item display ${display}`);
				continue;
			}
			worn.push([display, npcSlot]);
		}
		const gear = await this.displays.gear(worn, preset.race, preset.sex);
		const mainHand = preset.equipment.mainHand ?? 0;
		const offHand = preset.equipment.offHand ?? 0;
		const ranged = preset.equipment.ranged ?? 0;
		for (const [slot, display] of [['mainHand', mainHand], ['offHand', offHand], ['ranged', ranged]] as const) {
			if (display && !(await this.displays.itemExists(display))) missing.push(`${slot}: item display ${display}`);
		}
		const weapons = await this.displays.weaponAttachments([mainHand, offHand, offHand && (await this.isShield(offHand)) ? 1 : 0]);
		// A ranged weapon is carried in the free hand.
		if (ranged && !offHand) {
			for (const a of await this.displays.weaponAttachments([ranged, 0, 0])) weapons.push({ ...a, point: ATTACH_HAND_LEFT });
		}
		const gearLayers: { section: number; file: number }[] = [];
		for (const slot of COMPOSITE_ORDER) {
			const display = preset.equipment[slot];
			if (!display) continue;
			for (const { section, resource } of t.materialResByDisplay.get(display) ?? []) {
				const file = this.componentTexture(t, resource, preset.sex, preset.race);
				if (file) gearLayers.push({ section, file });
			}
		}
		if (layout && skinLayers.length) {
			const key = JSON.stringify([model, [...chosen].sort(), gearLayers]);
			const image = await this.composite(layout, skinLayers, gearLayers);
			if (image) textures[SKIN_TEXTURE] = this.virtual.register(key, () => image);
		}
		if (gear.cape) textures[2] = gear.cape;
		// Gear geosets (gloves, boots, ...) win over appearance ones in the same group.
		const gearGroups = new Set(gear.geosets.map((g) => Math.floor(g / 100)));
		return {
			fdid,
			options: {
				textures,
				geosets: [...gear.geosets, ...geosets.filter((g) => !gearGroups.has(Math.floor(g / 100)))],
				attachments: [...gear.attachments, ...weapons],
				defaultGeosets: true,
				stand: true,
			},
			missing,
		};
	}

	/**
	 * The skin: its layers in order, the base copied whole and the rest blended into the sections
	 * their masks name (a face onto the face sections, underwear onto the upper legs), then the
	 * gear's texture sections over them.
	 */
	private async composite(layout: Layout, skinLayers: { order: number; blend: number; mask: number; file: number }[], gearLayers: { section: number; file: number }[]): Promise<Image | null> {
		if (!layout.width || !layout.height) return null;
		const scale = Math.min(1, MAX_COMPOSITE / Math.max(layout.width, layout.height));
		const width = Math.max(1, Math.round(layout.width * scale));
		const height = Math.max(1, Math.round(layout.height * scale));
		const out: Image = { width, height, rgba: new Uint8Array(width * height * 4) };
		const scaled = (r: Rect): Rect => ({ x: Math.round(r.x * scale), y: Math.round(r.y * scale), w: Math.max(1, Math.round(r.w * scale)), h: Math.max(1, Math.round(r.h * scale)) });
		const whole: Rect = { x: 0, y: 0, w: width, h: height };
		const rectsFor = (mask: number): Rect[] => {
			if (mask === WHOLE) return [whole];
			const rects: Rect[] = [];
			for (let bit = 0; bit < 32; bit++) {
				if (!(mask & (1 << bit))) continue;
				const section = layout.sections.get(bit);
				if (section) rects.push(scaled(section));
			}
			return rects;
		};
		const images = new Map<number, Image | null>();
		const picture = async (file: number, maxSize: number): Promise<Image | null> => {
			if (!images.has(file)) {
				let image: Image | null = null;
				if (this.storage.status(file) === 'ok') {
					try {
						image = decodeBlp(await this.storage.readFile(file), maxSize);
					} catch {
						image = null;
					}
				}
				images.set(file, image);
			}
			return images.get(file) ?? null;
		};
		const sorted = [...skinLayers].sort((a, b) => a.order - b.order);
		let first = true;
		for (const layer of sorted) {
			const rects = rectsFor(layer.mask);
			if (!rects.length) continue;
			const image = await picture(layer.file, Math.max(...rects.map((r) => Math.max(r.w, r.h))));
			if (!image) continue;
			for (const rect of rects) blit(out, rect, image, !first);
			first = false;
		}
		if (first) return null;
		for (const layer of gearLayers) {
			const section = layout.sections.get(layer.section);
			if (!section) continue;
			const rect = scaled(section);
			const image = await picture(layer.file, Math.max(rect.w, rect.h));
			if (image) blit(out, rect, image, true);
		}
		return out;
	}
}

/** Draws a picture stretched over a rectangle of the target, sampled bilinearly, copied or alpha-blended over what's there. */
function blit(dst: Image, rect: Rect, src: Image, blend: boolean): void {
	const d = dst.rgba;
	const s = src.rgba;
	const x0 = Math.max(0, rect.x);
	const y0 = Math.max(0, rect.y);
	const x1 = Math.min(dst.width, rect.x + rect.w);
	const y1 = Math.min(dst.height, rect.y + rect.h);
	const sx = src.width / rect.w;
	const sy = src.height / rect.h;
	for (let y = y0; y < y1; y++) {
		const fy = Math.min(src.height - 1, Math.max(0, (y - rect.y + 0.5) * sy - 0.5));
		const iy = Math.floor(fy);
		const ty = fy - iy;
		const iy1 = Math.min(src.height - 1, iy + 1);
		for (let x = x0; x < x1; x++) {
			const fx = Math.min(src.width - 1, Math.max(0, (x - rect.x + 0.5) * sx - 0.5));
			const ix = Math.floor(fx);
			const tx = fx - ix;
			const ix1 = Math.min(src.width - 1, ix + 1);
			const p00 = (iy * src.width + ix) * 4, p10 = (iy * src.width + ix1) * 4, p01 = (iy1 * src.width + ix) * 4, p11 = (iy1 * src.width + ix1) * 4;
			const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
			const o = (y * dst.width + x) * 4;
			const a = (s[p00 + 3] * w00 + s[p10 + 3] * w10 + s[p01 + 3] * w01 + s[p11 + 3] * w11) / 255;
			for (let c = 0; c < 3; c++) {
				const v = s[p00 + c] * w00 + s[p10 + c] * w10 + s[p01 + c] * w01 + s[p11 + c] * w11;
				d[o + c] = blend ? Math.round(v * a + d[o + c] * (1 - a)) : Math.round(v);
			}
			d[o + 3] = blend ? Math.max(d[o + 3], Math.round(a * 255)) : Math.round(a * 255);
		}
	}
}
