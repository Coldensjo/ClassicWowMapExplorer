import { describe, expect, test } from 'bun:test';
import { CHUNK_SIZE, CHUNKS_PER_TILE, TILE_SIZE } from '../src/formats/adt';
import { CommandStack } from '../src/editor/commands';
import { SculptStroke, type BrushSettings } from '../src/editor/sculpt';
import { SceneModel } from '../src/scene/sceneModel';

const client = { product: 'wow_classic_beta', build: 'test' };

function blank(tilesX = 2, tilesY = 2): SceneModel {
	return SceneModel.blank({ name: 'test', tilesX, tilesY, baseTexture: 187138, client });
}

function brush(overrides: Partial<BrushSettings> = {}): BrushSettings {
	return { radius: 15, strength: 1, falloff: 'smooth', mode: 'raise', flattenTo: null, ...overrides };
}

/** Every pair of copies of the same lattice vertex must agree (spec 7.4 seams). */
function expectNoSeams(model: SceneModel): void {
	const cell = CHUNK_SIZE / 8;
	for (let gz = 0; gz <= model.cellsZ; gz++) {
		for (let gx = 0; gx <= model.cellsX; gx++) {
			// Shared copies agree when the sampled surface is continuous across the vertex.
			const h = model.outerHeight(gx, gz);
			const x = gx * cell;
			const z = gz * cell;
			for (const [dx, dz] of [[-0.01, 0], [0.01, 0], [0, -0.01], [0, 0.01]] as const) {
				const near = model.surfaceAt(x + dx * cell, z + dz * cell);
				if (near === null) continue;
				expect(Math.abs(near - h)).toBeLessThan(1);
			}
		}
	}
}

describe('the height lattice', () => {
	test('writes an edge vertex into every chunk that shares it', () => {
		const model = blank();
		// The vertex at the corner of four chunks inside tile 0.
		model.setOuterHeight(8, 8, 5);
		expect(model.outerHeight(8, 8)).toBe(5);
		const tile = model.tiles[0];
		expect(tile.chunks[0].heights[8 * 17 + 8]).toBe(5); // chunk (0,0) corner
		expect(tile.chunks[1].heights[8 * 17]).toBe(5); // chunk (1,0) left edge
		expect(tile.chunks[16].heights[8]).toBe(5); // chunk (0,1) top edge
		expect(tile.chunks[17].heights[0]).toBe(5); // chunk (1,1) origin
	});

	test('writes a tile-border vertex into both tiles', () => {
		const model = blank();
		// gx 128 is the border between tile 0 and tile 1.
		model.setOuterHeight(128, 4, 7);
		expect(model.tiles[0].chunks[15].heights[4 * 17 + 8]).toBe(7);
		expect(model.tiles[1].chunks[0].heights[4 * 17]).toBe(7);
		expect(model.dirtyHeights.get(0)?.has(15)).toBe(true);
		expect(model.dirtyHeights.get(1)?.has(0)).toBe(true);
	});

	test('a corner vertex of four tiles lands in all four', () => {
		const model = blank();
		model.setOuterHeight(128, 128, 3);
		expect(model.tiles[0].chunks[255].heights[8 * 17 + 8]).toBe(3);
		expect(model.tiles[1].chunks[240].heights[8 * 17]).toBe(3);
		expect(model.tiles[2].chunks[15].heights[8]).toBe(3);
		expect(model.tiles[3].chunks[0].heights[0]).toBe(3);
	});
});

describe('sculpt strokes', () => {
	test('raising across a tile border leaves no seam', () => {
		const model = blank();
		const stroke = new SculptStroke(model, brush({ radius: 30 }), 0);
		// The brush centre sits on the border between tiles 0 and 1.
		stroke.apply(TILE_SIZE, 100, 0.5);
		const command = stroke.finish();
		expect(command).not.toBeNull();
		expect(model.surfaceAt(TILE_SIZE, 100)!).toBeGreaterThan(1);
		expectNoSeams(model);
	});

	test('a stroke undoes and redoes exactly', () => {
		const model = blank(1, 1);
		const flat = model.tiles[0].chunks.map((c) => c.heights.slice());
		const stroke = new SculptStroke(model, brush(), 0);
		stroke.apply(100, 100, 0.3);
		stroke.apply(110, 100, 0.3);
		const command = stroke.finish()!;
		const raised = model.tiles[0].chunks.map((c) => c.heights.slice());
		expect(raised.some((h, i) => !h.every((v, k) => v === flat[i][k]))).toBe(true);

		command.undo();
		model.tiles[0].chunks.forEach((c, i) => expect([...c.heights]).toEqual([...flat[i]]));
		command.redo();
		model.tiles[0].chunks.forEach((c, i) => expect([...c.heights]).toEqual([...raised[i]]));
	});

	test('flatten pulls toward the start height', () => {
		const model = blank(1, 1);
		const raise = new SculptStroke(model, brush({ radius: 20 }), 0);
		raise.apply(100, 100, 1);
		raise.finish();
		const flatten = new SculptStroke(model, brush({ mode: 'flatten', radius: 40, falloff: 'flat' }), 10);
		for (let i = 0; i < 40; i++) flatten.apply(100, 100, 0.1);
		flatten.finish();
		expect(Math.abs(model.surfaceAt(100, 100)! - 10)).toBeLessThan(0.5);
	});

	test('a ramp slopes between its two ends', () => {
		const model = blank(1, 1);
		const stroke = new SculptStroke(model, brush({ mode: 'ramp', radius: 20, falloff: 'flat', strength: 1 }), 0);
		stroke.applyRamp({ x: 50, z: 100, h: 0 }, { x: 150, z: 100, h: 20 });
		stroke.finish();
		expect(model.surfaceAt(50, 100)!).toBeCloseTo(0, 0);
		expect(model.surfaceAt(150, 100)!).toBeCloseTo(20, 0);
		const mid = model.surfaceAt(100, 100)!;
		expect(mid).toBeGreaterThan(7);
		expect(mid).toBeLessThan(13);
		expectNoSeams(model);
	});

	test('a stroke that changes nothing produces no command', () => {
		const model = blank(1, 1);
		const stroke = new SculptStroke(model, brush({ strength: 0 }), 0);
		stroke.apply(100, 100, 0.5);
		expect(stroke.finish()).toBeNull();
	});

	test('smoothing never writes outside the brush', () => {
		const model = blank(1, 1);
		const raise = new SculptStroke(model, brush({ radius: 10 }), 0);
		raise.apply(100, 100, 1);
		raise.finish();
		const before = model.surfaceAt(200, 200)!;
		const smooth = new SculptStroke(model, brush({ mode: 'smooth', radius: 15 }), 0);
		smooth.apply(100, 100, 0.5);
		smooth.finish();
		expect(model.surfaceAt(200, 200)!).toBe(before);
	});
});

describe('the command stack', () => {
	function counter(): { command: (bytes?: number) => { label: string; bytes: number; undo(): void; redo(): void }; value: () => number } {
		let value = 0;
		return {
			command: (bytes = 8) => {
				value++;
				const mine = value;
				return { label: 'test', bytes, undo: () => (value = mine - 1), redo: () => (value = mine) };
			},
			value: () => value,
		};
	}

	test('undo and redo walk the stack', () => {
		const stack = new CommandStack();
		const c = counter();
		stack.push(c.command());
		stack.push(c.command());
		expect(c.value()).toBe(2);
		stack.undo();
		expect(c.value()).toBe(1);
		stack.undo();
		expect(c.value()).toBe(0);
		expect(stack.canUndo).toBe(false);
		stack.redo();
		stack.redo();
		expect(c.value()).toBe(2);
		expect(stack.canRedo).toBe(false);
	});

	test('a new command clears the redo branch', () => {
		const stack = new CommandStack();
		const c = counter();
		stack.push(c.command());
		stack.undo();
		stack.push(c.command());
		expect(stack.canRedo).toBe(false);
	});

	test('the stack is capped at 200 commands', () => {
		const stack = new CommandStack();
		const c = counter();
		for (let i = 0; i < 250; i++) stack.push(c.command());
		let undone = 0;
		while (stack.canUndo) {
			stack.undo();
			undone++;
		}
		expect(undone).toBe(200);
	});

	test('the stack drops old commands over the byte budget', () => {
		const stack = new CommandStack();
		const c = counter();
		for (let i = 0; i < 4; i++) stack.push(c.command(100 * 1024 * 1024));
		let undone = 0;
		while (stack.canUndo) {
			stack.undo();
			undone++;
		}
		expect(undone).toBeLessThan(4);
		expect(undone).toBeGreaterThan(0);
	});
});

describe('chunk layer readout', () => {
	test('a blank scene has one layer everywhere', () => {
		const model = blank(1, 1);
		expect(model.tiles[0].chunks.every((c) => c.layers.length === 1)).toBe(true);
		expect(CHUNKS_PER_TILE * CHUNKS_PER_TILE).toBe(model.tiles[0].chunks.length);
	});
});
