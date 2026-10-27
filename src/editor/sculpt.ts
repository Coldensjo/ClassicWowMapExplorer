import { CHUNK_HEIGHTS, CHUNK_SIZE } from '../formats/adt';
import type { SceneChunk, SceneModel } from '../scene/sceneModel';
import type { Command } from './commands';

/**
 * Terrain sculpting (spec 7.4): a circular brush over the height lattice. All writes go through
 * SceneModel's lattice setters, which keep chunk and tile edges seam-safe; a whole stroke is one
 * undoable command built from sparse before/after snapshots of the chunks it touched.
 */

export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'ramp';
export type Falloff = 'linear' | 'smooth' | 'flat';

export interface BrushSettings {
	/** Yards, 1..100. */
	radius: number;
	/** 0..1. */
	strength: number;
	falloff: Falloff;
	mode: SculptMode;
	/** Flatten target height; null flattens toward the height sampled at stroke start. */
	flattenTo: number | null;
}

export const SCULPT_LABELS: Record<SculptMode, string> = {
	raise: 'Raise terrain',
	lower: 'Lower terrain',
	smooth: 'Smooth terrain',
	flatten: 'Flatten terrain',
	noise: 'Roughen terrain',
	ramp: 'Ramp terrain',
};

/** Outer lattice spacing in yards. */
const CELL = CHUNK_SIZE / 8;
/** Yards per second at strength 1 for raise/lower. */
const RAISE_RATE = 25;
/** Share of the way to the target per second at strength 1 for smooth and flatten. */
const EASE_RATE = 6;
/** Peak noise amplitude in yards per second at strength 1. */
const NOISE_RATE = 12;

function weightOf(d: number, radius: number, falloff: Falloff): number {
	if (d >= radius) return 0;
	if (falloff === 'flat') return 1;
	const t = 1 - d / radius;
	return falloff === 'linear' ? t : t * t * (3 - 2 * t);
}

/** Small hash-based value noise in two octaves, seeded per stroke. */
function noise2(x: number, z: number, seed: number): number {
	const lattice = (ix: number, iz: number) => {
		let h = Math.imul(ix ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iz ^ seed, 0xc2b2ae35);
		h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
		return ((h ^ (h >>> 15)) >>> 0) / 4294967296 * 2 - 1;
	};
	const sample = (px: number, pz: number) => {
		const ix = Math.floor(px);
		const iz = Math.floor(pz);
		const fx = px - ix;
		const fz = pz - iz;
		const sx = fx * fx * (3 - 2 * fx);
		const sz = fz * fz * (3 - 2 * fz);
		const a = lattice(ix, iz) + (lattice(ix + 1, iz) - lattice(ix, iz)) * sx;
		const b = lattice(ix, iz + 1) + (lattice(ix + 1, iz + 1) - lattice(ix, iz + 1)) * sx;
		return a + (b - a) * sz;
	};
	return sample(x, z) + 0.5 * sample(x * 2.03 + 37.2, z * 2.03 - 11.7);
}

/** One write the brush wants to make, gathered first so smoothing reads undisturbed heights. */
interface Write {
	outer: boolean;
	gx: number;
	gz: number;
	h: number;
}

/**
 * One sculpt stroke: apply() per frame while the button is held, then finish() for the command.
 * The stroke snapshots each touched chunk's heights the first time it writes to it.
 */
export class SculptStroke {
	private readonly before = new Map<string, Float32Array>();
	private touched = false;
	/** Flatten target: the given value, or the height under the cursor at stroke start. */
	private readonly flatTarget: number;
	private readonly seed = (Math.random() * 0xffffffff) >>> 0;

	constructor(
		private readonly model: SceneModel,
		private readonly settings: BrushSettings,
		startHeight: number,
		/** Brushes in this mode instead of the settings' (Shift raises and Cmd lowers, whichever of the two is chosen). */
		private readonly modeOverride: SculptMode | null = null,
	) {
		this.flatTarget = settings.flattenTo ?? startHeight;
	}

	private get mode(): SculptMode {
		return this.modeOverride ?? this.settings.mode;
	}

	private readonly touch = (tileIndex: number, chunkId: number, chunk: SceneChunk): void => {
		const key = `${tileIndex}:${chunkId}`;
		if (!this.before.has(key)) this.before.set(key, chunk.heights.slice());
		this.touched = true;
	};

	/** Applies the brush at scene-space (x, z) for a frame of dt seconds. */
	apply(x: number, z: number, dt: number): void {
		const { radius, strength, falloff } = this.settings;
		const mode = this.mode;
		if (mode === 'ramp') return; // Ramps apply on the second click (applyRamp).
		const writes: Write[] = [];
		const target = (old: number, w: number, worldX: number, worldZ: number, average: () => number): number => {
			switch (mode) {
				case 'raise':
					return old + w * strength * RAISE_RATE * dt;
				case 'lower':
					return old - w * strength * RAISE_RATE * dt;
				case 'smooth':
					return old + (average() - old) * Math.min(1, w * strength * EASE_RATE * dt);
				case 'flatten':
					return old + (this.flatTarget - old) * Math.min(1, w * strength * EASE_RATE * dt);
				case 'noise':
					return old + noise2(worldX / radius * 3, worldZ / radius * 3, this.seed) * w * strength * NOISE_RATE * dt;
				default:
					return old;
			}
		};

		this.forVertices(x, z, radius, (outer, gx, gz, worldX, worldZ) => {
			const d = Math.hypot(worldX - x, worldZ - z);
			const w = weightOf(d, radius, falloff);
			if (w <= 0) return;
			const old = outer ? this.model.outerHeight(gx, gz) : this.model.innerHeight(gx, gz);
			const h = target(old, w, worldX, worldZ, () => (outer ? this.averageAroundOuter(gx, gz) : this.averageAroundInner(gx, gz)));
			if (h !== old) writes.push({ outer, gx, gz, h });
		});
		this.write(writes);
	}

	/**
	 * A straight slope between two clicked points (spec 7.4 Ramp): heights across the strip follow
	 * the line from a's height to b's, blended in by the falloff across the brush radius.
	 */
	applyRamp(a: { x: number; z: number; h: number }, b: { x: number; z: number; h: number }): void {
		const { radius, strength, falloff } = this.settings;
		const abx = b.x - a.x;
		const abz = b.z - a.z;
		const len2 = abx * abx + abz * abz;
		if (len2 === 0) return;
		const minX = Math.min(a.x, b.x) - radius;
		const maxX = Math.max(a.x, b.x) + radius;
		const minZ = Math.min(a.z, b.z) - radius;
		const maxZ = Math.max(a.z, b.z) + radius;
		const writes: Write[] = [];
		this.forBox(minX, maxX, minZ, maxZ, (outer, gx, gz, worldX, worldZ) => {
			const t = Math.min(1, Math.max(0, ((worldX - a.x) * abx + (worldZ - a.z) * abz) / len2));
			const d = Math.hypot(worldX - (a.x + abx * t), worldZ - (a.z + abz * t));
			const w = weightOf(d, radius, falloff) * strength;
			if (w <= 0) return;
			const old = outer ? this.model.outerHeight(gx, gz) : this.model.innerHeight(gx, gz);
			const h = old + (a.h + (b.h - a.h) * t - old) * w;
			if (h !== old) writes.push({ outer, gx, gz, h });
		});
		this.write(writes);
	}

	private write(writes: Write[]): void {
		for (const w of writes) {
			if (w.outer) this.model.setOuterHeight(w.gx, w.gz, w.h, this.touch);
			else this.model.setInnerHeight(w.gx, w.gz, w.h, this.touch);
		}
	}

	/** Every lattice vertex within radius of (x, z), by its kind, lattice indices and position. */
	private forVertices(x: number, z: number, radius: number, fn: (outer: boolean, gx: number, gz: number, worldX: number, worldZ: number) => void): void {
		this.forBox(x - radius, x + radius, z - radius, z + radius, fn);
	}

	private forBox(minX: number, maxX: number, minZ: number, maxZ: number, fn: (outer: boolean, gx: number, gz: number, worldX: number, worldZ: number) => void): void {
		const { cellsX, cellsZ } = this.model;
		const ox0 = Math.max(0, Math.ceil(minX / CELL));
		const ox1 = Math.min(cellsX, Math.floor(maxX / CELL));
		const oz0 = Math.max(0, Math.ceil(minZ / CELL));
		const oz1 = Math.min(cellsZ, Math.floor(maxZ / CELL));
		for (let gz = oz0; gz <= oz1; gz++) {
			for (let gx = ox0; gx <= ox1; gx++) fn(true, gx, gz, gx * CELL, gz * CELL);
		}
		const ix0 = Math.max(0, Math.ceil(minX / CELL - 0.5));
		const ix1 = Math.min(cellsX - 1, Math.floor(maxX / CELL - 0.5));
		const iz0 = Math.max(0, Math.ceil(minZ / CELL - 0.5));
		const iz1 = Math.min(cellsZ - 1, Math.floor(maxZ / CELL - 0.5));
		for (let gz = iz0; gz <= iz1; gz++) {
			for (let gx = ix0; gx <= ix1; gx++) fn(false, gx, gz, (gx + 0.5) * CELL, (gz + 0.5) * CELL);
		}
	}

	/** The average of an outer vertex's lattice neighbours (the four cell centres around it). */
	private averageAroundOuter(gx: number, gz: number): number {
		const { cellsX, cellsZ } = this.model;
		let sum = 0;
		let n = 0;
		for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
			const ix = gx + dx;
			const iz = gz + dz;
			if (ix < 0 || iz < 0 || ix >= cellsX || iz >= cellsZ) continue;
			sum += this.model.innerHeight(ix, iz);
			n++;
		}
		for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
			const ox = gx + dx;
			const oz = gz + dz;
			if (ox < 0 || oz < 0 || ox > cellsX || oz > cellsZ) continue;
			sum += this.model.outerHeight(ox, oz);
			n++;
		}
		return n ? sum / n : this.model.outerHeight(gx, gz);
	}

	/** The average of a cell centre's four corner vertices. */
	private averageAroundInner(gx: number, gz: number): number {
		return (
			this.model.outerHeight(gx, gz) +
			this.model.outerHeight(gx + 1, gz) +
			this.model.outerHeight(gx, gz + 1) +
			this.model.outerHeight(gx + 1, gz + 1)
		) / 4;
	}

	/** The finished stroke as one command, already applied; null when nothing changed. */
	finish(): Command | null {
		if (!this.touched) return null;
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: Float32Array; after: Float32Array }[] = [];
		for (const [key, before] of this.before) {
			const [tileIndex, chunkId] = key.split(':').map(Number);
			const after = model.tiles[tileIndex].chunks[chunkId].heights.slice();
			if (!before.every((v, i) => v === after[i])) changes.push({ tileIndex, chunkId, before, after });
		}
		if (!changes.length) return null;
		return {
			label: SCULPT_LABELS[this.mode],
			bytes: changes.length * CHUNK_HEIGHTS * 4 * 2,
			undo: () => {
				for (const c of changes) model.restoreHeights(c.tileIndex, c.chunkId, c.before);
			},
			redo: () => {
				for (const c of changes) model.restoreHeights(c.tileIndex, c.chunkId, c.after);
			},
		};
	}
}
