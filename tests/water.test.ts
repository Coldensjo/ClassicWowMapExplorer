import { describe, expect, test } from 'bun:test';
import type { CopyTile } from '../src/explorer/copyWorld';
import { CHUNK_SIZE } from '../src/formats/adt';
import { WaterStroke } from '../src/editor/cells';
import { createCopiedScene } from '../src/scene/copyScene';
import { SceneModel } from '../src/scene/sceneModel';

const client = { product: 'wow_classic_beta', build: 'test' };
const CELL = CHUNK_SIZE / 8;

/** A flat source tile with one sloping lake over chunk 3: 4x3 cells from (2, 1), one cell missing. */
function lakeTile(): CopyTile {
	return {
		x: 30,
		y: 48,
		exists: true,
		chunks: Array.from({ length: 256 }, () => ({ heights: new Float32Array(145), shade: null, layers: [{ fdid: 111, effect: 0 }], alpha: null, holes: new Uint8Array(8) })),
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
			// Rises half a yard per column of the 5x4 height grid.
			heights: new Float32Array(20).map((_, i) => 10 + (i % 5) / 2),
		}],
		placements: [],
	};
}

describe('waterAt (spec 7.10 swimming)', () => {
	test('a blank scene has water only where the brush laid it, at its flat height', () => {
		const model = SceneModel.blank({ name: 'test', tilesX: 1, tilesY: 1, baseTexture: 187138, client });
		expect(model.waterAt(20, 20)).toBeNull();
		const stroke = new WaterStroke(model, { radius: 8, mode: 'add', kind: 1, height: null }, 0);
		stroke.apply(20, 20, 0.05);
		stroke.finish();
		const height = model.tiles[0].chunks[0].water!.height;
		expect(model.waterAt(20, 20)).toBe(height);
		// Far from the stroke, and off the scene.
		expect(model.waterAt(300, 300)).toBeNull();
		expect(model.waterAt(-5, -5)).toBeNull();
	});

	test('a copied scene answers from the source liquid, sloping surface and missing cells included', () => {
		const model = createCopiedScene({ name: 'lake', client, map: { id: 0, directory: 'Azeroth' }, tileMin: [30, 48], tileMax: [30, 48], includeDoodads: false, includeWmos: false }, [lakeTile()]);
		const x0 = 3 * CHUNK_SIZE;
		// Halfway across the lake's first cell: between the 10 and 10.5 corner heights.
		expect(model.waterAt(x0 + 2.5 * CELL, 1.5 * CELL)).toBeCloseTo(10.25, 5);
		// Its last column slopes up to 11.5-12.
		expect(model.waterAt(x0 + 5.5 * CELL, 2.5 * CELL)).toBeCloseTo(11.75, 5);
		// The cell the existence mask drops (row 2, col 3), and a row the lake doesn't reach.
		expect(model.waterAt(x0 + 3.5 * CELL, 2.5 * CELL)).toBeNull();
		expect(model.waterAt(x0 + 2.5 * CELL, 0.5 * CELL)).toBeNull();
		// Once edited, the chunk's flat water answers instead.
		const stroke = new WaterStroke(model, { radius: 2, mode: 'add', kind: 1, height: 20 }, 0);
		stroke.apply(x0 + 0.5 * CELL, 0.5 * CELL, 0.05);
		stroke.finish();
		expect(model.waterAt(x0 + 2.5 * CELL, 1.5 * CELL)).toBe(model.tiles[0].chunks[3].water!.height);
	});
});
