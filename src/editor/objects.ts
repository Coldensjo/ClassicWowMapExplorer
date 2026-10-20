import * as THREE from 'three';
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
	/** Grid snap in yards; 0 is off. */
	gridSnap: number;
	/** 15° angle snap for the rotate gizmo. */
	angleSnap: boolean;
}

const RAD = Math.PI / 180;

/**
 * The editor's placed objects (spec 7.8): mirrors scene.objects into the explorer's instanced
 * ObjectManager (each placed object is one loose instance, keyed by its UUID), places the armed
 * asset on click, and owns the selection. Every change is one undoable command.
 */
export class SceneObjects {
	readonly manager: ObjectManager;
	readonly place: PlaceSettings = { mode: 'place', asset: null, alignToSlope: false, randomYaw: false, scaleMin: 1, scaleMax: 1, gridSnap: 0, angleSnap: true };
	/** Selected object ids; the panel and gizmo follow it. */
	readonly selection = new Set<string>();
	onSelectionChange: () => void = () => {};
	onNotice: (text: string) => void = () => {};

	constructor(
		scene: THREE.Scene,
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
		scene.add(this.manager.group);
	}

	/** Spawns every saved object; the manager loads and draws the models as they come. */
	load(): void {
		for (const o of this.model.objects) this.spawn(o);
	}

	/** Call once per frame. */
	update(now: number, camera: THREE.Vector3): void {
		this.manager.update(now, camera);
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
	respawn(o: PlacedObject): void {
		this.despawn(o.id);
		this.spawn(o);
	}

	/** The object a pick ray hits, resolved to its placed id (a WMO's own doodads count as it). */
	pickId(raycaster: THREE.Raycaster): { id: string; distance: number } | null {
		const hit = this.manager.pick(raycaster);
		if (!hit) return null;
		const id = hit.key.split(':', 1)[0];
		return this.model.object(id) ? { id, distance: hit.distance } : null;
	}

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

	/** Replaces the selection (or adds to it) and tells the panel. */
	select(ids: string[], add = false): void {
		if (!add) this.selection.clear();
		for (const id of ids) this.selection.add(id);
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

	dispose(): void {
		this.manager.disposeAll();
	}
}
