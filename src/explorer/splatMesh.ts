import { CHUNKS_PER_TILE, TILE_CELLS, TILE_SIZE, tileGrids, type AdtRoot } from '../formats/adt';
import { ALPHA_SIZE, type AdtTex } from '../formats/adtTex';
import { buildTerrainMesh } from './terrainMesh';

export const ALPHA_ATLAS_SIZE = ALPHA_SIZE * CHUNKS_PER_TILE;

export interface SplatLayer {
	diffuse: number;
	height: number;
	repeats: number;
	heightScale: number;
	heightOffset: number;
}

/** A run of the index buffer whose chunks all use the same texture layers. */
export interface SplatGroup {
	start: number;
	count: number;
	layers: SplatLayer[];
}

export interface SplatGeometry {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	colors: Float32Array;
	/** Chunk index (y * 16 + x) per vertex, so the shader can find the chunk's alpha map. */
	chunks: Float32Array;
	indices: Uint32Array;
}

export interface SplatTerrain {
	geometry: SplatGeometry;
	groups: SplatGroup[];
	/** 1024x1024 RGBA atlas: each chunk's 64x64 alpha maps for layers 1-3 in R, G, B. */
	alpha: Uint8Array;
	/** Every texture file the groups reference. */
	textures: number[];
	/** 129x129 outer heights. */
	heights: Float32Array;
}

const OUTER = 9;
const INNER = 8;
const CHUNK_VERTS = OUTER * OUTER + INNER * INNER;

/**
 * Terrain for one tile with per-chunk vertices (chunks don't share vertices, so each carries
 * its own chunk index and vertex colours), grouped by texture layers for drawing.
 */
export function buildSplatTerrain(root: AdtRoot, tex: AdtTex, skirtDepth = 30): SplatTerrain {
	const grids = tileGrids(root);
	// Shared-grid mesh gives seamless normals; the per-chunk vertices copy them.
	const shared = buildTerrainMesh(grids.outer, grids.inner, TILE_CELLS, TILE_SIZE, null, 0);
	const n = TILE_CELLS;
	const sharedOuter = (row: number, col: number) => row * (n + 1) + col;
	const sharedInner = (row: number, col: number) => (n + 1) * (n + 1) + row * n + col;

	// Count skirt vertices: 9 per tile-edge side of each edge chunk.
	let skirtVerts = 0;
	for (const c of root.chunks) {
		skirtVerts += OUTER * ((c.indexY === 0 ? 1 : 0) + (c.indexY === 15 ? 1 : 0) + (c.indexX === 0 ? 1 : 0) + (c.indexX === 15 ? 1 : 0));
	}
	const vertexCount = root.chunks.length * CHUNK_VERTS + skirtVerts;
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const colors = new Float32Array(vertexCount * 3).fill(1);
	const chunkIds = new Float32Array(vertexCount);
	let next = 0;

	const addVertex = (sharedIndex: number, chunkId: number, color: Float32Array | null, colorIndex: number, drop = 0): number => {
		const v = next++;
		positions[v * 3] = shared.positions[sharedIndex * 3];
		positions[v * 3 + 1] = shared.positions[sharedIndex * 3 + 1] - drop;
		positions[v * 3 + 2] = shared.positions[sharedIndex * 3 + 2];
		normals.set(shared.normals.subarray(sharedIndex * 3, sharedIndex * 3 + 3), v * 3);
		uvs.set(shared.uvs.subarray(sharedIndex * 2, sharedIndex * 2 + 2), v * 2);
		if (color) colors.set(color.subarray(colorIndex * 3, colorIndex * 3 + 3), v * 3);
		chunkIds[v] = chunkId;
		return v;
	};

	// Triangles per chunk, collected so they can be reordered by texture group.
	const chunkTriangles = new Map<number, number[]>();
	for (const c of root.chunks) {
		const id = c.indexY * CHUNKS_PER_TILE + c.indexX;
		const x0 = c.indexX * 8;
		const y0 = c.indexY * 8;
		const base = next;
		for (let row = 0; row < OUTER; row++) {
			for (let col = 0; col < OUTER; col++) addVertex(sharedOuter(y0 + row, x0 + col), id, c.colors, row * 17 + col);
		}
		for (let row = 0; row < INNER; row++) {
			for (let col = 0; col < INNER; col++) addVertex(sharedInner(y0 + row, x0 + col), id, c.colors, row * 17 + 9 + col);
		}
		const tris: number[] = [];
		for (let row = 0; row < INNER; row++) {
			for (let col = 0; col < INNER; col++) {
				if (c.holes[row] & (1 << col)) continue;
				const tl = base + row * OUTER + col;
				const tr = tl + 1;
				const bl = tl + OUTER;
				const br = bl + 1;
				const center = base + OUTER * OUTER + row * INNER + col;
				tris.push(tl, center, tr, tr, center, br, br, center, bl, bl, center, tl);
			}
		}

		// Skirts along the tile's outer edges hide cracks against lower-detail neighbours.
		const edges: [number, number][][] = [];
		const line = (fn: (k: number) => [number, number]) => Array.from({ length: OUTER }, (_, k) => fn(k));
		if (c.indexY === 0) edges.push(line((k) => [0, k]));
		if (c.indexY === 15) edges.push(line((k) => [8, k]));
		if (c.indexX === 0) edges.push(line((k) => [k, 0]));
		if (c.indexX === 15) edges.push(line((k) => [k, 8]));
		for (const edge of edges) {
			const top = edge.map(([row, col]) => base + row * OUTER + col);
			const bottom = edge.map(([row, col]) => addVertex(sharedOuter(y0 + row, x0 + col), id, c.colors, row * 17 + col, skirtDepth));
			for (let k = 0; k < OUTER - 1; k++) {
				const a = top[k], b = top[k + 1], sa = bottom[k], sb = bottom[k + 1];
				// Both windings, so the skirt shows from either side.
				tris.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
			}
		}
		chunkTriangles.set(id, tris);
	}

	// Group chunks by their layer set.
	const layersOf = (id: number): SplatLayer[] => {
		const tc = tex.chunks[id];
		if (!tc) return [];
		return tc.layers.slice(0, 4).map((l) => ({
			diffuse: tex.diffuse[l.texture] ?? 0,
			height: tex.height[l.texture] ?? 0,
			repeats: tex.params[l.texture]?.repeats ?? 8,
			heightScale: tex.params[l.texture]?.heightScale ?? 0,
			heightOffset: tex.params[l.texture]?.heightOffset ?? 1,
		}));
	};
	const groupsByKey = new Map<string, { layers: SplatLayer[]; chunks: number[] }>();
	for (const id of chunkTriangles.keys()) {
		const layers = layersOf(id);
		const key = JSON.stringify(layers);
		const group = groupsByKey.get(key) ?? { layers, chunks: [] };
		group.chunks.push(id);
		groupsByKey.set(key, group);
	}
	const indices: number[] = [];
	const groups: SplatGroup[] = [];
	for (const group of groupsByKey.values()) {
		const start = indices.length;
		for (const id of group.chunks) for (const i of chunkTriangles.get(id)!) indices.push(i);
		groups.push({ start, count: indices.length - start, layers: group.layers });
	}

	// Alpha atlas.
	const alpha = new Uint8Array(ALPHA_ATLAS_SIZE * ALPHA_ATLAS_SIZE * 4);
	for (let a = 3; a < alpha.length; a += 4) alpha[a] = 255;
	tex.chunks.forEach((tc, id) => {
		const cx = id % CHUNKS_PER_TILE;
		const cy = Math.floor(id / CHUNKS_PER_TILE);
		tc.alpha.slice(0, 3).forEach((map, layer) => {
			for (let y = 0; y < ALPHA_SIZE; y++) {
				const row = ((cy * ALPHA_SIZE + y) * ALPHA_ATLAS_SIZE + cx * ALPHA_SIZE) * 4 + layer;
				for (let x = 0; x < ALPHA_SIZE; x++) alpha[row + x * 4] = map[y * ALPHA_SIZE + x];
			}
		});
	});

	const textures = new Set<number>();
	for (const g of groups) for (const l of g.layers) {
		if (l.diffuse) textures.add(l.diffuse);
		if (l.height) textures.add(l.height);
	}
	return {
		geometry: { positions, normals, uvs, colors, chunks: chunkIds, indices: new Uint32Array(indices) },
		groups,
		alpha,
		textures: [...textures],
		heights: grids.outer,
	};
}
