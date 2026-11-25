import { expect, test } from 'bun:test';
import { BROADCAST_TEXT_TABLE, KEY_FILE_NAME, KeyCollector, keyName, readHotfixCache, readKeyFile, readKeyTable } from '../src/casc/tactKeys';

const hex = (bytes: Uint8Array | undefined) => (bytes ? [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase() : undefined);
const KEY = 'D31C74FE3705AF574888E4A230785481';
const NAME = 'D2C028CB7AC14D0B';
/** The name as the table stores it: little-endian. */
const NAME_BYTES = Uint8Array.from(NAME.match(/../g)!.reverse().map((b) => parseInt(b, 16)));
const KEY_BYTES = Uint8Array.from(KEY.match(/../g)!.map((b) => parseInt(b, 16)));

test('a name is written the way key lists write it, from its little-endian bytes', () => {
	expect(keyName(NAME_BYTES)).toBe(NAME);
});

test('lines of a name and a key, as key lists write them', () => {
	const collector = new KeyCollector();
	readKeyFile(`# comment\n\n${NAME} ${KEY}\n0001C772CCC21F2D b73abb11de6555035dd8bb38d32adbd3\nnot a key line\n`, collector);
	const keys = collector.build();
	expect(keys.size).toBe(2);
	expect(hex(keys.get(NAME))).toBe(KEY);
	expect(hex(keys.get('0001C772CCC21F2D'))).toBe('B73ABB11DE6555035DD8BB38D32ADBD3');
});

test('a name and a key separated by a comma or a semicolon, and a byte order mark', () => {
	const collector = new KeyCollector();
	readKeyFile(`\uFEFF${NAME};${KEY}\r\n0001C772CCC21F2D,b73abb11de6555035dd8bb38d32adbd3\r\n`, collector);
	expect(collector.build().size).toBe(2);
});

test('a line with a wrong name or key length is skipped', () => {
	const collector = new KeyCollector();
	readKeyFile(`${NAME} ${KEY.slice(2)}\n${NAME.slice(2)} ${KEY}\n${NAME} ${KEY} extra\n`, collector);
	expect(collector.build().size).toBe(0);
});

test('the CSVs of the two tables are joined by ID, a byte to a column', () => {
	const collector = new KeyCollector();
	const bytes = (b: Uint8Array) => [...b].join(',');
	readKeyFile(`ID,Key_0,Key_1,Key_2,Key_3,Key_4,Key_5,Key_6,Key_7,Key_8,Key_9,Key_10,Key_11,Key_12,Key_13,Key_14,Key_15\n8283,${bytes(KEY_BYTES)}\n`, collector);
	// The names' table has an ID with no key, which is left out.
	readKeyFile(`ID,TACTID_0,TACTID_1,TACTID_2,TACTID_3,TACTID_4,TACTID_5,TACTID_6,TACTID_7\n8283,${bytes(NAME_BYTES)}\n9000,1,2,3,4,5,6,7,8\n`, collector);
	const keys = collector.build();
	expect(keys.size).toBe(1);
	expect(hex(keys.get(NAME))).toBe(KEY);
});

test('the CSVs of wow.tools.local, whose columns are Key[0] and TACTID[0] and lines end in CRLF', () => {
	const collector = new KeyCollector();
	const bytes = (b: Uint8Array) => [...b].join(',');
	readKeyFile(`ID,${Array.from({ length: 16 }, (_, i) => `Key[${i}]`).join(',')}\r\n8283,${bytes(KEY_BYTES)}\r\n`, collector);
	readKeyFile(`ID,${Array.from({ length: 8 }, (_, i) => `TACTID[${i}]`).join(',')}\r\n8283,${bytes(NAME_BYTES)}\r\n`, collector);
	expect(hex(collector.build().get(NAME))).toBe(KEY);
});

test('a CSV row with a byte out of range or too few bytes is skipped', () => {
	const collector = new KeyCollector();
	readKeyFile('ID,TACTID_0,TACTID_1,TACTID_2,TACTID_3,TACTID_4,TACTID_5,TACTID_6,TACTID_7\n1,1,2,3,4,5,6,7,300\n2,1,2,3\n', collector);
	readKeyFile('ID,Key_0\n1,1\n2,2\n', collector);
	expect(collector.build().size).toBe(0);
});

test('a name from one source and its key from another are joined, and the later one for an ID stands', () => {
	const collector = new KeyCollector();
	collector.addName(8283, NAME_BYTES);
	collector.addKey(8283, new Uint8Array(16).fill(7));
	expect(hex(collector.build().get(NAME))).toBe('07070707070707070707070707070707');
	collector.addKey(8283, KEY_BYTES);
	expect(hex(collector.build().get(NAME))).toBe(KEY);
});

test('a table is read row by row, by ID', () => {
	const rows = new Map([[5, NAME_BYTES], [6, KEY_BYTES]]);
	const table = { ids: () => [...rows.keys()], recordBytes: (id: number) => rows.get(id) ?? null };
	const collector = new KeyCollector();
	readKeyTable(table, 'names', collector);
	collector.addKey(5, KEY_BYTES);
	expect(hex(collector.build().get(NAME))).toBe(KEY);
});

const KEYS_TABLE = 0xdf2f53cf;
const NAMES_TABLE = 0xafc190d1;

/** A hotfix cache: its header, then rows of [table, ID, status, data]. */
function cache(rows: [number, number, number, Uint8Array][], header = 'XFTH', version = 9): Uint8Array {
	const parts: number[] = [];
	const u32 = (x: number) => parts.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
	const magic = (text: string) => parts.push(...new TextEncoder().encode(text));
	magic(header);
	u32(version); u32(70862);
	parts.push(...new Array(32).fill(0));
	for (const [table, id, status, data] of rows) {
		magic('XFTH');
		u32(0); u32(113454); u32(0); u32(table); u32(id); u32(data.length);
		parts.push(status, 0, 0, 0, ...data);
	}
	return Uint8Array.from(parts);
}

test('the hotfix cache gives the rows of the two tables that are valid', () => {
	const collector = new KeyCollector();
	readHotfixCache(cache([
		[0x12345678, 1, 1, new Uint8Array(40)],
		[NAMES_TABLE, 8283, 1, NAME_BYTES],
		[KEYS_TABLE, 8283, 1, KEY_BYTES],
		// A key not public yet: no data, and not valid.
		[KEYS_TABLE, 9000, 4, new Uint8Array(0)],
		[NAMES_TABLE, 9000, 1, NAME_BYTES.map((b) => b ^ 1)],
	]), { keys: KEYS_TABLE, names: NAMES_TABLE }, collector);
	const keys = collector.build();
	expect(keys.size).toBe(1);
	expect(hex(keys.get(NAME))).toBe(KEY);
});

test('a file that is not a hotfix cache, or is cut short, adds only what is whole', () => {
	const collector = new KeyCollector();
	const tables = { keys: KEYS_TABLE, names: NAMES_TABLE };
	readHotfixCache(cache([[KEYS_TABLE, 1, 1, KEY_BYTES]], 'NOPE'), tables, collector);
	readHotfixCache(new Uint8Array(10), tables, collector);
	const whole = cache([[NAMES_TABLE, 1, 1, NAME_BYTES], [KEYS_TABLE, 1, 1, KEY_BYTES]]);
	readHotfixCache(whole.subarray(0, whole.length - 5), tables, collector);
	expect(collector.build().size).toBe(0);
	readHotfixCache(whole, tables, collector);
	expect(collector.build().size).toBe(1);
});

/** A BroadcastText row: two strings and some fields, then (for one that carries a key) the TACTKey hash, the name and the key. */
function broadcastText(text: string, tail?: { hash?: number; name: Uint8Array; key: Uint8Array }): Uint8Array {
	const fields = new Uint8Array(46).fill(7);
	const parts = [...new TextEncoder().encode(text), 0, 0, ...fields];
	if (tail) {
		const hash = tail.hash ?? KEYS_TABLE;
		parts.push(hash & 255, (hash >>> 8) & 255, (hash >>> 16) & 255, (hash >>> 24) & 255, ...tail.name, ...tail.key);
	}
	return Uint8Array.from(parts);
}

test('a key at the end of a BroadcastText row is read, whatever its text and fields', () => {
	const collector = new KeyCollector();
	readHotfixCache(cache([
		[BROADCAST_TEXT_TABLE, 1, 1, broadcastText('A line anyone can read.')],
		[BROADCAST_TEXT_TABLE, 2, 1, broadcastText('Ruled by the child king.', { name: NAME_BYTES, key: KEY_BYTES })],
		[BROADCAST_TEXT_TABLE, 3, 1, broadcastText('', { name: NAME_BYTES.map((b) => b ^ 1), key: KEY_BYTES })],
	]), { keys: KEYS_TABLE, names: NAMES_TABLE }, collector);
	const keys = collector.build();
	expect(keys.size).toBe(2);
	expect(hex(keys.get(NAME))).toBe(KEY);
});

test('a BroadcastText row with no key tail, a different hash there, too short, or not valid adds nothing', () => {
	const collector = new KeyCollector();
	const tail = { name: NAME_BYTES, key: KEY_BYTES };
	readHotfixCache(cache([
		[BROADCAST_TEXT_TABLE, 1, 1, broadcastText('x', { ...tail, hash: 0x12345678 })],
		[BROADCAST_TEXT_TABLE, 2, 1, new Uint8Array(20)],
		[BROADCAST_TEXT_TABLE, 3, 4, broadcastText('x', tail)],
		[0x12345678, 4, 1, broadcastText('x', tail)],
	]), { keys: KEYS_TABLE, names: NAMES_TABLE }, collector);
	expect(collector.build().size).toBe(0);
});

test('a cache of another version is not read', () => {
	const collector = new KeyCollector();
	readHotfixCache(cache([[KEYS_TABLE, 1, 1, KEY_BYTES], [NAMES_TABLE, 1, 1, NAME_BYTES]], 'XFTH', 8), { keys: KEYS_TABLE, names: NAMES_TABLE }, collector);
	expect(collector.build().size).toBe(0);
});

test('only tactkey lists of .txt or .csv beside the app are read', () => {
	for (const name of ['tactkeys.txt', 'TactKey.1.60.1.70862.csv', 'TactKeyLookup.1.60.1.70862.csv', 'tactkey.TXT']) expect(KEY_FILE_NAME.test(name)).toBe(true);
	for (const name of ['tactkeys', 'tactkeys.json', 'keys.txt', 'my tactkeys.txt', '../tactkeys.txt', 'tactkeys/x.txt', 'tactkeys\\x.txt']) expect(KEY_FILE_NAME.test(name)).toBe(false);
});
