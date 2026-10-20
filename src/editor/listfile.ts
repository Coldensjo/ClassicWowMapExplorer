import { kvGet, kvSet } from '../scene/db';

/**
 * The community listfile (spec 3.1, 7.1): the FDID → path mapping the asset browser's names and
 * search run on. It is fetched once from the community repository, narrowed to what the builder
 * needs, and cached in IndexedDB with its date; "Refresh listfile" fetches it again.
 */

/**
 * The community listfile's parts that hold tileset paths. The whole listfile is a 150 MB release
 * asset GitHub serves without CORS headers, but the repository splits it by category, and raw
 * repository files come with open CORS — so only the parts that matter are fetched (about 13 MB).
 */
const LISTFILE_URLS = [
	'https://raw.githubusercontent.com/wowdev/wow-listfile/master/parts/misc.csv',
	'https://raw.githubusercontent.com/wowdev/wow-listfile/master/parts/placeholder.csv',
];
const KV_KEY = 'listfile:tileset:2';

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
function wanted(path: string): boolean {
	return path.startsWith('tileset/') && path.endsWith('.blp') && !path.endsWith('_h.blp') && !path.endsWith('_s.blp');
}

let loading: Promise<ListfileEntry[]> | null = null;

/** When the cached listfile was fetched, for the refresh button's label; null before first fetch. */
export async function listfileDate(): Promise<string | null> {
	const cached = await kvGet<CachedListfile>(KV_KEY).catch(() => undefined);
	return cached?.date ?? null;
}

/**
 * The tileset entries of the listfile: from the cache when present, otherwise fetched and cached.
 * Failures reject; the browser then falls back to the scene's own palette.
 */
export function tilesetListfile(onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	loading ??= load(onProgress).catch((e) => {
		loading = null;
		throw e;
	});
	return loading;
}

/** Drops the cache and fetches the listfile afresh. */
export function refreshListfile(onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	loading = fetchListfile(onProgress).catch((e) => {
		loading = null;
		throw e;
	});
	return loading;
}

async function load(onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	const cached = await kvGet<CachedListfile>(KV_KEY).catch(() => undefined);
	if (cached?.entries?.length) return cached.entries.map(([fdid, path]) => ({ fdid, path }));
	return fetchListfile(onProgress);
}

/** Streams the listfile parts, keeping only the lines the builder needs. */
async function fetchListfile(onProgress?: (text: string) => void): Promise<ListfileEntry[]> {
	onProgress?.('Fetching the listfile…');
	const entries: [number, string][] = [];
	let bytes = 0;
	for (const url of LISTFILE_URLS) {
		const response = await fetch(url);
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
			for (const line of lines) addLine(entries, line);
		}
		addLine(entries, tail);
	}
	if (!entries.length) throw new Error('The listfile had no terrain textures in it');
	entries.sort((a, b) => a[1].localeCompare(b[1]));
	await kvSet(KV_KEY, { date: new Date().toISOString(), entries } satisfies CachedListfile).catch(() => {});
	onProgress?.('');
	return entries.map(([fdid, path]) => ({ fdid, path }));
}

function addLine(entries: [number, string][], line: string): void {
	const semi = line.indexOf(';');
	if (semi <= 0) return;
	const path = line.slice(semi + 1).trim().toLowerCase();
	if (!wanted(path)) return;
	const fdid = Number(line.slice(0, semi));
	if (Number.isInteger(fdid) && fdid > 0) entries.push([fdid, path]);
}
