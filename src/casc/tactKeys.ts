import { parseKey, type TactKeys } from './blte';
import { toHex } from './reader';

/** FDIDs of TACTKey.db2 (the keys, 16 bytes a row) and TACTKeyLookup.db2 (their names, 8 bytes a row), the same in every Classic build. */
export const TACT_KEY_FDID = 1302850;
export const TACT_KEY_LOOKUP_FDID = 1302851;

/** A key's name from its 8 stored bytes: little-endian, written the way key lists write it. */
export function keyName(bytes: Uint8Array): string {
	return toHex(bytes.slice(0, 8).reverse()).toUpperCase();
}

/**
 * TACT keys gathered from several places. The tables keep a key and its name apart, joined by the
 * row's ID, so they can come from different sources (a name in the game's table, its key in the
 * hotfix cache); the one added last for an ID stands.
 */
export class KeyCollector {
	private readonly names = new Map<number, string>();
	private readonly keys = new Map<number, Uint8Array>();
	private readonly pairs = new Map<string, Uint8Array>();

	addName(id: number, bytes: Uint8Array): void {
		if (bytes.length >= 8) this.names.set(id, keyName(bytes));
	}

	addKey(id: number, bytes: Uint8Array): void {
		if (bytes.length >= 16) this.keys.set(id, bytes.slice(0, 16));
	}

	addPair(name: string, key: Uint8Array): void {
		this.pairs.set(name.toUpperCase(), key);
	}

	/** The keys by name: those whose ID has both a name and a key, and the plain pairs. */
	build(): TactKeys {
		const result = new Map(this.pairs);
		for (const [id, key] of this.keys) {
			const name = this.names.get(id);
			if (name) result.set(name, key);
		}
		return result;
	}
}

/**
 * Adds the keys of a list a user put beside the app. Either lines of a name and a key (32 hex digits)
 * separated by spaces, commas or semicolons, as key lists write them; or the CSV of the two tables
 * (TactKey.csv, TactKeyLookup.csv as wow.tools exports them), a byte to a column, joined by ID.
 */
export function readKeyFile(text: string, into: KeyCollector): void {
	let table: 'keys' | 'names' | null = null;
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const header = line.match(/^id\s*,\s*(key|tactid)_?\d*\b/i);
		if (header) {
			table = header[1].toLowerCase() === 'key' ? 'keys' : 'names';
			continue;
		}
		const cells = line.split(/[\s,;]+/);
		if (table && /^\d+$/.test(cells[0])) {
			const [id, ...bytes] = cells.map(Number);
			if (bytes.length >= (table === 'keys' ? 16 : 8) && bytes.every((b) => b >= 0 && b <= 255)) {
				if (table === 'keys') into.addKey(id, Uint8Array.from(bytes));
				else into.addName(id, Uint8Array.from(bytes));
			}
			continue;
		}
		const key = cells.length === 2 && /^[0-9a-f]{16}$/i.test(cells[0]) ? parseKey(cells[1]) : null;
		if (key) into.addPair(cells[0], key);
	}
}

/** The tables' hashes, which a hotfix cache names its rows by (Db2.tableHash of the two tables). */
export interface KeyTableHashes {
	keys: number;
	names: number;
}

const CACHE_MAGIC = 0x48544658; // 'XFTH', which starts the file and each row after it
const CACHE_VERSION = 9;
const CACHE_HEADER = 44;
const CACHE_ROW_HEADER = 32;
const ROW_VALID = 1;

/** The table hash of BroadcastText, some of whose rows carry a TACT key after their own fields (see readKeyTail; the format is in the "DBCache.bin" section of https://wowdev.wiki/ADB). */
export const BROADCAST_TEXT_TABLE = 0x021826bb;
/** What such a row ends with: the hash of the TACTKey table, a key's name (8 bytes) and the key (16). */
const KEY_TAIL = 4 + 8 + 16;

/** Adds the key a BroadcastText row carries at its end, if it carries one. */
function readKeyTail(row: Uint8Array, keysTable: number, into: KeyCollector): void {
	if (row.length < KEY_TAIL) return;
	const tail = row.subarray(row.length - KEY_TAIL);
	if (new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, true) !== keysTable) return;
	into.addPair(keyName(tail.subarray(4, 12)), tail.slice(12));
}

/**
 * Adds the TACT keys the hotfix cache (Cache/ADB/<locale>/DBCache.bin) holds: the rows the server
 * pushed for the two key tables, and the keys hidden in the ends of BroadcastText rows, which the
 * game's own tables may not have yet. Other rows are skipped; a file that isn't a cache of the
 * version read here adds nothing.
 */
export function readHotfixCache(bytes: Uint8Array, tables: KeyTableHashes, into: KeyCollector): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < CACHE_HEADER || view.getUint32(0, true) !== CACHE_MAGIC || view.getUint32(4, true) !== CACHE_VERSION) return;
	let p = CACHE_HEADER;
	while (p + CACHE_ROW_HEADER <= bytes.length && view.getUint32(p, true) === CACHE_MAGIC) {
		const table = view.getUint32(p + 16, true);
		const id = view.getUint32(p + 20, true);
		const size = view.getUint32(p + 24, true);
		const status = bytes[p + 28];
		const data = bytes.subarray(p + CACHE_ROW_HEADER, p + CACHE_ROW_HEADER + size);
		if (status === ROW_VALID && table === tables.keys) into.addKey(id, data);
		else if (status === ROW_VALID && table === tables.names) into.addName(id, data);
		else if (status === ROW_VALID && table === BROADCAST_TEXT_TABLE) readKeyTail(data, tables.keys, into);
		p += CACHE_ROW_HEADER + size;
	}
}

/** Adds the rows of the game's own TACTKey and TACTKeyLookup tables. `ids` and `record` are the table's (Db2.ids, Db2.recordBytes). */
export function readKeyTable(table: { ids(): number[]; recordBytes(id: number): Uint8Array | null }, kind: 'keys' | 'names', into: KeyCollector): void {
	for (const id of table.ids()) {
		const bytes = table.recordBytes(id);
		if (!bytes) continue;
		if (kind === 'keys') into.addKey(id, bytes);
		else into.addName(id, bytes);
	}
}

/** The names of the key lists beside the app: TactKey.csv, tactkeys.txt and the like. */
export const KEY_FILE_NAME = /^tactkey[^/\\]*\.(txt|csv)$/i;
