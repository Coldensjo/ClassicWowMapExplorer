import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { materialize } from '../scene/copyScene';
import type { SceneModel } from '../scene/sceneModel';
import type { PlacedObject, Vec3 } from '../scene/types';
import { ObjectManager } from '../viewer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import type { CommandStack } from './commands';
import type { PlaceAsset } from './modelBrowser';
import { matrixToPlacement, objectMatrix, uprightRotation } from './placement';

/** The Place tool's settings (spec 7.8), edited by the properties panel. */
export interface PlaceSettings {
	/** What a left click does: drop the armed asset, or select what's there. */
	mode: 'place' | 'select';
	/** The asset the browser armed; null places nothing. */
	asset: PlaceAsset | null;
	alignToSlope: boolean;
	randomYaw: boolean;
	/** Random scale range for scatter placement (M2 only); min = max places one size. */
	scaleMin: number;
	scaleMax: number;
	/** Grid snap in yards; 0 is off. Snaps placement and the move gizmo. */
	gridSnap: number;
	/** 15° angle snap for the rotate gizmo. */
	angleSnap: boolean;
}

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const RAD = Math.PI / 180;
/** Angle snap step (spec 7.8). */
const ANGLE_SNAP = 15 * RAD;
/** Pixels a press may move and still count as a click, not a box drag. */
const DRAG_THRESHOLD = 4;
const SELECTION_COLOR = 0xffc24b;

/** The fields an edit command snapshots: everything but the identity. */
type Snapshot = Pick<PlacedObject, 'id' | 'position' | 'rotation' | 'scale' | 'doodadSet' | 'nameSet' | 'locked' | 'group'>;

function snapshot(o: PlacedObject): Snapshot {
	return {
		id: o.id,
		position: [...o.position] as Vec3,
		rotation: [...o.rotation] as Vec3,
		scale: o.scale,
		doodadSet: o.doodadSet,
		nameSet: o.nameSet,
		locked: o.locked,
		group: o.group,
	};
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return (
		a.position.every((v, i) => v === b.position[i]) &&
		a.rotation.every((v, i) => v === b.rotation[i]) &&
		a.scale === b.scale &&
		a.doodadSet === b.doodadSet &&
		a.nameSet === b.nameSet &&
		a.locked === b.locked &&
		a.group === b.group
	);
}

/**
 * The editor's placed objects (spec 7.8): mirrors scene.objects into the explorer's instanced
 * ObjectManager (each placed object is one loose instance, keyed by its UUID), places the armed
 * asset on click, and owns the selection, its outline boxes and the transform gizmo. Every change
 * is one undoable command.
 */
export class SceneObjects {
	readonly manager: ObjectManager;
	readonly place: PlaceSettings = { mode: 'place', asset: null, alignToSlope: false, randomYaw: false, scaleMin: 1, scaleMax: 1, gridSnap: 0, angleSnap: true };
	/** Selected object ids; the panel and gizmo follow it. */
	readonly selection = new Set<string>();
	/** The last object selected: the gizmo pivots on it. */
	private primary: string | null = null;
	onSelectionChange: () => void = () => {};
	onNotice: (text: string) => void = () => {};

	private readonly controls: TransformControls;
	private readonly gizmoHelper: THREE.Object3D;
	private readonly pivot = new THREE.Object3D();
	private readonly boxes = new Map<string, THREE.Box3Helper>();
	private readonly boxGroup = new THREE.Group();
	private active = false;
	/** Set while a gizmo drag is open: the pivot and each object where the drag started. */
	private dragStart: { pivot: THREE.Matrix4; objects: Map<string, { matrix: THREE.Matrix4; was: Snapshot }> } | null = null;
	/** Copied objects, shared across scenes in the session (spec 7.8 copy/paste). */
	private static clipboardObjects: PlacedObject[] = [];
	private boxSelect: { startX: number; startY: number; element: HTMLDivElement; add: boolean } | null = null;

	constructor(
		scene: THREE.Scene,
		private readonly camera: THREE.PerspectiveCamera,
		private readonly canvas: HTMLCanvasElement,
		private readonly model: SceneModel,
		private readonly commands: CommandStack,
		storage: AsyncStorageApi,
		compressed: boolean,
		anisotropy: number,
		prepare: (object: THREE.Object3D) => Promise<void>,
		/** The terrain surface, for placing and dropping to ground. */
		private readonly surfaceAt: (x: number, z: number) => number | null,
	) {
		this.manager = new ObjectManager(storage, compressed, anisotropy, prepare);
		scene.add(this.manager.group, this.boxGroup, this.pivot);
		this.controls = new TransformControls(camera, canvas);
		this.controls.enabled = false;
		this.gizmoHelper = this.controls.getHelper();
		this.gizmoHelper.visible = false;
		scene.add(this.gizmoHelper);
		this.controls.attach(this.pivot);
		this.controls.addEventListener('mouseDown', () => this.beginDrag());
		this.controls.addEventListener('objectChange', () => this.applyDrag());
		this.controls.addEventListener('mouseUp', () => this.endDrag());
	}

	/** Spawns every saved object; the manager loads and draws the models as they come. */
	load(): void {
		for (const o of this.model.objects) this.spawn(o);
	}

	/** The Place tool is active: the gizmo shows and clicks go to objects. */
	setActive(on: boolean): void {
		this.active = on;
		if (!on) this.cancelBoxSelect();
	}

	/** Whether the gizmo is under the pointer or mid-drag, so a click is its, not a stroke. */
	get gizmoBusy(): boolean {
		return this.gizmoHelper.visible && (this.controls.dragging || this.controls.axis !== null);
	}

	get gizmoMode(): GizmoMode {
		return this.controls.mode;
	}

	setGizmoMode(mode: GizmoMode): void {
		if (mode === 'scale' && [...this.selection].every((id) => this.model.object(id)?.kind === 'wmo') && this.selection.size) {
			this.onNotice('Buildings keep scale 1; only doodads scale');
		}
		this.controls.setMode(mode);
		this.onSelectionChange();
	}

	/** Call once per frame. */
	update(now: number, camera: THREE.Vector3): void {
		this.manager.update(now, camera);
		this.controls.translationSnap = this.place.gridSnap > 0 ? this.place.gridSnap : null;
		this.controls.rotationSnap = this.place.angleSnap ? ANGLE_SNAP : null;
		const showGizmo = this.active && this.selection.size > 0;
		this.gizmoHelper.visible = showGizmo;
		this.controls.enabled = showGizmo;
		if (!this.dragStart) this.syncPivot();
		this.syncBoxes();
	}

	get count(): number {
		return this.model.objects.length;
	}

	private spawn(o: PlacedObject): void {
		this.manager.placeLoose(o.id, o.kind, o.fdid, objectMatrix(o), o.doodadSet ?? 0);
	}

	private despawn(id: string): void {
		this.manager.removeLoose(id);
	}

	/** Re-places an object whose structure changed (doodad set); a plain move keeps the instance. */
	private respawn(o: PlacedObject): void {
		this.despawn(o.id);
		this.spawn(o);
	}

	private move(o: PlacedObject): void {
		this.manager.placeLoose(o.id, o.kind, o.fdid, objectMatrix(o), o.doodadSet ?? 0);
	}

	/** The object a pick ray hits, resolved to its placed id (a WMO's own doodads count as it). */
	private pickId(raycaster: THREE.Raycaster): string | null {
		const hit = this.manager.pick(raycaster);
		if (!hit) return null;
		const id = hit.key.split(':', 1)[0];
		return this.model.object(id) ? id : null;
	}

	// ---- Placing (spec 7.8) ----

	/**
	 * A left click with the Place tool in place mode: drops the armed asset at the ground under the
	 * cursor — the terrain, or an object surface (a bridge, a floor) when that is nearer.
	 */
	placeClick(raycaster: THREE.Raycaster, terrain: { x: number; z: number; height: number } | null): void {
		const asset = this.place.asset;
		if (!asset) {
			this.onNotice('Pick a doodad or building from the browser first');
			return;
		}
		let point: THREE.Vector3 | null = terrain ? new THREE.Vector3(terrain.x, terrain.height, terrain.z) : null;
		const onObject = this.manager.pick(raycaster);
		if (onObject && (!point || onObject.distance < raycaster.ray.origin.distanceTo(point))) point = onObject.point;
		if (!point) return;
		const snap = this.place.gridSnap;
		if (snap > 0) {
			point.x = Math.round(point.x / snap) * snap;
			point.z = Math.round(point.z / snap) * snap;
			const ground = this.surfaceAt(point.x, point.z);
			if (ground !== null && !onObject) point.y = ground;
		}
		const yaw = this.place.randomYaw ? Math.random() * 360 : 0;
		const min = Math.min(this.place.scaleMin, this.place.scaleMax);
		const max = Math.max(this.place.scaleMin, this.place.scaleMax);
		const scale = asset.kind === 'm2' ? Math.max(0.01, min + Math.random() * (max - min)) : 1;
		let placement: { position: Vec3; rotation: Vec3; scale: number };
		if (this.place.alignToSlope && asset.kind === 'm2') {
			// Lean the model so its up follows the ground: T · Qalign · Ry(yaw-90) · Rx(-90) · S.
			const normal = this.groundNormal(point.x, point.z);
			const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
			const matrix = new THREE.Matrix4()
				.makeTranslation(point.x, point.y, point.z)
				.multiply(new THREE.Matrix4().makeRotationFromQuaternion(align))
				.multiply(new THREE.Matrix4().makeRotationY((yaw - 90) * RAD))
				.multiply(new THREE.Matrix4().makeRotationX(-90 * RAD))
				.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
			placement = matrixToPlacement(matrix);
		} else {
			placement = { position: [point.x, point.y, point.z], rotation: uprightRotation(yaw), scale };
		}
		const object: PlacedObject = {
			id: crypto.randomUUID(),
			kind: asset.kind,
			fdid: asset.fdid,
			...placement,
			...(asset.kind === 'wmo' ? { doodadSet: 0, nameSet: 0 } : {}),
		};
		this.commandAdd([object], `Place ${asset.label}`);
	}

	/** The terrain normal at a point, from nearby surface heights. */
	private groundNormal(x: number, z: number): THREE.Vector3 {
		const e = 0.75;
		const at = (px: number, pz: number) => this.surfaceAt(px, pz) ?? this.surfaceAt(x, z) ?? 0;
		const dx = (at(x + e, z) - at(x - e, z)) / (2 * e);
		const dz = (at(x, z + e) - at(x, z - e)) / (2 * e);
		return new THREE.Vector3(-dx, 1, -dz).normalize();
	}

	// ---- Selecting (spec 7.8) ----

	/**
	 * A left click in select mode: picks the object under the cursor (its whole group with it,
	 * unless Shift narrows to one), Shift toggles, and a press on empty ground starts a box select.
	 */
	selectClick(raycaster: THREE.Raycaster, event: MouseEvent): void {
		const id = this.pickId(raycaster);
		if (!id) {
			this.beginBoxSelect(event);
			return;
		}
		const o = this.model.object(id)!;
		const ids = o.group && !event.shiftKey ? this.model.objects.filter((other) => other.group === o.group).map((other) => other.id) : [id];
		if (event.shiftKey) {
			if (this.selection.has(id)) this.selection.delete(id);
			else {
				this.selection.add(id);
				this.primary = id;
			}
			this.onSelectionChange();
		} else {
			this.select(ids);
		}
	}

	/** Replaces the selection (or adds to it) and tells the panel. */
	select(ids: string[], add = false): void {
		if (!add) this.selection.clear();
		for (const id of ids) this.selection.add(id);
		this.primary = ids.at(-1) ?? this.primary;
		this.onSelectionChange();
	}

	clearSelection(): void {
		if (!this.selection.size) return;
		this.selection.clear();
		this.onSelectionChange();
	}

	/** Drops selected ids that no longer exist (undo of a place, redo of a delete). */
	pruneSelection(): void {
		let changed = false;
		for (const id of this.selection) {
			if (!this.model.object(id)) {
				this.selection.delete(id);
				changed = true;
			}
		}
		if (changed) this.onSelectionChange();
	}

	/** The selected objects, locked ones included. */
	selectedObjects(): PlacedObject[] {
		return [...this.selection].flatMap((id) => this.model.object(id) ?? []);
	}

	/** A drag on empty ground: a screen rectangle that selects the objects whose centre it covers. */
	private beginBoxSelect(event: MouseEvent): void {
		this.cancelBoxSelect();
		const element = document.createElement('div');
		element.className = 'select-box';
		element.style.display = 'none';
		this.canvas.parentElement?.appendChild(element);
		this.boxSelect = { startX: event.clientX, startY: event.clientY, element, add: event.shiftKey };
		window.addEventListener('mousemove', this.onBoxMove);
		window.addEventListener('mouseup', this.onBoxUp);
	}

	private readonly onBoxMove = (e: MouseEvent): void => {
		const box = this.boxSelect;
		if (!box) return;
		const x0 = Math.min(box.startX, e.clientX);
		const y0 = Math.min(box.startY, e.clientY);
		const w = Math.abs(e.clientX - box.startX);
		const h = Math.abs(e.clientY - box.startY);
		if (w + h > DRAG_THRESHOLD) box.element.style.display = 'block';
		box.element.style.left = `${x0}px`;
		box.element.style.top = `${y0}px`;
		box.element.style.width = `${w}px`;
		box.element.style.height = `${h}px`;
	};

	private readonly onBoxUp = (e: MouseEvent): void => {
		const box = this.boxSelect;
		if (!box) return;
		this.cancelBoxSelect();
		const dragged = Math.abs(e.clientX - box.startX) + Math.abs(e.clientY - box.startY) > DRAG_THRESHOLD;
		if (!dragged) {
			// A plain click on nothing clears the selection.
			if (!box.add) this.clearSelection();
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		const x0 = Math.min(box.startX, e.clientX);
		const x1 = Math.max(box.startX, e.clientX);
		const y0 = Math.min(box.startY, e.clientY);
		const y1 = Math.max(box.startY, e.clientY);
		const point = new THREE.Vector3();
		const ids: string[] = [];
		for (const o of this.model.objects) {
			point.set(o.position[0], o.position[1], o.position[2]).project(this.camera);
			if (point.z > 1 || point.z < -1) continue;
			const sx = rect.left + ((point.x + 1) / 2) * rect.width;
			const sy = rect.top + ((1 - point.y) / 2) * rect.height;
			if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(o.id);
		}
		this.select(ids, box.add);
	};

	private cancelBoxSelect(): void {
		if (!this.boxSelect) return;
		this.boxSelect.element.remove();
		this.boxSelect = null;
		window.removeEventListener('mousemove', this.onBoxMove);
		window.removeEventListener('mouseup', this.onBoxUp);
	}

	/** Outline boxes over the selection, refreshed every frame so they follow edits. */
	private syncBoxes(): void {
		for (const [id, helper] of this.boxes) {
			if (!this.active || !this.selection.has(id)) {
				this.boxGroup.remove(helper);
				helper.dispose();
				this.boxes.delete(id);
			}
		}
		if (!this.active) return;
		for (const id of this.selection) {
			const o = this.model.object(id);
			if (!o) continue;
			let helper = this.boxes.get(id);
			if (!helper) {
				helper = new THREE.Box3Helper(new THREE.Box3(), SELECTION_COLOR);
				this.boxes.set(id, helper);
				this.boxGroup.add(helper);
			}
			const info = this.manager.modelInfo(o.kind, o.fdid);
			const matrix = objectMatrix(o);
			if (info) helper.box.copy(info.box).applyMatrix4(matrix);
			else helper.box.setFromCenterAndSize(new THREE.Vector3(...o.position), new THREE.Vector3(2, 2, 2));
		}
	}

	// ---- The gizmo (spec 7.8) ----

	/** Puts the pivot on the primary selected object, so the gizmo sits and turns with it. */
	private syncPivot(): void {
		const o = (this.primary && this.model.object(this.primary)) || this.selectedObjects().at(-1);
		if (!o) return;
		const matrix = objectMatrix(o);
		matrix.decompose(this.pivot.position, this.pivot.quaternion, this.pivot.scale);
		this.pivot.scale.setScalar(Math.max(o.scale, 0.01));
	}

	private beginDrag(): void {
		const objects = new Map<string, { matrix: THREE.Matrix4; was: Snapshot }>();
		for (const o of this.selectedObjects()) {
			if (o.locked) continue;
			objects.set(o.id, { matrix: objectMatrix(o), was: snapshot(o) });
		}
		this.syncPivot();
		this.pivot.updateMatrix();
		this.dragStart = { pivot: this.pivot.matrix.clone(), objects };
	}

	/** Applies the gizmo's delta to every unlocked selected object, live during the drag. */
	private applyDrag(): void {
		const drag = this.dragStart;
		if (!drag) return;
		if (this.controls.mode === 'scale') {
			// Scale stays uniform (spec 6.1): the dragged axis sets all three.
			const axis = this.controls.axis ?? 'XYZ';
			const s = this.pivot.scale;
			const value = Math.max(0.01, axis.includes('Y') ? s.y : axis.includes('Z') ? s.z : s.x);
			s.setScalar(value);
		}
		this.pivot.updateMatrix();
		const delta = this.pivot.matrix.clone().multiply(drag.pivot.clone().invert());
		const moved = new THREE.Matrix4();
		for (const [id, start] of drag.objects) {
			const o = this.model.object(id);
			if (!o) continue;
			moved.multiplyMatrices(delta, start.matrix);
			const p = matrixToPlacement(moved);
			o.position = p.position;
			o.rotation = p.rotation;
			o.scale = o.kind === 'wmo' ? 1 : Math.max(0.01, p.scale);
			this.move(o);
		}
		this.model.touchObjects();
	}

	private endDrag(): void {
		const drag = this.dragStart;
		this.dragStart = null;
		if (!drag) return;
		const before: Snapshot[] = [];
		const after: Snapshot[] = [];
		for (const [id, start] of drag.objects) {
			const o = this.model.object(id);
			if (!o) continue;
			const now = snapshot(o);
			if (sameSnapshot(start.was, now)) continue;
			before.push(start.was);
			after.push(now);
		}
		if (!before.length) return;
		const label = this.controls.mode === 'rotate' ? 'Rotate objects' : this.controls.mode === 'scale' ? 'Scale objects' : 'Move objects';
		this.pushEdit(label, before, after, false);
	}

	// ---- Editing commands (spec 7.8, 7.11) ----

	/** Adds objects to the scene as one undoable command (place, paste, duplicate). */
	commandAdd(objects: PlacedObject[], label: string): void {
		const apply = () => {
			for (const o of objects) {
				this.model.addObject(o);
				this.spawn(o);
			}
			this.select(objects.map((o) => o.id));
		};
		apply();
		this.commands.push({
			label,
			bytes: objects.length * 300,
			undo: () => {
				for (const o of objects) {
					this.model.removeObject(o.id);
					this.despawn(o.id);
				}
				this.pruneSelection();
			},
			redo: apply,
		});
	}

	/** Deletes the selection (locked objects stay) as one undoable command. */
	deleteSelection(): void {
		const removed = this.selectedObjects().filter((o) => !o.locked);
		if (!removed.length) return;
		const apply = () => {
			for (const o of removed) {
				this.model.removeObject(o.id);
				this.despawn(o.id);
			}
			this.pruneSelection();
		};
		apply();
		this.commands.push({
			label: `Delete ${removed.length} object${removed.length === 1 ? '' : 's'}`,
			bytes: removed.length * 300,
			undo: () => {
				for (const o of removed) {
					this.model.addObject(o);
					this.spawn(o);
				}
			},
			redo: apply,
		});
	}

	/** Copies the selection for paste, here or in another open scene this session. */
	copySelection(): void {
		SceneObjects.clipboardObjects = this.selectedObjects().map((o) => structuredClone(o));
		if (SceneObjects.clipboardObjects.length) this.onNotice(`Copied ${SceneObjects.clipboardObjects.length} object${SceneObjects.clipboardObjects.length === 1 ? '' : 's'}`);
	}

	/** Pastes copies as new objects (no baseKey carries over, spec 6.5), nudged a little east. */
	paste(): void {
		const copies = SceneObjects.clipboardObjects.map((o): PlacedObject => ({
			...structuredClone(o),
			id: crypto.randomUUID(),
			baseKey: undefined,
			locked: undefined,
			position: [o.position[0] + 2, o.position[1], o.position[2] + 2] as Vec3,
		}));
		if (!copies.length) return;
		this.commandAdd(copies, `Paste ${copies.length} object${copies.length === 1 ? '' : 's'}`);
	}

	/** Ctrl+D: copies of the selection, selected, in one command. */
	duplicateSelection(): void {
		const copies = this.selectedObjects().map((o): PlacedObject => ({
			...structuredClone(o),
			id: crypto.randomUUID(),
			baseKey: undefined,
			locked: undefined,
			position: [o.position[0] + 2, o.position[1], o.position[2] + 2] as Vec3,
		}));
		if (!copies.length) return;
		this.commandAdd(copies, `Duplicate ${copies.length} object${copies.length === 1 ? '' : 's'}`);
	}

	/** Sets each unlocked selected object down on the terrain under it (spec 7.8). */
	dropToGround(): void {
		const edits: { before: Snapshot; after: Snapshot }[] = [];
		for (const o of this.selectedObjects()) {
			if (o.locked) continue;
			const ground = this.surfaceAt(o.position[0], o.position[2]);
			if (ground === null || ground === o.position[1]) continue;
			const before = snapshot(o);
			const after = snapshot(o);
			after.position[1] = ground;
			edits.push({ before, after });
		}
		if (!edits.length) return;
		this.pushEdit('Drop to ground', edits.map((e) => e.before), edits.map((e) => e.after));
	}

	/** Locks or unlocks the selection; locked objects can't be moved or deleted. */
	setLocked(locked: boolean): void {
		this.editSelection('Lock objects', (after) => {
			after.locked = locked || undefined;
		}, true);
	}

	/** Labels the selection as one group; clicking any member later selects them all. */
	setGroup(name: string): void {
		this.editSelection('Group objects', (after) => {
			after.group = name.trim() || undefined;
		}, true);
	}

	/** A placed WMO's doodad set names, for the panel's choice; null until its model loads. */
	doodadSets(o: PlacedObject): string[] | null {
		if (o.kind !== 'wmo') return null;
		return this.manager.modelInfo(o.kind, o.fdid)?.doodadSets ?? null;
	}

	/** Chooses the doodad set shown inside the selected buildings (set 0 always shows, spec 7.8). */
	setDoodadSet(set: number): void {
		this.editSelection('Change doodad set', (after, o) => {
			if (o.kind === 'wmo') after.doodadSet = set;
		});
	}

	/** Chooses the name set of the selected buildings (which WMOAreaTable rows name its rooms). */
	setNameSet(set: number): void {
		this.editSelection('Change name set', (after, o) => {
			if (o.kind === 'wmo') after.nameSet = set;
		});
	}

	/** An edit of every selected object's snapshot, as one undoable command. */
	editSelection(label: string, change: (after: Snapshot, o: PlacedObject) => void, includeLocked = false): void {
		const before: Snapshot[] = [];
		const after: Snapshot[] = [];
		for (const o of this.selectedObjects()) {
			if (o.locked && !includeLocked) continue;
			const was = snapshot(o);
			const now = snapshot(o);
			change(now, o);
			if (sameSnapshot(was, now)) continue;
			before.push(was);
			after.push(now);
		}
		if (before.length) this.pushEdit(label, before, after);
	}

	// ---- Revert to base (spec 7.11, copied scenes) ----

	/** How many selected objects are copied ones that can go back to their source placement. */
	get revertableCount(): number {
		return this.selectedObjects().filter((o) => o.baseKey).length;
	}

	/** Puts the selected copied objects back where the source map has them, as one command. */
	revertSelectionToBase(): void {
		const templates = new Map((this.model.baseData?.objects ?? []).map((t) => [t.baseKey, t]));
		this.editSelection('Revert objects to base', (after, o) => {
			const t = o.baseKey ? templates.get(o.baseKey) : undefined;
			if (!t) return;
			after.position = [...t.position] as Vec3;
			after.rotation = [...t.rotation] as Vec3;
			after.scale = t.scale;
			after.doodadSet = t.kind === 'wmo' ? t.doodadSet ?? 0 : undefined;
			after.nameSet = t.kind === 'wmo' ? t.nameSet ?? 0 : undefined;
			after.locked = undefined;
			after.group = undefined;
		}, true);
	}

	/** Copied objects the user deleted, which restoreDeleted would bring back. */
	get deletedBaseCount(): number {
		const present = new Set(this.model.objects.map((o) => o.baseKey));
		return (this.model.baseData?.objects ?? []).filter((t) => !present.has(t.baseKey)).length;
	}

	/** Brings back every deleted copied object at its source placement, as one command. */
	restoreDeleted(): void {
		const present = new Set(this.model.objects.map((o) => o.baseKey));
		const back = (this.model.baseData?.objects ?? []).filter((t) => !present.has(t.baseKey)).map(materialize);
		if (!back.length) return;
		this.commandAdd(back, `Restore ${back.length} deleted object${back.length === 1 ? '' : 's'}`);
	}

	/** Writes snapshots back to the objects and pushes the command; applyNow first applies after. */
	private pushEdit(label: string, before: Snapshot[], after: Snapshot[], applyNow = true): void {
		const write = (snapshots: Snapshot[]) => {
			for (const snap of snapshots) {
				const o = this.model.object(snap.id);
				if (!o) continue;
				const structural = o.doodadSet !== snap.doodadSet;
				o.position = [...snap.position] as Vec3;
				o.rotation = [...snap.rotation] as Vec3;
				o.scale = snap.scale;
				o.doodadSet = snap.doodadSet;
				o.nameSet = snap.nameSet;
				o.locked = snap.locked;
				o.group = snap.group;
				if (structural) this.respawn(o);
				else this.move(o);
			}
			this.model.touchObjects();
			this.onSelectionChange();
		};
		if (applyNow) write(after);
		this.commands.push({
			label,
			bytes: (before.length + after.length) * 200,
			undo: () => write(before),
			redo: () => write(after),
		});
	}

	dispose(): void {
		this.cancelBoxSelect();
		this.controls.dispose();
		for (const helper of this.boxes.values()) helper.dispose();
		this.boxes.clear();
		this.manager.disposeAll();
	}
}
