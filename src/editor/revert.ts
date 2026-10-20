import { CHUNK_SIZE, CHUNKS_PER_TILE } from '../formats/adt';
import type { SceneChunk, SceneModel, SceneWater } from '../scene/sceneModel';
import type { ChunkLayer } from '../scene/types';
import type { Command } from './commands';

/**
 * Revert to base (spec 7.11), for copied scenes: a brush that puts the chunks it passes over back
 * to their source state, per channel, as one undoable command. Heights go through the lattice
 * setters, so a reverted chunk's edges also pull its edited neighbours' shared vertices back to
 * the base and no seam opens.
 */

export type RevertChannel = 'heights' | 'vertexShade' | 'paint' | 'holes' | 'water';

export interface RevertSettings {
	radius: number;
	channels: Record<RevertChannel, boolean>;
}

interface ChunkState {
	heights: Float32Array;
	vertexShade: Uint8Array | null;
	layers: ChunkLayer[];
	alpha: Uint8Array | null;
	holes: Uint8Array;
	water: SceneWater | null;
}

function capture(c: SceneChunk): ChunkState {
	return {
		heights: c.heights.slice(),
		vertexShade: c.vertexShade ? c.vertexShade.slice() : null,
		layers: c.layers.map((l) => ({ ...l })),
		alpha: c.alpha ? c.alpha.slice() : null,
		holes: c.holes.slice(),
		water: c.water ? { kind: c.water.kind, height: c.water.height, coverage: c.water.coverage.slice() } : null,
	};
}

const sameBytes = (a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean => {
	if (!a || !b) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

function sameState(a: ChunkState, b: ChunkState): boolean {
	return (
		sameBytes(a.heights, b.heights) &&
		sameBytes(a.vertexShade, b.vertexShade) &&
		a.layers.length === b.layers.length &&
		a.layers.every((l, i) => l.texture === b.layers[i].texture && l.effectId === b.layers[i].effectId) &&
		sameBytes(a.alpha, b.alpha) &&
		sameBytes(a.holes, b.holes) &&
		(a.water === null) === (b.water === null) &&
		(!a.water || (a.water.kind === b.water!.kind && a.water.height === b.water!.height && sameBytes(a.water.coverage, b.water!.coverage)))
	);
}

/** Puts a chunk's state back whole, marking only the channels that differ. */
function restore(model: SceneModel, tileIndex: number, chunkId: number, state: ChunkState): void {
	const chunk = model.tiles[tileIndex].chunks[chunkId];
	if (!sameBytes(chunk.heights, state.heights)) model.restoreHeights(tileIndex, chunkId, state.heights);
	if (!sameBytes(chunk.vertexShade, state.vertexShade)) model.restoreShade(tileIndex, chunkId, state.vertexShade);
	model.restorePaint(tileIndex, chunkId, state.layers, state.alpha);
	if (!sameBytes(chunk.holes, state.holes)) model.restoreHoles(tileIndex, chunkId, state.holes);
	model.restoreWater(tileIndex, chunkId, state.water);
}

export class RevertStroke {
	private readonly before = new Map<string, ChunkState>();
	/** Chunks already reverted this stroke: each is reverted once, whole. */
	private readonly visited = new Set<string>();

	constructor(
		private readonly model: SceneModel,
		private readonly settings: RevertSettings,
	) {}

	private touch(tileIndex: number, chunkId: number): void {
		const key = `${tileIndex}:${chunkId}`;
		if (!this.before.has(key)) this.before.set(key, capture(this.model.tiles[tileIndex].chunks[chunkId]));
	}

	/** Reverts every chunk the brush circle overlaps that this stroke hasn't reverted yet. */
	apply(x: number, z: number, _dt: number): void {
		const model = this.model;
		if (!model.baseData) return;
		const r = this.settings.radius;
		const cc0x = Math.max(0, Math.floor((x - r) / CHUNK_SIZE));
		const cc1x = Math.min(model.tilesX * CHUNKS_PER_TILE - 1, Math.floor((x + r) / CHUNK_SIZE));
		const cc0y = Math.max(0, Math.floor((z - r) / CHUNK_SIZE));
		const cc1y = Math.min(model.tilesY * CHUNKS_PER_TILE - 1, Math.floor((z + r) / CHUNK_SIZE));
		for (let ccy = cc0y; ccy <= cc1y; ccy++) {
			for (let ccx = cc0x; ccx <= cc1x; ccx++) {
				// The circle must reach into the chunk's square, not just its bounding box.
				const nx = Math.max(ccx * CHUNK_SIZE, Math.min(x, (ccx + 1) * CHUNK_SIZE));
				const nz = Math.max(ccy * CHUNK_SIZE, Math.min(z, (ccy + 1) * CHUNK_SIZE));
				if ((nx - x) ** 2 + (nz - z) ** 2 > r * r) continue;
				this.revertChunk(ccx, ccy);
			}
		}
	}

	/** Reverts one chunk (chunk-grid column/row) to base for the chosen channels. */
	revertChunk(ccx: number, ccy: number): void {
		const model = this.model;
		const tileIndex = Math.floor(ccy / CHUNKS_PER_TILE) * model.tilesX + Math.floor(ccx / CHUNKS_PER_TILE);
		const chunkId = (ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE);
		const key = `${tileIndex}:${chunkId}`;
		if (this.visited.has(key)) return;
		this.visited.add(key);
		const base = model.baseChunk(tileIndex, chunkId);
		if (!base) return;
		const chunk = model.tiles[tileIndex].chunks[chunkId];
		const { channels } = this.settings;
		this.touch(tileIndex, chunkId);

		if (channels.heights && !sameBytes(chunk.heights, base.heights)) {
			const touch = (t: number, c: number) => this.touch(t, c);
			for (let row = 0; row < 9; row++) {
				for (let col = 0; col < 9; col++) {
					const h = base.heights[row * 17 + col];
					const gx = ccx * 8 + col;
					const gz = ccy * 8 + row;
					if (model.outerHeight(gx, gz) !== h || chunk.heights[row * 17 + col] !== h) model.setOuterHeight(gx, gz, h, touch);
				}
			}
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) {
					const h = base.heights[row * 17 + 9 + col];
					if (chunk.heights[row * 17 + 9 + col] !== h) model.setInnerHeight(ccx * 8 + col, ccy * 8 + row, h, touch);
				}
			}
		}
		if (channels.vertexShade && !sameBytes(chunk.vertexShade, base.vertexShade)) model.restoreShade(tileIndex, chunkId, base.vertexShade);
		if (channels.paint) model.restorePaint(tileIndex, chunkId, base.layers, base.alpha);
		if (channels.holes && !sameBytes(chunk.holes, base.holes)) model.restoreHoles(tileIndex, chunkId, base.holes);
		if (channels.water) model.restoreWater(tileIndex, chunkId, base.water);
	}

	finish(): Command | null {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: ChunkState; after: ChunkState }[] = [];
		let bytes = 0;
		for (const [key, before] of this.before) {
			const [tileIndex, chunkId] = key.split(':').map(Number);
			const after = capture(model.tiles[tileIndex].chunks[chunkId]);
			if (sameState(before, after)) continue;
			changes.push({ tileIndex, chunkId, before, after });
			bytes += 2 * (580 * 2 + (before.alpha?.length ?? 0) + 128);
		}
		if (!changes.length) return null;
		return {
			label: 'Revert to base',
			bytes,
			undo: () => {
				for (const c of changes) restore(model, c.tileIndex, c.chunkId, c.before);
			},
			redo: () => {
				for (const c of changes) restore(model, c.tileIndex, c.chunkId, c.after);
			},
		};
	}
}
