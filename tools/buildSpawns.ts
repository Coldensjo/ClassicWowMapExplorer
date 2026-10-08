// Builds public/spawns/map<id>.json from the VMaNGOS world database (vanilla 1.12, GPL):
// creature and game object spawns with the template fields the viewer shows. Spawns that only
// appear during world events (Hallow's End, Winter Veil, ...) are left out.
// Usage: npm run spawns -- [path/to/mangos.sqlite]
// Get the database from https://github.com/vmangos/core/releases/tag/db_latest (db-sqlite-*.zip).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DB = process.argv[2] ?? '.cache/vmangos/sqlite-dump/mangos.sqlite';
/** The continents; the dungeons reachable from them are added below. */
const CONTINENTS = [0, 1];
const LISTFILE = '.cache/listfile.csv';
/** Final vanilla content patch (1.12). */
const PATCH = 10;

function query<T>(sql: string): T[] {
	const out = execFileSync('sqlite3', ['-json', DB, sql], { maxBuffer: 1 << 30 }).toString();
	return out.trim() ? (JSON.parse(out) as T[]) : [];
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

// Latest template row per entry at or before the final patch.
const latest = (table: string) => `
	select t.* from ${table} t
	join (select entry, max(patch) as patch from ${table} where patch <= ${PATCH} group by entry) m
		on m.entry = t.entry and m.patch = t.patch`;

interface CreatureTemplate {
	entry: number; name: string; subname: string | null; level_min: number; level_max: number;
	type: number; rank: number; npc_flags: number; faction: number; equipment_id: number;
	display_id1: number; display_id2: number; display_id3: number; display_id4: number;
	display_scale1: number; display_scale2: number; display_scale3: number; display_scale4: number;
	speed_walk: number;
}
interface ObjectTemplate { entry: number; name: string; type: number; displayId: number; size: number; data0: number }
interface Spawn {
	guid: number; id: number; x: number; y: number; z: number; o: number;
	r0?: number; r1?: number; r2?: number; r3?: number;
	movement_type?: number; wander_distance?: number;
}

/** creature.movement_type */
const MOVE_RANDOM = 1;
const MOVE_WAYPOINTS = 2;

interface Waypoint { id: number; x: number; y: number; z: number; wait: number }

/** Waypoint paths by key (spawn guid, or template entry), flattened to [x, y, z, wait seconds, ...]. */
function paths(sql: string): Map<number, number[]> {
	const out = new Map<number, number[]>();
	for (const p of query<Waypoint>(sql)) {
		const list = out.get(p.id) ?? [];
		list.push(round(p.x), round(p.y), round(p.z), round(p.wait / 1000, 1));
		out.set(p.id, list);
	}
	return out;
}
const spawnPaths = paths('select id, position_x as x, position_y as y, position_z as z, waittime as wait from creature_movement order by id, point');
const templatePaths = paths('select entry as id, position_x as x, position_y as y, position_z as z, waittime as wait from creature_movement_template where path_id = 0 order by entry, point');

const creatureTemplates = new Map(query<CreatureTemplate>(latest('creature_template')).map((t) => [t.entry, t]));
const objectTemplates = new Map(query<ObjectTemplate>(latest('gameobject_template')).map((t) => [t.entry, t]));
// NPC weapons: the likeliest equipment set per creature_equip_template entry, as item display IDs.
// [main hand, off hand, off hand is a shield]; ranged weapons aren't held, so they're left out.
const weapons = new Map<number, [number, number, number]>();
for (const e of query<{ entry: number; mh: number; oh: number; ohType: number }>(`select e.entry, coalesce(m.display_id, 0) as mh, coalesce(o.display_id, 0) as oh, coalesce(o.inventory_type, 0) as ohType
	from creature_equip_template e
	left join (${latest('item_template')}) m on m.entry = e.item1
	left join (${latest('item_template')}) o on o.entry = e.item2
	where e.patch_min <= ${PATCH} and e.patch_max >= ${PATCH} order by e.probability`)) {
	weapons.set(e.entry, [e.mh, e.oh, e.ohType === 14 ? 1 : 0]);
}

const pageText = new Map(query<{ entry: number; text: string; next_page: number }>('select entry, text, next_page from page_text').map((p) => [p.entry, p]));

mkdirSync('public/spawns', { recursive: true });

// Original (SD) hair textures, character/<race>/hair00_<colour>.blp, by ChrRaces ID and colour index.
// These files have no name hashes in the client, so their IDs come from the community listfile
// (https://github.com/wowdev/wow-listfile), expected at .cache/listfile.csv.
const RACE_FOLDERS: Record<string, number> = { human: 1, orc: 2, dwarf: 3, nightelf: 4, scourge: 5, tauren: 6, gnome: 7, troll: 8, goblin: 9 };
if (existsSync(LISTFILE)) {
	const hair: Record<number, number[]> = {};
	for (const line of readFileSync(LISTFILE, 'utf8').split('\n')) {
		const m = /^(\d+);character\/([a-z]+)\/hair00_(\d\d)\.blp$/.exec(line.trim());
		const race = m && RACE_FOLDERS[m[2]];
		if (!m || !race) continue;
		(hair[race] ??= [])[Number(m[3])] = Number(m[1]);
	}
	writeFileSync('public/spawns/hair.json', JSON.stringify(hair));
	console.log('public/spawns/hair.json', Object.keys(hair).length, 'races');
	// SD skin extra textures (a tauren's horns, tail and mane),
	// character/<race>/<sex>/<race><sex>skin00_<colour>_extra.blp, by ChrRaces ID, sex and colour.
	const extras: Record<number, number[][]> = {};
	for (const line of readFileSync(LISTFILE, 'utf8').split('\n')) {
		const m = /^(\d+);character\/([a-z]+)\/(male|female)\/\2\3skin00_(\d\d)_extra\.blp$/.exec(line.trim());
		const race = m && RACE_FOLDERS[m[2]];
		if (!m || !race) continue;
		((extras[race] ??= [[], []])[m[3] === 'male' ? 0 : 1])[Number(m[4])] = Number(m[1]);
	}
	writeFileSync('public/spawns/skinExtra.json', JSON.stringify(extras));
	console.log('public/spawns/skinExtra.json', Object.keys(extras).length, 'races');
} else {
	console.warn(`${LISTFILE} not found; NPCs will have no hair textures`);
}
// Area triggers that teleport (dungeon entrances and exits, and a few in-world ones): the
// trigger's sphere or box, and where it sends you.
interface Teleport {
	id: number; name: string; map: number; x: number; y: number; z: number; radius: number;
	box_x: number; box_y: number; box_z: number; box_o: number;
	target_map: number; tx: number; ty: number; tz: number; to: number;
}
const teleports = query<Teleport>(`select t.id, t.name, a.map_id as map, a.x, a.y, a.z, a.radius, a.box_x, a.box_y, a.box_z,
	a.box_orientation as box_o, t.target_map, t.target_position_x as tx, t.target_position_y as ty, t.target_position_z as tz,
	t.target_orientation as "to"
	from areatrigger_teleport t
	join (select id, max(patch) as patch from areatrigger_teleport where patch <= ${PATCH} group by id) latest
		on latest.id = t.id and latest.patch = t.patch
	join areatrigger_template a on a.id = t.id
		and a.build = (select max(build) from areatrigger_template b where b.id = t.id)`);
// Dungeons you can walk into from a continent (directly or through another dungeon, like
// Blackwing Lair from Blackrock Spire), and every trigger among those maps.
const MAPS = [...CONTINENTS];
for (let i = 0; i < MAPS.length; i++) {
	for (const t of teleports) if (t.map === MAPS[i] && !MAPS.includes(t.target_map)) MAPS.push(t.target_map);
}
// Maps nothing leads to (battlegrounds) still get their spawns, for going there directly.
for (const { map } of query<{ map: number }>(`select distinct map from creature where patch_min <= ${PATCH}
	union select distinct map from gameobject where patch_min <= ${PATCH}`)) {
	if (!MAPS.includes(map)) MAPS.push(map);
}
const triggers = teleports
	.filter((t) => MAPS.includes(t.map) && MAPS.includes(t.target_map))
	.map((t) => [t.id, t.name, t.map, round(t.x), round(t.y), round(t.z), round(t.radius), round(t.box_x), round(t.box_y), round(t.box_z),
		round(t.box_o, 3), t.target_map, round(t.tx), round(t.ty), round(t.tz), round(t.to, 3)]);
writeFileSync('public/spawns/triggers.json', JSON.stringify({ source: 'VMaNGOS world database (GPL-2.0), patch 1.12', triggers }));
console.log('public/spawns/triggers.json', triggers.length, 'teleports across', MAPS.length, 'maps');

// Meeting stones (game object type 23) outside the dungeons they serve: data0/data1 are the
// level range, data2 the dungeon's area. A dungeon map links to that area, or has its name.
const stones = query<Spawn & { map: number; name: string; minLevel: number; maxLevel: number; dungeon: number | null }>(`
	select g.guid, g.id, g.map as map, g.position_x as x, g.position_y as y, g.position_z as z, g.orientation as o,
		a.name, t.data0 as minLevel, t.data1 as maxLevel,
		(select m.entry from map_template m where m.map_type = 1
			and (m.linked_zone = t.data2 or m.map_name = a.name or 'The ' || m.map_name = a.name)
			order by m.linked_zone = t.data2 desc limit 1) as dungeon
	from gameobject g
	join (${latest('gameobject_template')}) t on t.entry = g.id
	join area_template a on a.entry = t.data2
	where t.type = 23 and g.patch_min <= ${PATCH} and g.patch_max >= ${PATCH}
	order by t.data0, a.name`).filter((s) => s.dungeon !== null);
writeFileSync('public/spawns/stones.json', JSON.stringify({
	source: 'VMaNGOS world database (GPL-2.0), patch 1.12',
	stones: stones.map((s) => [s.guid, s.id, s.name, s.dungeon, s.map, round(s.x), round(s.y), round(s.z), round(s.o, 3), s.minLevel, s.maxLevel]),
}));
console.log('public/spawns/stones.json', stones.length, 'meeting stones');

for (const map of MAPS) {
	const creatures = query<Spawn>(`select guid, id, position_x as x, position_y as y, position_z as z, orientation as o,
		movement_type, wander_distance
		from creature where map = ${map} and patch_min <= ${PATCH} and patch_max >= ${PATCH}
		and guid not in (select guid from game_event_creature where event > 0)`);
	const objects = query<Spawn>(`select guid, id, position_x as x, position_y as y, position_z as z, orientation as o,
		rotation0 as r0, rotation1 as r1, rotation2 as r2, rotation3 as r3
		from gameobject where map = ${map} and patch_min <= ${PATCH} and patch_max >= ${PATCH}
		and guid not in (select guid from game_event_gameobject where event > 0)`);

	// Templates used on this map, as compact arrays (see src/explorer/spawns.ts for the layout).
	const npcTemplates: Record<number, unknown[]> = {};
	for (const s of creatures) {
		const t = creatureTemplates.get(s.id);
		if (!t || npcTemplates[t.entry]) continue;
		const displays = [t.display_id1, t.display_id2, t.display_id3, t.display_id4];
		const scales = [t.display_scale1, t.display_scale2, t.display_scale3, t.display_scale4];
		npcTemplates[t.entry] = [t.name, t.subname ?? '', t.level_min, t.level_max, t.type, t.rank, t.npc_flags,
			displays.filter((d) => d), scales.filter((_, i) => displays[i]).map((v) => round(v, 3)), t.faction,
			weapons.get(t.equipment_id) ?? 0, round(t.speed_walk, 3)];
	}
	const goTemplates: Record<number, unknown[]> = {};
	for (const s of objects) {
		const t = objectTemplates.get(s.id);
		if (!t || goTemplates[t.entry]) continue;
		goTemplates[t.entry] = [t.name, t.type, t.displayId, round(t.size, 3), t.data0];
	}

	// Readable objects (type 9, "text": books, plaques, notices) link to a chain of pages.
	const pages: Record<number, string[]> = {};
	for (const t of Object.entries(goTemplates)) {
		const [, type, , , firstPage] = t[1] as [string, number, number, number, number];
		if (type !== 9 || !firstPage || pages[firstPage]) continue;
		const chain: string[] = [];
		for (let page = firstPage, guard = 0; page && guard < 50; guard++) {
			const row = pageText.get(page);
			if (!row) break;
			chain.push(row.text);
			page = row.next_page;
		}
		pages[firstPage] = chain;
	}

	// Movement per spawn: a wander radius (> 0), a waypoint path (-1: its own, -2: its template's), or 0.
	const movementOf = (s: Spawn): number => {
		if (s.movement_type === MOVE_WAYPOINTS) return spawnPaths.has(s.guid) ? -1 : templatePaths.has(s.id) ? -2 : 0;
		if (s.movement_type === MOVE_RANDOM && (s.wander_distance ?? 0) > 0) return round(s.wander_distance!, 1);
		return 0;
	};
	const walkPaths: Record<number, number[]> = {};
	const walkTemplatePaths: Record<number, number[]> = {};
	for (const s of creatures) {
		const m = movementOf(s);
		if (m === -1) walkPaths[s.guid] = spawnPaths.get(s.guid)!;
		else if (m === -2) walkTemplatePaths[s.id] = templatePaths.get(s.id)!;
	}

	const out = {
		source: 'VMaNGOS world database (GPL-2.0), patch 1.12',
		pages,
		creatures: {
			templates: npcTemplates,
			spawns: creatures.filter((s) => npcTemplates[s.id]).map((s) => [s.guid, s.id, round(s.x), round(s.y), round(s.z), round(s.o, 3), movementOf(s)]),
			paths: walkPaths,
			templatePaths: walkTemplatePaths,
		},
		objects: {
			templates: goTemplates,
			spawns: objects.filter((s) => goTemplates[s.id]).map((s) => [s.guid, s.id, round(s.x), round(s.y), round(s.z), round(s.o, 3),
				round(s.r0!, 4), round(s.r1!, 4), round(s.r2!, 4), round(s.r3!, 4)]),
		},
	};
	const file = `public/spawns/map${map}.json`;
	writeFileSync(file, JSON.stringify(out));
	console.log(file, `${out.creatures.spawns.length} creatures (${Object.keys(npcTemplates).length} kinds),`,
		`${out.objects.spawns.length} objects (${Object.keys(goTemplates).length} kinds)`);
}
