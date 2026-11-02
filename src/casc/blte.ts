import { unzlibSync } from 'fflate';
import { Reader, concatBytes, toHex } from './reader';

const BLTE_MAGIC = 0x424c5445;

export class EncryptedError extends Error {
	constructor(readonly keyName: string) {
		super(`Encrypted with TACT key ${keyName}`);
		this.name = 'EncryptedError';
	}
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
 * Decodes a BLTE stream. Encrypted chunks throw EncryptedError, unless allowPartial is set,
 * in which case they are zero-filled and reported in encryptedKeys.
 */
export function decodeBlte(input: Uint8Array, allowPartial = false): BlteResult {
	const { chunks, offset: start } = readHeader(input);
	let offset = start;
	const parts: Uint8Array[] = [];
	const encryptedKeys: string[] = [];
	for (const chunk of chunks) {
		const block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		parts.push(decodeChunk(block, chunk.decompressedSize, allowPartial, encryptedKeys));
	}
	return { data: concatBytes(parts), encryptedKeys };
}

/**
 * decodeBlte, with zlib chunks inflated by the browser's own DecompressionStream where there is
 * one: native zlib is over twice as fast as fflate's, and it is most of the time spent reading
 * files. A chunk it can't inflate, or inflates to other than the size the header gives, goes to
 * fflate as before, so the result (and any error) is the same as decodeBlte's.
 */
export async function decodeBlteAsync(input: Uint8Array, allowPartial = false): Promise<BlteResult> {
	if (!NATIVE_INFLATE) return decodeBlte(input, allowPartial);
	const { chunks, offset: start } = readHeader(input);
	let offset = start;
	const parts: Uint8Array[] = [];
	const encryptedKeys: string[] = [];
	for (const chunk of chunks) {
		const block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		let part: Uint8Array | null = null;
		if (block[0] === 0x5a && chunk.decompressedSize > 0) part = await inflateNative(block.subarray(1), chunk.decompressedSize);
		else if (block[0] === 0x46) part = (await decodeBlteAsync(block.subarray(1), allowPartial)).data;
		parts.push(part ?? decodeChunk(block, chunk.decompressedSize, allowPartial, encryptedKeys));
	}
	return { data: concatBytes(parts), encryptedKeys };
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

function decodeChunk(block: Uint8Array, decompressedSize: number, allowPartial: boolean, encryptedKeys: string[]): Uint8Array {
	switch (block[0]) {
		case 0x4e: // 'N' raw
			return block.subarray(1);
		case 0x5a: // 'Z' zlib
			return decompressedSize > 0
				? unzlibSync(block.subarray(1), { out: new Uint8Array(decompressedSize) })
				: unzlibSync(block.subarray(1));
		case 0x45: { // 'E' encrypted
			const keyNameSize = block[1];
			// Key names are stored little-endian; display them the way key lists write them.
			const keyName = toHex(block.slice(2, 2 + keyNameSize).reverse()).toUpperCase();
			if (!allowPartial || decompressedSize < 0) throw new EncryptedError(keyName);
			encryptedKeys.push(keyName);
			return new Uint8Array(decompressedSize);
		}
		case 0x46: // 'F' nested frame
			return decodeBlte(block.subarray(1), allowPartial).data;
		default:
			throw new Error(`Unknown BLTE chunk mode 0x${block[0].toString(16)}`);
	}
}
