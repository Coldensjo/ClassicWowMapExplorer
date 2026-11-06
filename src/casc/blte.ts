import { unzlibSync } from 'fflate';
import { Reader, concatBytes, toHex } from './reader';
import { salsa20 } from './salsa20';

const BLTE_MAGIC = 0x424c5445;

export class EncryptedError extends Error {
	constructor(readonly keyName: string) {
		super(`Encrypted with TACT key ${keyName}`);
		this.name = 'EncryptedError';
	}
}

/** TACT keys by name (upper-case hex, as key lists write it): the 16-byte keys encrypted chunks can be read with. */
export type TactKeys = ReadonlyMap<string, Uint8Array>;

/** A TACT key from its 32 hex digits, or null if it isn't that. */
export function parseKey(hex: string): Uint8Array | null {
	if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
	return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export interface BlteResult {
	data: Uint8Array;
	/** TACT key names of chunks that were zero-filled because they are encrypted. */
	encryptedKeys: string[];
}

interface ChunkInfo {
	compressedSize: number;
	decompressedSize: number;
}

/** The chunks of a BLTE stream, and where the first one starts. */
function readHeader(input: Uint8Array): { chunks: ChunkInfo[]; offset: number } {
	const r = new Reader(input);
	if (input.length < 8 || r.u32be() !== BLTE_MAGIC) {
		const head = toHex(input.subarray(0, 16));
		const text = String.fromCharCode(...input.subarray(0, 16)).replace(/[^\x20-\x7e]/g, '.');
		throw new Error(`Not a BLTE stream (${input.length} bytes, starts with ${head || 'nothing'} "${text}")`);
	}
	const headerSize = r.u32be();

	const chunks: ChunkInfo[] = [];
	if (headerSize === 0) {
		chunks.push({ compressedSize: input.length - 8, decompressedSize: -1 });
	} else {
		r.u8(); // flags
		const count = r.u24be();
		for (let i = 0; i < count; i++) {
			const compressedSize = r.u32be();
			const decompressedSize = r.u32be();
			r.skip(16); // md5
			chunks.push({ compressedSize, decompressedSize });
		}
	}
	return { chunks, offset: headerSize === 0 ? 8 : headerSize };
}

/**
 * Decodes a BLTE stream. Encrypted chunks are decrypted with keys where it has theirs; others throw
 * EncryptedError, unless allowPartial is set, in which case they are zero-filled and reported in encryptedKeys.
 */
export function decodeBlte(input: Uint8Array, allowPartial = false, keys?: TactKeys): BlteResult {
	const { chunks, offset: start } = readHeader(input);
	let offset = start;
	const parts: Uint8Array[] = [];
	const encryptedKeys: string[] = [];
	for (const [index, chunk] of chunks.entries()) {
		const block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		parts.push(decodeChunk(block, chunk.decompressedSize, allowPartial, encryptedKeys, index, keys));
	}
	return { data: concatBytes(parts), encryptedKeys };
}

/**
 * decodeBlte, with zlib chunks inflated by the browser's own DecompressionStream where there is
 * one: native zlib is over twice as fast as fflate's, and it is most of the time spent reading
 * files. A chunk it can't inflate, or inflates to other than the size the header gives, goes to
 * fflate as before, so the result (and any error) is the same as decodeBlte's.
 */
export async function decodeBlteAsync(input: Uint8Array, allowPartial = false, keys?: TactKeys): Promise<BlteResult> {
	if (!NATIVE_INFLATE) return decodeBlte(input, allowPartial, keys);
	const { chunks, offset: start } = readHeader(input);
	let offset = start;
	const parts: Uint8Array[] = [];
	const encryptedKeys: string[] = [];
	for (const [index, chunk] of chunks.entries()) {
		let block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		// Decrypted first, so the zlib stream inside goes to the native inflate like any other.
		if (block[0] === 0x45) block = decrypt(block, index, keys) ?? block;
		let part: Uint8Array | null = null;
		if (block[0] === 0x5a && chunk.decompressedSize > 0) part = await inflateNative(block.subarray(1), chunk.decompressedSize);
		else if (block[0] === 0x46) part = (await decodeBlteAsync(block.subarray(1), allowPartial, keys)).data;
		parts.push(part ?? decodeChunk(block, chunk.decompressedSize, allowPartial, encryptedKeys, index, keys));
	}
	return { data: concatBytes(parts), encryptedKeys };
}

/**
 * Whether a key is the right one for the chunks of a BLTE stream encrypted with it: they decrypt to
 * a zlib stream that inflates to the size the header gives, or a nested BLTE frame. null if no chunk
 * uses the key. A wrong key gives noise, which fails that; only a raw chunk can't be told apart.
 */
export function checkKey(input: Uint8Array, name: string, key: Uint8Array): boolean | null {
	const { chunks, offset: start } = readHeader(input);
	const keys = new Map([[name, key]]);
	let offset = start;
	let found = false;
	for (const [index, chunk] of chunks.entries()) {
		const block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		if (block[0] !== 0x45 || chunkKeyName(block) !== name) continue;
		found = true;
		const plain = decrypt(block, index, keys)!;
		try {
			if (plain[0] === 0x5a) {
				// zlib's header: deflate, and a check that makes its two bytes a multiple of 31.
				if ((plain[1] & 0x0f) !== 8 || ((plain[1] << 8) | plain[2]) % 31 !== 0) return false;
				const inflated = unzlibSync(plain.subarray(1));
				if (chunk.decompressedSize > 0 && inflated.length !== chunk.decompressedSize) return false;
			} else if (plain[0] === 0x46) {
				readHeader(plain.subarray(1));
			} else if (plain[0] !== 0x4e) {
				return false;
			}
		} catch {
			return false;
		}
	}
	return found ? true : null;
}

const NATIVE_INFLATE = typeof DecompressionStream === 'function';

/** A zlib stream inflated with DecompressionStream, or null if that fails or gives other than size bytes. */
async function inflateNative(data: Uint8Array, size: number): Promise<Uint8Array | null> {
	try {
		const stream = new DecompressionStream('deflate');
		const writer = stream.writable.getWriter();
		// Rejections show up on the reader too; these are only kept from going unhandled.
		writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
		writer.close().catch(() => {});
		const reader = stream.readable.getReader();
		const out = new Uint8Array(size);
		let length = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (length + value.length > size) {
				reader.cancel().catch(() => {});
				return null;
			}
			out.set(value, length);
			length += value.length;
		}
		return length === size ? out : null;
	} catch {
		return null;
	}
}

/** The key name of an encrypted ('E') chunk. Stored little-endian; given the way key lists write them. */
function chunkKeyName(block: Uint8Array): string {
	return toHex(block.slice(2, 2 + block[1]).reverse()).toUpperCase();
}

/**
 * An encrypted chunk decrypted, still with its own mode byte (it is another chunk inside), or null
 * without its key. Its nonce is the IV stored in it, the first four bytes XORed with the chunk's index.
 */
function decrypt(block: Uint8Array, index: number, keys: TactKeys | undefined): Uint8Array | null {
	const key = keys?.get(chunkKeyName(block));
	if (!key) return null;
	let p = 2 + block[1];
	const ivSize = block[p++];
	if (ivSize > 8) throw new Error(`Unsupported encrypted chunk IV size ${ivSize}`);
	const nonce = new Uint8Array(8);
	nonce.set(block.subarray(p, p + ivSize));
	p += ivSize;
	const type = block[p++];
	if (type !== 0x53) throw new Error(`Unsupported BLTE encryption type 0x${type.toString(16)}`); // 'S' Salsa20
	for (let i = 0; i < 4; i++) nonce[i] ^= (index >>> (i * 8)) & 0xff;
	return salsa20(key, nonce, block.subarray(p));
}

function decodeChunk(block: Uint8Array, decompressedSize: number, allowPartial: boolean, encryptedKeys: string[], index: number, keys: TactKeys | undefined): Uint8Array {
	switch (block[0]) {
		case 0x4e: // 'N' raw
			return block.subarray(1);
		case 0x5a: // 'Z' zlib
			return decompressedSize > 0
				? unzlibSync(block.subarray(1), { out: new Uint8Array(decompressedSize) })
				: unzlibSync(block.subarray(1));
		case 0x45: { // 'E' encrypted
			const decrypted = decrypt(block, index, keys);
			if (decrypted) return decodeChunk(decrypted, decompressedSize, allowPartial, encryptedKeys, index, keys);
			const keyName = chunkKeyName(block);
			if (!allowPartial || decompressedSize < 0) throw new EncryptedError(keyName);
			encryptedKeys.push(keyName);
			return new Uint8Array(decompressedSize);
		}
		case 0x46: // 'F' nested frame
			return decodeBlte(block.subarray(1), allowPartial, keys).data;
		default:
			throw new Error(`Unknown BLTE chunk mode 0x${block[0].toString(16)}`);
	}
}
