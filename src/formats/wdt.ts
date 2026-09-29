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
}

export interface Wdt {
	flags: number;
	/** Indexed by y * 64 + x; null where the map has no tile. */
	tiles: (WdtTile | null)[];
	tileCount: number;
}

export function parseWdt(bytes: Uint8Array): Wdt {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let flags = 0;
	let main: number | null = null;
	let maid: number | null = null;
	for (const c of chunks(bytes)) {
		if (c.id === 'MPHD') flags = view.getUint32(c.offset, true);
		else if (c.id === 'MAIN') main = c.offset;
		else if (c.id === 'MAID') maid = c.offset;
	}
	if (main === null) throw new Error('WDT has no MAIN chunk');
	if (maid === null) throw new Error('WDT has no MAID chunk (pre-8.1 maps are not supported)');

	const tiles: (WdtTile | null)[] = new Array(MAP_SIZE * MAP_SIZE).fill(null);
	let tileCount = 0;
	for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
		const tileFlags = view.getUint32(main + i * 8, true);
		if (!(tileFlags & 1)) continue;
		const files = {} as Record<TileFileKind, number>;
		TILE_FILE_KINDS.forEach((kind, k) => {
			files[kind] = view.getUint32(maid + i * 32 + k * 4, true);
		});
		tiles[i] = { x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE), flags: tileFlags, files };
		tileCount++;
	}
	return { flags, tiles, tileCount };
}
