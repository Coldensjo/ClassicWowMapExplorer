import { chunks } from './chunks';

/** Per-tile file data IDs listed in the WDT's MAID chunk, in on-disk order. */
export const TILE_FILE_KINDS = ['root', 'obj0', 'obj1', 'tex0', 'lod', 'mapTexture', 'mapTextureN', 'minimap'] as const;
export type TileFileKind = (typeof TILE_FILE_KINDS)[number];

export const MAP_SIZE = 64;

export interface WdtTile {
	x: number;
	y: number;
	flags: number;
	files: Record<TileFileKind, number>;
	/**
	 * WoW Forever's river flow map (MAI2, 0 for none): 256x256, the way the water flows in red
	 * (east is 128 - R) and green (south is G - 128), at 128 where it's still.
	 */
	flowMap: number;
}

/** The one building a WMO-only map (most dungeons) consists of, placed by the WDT's MODF. */
export interface WdtGlobalWmo {
	fdid: number;
	/** Placement space, like an ADT's MODF, but relative to the map's centre. */
	position: [number, number, number];
	/** Degrees. */
	rotation: [number, number, number];
	/** Bounds, relative to the map's centre like position. */
	min: [number, number, number];
	max: [number, number, number];
	doodadSet: number;
	nameSet: number;
	scale: number;
}

export interface Wdt {
	flags: number;
	/** Indexed by y * 64 + x; null where the map has no tile. */
	tiles: (WdtTile | null)[];
	tileCount: number;
	globalWmo: WdtGlobalWmo | null;
}

export function parseWdt(bytes: Uint8Array): Wdt {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let flags = 0;
	let main: number | null = null;
	let maid: number | null = null;
	let mai2: number | null = null;
	let globalWmo: WdtGlobalWmo | null = null;
	for (const c of chunks(bytes)) {
		if (c.id === 'MPHD') flags = view.getUint32(c.offset, true);
		else if (c.id === 'MAIN') main = c.offset;
		else if (c.id === 'MAID') maid = c.offset;
		else if (c.id === 'MAI2' && c.size >= MAP_SIZE * MAP_SIZE * 32) mai2 = c.offset;
		else if (c.id === 'MODF' && c.size >= 64) {
			const o = c.offset;
			const f = (k: number) => view.getFloat32(o + k, true);
			globalWmo = {
				fdid: view.getUint32(o, true),
				position: [f(8), f(12), f(16)],
				rotation: [f(20), f(24), f(28)],
				min: [f(32), f(36), f(40)],
				max: [f(44), f(48), f(52)],
				doodadSet: view.getUint16(o + 58, true),
				nameSet: view.getUint16(o + 60, true),
				scale: view.getUint16(o + 62, true) / 1024 || 1,
			};
		}
	}
	if (main === null) throw new Error('WDT has no MAIN chunk');
	// WMO-only maps have no tiles, and so no tile file list.
	if (maid === null && !globalWmo) throw new Error('WDT has no MAID chunk (pre-8.1 maps are not supported)');

	const tiles: (WdtTile | null)[] = new Array(MAP_SIZE * MAP_SIZE).fill(null);
	let tileCount = 0;
	for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
		const tileFlags = view.getUint32(main + i * 8, true);
		if (!(tileFlags & 1) || maid === null) continue;
		const files = {} as Record<TileFileKind, number>;
		TILE_FILE_KINDS.forEach((kind, k) => {
			files[kind] = view.getUint32(maid + i * 32 + k * 4, true);
		});
		const flowMap = mai2 === null ? 0 : view.getUint32(mai2 + i * 32, true);
		tiles[i] = { x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE), flags: tileFlags, files, flowMap };
		tileCount++;
	}
	return { flags, tiles, tileCount, globalWmo };
}
