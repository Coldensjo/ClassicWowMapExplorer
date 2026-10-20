// The Forever compatibility check (spec 7.1.1): opens a real install and exercises every reused
// parser against its build, so gaps are found before Phase 2. Prints one PASS/FAIL line per check
// and exits non-zero when any fails.
// Usage: bun run compat -- [wowDir] [product]
import { CascStorage } from '../src/casc/storage';
import { parseAdtRoot, CHUNK_HEIGHTS } from '../src/formats/adt';
import { parseAdtTex, ALPHA_SIZE } from '../src/formats/adtTex';
import { parseWdt } from '../src/formats/wdt';
import { decodeBlp } from '../src/formats/blp';
import { parseM2, parseSkin } from '../src/formats/m2';
import { parseWmoRoot, parseWmoGroup } from '../src/formats/wmo';
import { DB2_FILES, loadTable, liquidLooks } from '../src/explorer/clientDb';
import { fieldMap } from '../src/explorer/db2Layouts';
import { DisplayResolver } from '../src/explorer/display';
import { KNOWN_MAPS } from '../src/explorer/maps';
import { parsePlacements } from '../src/explorer/objects';
import { NodeSource } from './nodeSource';

const [wowDir = '/Volumes/SANDISK SSD/World of Warcraft', product = 'wow_classic_beta'] = process.argv.slice(2);

/** Every DB2 table the spec relies on (7.1.1), by name and file ID. */
const TABLES: Record<string, number> = {
	...DB2_FILES,
	CreatureDisplayInfo: 1108759,
	CreatureDisplayInfoExtra: 1264997,
	CreatureDisplayInfoOption: 3692043,
	CreatureModelData: 1365368,
	ItemDisplayInfo: 1266429,
	NPCModelItemSlotDisplayInfo: 1340661,
	HelmetGeosetData: 2821752,
	ModelFileData: 1337833,
	ComponentModelFileData: 1349053,
	ChrCustomizationOption: 3384247,
	ChrCustomizationChoice: 3450554,
	ChrCustomizationElement: 3512765,
	ChrCustomizationGeoset: 3456171,
	ChrCustomizationMaterial: 3459652,
};

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

// CASC storage: indexes, encoding and root over the real install.
const source = new NodeSource(wowDir);
const storage = await CascStorage.open(source, product);
results.push({
	check: 'CASC storage',
	ok: true,
	detail: `${storage.stats.product} ${storage.stats.version} (${storage.stats.buildName}): ${storage.stats.indexEntries} index entries, ${storage.stats.encodingPages} encoding pages, ${storage.stats.rootFiles} root files`,
});

// Every DB2 table the spec relies on: parses as WDC5, and reports whether its layout is the one
// the code numbers fields by (native), a known other layout (mapped), or an unknown one.
for (const [name, fdid] of Object.entries(TABLES)) {
	await check(`DB2 ${name}`, async () => {
		const table = await loadTable(storage, fdid);
		const rows = table.ids().length;
		expect(rows > 0, 'no rows');
		const layout = fieldMap(fdid, table.layoutHash) ? 'mapped' : 'native';
		return `${rows} rows, ${table.fieldCount} fields, layout 0x${table.layoutHash.toString(16)} (${layout})${table.skippedSections ? `, ${table.skippedSections} encrypted sections skipped` : ''}`;
	});
}

// Table contents the features lean on, not just parseability.
await check('Map rows resolve', async () => {
	const map = await loadTable(storage, DB2_FILES.Map);
	const withWdt: string[] = [];
	for (const id of map.ids()) {
		const directory = map.getString(id, 0);
		const wdt = map.getInt(id, 21);
		if (directory && wdt && storage.status(wdt) === 'ok') withWdt.push(directory);
	}
	for (const known of KNOWN_MAPS) {
		expect(withWdt.includes(known.directory), `${known.directory} has no readable WDT via Map.db2`);
	}
	return `${withWdt.length} maps with a readable WDT, including ${KNOWN_MAPS.map((m) => m.directory).join(' and ')}`;
});

await check('LiquidType looks', async () => {
	const looks = await liquidLooks(storage);
	const typed = Object.keys(looks.types).length;
	expect(typed > 0, 'no liquid types');
	expect(looks.types[looks.ocean] !== undefined, 'no ocean type');
	return `${typed} liquid types, ocean is type ${looks.ocean}`;
});

await check('Ground effect tables join', async () => {
	const textures = await loadTable(storage, DB2_FILES.GroundEffectTexture);
	const doodads = await loadTable(storage, DB2_FILES.GroundEffectDoodad);
	const doodadIds = new Set(doodads.ids());
	let checked = 0;
	let resolved = 0;
	for (const id of textures.ids().slice(0, 500)) {
		for (let k = 0; k < 4; k++) {
			const doodad = textures.getInt(id, 0, k) ?? 0;
			if (!doodad) continue;
			checked++;
			if (doodadIds.has(doodad)) resolved++;
		}
	}
	expect(checked > 0, 'no doodad references in GroundEffectTexture');
	expect(resolved / checked > 0.9, `only ${resolved} of ${checked} doodad references resolve`);
	return `${resolved}/${checked} doodad references resolve against GroundEffectDoodad`;
});

// WDT and ADT: a real tile's root, _tex0 and _obj0 files.
const azeroth = KNOWN_MAPS[0];
const wdt = parseWdt(await storage.readFile(azeroth.wdt));
const tiles = wdt.tiles.filter((t) => t !== null);
results.push({ check: 'WDT Azeroth', ok: tiles.length > 0, detail: `${tiles.length} tiles, flags 0x${wdt.flags.toString(16)}` });
const tile = wdt.tiles[48 * 64 + 32]!; // 32_48: Elwynn Forest

const root = parseAdtRoot(await storage.readFile(tile.files.root));
await check('ADT root (32_48)', async () => {
	expect(root.chunks.length === 256, `${root.chunks.length} chunks, expected 256`);
	for (const c of root.chunks.slice(0, 8)) {
		expect(c.heights.length === CHUNK_HEIGHTS, `chunk has ${c.heights.length} heights`);
		expect(c.heights.every(Number.isFinite), 'non-finite heights');
	}
	return `256 chunks, ${root.liquids.length} liquid instances, water ${root.hasWater}, chunk ids [${root.chunkIds.join(' ')}]`;
});

const tex = parseAdtTex(await storage.readFile(tile.files.tex0), (wdt.flags & 0x4) !== 0);
await check('ADT _tex0 (32_48)', async () => {
	expect(tex.diffuse.length > 0, 'no diffuse textures');
	expect(tex.chunks.length === 256, `${tex.chunks.length} tex chunks`);
	let layered = 0;
	let effects = 0;
	for (const c of tex.chunks) {
		expect(c.layers.length >= 1 && c.layers.length <= 4, `${c.layers.length} layers`);
		expect(c.alpha.length === c.layers.length - 1, 'alpha count != layers - 1');
		for (const a of c.alpha) expect(a.length === ALPHA_SIZE * ALPHA_SIZE, `alpha map of ${a.length}`);
		if (c.layers.length > 1) layered++;
		effects += c.layers.filter((l) => l.effect).length;
	}
	return `${tex.diffuse.length} textures, ${layered}/256 chunks layered, ${effects} layers with ground effects`;
});

const placements = parsePlacements(await storage.readFile(tile.files.obj0));
const m2s = placements.filter((p) => p.kind === 'm2');
const wmos = placements.filter((p) => p.kind === 'wmo');
results.push({ check: 'ADT _obj0 (32_48)', ok: m2s.length > 0 && wmos.length > 0, detail: `${m2s.length} doodads, ${wmos.length} WMOs` });

// BLP: decode a terrain tileset texture the tile paints with.
await check('BLP tileset texture', async () => {
	const image = decodeBlp(await storage.readFile(tex.diffuse[0]));
	expect(image.width >= 64 && image.height >= 64, `decoded ${image.width}x${image.height}`);
	expect(image.rgba.length === image.width * image.height * 4, 'rgba size mismatch');
	return `fdid ${tex.diffuse[0]}: ${image.width}x${image.height}`;
});

// M2: a placed doodad's model and its skin.
await check('M2 doodad', async () => {
	const fdid = m2s[0].fdid;
	const m2 = parseM2(await storage.readFile(fdid));
	expect(m2.vertexCount > 0, 'no vertices');
	expect(m2.skinFdids.length > 0, 'no skins');
	const skin = parseSkin(await storage.readFile(m2.skinFdids[0]));
	expect(skin.batches.length > 0, 'skin has no batches');
	return `fdid ${fdid}: version ${m2.version}, ${m2.vertexCount} vertices, ${m2.skinFdids.length} skins, first skin ${skin.batches.length} batches, collision ${m2.collision.indices.length / 3} tris`;
});

// WMO: a placed building's root and first group.
await check('WMO building', async () => {
	const fdid = wmos[0].fdid;
	const wmo = parseWmoRoot(await storage.readFile(fdid));
	expect(wmo.groupFdids.length > 0, 'no groups');
	expect(wmo.materials.length > 0, 'no materials');
	const group = parseWmoGroup(await storage.readFile(wmo.groupFdids[0]));
	expect(group.positions.length > 0, 'group has no geometry');
	return `fdid ${fdid}: ${wmo.groupFdids.length} groups, ${wmo.materials.length} materials, ${wmo.doodadSets.length} doodad sets, first group ${group.positions.length / 3} vertices`;
});

// Character tables: races, looks, and both SD and HD models (Forever's model toggle).
await check('Character races and looks', async () => {
	const displays = new DisplayResolver(storage);
	const races = await displays.characterRaces();
	expect(races.length >= 8, `${races.length} races with character models`);
	const sd = races.filter((r) => r.sexes.some((s) => s.sd)).length;
	const hd = races.filter((r) => r.sexes.some((s) => s.hd)).length;
	expect(sd > 0, 'no SD character models');
	expect(hd > 0, 'no HD character models');
	const human = await displays.character(1, 0, true, 0, []);
	expect(human !== null, 'human male HD look did not resolve');
	return `${races.length} races (${sd} with SD looks, ${hd} with HD), human male HD resolves to fdid ${human!.fdid} of ${human!.looks} looks`;
});

// CreatureDisplayInfo: a sample of displays resolve through CreatureModelData to readable models.
await check('CreatureDisplayInfo resolves models', async () => {
	const displays = await loadTable(storage, TABLES.CreatureDisplayInfo);
	const models = await loadTable(storage, TABLES.CreatureModelData);
	let checked = 0;
	let readable = 0;
	for (const id of displays.ids()) {
		if (checked >= 200) break;
		const model = displays.getInt(id, 0);
		if (!model) continue;
		const fdid = models.getInt(model, 2);
		if (!fdid) continue;
		checked++;
		if (storage.status(fdid) === 'ok') readable++;
	}
	expect(checked > 0, 'no displays with models');
	expect(readable / checked > 0.9, `only ${readable} of ${checked} models readable`);
	return `${readable}/${checked} sampled displays resolve to readable M2s`;
});

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
