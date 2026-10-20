import { describe, expect, test } from 'bun:test';
import { CHUNK_SIZE } from '../src/formats/adt';
import { PaintStroke, type PaintSettings } from '../src/editor/paint';
import { SceneModel } from '../src/scene/sceneModel';

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
	return { fdid: GRASS, radius: 10, strength: 1, opacity: 1, mode: 'paint', policy: 'replace', ...overrides };
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
