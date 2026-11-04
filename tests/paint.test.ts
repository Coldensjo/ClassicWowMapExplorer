import { describe, expect, test } from 'bun:test';
import { CHUNK_SIZE } from '../src/formats/adt';
import { PaintStroke, type PaintSettings } from '../src/editor/paint';
import { SceneModel } from '../src/scene/sceneModel';
import { decodeScene, encodeScene } from '../src/scene/wscene';

const client = { product: 'wow_classic_beta', build: 'test' };
const BASE = 187138;
const GRASS = 188990;
const DIRT = 187018;
const SNOW = 188576;
const SAND = 189020;

function blank(): SceneModel {
	return SceneModel.blank({ name: 'test', tilesX: 1, tilesY: 1, baseTexture: BASE, client });
}

function settings(overrides: Partial<PaintSettings> = {}): PaintSettings {
	return { fdid: GRASS, radius: 10, strength: 1, opacity: 1, mode: 'paint', policy: 'replace', swapFrom: 0, swapTo: 0, ...overrides };
}

/** Paint long enough to reach the target opacity. */
function paintAt(model: SceneModel, s: PaintSettings, x: number, z: number, seconds = 2): PaintStroke {
	const stroke = new PaintStroke(model, s);
	for (let i = 0; i < seconds * 20; i++) stroke.apply(x, z, 0.05);
	return stroke;
}

describe('texture painting', () => {
	test('painting a new texture adds a layer and reaches the target opacity', () => {
		const model = blank();
		const stroke = paintAt(model, settings(), 20, 20);
		const command = stroke.finish();
		expect(command).not.toBeNull();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.layers.length).toBe(2);
		expect(model.textures[chunk.layers[1].texture]).toBe(GRASS);
		// The texel at the brush centre should be driven to full alpha.
		const texel = Math.round(20 / (CHUNK_SIZE / 63));
		expect(chunk.alpha![texel * 64 + texel]).toBeGreaterThan(250);
	});

	test('painting keeps the layer sum within 255', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT, opacity: 0.6 }), 20, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.layers.length).toBe(3);
		for (let i = 0; i < 64 * 64; i++) {
			expect(chunk.alpha![i] + chunk.alpha![64 * 64 + i]).toBeLessThanOrEqual(256);
		}
		// The second coat shows at its opacity, the first was scaled down to make room.
		const texel = Math.round(20 / (CHUNK_SIZE / 63));
		const dirt = chunk.alpha![64 * 64 + texel * 64 + texel];
		expect(Math.abs(dirt - 153)).toBeLessThan(10);
	});

	test('a full chunk blocks a fifth texture and flags it', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT }), 25, 20).finish();
		paintAt(model, settings({ fdid: SNOW }), 20, 25).finish();
		expect(model.tiles[0].chunks[0].layers.length).toBe(4);
		const stroke = paintAt(model, settings({ fdid: SAND, policy: 'block' }), 22, 22, 0.2);
		expect(stroke.blocked.length).toBeGreaterThan(0);
		expect(model.tiles[0].chunks[0].layers.length).toBe(4);
		expect(model.tiles[0].chunks[0].layers.some((l) => model.textures[l.texture] === SAND)).toBe(false);
	});

	test('replace-weakest swaps out a barely used layer', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT }), 25, 20).finish();
		// A faint touch of snow, far from where sand will go.
		const faint = new PaintStroke(model, settings({ fdid: SNOW, opacity: 0.1, radius: 2 }));
		faint.apply(60, 60, 0.05);
		faint.finish();
		const stroke = paintAt(model, settings({ fdid: SAND, policy: 'replace' }), 20, 25);
		stroke.finish();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.layers.length).toBe(4);
		expect(chunk.layers.some((l) => model.textures[l.texture] === SAND)).toBe(true);
		expect(chunk.layers.some((l) => model.textures[l.texture] === SNOW)).toBe(false);
	});

	test('erase washes back to the base texture', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ mode: 'erase' }), 20, 20, 4).finish();
		const chunk = model.tiles[0].chunks[0];
		const texel = Math.round(20 / (CHUNK_SIZE / 63));
		expect(chunk.alpha![texel * 64 + texel]).toBeLessThan(5);
	});

	test('fill chunk covers every texel at the set opacity', () => {
		const model = blank();
		const stroke = new PaintStroke(model, settings({ mode: 'fill', opacity: 0.5 }));
		stroke.apply(20, 20, 0.05);
		stroke.apply(20, 20, 0.05); // A second pass must not double anything.
		stroke.finish();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.layers.length).toBe(2);
		for (let i = 0; i < 64 * 64; i++) expect(chunk.alpha![i]).toBe(128);
	});

	test('set base swaps layer 0 and keeps the paint on top', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS, opacity: 0.8 }), 20, 20).finish();
		const alphaBefore = model.tiles[0].chunks[0].alpha!.slice();
		const stroke = new PaintStroke(model, settings({ fdid: DIRT, mode: 'base' }));
		stroke.apply(20, 20, 0.05);
		const command = stroke.finish();
		expect(command).not.toBeNull();
		const chunk = model.tiles[0].chunks[0];
		expect(model.textures[chunk.layers[0].texture]).toBe(DIRT);
		expect(model.textures[chunk.layers[1].texture]).toBe(GRASS);
		expect([...chunk.alpha!]).toEqual([...alphaBefore]);
	});

	test('a paint stroke undoes exactly, including an added layer', () => {
		const model = blank();
		const chunkBefore = model.tiles[0].chunks[0];
		const layersBefore = chunkBefore.layers.map((l) => ({ ...l }));
		const stroke = paintAt(model, settings(), 20, 20);
		const command = stroke.finish()!;
		command.undo();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.layers).toEqual(layersBefore);
		expect(chunk.alpha).toBeNull();
		command.redo();
		expect(chunk.layers.length).toBe(2);
		expect(chunk.alpha).not.toBeNull();
	});

	test('painting the base texture itself erases the others', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: BASE }), 20, 20, 4).finish();
		const chunk = model.tiles[0].chunks[0];
		const texel = Math.round(20 / (CHUNK_SIZE / 63));
		expect(chunk.alpha![texel * 64 + texel]).toBeLessThan(5);
	});
});

/** One swap stroke at (x, z); `effectFor` is the ground-effect lookup the editor would pass. */
function swapAt(model: SceneModel, swapFrom: number, swapTo: number, x: number, z: number, effectFor?: (fdid: number) => number): PaintStroke {
	const stroke = new PaintStroke(model, settings({ mode: 'swap', swapFrom, swapTo }), effectFor);
	stroke.apply(x, z, 0.05);
	return stroke;
}

/** A chunk's layers as FileDataIDs. */
function fdids(model: SceneModel, chunk = model.tiles[0].chunks[0]): number[] {
	return chunk.layers.map((l) => model.textures[l.texture]);
}

/** Sets a texture as the chunk's base, which Set base allows even when it is painted too. */
function setBase(model: SceneModel, fdid: number, x: number, z: number): void {
	const stroke = new PaintStroke(model, settings({ fdid, mode: 'base' }));
	stroke.apply(x, z, 0.05);
	stroke.finish();
}

describe('texture swap', () => {
	test('a painted layer is repointed with its alpha untouched', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS, opacity: 0.8 }), 20, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		const alphaBefore = chunk.alpha!.slice();
		expect(swapAt(model, GRASS, DIRT, 20, 20).finish()).not.toBeNull();
		expect(fdids(model)).toEqual([BASE, DIRT]);
		expect([...chunk.alpha!]).toEqual([...alphaBefore]);
	});

	test('the base layer is repointed, the painted layers untouched', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		const alphaBefore = chunk.alpha!.slice();
		swapAt(model, BASE, DIRT, 20, 20).finish();
		expect(fdids(model)).toEqual([DIRT, GRASS]);
		expect([...chunk.alpha!]).toEqual([...alphaBefore]);
	});

	test('a chunk without the existing texture is left alone and the palette does not grow', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		const palette = model.textures.slice();
		expect(swapAt(model, SNOW, SAND, 20, 20).finish()).toBeNull();
		expect(fdids(model)).toEqual([BASE, GRASS]);
		expect(model.textures).toEqual(palette);
	});

	test('two painted layers merge into one with their alphas summed', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT, opacity: 0.6 }), 25, 20).finish();
		paintAt(model, settings({ fdid: SNOW, opacity: 0.3 }), 20, 25).finish();
		const chunk = model.tiles[0].chunks[0];
		expect(fdids(model)).toEqual([BASE, GRASS, DIRT, SNOW]);
		const grass = chunk.alpha!.slice(0, 64 * 64);
		const dirt = chunk.alpha!.slice(64 * 64, 2 * 64 * 64);
		const snow = chunk.alpha!.slice(2 * 64 * 64, 3 * 64 * 64);
		swapAt(model, GRASS, DIRT, 20, 20).finish();
		expect(fdids(model)).toEqual([BASE, DIRT, SNOW]);
		expect(chunk.alpha!.length).toBe(2 * 64 * 64);
		for (let i = 0; i < 64 * 64; i++) {
			expect(chunk.alpha![i]).toBe(Math.min(255, grass[i] + dirt[i]));
			expect(chunk.alpha![64 * 64 + i]).toBe(snow[i]);
		}
	});

	test('merging into the base removes the painted layer and the base absorbs its weight', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT, opacity: 0.5 }), 25, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		const dirt = chunk.alpha!.slice(64 * 64, 2 * 64 * 64);
		swapAt(model, GRASS, BASE, 20, 20).finish();
		expect(fdids(model)).toEqual([BASE, DIRT]);
		expect([...chunk.alpha!]).toEqual([...dirt]);
	});

	test('swapping the base for a painted texture makes that texture the base and drops its layer', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT, opacity: 0.5 }), 25, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		const dirt = chunk.alpha!.slice(64 * 64, 2 * 64 * 64);
		swapAt(model, BASE, GRASS, 20, 20).finish();
		expect(fdids(model)).toEqual([GRASS, DIRT]);
		expect([...chunk.alpha!]).toEqual([...dirt]);
	});

	test('a merge down to one layer leaves no alpha map and the scene reopens', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		swapAt(model, GRASS, BASE, 20, 20).finish();
		const chunk = model.tiles[0].chunks[0];
		expect(fdids(model)).toEqual([BASE]);
		expect(chunk.alpha).toBeNull();
		const loaded = decodeScene(encodeScene(model)).model;
		expect(loaded.tiles[0].chunks[0].layers).toEqual(chunk.layers);
		expect(loaded.tiles[0].chunks[0].alpha).toBeNull();
	});

	test('duplicate layers of the existing texture all go', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT, opacity: 0.5 }), 25, 20).finish();
		setBase(model, GRASS, 20, 20);
		expect(fdids(model)).toEqual([GRASS, GRASS, DIRT]);
		const chunk = model.tiles[0].chunks[0];
		const dirt = chunk.alpha!.slice(64 * 64, 2 * 64 * 64);
		swapAt(model, GRASS, SNOW, 20, 20).finish();
		expect(fdids(model)).toEqual([SNOW, DIRT]);
		expect([...chunk.alpha!]).toEqual([...dirt]);
	});

	test('a merge keeps each texel\'s painted sum at most 255', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: DIRT }), 24, 22).finish();
		paintAt(model, settings({ fdid: SNOW }), 22, 26).finish();
		const chunk = model.tiles[0].chunks[0];
		// Painting's rounding already lets a texel reach 256; the merge must not push any further.
		const sumBefore = Array.from({ length: 64 * 64 }, (_, i) => chunk.alpha![i] + chunk.alpha![64 * 64 + i] + chunk.alpha![2 * 64 * 64 + i]);
		swapAt(model, GRASS, DIRT, 20, 20).finish();
		expect(chunk.layers.length).toBe(3);
		for (let i = 0; i < 64 * 64; i++) expect(chunk.alpha![i] + chunk.alpha![64 * 64 + i]).toBeLessThanOrEqual(Math.max(255, sumBefore[i]));
	});

	test('a repointed layer takes the replacement\'s usual effect; a merge keeps the layer already there', () => {
		const effects = (fdid: number) => (fdid === DIRT ? 7 : 0);
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		swapAt(model, GRASS, DIRT, 20, 20, effects).finish();
		expect(model.tiles[0].chunks[0].layers[1]).toEqual({ texture: model.textures.indexOf(DIRT), effectId: 7 });

		const merged = blank();
		paintAt(merged, settings({ fdid: GRASS }), 20, 20).finish();
		const dirt = new PaintStroke(merged, settings({ fdid: DIRT, opacity: 0.5 }), () => 9);
		for (let i = 0; i < 40; i++) dirt.apply(25, 20, 0.05);
		dirt.finish();
		expect(merged.tiles[0].chunks[0].layers[2].effectId).toBe(9);
		swapAt(merged, GRASS, DIRT, 20, 20, effects).finish();
		expect(fdids(merged)).toEqual([BASE, DIRT]);
		expect(merged.tiles[0].chunks[0].layers[1].effectId).toBe(9);
	});

	test('a stroke over two chunks swaps both as one command that undoes and redoes exactly', () => {
		const model = blank();
		paintAt(model, settings({ fdid: GRASS }), 20, 20).finish();
		paintAt(model, settings({ fdid: GRASS }), CHUNK_SIZE + 20, 20).finish();
		const chunks = [model.tiles[0].chunks[0], model.tiles[0].chunks[1]];
		const before = chunks.map((c) => ({ layers: c.layers.map((l) => ({ ...l })), alpha: c.alpha!.slice() }));
		const stroke = new PaintStroke(model, settings({ mode: 'swap', swapFrom: GRASS, swapTo: DIRT }));
		for (let i = 0; i < 3; i++) {
			stroke.apply(20, 20, 0.05);
			stroke.apply(CHUNK_SIZE + 20, 20, 0.05);
		}
		const command = stroke.finish()!;
		expect(command).not.toBeNull();
		expect(command.label).toBe('Swap texture');
		for (const c of chunks) expect(fdids(model, c)).toEqual([BASE, DIRT]);
		const after = chunks.map((c) => ({ layers: c.layers.map((l) => ({ ...l })), alpha: c.alpha!.slice() }));
		command.undo();
		chunks.forEach((c, i) => {
			expect(c.layers).toEqual(before[i].layers);
			expect([...c.alpha!]).toEqual([...before[i].alpha]);
		});
		command.redo();
		chunks.forEach((c, i) => {
			expect(c.layers).toEqual(after[i].layers);
			expect([...c.alpha!]).toEqual([...after[i].alpha]);
		});
	});
});
