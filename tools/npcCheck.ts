// The Phase 5 client verification (spec 12, Phase 5): settles Q8 (where gear names come from) and
// Q9 ("Customize as new" on humanoid displays) against a real install, and checks that the
// character, customization and gear texture tables the NPC features lean on join up with the field
// numbers in src/explorer/npcTables.ts. Prints one PASS/FAIL line per check and exits non-zero
// when any fails. Results are recorded in docs/phase5-verification.md.
// Usage: bun run npccheck -- [wowDir] [product]
import { CascStorage } from '../src/casc/storage';
import { DISPLAY_FILES } from '../src/explorer/display';
import { loadTable } from '../src/explorer/clientDb';
import {
	APPEARANCE_DISPLAY, CHOICE_OPTION, CHR_MODEL_DISPLAY, CHR_MODEL_LAYOUT, CHR_MODEL_SEX, CHR_RACES_NAME, COMPONENT_TEXTURE_SEX, CREATURE_EXTRA, CREATURE_MODEL,
	EXTRA_RACE, EXTRA_SEX, ITEM_INVENTORY_TYPE, ITEM_MATERIAL_RESOURCE, ITEM_MATERIAL_SECTION, ITEM_SPARSE_DESCRIPTION, ITEM_SPARSE_NAME, LAYER_TEXTURE_TYPE, LAYOUT_HEIGHT, LAYOUT_WIDTH,
	MATERIAL_RESOURCE, MODEL_FILE, MODIFIED_APPEARANCE, MODIFIED_ITEM, NPC_FILES, NPC_SLOT_DISPLAY, NPC_SLOT_SLOT, OPTION_MODEL, OPTION_NAME, RACE_MODEL_MODEL, RACE_MODEL_RACE, RACE_MODEL_SEX,
	SECTION_LAYOUT, SECTION_TYPE, TEXTURE_FILE_MATERIAL,
} from '../src/explorer/npcTables';
import { NodeSource } from './nodeSource';

const [wowDir = '/Volumes/SANDISK SSD/World of Warcraft', product = 'wow_classic_beta'] = process.argv.slice(2);

const results: { check: string; ok: boolean; detail: string }[] = [];
async function check(name: string, fn: () => Promise<string>): Promise<void> {
	try {
		results.push({ check: name, ok: true, detail: await fn() });
	} catch (e) {
		results.push({ check: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
	}
}
const expect = (cond: boolean, message: string) => {
	if (!cond) throw new Error(message);
};

const storage = await CascStorage.open(new NodeSource(wowDir), product);
results.push({ check: 'CASC storage', ok: true, detail: `${storage.stats.product} ${storage.stats.version} (${storage.stats.buildName})` });
const t = (fdid: number) => loadTable(storage, fdid);
const [sparse, item, modified, appearance, displayInfo, materialRes, componentTextures, textureFiles, creatureDisplay, creatureModel, displayExtra, npcSlots, chrModel, raceModel, races, option, choice, material, displayOption, layouts, sections, layers] = await Promise.all([
	t(NPC_FILES.ItemSparse), t(NPC_FILES.Item), t(NPC_FILES.ItemModifiedAppearance), t(NPC_FILES.ItemAppearance), t(DISPLAY_FILES.ItemDisplayInfo), t(NPC_FILES.ItemDisplayInfoMaterialRes),
	t(NPC_FILES.ComponentTextureFileData), t(DISPLAY_FILES.TextureFileData), t(DISPLAY_FILES.CreatureDisplayInfo), t(DISPLAY_FILES.CreatureModelData), t(DISPLAY_FILES.CreatureDisplayInfoExtra),
	t(DISPLAY_FILES.NPCModelItemSlotDisplayInfo), t(NPC_FILES.ChrModel), t(NPC_FILES.ChrRaceXChrModel), t(NPC_FILES.ChrRaces), t(DISPLAY_FILES.ChrCustomizationOption), t(DISPLAY_FILES.ChrCustomizationChoice),
	t(DISPLAY_FILES.ChrCustomizationMaterial), t(DISPLAY_FILES.CreatureDisplayInfoOption), t(NPC_FILES.CharComponentTextureLayouts), t(NPC_FILES.CharComponentTextureSections), t(NPC_FILES.ChrModelTextureLayer),
]);

// Q8, part 1: ItemSparse is a sparse table whose strings sit inline; the name is the fifth.
await check('ItemSparse (sparse) names', async () => {
	expect(sparse.sparse, 'ItemSparse is not a sparse table in this build');
	expect(sparse.size > 10000, `only ${sparse.size} rows`);
	expect(sparse.getString(25, ITEM_SPARSE_NAME) === 'Worn Shortsword', `item 25 is named "${sparse.getString(25, ITEM_SPARSE_NAME)}"`);
	expect(sparse.getString(728, ITEM_SPARSE_DESCRIPTION)?.startsWith('Teaches you') === true, `item 728's description reads "${sparse.getString(728, ITEM_SPARSE_DESCRIPTION)}"`);
	let named = 0;
	for (const id of sparse.ids()) if (sparse.getString(id, ITEM_SPARSE_NAME)) named++;
	return `${sparse.size} rows, ${named} named, e.g. 19019 "${sparse.getString(19019, ITEM_SPARSE_NAME)}"`;
});

// Q8, part 2: item display -> ItemAppearance -> ItemModifiedAppearance -> Item -> ItemSparse name.
const appearancesByDisplay = new Map<number, number[]>();
for (const id of appearance.ids()) {
	const d = appearance.getInt(id, APPEARANCE_DISPLAY) ?? 0;
	appearancesByDisplay.set(d, [...(appearancesByDisplay.get(d) ?? []), id]);
}
const itemsByAppearance = new Map<number, number[]>();
for (const id of modified.ids()) {
	const a = modified.getInt(id, MODIFIED_APPEARANCE) ?? 0;
	itemsByAppearance.set(a, [...(itemsByAppearance.get(a) ?? []), modified.getInt(id, MODIFIED_ITEM) ?? 0]);
}
const nameOf = (display: number): string | null => {
	for (const a of appearancesByDisplay.get(display) ?? []) {
		for (const it of itemsByAppearance.get(a) ?? []) {
			const name = sparse.getString(it, ITEM_SPARSE_NAME);
			if (name) return name;
		}
	}
	return null;
};
await check('Q8: gear names via item appearances', async () => {
	let reachable = 0;
	let named = 0;
	for (const display of displayInfo.ids()) {
		if (!appearancesByDisplay.has(display)) continue;
		reachable++;
		if (nameOf(display)) named++;
	}
	expect(named > 3000, `only ${named} displays have a name`);
	const slots = new Map<number, number>();
	for (const id of item.ids()) {
		const type = item.getInt(id, ITEM_INVENTORY_TYPE) ?? 0;
		if (type) slots.set(type, (slots.get(type) ?? 0) + 1);
	}
	return `${displayInfo.size} item displays, ${reachable} reachable from items, ${named} with an ItemSparse name; items per InventoryType ${[...slots].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`;
});

// Q8, part 3: what NPCs wear is mostly NPC-only gear with no item, so it has no name: those fall
// back to the path-labelled browser, with their slot from NPCModelItemSlotDisplayInfo.
await check('Q8: NPC-worn gear and names', async () => {
	const worn = new Map<number, Set<number>>();
	for (const id of npcSlots.ids()) {
		const d = npcSlots.getInt(id, NPC_SLOT_DISPLAY) ?? 0;
		const slot = npcSlots.getInt(id, NPC_SLOT_SLOT) ?? 0;
		expect(slot >= 0 && slot <= 10, `NPC slot ${slot} is outside 0..10`);
		if (d) worn.set(d, (worn.get(d) ?? new Set()).add(slot));
	}
	let named = 0;
	for (const d of worn.keys()) if (nameOf(d)) named++;
	const guardExtra = creatureDisplay.getInt(3167, CREATURE_EXTRA) ?? 0;
	const guard = npcSlots.ids().filter((id) => npcSlots.getParent(id) === guardExtra).map((id) => `slot ${npcSlots.getInt(id, NPC_SLOT_SLOT)} = ${nameOf(npcSlots.getInt(id, NPC_SLOT_DISPLAY)!) ?? `display ${npcSlots.getInt(id, NPC_SLOT_DISPLAY)} (unnamed)`}`);
	expect(guard.length > 0, 'the Stormwind guard (display 3167) wears nothing');
	return `${worn.size} distinct displays worn by NPCs, ${named} of them named; the Stormwind guard wears ${guard.join(', ')}`;
});

// Q9: a humanoid display's race, sex, customization choices and worn gear map back to the
// custom NPC editor's inputs: the choices belong to the race/sex model's options.
const modelFor = new Map<string, number>();
for (const id of raceModel.ids()) modelFor.set(`${raceModel.getInt(id, RACE_MODEL_RACE)}:${raceModel.getInt(id, RACE_MODEL_SEX)}`, raceModel.getInt(id, RACE_MODEL_MODEL) ?? 0);
const picksByExtra = new Map<number, [number, number][]>();
for (const id of displayOption.ids()) {
	const extra = displayOption.getParent(id);
	if (extra === null) continue;
	picksByExtra.set(extra, [...(picksByExtra.get(extra) ?? []), [displayOption.getInt(id, 0) ?? 0, displayOption.getInt(id, 1) ?? 0]]);
}
await check('Q9: humanoid displays map to race, sex, customization and gear', async () => {
	let humanoids = 0;
	let whole = 0;
	let partial = 0;
	let none = 0;
	for (const id of creatureDisplay.ids()) {
		const extra = creatureDisplay.getInt(id, CREATURE_EXTRA) ?? 0;
		if (!extra || !displayExtra.has(extra)) continue;
		humanoids++;
		const model = modelFor.get(`${displayExtra.getInt(extra, EXTRA_RACE)}:${displayExtra.getInt(extra, EXTRA_SEX)}`);
		const picks = picksByExtra.get(extra) ?? [];
		if (!picks.length) {
			none++;
			continue;
		}
		const ok = picks.filter(([optionId]) => option.getInt(optionId, OPTION_MODEL) === model).length;
		if (ok === picks.length) whole++;
		else if (ok) partial++;
	}
	expect(humanoids > 1000, `only ${humanoids} humanoid displays`);
	expect(whole / humanoids > 0.98, `only ${whole} of ${humanoids} map whole`);
	return `${humanoids} humanoid displays: ${whole} with every choice in their race/sex model's options, ${partial} partial, ${none} without choices`;
});

// The dressable models (spec 7.9.3): every race and sex in ChrRaceXChrModel resolves to a readable M2.
await check('Character models (ChrRaceXChrModel -> ChrModel -> M2)', async () => {
	let total = 0;
	let readable = 0;
	let unsexed = 0;
	const names: string[] = [];
	for (const id of raceModel.ids()) {
		const race = raceModel.getInt(id, RACE_MODEL_RACE) ?? 0;
		const model = raceModel.getInt(id, RACE_MODEL_MODEL) ?? 0;
		const sex = raceModel.getInt(id, RACE_MODEL_SEX) ?? 0;
		// A few non-player models are listed with sex 3 (neither); the playable ones say 0 or 1.
		if (chrModel.getInt(model, CHR_MODEL_SEX) !== sex) unsexed++;
		const display = chrModel.getInt(model, CHR_MODEL_DISPLAY) ?? 0;
		const fdid = creatureModel.getInt(creatureDisplay.getInt(display, CREATURE_MODEL) ?? 0, MODEL_FILE) ?? 0;
		total++;
		if (fdid && storage.status(fdid) === 'ok') {
			readable++;
			if (names.length < 6) names.push(`${races.getString(race, CHR_RACES_NAME)} ${sex ? 'female' : 'male'} → ${fdid}`);
		}
	}
	expect(readable >= 16, `only ${readable} of ${total} race/sex models are readable`);
	for (const [race, sex] of [[1, 0], [1, 1], [2, 0], [2, 1]]) expect(modelFor.has(`${race}:${sex}`), `race ${race} sex ${sex} has no ChrModel`);
	return `${readable}/${total} race and sex models readable (${unsexed} listed with a sex their ChrModel disagrees with), e.g. ${names.join('; ')}`;
});

// Customization options per model, with choices (spec 7.9.3).
await check('Customization options and choices per model', async () => {
	const humanMale = modelFor.get('1:0') ?? 0;
	const options = option.ids().filter((id) => option.getInt(id, OPTION_MODEL) === humanMale);
	expect(options.length >= 4, `human male has ${options.length} options`);
	const choicesOf = (opt: number) => choice.ids().filter((c) => choice.getInt(c, CHOICE_OPTION) === opt).length;
	const described = options.map((id) => `${option.getString(id, OPTION_NAME)} (${choicesOf(id)})`);
	expect(described.some((d) => d.startsWith('Skin Color')), 'no Skin Color option');
	return `human male model ${humanMale}: ${described.join(', ')}`;
});

// Texture layouts: every ChrModel's layout has a size, body sections and a base skin layer.
await check('Texture layouts, sections and layers', async () => {
	let checked = 0;
	const sizes = new Set<string>();
	const partial: number[] = [];
	// The playable races' models must have every body section; other models (sexless forms) may not.
	const playable = new Set([...modelFor].filter(([key]) => Number(key.split(':')[0]) <= 11).map(([, model]) => model));
	for (const model of chrModel.ids()) {
		const layout = chrModel.getInt(model, CHR_MODEL_LAYOUT) ?? 0;
		if (!layout || !layouts.has(layout)) continue;
		checked++;
		sizes.add(`${layouts.getInt(layout, LAYOUT_WIDTH)}x${layouts.getInt(layout, LAYOUT_HEIGHT)}`);
		const types = new Set(sections.ids().filter((id) => sections.getInt(id, SECTION_LAYOUT) === layout).map((id) => sections.getInt(id, SECTION_TYPE)));
		const whole = [0, 1, 2, 3, 4, 5, 6, 7].every((type) => types.has(type));
		if (!whole) partial.push(layout);
		if (playable.has(model)) expect(whole, `layout ${layout} of playable model ${model} lacks body sections`);
		const skinLayers = layers.ids().filter((id) => layers.getParent(id) === layout && layers.getInt(id, LAYER_TEXTURE_TYPE) === 1);
		if (playable.has(model)) expect(skinLayers.length > 0, `layout ${layout} has no skin texture layers`);
	}
	expect(checked >= 16, `only ${checked} models have a layout`);
	return `${checked} model layouts, sizes ${[...sizes].join(', ')}; ${partial.length} layouts without the full body sections (none playable)`;
});

// Customization materials and gear materials resolve to texture files.
const textureByMaterial = new Map<number, number>();
for (const file of textureFiles.ids()) {
	const m = textureFiles.getInt(file, TEXTURE_FILE_MATERIAL) ?? 0;
	if (m && !textureByMaterial.has(m)) textureByMaterial.set(m, file);
}
await check('Customization materials -> textures', async () => {
	let checked = 0;
	let resolved = 0;
	for (const id of material.ids()) {
		if (checked >= 3000) break;
		checked++;
		const file = textureByMaterial.get(material.getInt(id, MATERIAL_RESOURCE) ?? 0);
		if (file && storage.status(file) === 'ok') resolved++;
	}
	expect(resolved / checked > 0.9, `only ${resolved} of ${checked} resolve`);
	return `${resolved}/${checked} sampled materials resolve to a readable texture`;
});
await check('Gear texture components -> textures', async () => {
	const filesByMaterial = new Map<number, number[]>();
	for (const file of componentTextures.ids()) {
		const m = textureFiles.getInt(file, TEXTURE_FILE_MATERIAL) ?? textureFiles.getParent(file) ?? 0;
		if (m) filesByMaterial.set(m, [...(filesByMaterial.get(m) ?? []), file]);
	}
	let checked = 0;
	let resolved = 0;
	let sexed = 0;
	for (const id of materialRes.ids()) {
		if (checked >= 3000) break;
		checked++;
		const section = materialRes.getInt(id, ITEM_MATERIAL_SECTION) ?? -1;
		expect(section >= 0 && section <= 12, `component section ${section}`);
		const files = filesByMaterial.get(materialRes.getInt(id, ITEM_MATERIAL_RESOURCE) ?? 0) ?? [];
		if (files.some((f) => storage.status(f) === 'ok')) resolved++;
		if (files.some((f) => (componentTextures.getInt(f, COMPONENT_TEXTURE_SEX) ?? 3) !== 3)) sexed++;
	}
	expect(resolved / checked > 0.9, `only ${resolved} of ${checked} resolve`);
	return `${resolved}/${checked} sampled gear sections resolve to a readable texture, ${sexed} with a per-sex texture`;
});

// Creature displays (spec 7.9.2): models readable, grouped by model file.
await check('Creature displays', async () => {
	const models = new Set<number>();
	let total = 0;
	let readable = 0;
	for (const id of creatureDisplay.ids()) {
		const fdid = creatureModel.getInt(creatureDisplay.getInt(id, CREATURE_MODEL) ?? 0, MODEL_FILE) ?? 0;
		if (!fdid) continue;
		total++;
		models.add(fdid);
		if (storage.status(fdid) === 'ok') readable++;
	}
	expect(readable / total > 0.9, `only ${readable} of ${total} readable`);
	return `${total} displays with a model, ${readable} readable, ${models.size} distinct model files`;
});

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
