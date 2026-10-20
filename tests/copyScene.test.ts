import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import type { CopyTile } from '../src/explorer/copyWorld';
import { TILE_SIZE } from '../src/formats/adt';
import { createCopiedScene, derivedWater, FALLBACK_TEXTURE } from '../src/scene/copyScene';
import { decodeScene, encodeScene } from '../src/scene/wscene';
import type { PlacedObject, Scene } from '../src/scene/types';

const CLIENT = { product: 'wow_classic_beta', build: 'WOW-70450patch1.60.1_ForeverBeta' };
const MAP = { id: 0, directory: 'Azeroth' };

/** A deterministic fake source tile at map tile (x, y), with layers, water and placements. */
function fakeTile(x: number, y: number): CopyTile {
	const chunks = Array.from({ length: 256 }, (_, i) => ({
		heights: new Float32Array(145).map((_, j) => Math.fround(Math.sin(i * 7 + j) * 20)),
		shade: i === 5 ? new Uint8Array(145 * 4).map((_, j) => (j * 3) % 256) : null,
		layers: [
			{ fdid: 111, effect: 0 },
			{ fdid: 222, effect: 7 },
		],
		alpha: new Uint8Array(64 * 64).map((_, j) => (i + j) % 256),
		holes: new Uint8Array(8).fill(i === 9 ? 0b1100 : 0),
	}));
	return {
		x,
		y,
		exists: true,
		chunks,
		// A non-flat lake over part of chunk 3: 4x3 cells from (2, 1), one cell missing.
		liquids: [{
			chunk: 3,
			type: 1,
			minHeight: 10,
			maxHeight: 12,
			x: 2,
			y: 1,
			width: 4,
			height: 3,
			exists: new Uint8Array(12).fill(1).map((v, i) => (i === 5 ? 0 : v)),
			heights: new Float32Array(20).map((_, i) => 10 + (i % 5) / 2),
		}],
		placements: [
			// Inside the tile.
			{ kind: 'm2', uid: 100 + x, fdid: 5000, position: [x * TILE_SIZE + 10, 30, y * TILE_SIZE + 20], rotation: [0, 45, 0], scale: 1.5, doodadSet: 0, nameSet: 0 },
			{ kind: 'wmo', uid: 7, fdid: 6000, position: [x * TILE_SIZE + 100, 25, y * TILE_SIZE + 200], rotation: [0, 90, 0], scale: 1, doodadSet: 1, nameSet: 2 },
			// Origin outside every copied tile: not copied (spec 6.5), even if it overlaps.
			{ kind: 'wmo', uid: 999, fdid: 6001, position: [-50, 0, -50], rotation: [0, 0, 0], scale: 1, doodadSet: 0, nameSet: 0 },
		],
	};
}

/** A 2x1 copy of fake tiles (30, 48)-(31, 48); both tiles list the same WMO (uid 7). */
function makeScene() {
	// The fake placements already sit inside their own tiles, so inside the rectangle.
	const copyTiles = [fakeTile(30, 48), fakeTile(31, 48)];
	const model = createCopiedScene(
		{ name: 'Copy test', client: CLIENT, map: MAP, tileMin: [30, 48], tileMax: [31, 48], includeDoodads: true, includeWmos: true },
		copyTiles,
	);
	return { model, copyTiles };
}

function sceneJson(bytes: Uint8Array): Scene {
	return JSON.parse(strFromU8(unzipSync(bytes)['scene.json'])) as Scene;
}

test('derivedWater keeps the source footprint and flattens the surface', () => {
	const tile = fakeTile(30, 48);
	const water = derivedWater(tile.liquids, 3)!;
	expect(water.kind).toBe(1);
	expect(water.height).toBe(12);
	// Rows 1-3 carry cells 2-5, except the one the existence mask drops (row 2, col 3).
	expect(water.coverage[0]).toBe(0);
	expect(water.coverage[1]).toBe(0b0011_1100);
	expect(water.coverage[2]).toBe(0b0011_0100);
	expect(water.coverage[3]).toBe(0b0011_1100);
	expect(derivedWater(tile.liquids, 4)).toBeNull();
});

test('a copied scene starts as the base: palette, chunks, objects', () => {
	const { model } = makeScene();
	expect(model.meta.base).toMatchObject({ mapId: 0, mapDirectory: 'Azeroth', tileMin: [30, 48], tileMax: [31, 48], build: CLIENT.build, removedObjects: [] });
	expect(model.textures).toEqual([111, 222]);
	expect(model.tiles.length).toBe(2);
	expect(model.tiles[1]).toMatchObject({ x: 1, y: 0 });
	const chunk = model.tiles[0].chunks[5];
	expect(chunk.layers).toEqual([{ texture: 0 }, { texture: 1, effectId: 7 }]);
	expect(chunk.vertexShade).not.toBeNull();
	expect(chunk.heights).toEqual(model.baseData!.tiles[0].chunks[5].heights);
	expect(chunk.heights).not.toBe(model.baseData!.tiles[0].chunks[5].heights);
	// The two tiles list the WMO once each; it is copied once (spec 6.5 de-duplication).
	const wmos = model.objects.filter((o) => o.kind === 'wmo');
	expect(wmos.length).toBe(1);
	expect(wmos[0]).toMatchObject({ baseKey: 'wmo:7', fdid: 6000, doodadSet: 1, nameSet: 2, scale: 1 });
	// The outside-origin WMO was not copied; the two doodads (distinct uids) were.
	expect(model.objects.filter((o) => o.kind === 'm2').map((o) => o.baseKey).sort()).toEqual(['m2:130', 'm2:131']);
	// The WMO's scene-space position is its placement position shifted by the rectangle corner.
	expect(wmos[0].position).toEqual([100, 25, 200]);
});

test('an unedited copied scene saves no chunks, no objects and no removals', () => {
	const { model, copyTiles } = makeScene();
	const bytes = encodeScene(model);
	const scene = sceneJson(bytes);
	expect(scene.tiles.every((t) => t.chunks === null && !t.overrides)).toBe(true);
	expect(scene.objects).toEqual([]);
	expect(scene.base!.removedObjects).toEqual([]);
	// Small: only scene.json and empty bins.
	expect(bytes.length).toBeLessThan(64 * 1024);

	const { model: loaded, missingObjects } = decodeScene(bytes, copyTiles);
	expect(missingObjects).toBe(0);
	expect(loaded.textures).toEqual(model.textures);
	for (let t = 0; t < 2; t++) {
		for (let i = 0; i < 256; i++) {
			expect(loaded.tiles[t].chunks[i]).toEqual(model.tiles[t].chunks[i]);
		}
	}
	// Base objects materialize again (fresh ids, same placements).
	const strip = (o: PlacedObject) => ({ ...o, id: '' });
	const byKey = (a: { baseKey?: string }, b: { baseKey?: string }) => (a.baseKey ?? '').localeCompare(b.baseKey ?? '');
	expect(loaded.objects.map(strip).sort(byKey)).toEqual(model.objects.map(strip).sort(byKey));
});

test('edits save as overrides and reload identically; undone edits are swept', () => {
	const { model, copyTiles } = makeScene();
	// Sculpt chunk 5 of tile 1, paint chunk 8, cut holes in 9, flatten the water of 3, delete the
	// building and move one tree.
	const sculpted = model.tiles[1].chunks[5].heights.slice();
	sculpted[17] += 4;
	model.restoreHeights(1, 5, sculpted);
	model.restorePaint(1, 8, [{ texture: 0 }], null);
	const holes = model.tiles[1].chunks[9].holes.slice();
	holes[0] = 0xff;
	model.restoreHoles(1, 9, holes);
	model.restoreWater(0, 3, { kind: 2, height: 13, coverage: new Uint8Array(8).fill(0xf0) });
	// An edit undone by hand back to base bytes: touched, but swept at save time (spec 6.5).
	const untouched = model.tiles[0].chunks[2].heights.slice();
	model.restoreHeights(0, 2, untouched);
	const wmo = model.objects.find((o) => o.baseKey === 'wmo:7')!;
	model.removeObject(wmo.id);
	const tree = model.objects.find((o) => o.baseKey === 'm2:130')!;
	tree.position = [tree.position[0] + 5, tree.position[1], tree.position[2]];
	model.touchObjects();

	const bytes = encodeScene(model);
	const scene = sceneJson(bytes);
	expect(Object.keys(scene.tiles[0].overrides ?? {})).toEqual(['3']);
	expect(Object.keys(scene.tiles[1].overrides ?? {}).sort()).toEqual(['5', '8', '9']);
	expect(Object.keys(scene.tiles[1].overrides![5])).toEqual(['heights']);
	expect(Object.keys(scene.tiles[1].overrides![8]).sort()).toEqual(['alpha', 'layers']);
	expect(Object.keys(scene.tiles[1].overrides![9])).toEqual(['holes']);
	expect(Object.keys(scene.tiles[0].overrides![3])).toEqual(['water']);
	expect(scene.objects.length).toBe(1);
	expect(scene.objects[0]).toMatchObject({ baseKey: 'm2:130' });
	expect(scene.base!.removedObjects).toEqual(['wmo:7']);

	const { model: loaded } = decodeScene(bytes, copyTiles);
	expect(loaded.tiles[1].chunks[5].heights).toEqual(sculpted);
	expect(loaded.tiles[1].chunks[8].layers).toEqual([{ texture: 0 }]);
	expect(loaded.tiles[1].chunks[8].alpha).toBeNull();
	expect(loaded.tiles[1].chunks[9].holes).toEqual(holes);
	expect(loaded.tiles[0].chunks[3].water).toEqual({ kind: 2, height: 13, coverage: new Uint8Array(8).fill(0xf0) });
	// Unedited chunks come back as base.
	expect(loaded.tiles[0].chunks[2].heights).toEqual(model.baseData!.tiles[0].chunks[2].heights);
	expect(loaded.objects.find((o) => o.baseKey === 'wmo:7')).toBeUndefined();
	const loadedTree = loaded.objects.find((o) => o.baseKey === 'm2:130')!;
	expect(loadedTree.id).toBe(tree.id);
	expect(loadedTree.position).toEqual(tree.position);

	// A re-save of the loaded scene keeps the same diffs (the loaded overrides stay touched).
	const again = sceneJson(encodeScene(loaded));
	expect(Object.keys(again.tiles[1].overrides ?? {}).sort()).toEqual(['5', '8', '9']);
	expect(again.base!.removedObjects).toEqual(['wmo:7']);
	expect(again.objects.length).toBe(1);
});

test('water edited back to the derived base form is swept', () => {
	const { model } = makeScene();
	const base = model.baseData!.tiles[0].chunks[3].water!;
	model.restoreWater(0, 3, { kind: 4, height: 50, coverage: new Uint8Array(8).fill(0xff) });
	model.restoreWater(0, 3, { kind: base.kind, height: base.height, coverage: base.coverage.slice() });
	const scene = sceneJson(encodeScene(model));
	expect(scene.tiles[0].overrides).toBeUndefined();
});

test('a stored edit whose base object vanished is dropped and counted', () => {
	const { model, copyTiles } = makeScene();
	const tree = model.objects.find((o) => o.baseKey === 'm2:130')!;
	tree.position = [1, 2, 3];
	const bytes = encodeScene(model);
	// The source lost that doodad since the copy was made.
	const changed = copyTiles.map((t) => ({ ...t, placements: t.placements.filter((p) => p.uid !== 130) }));
	const { model: loaded, missingObjects } = decodeScene(bytes, changed);
	expect(missingObjects).toBe(1);
	expect(loaded.objects.find((o) => o.baseKey === 'm2:130')).toBeUndefined();
});

test('tiles the map does not have become void', () => {
	const copyTiles: CopyTile[] = [fakeTile(30, 48), { x: 31, y: 48, exists: false, chunks: null, liquids: [], placements: [] }];
	const model = createCopiedScene(
		{ name: 'Edge copy', client: CLIENT, map: MAP, tileMin: [30, 48], tileMax: [31, 48], includeDoodads: true, includeWmos: true },
		copyTiles,
	);
	expect(model.tiles[1].chunks.every((c) => c.holes.every((b) => b === 0xff))).toBe(true);
	expect(model.heightAt(1.5 * TILE_SIZE, 0.5 * TILE_SIZE)).toBeNull();
	expect(model.textures).toContain(FALLBACK_TEXTURE);
});

test('the include options leave that kind of object out', () => {
	const copyTiles = [fakeTile(30, 48), fakeTile(31, 48)];
	const model = createCopiedScene(
		{ name: 'No trees', client: CLIENT, map: MAP, tileMin: [30, 48], tileMax: [31, 48], includeDoodads: false, includeWmos: true },
		copyTiles,
	);
	expect(model.objects.every((o) => o.kind === 'wmo')).toBe(true);
	expect(model.objects.length).toBe(1);
});

test('a copied scene refuses to decode without its source tiles', () => {
	const { model } = makeScene();
	const bytes = encodeScene(model);
	expect(() => decodeScene(bytes)).toThrow(/source tiles/);
	expect(() => decodeScene(bytes, [fakeTile(30, 48)])).toThrow(/2 tiles/);
});
