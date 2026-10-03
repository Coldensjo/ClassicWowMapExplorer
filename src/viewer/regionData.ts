import * as THREE from 'three';
import { CHUNK_SIZE, TILE_SIZE } from '../formats/adt';
import type { ContinentPlacement } from './terrain';

/** What's known about an area (subzone or zone), from public/spawns/regions.json (tools/buildRegions.ts). */
export interface AreaInfo {
	id: number;
	name: string;
	map: number;
	/** The zone it's in (itself for a zone). */
	zone: number;
	/** Whose territory it is; contested where neither side's. */
	side: 'alliance' | 'horde' | 'contested';
	/** area_template.flags: 0x80 free-for-all arena, 0x100 capital. */
	flags: number;
	/** Exploration level, and the XP for discovering the area at that level (0: none). */
	level: number;
	xp: number;
	/** Typical levels of the creatures in it. */
	mobs: [number, number] | null;
	/** The fishing skill it's rated at. */
	fishing: number | null;
	/** Where its name goes (WoW x, y), and how many map chunks it covers. */
	x: number;
	y: number;
	chunks: number;
}

export interface GraveyardEntry {
	id: number;
	name: string;
	map: number;
	x: number;
	y: number;
	z: number;
}

/** An inn or city where resting builds up: a sphere (radius) or a box (length, width, height, orientation). */
export interface TavernEntry {
	id: number;
	name: string;
	place: string;
	map: number;
	x: number;
	y: number;
	z: number;
	radius: number;
	box: [number, number, number, number] | null;
}

interface RegionFile {
	areas: Record<number, Omit<AreaInfo, 'id'>>;
	/** Map ID -> its area per map chunk (64 * 16 a side), run-length coded: [area, count, ...]. */
	maps: Record<number, number[]>;
	graveyards: GraveyardEntry[];
	/** Zone -> [graveyard ID, faction (0 any, 469 Alliance, 67 Horde)][]. */
	graveyardZones: Record<number, [number, number][]>;
	taverns: TavernEntry[];
	/** Zone -> chances (%) of rain, snow and storm for spring, summer, fall and winter, in that order. */
	weather: Record<number, number[]>;
}

/** Map chunks across a continent. */
export const GRID = 64 * 16;
export const MAP_ORIGIN = 32 * TILE_SIZE;

/** WoW coordinates (x north, y west, z up) on a map -> where that map sits in the world. */
export function worldFromWow(placement: ContinentPlacement, x: number, y: number, z: number): THREE.Vector3 {
	return new THREE.Vector3(MAP_ORIGIN - y + placement.offsetX * TILE_SIZE, z, MAP_ORIGIN - x + placement.offsetY * TILE_SIZE);
}

/** The continents' areas per map chunk and what's known about each, shared by the overlays, rested areas and weather. */
export class RegionData {
	readonly areas = new Map<number, AreaInfo>();
	/** Map ID -> area ID per chunk (row by world z, column by world x). */
	readonly grids = new Map<number, Uint32Array>();

	private constructor(readonly file: RegionFile) {
		for (const [id, a] of Object.entries(file.areas)) this.areas.set(Number(id), { id: Number(id), ...a });
		for (const [map, runs] of Object.entries(file.maps)) {
			const grid = new Uint32Array(GRID * GRID);
			for (let r = 0, at = 0; r < runs.length; r += 2) {
				grid.fill(runs[r], at, at + runs[r + 1]);
				at += runs[r + 1];
			}
			this.grids.set(Number(map), grid);
		}
	}

	static async load(): Promise<RegionData | null> {
		try {
			const response = await fetch('spawns/regions.json');
			return response.ok ? new RegionData(await response.json()) : null;
		} catch (e) {
			console.warn('Region data unavailable:', e);
			return null;
		}
	}

	get graveyards(): GraveyardEntry[] {
		return this.file.graveyards;
	}

	get taverns(): TavernEntry[] {
		return this.file.taverns;
	}

	graveyardLinks(zone: number): [number, number][] {
		return this.file.graveyardZones[zone] ?? [];
	}

	/** A zone's weather chances (see RegionFile.weather), if it has any. */
	weather(zone: number): number[] | null {
		return this.file.weather[zone] ?? null;
	}

	/** The area at a point in WoW coordinates on a continent. */
	areaAtWow(mapId: number, x: number, y: number): AreaInfo | null {
		const grid = this.grids.get(mapId);
		if (!grid) return null;
		const col = Math.floor((MAP_ORIGIN - y) / CHUNK_SIZE);
		const row = Math.floor((MAP_ORIGIN - x) / CHUNK_SIZE);
		if (col < 0 || row < 0 || col >= GRID || row >= GRID) return null;
		return this.areas.get(grid[row * GRID + col]) ?? null;
	}

	/** The area at a world position on a continent, if it's on its map. */
	areaAt(placement: ContinentPlacement, x: number, z: number): AreaInfo | null {
		const grid = this.grids.get(placement.mapId);
		if (!grid || placement.instance) return null;
		const cx = Math.floor((x - placement.offsetX * TILE_SIZE) / CHUNK_SIZE);
		const cz = Math.floor((z - placement.offsetY * TILE_SIZE) / CHUNK_SIZE);
		if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) return null;
		return this.areas.get(grid[cz * GRID + cx]) ?? null;
	}
}
