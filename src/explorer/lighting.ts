import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { DB2_FILES, loadTable } from './clientDb';

/** Order of the colours in a LightKey (LightData fields 3-15). */
export const LIGHT_COLORS = [
	'direct', 'ambient', 'skyTop', 'skyMiddle', 'skyBand1', 'skyBand2', 'skySmog', 'skyFog',
	'sun', 'cloudSun', 'cloudEmissive', 'cloudLayer1', 'cloudLayer2',
	// Water, looking into it: what the view fades to near and far, in the sea and in rivers and lakes.
	'oceanClose', 'oceanFar', 'riverClose', 'riverFar',
] as const;
export type LightColor = (typeof LIGHT_COLORS)[number];

export interface LightKey {
	/** Half-minutes since midnight, 0-2879. */
	time: number;
	/** 0xRRGGBB, in LIGHT_COLORS order. */
	colors: number[];
	/** Yards; 0 = not set in this keyframe. */
	fogEnd: number;
	fogScaler: number;
	/** Colour grading lookup table (a 1024x32 BLP, 32 slices of 32x32), 0 for none. */
	grading: number;
	/**
	 * How thick the height fog is, 1 normal. A guess: one of Forever's unnamed LightData fields
	 * (1.60.1 field 51), which is highest in Duskwood (3) and Ashenvale (2) and lowest in Dun Morogh (0.4).
	 */
	fogDensity: number;
}

/** A region of a map as a polygon of points (x north, y west, yards), with its box. */
export interface Polygon {
	points: [number, number][];
	min: [number, number];
	max: [number, number];
}

/** A Light.db2 zone: global when outer is 0, otherwise a sphere in world coordinates, or, with a polygon, a region of the map. */
export interface LightZone {
	mapId: number;
	x: number;
	y: number;
	z: number;
	inner: number;
	outer: number;
	/** LightParams ID for clear weather (the first of the zone's parameter sets). */
	params: number;
	/** Where a zone light (ZoneLight) applies: all of it, at any height, to the light of its Light. Then x, y, z and the radii mean nothing. */
	polygon?: Polygon;
}

/** Whether a point is inside a polygon. */
export function insidePolygon(polygon: Polygon, x: number, y: number): boolean {
	if (x < polygon.min[0] || x > polygon.max[0] || y < polygon.min[1] || y > polygon.max[1]) return false;
	const p = polygon.points;
	let inside = false;
	for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
		if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
	}
	return inside;
}

export interface LightingData {
	zones: LightZone[];
	/** Keyframes per LightParams ID, sorted by time. */
	keys: Record<number, LightKey[]>;
}

export interface AreaInfo {
	id: number;
	name: string;
	parent: number;
}

const f32 = new DataView(new ArrayBuffer(4));
const asFloat = (raw: number) => {
	f32.setUint32(0, raw);
	return f32.getFloat32(0);
};

type Rows = Pick<Db2, 'ids' | 'getInt' | 'getFloat' | 'getString' | 'getParent'>;

// Fields of ZoneLight and ZoneLightPoint as Forever numbers them (the zone of a point is its parent), and of Light.
const ZONE_MAP = 1;
const ZONE_LIGHT = 2;
const POINT_POS = 0;
const POINT_ORDER = 1;
const LIGHT_PARAMS = 4;

/**
 * The zone lights (ZoneLight, ZoneLightPoint) of the given maps: regions of a map drawn as polygons that
 * have the light of a Light of their own, which the later clients use in place of the spheres of Light
 * (those keep their place but have a small reach).
 */
export function zoneLightZones(zoneLights: Rows, zonePoints: Rows, lights: Rows, mapIds: number[]): LightZone[] {
	const polygons = new Map<number, { order: number; point: [number, number] }[]>();
	for (const id of zonePoints.ids()) {
		const zone = zonePoints.getParent(id);
		if (zone === null) continue;
		const list = polygons.get(zone) ?? [];
		list.push({ order: zonePoints.getInt(id, POINT_ORDER) ?? 0, point: [zonePoints.getFloat(id, POINT_POS, 0)!, zonePoints.getFloat(id, POINT_POS, 1)!] });
		polygons.set(zone, list);
	}
	const zones: LightZone[] = [];
	for (const id of zoneLights.ids()) {
		const mapId = zoneLights.getInt(id, ZONE_MAP)!;
		const params = lights.getInt(zoneLights.getInt(id, ZONE_LIGHT) ?? 0, LIGHT_PARAMS, 0);
		const points = (polygons.get(id) ?? []).sort((a, b) => a.order - b.order).map((p) => p.point);
		if (!mapIds.includes(mapId) || !params || points.length < 3) continue;
		const xs = points.map((p) => p[0]);
		const ys = points.map((p) => p[1]);
		zones.push({ mapId, x: 0, y: 0, z: 0, inner: 0, outer: 0, params, polygon: { points, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] } });
	}
	return zones;
}

/** Light zones and their day-cycle keyframes for the given maps (Map.db2 IDs). */
export async function loadLighting(storage: CascStorage, mapIds: number[]): Promise<LightingData> {
	const [lights, data] = await Promise.all([loadTable(storage, DB2_FILES.Light), loadTable(storage, DB2_FILES.LightData)]);
	const zones: LightZone[] = [];
	for (const id of lights.ids()) {
		const mapId = lights.getInt(id, 3)!;
		if (!mapIds.includes(mapId)) continue;
		const params = lights.getInt(id, 4, 0)!;
		if (!params) continue;
		zones.push({
			mapId,
			x: lights.getFloat(id, 0, 0)!,
			y: lights.getFloat(id, 0, 1)!,
			z: lights.getFloat(id, 0, 2)!,
			inner: lights.getFloat(id, 1)!,
			outer: lights.getFloat(id, 2)!,
			params,
		});
	}

	// Clients that have zone lights (not all do: Anniversary's table is empty) light a zone by its polygon.
	try {
		const [zoneLights, zonePoints] = await Promise.all([loadTable(storage, DB2_FILES.ZoneLight), loadTable(storage, DB2_FILES.ZoneLightPoint)]);
		zones.push(...zoneLightZones(zoneLights, zonePoints, lights, mapIds));
	} catch {
		// A client without them.
	}

	const wanted = new Set(zones.map((z) => z.params));
	const keys: Record<number, LightKey[]> = {};
	for (const id of data.ids()) {
		const param = data.getInt(id, 1)!;
		if (!wanted.has(param)) continue;
		(keys[param] ??= []).push({
			// The high 16 bits hold something else; the time is the low half.
			time: data.getInt(id, 2)! & 0xffff,
			colors: LIGHT_COLORS.map((_, i) => data.getInt(id, 3 + i)!),
			fogEnd: asFloat(data.getInt(id, 21)!),
			fogScaler: asFloat(data.getInt(id, 22)!),
			grading: data.getInt(id, 32) ?? 0,
			fogDensity: data.fieldCount > 51 ? asFloat(data.getInt(id, 51) ?? 0) || 1 : 1,
		});
	}
	for (const list of Object.values(keys)) list.sort((a, b) => a.time - b.time);
	return { zones, keys };
}

/** Area names and parents (AreaTable.db2), for zone and subzone display. */
export async function loadAreas(storage: CascStorage): Promise<AreaInfo[]> {
	const table = await loadTable(storage, DB2_FILES.AreaTable);
	return table.ids().map((id) => ({ id, name: table.getString(id, 1) ?? '', parent: table.getInt(id, 3) ?? 0 }));
}
