/**
 * The builder's IndexedDB: the scene index (spec 7.11), and a key-value store for cached data
 * that outlives a session: the filtered listfile, the ground effect table and thumbnails
 * (spec 3.1, 7.3, 7.7.2).
 */
const DB_NAME = 'dungeonBuilder';
const VERSION = 2;

export const SCENE_STORE = 'scenes';
export const KV_STORE = 'kv';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(SCENE_STORE)) db.createObjectStore(SCENE_STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export function dbOp<T>(store: string, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(store, mode);
				const request = op(tx.objectStore(store));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
				tx.oncomplete = () => db.close();
			}),
	);
}

/** Reads a cached value; undefined when nothing is stored under the key. */
export function kvGet<T>(key: string): Promise<T | undefined> {
	return dbOp<T | undefined>(KV_STORE, 'readonly', (store) => store.get(key) as IDBRequest<T | undefined>);
}

export function kvSet(key: string, value: unknown): Promise<unknown> {
	return dbOp(KV_STORE, 'readwrite', (store) => store.put(value, key));
}

export function kvDelete(key: string): Promise<unknown> {
	return dbOp(KV_STORE, 'readwrite', (store) => store.delete(key));
}
