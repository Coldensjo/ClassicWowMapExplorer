import type { CascStorage } from '../casc/storage';
import { Db2 } from '../formats/db2';
import type { LiquidKind } from '../formats/mh2o';

/** File IDs of client database tables (DBFilesClient/*.db2); they're unnamed in the root. */
export const DB2_FILES = {
	AreaTable: 1353545,
	Light: 1375579,
	LightData: 1375580,
	LightParams: 1334669,
	LiquidType: 1371380,
	Map: 1349477,
	SoundKitEntry: 1237435,
	WMOAreaTable: 1355528,
	ZoneIntroMusicTable: 1310251,
	ZoneMusic: 1310254,
} as const;

const tables = new WeakMap<CascStorage, Map<number, Promise<Db2>>>();

/** Loads a table once per storage. Encrypted sections are skipped rather than failing. */
export function loadTable(storage: CascStorage, fdid: number): Promise<Db2> {
	let cache = tables.get(storage);
	if (!cache) {
		cache = new Map();
		tables.set(storage, cache);
	}
	let table = cache.get(fdid);
	if (!table) {
		table = storage.readFileWithStatus(fdid, true).then(({ data }) => new Db2(data));
		cache.set(fdid, table);
	}
	return table;
}

/** Classifies liquid types by name ("Ocean", "Magma", "PBRWater - Generic - Lake", ...). */
export async function liquidKinds(storage: CascStorage): Promise<(type: number) => LiquidKind> {
	let table: Db2 | null = null;
	try {
		table = await loadTable(storage, DB2_FILES.LiquidType);
	} catch (e) {
		console.warn('LiquidType.db2 unavailable, treating all liquids as water', e);
	}
	const cache = new Map<number, LiquidKind>();
	return (type) => {
		let kind = cache.get(type);
		if (!kind) {
			const name = (table?.getString(type, 0) ?? '').toLowerCase();
			kind = /ocean|sea/.test(name) ? 'ocean' : /magma|lava/.test(name) ? 'magma' : /slime/.test(name) ? 'slime' : 'water';
			cache.set(type, kind);
		}
		return kind;
	};
}
