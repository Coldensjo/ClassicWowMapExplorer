import { expect, test } from 'bun:test';
import { buildTerrainMesh } from '../src/explorer/terrainMesh';

/** A flat n x n-cell grid at the given height. */
function flat(n: number, height: number) {
	return { outer: new Float32Array((n + 1) * (n + 1)).fill(height), inner: new Float32Array(n * n).fill(height) };
}

test('four triangles per cell, none for holes, and a two-sided skirt round the edge', () => {
	const n = 2;
	const { outer, inner } = flat(n, 5);
	const holes = Uint8Array.from([1, 0, 0, 0]);
	const mesh = buildTerrainMesh(outer, inner, n, 10, holes, 3);
	const perimeter = 4 * n;
	expect(mesh.indices.length).toBe((3 + perimeter) * 12);
	// The hole's centre vertex (outer grid first, then cell centres) is never used.
	const holeCentre = (n + 1) * (n + 1);
	expect([...mesh.indices].includes(holeCentre)).toBe(false);
	// The first cell drawn is the one after the hole, fanned round its centre.
	const tl = 1, tr = 2, bl = 4, br = 5, c = holeCentre + 1;
	expect([...mesh.indices.subarray(0, 12)]).toEqual([tl, c, tr, tr, c, br, br, c, bl, bl, c, tl]);
	// Skirt vertices hang skirtDepth below the edge.
	const skirtStart = (n + 1) * (n + 1) + n * n;
	expect(mesh.positions[skirtStart * 3 + 1]).toBe(2);
	expect(mesh.skirt[skirtStart]).toBe(3);
});

test('a flat grid has upward normals everywhere', () => {
	const mesh = buildTerrainMesh(flat(3, 0).outer, flat(3, 0).inner, 3, 9);
	for (let i = 0; i < mesh.normals.length; i += 3) expect([mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]).toEqual([0, 1, 0]);
});
