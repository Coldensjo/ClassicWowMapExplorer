import { expect, test } from 'bun:test';
import { identity } from '../src/explorer/mat4';
import { parseWeapons, spawnMatrix, tileOf } from '../src/explorer/spawns';
import { CHUNKS_PER_TILE, CHUNK_SIZE, TILE_SIZE } from '../src/formats/adt';

const MAP_ORIGIN = 32 * TILE_SIZE;

test('tile and chunk sizes match the WoW map grid', () => {
	expect(TILE_SIZE).toBeCloseTo(533.3333, 3);
	expect(CHUNK_SIZE * CHUNKS_PER_TILE).toBeCloseTo(TILE_SIZE, 9);
	expect(CHUNK_SIZE).toBeCloseTo(33.3333, 3);
});

test('tileOf puts the map centre on tile 32,32', () => {
	expect(tileOf(0, 0)).toEqual({ tx: 32, ty: 32 });
});

// World x runs north and y west, while tiles count from the north-west corner, so
// tx follows y and ty follows x, each reversed.
test('tileOf reverses and swaps axes', () => {
	expect(tileOf(0, TILE_SIZE).tx).toBe(31); // one tile west
	expect(tileOf(0, -TILE_SIZE).tx).toBe(33); // one tile east
	expect(tileOf(TILE_SIZE, 0).ty).toBe(31); // one tile north
	expect(tileOf(-TILE_SIZE, 0).ty).toBe(33); // one tile south
});

test('tileOf covers the whole map and floors inside a tile', () => {
	expect(tileOf(MAP_ORIGIN - 1, -MAP_ORIGIN + 1)).toEqual({ tx: 63, ty: 0 });
	expect(tileOf(-MAP_ORIGIN + 1, MAP_ORIGIN - 1)).toEqual({ tx: 0, ty: 63 });
	expect(tileOf(-1, -1)).toEqual({ tx: 32, ty: 32 });
	expect(tileOf(1, 1)).toEqual({ tx: 31, ty: 31 });
});

test('spawnMatrix maps world x,y,z to render X = origin - y, Y = z, Z = origin - x', () => {
	const m = spawnMatrix(100, 200, 30, identity(), 1);
	expect(m[12]).toBeCloseTo(MAP_ORIGIN - 200, 1);
	expect(m[13]).toBeCloseTo(30, 5);
	expect(m[14]).toBeCloseTo(MAP_ORIGIN - 100, 1);
});

test('spawnMatrix agrees with tileOf about which tile a spawn is in', () => {
	const x = 1234.5, y = -987.25;
	const m = spawnMatrix(x, y, 0, identity(), 1);
	const { tx, ty } = tileOf(x, y);
	// Render X spans tiles left to right and render Z top to bottom, one tile per TILE_SIZE.
	expect(Math.floor(m[12] / TILE_SIZE)).toBe(tx);
	expect(Math.floor(m[14] / TILE_SIZE)).toBe(ty);
});

test('spawnMatrix scales the model but not its position', () => {
	const unit = spawnMatrix(10, 20, 5, identity(), 1);
	const big = spawnMatrix(10, 20, 5, identity(), 2);
	expect([big[12], big[13], big[14]]).toEqual([unit[12], unit[13], unit[14]]);
	const length = (m: Float32Array) => Math.hypot(m[0], m[1], m[2]);
	expect(length(big)).toBeCloseTo(2 * length(unit), 5);
});

test('parseWeapons reads three underscore-separated ids', () => {
	expect(parseWeapons('1_2_0')).toEqual([1, 2, 0]);
	expect(parseWeapons(undefined)).toBeNull();
	expect(parseWeapons('1_2')).toBeNull();
	expect(parseWeapons('a_b_c')).toBeNull();
	expect(parseWeapons('1_2_3_4')).toBeNull();
});
