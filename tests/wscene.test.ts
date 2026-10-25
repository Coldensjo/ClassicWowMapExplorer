import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { CHUNK_SIZE, TILE_SIZE } from '../src/formats/adt';
import { SceneModel } from '../src/scene/sceneModel';
import { decodeScene, encodeScene } from '../src/scene/wscene';

const CLIENT = { product: 'wow_classic_beta', build: 'WOW-70450patch1.60.1_ForeverBeta' };

function blank(tilesX = 2, tilesY = 2): SceneModel {
	return SceneModel.blank({ name: 'Test scene', tilesX, tilesY, baseTexture: 187138, client: CLIENT });
}

test('a blank scene is flat tiles of one base texture', () => {
	const scene = blank(2, 3);
	expect(scene.tiles.length).toBe(6);
	expect(scene.tiles[5]).toMatchObject({ x: 1, y: 2 });
	expect(scene.textures).toEqual([187138]);
	for (const tile of scene.tiles) {
		expect(tile.chunks.length).toBe(256);
		for (const chunk of tile.chunks) {
			expect(chunk.layers).toEqual([{ texture: 0 }]);
			expect(chunk.alpha).toBeNull();
			expect(chunk.heights.every((h) => h === 0)).toBe(true);
		}
	}
	expect(scene.meta.spawn.position).toEqual([TILE_SIZE, 0, 1.5 * TILE_SIZE]);
	expect(scene.heightAt(TILE_SIZE, TILE_SIZE)).toBe(0);
});

test('blank scenes are 1x1 to 3x3 tiles', () => {
	expect(() => blank(0, 1)).toThrow();
	expect(() => blank(4, 2)).toThrow();
	expect(() => blank(3, 3)).not.toThrow();
});

test('heightAt matches the mesh triangles and respects holes', () => {
	const scene = blank(1, 1);
	const chunk = scene.tiles[0].chunks[0];
	// Raise one outer vertex (row 0, col 1) and the first cell's centre vertex.
	chunk.heights[1] = 8;
	chunk.heights[9] = 2;
	const cell = CHUNK_SIZE / 8;
	// On the raised vertex exactly, and at the centre of the first cell.
	expect(scene.heightAt(cell, 0)).toBeCloseTo(8, 4);
	expect(scene.heightAt(cell / 2, cell / 2)).toBeCloseTo(2, 4);
	// North triangle of the first cell: between vertices 0 (h=0) and 1 (h=8).
	expect(scene.heightAt(cell / 2, 0)).toBeCloseTo(4, 4);
	// A hole in the second cell's row drops the query.
	chunk.holes[2] = 0b0000_0100;
	expect(scene.heightAt(2.5 * cell, 2.5 * cell)).toBeNull();
	expect(scene.heightAt(1.5 * cell, 2.5 * cell)).not.toBeNull();
	// Outside the scene.
	expect(scene.heightAt(-1, 0)).toBeNull();
	expect(scene.heightAt(0, TILE_SIZE + 1)).toBeNull();
});

test('a scene round-trips through .wscene identically', () => {
	const scene = blank(2, 2);
	// Make the data non-trivial: heights, a second layer with alpha, shading, holes and water.
	const chunk = scene.tiles[1].chunks[17];
	chunk.heights.forEach((_, i) => (chunk.heights[i] = Math.sin(i) * 25));
	chunk.layers = [{ texture: 0 }, { texture: 1, effectId: 71 }];
	chunk.alpha = new Uint8Array(64 * 64).map((_, i) => i % 256);
	chunk.vertexShade = new Uint8Array(145 * 4).fill(0x7f);
	chunk.holes[3] = 0b1010_0001;
	chunk.water = { kind: 1, height: 12.5, coverage: new Uint8Array(8).fill(0xff) };
	scene.textures.push(190086);
	scene.objects.push({ id: crypto.randomUUID(), kind: 'm2', fdid: 7549691, position: [10, 0, 20], rotation: [0, 45, 0], scale: 1.25 });
	scene.npcs.push({ id: crypto.randomUUID(), appearance: { kind: 'creature', displayId: 1141 }, position: [5, 0, 5], facing: 90, scale: 1, animation: 'idle' });

	const thumbnail = new Uint8Array([1, 2, 3, 4]);
	const bytes = encodeScene(scene, thumbnail);
	const { model: loaded, thumbnail: loadedThumb } = decodeScene(bytes);

	expect(loaded.meta).toEqual(scene.meta);
	expect(loaded.textures).toEqual(scene.textures);
	expect(loaded.objects).toEqual(scene.objects);
	expect(loaded.npcs).toEqual(scene.npcs);
	expect(loadedThumb).toEqual(thumbnail);
	expect(loaded.tiles.length).toBe(4);
	for (let t = 0; t < 4; t++) {
		for (let i = 0; i < 256; i++) {
			const a = scene.tiles[t].chunks[i];
			const b = loaded.tiles[t].chunks[i];
			expect(b.heights).toEqual(a.heights);
			expect(b.vertexShade).toEqual(a.vertexShade);
			expect(b.layers).toEqual(a.layers);
			expect(b.alpha).toEqual(a.alpha);
			expect(b.holes).toEqual(a.holes);
			expect(b.water).toEqual(a.water);
		}
	}
	// And a re-export of the loaded scene is byte-identical data.
	expect(decodeScene(encodeScene(loaded, thumbnail)).model.tiles[1].chunks[17]).toEqual(loaded.tiles[1].chunks[17]);
});

test('a blank 1x1 scene stays within the size target', () => {
	const bytes = encodeScene(blank(1, 1));
	// Spec 6.2: at most 1.5 MB compressed for a blank 1x1 tile scene.
	expect(bytes.length).toBeLessThan(1.5 * 1024 * 1024);
});

/** The round-trip bytes with one container entry replaced (or added). */
function repack(bytes: Uint8Array, name: string, content: Uint8Array | null): Uint8Array {
	const files = unzipSync(bytes);
	if (content) files[name] = content as Uint8Array<ArrayBuffer>;
	else delete files[name];
	return zipSync(files);
}

test('the container is strict: unknown files are refused', () => {
	const bytes = encodeScene(blank(1, 1));
	expect(() => decodeScene(repack(bytes, 'extra.exe', new Uint8Array([1])))).toThrow(/extra\.exe/);
	expect(() => decodeScene(repack(bytes, 'scene.json', null))).toThrow(/scene\.json/);
	expect(() => decodeScene(strToU8('not a zip'))).toThrow(/wscene/);
});

test('a newer format version refuses to load with a clear message', () => {
	const bytes = encodeScene(blank(1, 1));
	const files = unzipSync(bytes);
	const scene = JSON.parse(strFromU8(files['scene.json']));
	scene.version = 99;
	expect(() => decodeScene(repack(bytes, 'scene.json', strToU8(JSON.stringify(scene))))).toThrow(/newer version/);
});

test('version 1 scenes migrate: base, player and NPCs gain their defaults', () => {
	const bytes = encodeScene(blank(1, 1));
	const files = unzipSync(bytes);
	const scene = JSON.parse(strFromU8(files['scene.json']));
	scene.version = 1;
	delete scene.base;
	delete scene.player;
	delete scene.npcPresets;
	delete scene.npcs;
	const { model } = decodeScene(repack(bytes, 'scene.json', strToU8(JSON.stringify(scene))));
	expect(model.meta.base).toBeNull();
	expect(model.meta.player).toBeNull();
	expect(model.npcPresets).toEqual([]);
	expect(model.npcs).toEqual([]);
});

test('bad data is refused: ranges, layers, palette and hole masks', () => {
	const good = encodeScene(blank(1, 1));
	const tamper = (edit: (scene: any) => void): Uint8Array => {
		const files = unzipSync(good);
		const scene = JSON.parse(strFromU8(files['scene.json']));
		edit(scene);
		return repack(good, 'scene.json', strToU8(JSON.stringify(scene)));
	};
	// A height ref past the end of heights.bin.
	expect(() => decodeScene(tamper((s) => (s.tiles[0].chunks[0].heights.offset = 10e6)))).toThrow(/bad range/);
	// Five texture layers.
	expect(() => decodeScene(tamper((s) => (s.tiles[0].chunks[0].layers = [{ texture: 0 }, { texture: 0 }, { texture: 0 }, { texture: 0 }, { texture: 0 }])))).toThrow(/layers/);
	// A layer pointing outside the texture palette.
	expect(() => decodeScene(tamper((s) => (s.tiles[0].chunks[0].layers = [{ texture: 3 }])))).toThrow(/palette/);
	// A malformed hole mask.
	expect(() => decodeScene(tamper((s) => (s.tiles[0].chunks[0].holes = 'xyz')))).toThrow(/hole mask/);
	// A second layer without an alpha map.
	expect(() => decodeScene(tamper((s) => (s.tiles[0].chunks[0].layers = [{ texture: 0 }, { texture: 0 }])))).toThrow(/alpha/);
});

test('tileRenderData shapes a tile like parsed ADT data', () => {
	const scene = blank(1, 1);
	const chunk = scene.tiles[0].chunks[20];
	chunk.layers = [{ texture: 0 }, { texture: 0, effectId: 5 }];
	chunk.alpha = new Uint8Array(64 * 64).fill(128);
	const { root, tex } = scene.tileRenderData(scene.tiles[0]);
	expect(root.chunks.length).toBe(256);
	expect(root.chunks[20]).toMatchObject({ indexX: 4, indexY: 1 });
	expect(root.chunks[20].heights).toBe(chunk.heights);
	expect(tex.diffuse).toEqual([187138]);
	expect(tex.chunks[20].layers).toEqual([
		{ texture: 0, flags: 0, effect: 0 },
		{ texture: 0, flags: 0, effect: 5 },
	]);
	expect(tex.chunks[20].alpha.length).toBe(1);
	expect(tex.chunks[20].alpha[0][0]).toBe(128);
});

test('NPCs and their presets round-trip, unused presets are dropped, and bad NPCs are refused', () => {
	const scene = blank(1, 1);
	const worn = { id: 'preset-1', name: 'Guard', race: 1, sex: 0 as const, customization: { '9': 1, '11': 44 }, equipment: { head: 14964, chest: 7223 } };
	const spare = { ...worn, id: 'preset-2', name: 'Spare' };
	scene.setPreset(worn);
	scene.setPreset(spare);
	scene.npcs.push({ id: 'npc-1', appearance: { kind: 'custom', presetId: 'preset-1' }, name: 'Thomas', subName: '<Guard>', position: [3, 0, 4], facing: 90, scale: 1.1, animation: 'idle', group: 'gate' });
	scene.npcs.push({ id: 'npc-2', appearance: { kind: 'creature', displayId: 31 }, position: [6, 0, 4], facing: 0, scale: 1, animation: 'idle' });
	const loaded = decodeScene(encodeScene(scene)).model;
	// Only the preset an NPC wears travels with the scene (spec 6.6).
	expect(loaded.npcPresets.map((p) => p.id)).toEqual(['preset-1']);
	expect(loaded.npcPresets[0]).toEqual(worn);
	expect(loaded.npcs).toEqual(scene.npcs);

	const tamper = (edit: (json: { npcs: unknown[]; npcPresets: unknown[] }) => void) => {
		const files = unzipSync(encodeScene(scene));
		const json = JSON.parse(strFromU8(files['scene.json']));
		edit(json);
		files['scene.json'] = strToU8(JSON.stringify(json)) as Uint8Array<ArrayBuffer>;
		return zipSync(files);
	};
	// A custom NPC must wear a preset embedded in the scene; a creature needs a display id.
	expect(() => decodeScene(tamper((j) => ((j.npcs[0] as { appearance: unknown }).appearance = { kind: 'custom', presetId: 'nowhere' })))).toThrow(/appearance/);
	expect(() => decodeScene(tamper((j) => ((j.npcs[1] as { appearance: unknown }).appearance = { kind: 'creature', displayId: -3 })))).toThrow(/appearance/);
	expect(() => decodeScene(tamper((j) => ((j.npcs[1] as { scale: number }).scale = 0)))).toThrow(/scale/);
	expect(() => decodeScene(tamper((j) => ((j.npcPresets[0] as { equipment: unknown }).equipment = { hat: 1 })))).toThrow(/slot/);
});
