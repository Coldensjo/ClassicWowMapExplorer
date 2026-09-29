import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { ModelData, ObjectKind, Placement } from '../explorer/objects';
import type { SpawnInfo } from '../explorer/spawns';
import type { AsyncStorageApi } from '../worker/protocol';
import { createModelMaterial } from './modelMaterials';
import { liquidMaterials } from './terrainMaterials';
import { TextureCache } from './textureCache';

type Kind = ObjectKind;

// Ray casts use a model's BVH when it has one (buildings); InstancedMesh casts go through this too.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MODEL_BATCH = 24;
const MAX_MODEL_REQUESTS = 2;
/** Unused models stay cached this long, so flying back and forth doesn't reload them. */
const UNUSED_MODEL_TTL = 15000;
/** How often (ms) instance visibility is re-checked against the camera. */
const CULL_INTERVAL = 250;

/**
 * View distance for a doodad of a given (scaled) radius, like the game's doodad LOD: small props
 * vanish within a few hundred yards, big trees stay visible much further.
 */
function viewDistance(radius: number): number {
	return THREE.MathUtils.clamp(radius * 80, 150, 1600);
}

/** One model's geometry, drawn with a single InstancedMesh for every placed copy. */
class ModelEntry {
	state: 'queued' | 'loading' | 'ready' | 'failed' = 'queued';
	data: ModelData | null = null;
	mesh: THREE.InstancedMesh | null = null;
	geometry: THREE.BufferGeometry | null = null;
	materials: THREE.Material[] = [];
	textures: number[] = [];
	/** WMO liquid surfaces, instanced with the same matrices as the model. */
	liquids: { geometry: THREE.BufferGeometry; material: THREE.Material; mesh: THREE.InstancedMesh | null }[] = [];
	readonly instances = new Map<string, THREE.Matrix4>();
	/** Keys of the instances currently in the instance buffer (those within view distance). */
	visible = new Set<string>();
	/** Instance key for each slot in the instance buffer, for picking. */
	drawnKeys: string[] = [];
	radius = 0;
	dirty = false;
	unusedSince = 0;
	readonly onReady: ((entry: ModelEntry) => void)[] = [];

	constructor(readonly kind: Kind, readonly fdid: number) {}
}

/** A placed object; objects crossing tile borders are listed by several tiles. */
interface PlacedObject {
	refs: number;
	/** How many of those tiles are at full detail; WMO doodads show only while this is > 0. */
	detailRefs: number;
	placement: Placement;
	matrix: THREE.Matrix4;
	/** Model entries and instance keys this object contributed. */
	parts: { entry: ModelEntry; key: string }[];
	/** WMO doodad instances, kept apart so they can come and go with detail. */
	doodadParts: { entry: ModelEntry; key: string }[];
}

export type ObjectLevel = 'none' | 'wmo' | 'all';

interface TileRecord {
	wdt: number;
	placements: Placement[] | null;
	level: ObjectLevel;
	/** Object keys this tile holds a reference to, and whether it counts toward their detail. */
	applied: Map<string, boolean>;
	toWorld: THREE.Matrix4;
}

export interface ObjectStats {
	models: number;
	instances: number;
	drawn: number;
	loading: number;
}

/**
 * Doodads (M2) and buildings (WMO) around the camera. Placements come per tile; each
 * distinct model is loaded once and drawn instanced. Distant tiles show only buildings,
 * without their interior doodads, to keep the number of distinct models (draw calls) down.
 */
export class ObjectManager {
	readonly group = new THREE.Group();
	private readonly models = new Map<string, ModelEntry>();
	private readonly objects = new Map<string, PlacedObject>();
	private readonly tiles = new Map<string, TileRecord>();
	private readonly queue: ModelEntry[] = [];
	private requests = 0;
	private readonly textures: TextureCache;

	/**
	 * prepare compiles an object's shaders off the critical path (renderer.compileAsync), so a
	 * model's first frame doesn't stall on shader compilation.
	 */
	constructor(
		private readonly storage: AsyncStorageApi,
		compressed: boolean,
		anisotropy: number,
		private readonly prepare: (object: THREE.Object3D) => Promise<void>,
	) {
		this.textures = new TextureCache(storage, compressed, anisotropy);
	}

	/**
	 * Sets how much of a tile's objects to show: 'wmo' shows bare buildings for the distance,
	 * 'all' adds scattered doodads and the buildings' own doodads. offset moves continent
	 * space into the shared world.
	 */
	setTileLevel(tileKey: string, wdt: number, x: number, y: number, offset: THREE.Vector3, level: ObjectLevel): void {
		let tile = this.tiles.get(tileKey);
		if (!tile) {
			if (level === 'none') return;
			tile = { wdt, placements: null, level, applied: new Map(), toWorld: new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z) };
			this.tiles.set(tileKey, tile);
			const record = tile;
			this.storage.loadTileObjects(wdt, x, y).then((placements) => {
				record.placements = placements;
				this.apply(tileKey, record);
			}, (e) => console.warn(`Objects for ${tileKey}:`, e));
			return;
		}
		tile.level = level;
		this.apply(tileKey, tile);
	}

	private apply(tileKey: string, tile: TileRecord): void {
		if (this.tiles.get(tileKey) !== tile) return;
		const detail = tile.level === 'all';
		const wanted = new Map<string, Placement>();
		if (tile.placements && tile.level !== 'none') {
			for (const p of tile.placements) {
				if (detail || p.kind === 'wmo') wanted.set(`${tile.wdt}:${p.kind}:${p.uid}`, p);
			}
		}
		for (const [key, p] of wanted) {
			const had = tile.applied.get(key);
			if (had === undefined) this.acquire(key, p, tile.toWorld);
			if (had !== detail) {
				if (had !== undefined || detail) this.changeDetail(key, detail ? 1 : had ? -1 : 0);
				tile.applied.set(key, detail);
			}
		}
		for (const [key, hadDetail] of tile.applied) {
			if (wanted.has(key)) continue;
			tile.applied.delete(key);
			if (hadDetail) this.changeDetail(key, -1);
			this.release(key);
		}
		if (tile.level === 'none' && tile.placements) this.tiles.delete(tileKey);
	}

	private acquire(key: string, p: Placement, toWorld: THREE.Matrix4): void {
		const existing = this.objects.get(key);
		if (existing) {
			existing.refs++;
			return;
		}
		const object: PlacedObject = {
			refs: 1,
			detailRefs: 0,
			placement: p,
			matrix: toWorld.clone().multiply(new THREE.Matrix4().fromArray(p.matrix)),
			parts: [],
			doodadParts: [],
		};
		this.objects.set(key, object);
		object.parts.push(this.addInstance(p.kind, p.fdid, key, object.matrix));
	}

	private release(key: string): void {
		const object = this.objects.get(key);
		if (!object || --object.refs > 0) return;
		this.objects.delete(key);
		for (const part of [...object.parts, ...object.doodadParts]) this.removeInstance(part);
	}

	private changeDetail(key: string, delta: number): void {
		const object = this.objects.get(key);
		if (!object || delta === 0) return;
		object.detailRefs += delta;
		if (object.placement.kind !== 'wmo') return;
		if (object.detailRefs > 0 && object.doodadParts.length === 0) {
			this.whenReady('wmo', object.placement.fdid, (entry) => this.addWmoDoodads(key, object, entry));
		} else if (object.detailRefs <= 0) {
			for (const part of object.doodadParts) this.removeInstance(part);
			object.doodadParts = [];
		}
	}

	private addWmoDoodads(key: string, object: PlacedObject, entry: ModelEntry): void {
		// The WMO may have been removed, or lost detail, before it finished loading.
		if (this.objects.get(key) !== object || object.detailRefs <= 0 || object.doodadParts.length || !entry.data?.doodadSets) return;
		const sets = entry.data.doodadSets;
		// Set 0 is always shown; the placement can add one more.
		const chosen = new Set([0, object.placement.doodadSet]);
		let i = 0;
		for (const s of chosen) {
			for (const d of sets[s]?.doodads ?? []) {
				const matrix = object.matrix.clone().multiply(new THREE.Matrix4().fromArray(d.matrix));
				object.doodadParts.push(this.addInstance('m2', d.fdid, `${key}:${i++}`, matrix));
			}
		}
	}

	private addInstance(kind: Kind, fdid: number, key: string, matrix: THREE.Matrix4): { entry: ModelEntry; key: string } {
		const entry = this.entry(kind, fdid);
		entry.instances.set(key, matrix);
		entry.dirty = true;
		return { entry, key };
	}

	private removeInstance(part: { entry: ModelEntry; key: string }): void {
		part.entry.instances.delete(part.key);
		part.entry.dirty = true;
	}
	private entry(kind: Kind, fdid: number): ModelEntry {
		const id = `${kind}:${fdid}`;
		let entry = this.models.get(id);
		if (!entry) {
			entry = new ModelEntry(kind, fdid);
			this.models.set(id, entry);
			this.queue.push(entry);
		}
		return entry;
	}

	private whenReady(kind: Kind, fdid: number, fn: (entry: ModelEntry) => void): void {
		const entry = this.entry(kind, fdid);
		if (entry.state === 'ready') fn(entry);
		else entry.onReady.push(fn);
	}

	private lastCull = 0;
	private readonly camera = new THREE.Vector3();

	/** Call once per frame: starts model loads, culls by view distance and applies instance changes. */
	update(now: number, camera: THREE.Vector3): void {
		this.camera.copy(camera);
		const cull = now - this.lastCull > CULL_INTERVAL;
		if (cull) this.lastCull = now;
		while (this.requests < MAX_MODEL_REQUESTS && this.queue.length) {
			const batch = this.queue.splice(0, MODEL_BATCH).filter((e) => e.state === 'queued');
			if (batch.length) void this.load(batch);
		}
		for (const [id, entry] of this.models) {
			if (entry.state === 'ready' && (entry.dirty || (cull && this.visibilityChanged(entry)))) this.flush(entry);
			if (entry.instances.size === 0 && entry.state !== 'loading' && entry.state !== 'queued') {
				entry.unusedSince ||= now;
				if (now - entry.unusedSince > UNUSED_MODEL_TTL) {
					this.dispose(entry);
					this.models.delete(id);
				}
			} else {
				entry.unusedSince = 0;
			}
		}
	}

	private async load(batch: ModelEntry[]): Promise<void> {
		this.requests++;
		for (const e of batch) e.state = 'loading';
		try {
			const results = await this.storage.loadModels(batch.map((e) => ({ fdid: e.fdid, kind: e.kind })));
			await Promise.all(batch.map((entry, i) => this.build(entry, results[i])));
		} catch (e) {
			console.warn('Model batch failed:', e);
			for (const entry of batch) entry.state = 'failed';
		} finally {
			this.requests--;
		}
	}

	private async build(entry: ModelEntry, data: ModelData | null): Promise<void> {
		if (!data || data.batches.length === 0) {
			entry.state = 'failed';
			return;
		}
		entry.textures = [...new Set(data.batches.map((b) => b.material.texture).filter((t) => t))];
		const textures = await this.textures.acquire(entry.textures);

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
		if (data.baked) geometry.setAttribute('baked', new THREE.BufferAttribute(data.baked, 4));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		const batches = [...data.batches].sort((a, b) => a.order - b.order);
		entry.materials = batches.map((b, i) => {
			geometry.addGroup(b.start, b.count, i);
			return createModelMaterial(b.material, textures.get(b.material.texture) ?? null, !!data.baked);
		});
		geometry.computeBoundingSphere();
		if (data.bvh) {
			geometry.boundsTree = MeshBVH.deserialize({ ...data.bvh, index: data.indices } as Parameters<typeof MeshBVH.deserialize>[0], geometry, { setIndex: false });
		}
		// Warm the instanced shader variant, which is what the model will be drawn with.
		await this.prepare(new THREE.InstancedMesh(geometry, entry.materials, 1));
		entry.geometry = geometry;
		entry.radius = data.radius;
		entry.liquids = (data.liquids ?? []).map((l) => ({ geometry: liquidGeometry(l.positions, l.indices), material: liquidMaterials[l.kind], mesh: null }));
		entry.data = { ...data, positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), baked: null, indices: new Uint32Array(0), liquids: [] };
		entry.state = 'ready';
		entry.dirty = true;
		for (const fn of entry.onReady.splice(0)) fn(entry);
	}

	private isVisible(entry: ModelEntry, m: THREE.Matrix4): boolean {
		// Buildings are already limited by tile distance.
		if (entry.kind === 'wmo') return true;
		const e = m.elements;
		const scale = Math.hypot(e[0], e[1], e[2]);
		const dx = e[12] - this.camera.x, dy = e[13] - this.camera.y, dz = e[14] - this.camera.z;
		return dx * dx + dy * dy + dz * dz < viewDistance(entry.radius * scale) ** 2;
	}

	private visibilityChanged(entry: ModelEntry): boolean {
		let count = 0;
		for (const [key, m] of entry.instances) {
			if (this.isVisible(entry, m) !== entry.visible.has(key)) return true;
			count++;
		}
		return count === 0 && entry.visible.size > 0;
	}

	/** Rewrites a model's instance buffer with its placed copies that are within view distance. */
	private flush(entry: ModelEntry): void {
		entry.dirty = false;
		if (!entry.geometry) return;
		entry.visible = new Set();
		for (const [key, m] of entry.instances) if (this.isVisible(entry, m)) entry.visible.add(key);
		entry.drawnKeys = [...entry.visible];
		const matrices = entry.drawnKeys.map((key) => entry.instances.get(key)!);
		entry.mesh = this.syncMesh(entry.mesh, entry.geometry, entry.materials, matrices, entry.kind === 'wmo' ? -1 : 0);
		for (const liquid of entry.liquids) {
			// Liquids draw after the building so it shows through the surface.
			liquid.mesh = this.syncMesh(liquid.mesh, liquid.geometry, liquid.material, matrices, 1);
		}
	}

	/** Creates or grows an InstancedMesh as needed and writes the instance matrices into it. */
	private syncMesh(
		mesh: THREE.InstancedMesh | null,
		geometry: THREE.BufferGeometry,
		material: THREE.Material | THREE.Material[],
		matrices: THREE.Matrix4[],
		renderOrder: number,
	): THREE.InstancedMesh {
		const count = matrices.length;
		if (!mesh || mesh.instanceMatrix.count < count) {
			if (mesh) {
				this.group.remove(mesh);
				mesh.dispose();
			}
			const capacity = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
			mesh = new THREE.InstancedMesh(geometry, material, capacity);
			mesh.matrixAutoUpdate = false;
			mesh.renderOrder = renderOrder;
			this.group.add(mesh);
		}
		matrices.forEach((m, i) => mesh!.setMatrixAt(i, m));
		mesh.count = count;
		mesh.instanceMatrix.needsUpdate = true;
		mesh.visible = count > 0;
		if (count > 0) mesh.computeBoundingSphere();
		return mesh;
	}
	private dispose(entry: ModelEntry): void {
		if (entry.mesh) {
			this.group.remove(entry.mesh);
			entry.mesh.dispose();
		}
		entry.geometry?.dispose();
		for (const m of entry.materials) m.dispose();
		for (const l of entry.liquids) {
			if (l.mesh) {
				this.group.remove(l.mesh);
				l.mesh.dispose();
			}
			// Liquid materials are shared; only the geometry belongs to this model.
			l.geometry.dispose();
		}
		this.textures.release(entry.textures);
	}

	/** NPCs within range of the camera, with the world position just above their heads. */
	nameplates(camera: THREE.Vector3, range: number, out: { info: SpawnInfo; position: THREE.Vector3; distance: number }[] = []) {
		out.length = 0;
		const head = new THREE.Vector3();
		for (const entry of this.models.values()) {
			if (entry.kind !== 'creature' || entry.state !== 'ready' || !entry.data) continue;
			const top = entry.data.height;
			for (const key of entry.visible) {
				const m = entry.instances.get(key);
				const info = m && this.objects.get(key)?.placement.spawn;
				if (!m || !info) continue;
				const e = m.elements;
				const dx = e[12] - camera.x, dy = e[13] - camera.y, dz = e[14] - camera.z;
				if (dx * dx + dy * dy + dz * dz > range * range) continue;
				// Model space is z-up: the head is at (0, 0, height) plus a little clearance.
				head.set(0, 0, top).applyMatrix4(m);
				head.y += 0.35;
				out.push({ info, position: head.clone(), distance: head.distanceTo(camera) });
			}
		}
		return out;
	}

	private readonly sightRay = new THREE.Raycaster();

	/** Whether a building (any model with a BVH) blocks the straight line between two points. */
	blocksSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
		const direction = to.clone().sub(from);
		const distance = direction.length();
		if (distance < 1e-3) return false;
		this.sightRay.set(from, direction.divideScalar(distance));
		// Stop just short of the target so its own surroundings (a doorway, the floor) don't count.
		this.sightRay.far = distance - 0.5;
		this.sightRay.firstHitOnly = true;
		for (const entry of this.models.values()) {
			if (!entry.mesh?.visible || !entry.geometry?.boundsTree) continue;
			if (this.sightRay.intersectObject(entry.mesh, false).length) return true;
		}
		return false;
	}

	private readonly sweepRay = new THREE.Raycaster();
	private readonly hitNormal = new THREE.Vector3();

	/** Nearest building surface along a ray (within far), with its world-space normal. */
	private castBuildings(from: THREE.Vector3, direction: THREE.Vector3, far: number): { distance: number; normal: THREE.Vector3 } | null {
		this.sweepRay.set(from, direction);
		this.sweepRay.far = far;
		this.sweepRay.firstHitOnly = true;
		let best: { distance: number; normal: THREE.Vector3 } | null = null;
		for (const entry of this.models.values()) {
			if (!entry.mesh?.visible || !entry.geometry?.boundsTree) continue;
			const hit = this.sweepRay.intersectObject(entry.mesh, false)[0];
			if (!hit?.face || (best && hit.distance >= best.distance)) continue;
			// The face normal is in model space; carry it through the instance's placement.
			const instance = new THREE.Matrix4();
			if (hit.instanceId !== undefined) entry.mesh.getMatrixAt(hit.instanceId, instance);
			this.hitNormal.copy(hit.face.normal).transformDirection(instance);
			best = { distance: hit.distance, normal: this.hitNormal.clone() };
		}
		return best;
	}

	/**
	 * Limits a camera move so it can't pass through buildings (caves, mines, walls): slides along
	 * a surface it would cross, keeping `radius` away from it. Returns the allowed move.
	 */
	sweep(from: THREE.Vector3, move: THREE.Vector3, radius: number): THREE.Vector3 {
		let allowed = move.clone();
		for (let pass = 0; pass < 3; pass++) {
			const length = allowed.length();
			if (length < 1e-5) break;
			const direction = allowed.clone().divideScalar(length);
			const hit = this.castBuildings(from, direction, length + radius);
			if (!hit) break;
			// Facing away from the move (we're behind it): not a wall for this move.
			const into = allowed.dot(hit.normal);
			if (into >= 0) break;
			if (pass < 2) {
				// Slide: drop the part of the move that goes into the surface, then check again.
				allowed.addScaledVector(hit.normal, -into);
			} else {
				// Still blocked (a corner): stop short of the surface.
				allowed = direction.multiplyScalar(Math.min(Math.max(0, hit.distance - radius), length));
			}
		}
		return allowed;
	}

	/** Whether any building's bounds come within `margin` of a point: collision is only needed then. */
	nearBuilding(at: THREE.Vector3, margin: number): boolean {
		for (const entry of this.models.values()) {
			const sphere = entry.geometry?.boundingSphere;
			if (!entry.mesh?.visible || !entry.geometry?.boundsTree || !sphere) continue;
			for (const key of entry.visible) {
				const m = entry.instances.get(key)!;
				const e = m.elements;
				const scale = Math.hypot(e[0], e[1], e[2]);
				const cx = e[0] * sphere.center.x + e[4] * sphere.center.y + e[8] * sphere.center.z + e[12];
				const cy = e[1] * sphere.center.x + e[5] * sphere.center.y + e[9] * sphere.center.z + e[13];
				const cz = e[2] * sphere.center.x + e[6] * sphere.center.y + e[10] * sphere.center.z + e[14];
				const reach = sphere.radius * scale + margin;
				if ((cx - at.x) ** 2 + (cy - at.y) ** 2 + (cz - at.z) ** 2 < reach * reach) return true;
			}
		}
		return false;
	}

	private static readonly AXES = [
		new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
		new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
	];

	/**
	 * How far to move a point so no building surface is within `radius` of it along the six axes
	 * (floors, ceilings, walls). Keeps the camera's view from clipping into a surface it slid along.
	 */
	pushOut(at: THREE.Vector3, radius: number): THREE.Vector3 {
		const offset = new THREE.Vector3();
		for (const axis of ObjectManager.AXES) {
			const hit = this.castBuildings(at, axis, radius);
			if (hit && axis.dot(hit.normal) < 0) offset.addScaledVector(axis, -(radius - hit.distance));
		}
		return offset;
	}

	/** The creature or game object spawn nearest along a ray, if any. */
	pick(raycaster: THREE.Raycaster): { info: SpawnInfo; distance: number } | null {
		let best: { info: SpawnInfo; distance: number } | null = null;
		for (const entry of this.models.values()) {
			if (!entry.mesh?.visible || (entry.kind !== 'creature' && entry.kind !== 'object')) continue;
			for (const hit of raycaster.intersectObject(entry.mesh, false)) {
				if (hit.instanceId === undefined) continue;
				const info = this.objects.get(entry.drawnKeys[hit.instanceId])?.placement.spawn;
				if (info && (!best || hit.distance < best.distance)) best = { info, distance: hit.distance };
				break; // hits are sorted; the first is this model's nearest
			}
		}
		return best;
	}

	stats(): ObjectStats {
		let instances = 0;
		let drawn = 0;
		let models = 0;
		for (const e of this.models.values()) {
			if (e.state === 'ready') models++;
			instances += e.instances.size;
			drawn += e.visible.size;
		}
		return { models, instances, drawn, loading: this.queue.length + this.requests * MODEL_BATCH };
	}
}

function liquidGeometry(positions: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	// Model space is z-up.
	const normals = new Float32Array(positions.length);
	for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	geometry.computeBoundingSphere();
	return geometry;
}
