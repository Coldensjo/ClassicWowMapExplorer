import { CHUNK_SIZE, CHUNKS_PER_TILE } from '../formats/adt';
import type { LiquidInstance, LiquidKind } from '../formats/mh2o';

export interface LiquidMesh {
	kind: LiquidKind;
	/** LiquidType ID (the first of the kind's surfaces), for how it looks from under water. */
	type: number;
	/** Tile-local, same space as the terrain. */
	positions: Float32Array;
	indices: Uint32Array;
}

const CELL = CHUNK_SIZE / 8;

/**
 * Merges a tile's liquid instances into one mesh per liquid kind. Ocean is skipped: the
 * viewer draws one sea-level plane for the whole world.
 */
export function buildLiquidMeshes(liquids: LiquidInstance[], kindOf: (type: number) => LiquidKind): LiquidMesh[] {
	const byKind = new Map<LiquidKind, { type: number; positions: number[]; indices: number[] }>();
	for (const l of liquids) {
		const kind = kindOf(l.type);
		if (kind === 'ocean' || l.width === 0 || l.height === 0) continue;
		const mesh = byKind.get(kind) ?? { type: l.type, positions: [], indices: [] };
		byKind.set(kind, mesh);

		const cx = l.chunk % CHUNKS_PER_TILE;
		const cy = Math.floor(l.chunk / CHUNKS_PER_TILE);
		const base = mesh.positions.length / 3;
		const w = l.width + 1;
		for (let j = 0; j <= l.height; j++) {
			for (let i = 0; i <= l.width; i++) {
				mesh.positions.push(
					cx * CHUNK_SIZE + (l.x + i) * CELL,
					l.heights ? l.heights[j * w + i] : l.minHeight,
					cy * CHUNK_SIZE + (l.y + j) * CELL,
				);
			}
		}
		for (let j = 0; j < l.height; j++) {
			for (let i = 0; i < l.width; i++) {
				if (l.exists && !l.exists[j * l.width + i]) continue;
				const tl = base + j * w + i;
				const tr = tl + 1;
				const bl = tl + w;
				const br = bl + 1;
				// Counter-clockwise seen from above.
				mesh.indices.push(tl, bl, tr, tr, bl, br);
			}
		}
	}
	return [...byKind].map(([kind, m]) => ({ kind, type: m.type, positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices) }));
}
