import { dbOp, SCENE_STORE } from './db';
import type { SceneModel } from './sceneModel';
import type { Scene } from './types';
import { copySceneFile, decodeFile, encodeScene, readSceneFile } from './wscene';

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

const FOLDER = 'scenes';

function indexOp<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return dbOp(SCENE_STORE, mode, op);
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

	/**
	 * Validates and stores imported .wscene bytes; returns the scene. Replaces a scene with the
	 * same ID. A blank scene is validated whole; a copied one only as far as its container goes,
	 * since full validation needs its source map, which opening it reads (spec 6.5).
	 */
	async import(bytes: Uint8Array): Promise<Scene> {
		const file = readSceneFile(bytes);
		if (!file.scene.base) decodeFile(file);
		const scene = file.scene;
		if (typeof scene.id !== 'string' || !/^[0-9a-zA-Z-]{1,64}$/.test(scene.id)) throw new Error('Not a scene: bad scene id');
		const folder = await sceneFolder();
		const handle = await folder.getFileHandle(`${scene.id}.wscene`, { create: true });
		const writable = await handle.createWritable();
		await writable.write(bytes as Uint8Array<ArrayBuffer>);
		await writable.close();
		const summary: SceneSummary = {
			id: scene.id,
			name: scene.name,
			created: scene.created,
			modified: scene.modified,
			size: scene.size,
			kind: scene.base ? 'copied' : 'blank',
			thumbnail: file.thumbnail ? new Blob([file.thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/webp' }) : null,
		};
		await indexOp('readwrite', (store) => store.put(summary));
		return scene;
	}

	/** Stores a copy of a saved scene as a new scene named after it; returns the copy's summary. */
	async duplicate(id: string): Promise<SceneSummary> {
		const original = await this.summary(id);
		if (!original) throw new Error('That scene is no longer in the library');
		const file = readSceneFile(await this.bytes(id));
		const scene = await this.import(copySceneFile(file, `${original.name} copy`));
		return (await this.summary(scene.id))!;
	}

	async delete(id: string): Promise<void> {
		const folder = await sceneFolder();
		await folder.removeEntry(`${id}.wscene`).catch(() => {});
		await indexOp('readwrite', (store) => store.delete(id));
	}
}
