import { expect, test } from 'bun:test';
import { chunks, findChunk } from '../src/formats/chunks';

/** Builds an IFF stream; ids are written byte-reversed like on disk. */
function build(parts: [string, number[]][]): Uint8Array {
	const out: number[] = [];
	for (const [id, payload] of parts) {
		out.push(...[...id].reverse().map((c) => c.charCodeAt(0)));
		out.push(payload.length & 255, (payload.length >> 8) & 255, 0, 0);
		out.push(...payload);
	}
	return Uint8Array.from(out);
}

test('chunks yields ids, payload offsets and sizes in order', () => {
	const data = build([['MVER', [18, 0, 0, 0]], ['MHDR', [1, 2, 3, 4, 5, 6]]]);
	expect([...chunks(data)]).toEqual([
		{ id: 'MVER', offset: 8, size: 4 },
		{ id: 'MHDR', offset: 20, size: 6 },
	]);
});

test('findChunk returns the chunk or null', () => {
	const data = build([['MVER', [18, 0, 0, 0]], ['MCNK', [9]]]);
	expect(findChunk(data, 'MCNK')).toEqual({ id: 'MCNK', offset: 20, size: 1 });
	expect(findChunk(data, 'MH2O')).toBeNull();
});

test('chunks respects start and end, and ignores a trailing partial header', () => {
	const data = build([['AAAA', [1]], ['BBBB', [2]]]);
	expect([...chunks(data, 9)].map((c) => c.id)).toEqual(['BBBB']);
	expect([...chunks(data, 0, 9)].map((c) => c.id)).toEqual(['AAAA']);
	const padded = Uint8Array.from([...data, 1, 2, 3]);
	expect([...chunks(padded)].length).toBe(2);
});

test('chunks works on a subarray with a non-zero byteOffset', () => {
	const data = build([['MVER', [18, 0, 0, 0]]]);
	const shifted = new Uint8Array(data.length + 5);
	shifted.set(data, 5);
	expect([...chunks(shifted.subarray(5))]).toEqual([{ id: 'MVER', offset: 8, size: 4 }]);
});
