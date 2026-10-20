import type { SceneModel } from './sceneModel';
import { decodeScene, encodeScene, type DecodedScene } from './wscene';

/**
 * The local scene library (spec 7.11): OPFS holds one .wscene per scene, and an IndexedDB index
 * keeps what the scene list shows without opening the files. The persistence layer stays behind
 * this interface so a remote store can later sit beside it (spec 14.1).
 */
export interface SceneSummary {
	id: string;
	name: string;
	created: string;
	modified: string;
	size: { tilesX: number; tilesY: number };
	/** Whether the scene started blank or as a copy of the world. */
	kind: 'blank' | 'copied';
	/** 512x288 WebP render, when one has been made. */
	thumbnail: Blob | null;
}

const DB_NAME = 'dungeonBuilder';
const STORE = 'scenes';
const FOLDER = 'scenes';

function openIndex(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function indexOp<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openIndex().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const request = op(tx.objectStore(STORE));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
				tx.oncomplete = () => db.close();
			}),
	);
}

async function sceneFolder(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(FOLDER, { create: true });
}

export class SceneLibrary {
	/** Every saved scene, the most recently changed first. */
	async list(): Promise<SceneSummary[]> {
		const all = await indexOp<SceneSummary[]>('readonly', (store) => store.getAll() as IDBRequest<SceneSummary[]>);
		return all.sort((a, b) => b.modified.localeCompare(a.modified));
	}

	async has(id: string): Promise<boolean> {
		return (await indexOp('readonly', (store) => store.count(id))) > 0;
	}

	/** Serializes and stores a scene, replacing any saved version of it. */
	async save(model: SceneModel, thumbnail: Uint8Array | null = null): Promise<void> {
		const bytes = encodeScene(model, thumbnail);
		await this.saveBytes(model, bytes, thumbnail);
	}

	/** Stores already-serialized .wscene bytes (an import, or an autosave's encode reused). */
	async saveBytes(model: SceneModel, bytes: Uint8Array, thumbnail: Uint8Array | null = null): Promise<void> {
		const folder = await sceneFolder();
		const file = await folder.getFileHandle(`${model.meta.id}.wscene`, { create: true });
		const writable = await file.createWritable();
		await writable.write(bytes as Uint8Array<ArrayBuffer>);
		await writable.close();
		const summary: SceneSummary = {
			id: model.meta.id,
			name: model.meta.name,
			created: model.meta.created,
			modified: model.meta.modified,
			size: model.meta.size,
			kind: model.meta.base ? 'copied' : 'blank',
			thumbnail: thumbnail ? new Blob([thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/webp' }) : (await this.summary(model.meta.id))?.thumbnail ?? null,
		};
		await indexOp('readwrite', (store) => store.put(summary));
	}

	private summary(id: string): Promise<SceneSummary | undefined> {
		return indexOp<SceneSummary | undefined>('readonly', (store) => store.get(id) as IDBRequest<SceneSummary | undefined>);
	}

	/** The stored .wscene bytes, for opening or exporting. */
	async bytes(id: string): Promise<Uint8Array> {
		const folder = await sceneFolder();
		const file = await folder.getFileHandle(`${id}.wscene`).then((h) => h.getFile());
		return new Uint8Array(await file.arrayBuffer());
	}

	async load(id: string): Promise<DecodedScene> {
		return decodeScene(await this.bytes(id));
	}

	/** Validates and stores imported .wscene bytes; returns the scene. Replaces a scene with the same ID. */
	async import(bytes: Uint8Array): Promise<DecodedScene> {
		const decoded = decodeScene(bytes);
		await this.saveBytes(decoded.model, bytes, decoded.thumbnail);
		return decoded;
	}

	async delete(id: string): Promise<void> {
		const folder = await sceneFolder();
		await folder.removeEntry(`${id}.wscene`).catch(() => {});
		await indexOp('readwrite', (store) => store.delete(id));
	}
}
