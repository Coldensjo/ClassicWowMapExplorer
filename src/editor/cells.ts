import { CHUNK_SIZE, CHUNKS_PER_TILE } from '../formats/adt';
import type { SceneChunk, SceneModel, SceneWater } from '../scene/sceneModel';
import type { Command } from './commands';

/**
 * Holes and water (spec 7.6): both are brushes over the 8x8 cell grid of each chunk. Holes drop
 * the cell's triangles (and their collision); water is a flat per-chunk surface with a per-cell
 * coverage mask, plus a flood fill below a chosen height for lakes.
 */

/** A cell is CHUNK_SIZE / 8 yards across. */
const CELL = CHUNK_SIZE / 8;

export type HoleMode = 'cut' | 'fill';

export interface HoleSettings {
	radius: number;
	mode: HoleMode;
}

export type WaterMode = 'add' | 'remove' | 'flood';

export interface WaterSettings {
	radius: number;
	mode: WaterMode;
	/** LiquidType.db2 ID: 1 water, 2 ocean, 3 magma, 4 slime. */
	kind: number;
	/** Surface height in yards; null puts the surface a little above the first touched ground. */
	height: number | null;
}

/** Every cell centre within radius of (x, z), with its owning chunk. */
function forCells(model: SceneModel, x: number, z: number, radius: number, fn: (tileIndex: number, chunkId: number, chunk: SceneChunk, row: number, col: number) => void): void {
	const g0x = Math.max(0, Math.floor((x - radius) / CELL));
	const g1x = Math.min(model.cellsX - 1, Math.floor((x + radius) / CELL));
	const g0z = Math.max(0, Math.floor((z - radius) / CELL));
	const g1z = Math.min(model.cellsZ - 1, Math.floor((z + radius) / CELL));
	const r2 = radius * radius;
	for (let gz = g0z; gz <= g1z; gz++) {
		for (let gx = g0x; gx <= g1x; gx++) {
			const dx = (gx + 0.5) * CELL - x;
			const dz = (gz + 0.5) * CELL - z;
			if (dx * dx + dz * dz > r2) continue;
			const ccx = Math.floor(gx / 8);
			const ccy = Math.floor(gz / 8);
			const tileIndex = Math.floor(ccy / CHUNKS_PER_TILE) * model.tilesX + Math.floor(ccx / CHUNKS_PER_TILE);
			const chunkId = (ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE);
			fn(tileIndex, chunkId, model.tiles[tileIndex].chunks[chunkId], gz - ccy * 8, gx - ccx * 8);
		}
	}
}

/** One hole stroke: cut or fill cells while the button is held, then finish() for the command. */
export class HoleStroke {
	private readonly before = new Map<string, Uint8Array>();

	constructor(
		private readonly model: SceneModel,
		private readonly settings: HoleSettings,
	) {}

	apply(x: number, z: number, _dt: number): void {
		const cut = this.settings.mode === 'cut';
		forCells(this.model, x, z, this.settings.radius, (tileIndex, chunkId, chunk, row, col) => {
			const bit = 1 << col;
			const has = (chunk.holes[row] & bit) !== 0;
			if (has === cut) return;
			const key = `${tileIndex}:${chunkId}`;
			if (!this.before.has(key)) this.before.set(key, chunk.holes.slice());
			if (cut) chunk.holes[row] |= bit;
			else chunk.holes[row] &= ~bit;
			this.model.markDirty(this.model.tiles[tileIndex]);
		});
	}

	finish(): Command | null {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: Uint8Array; after: Uint8Array }[] = [];
		for (const [key, before] of this.before) {
			const [tileIndex, chunkId] = key.split(':').map(Number);
			const after = model.tiles[tileIndex].chunks[chunkId].holes.slice();
			if (!before.every((v, i) => v === after[i])) changes.push({ tileIndex, chunkId, before, after });
		}
		if (!changes.length) return null;
		return {
			label: this.settings.mode === 'cut' ? 'Cut holes' : 'Fill holes',
			bytes: changes.length * 64,
			undo: () => {
				for (const c of changes) model.restoreHoles(c.tileIndex, c.chunkId, c.before);
			},
			redo: () => {
				for (const c of changes) model.restoreHoles(c.tileIndex, c.chunkId, c.after);
			},
		};
	}
}

function copyWater(water: SceneWater | null): SceneWater | null {
	return water ? { kind: water.kind, height: water.height, coverage: water.coverage.slice() } : null;
}

function sameWater(a: SceneWater | null, b: SceneWater | null): boolean {
	if (!a || !b) return a === b;
	return a.kind === b.kind && a.height === b.height && a.coverage.every((v, i) => v === b.coverage[i]);
}

/** One water stroke: add or clear coverage cells, or flood fill once; finish() for the command. */
export class WaterStroke {
	private readonly before = new Map<string, SceneWater | null>();
	/** The surface height this stroke writes, settled at the first touch. */
	private surface: number | null = null;

	constructor(
		private readonly model: SceneModel,
		private readonly settings: WaterSettings,
		/** The ground height where the stroke started, for the automatic surface height. */
		private readonly startHeight: number,
	) {}

	private touch(tileIndex: number, chunkId: number, chunk: SceneChunk): void {
		const key = `${tileIndex}:${chunkId}`;
		if (!this.before.has(key)) this.before.set(key, copyWater(chunk.water));
	}

	/** The flat surface the stroke paints at: the typed height, or just above the first touch. */
	private surfaceHeight(): number {
		this.surface ??= this.settings.height ?? Math.round((this.startHeight + 1.5) * 10) / 10;
		return this.surface;
	}

	apply(x: number, z: number, _dt: number): void {
		const { mode, radius, kind } = this.settings;
		if (mode === 'flood') return; // Flood fills once, from applyFlood.
		forCells(this.model, x, z, radius, (tileIndex, chunkId, chunk, row, col) => {
			const bit = 1 << col;
			if (mode === 'add') {
				if (chunk.water && chunk.water.coverage[row] & bit) return;
				this.touch(tileIndex, chunkId, chunk);
				// A chunk holds one surface: adding to a chunk without water starts one at the
				// stroke's height; adding to one with water extends its existing surface.
				chunk.water ??= { kind, height: this.surfaceHeight(), coverage: new Uint8Array(8) };
				chunk.water.coverage[row] |= bit;
			} else {
				if (!chunk.water || !(chunk.water.coverage[row] & bit)) return;
				this.touch(tileIndex, chunkId, chunk);
				chunk.water.coverage[row] &= ~bit;
				if (chunk.water.coverage.every((b) => b === 0)) chunk.water = null;
			}
			this.model.markWaterDirty(tileIndex);
		});
	}

	/**
	 * Flood fill below a height (spec 7.6): covers every cell connected to the click whose
	 * terrain lies below the chosen surface, so a hollow becomes a lake. Returns how many cells
	 * the water reaches (0 when the clicked ground is not below the surface).
	 */
	applyFlood(x: number, z: number): number {
		const model = this.model;
		const surface = this.settings.height ?? Math.round((this.startHeight + 2) * 10) / 10;
		const startX = Math.floor(x / CELL);
		const startZ = Math.floor(z / CELL);
		if (startX < 0 || startZ < 0 || startX >= model.cellsX || startZ >= model.cellsZ) return 0;
		const below = (gx: number, gz: number): boolean => {
			const h = model.surfaceAt((gx + 0.5) * CELL, (gz + 0.5) * CELL);
			return h !== null && h < surface;
		};
		if (!below(startX, startZ)) return 0;
		const seen = new Set<number>();
		const queue = [startZ * model.cellsX + startX];
		seen.add(queue[0]);
		while (queue.length) {
			const cell = queue.pop()!;
			const gx = cell % model.cellsX;
			const gz = Math.floor(cell / model.cellsX);
			const ccx = Math.floor(gx / 8);
			const ccy = Math.floor(gz / 8);
			const tileIndex = Math.floor(ccy / CHUNKS_PER_TILE) * model.tilesX + Math.floor(ccx / CHUNKS_PER_TILE);
			const chunkId = (ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE);
			const chunk = model.tiles[tileIndex].chunks[chunkId];
			this.touch(tileIndex, chunkId, chunk);
			if (chunk.water) {
				// The lake takes over the chunk's surface so it stays one flat sheet.
				chunk.water.kind = this.settings.kind;
				chunk.water.height = surface;
			} else {
				chunk.water = { kind: this.settings.kind, height: surface, coverage: new Uint8Array(8) };
			}
			chunk.water.coverage[gz - ccy * 8] |= 1 << (gx - ccx * 8);
			this.model.markWaterDirty(tileIndex);
			for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
				const nx = gx + dx;
				const nz = gz + dz;
				if (nx < 0 || nz < 0 || nx >= model.cellsX || nz >= model.cellsZ) continue;
				const next = nz * model.cellsX + nx;
				if (seen.has(next) || !below(nx, nz)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		return seen.size;
	}

	finish(): Command | null {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: SceneWater | null; after: SceneWater | null }[] = [];
		for (const [key, before] of this.before) {
			const [tileIndex, chunkId] = key.split(':').map(Number);
			const after = copyWater(model.tiles[tileIndex].chunks[chunkId].water);
			if (!sameWater(before, after)) changes.push({ tileIndex, chunkId, before, after });
		}
		if (!changes.length) return null;
		return {
			label: this.settings.mode === 'remove' ? 'Remove water' : 'Add water',
			bytes: changes.length * 64,
			undo: () => {
				for (const c of changes) model.restoreWater(c.tileIndex, c.chunkId, c.before);
			},
			redo: () => {
				for (const c of changes) model.restoreWater(c.tileIndex, c.chunkId, c.after);
			},
		};
	}
}
