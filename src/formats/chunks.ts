export interface Chunk {
	id: string;
	/** Offset of the chunk payload (after the 8-byte header). */
	offset: number;
	size: number;
}

/** Iterates IFF-style chunks. Chunk ids are stored byte-reversed on disk ("REVM" = MVER). */
export function* chunks(bytes: Uint8Array, start = 0, end = bytes.length): Generator<Chunk> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let pos = start;
	while (pos + 8 <= end) {
		const id = String.fromCharCode(bytes[pos + 3], bytes[pos + 2], bytes[pos + 1], bytes[pos]);
		const size = view.getUint32(pos + 4, true);
		yield { id, offset: pos + 8, size };
		pos += 8 + size;
	}
}

export function findChunk(bytes: Uint8Array, id: string): Chunk | null {
	for (const c of chunks(bytes)) if (c.id === id) return c;
	return null;
}
