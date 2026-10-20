import { parseAdtRoot, CHUNKS_PER_TILE } from '../formats/adt';
import { ALPHA_SIZE, parseAdtTex } from '../formats/adtTex';
import { chunks } from '../formats/chunks';
import type { LiquidInstance } from '../formats/mh2o';
import type { MapExplorer } from './maps';

/**
 * Copy from world (spec 7.2): reads one source tile into the plain arrays a scene's world base is
 * built from. Everything is returned in the ADT's own terms (placement space, absolute heights,
 * texture FDIDs); the scene model shifts it to scene space on the main thread.
 */

/** MPHD flags that switch alpha maps from 4-bit to 8-bit (as the explorer reads them). */
const MPHD_BIG_ALPHA = 0x4 | 0x80;
/** MCNK flag: 4-bit alpha maps are already 64x64 and need no fix-up. */
const MCNK_DO_NOT_FIX_ALPHA = 0x8000;

const MDDF_FILE_ID = 0x40;
const MODF_FILE_ID = 0x8;
const MODF_HAS_SCALE = 0x4;

export interface CopyChunk {
	/** 145 absolute heights in MCVT order. */
	heights: Float32Array;
	/** 145 x RGBA vertex shading (0x7f neutral), or null for none. */
	shade: Uint8Array | null;
	/** Texture layers by diffuse FDID with their GroundEffectTexture IDs (0 for none); up to 4. */
	layers: { fdid: number; effect: number }[];
	/** 64x64 alpha per layer after the first, layer-major, or null when one layer. */
	alpha: Uint8Array | null;
	/** One byte per cell row; bit n set = cell n is a hole. */
	holes: Uint8Array;
}

/** An MDDF/MODF entry's raw fields, kept as the ADT placement convention stores them. */
export interface CopyPlacement {
	kind: 'm2' | 'wmo';
	/** Unique across the map; objects spanning tiles are listed by each tile. */
	uid: number;
	fdid: number;
	/** Placement space: x east, y up, z south, the map's corner at 0. */
	position: [number, number, number];
	/** Degrees, X/Y/Z as stored. */
	rotation: [number, number, number];
	scale: number;
	doodadSet: number;
	nameSet: number;
}

export interface CopyTile {
	x: number;
	y: number;
	/** False where the map has no tile there: the scene shows void (spec 7.2). */
	exists: boolean;
	/** 256 chunks, row-major (y * 16 + x), or null when the tile doesn't exist. */
	chunks: CopyChunk[] | null;
	/** The tile's MH2O liquids, as the client stores them (non-flat surfaces included). */
	liquids: LiquidInstance[];
	placements: CopyPlacement[];
}

/** A map the picker can copy from (spec 7.2): it has a WDT with at least one ADT tile. */
export interface CopyMap {
	id: number;
	name: string;
	directory: string;
	wdt: number;
	tileCount: number;
}

/** Reads M2 (MDDF) and WMO (MODF) placement fields raw, unlike parsePlacements' matrices. */
export function parsePlacementFields(bytes: Uint8Array): CopyPlacement[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: CopyPlacement[] = [];
	const vec = (o: number): [number, number, number] => [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
	for (const c of chunks(bytes)) {
		if (c.id === 'MDDF') {
			for (let o = c.offset; o + 36 <= c.offset + c.size; o += 36) {
				if (!(view.getUint16(o + 34, true) & MDDF_FILE_ID)) continue;
				out.push({
					kind: 'm2',
					fdid: view.getUint32(o, true),
					uid: view.getUint32(o + 4, true),
					position: vec(o + 8),
					rotation: vec(o + 20),
					scale: view.getUint16(o + 32, true) / 1024 || 1,
					doodadSet: 0,
					nameSet: 0,
				});
			}
		} else if (c.id === 'MODF') {
			for (let o = c.offset; o + 64 <= c.offset + c.size; o += 64) {
				const flags = view.getUint16(o + 56, true);
				if (!(flags & MODF_FILE_ID)) continue;
				out.push({
					kind: 'wmo',
					fdid: view.getUint32(o, true),
					uid: view.getUint32(o + 4, true),
					position: vec(o + 8),
					rotation: vec(o + 20),
					scale: flags & MODF_HAS_SCALE ? view.getUint16(o + 62, true) / 1024 || 1 : 1,
					doodadSet: view.getUint16(o + 58, true),
					nameSet: view.getUint16(o + 60, true),
				});
			}
		}
	}
	return out;
}

/**
 * One source tile's terrain, water and placements for copying (spec 6.5 loading). A tile the map
 * doesn't have comes back exists: false (void in the scene); a tile whose root ADT can't be read
 * throws, naming the tile, so a scene missing its source fails loudly (spec 6.5).
 */
export async function loadCopyTile(maps: MapExplorer, wdtFdid: number, x: number, y: number): Promise<CopyTile> {
	const wdt = await maps.wdt(wdtFdid);
	const tile = wdt.tiles[y * 64 + x];
	if (!tile) return { x, y, exists: false, chunks: null, liquids: [], placements: [] };

	if (!tile.files.root || maps.storage.status(tile.files.root) !== 'ok') throw new Error(`Tile ${x}_${y}: its terrain file isn't in your client`);
	let rootBytes: Uint8Array;
	try {
		rootBytes = await maps.storage.readFile(tile.files.root);
	} catch (e) {
		throw new Error(`Tile ${x}_${y}: ${e instanceof Error ? e.message : e}`);
	}
	const root = parseAdtRoot(rootBytes);
	const [texBytes, objBytes] = await Promise.all([
		tile.files.tex0 ? maps.storage.readFile(tile.files.tex0).catch(() => null) : null,
		tile.files.obj0 ? maps.storage.readFile(tile.files.obj0).catch(() => null) : null,
	]);
	const tex = texBytes ? parseAdtTex(texBytes, (wdt.flags & MPHD_BIG_ALPHA) !== 0, (i) => !(root.chunks[i]?.flags & MCNK_DO_NOT_FIX_ALPHA)) : null;

	const copyChunks: (CopyChunk | null)[] = new Array(CHUNKS_PER_TILE * CHUNKS_PER_TILE).fill(null);
	root.chunks.forEach((chunk, order) => {
		// Up to 4 layers as the format allows; a tile without a readable _tex0 keeps no layers, and
		// the scene model paints its fallback texture instead.
		const texChunk = tex?.chunks[order];
		const layers = (texChunk?.layers ?? []).slice(0, 4).map((l) => ({ fdid: tex!.diffuse[l.texture] ?? 0, effect: l.effect }));
		let alpha: Uint8Array | null = null;
		if (texChunk && layers.length > 1) {
			alpha = new Uint8Array((layers.length - 1) * ALPHA_SIZE * ALPHA_SIZE);
			for (let l = 1; l < layers.length; l++) alpha.set(texChunk.alpha[l - 1], (l - 1) * ALPHA_SIZE * ALPHA_SIZE);
		}
		copyChunks[chunk.indexY * CHUNKS_PER_TILE + chunk.indexX] = {
			heights: chunk.heights,
			shade: chunk.shade ?? null,
			layers,
			alpha,
			holes: chunk.holes,
		};
	});
	// A root with missing chunks (shouldn't happen) gets flat stand-ins so the grid stays whole.
	const chunksOut = copyChunks.map((c) => c ?? { heights: new Float32Array(145), shade: null, layers: [], alpha: null, holes: new Uint8Array(8) });

	return {
		x,
		y,
		exists: true,
		chunks: chunksOut,
		liquids: root.liquids,
		placements: objBytes ? parsePlacementFields(objBytes) : [],
	};
}
