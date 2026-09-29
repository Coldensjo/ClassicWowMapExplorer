// Builds public/spawns/map<id>.json from the VMaNGOS world database (vanilla 1.12, GPL):
// creature and game object spawns with the template fields the viewer shows. Spawns that only
// appear during world events (Hallow's End, Winter Veil, ...) are left out.
// Usage: npm run spawns -- [path/to/mangos.sqlite]
// Get the database from https://github.com/vmangos/core/releases/tag/db_latest (db-sqlite-*.zip).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const DB = process.argv[2] ?? '.cache/vmangos/sqlite-dump/mangos.sqlite';
const MAPS = [0, 1];
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
	type: number; rank: number; npc_flags: number; faction: number;
	display_id1: number; display_id2: number; display_id3: number; display_id4: number;
	display_scale1: number; display_scale2: number; display_scale3: number; display_scale4: number;
}
interface ObjectTemplate { entry: number; name: string; type: number; displayId: number; size: number; data0: number }
interface Spawn { guid: number; id: number; x: number; y: number; z: number; o: number; r0?: number; r1?: number; r2?: number; r3?: number }

const creatureTemplates = new Map(query<CreatureTemplate>(latest('creature_template')).map((t) => [t.entry, t]));
const objectTemplates = new Map(query<ObjectTemplate>(latest('gameobject_template')).map((t) => [t.entry, t]));
const pageText = new Map(query<{ entry: number; text: string; next_page: number }>('select entry, text, next_page from page_text').map((p) => [p.entry, p]));

mkdirSync('public/spawns', { recursive: true });
for (const map of MAPS) {
	const creatures = query<Spawn>(`select guid, id, position_x as x, position_y as y, position_z as z, orientation as o
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
			displays.filter((d) => d), scales.filter((_, i) => displays[i]).map((v) => round(v, 3)), t.faction];
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

	const out = {
		source: 'VMaNGOS world database (GPL-2.0), patch 1.12',
		pages,
		creatures: {
			templates: npcTemplates,
			spawns: creatures.filter((s) => npcTemplates[s.id]).map((s) => [s.guid, s.id, round(s.x), round(s.y), round(s.z), round(s.o, 3)]),
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
