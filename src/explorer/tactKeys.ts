import type { TactKeys } from '../casc/blte';
import { readBuildInfo } from '../casc/config';
import type { FileSource } from '../casc/source';
import type { CascStorage } from '../casc/storage';
import { KEY_FILE_NAME, KeyCollector, TACT_KEY_FDID, TACT_KEY_LOOKUP_FDID, readHotfixCache, readKeyFile, readKeyTable } from '../casc/tactKeys';
import { Db2 } from '../formats/db2';

/** Where the keys came from, and how many: for the log. */
export interface KeyReport {
	/** The game's own tables and the hotfix caches beside them. */
	game: number;
	/** Entered by the user in the page. */
	entered: number;
	/** The lists beside the app (and how many files). */
	files: number;
	fileCount: number;
}

/** The folder a product's game files and cache are in: _retail_, _classic_era_, _forever_. */
export function productFolder(product: string): string | null {
	const special: Record<string, string> = { wow: 'retail', wowt: 'ptr', wowxptr: 'xptr', wowf: 'forever' };
	const name = special[product] ?? product.match(/^wow_(.+)$/)?.[1];
	return name ? `_${name}_` : null;
}

async function readAll(source: FileSource, path: string[]): Promise<Uint8Array> {
	const file = await source.openFile(path);
	return file.read(0, file.size);
}

async function readTable(storage: CascStorage, fdid: number): Promise<Db2 | null> {
	if (storage.status(fdid) !== 'ok') return null;
	try {
		return new Db2((await storage.readFileWithStatus(fdid, true)).data);
	} catch (e) {
		console.warn(`TACT key table ${fdid} unreadable:`, e);
		return null;
	}
}

/**
 * The folders of the install's products (the open one first) that can have a hotfix cache. A key
 * is the same in every product, so the caches of all of them count.
 */
async function productFolders(source: FileSource, product: string): Promise<string[]> {
	let installed: string[] = [];
	try {
		installed = (await readBuildInfo(source)).map((p) => p.product);
	} catch {
		// No list of products: the open one alone.
	}
	return [...new Set([product, ...installed].map(productFolder).filter((folder): folder is string => !!folder))];
}

/** The keys the game has: its tables, then what the hotfix caches of every product and locale add (the keys pushed since the build). */
async function gameKeys(storage: CascStorage, source: FileSource, product: string): Promise<KeyCollector> {
	const collector = new KeyCollector();
	const [keys, names] = await Promise.all([readTable(storage, TACT_KEY_FDID), readTable(storage, TACT_KEY_LOOKUP_FDID)]);
	if (!keys || !names) return collector;
	readKeyTable(names, 'names', collector);
	readKeyTable(keys, 'keys', collector);
	for (const folder of await productFolders(source, product)) {
		let locales: string[];
		try {
			locales = await source.listDir([folder, 'Cache', 'ADB']);
		} catch {
			continue;
		}
		for (const locale of locales) {
			try {
				readHotfixCache(await readAll(source, [folder, 'Cache', 'ADB', locale, 'DBCache.bin']), { keys: keys.tableHash, names: names.tableHash }, collector);
			} catch {
				// A locale with no cache, or one that can't be read: the others still count.
			}
		}
	}
	return collector;
}

/**
 * The lists the user put beside the app (the folder the launcher or the dev server runs from),
 * which they serve under __keys/. Nothing there, or a server that has no such path, is no keys.
 */
async function listedKeys(pageUrl: string): Promise<{ keys: TactKeys; files: number }> {
	const collector = new KeyCollector();
	let names: string[] = [];
	try {
		const base = new URL('__keys/', pageUrl || location.href);
		const response = await fetch(base);
		if (response.ok && !response.headers.get('Content-Type')?.includes('text/html')) {
			names = (await response.text()).split(/\r?\n/).filter((name) => KEY_FILE_NAME.test(name)).sort();
		}
		for (const name of names) {
			const file = await fetch(new URL(encodeURIComponent(name), base));
			if (file.ok) readKeyFile(await file.text(), collector);
		}
	} catch (e) {
		console.warn('Key lists beside the app unreadable:', e);
	}
	return { keys: collector.build(), files: names.length };
}

/**
 * Every TACT key to hand the storage: the game's own first (its tables, then its hotfix caches),
 * then those the user entered in the page, then the lists beside the app, which fill in only
 * what's still missing.
 */
export async function loadTactKeys(storage: CascStorage, source: FileSource, product: string, pageUrl: string, entered: TactKeys): Promise<{ keys: TactKeys; report: KeyReport }> {
	const game = (await gameKeys(storage, source, product)).build();
	const listed = await listedKeys(pageUrl);
	const keys = new Map(game);
	for (const [name, key] of entered) if (!keys.has(name)) keys.set(name, key);
	const beforeFiles = keys.size;
	for (const [name, key] of listed.keys) if (!keys.has(name)) keys.set(name, key);
	return { keys, report: { game: game.size, entered: entered.size, files: keys.size - beforeFiles, fileCount: listed.files } };
}
