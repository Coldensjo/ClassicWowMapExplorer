import { CHUNK_SIZE, CHUNKS_PER_TILE } from '../formats/adt';
import { ALPHA_SIZE } from '../formats/adtTex';
import type { SceneChunk, SceneModel, SceneTile } from '../scene/sceneModel';
import type { ChunkLayer } from '../scene/types';
import type { Command } from './commands';

/**
 * Texture painting (spec 7.5): the brush writes into a chunk's 64x64 alpha map for the selected
 * texture. Alpha is stored un-normalized as in ADT: the splat shader weighs layers 1-3 by their
 * alpha and layer 0 by the remainder, so painting keeps the sum at most 255 and reduces the other
 * layers proportionally, and the visible blend matches what was painted.
 */

export type PaintMode = 'paint' | 'erase' | 'fill' | 'base';
/** What to do when a chunk already has 4 layers (spec 7.5). */
export type LayerPolicy = 'replace' | 'block';

export interface PaintSettings {
	/** The texture to paint with, as a FileDataID. */
	fdid: number;
	/** Yards. */
	radius: number;
	strength: number;
	/** The alpha the brush drives toward, 0..1. */
	opacity: number;
	mode: PaintMode;
	policy: LayerPolicy;
}

const PAINT_LABELS: Record<PaintMode, string> = {
	paint: 'Paint texture',
	erase: 'Erase paint',
	fill: 'Fill chunk',
	base: 'Set base texture',
};

/** Alpha texel spacing: texel i sits at i/63 of the chunk, as the splat shader samples it. */
const TEXEL = CHUNK_SIZE / (ALPHA_SIZE - 1);
const TEXELS = ALPHA_SIZE * ALPHA_SIZE;
/** How fast the brush approaches the target opacity, per second at strength 1. */
const PAINT_RATE = 10;
/** A full layer is replaced only when its paint under the brush averages below this (of 255). */
const REPLACE_THRESHOLD = 8;

/** One chunk's paint state, snapshotted whole: the layer list and the alpha that goes with it. */
interface PaintState {
	layers: ChunkLayer[];
	alpha: Uint8Array | null;
}

function snapshot(chunk: SceneChunk): PaintState {
	return { layers: chunk.layers.map((l) => ({ ...l })), alpha: chunk.alpha ? chunk.alpha.slice() : null };
}

function samePaint(a: PaintState, b: PaintState): boolean {
	if (a.layers.length !== b.layers.length) return false;
	if (a.layers.some((l, i) => l.texture !== b.layers[i].texture || l.effectId !== b.layers[i].effectId)) return false;
	if ((a.alpha === null) !== (b.alpha === null)) return false;
	return !a.alpha || a.alpha.every((v, i) => v === b.alpha![i]);
}

/**
 * One paint stroke; apply() per frame while the button is held, then finish() for the command.
 * Fill and set-base act once per chunk the stroke passes over.
 */
export class PaintStroke {
	private readonly before = new Map<string, PaintState>();
	/** Chunks fill/base already handled this stroke. */
	private readonly visited = new Set<string>();
	/** Chunks that could not take the texture (4 layers, spec 7.5), for the red flash. */
	readonly blocked: { x: number; z: number }[] = [];

	constructor(
		private readonly model: SceneModel,
		private readonly settings: PaintSettings,
		/** The ground effect a texture usually carries, from the scan (spec 7.7.2); 0 for none. */
		private readonly effectFor: (fdid: number) => number = () => 0,
	) {}

	apply(x: number, z: number, dt: number): void {
		const { radius, mode } = this.settings;
		const reach = mode === 'paint' || mode === 'erase' ? radius : 0.01;
		const cc0x = Math.max(0, Math.floor((x - reach) / CHUNK_SIZE));
		const cc1x = Math.min(this.model.tilesX * CHUNKS_PER_TILE - 1, Math.floor((x + reach) / CHUNK_SIZE));
		const cc0y = Math.max(0, Math.floor((z - reach) / CHUNK_SIZE));
		const cc1y = Math.min(this.model.tilesY * CHUNKS_PER_TILE - 1, Math.floor((z + reach) / CHUNK_SIZE));
		for (let ccy = cc0y; ccy <= cc1y; ccy++) {
			for (let ccx = cc0x; ccx <= cc1x; ccx++) {
				const tileIndex = Math.floor(ccy / CHUNKS_PER_TILE) * this.model.tilesX + Math.floor(ccx / CHUNKS_PER_TILE);
				const chunkId = (ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE);
				const tile = this.model.tiles[tileIndex];
				const chunk = tile.chunks[chunkId];
				switch (mode) {
					case 'paint':
						this.paintChunk(tile, tileIndex, chunkId, chunk, ccx, ccy, x, z, dt);
						break;
					case 'erase':
						this.eraseChunk(tile, tileIndex, chunkId, chunk, ccx, ccy, x, z, dt);
						break;
					case 'fill':
						this.fillChunk(tile, tileIndex, chunkId, chunk, ccx, ccy);
						break;
					case 'base':
						this.setBase(tile, tileIndex, chunkId, chunk, ccx, ccy);
						break;
				}
			}
		}
	}

	private key(tileIndex: number, chunkId: number): string {
		return `${tileIndex}:${chunkId}`;
	}

	private touch(tileIndex: number, chunkId: number, chunk: SceneChunk): void {
		const key = this.key(tileIndex, chunkId);
		if (!this.before.has(key)) this.before.set(key, snapshot(chunk));
	}

	/** The chunk's layer for the texture, adding or replacing one under the 4-layer rule; -1 blocked. */
	private layerFor(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number, x: number, z: number): number {
		const paletteIndex = this.model.textureIndex(this.settings.fdid);
		const existing = chunk.layers.findIndex((l) => l.texture === paletteIndex);
		if (existing >= 0) return existing;
		this.touch(tileIndex, chunkId, chunk);
		if (chunk.layers.length < 4) {
			chunk.layers.push({ texture: paletteIndex, effectId: this.effectFor(this.settings.fdid) || undefined });
			const alpha = new Uint8Array((chunk.layers.length - 1) * TEXELS);
			if (chunk.alpha) alpha.set(chunk.alpha);
			chunk.alpha = alpha;
			this.model.markDirty(tile);
			return chunk.layers.length - 1;
		}
		// Full: replace the weakest painted layer, if it is barely used under the brush.
		if (this.settings.policy === 'replace') {
			let weakest = 1;
			let weakestSum = Infinity;
			for (let l = 1; l < 4; l++) {
				let sum = 0;
				const map = chunk.alpha!.subarray((l - 1) * TEXELS, l * TEXELS);
				for (let i = 0; i < TEXELS; i++) sum += map[i];
				if (sum < weakestSum) {
					weakestSum = sum;
					weakest = l;
				}
			}
			if (this.underBrushAverage(chunk, weakest, ccx, ccy, x, z) < REPLACE_THRESHOLD) {
				chunk.layers[weakest] = { texture: paletteIndex, effectId: this.effectFor(this.settings.fdid) || undefined };
				chunk.alpha!.fill(0, (weakest - 1) * TEXELS, weakest * TEXELS);
				this.model.markDirty(tile);
				return weakest;
			}
		}
		this.flagBlocked(ccx, ccy);
		return -1;
	}

	/** A layer's average alpha over the texels the brush reaches, for the replace threshold. */
	private underBrushAverage(chunk: SceneChunk, layer: number, ccx: number, ccy: number, x: number, z: number): number {
		const map = chunk.alpha!.subarray((layer - 1) * TEXELS, layer * TEXELS);
		const { radius } = this.settings;
		let sum = 0;
		let n = 0;
		this.forTexels(ccx, ccy, x, z, radius, (i) => {
			sum += map[i];
			n++;
		});
		return n ? sum / n : 0;
	}

	private flagBlocked(ccx: number, ccy: number): void {
		const key = this.key(ccx, ccy);
		if (this.visited.has(`blocked:${key}`)) return;
		this.visited.add(`blocked:${key}`);
		this.blocked.push({ x: ccx * CHUNK_SIZE, z: ccy * CHUNK_SIZE });
	}

	/** Every alpha texel of chunk (ccx, ccy) within radius of (x, z). */
	private forTexels(ccx: number, ccy: number, x: number, z: number, radius: number, fn: (index: number, weight: number) => void): void {
		const ox = ccx * CHUNK_SIZE;
		const oz = ccy * CHUNK_SIZE;
		const tx0 = Math.max(0, Math.ceil((x - radius - ox) / TEXEL));
		const tx1 = Math.min(ALPHA_SIZE - 1, Math.floor((x + radius - ox) / TEXEL));
		const tz0 = Math.max(0, Math.ceil((z - radius - oz) / TEXEL));
		const tz1 = Math.min(ALPHA_SIZE - 1, Math.floor((z + radius - oz) / TEXEL));
		const r2 = radius * radius;
		for (let tz = tz0; tz <= tz1; tz++) {
			for (let tx = tx0; tx <= tx1; tx++) {
				const dx = ox + tx * TEXEL - x;
				const dz = oz + tz * TEXEL - z;
				const d2 = dx * dx + dz * dz;
				if (d2 > r2) continue;
				const t = 1 - Math.sqrt(d2) / radius;
				fn(tz * ALPHA_SIZE + tx, t * t * (3 - 2 * t));
			}
		}
	}

	/**
	 * Drives the layer's alpha toward the target opacity and scales the other layers down when the
	 * sum would pass 255, so the blend shows exactly the painted share (spec 7.5 normalization).
	 */
	private paintChunk(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number, x: number, z: number, dt: number): void {
		const layer = this.layerFor(tile, tileIndex, chunkId, chunk, ccx, ccy, x, z);
		if (layer < 0) return;
		const { strength, opacity, radius } = this.settings;
		const target = Math.round(opacity * 255);
		if (layer === 0) {
			// Painting the base texture shows more of layer 0: scale the painted layers down.
			this.easeOthers(tile, tileIndex, chunkId, chunk, ccx, ccy, x, z, dt, 255 - target);
			return;
		}
		const layers = chunk.layers.length;
		let changed = false;
		this.forTexels(ccx, ccy, x, z, radius, (i, w) => {
			const k = Math.min(1, w * strength * PAINT_RATE * dt);
			if (k <= 0) return;
			const mine = (layer - 1) * TEXELS + i;
			const old = chunk.alpha![mine];
			const next = Math.round(old + (target - old) * k);
			if (next === old) return;
			if (!changed) {
				this.touch(tileIndex, chunkId, chunk);
				changed = true;
			}
			chunk.alpha![mine] = next;
			// Keep the sum in range by scaling the other painted layers down proportionally.
			let others = 0;
			for (let l = 1; l < layers; l++) {
				if (l !== layer) others += chunk.alpha![(l - 1) * TEXELS + i];
			}
			const room = 255 - next;
			if (others > room) {
				const scale = room / others;
				for (let l = 1; l < layers; l++) {
					if (l !== layer) {
						const o = (l - 1) * TEXELS + i;
						chunk.alpha![o] = Math.round(chunk.alpha![o] * scale);
					}
				}
			}
		});
		if (changed) this.model.markAlphaDirty(tileIndex, chunkId);
	}

	/** Scales every painted layer toward the given total (0 erases to bare layer 0). */
	private easeOthers(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number, x: number, z: number, dt: number, targetSum: number): void {
		if (chunk.layers.length < 2 || !chunk.alpha) return;
		const { strength, radius } = this.settings;
		const layers = chunk.layers.length;
		let changed = false;
		this.forTexels(ccx, ccy, x, z, radius, (i, w) => {
			const k = Math.min(1, w * strength * PAINT_RATE * dt);
			if (k <= 0) return;
			let sum = 0;
			for (let l = 1; l < layers; l++) sum += chunk.alpha![(l - 1) * TEXELS + i];
			if (sum === 0) return;
			const next = sum + (Math.min(targetSum, sum) - sum) * k;
			if (next >= sum) return;
			const scale = next / sum;
			if (!changed) {
				this.touch(tileIndex, chunkId, chunk);
				changed = true;
			}
			for (let l = 1; l < layers; l++) {
				const o = (l - 1) * TEXELS + i;
				chunk.alpha![o] = Math.round(chunk.alpha![o] * scale);
			}
		});
		if (changed) this.model.markAlphaDirty(tileIndex, chunkId);
	}

	private eraseChunk(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number, x: number, z: number, dt: number): void {
		this.easeOthers(tile, tileIndex, chunkId, chunk, ccx, ccy, x, z, dt, 0);
	}

	/** Fills the whole chunk with the texture at the target opacity, once per stroke. */
	private fillChunk(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number): void {
		const key = this.key(tileIndex, chunkId);
		if (this.visited.has(key)) return;
		this.visited.add(key);
		const centre = (ccx + 0.5) * CHUNK_SIZE;
		const centreZ = (ccy + 0.5) * CHUNK_SIZE;
		const layer = this.layerFor(tile, tileIndex, chunkId, chunk, ccx, ccy, centre, centreZ);
		if (layer < 0) return;
		this.touch(tileIndex, chunkId, chunk);
		const target = Math.round(this.settings.opacity * 255);
		if (layer === 0) {
			const sumTarget = 255 - target;
			for (let i = 0; i < TEXELS; i++) {
				let sum = 0;
				for (let l = 1; l < chunk.layers.length; l++) sum += chunk.alpha![(l - 1) * TEXELS + i];
				if (sum <= sumTarget || sum === 0) continue;
				const scale = sumTarget / sum;
				for (let l = 1; l < chunk.layers.length; l++) {
					const o = (l - 1) * TEXELS + i;
					chunk.alpha![o] = Math.round(chunk.alpha![o] * scale);
				}
			}
		} else {
			for (let i = 0; i < TEXELS; i++) {
				chunk.alpha![(layer - 1) * TEXELS + i] = target;
				let others = 0;
				for (let l = 1; l < chunk.layers.length; l++) {
					if (l !== layer) others += chunk.alpha![(l - 1) * TEXELS + i];
				}
				const room = 255 - target;
				if (others > room) {
					const scale = room / others;
					for (let l = 1; l < chunk.layers.length; l++) {
						if (l !== layer) {
							const o = (l - 1) * TEXELS + i;
							chunk.alpha![o] = Math.round(chunk.alpha![o] * scale);
						}
					}
				}
			}
		}
		this.model.markAlphaDirty(tileIndex, chunkId);
	}

	/** Replaces the chunk's layer 0 texture, keeping the other layers and their alpha (spec 7.5). */
	private setBase(tile: SceneTile, tileIndex: number, chunkId: number, chunk: SceneChunk, ccx: number, ccy: number): void {
		const key = this.key(tileIndex, chunkId);
		if (this.visited.has(key)) return;
		this.visited.add(key);
		const paletteIndex = this.model.textureIndex(this.settings.fdid);
		if (chunk.layers[0].texture === paletteIndex) return;
		// The texture may already be a painted layer; setting it as base anyway is allowed.
		this.touch(tileIndex, chunkId, chunk);
		chunk.layers[0] = { texture: paletteIndex, effectId: this.effectFor(this.settings.fdid) || undefined };
		this.model.markDirty(tile);
	}

	/** The finished stroke as one command, already applied; null when nothing changed. */
	finish(): Command | null {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: PaintState; after: PaintState }[] = [];
		let bytes = 0;
		for (const [key, before] of this.before) {
			const [tileIndex, chunkId] = key.split(':').map(Number);
			const after = snapshot(model.tiles[tileIndex].chunks[chunkId]);
			if (samePaint(before, after)) continue;
			changes.push({ tileIndex, chunkId, before, after });
			bytes += (before.alpha?.length ?? 0) + (after.alpha?.length ?? 0) + 128;
		}
		if (!changes.length) return null;
		const restore = (states: 'before' | 'after') => {
			for (const c of changes) model.restorePaint(c.tileIndex, c.chunkId, c[states].layers, c[states].alpha);
		};
		return {
			label: PAINT_LABELS[this.settings.mode],
			bytes,
			undo: () => restore('before'),
			redo: () => restore('after'),
		};
	}
}
