import { expect, test } from 'bun:test';
import { zlibSync } from 'fflate';
import { EncryptedError, decodeBlte, decodeBlteAsync } from '../src/casc/blte';

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const MAGIC = [0x42, 0x4c, 0x54, 0x45];

/** Wraps blocks (each already prefixed with its mode byte) in a multi-chunk BLTE header. */
function blte(blocks: { block: Uint8Array; size: number }[]): Uint8Array {
	const headerSize = 12 + blocks.length * 24;
	const head = [...MAGIC, ...u32be(headerSize), 0x0f, 0, 0, blocks.length];
	for (const b of blocks) head.push(...u32be(b.block.length), ...u32be(b.size), ...new Array(16).fill(0));
	return Uint8Array.from([...head, ...blocks.flatMap((b) => [...b.block])]);
}

const raw = (bytes: number[]) => Uint8Array.from([0x4e, ...bytes]);
const zlib = (bytes: number[]) => Uint8Array.from([0x5a, ...zlibSync(Uint8Array.from(bytes))]);

test('headerless stream holds a single raw block', () => {
	const input = Uint8Array.from([...MAGIC, 0, 0, 0, 0, ...raw([1, 2, 3])]);
	expect(decodeBlte(input).data).toEqual(Uint8Array.from([1, 2, 3]));
});

test('headerless stream can be zlib compressed', () => {
	const input = Uint8Array.from([...MAGIC, 0, 0, 0, 0, ...zlib([9, 9, 9, 9, 9, 9])]);
	expect(decodeBlte(input).data).toEqual(Uint8Array.from([9, 9, 9, 9, 9, 9]));
});

test('multi-chunk stream concatenates raw and zlib blocks in order', () => {
	const input = blte([
		{ block: raw([1, 2]), size: 2 },
		{ block: zlib([3, 3, 3, 3]), size: 4 },
		{ block: raw([4]), size: 1 },
	]);
	const { data, encryptedKeys } = decodeBlte(input);
	expect(data).toEqual(Uint8Array.from([1, 2, 3, 3, 3, 3, 4]));
	expect(encryptedKeys).toEqual([]);
});

test('nested frame chunks are decoded recursively', () => {
	const inner = Uint8Array.from([...MAGIC, 0, 0, 0, 0, ...raw([7, 8])]);
	const input = blte([{ block: Uint8Array.from([0x46, ...inner]), size: 2 }]);
	expect(decodeBlte(input).data).toEqual(Uint8Array.from([7, 8]));
});

// Key name bytes are stored little-endian and reported reversed, as upper-case hex.
const encrypted = Uint8Array.from([0x45, 8, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xaa]);

test('encrypted chunk throws with the key name by default', () => {
	const input = blte([{ block: encrypted, size: 3 }]);
	try {
		decodeBlte(input);
		throw new Error('expected EncryptedError');
	} catch (e) {
		expect(e).toBeInstanceOf(EncryptedError);
		expect((e as EncryptedError).keyName).toBe('EFCDAB8967452301');
	}
});

test('allowPartial zero-fills encrypted chunks and reports their keys', () => {
	const input = blte([
		{ block: raw([5]), size: 1 },
		{ block: encrypted, size: 3 },
	]);
	const { data, encryptedKeys } = decodeBlte(input, true);
	expect(data).toEqual(Uint8Array.from([5, 0, 0, 0]));
	expect(encryptedKeys).toEqual(['EFCDAB8967452301']);
});

test('rejects bad magic, truncated input and unknown modes', () => {
	expect(() => decodeBlte(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/Not a BLTE stream/);
	expect(() => decodeBlte(new Uint8Array(3))).toThrow(/Not a BLTE stream/);
	const bad = Uint8Array.from([...MAGIC, 0, 0, 0, 0, 0x58, 1]);
	expect(() => decodeBlte(bad)).toThrow(/Unknown BLTE chunk mode 0x58/);
});

/** Bytes that compress well and badly, so the stream has stored and Huffman blocks. */
function sample(n: number): number[] {
	let seed = 12345;
	return Array.from({ length: n }, (_, i) => (i % 3 === 0 ? (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24 : i & 0x3f));
}

test('the async decoder gives what the sync one does, chunk for chunk', async () => {
	const cases = [
		Uint8Array.from([...MAGIC, 0, 0, 0, 0, ...zlib(sample(5000))]),
		blte([
			{ block: raw([1, 2]), size: 2 },
			{ block: zlib(sample(70000)), size: 70000 },
			{ block: zlib([3, 3, 3, 3]), size: 4 },
			{ block: Uint8Array.from([0x46, ...MAGIC, 0, 0, 0, 0, ...raw([7, 8])]), size: 2 },
		]),
	];
	for (const input of cases) expect(await decodeBlteAsync(input)).toEqual(decodeBlte(input));
	const partial = blte([{ block: zlib(sample(100)), size: 100 }, { block: encrypted, size: 3 }]);
	expect(await decodeBlteAsync(partial, true)).toEqual(decodeBlte(partial, true));
	await expect(decodeBlteAsync(blte([{ block: zlib([1]), size: 1 }, { block: encrypted, size: 3 }]))).rejects.toBeInstanceOf(EncryptedError);
});

test('the async decoder falls back to the sync one for a chunk native zlib rejects or sizes otherwise', async () => {
	// A size the header gets wrong: fflate fills what it is given.
	const short = blte([{ block: zlib(sample(64)), size: 40 }]);
	expect(await decodeBlteAsync(short)).toEqual(decodeBlte(short));
	const long = blte([{ block: zlib(sample(64)), size: 100 }]);
	expect(await decodeBlteAsync(long)).toEqual(decodeBlte(long));
	// A damaged checksum native zlib refuses; fflate doesn't check it.
	const z = zlib(sample(300));
	z[z.length - 1] ^= 0xff;
	const damaged = blte([{ block: z, size: 300 }]);
	expect(await decodeBlteAsync(damaged)).toEqual(decodeBlte(damaged));
	// Trailing bytes after the stream.
	const trailing = blte([{ block: Uint8Array.from([...zlib(sample(50)), 1, 2, 3]), size: 50 }]);
	expect(await decodeBlteAsync(trailing)).toEqual(decodeBlte(trailing));
	await expect(decodeBlteAsync(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(/Not a BLTE stream/);
});
