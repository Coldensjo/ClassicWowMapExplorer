import type { CopyTile } from '../explorer/copyWorld';
import { CHUNK_HEIGHTS, CHUNKS_PER_TILE, TILE_SIZE } from '../formats/adt';
import type { LiquidInstance } from '../formats/mh2o';
import { SceneModel, type BaseObjectTemplate, type SceneBaseData, type SceneBaseTile, type SceneChunk, type SceneMeta, type SceneWater } from './sceneModel';
import { MAX_COPIED_TILES, type PlacedObject, type Scene, type Vec3, type WorldBase } from './types';

/**
 * Copied scenes (spec 6.5): building a world base from source tiles, both when the scene is first
 * copied (spec 7.2) and every time it is opened; the working chunks are clones of the base with
 * the saved overrides applied on top (wscene.ts does that part).
 */

/**
 * Chunks painting a texture the source didn't name (a missing _tex0, or a bad MDID entry) fall
 * back to a plain dirt tileset, so every chunk keeps a valid layer.
 */
export const FALLBACK_TEXTURE = 187138;

const CHUNK_COUNT = CHUNKS_PER_TILE * CHUNKS_PER_TILE;

/**
 * A chunk's source water as the flat editable form (spec 6.5 water): the footprint comes from the
 * instances' existence masks, the surface from the first instance. Editing starts from this; a
 * chunk whose working water still equals it renders the source liquid as the client does.
 */
export function derivedWater(liquids: LiquidInstance[], chunkId: number): SceneWater | null {
	const coverage = new Uint8Array(8);
	let first: LiquidInstance | null = null;
	for (const l of liquids) {
		if (l.chunk !== chunkId || !l.width || !l.height) continue;
		first ??= l;
		for (let row = 0; row < l.height; row++) {
			for (let col = 0; col < l.width; col++) {
				if (l.exists && !l.exists[row * l.width + col]) continue;
				const r = l.y + row;
				const c = l.x + col;
				if (r < 8 && c < 8) coverage[r] |= 1 << c;
			}
		}
	}
	if (!first || coverage.every((b) => b === 0)) return null;
	return { kind: first.type, height: first.maxHeight, coverage };
}

/** A void chunk, for tiles the map doesn't have inside the rectangle (spec 7.2). */
function voidChunk(fallbackTexture: number): SceneChunk {
	return {
		heights: new Float32Array(CHUNK_HEIGHTS),
		vertexShade: null,
		layers: [{ texture: fallbackTexture }],
		alpha: null,
		holes: new Uint8Array(8).fill(0xff),
		water: null,
	};
}

/**
 * One source tile as pristine base chunks. textureIndex maps a diffuse FDID into the scene's
 * palette, growing it (spec 7.2: copied layers and later paint share one palette); the mapping is
 * deterministic, so rebuilding the base on every open reproduces the indices overrides were saved
 * against.
 */
export function baseTileFromCopy(copy: CopyTile, textureIndex: (fdid: number) => number): SceneBaseTile {
	if (!copy.exists || !copy.chunks) {
		const fallback = textureIndex(FALLBACK_TEXTURE);
		return { chunks: Array.from({ length: CHUNK_COUNT }, () => voidChunk(fallback)), liquids: [] };
	}
	const chunks = copy.chunks.map((c, i): SceneChunk => {
		const layers = c.layers.length
			? c.layers.map((l) => ({ texture: textureIndex(l.fdid || FALLBACK_TEXTURE), ...(l.effect ? { effectId: l.effect } : {}) }))
			: [{ texture: textureIndex(FALLBACK_TEXTURE) }];
		return {
			heights: c.heights,
			vertexShade: c.shade,
			layers,
			// A tile without layer data has no alpha either; the counts stay consistent.
			alpha: layers.length > 1 ? c.alpha : null,
			holes: c.holes,
			water: derivedWater(copy.liquids, i),
		};
	});
	return { chunks, liquids: copy.liquids };
}

/** A deep copy of a base chunk, for the editable working tiles. */
export function cloneChunk(c: SceneChunk): SceneChunk {
	return {
		heights: c.heights.slice(),
		vertexShade: c.vertexShade ? c.vertexShade.slice() : null,
		layers: c.layers.map((l) => ({ ...l })),
		alpha: c.alpha ? c.alpha.slice() : null,
		holes: c.holes.slice(),
		water: c.water ? { kind: c.water.kind, height: c.water.height, coverage: c.water.coverage.slice() } : null,
	};
}

/**
 * The copied objects (spec 6.5): every MDDF/MODF entry whose origin lies inside the selected
 * rectangle, de-duplicated by unique ID (the client lists an object in every tile it overlaps),
 * in scene space, keyed m2:<uid> / wmo:<uid>.
 */
export function baseObjectsFromCopy(copyTiles: CopyTile[], base: WorldBase): BaseObjectTemplate[] {
	const x0 = base.tileMin[0] * TILE_SIZE;
	const x1 = (base.tileMax[0] + 1) * TILE_SIZE;
	const z0 = base.tileMin[1] * TILE_SIZE;
	const z1 = (base.tileMax[1] + 1) * TILE_SIZE;
	const seen = new Set<string>();
	const out: BaseObjectTemplate[] = [];
	for (const tile of copyTiles) {
		for (const p of tile.placements) {
			if (p.kind === 'm2' && !base.includeDoodads) continue;
			if (p.kind === 'wmo' && !base.includeWmos) continue;
			const [px, py, pz] = p.position;
			if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
			const baseKey = `${p.kind}:${p.uid}`;
			if (seen.has(baseKey)) continue;
			seen.add(baseKey);
			out.push({
				baseKey,
				kind: p.kind,
				fdid: p.fdid,
				position: [px - x0, py, pz - z0],
				rotation: [p.rotation[0], p.rotation[1], p.rotation[2]],
				// WMO scale is fixed at 1 in the scene format (spec 6.1).
				scale: p.kind === 'wmo' ? 1 : p.scale,
				...(p.kind === 'wmo' ? { doodadSet: p.doodadSet, nameSet: p.nameSet } : {}),
			});
		}
	}
	return out;
}

/** A base object as a placed object the editor works on; unedited ones are never saved. */
export function materialize(t: BaseObjectTemplate): PlacedObject {
	return {
		id: crypto.randomUUID(),
		baseKey: t.baseKey,
		kind: t.kind,
		fdid: t.fdid,
		position: [...t.position] as Vec3,
		rotation: [...t.rotation] as Vec3,
		scale: t.scale,
		...(t.kind === 'wmo' ? { doodadSet: t.doodadSet ?? 0, nameSet: t.nameSet ?? 0 } : {}),
	};
}

/**
 * The scene's object list from the base plus the saved edits (spec 6.5): stored entries replace
 * their base objects, removed baseKeys are left out, and a baseKey the source no longer lists is
 * dropped and counted for the missing-reference summary.
 */
export function composeObjects(
	stored: PlacedObject[],
	templates: BaseObjectTemplate[],
	removedObjects: string[],
): { objects: PlacedObject[]; missing: number } {
	const byKey = new Map(templates.map((t) => [t.baseKey, t]));
	const objects: PlacedObject[] = [];
	let missing = 0;
	for (const o of stored) {
		if (o.baseKey && !byKey.has(o.baseKey)) {
			missing++;
			continue;
		}
		objects.push(o);
	}
	const removed = new Set(removedObjects);
	const present = new Set(objects.map((o) => o.baseKey).filter((k): k is string => !!k));
	for (const t of templates) {
		if (removed.has(t.baseKey) || present.has(t.baseKey)) continue;
		objects.push(materialize(t));
	}
	return { objects, missing };
}

/** Whether a placed object still matches its base exactly, so the save-time sweep can drop it. */
export function matchesTemplate(o: PlacedObject, t: BaseObjectTemplate): boolean {
	return (
		o.kind === t.kind &&
		o.fdid === t.fdid &&
		o.position.every((v, i) => v === t.position[i]) &&
		o.rotation.every((v, i) => v === t.rotation[i]) &&
		o.scale === t.scale &&
		(o.doodadSet ?? 0) === (t.doodadSet ?? 0) &&
		(o.nameSet ?? 0) === (t.nameSet ?? 0) &&
		!o.locked &&
		!o.group
	);
}

export interface CopyRequest {
	name: string;
	client: Scene['client'];
	map: { id: number; directory: string };
	tileMin: [number, number];
	tileMax: [number, number];
	includeDoodads: boolean;
	includeWmos: boolean;
	/** Light.db2 ID of the zone at the selection's centre, or 0 for the default preset (spec 7.2). */
	lightPreset?: number;
}

/**
 * The selection's centre in WoW world coordinates (x north, y west), for looking up the zone
 * light there (spec 7.2). Placement space puts the map's corner at 0 and its centre at 32 tiles.
 */
export function selectionCentre(tileMin: [number, number], tileMax: [number, number]): { wowX: number; wowY: number } {
	const origin = 32 * TILE_SIZE;
	const px = ((tileMin[0] + tileMax[0] + 1) / 2) * TILE_SIZE;
	const pz = ((tileMin[1] + tileMax[1] + 1) / 2) * TILE_SIZE;
	return { wowX: origin - pz, wowY: origin - px };
}

/**
 * A new scene copied from the world (spec 3.2, 7.2): the loaded source tiles become the base, the
 * working tiles start as clones of it, and the spawn sits at the selection's centre on the ground.
 * copyTiles covers the rectangle row-major (y, then x).
 */
export function createCopiedScene(request: CopyRequest, copyTiles: CopyTile[]): SceneModel {
	const tilesX = request.tileMax[0] - request.tileMin[0] + 1;
	const tilesY = request.tileMax[1] - request.tileMin[1] + 1;
	if (tilesX < 1 || tilesY < 1 || tilesX > MAX_COPIED_TILES || tilesY > MAX_COPIED_TILES) {
		throw new Error(`A copied scene is 1x1 to ${MAX_COPIED_TILES}x${MAX_COPIED_TILES} tiles, not ${tilesX}x${tilesY}`);
	}
	if (copyTiles.length !== tilesX * tilesY) throw new Error(`The copy covers ${tilesX * tilesY} tiles but ${copyTiles.length} were loaded`);

	const base: WorldBase = {
		mapId: request.map.id,
		mapDirectory: request.map.directory,
		tileMin: [request.tileMin[0], request.tileMin[1]],
		tileMax: [request.tileMax[0], request.tileMax[1]],
		build: request.client.build,
		includeDoodads: request.includeDoodads,
		includeWmos: request.includeWmos,
		removedObjects: [],
	};
	const textures: number[] = [];
	const textureIndex = (fdid: number): number => {
		const index = textures.indexOf(fdid);
		if (index >= 0) return index;
		textures.push(fdid);
		return textures.length - 1;
	};
	const baseTiles = copyTiles.map((copy) => baseTileFromCopy(copy, textureIndex));
	const baseData: SceneBaseData = { tiles: baseTiles, objects: baseObjectsFromCopy(copyTiles, base) };
	const tiles = baseTiles.map((baseTile, index) => ({
		x: index % tilesX,
		y: Math.floor(index / tilesX),
		chunks: baseTile.chunks.map(cloneChunk),
	}));
	const { objects } = composeObjects([], baseData.objects, []);

	const now = new Date().toISOString();
	const meta: SceneMeta = {
		id: crypto.randomUUID(),
		name: request.name,
		created: now,
		modified: now,
		client: request.client,
		size: { tilesX, tilesY },
		base,
		spawn: { position: [(tilesX * TILE_SIZE) / 2, 0, (tilesY * TILE_SIZE) / 2], yaw: 0 },
		environment: { lightPreset: request.lightPreset ?? 0, timeOfDay: 1440 },
		player: null,
	};
	const model = new SceneModel(meta, textures, tiles, objects, [], [], baseData);
	// The spawn sits on the ground at the selection's centre (spec 7.2), where there is any.
	meta.spawn.position[1] = model.surfaceAt(meta.spawn.position[0], meta.spawn.position[2]) ?? 0;
	return model;
}
