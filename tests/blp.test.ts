import { expect, test } from 'bun:test';
import { decodeBlp, mipmapped } from '../src/formats/blp';

/** A BLP2 file holding one DXT mip level (encoding 2) of the given size. */
function dxtBlp(width: number, height: number, alphaDepth: number, format: number, blocks: number[]): Uint8Array {
	const header = 148;
	const out = new Uint8Array(header + blocks.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x424c5032, false);
	out[8] = 2;
	out[9] = alphaDepth;
	out[10] = format;
	view.setUint32(12, width, true);
	view.setUint32(16, height, true);
	view.setUint32(20, header, true);
	view.setUint32(84, blocks.length, true);
	out.set(blocks, header);
	return out;
}

/** 16 3-bit alpha indices packed into 6 bytes, the first texel's lowest. */
function alphaIndices(indices: number[]): number[] {
	const low = indices.slice(0, 8).reduce((n, v, i) => n | (v << (3 * i)), 0);
	const high = indices.slice(8).reduce((n, v, i) => n | (v << (3 * i)), 0);
	return [low & 0xff, (low >> 8) & 0xff, low >> 16, high & 0xff, (high >> 8) & 0xff, high >> 16];
}

const alphas = (rgba: Uint8Array) => Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3]);
const WHITE_COLOR_BLOCK = [0xff, 0xff, 0, 0, 0, 0, 0, 0];

test('DXT5 alpha with a0 > a1 blends eight levels, truncated', () => {
	const indices = Array.from({ length: 16 }, (_, i) => i % 8);
	const { rgba } = decodeBlp(dxtBlp(4, 4, 8, 7, [255, 0, ...alphaIndices(indices), ...WHITE_COLOR_BLOCK]));
	const levels = [255, 0, 218, 182, 145, 109, 72, 36];
	expect(alphas(rgba)).toEqual(indices.map((i) => levels[i]));
	expect([...rgba.subarray(0, 3)]).toEqual([255, 255, 255]);
});

test('DXT5 alpha with a0 <= a1 blends six levels and adds 0 and 255', () => {
	const indices = Array.from({ length: 16 }, (_, i) => 7 - (i % 8));
	const { rgba } = decodeBlp(dxtBlp(4, 4, 8, 7, [0, 255, ...alphaIndices(indices), ...WHITE_COLOR_BLOCK]));
	const levels = [0, 255, 51, 102, 153, 204, 0, 255];
	expect(alphas(rgba)).toEqual(indices.map((i) => levels[i]));
});

test('DXT1 with c0 <= c1 has a mid colour and transparent black', () => {
	// c0 pure blue, c1 pure red; texels use indices 0, 1, 2, 3 in turn.
	const indexBits = Array.from({ length: 16 }, (_, i) => (i % 4) << (i * 2)).reduce((a, b) => a | b, 0) >>> 0;
	const block = [0x1f, 0x00, 0x00, 0xf8, indexBits & 0xff, (indexBits >> 8) & 0xff, (indexBits >> 16) & 0xff, indexBits >>> 24];
	const { rgba } = decodeBlp(dxtBlp(4, 4, 0, 0, block));
	expect([...rgba.subarray(0, 16)]).toEqual([0, 0, 255, 255, 255, 0, 0, 255, 127, 0, 127, 255, 0, 0, 0, 0]);
});

test('a picture smaller than a block decodes only its own texels', () => {
	const { width, height, rgba } = decodeBlp(dxtBlp(3, 2, 0, 0, [0xff, 0xff, 0, 0, 0, 0, 0, 0]));
	expect([width, height, rgba.length]).toEqual([3, 2, 24]);
	expect(rgba.every((v) => v === 255)).toBe(true);
});

test('halving averages 2x2 texels, rounding halves up', () => {
	// Red: 0+1+1+1 = 3 (0.75 -> 1); green: 0+0+1+1 (0.5 -> 1); blue: 0+0+0+1 (0.25 -> 0); alpha 4 x 255.
	const rgba = Uint8Array.from([0, 0, 0, 255, 1, 0, 0, 255, 1, 1, 0, 255, 1, 1, 1, 255]);
	const texture = mipmapped({ width: 2, height: 2, rgba }, 1, false);
	expect([...texture.mips[0].data]).toEqual([1, 1, 0, 255]);
});
