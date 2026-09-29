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
	SoundAmbience: 1310628,
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

/** How a liquid looks from inside it (LiquidType.db2). */
export interface LiquidLook {
	/** The deep colour the view fades to, 0xRRGGBB; 0 when the type has none (older liquids). */
	color: number;
	/** Yards below the surface at which darkening is complete, and how much it darkens fog, ambient and sun light (0-1). */
	darkenDepth: number;
	fogDarken: number;
	ambientDarken: number;
	sunDarken: number;
}

export interface LiquidLooks {
	types: Record<number, LiquidLook>;
	/** The type of the open sea (drawn as one plane, so it has no type of its own). */
	ocean: number;
}

/** LiquidType fields. */
const LIQUID_DARKEN_DEPTH = 6;
const LIQUID_FOG_DARKEN = 7;
const LIQUID_AMBIENT_DARKEN = 8;
const LIQUID_SUN_DARKEN = 9;
const LIQUID_COLORS = 17;

/** Underwater looks of every liquid type. */
export async function liquidLooks(storage: CascStorage): Promise<LiquidLooks> {
	const table = await loadTable(storage, DB2_FILES.LiquidType);
	const types: Record<number, LiquidLook> = {};
	let ocean = 2;
	for (const id of table.ids()) {
		const name = table.getString(id, 0) ?? '';
		if (name === 'PBRWater - Generic - Ocean') ocean = id;
		types[id] = {
			// Three colours, lightest to deepest; the view fades to the deepest.
			color: (table.getInt(id, LIQUID_COLORS, 2) ?? 0) & 0xffffff,
			darkenDepth: table.getFloat(id, LIQUID_DARKEN_DEPTH) ?? 0,
			fogDarken: table.getFloat(id, LIQUID_FOG_DARKEN) ?? 0,
			ambientDarken: table.getFloat(id, LIQUID_AMBIENT_DARKEN) ?? 0,
			sunDarken: table.getFloat(id, LIQUID_SUN_DARKEN) ?? 0,
		};
	}
	return { types, ocean };
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
