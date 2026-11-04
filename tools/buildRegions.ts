// Builds public/spawns/regions.json and transports.json: what the game knows about each
// stretch of ground, for the explorer's ground tints, rested areas, weather, boats and zeppelins.
//
// - Each continent's area (subzone) per map chunk, read from the ADTs, so the viewer can tint
//   terrain that's only loaded in low detail.
// - Per area (VMaNGOS area_template): its zone, side (Alliance, Horde or contested), flags,
//   exploration level and XP, the levels of the creatures in it (from public/spawns, so run
//   `bun run spawns` first), and the fishing skill it takes (skill_fishing_base_level).
// - Graveyards: the server sends a ghost to the nearest graveyard linked to the zone it died in
//   that takes its side (game_graveyard_zone). Their positions are in WorldSafeLocs, which this
//   client no longer ships; wago.tools has it from the first classic build.
// - Inns and cities where resting builds up (areatrigger_tavern), and each zone's weather chances
//   per season (game_weather).
// - Boats and zeppelins (VMaNGOS transports): each one's display, round trip time and TaxiPath (the explorer
//   reads the route and model from the client).
//
// Usage: bun run regions -- [wowDir] [product] [path/to/mangos.sqlite]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CascStorage } from '../src/casc/storage';
import { DB2_FILES, loadTable } from '../src/explorer/clientDb';
import type { SpawnFile } from '../src/explorer/spawns';
import { findContinents } from '../src/explorer/continents';
import { MapExplorer } from '../src/explorer/maps';
import { CHUNK_SIZE, TILE_SIZE, parseAdtRoot } from '../src/formats/adt';
import { NodeSource } from './nodeSource';

const [
	wowDir = 'C:/Program Files (x86)/World of Warcraft',
	product = 'wow_classic_beta',
	DB = '.cache/vmangos/sqlite-dump/mangos.sqlite',
] = process.argv.slice(2);
/** Final vanilla content patch (1.12). */
const PATCH = 10;
const SAFE_LOCS = '.cache/wago/WorldSafeLocs.csv';
const SAFE_LOCS_URL = 'https://wago.tools/db2/WorldSafeLocs/csv?build=1.13.2.31446';
/** Map chunks across a continent (64 tiles of 16). */
const GRID = 64 * 16;
const MAP_ORIGIN = 32 * TILE_SIZE;
/** Client tables not in DB2_FILES (only read here). */
const FACTION_TEMPLATE = 1361579;
/** gameobject_template.displayId of the boats and zeppelins; the rest (Naxxramas floating over the Plaguelands) are left out. */
const TRANSPORT_KINDS: Record<number, 'ship' | 'zeppelin'> = { 3015: 'ship', 3031: 'zeppelin' };
/** creature_template.type: critters don't count towards an area's level. */
const TYPE_CRITTER = 8;

function query<T>(sql: string): T[] {
	const out = execFileSync('sqlite3', ['-json', DB, sql], { maxBuffer: 1 << 30 }).toString();
	return out.trim() ? (JSON.parse(out) as T[]) : [];
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A CSV line's fields; quoted fields may hold commas. */
function csvFields(line: string): string[] {
	const out: string[] = [];
	for (const m of line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)) {
		if (m.index === line.length && out.length) break;
		const v = m[1];
		out.push(v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v);
	}
	return out;
}

const storage = await CascStorage.open(new NodeSource(wowDir), product);
const areaTable = await loadTable(storage, DB2_FILES.AreaTable);
const explorer = new MapExplorer(storage);
const continents = await findContinents(storage);

// --- Areas per map chunk ---

/** Map ID -> area ID per chunk (row = WoW x falling, column = WoW y falling, as the ADT tiles). */
const grids = new Map<number, Uint32Array>();
for (const map of continents) {
	const grid = new Uint32Array(GRID * GRID);
	const wdt = await explorer.wdt(map.wdt);
	for (const tile of wdt.tiles) {
		if (!tile?.files.root) continue;
		try {
			const adt = parseAdtRoot(await storage.readFile(tile.files.root));
			for (const c of adt.chunks) grid[(tile.y * 16 + c.indexY) * GRID + tile.x * 16 + c.indexX] = c.areaId;
		} catch (e) {
			console.warn(`${map.name} ${tile.x}_${tile.y}:`, (e as Error).message);
		}
	}
	grids.set(map.mapId, grid);
}

/** The chunk a WoW position falls in, on a continent's grid. */
const chunkOf = (x: number, y: number) => {
	const col = Math.floor((MAP_ORIGIN - y) / CHUNK_SIZE);
	const row = Math.floor((MAP_ORIGIN - x) / CHUNK_SIZE);
	return col < 0 || row < 0 || col >= GRID || row >= GRID ? -1 : row * GRID + col;
};
/** The WoW position of a chunk's middle. */
const chunkCentre = (i: number) => ({ x: MAP_ORIGIN - (Math.floor(i / GRID) + 0.5) * CHUNK_SIZE, y: MAP_ORIGIN - ((i % GRID) + 0.5) * CHUNK_SIZE });

// --- What's known about each area ---

interface AreaTemplate { entry: number; zone_id: number; flags: number; area_level: number; name: string; team: number }
const templates = new Map(query<AreaTemplate>('select entry, zone_id, flags, area_level, name, team from area_template').map((a) => [a.entry, a]));
const baseXp = new Map(query<{ level: number; basexp: number }>('select level, basexp from exploration_basexp').map((r) => [r.level, r.basexp]));
const fishing = new Map(query<{ entry: number; skill: number }>('select entry, skill from skill_fishing_base_level').map((r) => [r.entry, r.skill]));

/** The top of an area's parent chain in the client's AreaTable (also covers areas VMaNGOS lacks). */
const zoneOf = (area: number): number => {
	const known = templates.get(area);
	if (known) return known.zone_id || area;
	for (let id = area, guard = 0; id && guard < 16; guard++) {
		const parent = areaTable.getInt(id, 3) ?? 0;
		if (!parent) return id;
		id = parent;
	}
	return area;
};

/**
 * Creatures on a side or friendly to players: FactionTemplate's faction group or friend group
 * (fields 2, 3) has the player, Alliance or Horde bit. Town guards, goblin bruisers, citizens.
 */
const factions = await loadTable(storage, FACTION_TEMPLATE);
const sided = (template: number) => (((factions.getInt(template, 2) ?? 0) | (factions.getInt(template, 3) ?? 0)) & 7) !== 0;

/** Creature levels per area: typical (middle half) of the ones you'd fight standing in it. */
const levels = new Map<number, number[]>();
for (const map of continents) {
	const file = `public/spawns/map${map.mapId}.json`;
	if (!existsSync(file)) {
		console.warn(`${file} missing (run bun run spawns): no creature levels for ${map.name}`);
		continue;
	}
	const spawns = JSON.parse(readFileSync(file, 'utf8')) as SpawnFile;
	const grid = grids.get(map.mapId)!;
	for (const [, entry, x, y] of spawns.creatures.spawns) {
		const t = spawns.creatures.templates[entry];
		// Vendors, trainers and quest givers (any NPC flag), critters and guards aren't what you fight.
		if (!t || t[4] === TYPE_CRITTER || t[6] !== 0 || sided(t[9])) continue;
		const i = chunkOf(x, y);
		const area = i >= 0 ? grid[i] : 0;
		if (!area) continue;
		const list = levels.get(area) ?? [];
		list.push((t[2] + t[3]) / 2);
		levels.set(area, list);
	}
}
const typical = (list: number[] | undefined): [number, number] | null => {
	if (!list || list.length < 3) return null;
	const sorted = [...list].sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
	return [Math.round(at(0.25)), Math.round(at(0.75))];
};

interface AreaOut {
	name: string;
	map: number;
	zone: number;
	/** 'alliance', 'horde' or 'contested'; inherited from the zone where the area has none. */
	side: 'alliance' | 'horde' | 'contested';
	/** area_template.flags: 0x80 free-for-all arena, 0x100 capital. */
	flags: number;
	/** Exploration level, and the XP for discovering it at that level (0: none). */
	level: number;
	xp: number;
	/** Typical creature levels in it, if enough stand there. */
	mobs: [number, number] | null;
	/** The fishing skill the area (or its zone) is rated at, if VMaNGOS has one. */
	fishing: number | null;
	/** Where to put its name: the middle of its chunk nearest its centre (WoW x, y). */
	x: number;
	y: number;
	/** How many map chunks it covers. */
	chunks: number;
}
const SIDES = { 2: 'alliance', 4: 'horde' } as const;
const areas: Record<number, AreaOut> = {};
for (const map of continents) {
	const grid = grids.get(map.mapId)!;
	const sums = new Map<number, { x: number; y: number; n: number }>();
	for (let i = 0; i < grid.length; i++) {
		const a = grid[i];
		if (!a) continue;
		const c = chunkCentre(i);
		const s = sums.get(a) ?? { x: 0, y: 0, n: 0 };
		s.x += c.x;
		s.y += c.y;
		s.n++;
		sums.set(a, s);
	}
	// The label goes on one of the area's own chunks (a crescent's centre can lie outside it).
	const best = new Map<number, { d: number; i: number }>();
	for (let i = 0; i < grid.length; i++) {
		const a = grid[i];
		if (!a) continue;
		const s = sums.get(a)!;
		const c = chunkCentre(i);
		const d = (c.x - s.x / s.n) ** 2 + (c.y - s.y / s.n) ** 2;
		if (d < (best.get(a)?.d ?? Infinity)) best.set(a, { d, i });
	}
	for (const [a, s] of sums) {
		const t = templates.get(a);
		const zone = zoneOf(a);
		const z = templates.get(zone);
		const team = (t?.team || z?.team || 0) as 0 | 2 | 4;
		const level = t?.area_level ?? 0;
		const c = chunkCentre(best.get(a)!.i);
		areas[a] = {
			name: t?.name ?? areaTable.getString(a, 1) ?? `Area ${a}`,
			map: map.mapId,
			zone,
			side: SIDES[team as 2 | 4] ?? 'contested',
			flags: t?.flags ?? 0,
			level,
			xp: level > 0 ? baseXp.get(level) ?? 0 : 0,
			mobs: typical(levels.get(a)),
			fishing: fishing.get(a) ?? fishing.get(zone) ?? null,
			x: round(c.x, 1),
			y: round(c.y, 1),
			chunks: s.n,
		};
	}
}
// Zones with too few creatures in a subzone fall back on the zone's own range.
for (const a of Object.values(areas)) a.mobs ??= areas[a.zone]?.mobs ?? null;

// --- Graveyards ---

if (!existsSync(SAFE_LOCS)) {
	console.log('Downloading', SAFE_LOCS_URL);
	const res = await fetch(SAFE_LOCS_URL);
	if (!res.ok) throw new Error(`WorldSafeLocs: HTTP ${res.status}`);
	mkdirSync('.cache/wago', { recursive: true });
	writeFileSync(SAFE_LOCS, await res.text());
}
const [header, ...lines] = readFileSync(SAFE_LOCS, 'utf8').trim().split(/\r?\n/);
const columns = csvFields(header);
const col = (name: string) => columns.indexOf(name);
const safeLocs = new Map(lines.map((line) => {
	const f = csvFields(line);
	return [Number(f[col('ID')]), { name: f[col('AreaName_lang')], map: Number(f[col('Continent')]), x: Number(f[col('Loc_0')]), y: Number(f[col('Loc_1')]), z: Number(f[col('Loc_2')]) }];
}));
const links = query<{ id: number; zone: number; faction: number }>(`select id, ghost_zone as zone, faction from game_graveyard_zone
	where patch_min <= ${PATCH} and patch_max >= ${PATCH} order by ghost_zone, id`);
const used = [...new Set(links.map((l) => l.id))].sort((a, b) => a - b);
const missing = used.filter((id) => !safeLocs.has(id));
if (missing.length) console.warn('Graveyards with no position, left out:', missing.join(', '));
const graveyards = used.filter((id) => safeLocs.has(id)).map((id) => {
	const s = safeLocs.get(id)!;
	return { id, name: s.name, map: s.map, x: round(s.x), y: round(s.y), z: round(s.z) };
});
/** Zone -> [graveyard, faction (0 any, 469 Alliance, 67 Horde)][]. */
const graveyardZones: Record<number, [number, number][]> = {};
for (const l of links) if (safeLocs.has(l.id)) (graveyardZones[l.zone] ??= []).push([l.id, l.faction]);

// --- Inns, weather ---

const taverns = query<{ id: number; name: string; map: number; x: number; y: number; z: number; radius: number; bx: number; by: number; bz: number; bo: number }>(`
	select t.id, max(t.name) as name, a.map_id as map, a.x, a.y, a.z, a.radius, a.box_x as bx, a.box_y as by, a.box_z as bz, a.box_orientation as bo
	from areatrigger_tavern t join areatrigger_template a on a.id = t.id
	where t.patch_min <= ${PATCH} group by t.id`).map((t) => ({
	id: t.id,
	name: t.name.replace(/^.*? - /, '').trim() || t.name,
	place: t.name,
	map: t.map,
	x: round(t.x), y: round(t.y), z: round(t.z),
	radius: round(t.radius),
	box: t.radius > 0 ? null : [round(t.bx), round(t.by), round(t.bz), round(t.bo, 3)],
}));

const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const KINDS = ['rain', 'snow', 'storm'];
const weather: Record<number, number[]> = {};
for (const w of query<Record<string, number>>('select * from game_weather')) {
	weather[w.zone] = SEASONS.flatMap((s) => KINDS.map((k) => w[`${s}_${k}_chance`]));
}

// --- Encoding the grids ---

// Run-length coded row by row: [area, count, area, count, ...].
const maps: Record<number, number[]> = {};
for (const [mapId, grid] of grids) {
	const runs: number[] = [];
	for (let i = 0; i < grid.length;) {
		let j = i + 1;
		while (j < grid.length && grid[j] === grid[i]) j++;
		runs.push(grid[i], j - i);
		i = j;
	}
	maps[mapId] = runs;
	const zones = new Set([...new Set(grid)].map(zoneOf));
	const unlinked = [...zones].filter((z) => z && !graveyardZones[z]);
	console.log(`map ${mapId}: ${new Set(grid).size - 1} areas in ${zones.size - 1} zones, ${runs.length / 2} runs; zones with no graveyard: ${unlinked.join(', ') || 'none'}`);
}

mkdirSync('public/spawns', { recursive: true });
writeFileSync('public/spawns/regions.json', JSON.stringify({
	source: 'Areas, graveyard links, inns, weather, fishing: VMaNGOS world database (GPL-2.0), patch 1.12. Graveyard positions: WorldSafeLocs 1.13.2 via wago.tools. Area per chunk: the game\'s map files.',
	areas,
	maps,
	graveyards,
	graveyardZones,
	taverns,
	weather,
}));
console.log('public/spawns/regions.json', Object.keys(areas).length, 'areas,', graveyards.length, 'graveyards,', taverns.length, 'inns,', Object.keys(weather).length, 'zones with weather');

// --- Boats and zeppelins ---

// A transport's latest row (the build the server picks); its game object says which model it is
// and which TaxiPath it follows (data0).
const transportRows = query<{ entry: number; name: string; period: number; displayId: number; path: number }>(`
	select t.entry, t.name, t.period, g.displayId, g.data0 as path
	from transports t join gameobject_template g on g.entry = t.entry
	where t.build = (select max(build) from transports where entry = t.entry)
		and g.patch = (select max(patch) from gameobject_template where entry = t.entry and patch <= ${PATCH})
	order by t.entry`);
// Their models and routes are read from the client by the explorer (TaxiPathNode, GameObjectDisplayInfo).
const transports = transportRows.flatMap((t) => {
	const kind = TRANSPORT_KINDS[t.displayId];
	if (!kind) return [];
	return [{
		entry: t.entry,
		// VMaNGOS spells it "Forgotton".
		name: t.name.replace('Forgotton', 'Forgotten'),
		kind,
		displayId: t.displayId,
		period: t.period,
		path: t.path,
	}];
});
writeFileSync('public/spawns/transports.json', JSON.stringify({
	source: 'Transports and their periods: VMaNGOS world database (GPL-2.0). Their routes and models come from the game\'s client database when the explorer runs.',
	transports,
}));
console.log('public/spawns/transports.json', transports.length, 'boats and zeppelins:', transports.map((t) => t.name).join(', '));
