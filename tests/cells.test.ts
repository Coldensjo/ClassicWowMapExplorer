import { describe, expect, test } from 'bun:test';
import { CHUNK_SIZE } from '../src/formats/adt';
import { HoleStroke, WaterStroke, type WaterSettings } from '../src/editor/cells';
import { SculptStroke } from '../src/editor/sculpt';
import { SceneModel } from '../src/scene/sceneModel';
import { decodeScene, encodeScene } from '../src/scene/wscene';

const client = { product: 'wow_classic_beta', build: 'test' };

function blank(): SceneModel {
	return SceneModel.blank({ name: 'test', tilesX: 1, tilesY: 1, baseTexture: 187138, client });
}

function water(overrides: Partial<WaterSettings> = {}): WaterSettings {
	return { radius: 8, mode: 'add', kind: 1, height: null, ...overrides };
}

const CELL = CHUNK_SIZE / 8;

describe('holes', () => {
	test('cutting opens cells and the surface query respects them', () => {
		const model = blank();
		const stroke = new HoleStroke(model, { radius: 3, mode: 'cut' });
		stroke.apply(CELL * 2.5, CELL * 2.5, 0.05);
		const command = stroke.finish();
		expect(command).not.toBeNull();
		expect(model.heightAt(CELL * 2.5, CELL * 2.5)).toBeNull();
		expect(model.surfaceAt(CELL * 2.5, CELL * 2.5)).not.toBeNull();
		command!.undo();
		expect(model.heightAt(CELL * 2.5, CELL * 2.5)).toBe(0);
	});

	test('filling closes cut cells', () => {
		const model = blank();
		new HoleStroke(model, { radius: 6, mode: 'cut' }).apply(20, 20, 0.05);
		const fill = new HoleStroke(model, { radius: 10, mode: 'fill' });
		fill.apply(20, 20, 0.05);
		expect(fill.finish()).not.toBeNull();
		expect(model.heightAt(20, 20)).toBe(0);
	});
});

describe('water', () => {
	test('adding water sets coverage and a surface above the ground', () => {
		const model = blank();
		const stroke = new WaterStroke(model, water(), 0);
		stroke.apply(20, 20, 0.05);
		const command = stroke.finish();
		expect(command).not.toBeNull();
		const chunk = model.tiles[0].chunks[0];
		expect(chunk.water).not.toBeNull();
		expect(chunk.water!.height).toBeCloseTo(1.5, 1);
		expect(chunk.water!.coverage.some((b) => b !== 0)).toBe(true);
		command!.undo();
		expect(model.tiles[0].chunks[0].water).toBeNull();
	});

	test('removing the last cells drops the chunk water', () => {
		const model = blank();
		new WaterStroke(model, water({ radius: 10 }), 0).apply(20, 20, 0.05);
		const remove = new WaterStroke(model, water({ mode: 'remove', radius: 30 }), 0);
		remove.apply(20, 20, 0.05);
		remove.finish();
		expect(model.tiles[0].chunks[0].water).toBeNull();
	});

	test('flood fill fills a dug hollow up to the chosen height and stops at its rim', () => {
		const model = blank();
		// Dig a hollow around (100, 100).
		const dig = new SculptStroke(model, { radius: 30, strength: 1, falloff: 'smooth', mode: 'lower', flattenTo: null }, 0);
		for (let i = 0; i < 20; i++) dig.apply(100, 100, 0.1);
		dig.finish();
		expect(model.surfaceAt(100, 100)!).toBeLessThan(-5);

		const flood = new WaterStroke(model, water({ mode: 'flood', height: -2 }), model.surfaceAt(100, 100)!);
		flood.applyFlood(100, 100);
		const command = flood.finish();
		expect(command).not.toBeNull();
		// The hollow's centre cell is under water, ground far away is not.
		const centre = model.tiles[0].chunks[Math.floor(100 / CHUNK_SIZE) * 16 + Math.floor(100 / CHUNK_SIZE)];
		expect(centre.water?.height).toBe(-2);
		const far = model.tiles[0].chunks[15 * 16 + 15];
		expect(far.water).toBeNull();
	});

	test('water round-trips through the .wscene container with its coverage', () => {
		const model = blank();
		const stroke = new WaterStroke(model, water({ height: 3.5, kind: 3 }), 0);
		stroke.apply(20, 20, 0.05);
		stroke.finish();
		const coverage = model.tiles[0].chunks[0].water!.coverage.slice();
		const decoded = decodeScene(encodeScene(model)).model;
		const back = decoded.tiles[0].chunks[0].water!;
		expect(back.kind).toBe(3);
		expect(back.height).toBe(3.5);
		expect([...back.coverage]).toEqual([...coverage]);
	});
});
