import { chunks } from './chunks';
import { MAP_SIZE } from './wdt';

/** Low-resolution heights for one tile: 17x17 outer and 16x16 inner samples. */
export interface WdlTile {
	x: number;
	y: number;
	outer: Float32Array;
	inner: Float32Array;
}

export const WDL_CELLS = 16;

/** Parses the map-wide low-detail heightmap the client uses for distant terrain. */
export function parseWdl(bytes: Uint8Array): WdlTile[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let maof: number | null = null;
	for (const c of chunks(bytes)) {
		if (c.id === 'MAOF') {
			maof = c.offset;
			break;
		}
	}
	if (maof === null) throw new Error('WDL has no MAOF chunk');

	const tiles: WdlTile[] = [];
	const outerCount = (WDL_CELLS + 1) ** 2;
	const innerCount = WDL_CELLS ** 2;
	for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
		const offset = view.getUint32(maof + i * 4, true);
		if (offset === 0) continue;
		// offset points at the MARE chunk header.
		const data = offset + 8;
		const outer = new Float32Array(outerCount);
		const inner = new Float32Array(innerCount);
		for (let k = 0; k < outerCount; k++) outer[k] = view.getInt16(data + k * 2, true);
		for (let k = 0; k < innerCount; k++) inner[k] = view.getInt16(data + (outerCount + k) * 2, true);
		tiles.push({ x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE), outer, inner });
	}
	return tiles;
}
