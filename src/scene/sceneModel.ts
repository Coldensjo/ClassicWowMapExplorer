import { CHUNK_HEIGHTS, CHUNK_SIZE, CHUNKS_PER_TILE, TILE_SIZE, type AdtChunk, type AdtRoot } from '../formats/adt';
import { ALPHA_SIZE, type AdtTex } from '../formats/adtTex';
import type { LiquidInstance } from '../formats/mh2o';
import type { ChunkLayer, NpcAppearance, NpcPreset, PlacedNpc, PlacedObject, Scene, Vec3, WorldBase } from './types';
import { MAX_BLANK_TILES } from './types';

/** A chunk's water as the editor holds it (spec 7.6): flat surface plus per-cell coverage. */
export interface SceneWater {
	/** LiquidType.db2 ID (water, ocean, magma, slime). */
	kind: number;
	/** Flat surface height. */
	height: number;
	/** One byte per cell row (8 rows of 8 cells); bit n set = cell n has water. */
	coverage: Uint8Array;
}

/** A chunk as the editor holds it: the file's arrays decoded, one object per chunk. */
export interface SceneChunk {
	/** 145 absolute heights in ADT MCVT order (rows of 9 and 8 interleaved). */
	heights: Float32Array;
	/** 145 x RGBA vertex shading, 0x7f neutral (like MCCV), or null for none. */
	vertexShade: Uint8Array | null;
	/** 1..4 layers; layer 0 is the base and has no alpha. */
	layers: ChunkLayer[];
	/** 64x64 alpha per layer after the first, layer-major, or null when one layer. */
	alpha: Uint8Array | null;
	/** One byte per cell row (8 rows of 8 cells); bit n set = cell n is a hole. */
	holes: Uint8Array;
	water: SceneWater | null;
}

export interface SceneTile {
	x: number;
	y: number;
	/** 256 chunks, row-major (y * 16 + x). */
	chunks: SceneChunk[];
}

/** Whether two water settings are the same surface, cell for cell. */
export function sameWater(a: SceneWater | null, b: SceneWater | null): boolean {
	if (!a || !b) return a === b;
	return a.kind === b.kind && a.height === b.height && a.coverage.every((v, i) => v === b.coverage[i]);
}

// ---- Copied scenes (spec 6.5): the world base the working tiles diff against ----

/** One source tile's pristine state, kept beside the (edited) working chunks. */
export interface SceneBaseTile {
	/** The base chunks in editor form (water as its derived flat form), never edited. */
	chunks: SceneChunk[];
	/** The source MH2O liquids, for rendering unedited water as the client does (spec 6.5). */
	liquids: LiquidInstance[];
}

/** A copied object's source placement, already in scene space; keyed by its stable baseKey. */
export interface BaseObjectTemplate {
	baseKey: string;
	kind: 'm2' | 'wmo';
	fdid: number;
	position: Vec3;
	rotation: Vec3;
	scale: number;
	doodadSet?: number;
	nameSet?: number;
}

export interface SceneBaseData {
	/** tilesX * tilesY, row-major, like the working tiles. */
	tiles: SceneBaseTile[];
	objects: BaseObjectTemplate[];
}

export interface SceneMeta {
	id: string;
	name: string;
	created: string;
	modified: string;
	client: Scene['client'];
	size: Scene['size'];
	base: WorldBase | null;
	spawn: Scene['spawn'];
	environment: Scene['environment'];
	player: NpcAppearance | null;
}

const OUTER = 9;
const INNER = 8;
/** Height index of an outer vertex (rows of 9 and 8 interleaved). */
const outerIndex = (row: number, col: number) => row * 17 + col;
/** Height index of an inner (cell-centre) vertex. */
const innerIndex = (row: number, col: number) => row * 17 + OUTER + col;

/**
 * The single source of truth for a scene (spec 4): raw arrays shaped like ADT data, which tools
 * change only through commands, and which the renderer rebuilds dirty tiles from. Game assets are
 * referenced by FDID and never stored here.
 */
export class SceneModel {
	/** Tile indices (y * tilesX + x) whose GPU resources need rebuilding whole (layers, holes, water). */
	readonly dirtyTiles = new Set<number>();
	/** Chunks (by tile index) whose heights changed; the renderer updates these in place. */
	readonly dirtyHeights = new Map<number, Set<number>>();
	/** Chunks (by tile index) whose alpha maps changed without the layer set changing. */
	readonly dirtyAlpha = new Map<number, Set<number>>();
	/** Tiles whose water changed; only their water meshes rebuild. */
	readonly dirtyWater = new Set<number>();

	constructor(
		readonly meta: SceneMeta,
		/** FDID palette; chunk layers index into this. */
		readonly textures: number[],
		/** tilesX * tilesY, row-major. */
		readonly tiles: SceneTile[],
		readonly objects: PlacedObject[],
		readonly npcPresets: NpcPreset[],
		readonly npcs: PlacedNpc[],
		/** Copied scenes only (spec 6.5): the pristine world base the working tiles diff against. */
		readonly baseData: SceneBaseData | null = null,
	) {}

	/** The pristine base chunk behind a working chunk, or null in a blank scene. */
	baseChunk(tileIndex: number, chunkId: number): SceneChunk | null {
		return this.baseData?.tiles[tileIndex]?.chunks[chunkId] ?? null;
	}

	/**
	 * Chunks that may differ from the base, by tile index ('all' for whole tiles): written by every
	 * edit and undo, and at load for stored overrides, so the save-time sweep (spec 6.5) only
	 * compares chunks that could have changed. Blank scenes don't keep it.
	 */
	readonly touchedChunks = new Map<number, Set<number> | 'all'>();

	private touchChunk(tileIndex: number, chunkId: number): void {
		if (!this.baseData) return;
		const have = this.touchedChunks.get(tileIndex);
		if (have === 'all') return;
		if (have) have.add(chunkId);
		else this.touchedChunks.set(tileIndex, new Set([chunkId]));
	}

	private touchTile(tileIndex: number): void {
		if (this.baseData) this.touchedChunks.set(tileIndex, 'all');
	}

	/** A new flat scene (spec 3.2): 1x1 to 3x3 tiles at height 0, painted with one base texture. */
	static blank(options: { name: string; tilesX: number; tilesY: number; baseTexture: number; client: Scene['client'] }): SceneModel {
		const { name, tilesX, tilesY, baseTexture, client } = options;
		if (!Number.isInteger(tilesX) || !Number.isInteger(tilesY) || tilesX < 1 || tilesY < 1 || tilesX > MAX_BLANK_TILES || tilesY > MAX_BLANK_TILES) {
			throw new Error(`A blank scene is 1x1 to ${MAX_BLANK_TILES}x${MAX_BLANK_TILES} tiles, not ${tilesX}x${tilesY}`);
		}
		const tiles: SceneTile[] = [];
		for (let y = 0; y < tilesY; y++) {
			for (let x = 0; x < tilesX; x++) {
				const chunks: SceneChunk[] = [];
				for (let i = 0; i < CHUNKS_PER_TILE * CHUNKS_PER_TILE; i++) {
					chunks.push({
						heights: new Float32Array(CHUNK_HEIGHTS),
						vertexShade: null,
						layers: [{ texture: 0 }],
						alpha: null,
						holes: new Uint8Array(8),
						water: null,
					});
				}
				tiles.push({ x, y, chunks });
			}
		}
		const now = new Date().toISOString();
		const meta: SceneMeta = {
			id: crypto.randomUUID(),
			name,
			created: now,
			modified: now,
			client,
			size: { tilesX, tilesY },
			base: null,
			spawn: { position: [(tilesX * TILE_SIZE) / 2, 0, (tilesY * TILE_SIZE) / 2], yaw: 0 },
			environment: { lightPreset: 0, timeOfDay: 1440 },
			player: null,
		};
		return new SceneModel(meta, [baseTexture], tiles, [], [], []);
	}

	get tilesX(): number {
		return this.meta.size.tilesX;
	}

	get tilesY(): number {
		return this.meta.size.tilesY;
	}

	/** The tile holding scene-space (x, z), or null outside the scene. */
	tileAt(x: number, z: number): SceneTile | null {
		const tx = Math.floor(x / TILE_SIZE);
		const ty = Math.floor(z / TILE_SIZE);
		if (tx < 0 || ty < 0 || tx >= this.tilesX || ty >= this.tilesY) return null;
		return this.tiles[ty * this.tilesX + tx];
	}

	markDirty(tile: SceneTile): void {
		const index = tile.y * this.tilesX + tile.x;
		this.dirtyTiles.add(index);
		this.touchTile(index);
		this.meta.modified = new Date().toISOString();
	}

	private markChannel(map: Map<number, Set<number>>, tileIndex: number, chunkId: number): void {
		let set = map.get(tileIndex);
		if (!set) map.set(tileIndex, (set = new Set()));
		set.add(chunkId);
		this.touchChunk(tileIndex, chunkId);
		this.meta.modified = new Date().toISOString();
	}

	markHeightsDirty(tileIndex: number, chunkId: number): void {
		this.markChannel(this.dirtyHeights, tileIndex, chunkId);
	}

	markAlphaDirty(tileIndex: number, chunkId: number): void {
		this.markChannel(this.dirtyAlpha, tileIndex, chunkId);
	}

	markWaterDirty(tileIndex: number): void {
		this.dirtyWater.add(tileIndex);
		this.touchTile(tileIndex);
		this.meta.modified = new Date().toISOString();
	}

	// ---- The height lattice (spec 7.4) ----
	// Chunk edge vertices are shared values: the same spot is stored in up to four chunks (and up
	// to four tiles at corners). All writes go through setOuter/setInner, which update every copy,
	// so edits can never open a seam. Outer vertices sit at (gx * CELL, gz * CELL) with
	// gx in 0..tilesX*128; inner (cell-centre) vertices at ((gx + 0.5) * CELL, ...) with
	// gx in 0..tilesX*128-1. CELL is CHUNK_SIZE / 8.

	/** Outer lattice vertices per side, minus one (the number of cells). */
	get cellsX(): number {
		return this.tilesX * CHUNKS_PER_TILE * INNER;
	}

	get cellsZ(): number {
		return this.tilesY * CHUNKS_PER_TILE * INNER;
	}

	/** The chunks owning lattice column g (cell units): one, or two along a chunk edge. */
	private static owners(g: number, count: number): number[] {
		const cc = Math.floor(g / INNER);
		const list: number[] = [];
		if (g % INNER === 0 && cc > 0) list.push(cc - 1);
		if (cc < count) list.push(cc);
		return list;
	}

	/** The tile and chunk at chunk-grid column/row (0..tiles*16-1 each way). */
	private chunkAt(ccx: number, ccy: number): { tileIndex: number; chunkId: number; chunk: SceneChunk } {
		const tileIndex = Math.floor(ccy / CHUNKS_PER_TILE) * this.tilesX + Math.floor(ccx / CHUNKS_PER_TILE);
		const chunkId = (ccy % CHUNKS_PER_TILE) * CHUNKS_PER_TILE + (ccx % CHUNKS_PER_TILE);
		return { tileIndex, chunkId, chunk: this.tiles[tileIndex].chunks[chunkId] };
	}

	/** The outer lattice height at (gx, gz); callers keep indices in range. */
	outerHeight(gx: number, gz: number): number {
		const ccx = Math.min(Math.floor(gx / INNER), this.tilesX * CHUNKS_PER_TILE - 1);
		const ccy = Math.min(Math.floor(gz / INNER), this.tilesY * CHUNKS_PER_TILE - 1);
		return this.chunkAt(ccx, ccy).chunk.heights[outerIndex(gz - ccy * INNER, gx - ccx * INNER)];
	}

	/** The inner (cell-centre) lattice height at (gx, gz); gx in 0..cellsX-1. */
	innerHeight(gx: number, gz: number): number {
		const ccx = Math.floor(gx / INNER);
		const ccy = Math.floor(gz / INNER);
		return this.chunkAt(ccx, ccy).chunk.heights[innerIndex(gz - ccy * INNER, gx - ccx * INNER)];
	}

	/**
	 * Writes an outer lattice height into every chunk that shares the vertex (spec 7.4 seams) and
	 * marks each heights-dirty. touch is called with each chunk before it changes, for snapshots.
	 */
	setOuterHeight(gx: number, gz: number, h: number, touch?: (tileIndex: number, chunkId: number, chunk: SceneChunk) => void): void {
		for (const ccy of SceneModel.owners(gz, this.tilesY * CHUNKS_PER_TILE)) {
			for (const ccx of SceneModel.owners(gx, this.tilesX * CHUNKS_PER_TILE)) {
				const { tileIndex, chunkId, chunk } = this.chunkAt(ccx, ccy);
				touch?.(tileIndex, chunkId, chunk);
				chunk.heights[outerIndex(gz - ccy * INNER, gx - ccx * INNER)] = h;
				this.markHeightsDirty(tileIndex, chunkId);
			}
		}
	}

	/** Writes an inner lattice height; inner vertices belong to exactly one chunk. */
	setInnerHeight(gx: number, gz: number, h: number, touch?: (tileIndex: number, chunkId: number, chunk: SceneChunk) => void): void {
		const ccx = Math.floor(gx / INNER);
		const ccy = Math.floor(gz / INNER);
		const { tileIndex, chunkId, chunk } = this.chunkAt(ccx, ccy);
		touch?.(tileIndex, chunkId, chunk);
		chunk.heights[innerIndex(gz - ccy * INNER, gx - ccx * INNER)] = h;
		this.markHeightsDirty(tileIndex, chunkId);
	}

	/** Puts back a chunk's heights whole (undo/redo) and marks it dirty. */
	restoreHeights(tileIndex: number, chunkId: number, heights: Float32Array): void {
		this.tiles[tileIndex].chunks[chunkId].heights.set(heights);
		this.markHeightsDirty(tileIndex, chunkId);
	}

	/**
	 * The palette index of a texture FDID, adding it when new (spec 7.2: copied layers and later
	 * paint share one palette). The palette only grows, so layer references never go stale.
	 */
	textureIndex(fdid: number): number {
		const index = this.textures.indexOf(fdid);
		if (index >= 0) return index;
		this.textures.push(fdid);
		return this.textures.length - 1;
	}

	// ---- Placed objects (spec 7.8) ----
	// The renderer mirrors scene.objects through the editor's objects controller; the model only
	// keeps the list ordered and the modified date fresh, so autosave notices object edits.

	/** Adds a placed object (place, paste, redo) and touches the modified date. */
	addObject(object: PlacedObject): void {
		this.objects.push(object);
		this.meta.modified = new Date().toISOString();
	}

	/** Removes a placed object by id (delete, undo); returns it for the command's snapshot. */
	removeObject(id: string): PlacedObject | null {
		const index = this.objects.findIndex((o) => o.id === id);
		if (index < 0) return null;
		this.meta.modified = new Date().toISOString();
		return this.objects.splice(index, 1)[0];
	}

	object(id: string): PlacedObject | null {
		return this.objects.find((o) => o.id === id) ?? null;
	}

	/** An object changed in place (moved, rotated, re-set); keeps autosave aware. */
	touchObjects(): void {
		this.meta.modified = new Date().toISOString();
	}

	// ---- NPCs (spec 7.9) ----

	/** Adds a placed NPC (place, paste, redo) and touches the modified date. */
	addNpc(npc: PlacedNpc): void {
		this.npcs.push(npc);
		this.meta.modified = new Date().toISOString();
	}

	/** Removes a placed NPC by id (delete, undo); returns it for the command's snapshot. */
	removeNpc(id: string): PlacedNpc | null {
		const index = this.npcs.findIndex((n) => n.id === id);
		if (index < 0) return null;
		this.meta.modified = new Date().toISOString();
		return this.npcs.splice(index, 1)[0];
	}

	npc(id: string): PlacedNpc | null {
		return this.npcs.find((n) => n.id === id) ?? null;
	}

	/** An NPC changed in place (moved, renamed, re-dressed); keeps autosave aware. */
	touchNpcs(): void {
		this.meta.modified = new Date().toISOString();
	}

	/** The scene's light preset, time of day, weather and fog (spec 6.1), replaced whole. */
	setEnvironment(environment: Scene['environment']): void {
		this.meta.environment = structuredClone(environment);
		this.meta.modified = new Date().toISOString();
	}

	/** Who the user plays as (spec 7.10): a creature display, an embedded preset, or null for the default. */
	setPlayer(appearance: NpcAppearance | null): void {
		this.meta.player = appearance ? structuredClone(appearance) : null;
		this.meta.modified = new Date().toISOString();
	}

	/** A custom preset embedded in the scene (spec 6.6), or null. */
	preset(id: string): NpcPreset | null {
		return this.npcPresets.find((p) => p.id === id) ?? null;
	}

	/**
	 * Embeds a custom preset so the file stays self-contained (spec 6.6), replacing an older copy
	 * of the same preset; NPCs wearing it pick the change up through their appearance.
	 */
	setPreset(preset: NpcPreset): void {
		const copy = structuredClone(preset);
		const index = this.npcPresets.findIndex((p) => p.id === preset.id);
		if (index >= 0) this.npcPresets[index] = copy;
		else this.npcPresets.push(copy);
		this.meta.modified = new Date().toISOString();
	}

	/** Drops embedded presets no NPC (and not the player) wears any more, before saving. */
	pruneUnusedPresets(): void {
		const used = new Set<string>();
		for (const n of this.npcs) if (n.appearance.kind === 'custom') used.add(n.appearance.presetId);
		if (this.meta.player?.kind === 'custom') used.add(this.meta.player.presetId);
		for (let i = this.npcPresets.length - 1; i >= 0; i--) if (!used.has(this.npcPresets[i].id)) this.npcPresets.splice(i, 1);
	}

	/** Puts back a chunk's vertex shading whole (revert, undo); shading is baked into the mesh, so the tile rebuilds. */
	restoreShade(tileIndex: number, chunkId: number, shade: Uint8Array | null): void {
		this.tiles[tileIndex].chunks[chunkId].vertexShade = shade ? shade.slice() : null;
		this.markDirty(this.tiles[tileIndex]);
	}

	/** Puts back a chunk's hole mask whole (undo/redo); holes change the mesh, so the tile rebuilds. */
	restoreHoles(tileIndex: number, chunkId: number, holes: Uint8Array): void {
		this.tiles[tileIndex].chunks[chunkId].holes.set(holes);
		this.markDirty(this.tiles[tileIndex]);
	}

	/** Puts back a chunk's water whole (undo/redo) and marks the tile's water for rebuilding. */
	restoreWater(tileIndex: number, chunkId: number, water: SceneWater | null): void {
		this.tiles[tileIndex].chunks[chunkId].water = water ? { kind: water.kind, height: water.height, coverage: water.coverage.slice() } : null;
		this.markWaterDirty(tileIndex);
	}

	/** Puts back a chunk's layers and alpha whole (undo/redo), marking the lightest dirty channel. */
	restorePaint(tileIndex: number, chunkId: number, layers: ChunkLayer[], alpha: Uint8Array | null): void {
		const chunk = this.tiles[tileIndex].chunks[chunkId];
		const structural =
			chunk.layers.length !== layers.length ||
			chunk.layers.some((l, i) => l.texture !== layers[i].texture || l.effectId !== layers[i].effectId);
		chunk.layers = layers.map((l) => ({ ...l }));
		chunk.alpha = alpha ? alpha.slice() : null;
		if (structural) this.markDirty(this.tiles[tileIndex]);
		else this.markAlphaDirty(tileIndex, chunkId);
	}

	/**
	 * The ground height at scene-space (x, z), exact against the rendered mesh: each cell is four
	 * triangles fanned around its centre vertex. Null outside the scene or over a hole.
	 */
	heightAt(x: number, z: number): number | null {
		return this.sample(x, z, false);
	}

	/** The terrain surface ignoring holes: what counts as above or below ground. */
	surfaceAt(x: number, z: number): number | null {
		return this.sample(x, z, true);
	}

	/**
	 * The surface height of the scene's water over (x, z), or null where there is none (spec 7.10
	 * swimming): a chunk's flat water where its cell is covered, or, in a copied scene whose
	 * chunk still has its source water, the source liquid's own surface there (which may slope).
	 */
	waterAt(x: number, z: number): number | null {
		const tile = this.tileAt(x, z);
		if (!tile) return null;
		const lx = x - tile.x * TILE_SIZE;
		const lz = z - tile.y * TILE_SIZE;
		const cx = Math.min(Math.floor(lx / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const cy = Math.min(Math.floor(lz / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const chunkId = cy * CHUNKS_PER_TILE + cx;
		const chunk = tile.chunks[chunkId];
		const cell = CHUNK_SIZE / INNER;
		const fx = (lx - cx * CHUNK_SIZE) / cell;
		const fz = (lz - cy * CHUNK_SIZE) / cell;
		const col = Math.min(Math.floor(fx), INNER - 1);
		const row = Math.min(Math.floor(fz), INNER - 1);
		const tileIndex = tile.y * this.tilesX + tile.x;
		const base = this.baseData?.tiles[tileIndex];
		if (base && sameWater(chunk.water, base.chunks[chunkId].water)) {
			if (!chunk.water) return null;
			let surface: number | null = null;
			for (const l of base.liquids) {
				if (l.chunk !== chunkId) continue;
				const i = col - l.x;
				const j = row - l.y;
				if (i < 0 || j < 0 || i >= l.width || j >= l.height) continue;
				if (l.exists && !l.exists[j * l.width + i]) continue;
				let h = l.minHeight;
				if (l.heights) {
					// Bilinear between the cell's four corner heights, as the surface mesh is drawn.
					const w = l.width + 1;
					const u = fx - col;
					const v = fz - row;
					const h00 = l.heights[j * w + i];
					const h10 = l.heights[j * w + i + 1];
					const h01 = l.heights[(j + 1) * w + i];
					const h11 = l.heights[(j + 1) * w + i + 1];
					h = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
				}
				if (surface === null || h > surface) surface = h;
			}
			return surface;
		}
		if (!chunk.water || !(chunk.water.coverage[row] & (1 << col))) return null;
		return chunk.water.height;
	}

	private sample(x: number, z: number, ignoreHoles: boolean): number | null {
		const tile = this.tileAt(x, z);
		if (!tile) return null;
		const lx = x - tile.x * TILE_SIZE;
		const lz = z - tile.y * TILE_SIZE;
		const cx = Math.min(Math.floor(lx / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const cy = Math.min(Math.floor(lz / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const chunk = tile.chunks[cy * CHUNKS_PER_TILE + cx];
		const cell = CHUNK_SIZE / INNER;
		// Cell within the chunk, and (u, v) within the cell, 0..1.
		const fx = (lx - cx * CHUNK_SIZE) / cell;
		const fz = (lz - cy * CHUNK_SIZE) / cell;
		const col = Math.min(Math.floor(fx), INNER - 1);
		const row = Math.min(Math.floor(fz), INNER - 1);
		if (!ignoreHoles && chunk.holes[row] & (1 << col)) return null;
		const u = fx - col;
		const v = fz - row;
		const h = chunk.heights;
		const h00 = h[outerIndex(row, col)];
		const h10 = h[outerIndex(row, col + 1)];
		const h01 = h[outerIndex(row + 1, col)];
		const h11 = h[outerIndex(row + 1, col + 1)];
		const hc = h[innerIndex(row, col)];
		// Which of the four triangles around the centre (u + v and u - v split the cell).
		if (u + v <= 1 && u >= v) return h00 + (h10 - h00) * u + (hc - (h00 + h10) / 2) * 2 * v; // north
		if (u + v <= 1) return h00 + (h01 - h00) * v + (hc - (h00 + h01) / 2) * 2 * u; // west
		if (u >= v) return h10 + (h11 - h10) * v + (hc - (h10 + h11) / 2) * 2 * (1 - u); // east
		return h01 + (h11 - h01) * u + (hc - (h01 + h11) / 2) * 2 * (1 - v); // south
	}

	/**
	 * A tile's chunks shaped as parsed ADT data, so the explorer's splat terrain builder applies
	 * unchanged (spec 5): heights are absolute (position z is 0) and water is left to the caller.
	 */
	tileRenderData(tile: SceneTile): { root: AdtRoot; tex: AdtTex } {
		const chunks: AdtChunk[] = tile.chunks.map((c, i) => ({
			indexX: i % CHUNKS_PER_TILE,
			indexY: Math.floor(i / CHUNKS_PER_TILE),
			flags: 0,
			areaId: 0,
			holes: c.holes,
			position: [0, 0, 0],
			heights: c.heights,
			colors: c.vertexShade ? shadeToColors(c.vertexShade) : null,
			effectLayers: new Uint8Array(64),
			noEffect: new Uint8Array(8).fill(0xff),
		}));
		const tex: AdtTex = {
			diffuse: this.textures,
			height: this.textures.map(() => 0),
			params: this.textures.map(() => ({ repeats: 8, heightScale: 0, heightOffset: 1 })),
			chunks: tile.chunks.map((c) => ({
				layers: c.layers.map((l) => ({ texture: l.texture, flags: 0, effect: l.effectId ?? 0 })),
				alpha: splitAlpha(c.alpha, c.layers.length),
			})),
		};
		return { root: { chunks, chunkIds: ['MCNK'], hasWater: false, liquids: [] }, tex };
	}
}

/** MCCV-style RGBA bytes (0x7f neutral) to the splat mesh's RGB multipliers. */
function shadeToColors(shade: Uint8Array): Float32Array {
	const colors = new Float32Array(CHUNK_HEIGHTS * 3);
	for (let i = 0; i < CHUNK_HEIGHTS; i++) {
		colors[i * 3] = shade[i * 4] / 127;
		colors[i * 3 + 1] = shade[i * 4 + 1] / 127;
		colors[i * 3 + 2] = shade[i * 4 + 2] / 127;
	}
	return colors;
}

/** Layer-major concatenated alpha to one 64x64 map per layer after the first. */
function splitAlpha(alpha: Uint8Array | null, layers: number): Uint8Array[] {
	if (!alpha || layers < 2) return [];
	const size = ALPHA_SIZE * ALPHA_SIZE;
	return Array.from({ length: layers - 1 }, (_, i) => alpha.subarray(i * size, (i + 1) * size));
}
