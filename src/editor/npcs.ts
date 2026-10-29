import * as THREE from 'three';
import type { CreatureDisplaySummary } from '../explorer/npcs';
import type { ModelKind } from '../explorer/objects';
import type { SceneModel } from '../scene/sceneModel';
import type { NpcAppearance, NpcPreset, PlacedNpc } from '../scene/types';
import type { ObjectManager } from '../viewer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import { objectMatrix } from './placement';

/** What the NPCs tool drops on a click: an appearance picked from the NPCs tab (spec 7.9.1). */
export interface NpcAsset {
	appearance: NpcAppearance;
	label: string;
}

/** An NPC's collision capsule (spec 7.9.1), upright at its feet. */
export interface NpcCapsule {
	id: string;
	x: number;
	z: number;
	bottom: number;
	top: number;
	radius: number;
}

/** The capsule's radius is this share of the model's half-width, within these limits (yards). */
const CAPSULE_WIDTH_SHARE = 0.55;
const CAPSULE_MIN_RADIUS = 0.3;
const CAPSULE_MAX_RADIUS = 4;
/** A model still loading stands as a capsule this big. */
const PLACEHOLDER_RADIUS = 0.5;
const PLACEHOLDER_HEIGHT = 2;

/** The creature display list, asked for once per session and shared by the NPC layer and the NPCs tab. */
let creatureList: Promise<CreatureDisplaySummary[]> | null = null;

export function creatureDisplays(storage: AsyncStorageApi): Promise<CreatureDisplaySummary[]> {
	creatureList ??= storage.listCreatureDisplays().catch((e) => {
		creatureList = null;
		throw e;
	});
	return creatureList;
}

/**
 * The editor's placed NPCs (spec 7.9): mirrors scene.npcs into the instanced object manager
 * (a creature display or a preset handle per model), sizes creatures by their display's scale,
 * and offers their capsules to the walker. Selection and editing go through SceneObjects,
 * which treats NPCs and objects alike.
 */
export class SceneNpcs {
	/** The worker handle each preset is defined under, and the fields it was defined with. */
	private readonly handles = new Map<string, { handle: number; json: string }>();
	private nextHandle = 1;
	/** CreatureModelScale per display, from the creature list. */
	private readonly displayScales = new Map<number, number>();
	/** Ids placed in the manager, with the model they were placed as. */
	private readonly spawned = new Map<string, string>();
	/** Whether the terrain under a point is shown (large scenes stream their tiles). */
	visibleAt: (x: number, z: number) => boolean = () => true;
	private readonly box = new THREE.Box3();

	constructor(
		private readonly manager: ObjectManager,
		private readonly model: SceneModel,
		private readonly storage: AsyncStorageApi,
	) {}

	/** Spawns every saved NPC once the creature scales are known (so murlocs come out murloc-sized). */
	async load(): Promise<void> {
		try {
			for (const d of await creatureDisplays(this.storage)) this.displayScales.set(d.id, d.scale);
		} catch {
			// Without the list every creature stands at scale 1.
		}
		for (const n of this.model.npcs) this.spawn(n);
	}

	/** The model an appearance draws with, or null when its preset isn't in the scene. */
	modelOf(appearance: NpcAppearance): { kind: 'creature' | 'npcPreset'; fdid: number } | null {
		if (appearance.kind === 'creature') return { kind: 'creature', fdid: appearance.displayId };
		const preset = this.model.preset(appearance.presetId);
		return preset ? { kind: 'npcPreset', fdid: this.handle(preset) } : null;
	}

	/**
	 * The manager entry an NPC draws from: its model looping its chosen idle sequence (spec 7.9.1),
	 * or null when its preset isn't in the scene. NPCs of one look and idle share one entry.
	 */
	private entryOf(n: PlacedNpc): { kind: ModelKind; fdid: number; idle: number } | null {
		const m = this.modelOf(n.appearance);
		return m ? { ...m, idle: n.idle ?? 0 } : null;
	}

	/**
	 * The worker handle for a preset, defining it there first (the worker handles messages in
	 * order, so the definition lands before any model load). A preset edited since gets a new
	 * handle, so the manager loads the new look rather than reusing the old model.
	 */
	handle(preset: NpcPreset): number {
		const json = JSON.stringify([preset.race, preset.sex, preset.customization, preset.equipment]);
		const have = this.handles.get(preset.id);
		if (have && have.json === json) return have.handle;
		const handle = this.nextHandle++;
		this.handles.set(preset.id, { handle, json });
		void this.storage.defineNpcPreset(handle, structuredClone(preset)).catch(() => {});
		return handle;
	}

	/** A display's own scale (CreatureModelScale), 1 for custom NPCs. */
	displayScale(appearance: NpcAppearance): number {
		return appearance.kind === 'creature' ? this.displayScales.get(appearance.displayId) ?? 1 : 1;
	}

	/** Model -> scene-space matrix: upright, turned to its facing, at its scale times the display's. */
	matrix(n: PlacedNpc): THREE.Matrix4 {
		return objectMatrix({ position: n.position, rotation: [0, n.facing, 0], scale: n.scale * this.displayScale(n.appearance) });
	}

	private placedKey(n: PlacedNpc): string | null {
		const m = this.entryOf(n);
		return m ? `${m.kind}:${m.fdid}@${m.idle}` : null;
	}

	spawn(n: PlacedNpc): void {
		if (!this.visibleAt(n.position[0], n.position[2])) return;
		const m = this.entryOf(n);
		if (!m) return;
		this.manager.placeLoose(n.id, m.kind, m.fdid, this.matrix(n), 0, m.idle);
		this.spawned.set(n.id, this.placedKey(n)!);
	}

	despawn(id: string): void {
		if (!this.spawned.has(id)) return;
		this.manager.removeLoose(id);
		this.spawned.delete(id);
	}

	/** Moves an NPC's instance; a changed appearance or idle sequence re-places it as the new model. */
	move(n: PlacedNpc): void {
		const visible = this.visibleAt(n.position[0], n.position[2]);
		const key = this.placedKey(n);
		if (!visible || !key) {
			this.despawn(n.id);
			return;
		}
		if (this.spawned.get(n.id) !== key) {
			this.despawn(n.id);
			this.spawn(n);
			return;
		}
		const m = this.entryOf(n)!;
		this.manager.placeLoose(n.id, m.kind, m.fdid, this.matrix(n), 0, m.idle);
	}

	/** Spawns NPCs whose terrain streamed in and removes those whose terrain streamed out. */
	syncVisibility(): void {
		for (const n of this.model.npcs) {
			const visible = this.visibleAt(n.position[0], n.position[2]);
			if (visible && !this.spawned.has(n.id)) this.spawn(n);
			else if (!visible && this.spawned.has(n.id)) this.despawn(n.id);
		}
	}

	isSpawned(id: string): boolean {
		return this.spawned.has(id);
	}

	/** The NPC's model bounds in its own space, once loaded; null until then. */
	modelBox(n: PlacedNpc): THREE.Box3 | null {
		const m = this.entryOf(n);
		return m ? this.manager.modelInfo(m.kind, m.fdid, m.idle)?.box ?? null : null;
	}

	/** Whether the NPC's model failed to load (its display or race isn't in the client), so a placeholder stands in. */
	isMissing(n: PlacedNpc): boolean {
		const m = this.entryOf(n);
		return !m || this.manager.modelFailed(m.kind, m.fdid, m.idle);
	}

	/**
	 * The missing-reference summary for NPCs (spec 7.11), once every placed NPC's model has
	 * loaded or failed: how many stand as placeholders, and gear left off custom ones. Null while
	 * any is still loading.
	 */
	loadReport(): { missing: number; gear: string[] } | null {
		let missing = 0;
		const gear = new Set<string>();
		for (const n of this.model.npcs) {
			if (!this.spawned.has(n.id)) continue;
			const m = this.entryOf(n);
			if (!m) {
				missing++;
				continue;
			}
			const state = this.manager.modelState(m.kind, m.fdid, m.idle);
			if (state === 'queued' || state === 'loading') return null;
			if (state === 'failed' || state === undefined) missing++;
			for (const g of this.manager.missingGear(m.kind, m.fdid, m.idle)) gear.add(g);
		}
		return { missing, gear: [...gear] };
	}

	/** The NPC's capsule (spec 7.9.1), sized from its model's bounds (model space: x forward, y left, z up). */
	capsule(n: PlacedNpc): NpcCapsule {
		const scale = n.scale * this.displayScale(n.appearance);
		const box = this.modelBox(n);
		let radius = PLACEHOLDER_RADIUS;
		let height = PLACEHOLDER_HEIGHT;
		if (box) {
			this.box.copy(box);
			radius = (Math.max(this.box.max.x - this.box.min.x, this.box.max.y - this.box.min.y) / 2) * CAPSULE_WIDTH_SHARE;
			height = Math.max(0.5, this.box.max.z);
		}
		radius = THREE.MathUtils.clamp(radius * scale, CAPSULE_MIN_RADIUS * Math.min(1, scale), CAPSULE_MAX_RADIUS);
		return { id: n.id, x: n.position[0], z: n.position[2], bottom: n.position[1], top: n.position[1] + height * scale, radius };
	}

	private capsules(): NpcCapsule[] {
		const out: NpcCapsule[] = [];
		for (const n of this.model.npcs) if (this.spawned.has(n.id)) out.push(this.capsule(n));
		return out;
	}

	/** Whether any NPC's capsule comes within margin of a point, so the walker knows to sweep. */
	near(at: THREE.Vector3, margin: number): boolean {
		for (const c of this.capsules()) {
			if (at.y < c.bottom - margin || at.y > c.top + margin) continue;
			const reach = c.radius + margin;
			if ((c.x - at.x) ** 2 + (c.z - at.z) ** 2 < reach * reach) return true;
		}
		return false;
	}

	/**
	 * Cuts a horizontal move short where it would end inside an NPC's capsule (at the probe's
	 * height), sliding round it: the destination is pushed out radially, as a building wall would.
	 */
	sweep(from: THREE.Vector3, move: THREE.Vector3, radius: number): THREE.Vector3 {
		const allowed = move.clone();
		const dest = new THREE.Vector2(from.x + move.x, from.z + move.z);
		for (const c of this.capsules()) {
			if (from.y < c.bottom || from.y > c.top) continue;
			const reach = c.radius + radius;
			const dx = dest.x - c.x;
			const dz = dest.y - c.z;
			const d2 = dx * dx + dz * dz;
			if (d2 >= reach * reach) continue;
			// Already inside at the start (it walked up to us): only moves away are allowed.
			const d = Math.sqrt(d2);
			const nx = d > 1e-6 ? dx / d : 1;
			const nz = d > 1e-6 ? dz / d : 0;
			dest.set(c.x + nx * reach, c.z + nz * reach);
		}
		allowed.x = dest.x - from.x;
		allowed.z = dest.y - from.z;
		return allowed;
	}

	/** How far to move a point so no NPC capsule is within radius of it horizontally. */
	pushOut(at: THREE.Vector3, radius: number): THREE.Vector3 {
		const offset = new THREE.Vector3();
		for (const c of this.capsules()) {
			if (at.y < c.bottom || at.y > c.top) continue;
			const reach = c.radius + radius;
			const dx = at.x + offset.x - c.x;
			const dz = at.z + offset.z - c.z;
			const d = Math.hypot(dx, dz);
			if (d >= reach) continue;
			const nx = d > 1e-6 ? dx / d : 1;
			const nz = d > 1e-6 ? dz / d : 0;
			offset.x += nx * (reach - d);
			offset.z += nz * (reach - d);
		}
		return offset;
	}
}
