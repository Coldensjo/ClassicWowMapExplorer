import { Reader, compareBytes } from './reader';

export const INDEX_KEY_SIZE = 9;

export interface IndexEntry {
	archive: number;
	offset: number;
	size: number;
}

/** One Data/data/XXvvvvvvvv.idx file: truncated encoding keys sorted for binary search. */
class IndexBucket {
	constructor(
		readonly keys: Uint8Array,
		readonly archive: Uint16Array,
		readonly offset: Uint32Array,
		readonly size: Uint32Array,
	) {}

	get count(): number {
		return this.archive.length;
	}

	find(ekey: Uint8Array): IndexEntry | null {
		let lo = 0;
		let hi = this.count - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const cmp = compareBytes(this.keys, mid * INDEX_KEY_SIZE, ekey, 0, INDEX_KEY_SIZE);
			if (cmp === 0) return { archive: this.archive[mid], offset: this.offset[mid], size: this.size[mid] };
			if (cmp < 0) lo = mid + 1;
			else hi = mid - 1;
		}
		return null;
	}

	static parse(bytes: Uint8Array): IndexBucket {
		const r = new Reader(bytes);
		const headerSize = r.u32();
		r.u32(); // header hash
		const version = r.u16();
		r.u8(); // bucket
		r.u8(); // extra bytes
		const sizeBytes = r.u8();
		const offsetBytes = r.u8();
		const keyBytes = r.u8();
		const offsetBits = r.u8();
		if (version !== 7 || sizeBytes !== 4 || offsetBytes !== 5 || keyBytes !== INDEX_KEY_SIZE) {
			throw new Error(`Unsupported local index layout (v${version}, ${keyBytes}/${offsetBytes}/${sizeBytes})`);
		}
		r.seek((8 + headerSize + 0x0f) & ~0x0f);
		const dataLength = r.u32();
		r.u32(); // data hash
		const entrySize = keyBytes + offsetBytes + sizeBytes;
		const count = Math.floor(dataLength / entrySize);
		const start = r.pos;
		const offsetMask = 2 ** offsetBits - 1;

		// Entries are expected in key order; sort a permutation if not.
		let sorted = true;
		for (let i = 1; i < count && sorted; i++) {
			if (compareBytes(bytes, start + (i - 1) * entrySize, bytes, start + i * entrySize, keyBytes) > 0) sorted = false;
		}
		let order: Uint32Array | null = null;
		if (!sorted) {
			order = new Uint32Array(count).map((_, i) => i);
			order.sort((a, b) => compareBytes(bytes, start + a * entrySize, bytes, start + b * entrySize, keyBytes));
		}

		const keys = new Uint8Array(count * keyBytes);
		const archive = new Uint16Array(count);
		const offset = new Uint32Array(count);
		const size = new Uint32Array(count);
		for (let i = 0; i < count; i++) {
			const e = start + (order ? order[i] : i) * entrySize;
			keys.set(bytes.subarray(e, e + keyBytes), i * keyBytes);
			// 40-bit big-endian location: archive number in the high bits, offset in the low offsetBits.
			const hi = bytes[e + keyBytes];
			const lo = r.view.getUint32(e + keyBytes + 1, false);
			const location = hi * 0x100000000 + lo;
			archive[i] = Math.floor(location / 2 ** offsetBits);
			offset[i] = location % (offsetMask + 1);
			size[i] = r.view.getUint32(e + keyBytes + offsetBytes, true);
		}
		return new IndexBucket(keys, archive, offset, size);
	}
}

export function bucketOf(ekey: Uint8Array): number {
	let x = 0;
	for (let i = 0; i < INDEX_KEY_SIZE; i++) x ^= ekey[i];
	return (x & 0x0f) ^ (x >> 4);
}

/** The local storage's map from encoding key to a location in a data.### archive. */
export class LocalIndex {
	private readonly buckets: (IndexBucket | null)[] = new Array(16).fill(null);

	addBucket(bucket: number, bytes: Uint8Array): void {
		this.buckets[bucket] = IndexBucket.parse(bytes);
	}

	get entryCount(): number {
		return this.buckets.reduce((n, b) => n + (b?.count ?? 0), 0);
	}

	find(ekey: Uint8Array): IndexEntry | null {
		return this.buckets[bucketOf(ekey)]?.find(ekey) ?? null;
	}
}
