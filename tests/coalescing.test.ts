import { expect, test } from 'bun:test';
import type { RandomAccessFile } from '../src/casc/source';
import { CoalescingFile } from '../src/casc/storage';

/** A file of bytes 0, 1, 2, ... (mod 256) that records each read it's asked for. */
function file(size: number, behave: { short?: boolean; failLong?: boolean } = {}) {
	const reads: [number, number][] = [];
	const inner: RandomAccessFile = {
		size,
		async read(offset, length) {
			reads.push([offset, length]);
			if (behave.failLong && length > 100) throw new Error('too long');
			const n = behave.short && length > 100 ? length - 1 : length;
			return Uint8Array.from({ length: n }, (_, i) => (offset + i) & 0xff);
		},
	};
	return { reads, inner };
}

const expected = (offset: number, length: number) => Uint8Array.from({ length }, (_, i) => (offset + i) & 0xff);

test('reads asked for together that lie close become one, each answered with its own bytes', async () => {
	const { reads, inner } = file(1 << 20);
	const coalesced = new CoalescingFile(inner);
	const asked: [number, number][] = [[200, 50], [0, 100], [120, 30], [500000, 10]];
	const results = await Promise.all(asked.map(([o, l]) => coalesced.read(o, l)));
	results.forEach((bytes, i) => expect(bytes).toEqual(expected(...asked[i])));
	// Their own buffers, not views into the shared read.
	for (const bytes of results) expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
	expect(reads.sort((a, b) => a[0] - b[0])).toEqual([[0, 250], [500000, 10]]);
});

test('reads asked for apart are not held for each other', async () => {
	const { reads, inner } = file(1000);
	const coalesced = new CoalescingFile(inner);
	expect(await coalesced.read(0, 10)).toEqual(expected(0, 10));
	expect(await coalesced.read(10, 10)).toEqual(expected(10, 10));
	expect(reads).toEqual([[0, 10], [10, 10]]);
});

test('a coalesced read that comes back short or fails is read piece by piece', async () => {
	for (const behave of [{ short: true }, { failLong: true }]) {
		const { reads, inner } = file(1000, behave);
		const coalesced = new CoalescingFile(inner);
		const results = await Promise.all([coalesced.read(0, 60), coalesced.read(60, 60)]);
		expect(results).toEqual([expected(0, 60), expected(60, 60)]);
		expect(reads).toEqual([[0, 120], [0, 60], [60, 60]]);
	}
});
