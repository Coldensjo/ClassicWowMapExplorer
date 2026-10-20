import { kvGet, kvSet } from '../scene/db';

/**
 * The community listfile (spec 3.1, 7.1): the FDID → path mapping the asset browser's names and
 * search run on. It is fetched once from the community repository, narrowed to what the builder
 * needs, and cached in IndexedDB with its date; "Refresh listfile" fetches it again.
 *
 * The whole listfile is a 150 MB release asset GitHub serves without CORS headers, but the
 * repository splits it into parts by category, and raw repository files come with open CORS — so
 * only the parts that matter are fetched: the ones with tileset textures for the paint browser,
 * and the world object parts for the doodad and building browser (spec 7.3).
 */
const PARTS = 'https://raw.githubusercontent.com/wowdev/wow-listfile/master/parts/';

export interface ListfileEntry {
	fdid: number;
	path: string;
}

interface CachedListfile {
	date: string;
	entries: [number, string][];
}

/**
 * Keeps terrain textures: .blp files under tileset/ (spec 7.1 asset filtering). Height and
 * specular companions (_h, _s) are not paintable themselves — the client binds them to their
 * base texture — so they are left out.
 */
function wantedTexture(path: string): boolean {
	return path.startsWith('tileset/') && path.endsWith('.blp') && !path.endsWith('_h.blp') && !path.endsWith('_s.blp');
}

/** Keeps placeable doodads: .m2 files under world/ (spec 7.1 asset filtering). */
function wantedDoodad(path: string): boolean {
	return path.startsWith('world/') && path.endsWith('.m2');
}

/**
 * Keeps WMO root files (spec 7.1 asset filtering): not the _NNN group files, and not the _lod
 * variants of either, which are the same building at lower detail.
 */
function wantedWmo(path: string): boolean {
	return path.endsWith('.wmo') && !/(_\d{3}(_lod\d+)?|_lod\d*)\.wmo$/.test(path);
}

/** What each cached list is built from: the part files it needs, and the paths it keeps. */
const KINDS = {
	tileset: { key: 'listfile:tileset:2', parts: ['misc.csv', 'placeholder.csv'], wanted: wantedTexture },
	doodad: { key: 'listfile:doodads:1', parts: ['world.csv', 'placeholder.csv'], wanted: wantedDoodad },
	wmo: { key: 'listfile:wmos:1', parts: ['world-wmo.csv', 'placeholder.csv'], wanted: wantedWmo },
} as const;

export type ListfileKind = keyof typeof KINDS;

const loading = new Map<ListfileKind, Promise<ListfileEntry[]>>();

/** When the cached listfile was fetched, for the refresh button's label; null before first fetch. */
export async function listfileDate(kind: ListfileKind = 'tileset'): Promise<string | null> {
	const cached = await kvGet<CachedListfile>(KINDS[kind].key).catch(() => undefined);
	return cached?.date ?? null;
}

/**
 * One kind's entries of the listfile: from the cache when present, otherwise fetched and cached.
 * Failures reject; the browsers then fall back to what the scene already uses.
 */
export function listfile(kind: ListfileKind, onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	let entry = loading.get(kind);
	if (!entry) {
		entry = load(kind, onProgress).catch((e) => {
			loading.delete(kind);
			throw e;
		});
		loading.set(kind, entry);
	}
	return entry;
}

/** The tileset entries, for the paint browser (kept as its own call for the Phase 2 code). */
export function tilesetListfile(onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	return listfile('tileset', onProgress);
}

/** Drops a kind's cache and fetches the listfile afresh. */
export function refreshListfile(onProgress?: (text: string) => void, kind: ListfileKind = 'tileset'): Promise<ListfileEntry[]> {
	const fresh = fetchListfile(kind, onProgress).catch((e) => {
		loading.delete(kind);
		throw e;
	});
	loading.set(kind, fresh);
	return fresh;
}

async function load(kind: ListfileKind, onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	const cached = await kvGet<CachedListfile>(KINDS[kind].key).catch(() => undefined);
	if (cached?.entries?.length) return cached.entries.map(([fdid, path]) => ({ fdid, path }));
	return fetchListfile(kind, onProgress);
}

/** Streams the listfile parts, keeping only the lines the kind needs. */
async function fetchListfile(kind: ListfileKind, onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	const { key, parts, wanted } = KINDS[kind];
	onProgress?.('Fetching the listfile…');
	const entries: [number, string][] = [];
	let bytes = 0;
	for (const part of parts) {
		const response = await fetch(PARTS + part);
		if (!response.ok || !response.body) throw new Error(`The listfile couldn't be fetched (${response.status})`);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let tail = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.length;
			onProgress?.(`Reading the listfile… ${(bytes / 1048576).toFixed(0)} MB`);
			const text = tail + decoder.decode(value, { stream: true });
			const lines = text.split('\n');
			tail = lines.pop() ?? '';
			for (const line of lines) addLine(entries, line, wanted);
		}
		addLine(entries, tail, wanted);
	}
	if (!entries.length) throw new Error('The listfile had nothing the builder needs in it');
	entries.sort((a, b) => a[1].localeCompare(b[1]));
	await kvSet(key, { date: new Date().toISOString(), entries } satisfies CachedListfile).catch(() => {});
	onProgress?.('');
	return entries.map(([fdid, path]) => ({ fdid, path }));
}

function addLine(entries: [number, string][], line: string, wanted: (path: string) => boolean): void {
	const semi = line.indexOf(';');
	if (semi <= 0) return;
	const path = line.slice(semi + 1).trim().toLowerCase();
	if (!wanted(path)) return;
	const fdid = Number(line.slice(0, semi));
	if (Number.isInteger(fdid) && fdid > 0) entries.push([fdid, path]);
}
