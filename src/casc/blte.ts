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

/**
 * Decodes a BLTE stream. Encrypted chunks throw EncryptedError, unless allowPartial is set,
 * in which case they are zero-filled and reported in encryptedKeys.
 */
export function decodeBlte(input: Uint8Array, allowPartial = false): BlteResult {
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

	let offset = headerSize === 0 ? 8 : headerSize;
	const parts: Uint8Array[] = [];
	const encryptedKeys: string[] = [];
	for (const chunk of chunks) {
		const block = input.subarray(offset, offset + chunk.compressedSize);
		offset += chunk.compressedSize;
		parts.push(decodeChunk(block, chunk.decompressedSize, allowPartial, encryptedKeys));
	}
	return { data: concatBytes(parts), encryptedKeys };
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
