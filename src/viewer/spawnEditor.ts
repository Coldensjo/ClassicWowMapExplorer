import * as THREE from 'three';
import { TILE_SIZE } from '../formats/adt';
import type { Placement } from '../explorer/objects';
import { spawnKind, spawnPlacement, type SpawnInfo, type SpawnPlace, type SpawnType } from '../explorer/spawns';
import type { ObjectManager } from './objects';
import type { ContinentPlacement } from './terrain';
import { isTyping } from './typing';

const MAP_ORIGIN = 32 * TILE_SIZE;
/** Pixels the mouse moves with the button down before a click becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Yards; how far along the mouse's ray to look for the ground to put things on. */
const PLACE_DISTANCE = 1200;
/** Degrees a wheel step turns the selection; with Ctrl, a fine step. */
const TURN_STEP = 15;
const FINE_TURN_STEP = 1;
/** Yards Page Up / Page Down raise or lower the selection; with Shift, a bigger step. */
const RAISE_STEP = 0.1;
const BIG_RAISE_STEP = 1;
/** Wheel turns (and height steps) within this long (ms) of each other undo together. */
const MERGE_TIME = 800;
/** Guids for copies start here, well above VMaNGOS's own, so they never clash with a real spawn. */
const FIRST_NEW_GUID = 9_000_000;
/** The same for copies of the map's own models, above any ADT placement's unique ID. */
const FIRST_NEW_MODEL_ID = 1_000_000_000;
/** Yards; the map's own props further than this can't be picked (there are a great many). */
const PROP_PICK_RANGE = 250;
/**
 * World axes (x north, y west, z up) -> continent space (x east, y up, z south), as a rotation;
 * its inverse takes a placed model's rotation back to world axes (see spawnMatrix).
 */
const WORLD_TO_CONTINENT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(
	0, -1, 0, 0,
	0, 0, 1, 0,
	-1, 0, 0, 0,
	0, 0, 0, 1,
));
const CONTINENT_TO_WORLD = WORLD_TO_CONTINENT.clone().invert();
const DB_NAME = 'mapExplorer';
const DB_STORE = 'spawnEdits';
const EXPORT_FORMAT = 'mapexplorer-spawn-edits';

/** Poses an NPC can hold, by AnimationData ID, in groups for the picker. */
export const POSES: [string, [number, string][]][] = [
	['Posture', [
		[0, 'Stand'], [97, 'Sit on the ground'], [102, 'Sit in a low chair'], [103, 'Sit in a chair'], [104, 'Sit in a high chair'],
		[115, 'Kneel'], [100, 'Sleep'], [6, 'Lie dead'],
	]],
	['Talk and emotes', [
		[60, 'Talk'], [64, 'Talk, exclaiming'], [65, 'Talk, asking'], [67, 'Wave'], [66, 'Bow'], [113, 'Salute'], [68, 'Cheer'],
		[80, 'Applaud'], [70, 'Laugh'], [69, 'Dance'], [84, 'Point'], [82, 'Flex'], [81, 'Shout'], [74, 'Roar'], [77, 'Cry'],
		[79, 'Beg'], [83, 'Shy'], [76, 'Kiss'], [73, 'Rude'], [78, 'Chicken'],
	]],
	['Work', [[62, 'Work'], [123, 'Use something'], [122, 'Eat'], [134, 'Fish'], [50, 'Loot']]],
	['Combat', [
		[25, 'Ready, unarmed'], [26, 'Ready, one-handed'], [27, 'Ready, two-handed'], [29, 'Ready, bow'], [48, 'Ready, rifle'],
		[16, 'Fight, unarmed'], [17, 'Fight, one-handed'], [18, 'Fight, two-handed'], [24, 'Block with a shield'],
		[51, 'Ready a spell'], [32, 'Cast a spell'], [124, 'Channel a spell'], [55, 'Battle roar'], [14, 'Stunned'], [120, 'Stealth'],
	]],
	['Other', [[41, 'Swim in place'], [91, 'Ride (without the mount)'], [132, 'Drowned']]],
];

/** What a model can show for a pose: the pose itself, or what stands in for it (see the loader's fallbacks). */
const POSE_STAND_INS: Record<number, number[]> = { 102: [103, 97], 104: [103, 97], 103: [102, 104, 97], 115: [75], 122: [61], 123: [63], 6: [1] };

/** Whether a model with these animations can show a pose. */
export function canPose(animations: number[], pose: number): boolean {
	return [pose, ...(POSE_STAND_INS[pose] ?? [])].some((id) => animations.includes(id));
}

/** An edited spawn as it now is, or null when deleted. Unedited spawns have no entry. */
export type SpawnEdit = SpawnInfo | null;

/** Edits by spawn: `${map}:${type}:${guid}`. */
export const spawnId = (info: Pick<SpawnInfo, 'type' | 'guid' | 'place'>) => `${info.place.map}:${info.type}:${info.guid}`;

/** One undoable change to one spawn; undefined is unedited (or, for copies, not there). */
interface Change {
	id: string;
	before: SpawnEdit | undefined;
	after: SpawnEdit | undefined;
	/** Steps of the same gesture (wheel turns) fold into one change. */
	merge?: string;
	time: number;
}

/** What the page shows about the editor. */
export interface EditorState {
	active: boolean;
	/** Spawns changed, added or deleted. */
	count: number;
	canUndo: boolean;
	canRedo: boolean;
}

/** What the editor needs from the viewer. */
export interface EditorHost {
	canvas: HTMLCanvasElement;
	camera: THREE.PerspectiveCamera;
	scene: THREE.Scene;
	objects: ObjectManager;
	/** Where a map lies in the world, by Map.db2 ID; null when it isn't laid out. */
	mapPlacement(mapId: number): ContinentPlacement | null;
	/** The map at a point of the world (x, z), or with a WDT file ID; null over the open sea. */
	mapAt(x: number, z: number): ContinentPlacement | null;
	mapOfWdt(wdt: number): ContinentPlacement | null;
	/** A new spawn of a creature or game object template (from the worker). */
	templateSpawn(type: 'npc' | 'object', entry: number, mapId: number, guid: number): Promise<SpawnInfo | null>;
	/** Ground height (-Infinity in a hole), in world space. */
	heightAt(x: number, z: number): number;
	/** Captures the mouse for looking around. */
	lockLook(): void;
}

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

/**
 * Moving, turning, copying and deleting NPCs and game objects. Edits sit on top of the spawn
 * data, one per spawn, kept in the browser; the object manager draws them in place of the
 * originals. Positions are WoW world coordinates, as in VMaNGOS's tables.
 */
export class SpawnEditor {
	private readonly edits = new Map<string, SpawnEdit>();
	private readonly store = new EditStore();
	private undoStack: Change[] = [];
	private redoStack: Change[] = [];
	active = false;
	/** Whether clicks pick the map's own props (trees, crates, fences) and its buildings. */
	props = true;
	buildings = false;
	/** The selected spawn as it now is. */
	private selected: SpawnInfo | null = null;
	/** Mouse down on the selection: where, and the spawn as it was, until it becomes a drag. */
	private press: { x: number; y: number; before: SpawnEdit | undefined; start: SpawnInfo } | null = null;
	/** Being moved: by dragging (button held) or carried after a copy (until a click); before and as it was. */
	private drag: { before: SpawnEdit | undefined; start: SpawnInfo; carry: boolean } | null = null;
	private lastMouse = new THREE.Vector2();
	private lastHover = 0;
	private readonly raycaster = new THREE.Raycaster();
	private readonly ring: THREE.Mesh;

	/** The selection changed (null: nothing selected), or the selected spawn did. */
	onSelect: (info: SpawnInfo | null, edited: boolean) => void = () => {};
	/** Something the page shows changed. */
	onState: (state: EditorState) => void = () => {};

	constructor(private readonly host: EditorHost) {
		// A selection circle at the feet, like the game's, seen through whatever is in the way.
		const ring = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
		this.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffd100, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }));
		this.ring.renderOrder = 10;
		this.ring.visible = false;
		this.ring.frustumCulled = false;
		host.scene.add(this.ring);

		const canvas = host.canvas;
		canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
		window.addEventListener('pointermove', (e) => this.onPointerMove(e));
		window.addEventListener('pointerup', (e) => this.onPointerUp(e));
		canvas.addEventListener('contextmenu', (e) => {
			if (this.active) e.preventDefault();
		});
		// Captured ahead of the camera's own handlers: the wheel turns what's being moved, and
		// editing keys mustn't also fly the camera (Ctrl+D) or toggle settings.
		window.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
		window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
		// Alt is held for turning; let go, it would otherwise move focus to the browser's menu.
		window.addEventListener('keyup', (e) => {
			if (this.active && e.key === 'Alt') e.preventDefault();
		});
	}

	/** Reads the saved edits and shows them. Call once the maps are laid out. */
	async load(): Promise<void> {
		for (const [id, edit] of await this.store.all()) {
			if (this.edits.has(id)) continue; // edited already, while loading
			this.edits.set(id, edit);
			this.draw(id, edit);
		}
		this.changed();
	}

	get state(): EditorState {
		return { active: this.active, count: this.edits.size, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
	}

	setActive(on: boolean): void {
		if (on === this.active) return;
		if (!on) {
			this.cancelDrag();
			this.select(null);
		}
		this.active = on;
		this.host.canvas.style.cursor = '';
		this.changed();
	}

	/** Selects a spawn (from a click outside edit mode too, so editing can start from it). */
	select(info: SpawnInfo | null): void {
		this.selected = info ? (this.edits.get(spawnId(info)) ?? info) : null;
		this.onSelect(this.selected, !!info && this.edits.has(spawnId(info)));
	}

	/** The animations the selected NPC's model has; undefined until it has loaded (or for objects). */
	selectedAnimations(): number[] | undefined {
		const s = this.selected;
		const placement = s?.type === 'npc' ? this.host.mapPlacement(s.place.map) : null;
		return placement && s ? this.host.objects.spawnAt(placement.wdt, 'creature', s.guid)?.animations : undefined;
	}

	/** Moves the selection circle to the selected spawn; call every frame. */
	update(): void {
		const s = this.selected;
		// Not with the interface hidden (U): that's for clean footage.
		const shown = this.active && !document.body.classList.contains('ui-hidden');
		const placement = s && shown ? this.host.mapPlacement(s.place.map) : null;
		const at = placement && s ? this.host.objects.spawnAt(placement.wdt, spawnKind(s.type), s.guid) : null;
		this.ring.visible = !!at;
		if (!at) return;
		const scale = Math.hypot(at.matrix.elements[0], at.matrix.elements[1], at.matrix.elements[2]);
		// The bounds reach well past the feet (arms, weapons, a tail); a person gets about a yard.
		const size = Math.max(0.5, Math.min(at.radius, at.height) * scale * 0.5);
		this.ring.position.setFromMatrixPosition(at.matrix);
		this.ring.position.y += 0.05;
		this.ring.scale.setScalar(size);
	}

	// --- Changing spawns ---

	/** Changes the selected spawn's position, facing or scale (from the panel's fields). */
	setPlace(change: Partial<SpawnPlace>, merge?: string): void {
		const s = this.selected;
		if (!s) return;
		const id = spawnId(s);
		const next: SpawnInfo = { ...s, place: { ...s.place, ...change } };
		if (change.o !== undefined && s.place.rotation) next.place.rotation = turnQuaternion(s.place.rotation, change.o - s.place.o);
		this.commit(id, this.edits.get(id), next, merge);
	}

	/** Turns the selection by degrees about the vertical. */
	turn(degrees: number, merge?: string): void {
		const s = this.selected;
		if (!s) return;
		const o = wrapAngle(s.place.o + THREE.MathUtils.degToRad(degrees));
		if (this.drag) this.preview(spawnId(s), { ...s, place: { ...s.place, o, rotation: s.place.rotation && turnQuaternion(s.place.rotation, o - s.place.o) } });
		else this.setPlace({ o }, merge);
	}

	/** Deletes the selection. */
	remove(): void {
		const s = this.selected;
		if (!s) return;
		this.cancelDrag();
		const id = spawnId(s);
		// Copies simply go; spawns from the data are kept as deleted.
		this.commit(id, this.edits.get(id), s.created ? undefined : null);
		this.select(null);
	}

	/** Puts the selection back as the spawn data has it. */
	reset(): void {
		const s = this.selected;
		if (!s || s.created) return;
		const id = spawnId(s);
		if (!this.edits.has(id)) return;
		this.commit(id, this.edits.get(id), undefined);
		this.selected = null;
		this.onSelect(null, false);
	}

	/** Copies the selection; the copy follows the mouse until a click puts it down. */
	duplicate(): void {
		const s = this.selected;
		if (!s) return;
		this.cancelDrag();
		const copy: SpawnInfo = { ...s, guid: this.nextGuid(s), created: true, place: { ...s.place } };
		const id = spawnId(copy);
		this.preview(id, copy);
		this.selected = copy;
		this.drag = { before: undefined, start: copy, carry: true };
		this.moveToMouse();
		this.onSelect(copy, true);
	}

	/**
	 * Places a new NPC or game object from its template: it follows the mouse until a click puts
	 * it down, as a copy does. It goes on the map under the mouse (or the camera).
	 */
	async place(type: 'npc' | 'object', entry: number): Promise<boolean> {
		this.cancelDrag();
		this.raycaster.setFromCamera(this.ndc({ clientX: this.lastMouse.x, clientY: this.lastMouse.y }), this.host.camera);
		const ground = this.groundHit(this.raycaster.ray) ?? this.host.camera.position;
		const map = this.host.mapAt(ground.x, ground.z) ?? this.host.mapAt(this.host.camera.position.x, this.host.camera.position.z);
		if (!map) return false;
		const guid = this.nextGuid({ type, place: { map: map.mapId } as SpawnPlace });
		const info = await this.host.templateSpawn(type, entry, map.mapId, guid);
		if (!info) return false;
		this.setActive(true);
		const made: SpawnInfo = { ...info, created: true };
		this.selected = made;
		this.drag = { before: undefined, start: made, carry: true };
		this.moveToMouse();
		this.onSelect(made, true);
		return true;
	}

	undo(): void {
		const change = this.undoStack.pop();
		if (!change) return;
		this.cancelDrag();
		this.apply(change.id, change.before);
		this.redoStack.push(change);
		this.afterHistory(change.id, change.before);
	}

	redo(): void {
		const change = this.redoStack.pop();
		if (!change) return;
		this.cancelDrag();
		this.apply(change.id, change.after);
		this.undoStack.push(change);
		this.afterHistory(change.id, change.after);
	}

	/** Every edit, as a file to keep or share. */
	exportJson(): string {
		return JSON.stringify({ format: EXPORT_FORMAT, version: 1, edits: Object.fromEntries(this.edits) });
	}

	/** Adds the edits in a file made by exportJson; returns how many. Not undoable. */
	importJson(text: string): number {
		const file = JSON.parse(text) as { format?: string; edits?: Record<string, SpawnEdit> };
		if (file.format !== EXPORT_FORMAT || !file.edits) throw new Error('Not a MapExplorer edits file');
		let n = 0;
		for (const [id, edit] of Object.entries(file.edits)) {
			if (edit !== null && (typeof edit !== 'object' || !edit.place)) continue;
			this.apply(id, edit);
			n++;
		}
		this.undoStack = [];
		this.redoStack = [];
		this.select(this.selected);
		this.changed();
		return n;
	}

	/** Back to the spawn data everywhere. Not undoable. */
	clearAll(): void {
		this.cancelDrag();
		for (const id of [...this.edits.keys()]) this.draw(id, undefined);
		this.edits.clear();
		void this.store.clear();
		this.undoStack = [];
		this.redoStack = [];
		this.select(null);
		this.changed();
	}

	/** Records a change (unless it changes nothing) and applies it. */
	private commit(id: string, before: SpawnEdit | undefined, after: SpawnEdit | undefined, merge?: string): void {
		const now = performance.now();
		const last = this.undoStack.at(-1);
		if (merge && last?.merge === merge && last.id === id && now - last.time < MERGE_TIME) {
			last.after = after;
			last.time = now;
		} else if (JSON.stringify(before) !== JSON.stringify(after)) {
			this.undoStack.push({ id, before, after, merge, time: now });
		}
		this.redoStack = [];
		this.apply(id, after);
		if (after && this.selected && spawnId(this.selected) === id) {
			this.selected = after;
			this.onSelect(after, true);
		}
		this.changed();
	}

	/** Shows a change without recording it (while dragging). */
	private preview(id: string, info: SpawnInfo): void {
		this.selected = info;
		this.edits.set(id, info);
		this.draw(id, info);
	}

	/** Sets a spawn's edit, draws it and saves it. */
	private apply(id: string, edit: SpawnEdit | undefined): void {
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
		this.host.objects.setEdit(placement.wdt, offset, spawnKind(type as SpawnType), Number(guid), edit ? spawnPlacement(edit) : edit);
	}

	/** After an undo or redo: the selection follows the spawn that changed. */
	private afterHistory(id: string, edit: SpawnEdit | undefined): void {
		if (edit) {
			this.selected = edit;
			this.onSelect(edit, true);
		} else if (this.selected && spawnId(this.selected) === id) {
			this.selected = null;
			this.onSelect(null, false);
		}
		this.changed();
	}

	private changed(): void {
		this.onState(this.state);
	}

	private nextGuid(like: Pick<SpawnInfo, 'type' | 'place'>): number {
		const prefix = `${like.place.map}:${like.type}:`;
		let guid = like.type === 'm2' || like.type === 'wmo' ? FIRST_NEW_MODEL_ID : FIRST_NEW_GUID;
		for (const id of this.edits.keys()) if (id.startsWith(prefix)) guid = Math.max(guid, Number(id.slice(prefix.length)) + 1);
		return guid;
	}

	// --- Mouse and keys ---

	private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
		const rect = this.host.canvas.getBoundingClientRect();
		return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	}

	private pickAt(e: { clientX: number; clientY: number }): SpawnInfo | null {
		this.raycaster.setFromCamera(this.ndc(e), this.host.camera);
		this.raycaster.far = PLACE_DISTANCE;
		const hit = this.host.objects.pickPlaced(this.raycaster, this.props, this.buildings, PROP_PICK_RANGE);
		if (!hit) return null;
		return hit.placement.spawn ?? this.modelInfo(hit.placement, hit.wdt);
	}

	/**
	 * One of the map's own models (from its ADT) as a spawn to edit: its placement matrix taken
	 * back apart into a position, rotation and scale in world coordinates.
	 */
	private modelInfo(p: Placement, wdt: number): SpawnInfo | null {
		const map = this.host.mapOfWdt(wdt);
		if (!map || (p.kind !== 'm2' && p.kind !== 'wmo')) return null;
		const position = new THREE.Vector3();
		const turn = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		new THREE.Matrix4().fromArray(p.matrix).decompose(position, turn, scale);
		const r = CONTINENT_TO_WORLD.clone().multiply(turn);
		const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(r);
		const building = p.kind === 'wmo';
		return {
			type: p.kind,
			guid: p.uid,
			entry: p.fdid,
			name: `${building ? 'Building' : 'Model'} ${p.fdid}`,
			kind: building ? 'Building' : 'Prop',
			place: {
				map: map.mapId,
				x: MAP_ORIGIN - position.z,
				y: MAP_ORIGIN - position.x,
				z: position.y,
				o: wrapAngle(Math.atan2(forward.y, forward.x)),
				rotation: [r.x, r.y, r.z, r.w],
				scale: scale.x,
				display: p.fdid,
				doodadSet: p.doodadSet || undefined,
				nameSet: p.nameSet,
			},
		};
	}

	private onPointerDown(e: PointerEvent): void {
		if (!this.active) return;
		if (e.button === 2) {
			// Right button held: look around, as in the game.
			this.host.lockLook();
			return;
		}
		if (e.button !== 0 || document.pointerLockElement) return;
		this.lastMouse.set(e.clientX, e.clientY);
		if (this.drag?.carry) {
			// A carried copy is put down where it is.
			const s = this.selected!;
			this.drag = null;
			this.commit(spawnId(s), undefined, s);
			return;
		}
		const hit = this.pickAt(e);
		this.select(hit);
		if (hit && this.selected) this.press = { x: e.clientX, y: e.clientY, before: this.edits.get(spawnId(hit)), start: this.selected };
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.active || document.pointerLockElement) return;
		const dy = e.clientY - this.lastMouse.y;
		this.lastMouse.set(e.clientX, e.clientY);
		if (this.press && !this.drag && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > DRAG_THRESHOLD) {
			this.drag = { before: this.press.before, start: this.press.start, carry: false };
			this.host.canvas.style.cursor = 'grabbing';
		}
		if (this.drag) {
			if (e.shiftKey) this.raise(dy);
			else this.moveToMouse();
			return;
		}
		if (e.target !== this.host.canvas || performance.now() - this.lastHover < 80) return;
		this.lastHover = performance.now();
		this.host.canvas.style.cursor = this.pickAt(e) ? 'grab' : '';
	}

	private onPointerUp(e: PointerEvent): void {
		if (e.button === 2 && this.active && document.pointerLockElement === this.host.canvas) document.exitPointerLock();
		if (e.button !== 0) return;
		this.press = null;
		if (this.drag && !this.drag.carry && this.selected) {
			const { before } = this.drag;
			this.drag = null;
			this.commit(spawnId(this.selected), before, this.selected);
			this.host.canvas.style.cursor = 'grab';
		}
	}

	private onWheel(e: WheelEvent): void {
		// Turning: the wheel while moving something, or Alt+wheel on the selection.
		if (!this.active || !this.selected || e.target !== this.host.canvas || !(this.drag || e.altKey)) return;
		e.preventDefault();
		e.stopPropagation();
		const step = e.ctrlKey ? FINE_TURN_STEP : TURN_STEP;
		this.turn(Math.sign(e.deltaY || e.deltaX) * -step, 'turn');
	}

	private onKey(e: KeyboardEvent): void {
		if (!this.active || isTyping(e)) return;
		const ctrl = e.ctrlKey || e.metaKey;
		let handled = true;
		if (ctrl && e.code === 'KeyZ') {
			if (e.shiftKey) this.redo();
			else this.undo();
		} else if (ctrl && e.code === 'KeyY') this.redo();
		else if (ctrl && e.code === 'KeyD') this.duplicate();
		else if ((e.code === 'PageUp' || e.code === 'PageDown') && this.selected) {
			const step = (e.shiftKey ? BIG_RAISE_STEP : RAISE_STEP) * (e.code === 'PageUp' ? 1 : -1);
			if (this.drag) this.preview(spawnId(this.selected), { ...this.selected, place: { ...this.selected.place, z: this.selected.place.z + step } });
			else this.setPlace({ z: this.selected.place.z + step }, 'raise');
		}
		else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected) this.remove();
		else if (e.code === 'Escape' && this.drag) this.cancelDrag();
		else if (e.code === 'Escape' && this.selected) this.select(null);
		else handled = false;
		if (!handled) return;
		e.preventDefault();
		e.stopPropagation();
	}

	/** Puts what's being moved back where it was (a carried copy goes away). */
	private cancelDrag(): void {
		const drag = this.drag;
		this.press = null;
		if (!drag || !this.selected) return;
		this.drag = null;
		const id = spawnId(this.selected);
		if (drag.before === undefined) this.edits.delete(id);
		else this.edits.set(id, drag.before);
		this.draw(id, drag.before);
		this.select(drag.carry ? null : drag.start);
	}

	/** Moves what's being dragged onto the ground or floor under the mouse. */
	private moveToMouse(): void {
		const s = this.selected;
		const placement = s && this.host.mapPlacement(s.place.map);
		if (!s || !placement) return;
		this.raycaster.setFromCamera(this.ndc({ clientX: this.lastMouse.x, clientY: this.lastMouse.y }), this.host.camera);
		const hit = this.groundHit(this.raycaster.ray, s.type !== 'wmo');
		if (!hit) return;
		// World -> WoW coordinates for this map (the inverse of placing a spawn).
		const x = MAP_ORIGIN + placement.offsetY * TILE_SIZE - hit.z;
		const y = MAP_ORIGIN + placement.offsetX * TILE_SIZE - hit.x;
		this.preview(spawnId(s), { ...s, place: { ...s.place, x, y, z: hit.y } });
	}

	/** Shift+drag: up and down, by as much as the mouse moves on screen at the spawn's distance. */
	private raise(dy: number): void {
		const s = this.selected;
		const placement = s && this.host.mapPlacement(s.place.map);
		if (!s || !placement || !dy) return;
		const at = this.host.objects.spawnAt(placement.wdt, spawnKind(s.type), s.guid);
		const distance = at ? new THREE.Vector3().setFromMatrixPosition(at.matrix).distanceTo(this.host.camera.position) : 10;
		const camera = this.host.camera;
		const perPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / this.host.canvas.clientHeight;
		this.preview(spawnId(s), { ...s, place: { ...s.place, z: s.place.z - dy * perPixel } });
	}

	/** Where a ray first meets the ground or a building, if within reach. */
	private groundHit(ray: THREE.Ray, buildings = true): THREE.Vector3 | null {
		let best = (buildings && this.host.objects.raycastBuildings(ray.origin, ray.direction, PLACE_DISTANCE)) || PLACE_DISTANCE;
		// March to the terrain, in steps that grow with distance, then narrow the crossing down.
		const p = new THREE.Vector3();
		const below = (t: number) => {
			ray.at(t, p);
			return p.y < this.host.heightAt(p.x, p.z);
		};
		let previous = 0;
		for (let t = 0.25; t < best; t += Math.max(0.25, t * 0.01)) {
			if (below(t)) {
				let lo = previous, hi = t;
				for (let i = 0; i < 12; i++) {
					const mid = (lo + hi) / 2;
					if (below(mid)) hi = mid;
					else lo = mid;
				}
				best = hi;
				break;
			}
			previous = t;
		}
		return best < PLACE_DISTANCE ? ray.at(best, new THREE.Vector3()) : null;
	}
}

/** A rotation (x, y, z, w) turned further about the world's up axis. */
function turnQuaternion(q: [number, number, number, number], radians: number): [number, number, number, number] {
	const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians).multiply(new THREE.Quaternion(...q));
	return [turned.x, turned.y, turned.z, turned.w];
}

/** Radians into 0..2pi, as VMaNGOS keeps orientations. */
function wrapAngle(a: number): number {
	const full = Math.PI * 2;
	return ((a % full) + full) % full;
}
