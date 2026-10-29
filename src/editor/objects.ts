import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { materialize } from '../scene/copyScene';
import type { SceneModel } from '../scene/sceneModel';
import type { NpcAppearance, PlacedNpc, PlacedObject, Vec3 } from '../scene/types';
import { ObjectManager } from '../viewer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import type { CommandStack } from './commands';
import type { PlaceAsset } from './modelBrowser';
import { SceneNpcs, type NpcAsset } from './npcs';
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

/** The NPCs tool's settings (spec 7.9.1), edited by the properties panel. */
export interface NpcPlaceSettings {
	mode: 'place' | 'select';
	/** The appearance the NPCs tab armed; null places nothing. */
	asset: NpcAsset | null;
}

export type GizmoMode = 'translate' | 'rotate' | 'scale';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** Angle snap step (spec 7.8). */
const ANGLE_SNAP = 15 * RAD;
/** Pixels a press may move and still count as a click, not a box drag. */
const DRAG_THRESHOLD = 4;
const SELECTION_COLOR = 0xffc24b;
const NPC_SELECTION_COLOR = 0x7fd4ff;

/**
 * Something placed in the scene that can be selected and edited: a doodad or building (spec
 * 7.8) or an NPC (spec 7.9.1), which share the selection, the gizmo and the editing commands.
 */
export type Entity = { kind: 'object'; o: PlacedObject } | { kind: 'npc'; n: PlacedNpc };

/** The fields an edit command snapshots: everything but the identity. NPCs keep their facing as rotation[1]. */
interface Snapshot {
	id: string;
	npc: boolean;
	position: Vec3;
	rotation: Vec3;
	scale: number;
	doodadSet?: number;
	nameSet?: number;
	locked?: boolean;
	group?: string;
	name?: string;
	subName?: string;
	appearance?: NpcAppearance;
	/** NPCs: the idle sequence chosen (spec 7.9.1); undefined for Stand. */
	idle?: number;
}

function snapshot(e: Entity): Snapshot {
	if (e.kind === 'npc') {
		const n = e.n;
		return { id: n.id, npc: true, position: [...n.position] as Vec3, rotation: [0, n.facing, 0], scale: n.scale, locked: n.locked, group: n.group, name: n.name, subName: n.subName, appearance: structuredClone(n.appearance), idle: n.idle };
	}
	const o = e.o;
	return { id: o.id, npc: false, position: [...o.position] as Vec3, rotation: [...o.rotation] as Vec3, scale: o.scale, doodadSet: o.doodadSet, nameSet: o.nameSet, locked: o.locked, group: o.group };
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return (
		a.position.every((v, i) => v === b.position[i]) &&
		a.rotation.every((v, i) => v === b.rotation[i]) &&
		a.scale === b.scale &&
		a.doodadSet === b.doodadSet &&
		a.nameSet === b.nameSet &&
		a.locked === b.locked &&
		a.group === b.group &&
		a.name === b.name &&
		a.subName === b.subName &&
		a.idle === b.idle &&
		JSON.stringify(a.appearance) === JSON.stringify(b.appearance)
	);
}

/** The facing (degrees, the placement's Y rotation) that points a model's front along a horizontal direction. */
export function facingToward(dx: number, dz: number): number {
	return Math.atan2(dx, dz) * DEG;
}

/**
 * The editor's placed objects and NPCs: mirrors scene.objects into the explorer's instanced
 * ObjectManager (each placed object is one loose instance, keyed by its UUID), places the armed
 * asset or NPC on click, and owns the selection, its outline boxes and the transform gizmo.
 * Every change is one undoable command.
 */
export class SceneObjects {
	readonly manager: ObjectManager;
	readonly npcs: SceneNpcs;
	readonly place: PlaceSettings = { mode: 'place', asset: null, alignToSlope: false, randomYaw: false, scaleMin: 1, scaleMax: 1, gridSnap: 0, angleSnap: true };
	readonly npcPlace: NpcPlaceSettings = { mode: 'place', asset: null };
	/** Selected ids (objects and NPCs); the panel and gizmo follow it. */
	readonly selection = new Set<string>();
	/** The last entity selected: the gizmo pivots on it. */
	private primary: string | null = null;
	onSelectionChange: () => void = () => {};
	onNotice: (text: string) => void = () => {};

	private readonly controls: TransformControls;
	private readonly gizmoHelper: THREE.Object3D;
	private readonly pivot = new THREE.Object3D();
	private readonly boxes = new Map<string, THREE.Box3Helper>();
	private readonly boxGroup = new THREE.Group();
	private active = false;
	/** Set while a gizmo drag is open: the pivot and each entity where the drag started. */
	private dragStart: { pivot: THREE.Matrix4; entities: Map<string, { matrix: THREE.Matrix4; was: Snapshot }> } | null = null;
	/** Copied entities, shared across scenes in the session (spec 7.8 copy/paste). */
	private static clipboard: Snapshot[] = [];
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
		prepare: (object: THREE.Object3D, shadowPass?: boolean) => Promise<void>,
		/** The terrain surface, for placing and dropping to ground. */
		private readonly surfaceAt: (x: number, z: number) => number | null,
	) {
		this.manager = new ObjectManager(storage, compressed, anisotropy, prepare);
		this.npcs = new SceneNpcs(this.manager, model, storage);
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

	/** Spawns every saved object and NPC; the manager loads and draws the models as they come. */
	load(): void {
		for (const o of this.model.objects) this.spawn(o);
		void this.npcs.load();
	}

	/** The Place or NPCs tool is active: the gizmo shows and clicks go to entities. */
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
		if (mode === 'scale' && this.selection.size && this.selectedObjects().length && this.selectedObjects().every((o) => o.kind === 'wmo') && !this.selectedNpcs().length) {
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
		// NPCs only turn about the vertical (spec 7.9.1): a selection of nothing else hides the other rings.
		const npcOnly = this.selection.size > 0 && this.selectedObjects().length === 0;
		const yOnly = npcOnly && this.controls.mode === 'rotate';
		this.controls.showX = !yOnly;
		this.controls.showZ = !yOnly;
		if (!this.dragStart) this.syncPivot();
		this.syncBoxes();
	}

	get count(): number {
		return this.model.objects.length;
	}

	get npcCount(): number {
		return this.model.npcs.length;
	}

	/**
	 * Whether the terrain under a point is shown: large scenes stream their tiles (Phase 4), and
	 * objects stream with them, so nothing floats over terrain that isn't built.
	 */
	get visibleAt(): (x: number, z: number) => boolean {
		return this.npcs.visibleAt;
	}

	set visibleAt(fn: (x: number, z: number) => boolean) {
		this.npcs.visibleAt = fn;
	}

	/** Ids of the objects placed in the manager now. */
	private readonly spawned = new Set<string>();

	private spawn(o: PlacedObject): void {
		if (!this.visibleAt(o.position[0], o.position[2])) return;
		this.manager.placeLoose(o.id, o.kind, o.fdid, objectMatrix(o), o.doodadSet ?? 0);
		this.spawned.add(o.id);
	}

	private despawn(id: string): void {
		this.manager.removeLoose(id);
		this.spawned.delete(id);
	}

	/** Spawns entities whose terrain streamed in and removes those whose terrain streamed out. */
	syncVisibility(): void {
		for (const o of this.model.objects) {
			const visible = this.visibleAt(o.position[0], o.position[2]);
			if (visible && !this.spawned.has(o.id)) this.spawn(o);
			else if (!visible && this.spawned.has(o.id)) this.despawn(o.id);
		}
		this.npcs.syncVisibility();
	}

	/** Re-places an object whose structure changed (doodad set); a plain move keeps the instance. */
	private respawn(o: PlacedObject): void {
		this.despawn(o.id);
		this.spawn(o);
	}

	private move(o: PlacedObject): void {
		if (this.visibleAt(o.position[0], o.position[2])) {
			this.manager.placeLoose(o.id, o.kind, o.fdid, objectMatrix(o), o.doodadSet ?? 0);
			this.spawned.add(o.id);
		} else if (this.spawned.has(o.id)) {
			this.despawn(o.id);
		}
	}

	// ---- Entities: objects and NPCs alike ----

	entity(id: string): Entity | null {
		const o = this.model.object(id);
		if (o) return { kind: 'object', o };
		const n = this.model.npc(id);
		return n ? { kind: 'npc', n } : null;
	}

	private entityMatrix(e: Entity): THREE.Matrix4 {
		return e.kind === 'npc' ? this.npcs.matrix(e.n) : objectMatrix(e.o);
	}

	private entityPosition(e: Entity): Vec3 {
		return e.kind === 'npc' ? e.n.position : e.o.position;
	}

	private isSpawned(e: Entity): boolean {
		return e.kind === 'npc' ? this.npcs.isSpawned(e.n.id) : this.spawned.has(e.o.id);
	}

	private isLocked(e: Entity): boolean {
		return !!(e.kind === 'npc' ? e.n.locked : e.o.locked);
	}

	private groupOf(e: Entity): string | undefined {
		return e.kind === 'npc' ? e.n.group : e.o.group;
	}

	private *entities(): Generator<Entity> {
		for (const o of this.model.objects) yield { kind: 'object', o };
		for (const n of this.model.npcs) yield { kind: 'npc', n };
	}

	/** Adds an entity back to the model and the view (place, paste, redo, undo of a delete). */
	private add(e: Entity): void {
		if (e.kind === 'npc') {
			this.model.addNpc(e.n);
			this.npcs.spawn(e.n);
		} else {
			this.model.addObject(e.o);
			this.spawn(e.o);
		}
	}

	private remove(e: Entity): void {
		if (e.kind === 'npc') {
			this.model.removeNpc(e.n.id);
			this.npcs.despawn(e.n.id);
		} else {
			this.model.removeObject(e.o.id);
			this.despawn(e.o.id);
		}
	}

	/** The entity a pick ray hits, resolved to its placed id (a WMO's own doodads count as it). */
	private pickId(raycaster: THREE.Raycaster): string | null {
		const hit = this.manager.pick(raycaster);
		if (!hit) return null;
		const id = hit.key.split(':', 1)[0];
		return this.entity(id) ? id : null;
	}

	/** The NPC a pick ray hits (play-mode targeting, spec 7.10), or null for anything else. */
	pickNpc(raycaster: THREE.Raycaster): PlacedNpc | null {
		const hit = this.manager.pick(raycaster);
		return hit ? this.model.npc(hit.key.split(':', 1)[0]) : null;
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
		const point = this.pointUnder(raycaster, terrain);
		if (!point) return;
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
		this.commandAdd([{ kind: 'object', o: object }], `Place ${asset.label}`);
	}

	/**
	 * A left click with the NPCs tool in place mode (spec 7.9.1): drops the armed NPC on the
	 * ground under the cursor, facing the camera.
	 */
	placeNpcClick(raycaster: THREE.Raycaster, terrain: { x: number; z: number; height: number } | null): void {
		const asset = this.npcPlace.asset;
		if (!asset) {
			this.onNotice('Pick a creature or a custom NPC from the NPCs tab first');
			return;
		}
		if (asset.appearance.kind === 'custom' && !this.model.preset(asset.appearance.presetId)) {
			this.onNotice('That preset is no longer in this scene');
			return;
		}
		const point = this.pointUnder(raycaster, terrain);
		if (!point) return;
		const npc: PlacedNpc = {
			id: crypto.randomUUID(),
			appearance: structuredClone(asset.appearance),
			position: [point.x, point.y, point.z],
			facing: facingToward(this.camera.position.x - point.x, this.camera.position.z - point.z),
			scale: 1,
			animation: 'idle',
		};
		this.commandAdd([{ kind: 'npc', n: npc }], `Place ${asset.label}`);
	}

	/** The ground under the cursor, or an object surface when nearer, snapped to the grid. */
	private pointUnder(raycaster: THREE.Raycaster, terrain: { x: number; z: number; height: number } | null): THREE.Vector3 | null {
		let point: THREE.Vector3 | null = terrain ? new THREE.Vector3(terrain.x, terrain.height, terrain.z) : null;
		const onObject = this.manager.pick(raycaster);
		if (onObject && (!point || onObject.distance < raycaster.ray.origin.distanceTo(point))) point = onObject.point;
		if (!point) return null;
		const snap = this.place.gridSnap;
		if (snap > 0) {
			point.x = Math.round(point.x / snap) * snap;
			point.z = Math.round(point.z / snap) * snap;
			const ground = this.surfaceAt(point.x, point.z);
			if (ground !== null && !onObject) point.y = ground;
		}
		return point;
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
	 * A left click (not a drag, which turns the camera) with the Place or NPCs tool: selects the
	 * entity under the cursor; elsewhere, drops the armed asset on the ground in place mode, or
	 * clears the selection in select mode.
	 */
	click(raycaster: THREE.Raycaster, terrain: { x: number; z: number; height: number } | null, event: MouseEvent, npcTool: boolean): void {
		if (this.pickId(raycaster)) return this.selectClick(raycaster, event);
		const placing = npcTool ? this.npcPlace.mode === 'place' : this.place.mode === 'place';
		if (!placing) this.clearSelection();
		else if (!terrain) return;
		else if (npcTool) this.placeNpcClick(raycaster, terrain);
		else this.placeClick(raycaster, terrain);
	}

	/**
	 * A press with Shift in select mode: picks the entity under the cursor (its whole group with it,
	 * unless Shift narrows to one), Shift toggles, and a press on empty ground starts a box select
	 * (a plain drag turns the camera, so only Shift gets here on nothing).
	 */
	selectClick(raycaster: THREE.Raycaster, event: MouseEvent): void {
		const id = this.pickId(raycaster);
		if (!id) {
			this.beginBoxSelect(event);
			return;
		}
		const e = this.entity(id)!;
		const group = this.groupOf(e);
		const ids = group && !event.shiftKey ? [...this.entities()].filter((other) => this.groupOf(other) === group).map((other) => (other.kind === 'npc' ? other.n.id : other.o.id)) : [id];
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
			if (!this.entity(id)) {
				this.selection.delete(id);
				changed = true;
			}
		}
		if (changed) this.onSelectionChange();
	}

	/** The selected entities, locked ones included. */
	selectedEntities(): Entity[] {
		return [...this.selection].flatMap((id) => this.entity(id) ?? []);
	}

	/** The selected doodads and buildings, locked ones included. */
	selectedObjects(): PlacedObject[] {
		return this.selectedEntities().flatMap((e) => (e.kind === 'object' ? [e.o] : []));
	}

	/** The selected NPCs, locked ones included. */
	selectedNpcs(): PlacedNpc[] {
		return this.selectedEntities().flatMap((e) => (e.kind === 'npc' ? [e.n] : []));
	}

	/** A drag on empty ground: a screen rectangle that selects the entities whose centre it covers. */
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
		for (const entity of this.entities()) {
			if (!this.isSpawned(entity)) continue;
			const p = this.entityPosition(entity);
			point.set(p[0], p[1], p[2]).project(this.camera);
			if (point.z > 1 || point.z < -1) continue;
			const sx = rect.left + ((point.x + 1) / 2) * rect.width;
			const sy = rect.top + ((1 - point.y) / 2) * rect.height;
			if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(entity.kind === 'npc' ? entity.n.id : entity.o.id);
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
			const e = this.entity(id);
			if (!e) continue;
			let helper = this.boxes.get(id);
			if (!helper) {
				helper = new THREE.Box3Helper(new THREE.Box3(), e.kind === 'npc' ? NPC_SELECTION_COLOR : SELECTION_COLOR);
				this.boxes.set(id, helper);
				this.boxGroup.add(helper);
			}
			const box = e.kind === 'npc' ? this.npcs.modelBox(e.n) : this.manager.modelInfo(e.o.kind, e.o.fdid)?.box ?? null;
			const matrix = this.entityMatrix(e);
			if (box) helper.box.copy(box).applyMatrix4(matrix);
			else {
				// Unloaded (or missing, spec 7.11): a placeholder box the size of a person.
				const p = this.entityPosition(e);
				helper.box.setFromCenterAndSize(new THREE.Vector3(p[0], p[1] + 1, p[2]), new THREE.Vector3(1, 2, 1));
			}
		}
	}

	// ---- The gizmo (spec 7.8) ----

	/** Puts the pivot on the primary selected entity, so the gizmo sits and turns with it. */
	private syncPivot(): void {
		const e = (this.primary && this.entity(this.primary)) || this.selectedEntities().at(-1);
		if (!e) return;
		const matrix = this.entityMatrix(e);
		matrix.decompose(this.pivot.position, this.pivot.quaternion, this.pivot.scale);
		const scale = e.kind === 'npc' ? e.n.scale : e.o.scale;
		this.pivot.scale.setScalar(Math.max(scale, 0.01));
	}

	private beginDrag(): void {
		const entities = new Map<string, { matrix: THREE.Matrix4; was: Snapshot }>();
		for (const e of this.selectedEntities()) {
			if (this.isLocked(e)) continue;
			entities.set(e.kind === 'npc' ? e.n.id : e.o.id, { matrix: this.entityMatrix(e), was: snapshot(e) });
		}
		this.syncPivot();
		this.pivot.updateMatrix();
		this.dragStart = { pivot: this.pivot.matrix.clone(), entities };
	}

	/** Applies the gizmo's delta to every unlocked selected entity, live during the drag. */
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
		for (const [id, start] of drag.entities) {
			const e = this.entity(id);
			if (!e) continue;
			moved.multiplyMatrices(delta, start.matrix);
			const p = matrixToPlacement(moved);
			if (e.kind === 'npc') {
				e.n.position = p.position;
				// NPCs stay upright: the gizmo only turns them about the vertical.
				e.n.facing = p.rotation[1];
				e.n.scale = Math.max(0.01, p.scale / this.npcs.displayScale(e.n.appearance));
				this.npcs.move(e.n);
			} else {
				e.o.position = p.position;
				e.o.rotation = p.rotation;
				e.o.scale = e.o.kind === 'wmo' ? 1 : Math.max(0.01, p.scale);
				this.move(e.o);
			}
		}
		this.model.touchObjects();
		this.model.touchNpcs();
	}

	private endDrag(): void {
		const drag = this.dragStart;
		this.dragStart = null;
		if (!drag) return;
		const before: Snapshot[] = [];
		const after: Snapshot[] = [];
		for (const [id, start] of drag.entities) {
			const e = this.entity(id);
			if (!e) continue;
			const now = snapshot(e);
			if (sameSnapshot(start.was, now)) continue;
			before.push(start.was);
			after.push(now);
		}
		if (!before.length) return;
		const label = this.controls.mode === 'rotate' ? 'Rotate' : this.controls.mode === 'scale' ? 'Scale' : 'Move';
		this.pushEdit(`${label} ${before.some((s) => s.npc) && before.every((s) => s.npc) ? 'NPCs' : 'objects'}`, before, after, false);
	}

	// ---- Editing commands (spec 7.8, 7.11) ----

	/** Adds entities to the scene as one undoable command (place, paste, duplicate). */
	commandAdd(entities: Entity[], label: string): void {
		const apply = () => {
			for (const e of entities) this.add(e);
			this.select(entities.map((e) => (e.kind === 'npc' ? e.n.id : e.o.id)));
		};
		apply();
		this.commands.push({
			label,
			bytes: entities.length * 300,
			undo: () => {
				for (const e of entities) this.remove(e);
				this.pruneSelection();
			},
			redo: apply,
		});
	}

	/** Deletes the selection (locked entities stay) as one undoable command. */
	deleteSelection(): void {
		const removed = this.selectedEntities().filter((e) => !this.isLocked(e));
		if (!removed.length) return;
		const apply = () => {
			for (const e of removed) this.remove(e);
			this.pruneSelection();
		};
		apply();
		const npcs = removed.filter((e) => e.kind === 'npc').length;
		const what = npcs === removed.length ? `NPC${npcs === 1 ? '' : 's'}` : `object${removed.length === 1 ? '' : 's'}`;
		this.commands.push({
			label: `Delete ${removed.length} ${what}`,
			bytes: removed.length * 300,
			undo: () => {
				for (const e of removed) this.add(e);
			},
			redo: apply,
		});
	}

	/** Copies the selection for paste, here or in another open scene this session. */
	copySelection(): void {
		SceneObjects.clipboard = this.selectedEntities().map((e) => ({ ...snapshot(e), kind: e.kind === 'object' ? e.o.kind : undefined, fdid: e.kind === 'object' ? e.o.fdid : undefined }) as Snapshot);
		const n = SceneObjects.clipboard.length;
		if (n) this.onNotice(`Copied ${n} ${n === 1 ? 'item' : 'items'}`);
	}

	/** Fresh copies of entities as new ones (no baseKey carries over, spec 6.5), nudged a little east. */
	private copies(entities: Entity[]): Entity[] {
		return entities.flatMap((e): Entity[] => {
			if (e.kind === 'npc') {
				const n = structuredClone(e.n);
				n.id = crypto.randomUUID();
				delete n.locked;
				n.position = [n.position[0] + 2, n.position[1], n.position[2] + 2];
				// A preset copied from another scene comes along, so the copy stays wearable.
				if (n.appearance.kind === 'custom' && !this.model.preset(n.appearance.presetId)) return [];
				return [{ kind: 'npc', n }];
			}
			const o = structuredClone(e.o);
			o.id = crypto.randomUUID();
			delete o.baseKey;
			delete o.locked;
			o.position = [o.position[0] + 2, o.position[1], o.position[2] + 2];
			return [{ kind: 'object', o }];
		});
	}

	/** Pastes copies as new entities. */
	paste(): void {
		const entities = SceneObjects.clipboard.flatMap((s): Entity[] => {
			const extra = s as Snapshot & { kind?: 'm2' | 'wmo'; fdid?: number };
			if (s.npc) {
				if (!s.appearance) return [];
				return [{ kind: 'npc', n: { id: s.id, appearance: s.appearance, position: s.position, facing: s.rotation[1], scale: s.scale, animation: 'idle', name: s.name, subName: s.subName, group: s.group, ...(s.idle ? { idle: s.idle } : {}) } }];
			}
			if (!extra.kind || !extra.fdid) return [];
			return [{ kind: 'object', o: { id: s.id, kind: extra.kind, fdid: extra.fdid, position: s.position, rotation: s.rotation, scale: s.scale, doodadSet: s.doodadSet, nameSet: s.nameSet, group: s.group } }];
		});
		const pasted = this.copies(entities);
		if (!pasted.length) return;
		this.commandAdd(pasted, `Paste ${pasted.length} ${pasted.length === 1 ? 'item' : 'items'}`);
	}

	/** Ctrl+D: copies of the selection, selected, in one command. */
	duplicateSelection(): void {
		const copies = this.copies(this.selectedEntities());
		if (!copies.length) return;
		this.commandAdd(copies, `Duplicate ${copies.length} ${copies.length === 1 ? 'item' : 'items'}`);
	}

	/** Sets each unlocked selected entity down on the terrain under it (spec 7.8). */
	dropToGround(): void {
		const edits: { before: Snapshot; after: Snapshot }[] = [];
		for (const e of this.selectedEntities()) {
			if (this.isLocked(e)) continue;
			const p = this.entityPosition(e);
			const ground = this.surfaceAt(p[0], p[2]);
			if (ground === null || ground === p[1]) continue;
			const before = snapshot(e);
			const after = snapshot(e);
			after.position[1] = ground;
			edits.push({ before, after });
		}
		if (!edits.length) return;
		this.pushEdit('Drop to ground', edits.map((e) => e.before), edits.map((e) => e.after));
	}

	/** Locks or unlocks the selection; locked entities can't be moved or deleted. */
	setLocked(locked: boolean): void {
		this.editSelection('Lock', (after) => {
			after.locked = locked || undefined;
		}, true);
	}

	/** Labels the selection as one group; clicking any member later selects them all. */
	setGroup(name: string): void {
		this.editSelection('Group', (after) => {
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
		this.editSelection('Change doodad set', (after, e) => {
			if (e.kind === 'object' && e.o.kind === 'wmo') after.doodadSet = set;
		});
	}

	/** Chooses the name set of the selected buildings (which WMOAreaTable rows name its rooms). */
	setNameSet(set: number): void {
		this.editSelection('Change name set', (after, e) => {
			if (e.kind === 'object' && e.o.kind === 'wmo') after.nameSet = set;
		});
	}

	// ---- NPC properties (spec 7.9.1) ----

	/** Names the selected NPCs (shown on their nameplates in play mode). */
	setNpcName(name: string, subName: string): void {
		this.editSelection('Rename NPC', (after, e) => {
			if (e.kind !== 'npc') return;
			after.name = name.trim() || undefined;
			after.subName = subName.trim() || undefined;
		}, true);
	}

	/** Turns the selected NPCs to a facing (degrees). */
	setNpcFacing(facing: number): void {
		this.editSelection('Turn NPC', (after, e) => {
			if (e.kind === 'npc') after.rotation = [0, facing, 0];
		});
	}

	/** Sizes the selected NPCs. */
	setNpcScale(scale: number): void {
		this.editSelection('Scale NPC', (after, e) => {
			if (e.kind === 'npc') after.scale = Math.max(0.01, scale);
		});
	}

	/** Changes the selected NPCs' appearance to a creature display or an embedded preset. */
	setNpcAppearance(appearance: NpcAppearance, label: string): void {
		this.editSelection(`Change appearance to ${label}`, (after, e) => {
			if (e.kind === 'npc') after.appearance = structuredClone(appearance);
		});
	}

	/** Sets the sequence the selected NPCs idle in (an AnimationData ID; 0 for the model's Stand), spec 7.9.1. */
	setNpcIdle(idle: number, label: string): void {
		this.editSelection(`Idle as ${label}`, (after, e) => {
			if (e.kind === 'npc') after.idle = idle > 0 ? idle : undefined;
		});
	}

	/** Preset edits re-dress every NPC wearing it (the model is re-placed as the new look). */
	refreshPreset(presetId: string): void {
		for (const n of this.model.npcs) {
			if (n.appearance.kind === 'custom' && n.appearance.presetId === presetId) this.npcs.move(n);
		}
	}

	/** An edit of every selected entity's snapshot, as one undoable command. */
	editSelection(label: string, change: (after: Snapshot, e: Entity) => void, includeLocked = false): void {
		const before: Snapshot[] = [];
		const after: Snapshot[] = [];
		for (const e of this.selectedEntities()) {
			if (this.isLocked(e) && !includeLocked) continue;
			const was = snapshot(e);
			const now = snapshot(e);
			change(now, e);
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
		this.editSelection('Revert objects to base', (after, e) => {
			const t = e.kind === 'object' && e.o.baseKey ? templates.get(e.o.baseKey) : undefined;
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
		this.commandAdd(back.map((o): Entity => ({ kind: 'object', o })), `Restore ${back.length} deleted object${back.length === 1 ? '' : 's'}`);
	}

	/** Writes snapshots back to the entities and pushes the command; applyNow first applies after. */
	private pushEdit(label: string, before: Snapshot[], after: Snapshot[], applyNow = true): void {
		const write = (snapshots: Snapshot[]) => {
			for (const snap of snapshots) {
				const e = this.entity(snap.id);
				if (!e) continue;
				if (e.kind === 'npc') {
					const n = e.n;
					n.position = [...snap.position] as Vec3;
					n.facing = snap.rotation[1];
					n.scale = snap.scale;
					n.locked = snap.locked;
					n.group = snap.group;
					n.name = snap.name;
					n.subName = snap.subName;
					if (snap.idle) n.idle = snap.idle;
					else delete n.idle;
					if (snap.appearance) n.appearance = structuredClone(snap.appearance);
					this.npcs.move(n);
				} else {
					const o = e.o;
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
			}
			this.model.touchObjects();
			this.model.touchNpcs();
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
