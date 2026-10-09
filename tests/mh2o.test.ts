import { expect, test } from 'bun:test';
import { liquidKind, parseMh2o } from '../src/formats/mh2o';

interface Layer {
	chunk: number;
	type: number;
	lvf: number;
	min: number;
	max: number;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Cell flags, one per cell, or null for no exists bitmap. */
	exists?: number[] | null;
	/** Surface heights, or null for no vertex data. */
	heights?: number[] | null;
}

/** Builds an MH2O chunk body (headers for 256 chunks, then layers and their data), preceded by pad bytes. */
function build(layers: Layer[], pad = 0): { bytes: Uint8Array; offset: number } {
	const HEADERS = 256 * 12;
	const bytes = new Uint8Array(pad + HEADERS + layers.length * (24 + 64 + 256));
	const view = new DataView(bytes.buffer);
	let cursor = HEADERS; // relative to the chunk body
	const instanceOffsets = new Map<number, number>();
	const counts = new Map<number, number>();
	for (const l of layers) {
		const at = cursor;
		cursor += 24;
		if (!instanceOffsets.has(l.chunk)) instanceOffsets.set(l.chunk, at);
		counts.set(l.chunk, (counts.get(l.chunk) ?? 0) + 1);

		let existsOffset = 0;
		if (l.exists) {
			existsOffset = cursor;
			l.exists.forEach((flag, i) => {
				if (flag) bytes[pad + cursor + (i >> 3)] |= 1 << (i & 7);
			});
			cursor += Math.ceil(l.exists.length / 8);
		}
		let vertexOffset = 0;
		if (l.heights) {
			vertexOffset = cursor;
			l.heights.forEach((h, i) => view.setFloat32(pad + cursor + i * 4, h, true));
			cursor += l.heights.length * 4;
		}
		const o = pad + at;
		view.setUint16(o, l.type, true);
		view.setUint16(o + 2, l.lvf, true);
		view.setFloat32(o + 4, l.min, true);
		view.setFloat32(o + 8, l.max, true);
		bytes.set([l.x, l.y, l.width, l.height], o + 12);
		view.setUint32(o + 16, existsOffset, true);
		view.setUint32(o + 20, vertexOffset, true);
	}
	for (const [chunk, at] of instanceOffsets) {
		view.setUint32(pad + chunk * 12, at, true);
		view.setUint32(pad + chunk * 12 + 4, counts.get(chunk)!, true);
	}
	return { bytes, offset: pad };
}

test('an empty chunk yields no liquids', () => {
	const { bytes, offset } = build([]);
	expect(parseMh2o(bytes, offset)).toEqual([]);
});

test('parses a layer with an exists bitmap and heights, at a non-zero chunk offset', () => {
	const heights = Array.from({ length: 12 }, (_, i) => 1.5 + i * 0.25);
	const { bytes, offset } = build(
		[{ chunk: 5, type: 3, lvf: 0, min: 1.5, max: 4.25, x: 1, y: 2, width: 3, height: 2, exists: [1, 0, 1, 1, 0, 1], heights }],
		40,
	);
	const [liquid, ...rest] = parseMh2o(bytes, offset);
	expect(rest).toEqual([]);
	expect(liquid).toMatchObject({ chunk: 5, type: 3, minHeight: 1.5, maxHeight: 4.25, x: 1, y: 2, width: 3, height: 2 });
	expect([...liquid.exists!]).toEqual([1, 0, 1, 1, 0, 1]);
	expect(liquid.heights!.length).toBe(12); // (3+1) x (2+1)
	expect([...liquid.heights!]).toEqual(heights);
});

test('a layer with no bitmap or vertex data is flat and covers every cell', () => {
	const { bytes, offset } = build([{ chunk: 0, type: 1, lvf: 0, min: 7, max: 7, x: 0, y: 0, width: 8, height: 8 }]);
	const [liquid] = parseMh2o(bytes, offset);
	expect(liquid.exists).toBeNull();
	expect(liquid.heights).toBeNull();
});

test('vertex format 2 stores depth only, so no heights are read', () => {
	const { bytes, offset } = build([{ chunk: 1, type: 1, lvf: 2, min: 2, max: 2, x: 0, y: 0, width: 1, height: 1, heights: [9, 9, 9, 9] }]);
	expect(parseMh2o(bytes, offset)[0].heights).toBeNull();
});

test('a liquid object id (42 and up) infers the format from the height range', () => {
	const sloped = build([{ chunk: 1, type: 1, lvf: 100, min: 1, max: 2, x: 0, y: 0, width: 1, height: 1, heights: [1, 1, 2, 2] }]);
	expect([...parseMh2o(sloped.bytes, sloped.offset)[0].heights!]).toEqual([1, 1, 2, 2]);
	const flat = build([{ chunk: 1, type: 1, lvf: 100, min: 2, max: 2, x: 0, y: 0, width: 1, height: 1, heights: [2, 2, 2, 2] }]);
	expect(parseMh2o(flat.bytes, flat.offset)[0].heights).toBeNull();
});

test('several layers on one chunk and layers on different chunks are all returned in chunk order', () => {
	const { bytes, offset } = build([
		{ chunk: 9, type: 1, lvf: 0, min: 0, max: 0, x: 0, y: 0, width: 1, height: 1 },
		{ chunk: 9, type: 2, lvf: 0, min: 0, max: 0, x: 0, y: 0, width: 1, height: 1 },
		{ chunk: 200, type: 3, lvf: 0, min: 0, max: 0, x: 0, y: 0, width: 1, height: 1 },
	]);
	expect(parseMh2o(bytes, offset).map((l) => [l.chunk, l.type])).toEqual([[9, 1], [9, 2], [200, 3]]);
});

test('liquidKind cycles water, ocean, magma, slime and falls back to water out of range', () => {
	expect([1, 2, 3, 4, 5, 6, 7, 8].map(liquidKind)).toEqual(['water', 'ocean', 'magma', 'slime', 'water', 'ocean', 'magma', 'slime']);
	expect(liquidKind(20)).toBe('slime');
	expect(liquidKind(0)).toBe('water');
	expect(liquidKind(21)).toBe('water');
});
