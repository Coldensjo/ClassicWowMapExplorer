/**
 * Terrain mesh arrays in tile-local space: x east, y up, z south, origin at the tile's
 * north-west corner. Matches the minimap/map-texture image layout, so uv = (x, z) / size.
 */
export interface TerrainGeometry {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
}

/**
 * Builds WoW's terrain layout: an (n+1)^2 outer grid with an n^2 inner grid at cell centres,
 * four triangles per cell fanned around the centre. A skirt hangs from the edges to hide
 * cracks where neighbouring tiles use a different level of detail.
 */
export function buildTerrainMesh(
	outer: Float32Array,
	inner: Float32Array,
	n: number,
	size: number,
	holes: Uint8Array | null = null,
	skirtDepth = 40,
): TerrainGeometry {
	const outerCount = (n + 1) * (n + 1);
	const innerCount = n * n;
	const perimeter = 4 * n;
	const vertexCount = outerCount + innerCount + perimeter;
	const positions = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const cell = size / n;

	const setVertex = (i: number, x: number, y: number, z: number) => {
		positions[i * 3] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = z;
		uvs[i * 2] = x / size;
		uvs[i * 2 + 1] = z / size;
	};
	for (let row = 0; row <= n; row++) {
		for (let col = 0; col <= n; col++) setVertex(row * (n + 1) + col, col * cell, outer[row * (n + 1) + col], row * cell);
	}
	for (let row = 0; row < n; row++) {
		for (let col = 0; col < n; col++) setVertex(outerCount + row * n + col, (col + 0.5) * cell, inner[row * n + col], (row + 0.5) * cell);
	}

	// Perimeter of the outer grid, clockwise from the north-west corner.
	const ring: number[] = [];
	for (let col = 0; col < n; col++) ring.push(col);
	for (let row = 0; row < n; row++) ring.push(row * (n + 1) + n);
	for (let col = n; col > 0; col--) ring.push(n * (n + 1) + col);
	for (let row = n; row > 0; row--) ring.push(row * (n + 1));
	const skirtStart = outerCount + innerCount;
	ring.forEach((v, k) => {
		setVertex(skirtStart + k, positions[v * 3], positions[v * 3 + 1] - skirtDepth, positions[v * 3 + 2]);
	});

	const indices: number[] = [];
	for (let row = 0; row < n; row++) {
		for (let col = 0; col < n; col++) {
			if (holes?.[row * n + col]) continue;
			const tl = row * (n + 1) + col;
			const tr = tl + 1;
			const bl = tl + n + 1;
			const br = bl + 1;
			const c = outerCount + row * n + col;
			// Counter-clockwise seen from above.
			indices.push(tl, c, tr, tr, c, br, br, c, bl, bl, c, tl);
		}
	}
	for (let k = 0; k < perimeter; k++) {
		const a = ring[k];
		const b = ring[(k + 1) % perimeter];
		const sa = skirtStart + k;
		const sb = skirtStart + ((k + 1) % perimeter);
		// Both windings, so the skirt is visible from either side.
		indices.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
	}

	const index = new Uint32Array(indices);
	return { positions, normals: computeNormals(positions, index, outerCount + innerCount), uvs, indices: index };
}

/** Area-weighted vertex normals from the surface triangles; skirt vertices copy their top vertex. */
function computeNormals(positions: Float32Array, indices: Uint32Array, surfaceCount: number): Float32Array {
	const normals = new Float32Array(positions.length);
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t] * 3;
		const b = indices[t + 1] * 3;
		const c = indices[t + 2] * 3;
		if (a >= surfaceCount * 3 || b >= surfaceCount * 3 || c >= surfaceCount * 3) continue;
		const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
		const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
		const nx = aby * acz - abz * acy;
		const ny = abz * acx - abx * acz;
		const nz = abx * acy - aby * acx;
		for (const v of [a, b, c]) {
			normals[v] += nx;
			normals[v + 1] += ny;
			normals[v + 2] += nz;
		}
	}
	for (let i = 0; i < surfaceCount; i++) {
		const o = i * 3;
		const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
		normals[o] /= len;
		normals[o + 1] /= len;
		normals[o + 2] /= len;
	}
	// Skirts point straight up so they shade like the surface edge rather than going dark.
	for (let i = surfaceCount; i < positions.length / 3; i++) normals[i * 3 + 1] = 1;
	return normals;
}
