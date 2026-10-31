import { describe, expect, test } from 'bun:test';
import { TILE_SIZE } from '../src/formats/adt';
import { growBlankScene } from '../src/scene/resizeScene';
import { SceneModel } from '../src/scene/sceneModel';

const client = { product: 'test', build: '1' };

function blank(tilesX = 1, tilesY = 1): SceneModel {
	return SceneModel.blank({ name: 'test', tilesX, tilesY, baseTexture: 187138, client });
}

describe('growBlankScene', () => {
	test('adds flat tiles that paint the base layer and keeps the old tiles in place', () => {
		const model = blank();
		model.tiles[0].chunks[0].layers[0].effectId = 42;
		model.tiles[0].chunks[5].heights[3] = 9;
		growBlankScene(model, { tilesX: 2, tilesY: 1, offsetX: 0, offsetY: 0 });
		expect(model.meta.size).toEqual({ tilesX: 2, tilesY: 1 });
		expect(model.tiles.length).toBe(2);
		expect(model.tiles.map((t) => [t.x, t.y])).toEqual([
			[0, 0],
			[1, 0],
		]);
		expect(model.tiles[0].chunks[5].heights[3]).toBe(9);
		expect(model.tiles[1].chunks[0].layers).toEqual([{ texture: 0, effectId: 42 }]);
		expect(model.tiles[1].chunks[7].heights.every((h) => h === 0)).toBe(true);
	});

	test('shifts the old tiles, the spawn and everything placed when tiles come before them', () => {
		const model = blank();
		model.objects.push({ id: 'o', kind: 'm2', fdid: 1, position: [10, 0, 20], rotation: [0, 0, 0], scale: 1 } as never);
		model.npcs.push({ id: 'n', preset: 'p', position: [30, 0, 40], yaw: 0 } as never);
		const spawn = [...model.meta.spawn.position];
		growBlankScene(model, { tilesX: 2, tilesY: 2, offsetX: 1, offsetY: 1 });
		expect(model.tiles.map((t) => [t.x, t.y])).toEqual([
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		]);
		expect(model.objects[0].position).toEqual([10 + TILE_SIZE, 0, 20 + TILE_SIZE]);
		expect(model.npcs[0].position).toEqual([30 + TILE_SIZE, 0, 40 + TILE_SIZE]);
		expect(model.meta.spawn.position).toEqual([spawn[0] + TILE_SIZE, spawn[1], spawn[2] + TILE_SIZE]);
	});

	test('gives a new tile the heights of the edge it shares with an old one', () => {
		const model = blank();
		// Raise the whole east edge of the single tile.
		for (let gz = 0; gz <= model.cellsZ; gz++) model.setOuterHeight(model.cellsX, gz, 7);
		growBlankScene(model, { tilesX: 2, tilesY: 1, offsetX: 0, offsetY: 0 });
		// The lattice reads the east tile's copy of the shared column; it must match.
		for (let gz = 0; gz <= model.cellsZ; gz += 5) expect(model.outerHeight(128, gz)).toBe(7);
		// One cell further east the new tile is flat.
		expect(model.outerHeight(129, 10)).toBe(0);
		// Tiles added to the north take the old top edge too.
		const north = blank();
		for (let gx = 0; gx <= north.cellsX; gx++) north.setOuterHeight(gx, 0, 3);
		growBlankScene(north, { tilesX: 1, tilesY: 2, offsetX: 0, offsetY: 1 });
		// The old tile is now the south one; the lattice reads the north tile's bottom row at gz = 128.
		expect(north.outerHeight(64, 128)).toBe(3);
		expect(north.tiles[0].chunks[255].heights[8 * 17 + 8]).toBe(3);
	});

	test('refuses to shrink, to leave the limit, or to grow a copied scene', () => {
		expect(() => growBlankScene(blank(2, 2), { tilesX: 1, tilesY: 1, offsetX: 0, offsetY: 0 })).toThrow();
		expect(() => growBlankScene(blank(), { tilesX: 4, tilesY: 1, offsetX: 0, offsetY: 0 })).toThrow();
		expect(() => growBlankScene(blank(), { tilesX: 2, tilesY: 1, offsetX: 2, offsetY: 0 })).toThrow();
		const copied = blank();
		copied.meta.base = { mapId: 1, mapDirectory: 'x', tileMin: [0, 0], tileMax: [0, 0], build: '1', includeDoodads: true, includeWmos: true, removedObjects: [] };
		expect(() => growBlankScene(copied, { tilesX: 2, tilesY: 1, offsetX: 0, offsetY: 0 })).toThrow();
	});
});
