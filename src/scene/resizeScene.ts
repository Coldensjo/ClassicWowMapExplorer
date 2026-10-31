import { CHUNK_HEIGHTS, CHUNKS_PER_TILE, TILE_SIZE } from '../formats/adt';
import type { SceneChunk, SceneModel, SceneTile } from './sceneModel';
import { MAX_BLANK_TILES } from './types';

/** Outer lattice vertices per chunk side, minus one (the cells across a chunk). */
const INNER = 8;
/** Height index of an outer vertex (rows of 9 and 8 interleaved), as sceneModel.ts lays them out. */
const outerIndex = (row: number, col: number) => row * 17 + col;

export interface GrowRequest {
	/** The new size, 1..MAX_BLANK_TILES each way and no smaller than the scene. */
	tilesX: number;
	tilesY: number;
	/** Where the old top-left tile sits in the new grid (tiles added to the west or north shift it). */
	offsetX: number;
	offsetY: number;
}

/**
 * Grows a blank scene in place (Scene settings, specs/scene-dialogs.md §3): the old tiles keep
 * their content and move to the offset, new flat tiles at height 0 fill the rest with the base
 * layer the scene already paints, and every placed object, NPC and the spawn shift with the
 * tiles. Where a new tile meets an old one, the shared edge vertices take the old heights, so
 * no seam opens (spec 7.4); the first cell of the new tile slopes down from them.
 *
 * The model's tile indices change, so the caller rebuilds whatever was keyed on them (the
 * editor reopens the scene). Copied scenes can't grow: their size is the copied area's.
 */
export function growBlankScene(model: SceneModel, request: GrowRequest): void {
	const { tilesX, tilesY, offsetX, offsetY } = request;
	const oldX = model.tilesX;
	const oldY = model.tilesY;
	if (model.meta.base) throw new Error('A scene copied from the world keeps the size of the copied area');
	if (!Number.isInteger(tilesX) || !Number.isInteger(tilesY) || tilesX < 1 || tilesY < 1 || tilesX > MAX_BLANK_TILES || tilesY > MAX_BLANK_TILES) {
		throw new Error(`A blank scene is 1x1 to ${MAX_BLANK_TILES}x${MAX_BLANK_TILES} tiles, not ${tilesX}x${tilesY}`);
	}
	if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY) || offsetX < 0 || offsetY < 0 || offsetX + oldX > tilesX || offsetY + oldY > tilesY) {
		throw new Error(`The scene's ${oldX}x${oldY} tiles don't fit a ${tilesX}x${tilesY} grid at ${offsetX}, ${offsetY}`);
	}
	if (tilesX === oldX && tilesY === oldY) return;

	// New tiles paint the base layer the scene's first chunk does (its texture and clutter).
	const base = model.tiles[0].chunks[0].layers[0];
	const blankTile = (x: number, y: number): SceneTile => {
		const chunks: SceneChunk[] = [];
		for (let i = 0; i < CHUNKS_PER_TILE * CHUNKS_PER_TILE; i++) {
			chunks.push({
				heights: new Float32Array(CHUNK_HEIGHTS),
				vertexShade: null,
				layers: [{ ...base }],
				alpha: null,
				holes: new Uint8Array(8),
				water: null,
			});
		}
		return { x, y, chunks };
	};

	const oldTiles = model.tiles.slice();
	const tiles: SceneTile[] = [];
	for (let y = 0; y < tilesY; y++) {
		for (let x = 0; x < tilesX; x++) {
			const ox = x - offsetX;
			const oy = y - offsetY;
			if (ox >= 0 && oy >= 0 && ox < oldX && oy < oldY) {
				const tile = oldTiles[oy * oldX + ox];
				tile.x = x;
				tile.y = y;
				tiles.push(tile);
			} else {
				tiles.push(blankTile(x, y));
			}
		}
	}
	model.tiles.splice(0, model.tiles.length, ...tiles);
	model.meta.size = { tilesX, tilesY };

	// Everything placed in scene space moves with its tile.
	const dx = offsetX * TILE_SIZE;
	const dz = offsetY * TILE_SIZE;
	if (dx || dz) {
		for (const object of model.objects) {
			object.position[0] += dx;
			object.position[2] += dz;
		}
		for (const npc of model.npcs) {
			npc.position[0] += dx;
			npc.position[2] += dz;
		}
		model.meta.spawn.position[0] += dx;
		model.meta.spawn.position[2] += dz;
	}

	// The old block's outline in outer lattice units, and the old chunk owning each vertex on it.
	const perTile = CHUNKS_PER_TILE * INNER;
	const left = offsetX * perTile;
	const right = (offsetX + oldX) * perTile;
	const top = offsetY * perTile;
	const bottom = (offsetY + oldY) * perTile;
	const oldOuter = (gx: number, gz: number): number => {
		const ccx = Math.max(offsetX * CHUNKS_PER_TILE, Math.min((offsetX + oldX) * CHUNKS_PER_TILE - 1, Math.floor(gx / INNER)));
		const ccy = Math.max(offsetY * CHUNKS_PER_TILE, Math.min((offsetY + oldY) * CHUNKS_PER_TILE - 1, Math.floor(gz / INNER)));
		const tile = tiles[Math.floor(ccy / CHUNKS_PER_TILE) * tilesX + Math.floor(ccx / CHUNKS_PER_TILE)];
		const chunk = tile.chunks[(ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE)];
		return chunk.heights[outerIndex(gz - ccy * INNER, gx - ccx * INNER)];
	};
	const edges: [number, number][] = [];
	if (offsetY > 0) for (let gx = left; gx <= right; gx++) edges.push([gx, top]);
	if (offsetY + oldY < tilesY) for (let gx = left; gx <= right; gx++) edges.push([gx, bottom]);
	if (offsetX > 0) for (let gz = top; gz <= bottom; gz++) edges.push([left, gz]);
	if (offsetX + oldX < tilesX) for (let gz = top; gz <= bottom; gz++) edges.push([right, gz]);
	for (const [gx, gz] of edges) model.setOuterHeight(gx, gz, oldOuter(gx, gz));

	// The caller rebuilds from scratch, so the per-index dirty bookkeeping is stale.
	model.dirtyTiles.clear();
	model.dirtyHeights.clear();
	model.dirtyAlpha.clear();
	model.dirtyWater.clear();
	model.meta.modified = new Date().toISOString();
}
