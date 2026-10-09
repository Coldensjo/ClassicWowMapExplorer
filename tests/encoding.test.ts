import { expect, test } from 'bun:test';
import { EncodingTable } from '../src/casc/encoding';

const PAGE_SIZE = 1024; // 1 KB pages

const key = (n: number) => Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? n : 0));

/** Builds an encoding file whose pages each hold { content key, encoding keys } entries. */
function build(pages: { ckey: number; ekeys: number[] }[][]): Uint8Array {
	const out: number[] = [0x45, 0x4e, 1, 16, 16, 0, PAGE_SIZE / 1024, 0, 0];
	out.push(0, 0, 0, pages.length, 0, 0, 0, 0, 0, 0, 0, 0, 0); // page count, espec page count, flag, espec block size 0
	for (const page of pages) out.push(...key(page[0].ckey), ...new Array(16).fill(0));
	for (const page of pages) {
		const body: number[] = [];
		for (const e of page) {
			body.push(e.ekeys.length, 0, 0, 0, 0, 0, ...key(e.ckey));
			for (const k of e.ekeys) body.push(...key(k));
		}
		out.push(...body, ...new Array(PAGE_SIZE - body.length).fill(0));
	}
	return Uint8Array.from(out);
}

const table = EncodingTable.parse(
	build([
		[{ ckey: 2, ekeys: [102] }, { ckey: 4, ekeys: [104, 204] }],
		[{ ckey: 10, ekeys: [110] }, { ckey: 12, ekeys: [112] }],
	]),
);

test('lookup finds entries on the first and later pages', () => {
	expect(table.pageCount).toBe(2);
	expect(table.lookup(key(2))).toEqual(key(102));
	expect(table.lookup(key(12))).toEqual(key(112));
});

test('lookupAll returns every encoding key for a content key', () => {
	expect(table.lookupAll(key(4))).toEqual([key(104), key(204)]);
});

test('lookup misses return null or empty', () => {
	expect(table.lookup(key(1))).toBeNull(); // before the first key
	expect(table.lookup(key(3))).toBeNull(); // between entries
	expect(table.lookup(key(11))).toBeNull(); // between entries on the second page
	expect(table.lookup(key(99))).toBeNull(); // after the last key
	expect(table.lookupAll(key(99))).toEqual([]);
});

test('sampleEncodingKeys returns the first encoding key of each sampled page', () => {
	expect(table.sampleEncodingKeys(10)).toEqual([key(102), key(110)]);
});

test('parse rejects a file with the wrong magic', () => {
	expect(() => EncodingTable.parse(new Uint8Array(64))).toThrow(/Not an encoding file/);
});
