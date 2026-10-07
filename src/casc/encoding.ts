import { Reader, compareBytes } from './reader';

/**
 * The encoding table maps content keys (what the root file stores) to encoding keys
 * (what the local index stores). Pages are kept raw and searched on demand, since the
 * table has millions of entries.
 */
export class EncodingTable {
	private constructor(
		private readonly data: Uint8Array,
		private readonly pageFirstKeys: Uint8Array,
		private readonly pagesStart: number,
		private readonly pageSize: number,
		readonly pageCount: number,
	) {}

	static parse(data: Uint8Array): EncodingTable {
		const r = new Reader(data);
		if (r.u16be() !== 0x454e) throw new Error('Not an encoding file');
		r.u8(); // version
		const ckeySize = r.u8();
		const ekeySize = r.u8();
		const cePageSizeKB = r.u16be();
		r.u16be(); // espec page size
		const cePageCount = r.u32be();
		r.u32be(); // espec page count
		r.u8();
		const especBlockSize = r.u32be();
		if (ckeySize !== 16 || ekeySize !== 16) throw new Error('Unsupported encoding key size');

		r.skip(especBlockSize);
		const pageFirstKeys = new Uint8Array(cePageCount * 16);
		for (let i = 0; i < cePageCount; i++) {
			pageFirstKeys.set(r.take(16), i * 16);
			r.skip(16); // page md5
		}
		return new EncodingTable(data, pageFirstKeys, r.pos, cePageSizeKB * 1024, cePageCount);
	}

	/** Returns the first encoding key for a content key, or null if unknown. */
	lookup(ckey: Uint8Array): Uint8Array | null {
		return this.lookupAll(ckey)[0] ?? null;
	}

	/** Returns every encoding key for a content key (empty if unknown). */
	lookupAll(ckey: Uint8Array): Uint8Array[] {
		// Find the last page whose first key is <= ckey.
		let lo = 0;
		let hi = this.pageCount - 1;
		let page = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			if (compareBytes(this.pageFirstKeys, mid * 16, ckey, 0, 16) <= 0) {
				page = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (page < 0) return [];

		const data = this.data;
		let pos = this.pagesStart + page * this.pageSize;
		const end = pos + this.pageSize;
		while (pos + 22 <= end) {
			const keyCount = data[pos];
			if (keyCount === 0) break;
			const ckeyPos = pos + 6; // after key count and 40-bit file size
			const cmp = compareBytes(data, ckeyPos, ckey, 0, 16);
			if (cmp === 0) return Array.from({ length: keyCount }, (_, i) => data.slice(ckeyPos + 16 + i * 16, ckeyPos + 32 + i * 16));
			if (cmp > 0) break;
			pos = ckeyPos + 16 + keyCount * 16;
		}
		return [];
	}
}
