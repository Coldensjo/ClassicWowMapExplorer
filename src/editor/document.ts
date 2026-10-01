import { batch, computed, signal } from '@preact/signals';
import * as THREE from 'three';
import { TILE_SIZE } from '../formats/adt';
import { spawnKind, spawnPlacement, type SpawnInfo, type SpawnType } from '../explorer/spawns';
import type { ObjectManager } from '../viewer/objects';
import type { ContinentPlacement } from '../viewer/terrain';

/**
 * An edited spawn as it now is. Deleted ones keep their details (deleted: true), so the outliner
 * can still name them; null is a deletion saved before that (name unknown). Unedited spawns have
 * no entry at all.
 */
export type SpawnEdit = SpawnInfo | null;

/** Edits by spawn: `${map}:${type}:${guid}`. */
export const spawnId = (info: Pick<SpawnInfo, 'type' | 'guid' | 'place'>) => `${info.place.map}:${info.type}:${info.guid}`;

/** Whether an edit removes its spawn. */
export const isDeleted = (edit: SpawnEdit | undefined) => edit === null || !!edit?.deleted;

/** One spawn's part of a change; undefined is unedited (or, for new ones, not there). */
export interface SpawnChange {
	id: string;
	before: SpawnEdit | undefined;
	after: SpawnEdit | undefined;
}

/** One undoable step: every spawn it changed. */
interface Step {
	changes: SpawnChange[];
	/** Steps of the same gesture (wheel turns, nudges) fold into one. */
	merge?: string;
	time: number;
}

/** Steps within this long (ms) of each other with the same merge key undo together. */
const MERGE_TIME = 800;
/** Guids for new NPCs and objects start here, well above VMaNGOS's own. */
const FIRST_NEW_GUID = 9_000_000;
/** The same for new copies of the map's own models, above any ADT placement's unique ID. */
const FIRST_NEW_MODEL_ID = 1_000_000_000;
const DB_NAME = 'mapExplorer';
const DB_STORE = 'spawnEdits';
const EXPORT_FORMAT = 'mapexplorer-spawn-edits';

/** Edits saved in the browser (IndexedDB), so they're still there next visit. Without storage, they last the visit. */
class EditStore {
	private readonly db: Promise<IDBDatabase | null>;

	constructor() {
		this.db = new Promise((resolve) => {
			try {
				const request = indexedDB.open(DB_NAME, 1);
				request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
	}

	async all(): Promise<[string, SpawnEdit][]> {
		const db = await this.db;
		if (!db) return [];
		return new Promise((resolve) => {
			const out: [string, SpawnEdit][] = [];
			try {
				const request = db.transaction(DB_STORE).objectStore(DB_STORE).openCursor();
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) return resolve(out);
					out.push([String(cursor.key), cursor.value as SpawnEdit]);
					cursor.continue();
				};
				request.onerror = () => resolve(out);
			} catch {
				resolve(out);
			}
		});
	}

	/** Saves an edit; undefined forgets it. */
	async put(id: string, edit: SpawnEdit | undefined): Promise<void> {
		const db = await this.db;
		if (!db) return;
		try {
			const store = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE);
			if (edit === undefined) store.delete(id);
			else store.put(edit, id);
		} catch (e) {
			console.warn('Edit not saved:', e);
		}
	}

	async clear(): Promise<void> {
		const db = await this.db;
		try {
			db?.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).clear();
		} catch (e) {
			console.warn('Edits not cleared:', e);
		}
	}
}

/** Where the document draws: the object manager and where each map lies in the world. */
export interface DocumentHost {
	objects: ObjectManager;
	mapPlacement(mapId: number): ContinentPlacement | null;
}

/**
 * The world as edited: one edit per changed spawn on top of the spawn data, an undo history of
 * steps that can each change many spawns, and the selection. Every change goes through here,
 * and everything that shows it (the 3D view, the inspector, the outliner) reads it from here.
 */
export class EditDocument {
	private readonly edits = new Map<string, SpawnEdit>();
	/** Shown but not yet recorded: spawns being dragged, or carried before a click puts them down. */
	private readonly previews = new Map<string, SpawnInfo>();
	/** Spawns as the data has them, kept from when they were first picked or changed. */
	private readonly originals = new Map<string, SpawnInfo>();
	private readonly store = new EditStore();
	private undoStack: Step[] = [];
	private redoStack: Step[] = [];

	/** Bumped on every change, for anything that lists or counts edits. */
	readonly version = signal(0);
	/** The selected spawns, as they now are. */
	readonly selection = signal<SpawnInfo[]>([]);
	readonly canUndo = signal(false);
	readonly canRedo = signal(false);
	readonly count = computed(() => (this.version.value, this.edits.size));

	constructor(private readonly host: DocumentHost) {}

	/** Reads the saved edits and shows them. Call once the maps are laid out. */
	async load(): Promise<void> {
		for (const [id, edit] of await this.store.all()) {
			if (this.edits.has(id)) continue; // edited already, while loading
			this.edits.set(id, edit);
			this.draw(id, edit);
		}
		this.changed();
	}

	/** A spawn as it now is: its edit, or as the data has it (undefined if deleted or unknown). */
	current(id: string): SpawnInfo | undefined {
		const edit = this.previews.get(id) ?? (this.edits.has(id) ? this.edits.get(id) : this.originals.get(id));
		return edit && !edit.deleted ? edit : undefined;
	}

	/** Whether a spawn has been changed (or added, or deleted). */
	isEdited(id: string): boolean {
		return this.edits.has(id);
	}

	/** Every edit, for the outliner: the spawn (as it was, if deleted) and what happened to it. */
	list(): { id: string; info: SpawnInfo | null; state: 'added' | 'changed' | 'deleted' }[] {
		return [...this.edits].map(([id, edit]) => ({
			id,
			info: edit ?? this.originals.get(id) ?? null,
			state: isDeleted(edit) ? 'deleted' : edit?.created ? 'added' : 'changed',
		}));
	}

	/** Remembers a spawn as the data has it, the first time it's picked. */
	remember(info: SpawnInfo): SpawnInfo {
		const id = spawnId(info);
		if (!this.edits.has(id) && !this.originals.has(id)) this.originals.set(id, info);
		return this.current(id) ?? info;
	}

	// --- Selection ---

	select(infos: SpawnInfo[]): void {
		this.selection.value = infos.map((i) => this.remember(i));
	}

	/** Adds a spawn to the selection, or takes it out if it's in already. */
	toggle(info: SpawnInfo): void {
		const id = spawnId(info);
		const now = this.selection.value;
		this.selection.value = now.some((s) => spawnId(s) === id) ? now.filter((s) => spawnId(s) !== id) : [...now, this.remember(info)];
	}

	/** Refreshes the selection from the edits (after a change), dropping what's gone. */
	private refreshSelection(): void {
		this.selection.value = this.selection.value.map((s) => this.current(spawnId(s))).filter((s): s is SpawnInfo => !!s);
	}

	// --- Changing ---

	/** Records a step (unless it changes nothing) and applies it. */
	commit(changes: SpawnChange[], merge?: string): void {
		const real = changes.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
		if (!real.length) return;
		const now = performance.now();
		const last = this.undoStack.at(-1);
		const sameIds = last && last.changes.length === real.length && last.changes.every((c, i) => c.id === real[i].id);
		if (merge && last?.merge === merge && sameIds && now - last.time < MERGE_TIME) {
			last.changes.forEach((c, i) => (c.after = real[i].after));
			last.time = now;
		} else {
			this.undoStack.push({ changes: real, merge, time: now });
		}
		this.redoStack = [];
		batch(() => {
			for (const c of real) this.apply(c.id, c.after);
			this.refreshSelection();
			this.changed();
		});
	}

	/** Changes spawns by a function of each, as one step. */
	update(infos: SpawnInfo[], change: (info: SpawnInfo) => SpawnInfo, merge?: string): void {
		this.commit(infos.map((info) => {
			const id = spawnId(info);
			return { id, before: this.edits.get(id), after: change(this.current(id) ?? info) };
		}), merge);
	}

	/** Deletes spawns: new ones simply go, those from the data are kept as deleted. */
	remove(infos: SpawnInfo[]): void {
		this.commit(infos.map((info) => {
			const id = spawnId(info);
			return { id, before: this.edits.get(id), after: info.created ? undefined : { ...info, deleted: true } };
		}));
	}

	/** Puts spawns back as the data has them (new ones are left alone). */
	revert(infos: SpawnInfo[]): void {
		this.commit(infos.filter((i) => !i.created).map((info) => {
			const id = spawnId(info);
			return { id, before: this.edits.get(id), after: undefined };
		}));
	}

	/** Shows a spawn changed without recording it (while it's being dragged). */
	preview(info: SpawnInfo): void {
		const id = spawnId(info);
		this.previews.set(id, info);
		this.draw(id, info);
	}

	/** Drops a preview: the spawn shows as recorded again. */
	restore(id: string): void {
		if (!this.previews.delete(id)) return;
		this.draw(id, this.edits.get(id));
	}

	/** A spawn's recorded edit (undefined: none). */
	editOf(id: string): SpawnEdit | undefined {
		return this.edits.get(id);
	}

	/** A spawn as it's shown now: its preview, else its recorded edit. */
	shown(id: string): SpawnEdit | undefined {
		return this.previews.get(id) ?? this.edits.get(id);
	}

	undo(): void {
		const step = this.undoStack.pop();
		if (!step) return;
		batch(() => {
			for (const c of [...step.changes].reverse()) this.apply(c.id, c.before);
			this.redoStack.push(step);
			this.refreshSelection();
			this.changed();
		});
	}

	redo(): void {
		const step = this.redoStack.pop();
		if (!step) return;
		batch(() => {
			for (const c of step.changes) this.apply(c.id, c.after);
			this.undoStack.push(step);
			this.refreshSelection();
			this.changed();
		});
	}

	/** A guid no spawn of this type on this map has. */
	nextGuid(type: SpawnType, map: number): number {
		const prefix = `${map}:${type}:`;
		let guid = type === 'm2' || type === 'wmo' ? FIRST_NEW_MODEL_ID : FIRST_NEW_GUID;
		for (const id of [...this.edits.keys(), ...this.previews.keys()]) if (id.startsWith(prefix)) guid = Math.max(guid, Number(id.slice(prefix.length)) + 1);
		return guid;
	}

	// --- Files ---

	/** Every edit, as a file to keep or share. */
	exportJson(): string {
		return JSON.stringify({ format: EXPORT_FORMAT, version: 1, edits: Object.fromEntries(this.edits) });
	}

	/** Adds the edits in a file made by exportJson; returns how many. Not undoable. */
	importJson(text: string): number {
		const file = JSON.parse(text) as { format?: string; edits?: Record<string, SpawnEdit> };
		if (file.format !== EXPORT_FORMAT || !file.edits) throw new Error('Not a MapExplorer edits file');
		let n = 0;
		batch(() => {
			for (const [id, edit] of Object.entries(file.edits!)) {
				if (edit !== null && (typeof edit !== 'object' || !edit.place)) continue;
				this.apply(id, edit);
				n++;
			}
			this.undoStack = [];
			this.redoStack = [];
			this.refreshSelection();
			this.changed();
		});
		return n;
	}

	/** Back to the spawn data everywhere. Not undoable. */
	clearAll(): void {
		batch(() => {
			for (const id of [...this.edits.keys(), ...this.previews.keys()]) this.draw(id, undefined);
			this.edits.clear();
			this.previews.clear();
			void this.store.clear();
			this.undoStack = [];
			this.redoStack = [];
			this.selection.value = [];
			this.changed();
		});
	}

	// --- Drawing ---

	/** Sets a spawn's edit, draws it and saves it. */
	private apply(id: string, edit: SpawnEdit | undefined): void {
		this.previews.delete(id);
		if (edit === undefined) this.edits.delete(id);
		else this.edits.set(id, edit);
		this.draw(id, edit);
		void this.store.put(id, edit);
	}

	private draw(id: string, edit: SpawnEdit | undefined): void {
		const [map, type, guid] = id.split(':');
		const placement = this.host.mapPlacement(Number(map));
		if (!placement) return;
		const offset = new THREE.Vector3(placement.offsetX * TILE_SIZE, 0, placement.offsetY * TILE_SIZE);
		const drawn = edit === undefined ? undefined : isDeleted(edit) ? null : spawnPlacement(edit!);
		this.host.objects.setEdit(placement.wdt, offset, spawnKind(type as SpawnType), Number(guid), drawn);
	}

	private changed(): void {
		this.canUndo.value = this.undoStack.length > 0;
		this.canRedo.value = this.redoStack.length > 0;
		this.version.value++;
	}
}
