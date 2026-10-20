import * as THREE from 'three';
import { CHUNK_SIZE, CHUNKS_PER_TILE, TILE_CELLS, TILE_SIZE } from '../formats/adt';
import { ALPHA_ATLAS_SIZE, buildSplatTerrain, type ChunkVertexLayout, type SplatGeometry } from '../explorer/splatMesh';
import type { SceneModel, SceneTile } from '../scene/sceneModel';
import type { AsyncStorageApi } from '../worker/protocol';
import { FlyControls } from '../viewer/flyControls';
import { WalkControls } from '../viewer/walkControls';
import { createAlphaTexture, createSplatMaterial, seaMask } from '../viewer/terrainMaterials';
import { TextureCache } from '../viewer/textureCache';
import { supportsCompressedTextures } from '../viewer/textures';
import { CommandStack } from './commands';
import { HoleStroke, WaterStroke, type HoleSettings, type WaterSettings } from './cells';
import { PaintStroke, type PaintSettings } from './paint';
import { SculptStroke, type BrushSettings } from './sculpt';
import { ALPHA_SIZE } from '../formats/adtTex';
import { liquidKind, type LiquidInstance, type LiquidKind } from '../formats/mh2o';
import { buildLiquidMeshes } from '../explorer/liquidMesh';
import { liquidMaterial, liquidTime, releaseLiquidMaterial, setLiquidLooks } from '../viewer/terrainMaterials';
import { GroundDistancePass } from '../viewer/groundDistance';
import { ClutterManager } from '../viewer/clutter';
import type { ClutterEffect, ClutterSource } from '../explorer/groundEffects';

const SKY = new THREE.Color(0x9ec4e4);
/** Camera distance limits for small scenes. */
const NEAR = 0.5;
const FAR = 40000;
/** Thumbnails for the scene library (and later galleries), spec 6.2. */
const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 288;
/** How far the cursor ray is marched looking for ground (yards). */
const CURSOR_REACH = 6000;
/** Outer lattice spacing in yards. */
const CELL = CHUNK_SIZE / 8;

interface TileMesh {
	group: THREE.Group;
	geometry: THREE.BufferGeometry;
	materials: THREE.Material[];
	alpha: THREE.DataTexture;
	textures: number[];
	/** Shared-lattice heights and normals, kept for in-place height updates. */
	outer: Float32Array;
	inner: Float32Array;
	latticeNormals: Float32Array;
	skirtDepth: number;
	/** Chunk vertex ranges by chunk index. */
	layout: ChunkVertexLayout[];
	/** The tile's water surfaces (spec 7.6), rebuilt whole when its water changes. */
	water: THREE.Mesh[];
}

/** What the status bar shows each frame. */
export interface EditorStatus {
	cursor: { x: number; z: number; height: number } | null;
	/** Texture layers of the chunk under the cursor. */
	layers: number | null;
	fps: number;
}

function toBufferGeometry(g: SplatGeometry): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
	geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
	geometry.setAttribute('chunkIndex', new THREE.BufferAttribute(g.chunks, 1));
	geometry.setAttribute('skirt', new THREE.BufferAttribute(g.skirt, 1));
	geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;
}

/** A ring of line segments, laid on the terrain as the brush cursor. */
function makeRing(segments: number): THREE.LineLoop {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
	const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
	const ring = new THREE.LineLoop(geometry, material);
	ring.renderOrder = 999;
	ring.frustumCulled = false;
	ring.visible = false;
	return ring;
}

/**
 * The editor viewport (spec 4): renders a SceneModel's tiles with the explorer's splat terrain,
 * rebuilding only what changed: heights update meshes in place, alpha updates the atlas texture,
 * and only structural changes (layers, holes, water) rebuild a tile. The left mouse button uses
 * the active tool, the right looks around, and a basic walk mode stays on Tab (Phase 1).
 */
export class SceneEditor {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	/** The tile meshes alone, for the water depth pre-pass. */
	private readonly terrain = new THREE.Group();
	/** Water reads the ground's distance per pixel for its depth colours (see GroundDistancePass). */
	private readonly groundPass: GroundDistancePass;
	/** Whether any chunk has water, so the pre-pass only runs when it earns its cost. */
	private hasWater = false;
	private readonly camera: THREE.PerspectiveCamera;
	private readonly controls: FlyControls;
	private readonly walker: WalkControls;
	private readonly textures: TextureCache;
	private readonly tileMeshes = new Map<number, TileMesh>();
	private readonly clock = new THREE.Clock();
	private frame = 0;
	private disposed = false;
	/** Something the user should know, shown by the editor bar. */
	onNotice: (text: string) => void = () => {};
	/** Status bar data, sent every frame. */
	onStatus: (status: EditorStatus) => void = () => {};

	/** The editor core (spec 7.11): every change goes through a command. */
	readonly commands = new CommandStack();
	/** Which tool the left mouse button drives. */
	tool: 'sculpt' | 'paint' | 'holes' | 'water' = 'sculpt';
	/** The hole brush (spec 7.6), edited by the properties panel. */
	readonly holes: HoleSettings = { radius: 4, mode: 'cut' };
	/** The water brush (spec 7.6), edited by the properties panel. */
	readonly water: WaterSettings = { radius: 8, mode: 'add', kind: 1, height: null };
	/** The sculpt brush, edited by the properties panel. */
	readonly brush: BrushSettings = { radius: 15, strength: 0.5, falloff: 'smooth', mode: 'raise', flattenTo: null };
	/** The paint brush (spec 7.5), edited by the properties panel. */
	readonly paint: PaintSettings;
	/** The ground effect a texture usually carries, wired to the scan table (spec 7.7.2). */
	effectFor: (fdid: number) => number = () => 0;
	/** Ground clutter (spec 7.7): on/off and a density multiplier, edited by the panel. */
	readonly clutterSettings = { enabled: true, density: 1 };
	private readonly clutter: ClutterManager;
	/** What each effect scatters, fetched from the worker once and kept. */
	private readonly effectCache = new Map<number, ClutterEffect | null>();
	private fetchingEffects = false;
	/** Tiles whose clutter cells need recomputing (heights, paint, holes or water changed). */
	private readonly clutterDirty = new Set<number>();

	/** Where the mouse last was, in normalized device coordinates. */
	private readonly mouse = new THREE.Vector2(NaN, NaN);
	private readonly raycaster = new THREE.Raycaster();
	/** The ground under the mouse this frame. */
	private cursor: { x: number; z: number; height: number } | null = null;
	private stroke: SculptStroke | PaintStroke | HoleStroke | WaterStroke | null = null;
	/** Build number per tile, so a stale structural rebuild never replaces a newer one. */
	private readonly buildSerial = new Map<number, number>();
	/** Chunks flashed red because they could not take another texture (spec 7.5). */
	private readonly flags: { ring: THREE.LineLoop; until: number }[] = [];
	/** Tiles the open stroke touched, for refreshing bounds when it ends. */
	private readonly strokeTiles = new Set<number>();
	/** The ramp's first clicked point, waiting for the second. */
	private rampStart: { x: number; z: number; h: number } | null = null;
	private readonly ring = makeRing(64);
	private readonly rampRing = makeRing(32);
	/** Frames since the FPS readout last updated. */
	private fpsFrames = 0;
	private fpsTime = 0;
	private fps = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly storage: AsyncStorageApi,
		readonly model: SceneModel,
	) {
		this.paint = { fdid: model.textures[0], radius: 15, strength: 0.7, opacity: 1, mode: 'paint', policy: 'replace' };
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.textures = new TextureCache(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy());
		this.camera = new THREE.PerspectiveCamera(60, 1, NEAR, FAR);
		this.controls = new FlyControls(this.camera, canvas);
		this.walker = new WalkControls(this.camera, canvas);
		this.controls.onTakeOver = () => this.setWalking(false);
		this.walker.world = {
			terrain: (x, z) => this.model.heightAt(x, z) ?? -Infinity,
			surface: (x, z) => this.model.surfaceAt(x, z) ?? -Infinity,
			ready: () => true,
			// Phase 1: terrain-only collision, no buildings, no liquids.
			nearBuilding: () => false,
			cast: () => null,
			sweep: (_from, move) => move,
			pushOut: () => new THREE.Vector3(),
			liquid: () => null,
		};

		this.scene.background = SKY;
		// The scene's lighting: Phase 1 renders every scene with the one built-in preset
		// (environment.lightPreset 0), a daylight sun and sky light as the explorer starts with.
		const sun = new THREE.DirectionalLight(0xfff2dd, Math.PI);
		sun.position.set(-0.6, 1, 0.45);
		const ambient = new THREE.HemisphereLight(0x8899aa, 0x8899aa, Math.PI);
		this.scene.add(sun, ambient, this.terrain, this.ring, this.rampRing);
		this.groundPass = new GroundDistancePass(this.renderer);
		this.clutter = new ClutterManager(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy(), async (object) => {
			await this.renderer.compileAsync(object, this.camera, this.scene);
		});
		this.scene.add(this.clutter.group);
		// The explorer's sea mask tints terrain below sea level; a scene has no sea.
		seaMask.uSeaBounds.value.set(1e9, 1e9, 1, 1);

		// Left button: the active tool. Right button: hold to look around (spec 8 shortcuts).
		canvas.addEventListener('mousedown', this.onMouseDown);
		canvas.addEventListener('mousemove', this.onMouseMove);
		canvas.addEventListener('mouseleave', this.onMouseLeave);
		canvas.addEventListener('contextmenu', this.onContextMenu);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('resize', this.onResize);
		this.onResize();

		// Start over the spawn point, looking north across the scene.
		const [sx, , sz] = model.meta.spawn.position;
		const span = Math.max(model.tilesX, model.tilesY) * TILE_SIZE;
		this.controls.set(new THREE.Vector3(sx, span * 0.35, sz + span * 0.4), 0, -0.6);
	}

	/** Loads the texture palette and builds every tile; the scene is in view when this resolves. */
	async load(): Promise<void> {
		// Water colours come from LiquidType.db2; the materials update when they arrive.
		void this.storage.loadLiquidLooks().then(setLiquidLooks).catch(() => {});
		for (const tile of this.model.tiles) await this.buildTile(tile);
		this.render();
	}

	private async buildTile(tile: SceneTile): Promise<void> {
		const index = tile.y * this.model.tilesX + tile.x;
		const serial = (this.buildSerial.get(index) ?? 0) + 1;
		this.buildSerial.set(index, serial);
		const { root, tex } = this.model.tileRenderData(tile);
		const terrain = buildSplatTerrain(root, tex);
		const textures = await this.textures.acquire(terrain.textures);
		if (this.disposed || this.buildSerial.get(index) !== serial) {
			this.textures.release(terrain.textures);
			return;
		}
		this.dropTile(index);
		const alpha = createAlphaTexture(terrain.alpha, ALPHA_ATLAS_SIZE);
		const geometry = toBufferGeometry(terrain.geometry);
		const materials = terrain.groups.map((g, i) => {
			geometry.addGroup(g.start, g.count, i);
			return createSplatMaterial(alpha, g.layers, textures);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.matrixAutoUpdate = false;
		const group = new THREE.Group();
		group.add(mesh);
		group.position.set(tile.x * TILE_SIZE, 0, tile.y * TILE_SIZE);
		this.terrain.add(group);
		group.updateMatrixWorld(true);
		const layout: ChunkVertexLayout[] = [];
		for (const l of terrain.layout) layout[l.id] = l;
		this.tileMeshes.set(index, {
			group,
			geometry,
			materials,
			alpha,
			textures: terrain.textures,
			outer: terrain.heights,
			inner: terrain.inner,
			latticeNormals: terrain.latticeNormals,
			skirtDepth: terrain.skirtDepth,
			layout,
			water: [],
		});
		this.buildTileWater(index);
	}

	/** Rebuilds a tile's water surfaces from its chunks' settings (spec 7.6). */
	private buildTileWater(index: number): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		for (const mesh of tm.water) {
			tm.group.remove(mesh);
			mesh.geometry.dispose();
			releaseLiquidMaterial(mesh.material as THREE.Material);
		}
		tm.water = [];
		const liquids: LiquidInstance[] = [];
		this.model.tiles[index].chunks.forEach((chunk, id) => {
			const water = chunk.water;
			if (!water) return;
			const exists = new Uint8Array(64);
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) exists[row * 8 + col] = water.coverage[row] & (1 << col) ? 1 : 0;
			}
			liquids.push({ chunk: id, type: water.kind, minHeight: water.height, maxHeight: water.height, x: 0, y: 0, width: 8, height: 8, exists, heights: null });
		});
		// Ocean would be skipped as the explorer's one sea plane; here it is just another surface.
		const kindOf = (type: number): LiquidKind => {
			const kind = liquidKind(type);
			return kind === 'ocean' ? 'water' : kind;
		};
		for (const built of buildLiquidMeshes(liquids, kindOf)) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
			const normals = new Float32Array(built.positions.length);
			for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
			geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
			geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
			geometry.computeBoundingSphere();
			const mesh = new THREE.Mesh(geometry, liquidMaterial(built.kind, built.type));
			mesh.renderOrder = 1;
			mesh.matrixAutoUpdate = false;
			tm.group.add(mesh);
			mesh.updateMatrixWorld(true);
			tm.water.push(mesh);
		}
		this.hasWater = [...this.tileMeshes.values()].some((t) => t.water.length > 0);
		this.clutterDirty.add(index);
	}

	private dropTile(index: number): void {
		const mesh = this.tileMeshes.get(index);
		if (!mesh) return;
		this.tileMeshes.delete(index);
		this.clutter.removeTile(String(index));
		this.terrain.remove(mesh.group);
		mesh.geometry.dispose();
		for (const m of mesh.materials) m.dispose();
		mesh.alpha.dispose();
		for (const w of mesh.water) {
			w.geometry.dispose();
			releaseLiquidMaterial(w.material as THREE.Material);
		}
		this.textures.release(mesh.textures);
	}

	/**
	 * Updates a tile's mesh in place after some chunks' heights changed: copies the heights into
	 * the shared lattice, recomputes normals around the change (dirty chunks plus a margin, spec
	 * 7.4) and writes the affected vertices back, so a brush stroke never rebuilds geometry.
	 */
	private updateTileHeights(index: number, chunkIds: Set<number>): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const tile = this.model.tiles[index];
		const n = TILE_CELLS;
		const w = n + 1;

		let cx0 = CHUNKS_PER_TILE;
		let cx1 = -1;
		let cy0 = CHUNKS_PER_TILE;
		let cy1 = -1;
		for (const id of chunkIds) {
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			cx0 = Math.min(cx0, cx);
			cx1 = Math.max(cx1, cx);
			cy0 = Math.min(cy0, cy);
			cy1 = Math.max(cy1, cy);
			const heights = tile.chunks[id].heights;
			for (let row = 0; row < 9; row++) {
				for (let col = 0; col < 9; col++) tm.outer[(cy * 8 + row) * w + cx * 8 + col] = heights[row * 17 + col];
			}
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) tm.inner[(cy * 8 + row) * n + cx * 8 + col] = heights[row * 17 + 9 + col];
			}
		}
		if (cx1 < 0) return;

		// Cells whose geometry changed, expanded a cell each way: their vertices' normals change.
		const sx0 = Math.max(0, cx0 * 8 - 1);
		const sx1 = Math.min(n - 1, cx1 * 8 + 8);
		const sz0 = Math.max(0, cy0 * 8 - 1);
		const sz1 = Math.min(n - 1, cy1 * 8 + 8);
		this.recomputeNormals(tm, sx0, sx1, sz0, sz1);

		// Write positions and normals back for every chunk overlapping the recomputed vertices.
		const positions = tm.geometry.getAttribute('position') as THREE.BufferAttribute;
		const normals = tm.geometry.getAttribute('normal') as THREE.BufferAttribute;
		const pos = positions.array as Float32Array;
		const nor = normals.array as Float32Array;
		const outerCount = w * w;
		for (let cy = Math.floor(sz0 / 8); cy <= Math.floor(sz1 / 8); cy++) {
			for (let cx = Math.floor(sx0 / 8); cx <= Math.floor(sx1 / 8); cx++) {
				const layout = tm.layout[cy * CHUNKS_PER_TILE + cx];
				if (!layout) continue;
				for (let row = 0; row < 9; row++) {
					for (let col = 0; col < 9; col++) {
						const v = layout.base + row * 9 + col;
						const g = (cy * 8 + row) * w + cx * 8 + col;
						pos[v * 3 + 1] = tm.outer[g];
						nor[v * 3] = tm.latticeNormals[g * 3];
						nor[v * 3 + 1] = tm.latticeNormals[g * 3 + 1];
						nor[v * 3 + 2] = tm.latticeNormals[g * 3 + 2];
					}
				}
				for (let row = 0; row < 8; row++) {
					for (let col = 0; col < 8; col++) {
						const v = layout.base + 81 + row * 8 + col;
						const g = (cy * 8 + row) * n + cx * 8 + col;
						pos[v * 3 + 1] = tm.inner[g];
						const o = (outerCount + g) * 3;
						nor[v * 3] = tm.latticeNormals[o];
						nor[v * 3 + 1] = tm.latticeNormals[o + 1];
						nor[v * 3 + 2] = tm.latticeNormals[o + 2];
					}
				}
				for (const s of layout.skirts) {
					const g = s.gz * w + s.gx;
					pos[s.vertex * 3 + 1] = tm.outer[g] - tm.skirtDepth;
					nor[s.vertex * 3] = tm.latticeNormals[g * 3];
					nor[s.vertex * 3 + 1] = tm.latticeNormals[g * 3 + 1];
					nor[s.vertex * 3 + 2] = tm.latticeNormals[g * 3 + 2];
				}
			}
		}
		positions.needsUpdate = true;
		normals.needsUpdate = true;
	}

	/**
	 * Recomputes a tile's clutter cells (spec 7.7.1): like the client, each terrain cell takes its
	 * clutter from the texture layer that covers most of it, skipping holes and cells under water.
	 * Effects the worker hasn't described yet are fetched once, and the tile revisited.
	 */
	private rebuildClutter(index: number): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const key = String(index);
		const tile = this.model.tiles[index];
		const originX = tile.x * TILE_SIZE;
		const originZ = tile.y * TILE_SIZE;
		if (!this.clutterSettings.enabled || this.clutterSettings.density <= 0) {
			this.clutter.addTile(key, originX, originZ, null);
			return;
		}
		// Which effects the tile needs; ask the worker about any not yet described.
		const missing = new Set<number>();
		for (const chunk of tile.chunks) {
			for (const layer of chunk.layers) {
				if (layer.effectId && !this.effectCache.has(layer.effectId)) missing.add(layer.effectId);
			}
		}
		if (missing.size) {
			this.clutterDirty.add(index);
			if (!this.fetchingEffects) {
				this.fetchingEffects = true;
				const ids = [...missing];
				this.storage.clutterEffects(ids)
					.then((effects) => ids.forEach((id, i) => this.effectCache.set(id, effects[i])))
					.catch(() => ids.forEach((id) => this.effectCache.set(id, null)))
					.finally(() => {
						this.fetchingEffects = false;
					});
			}
			return;
		}

		const n = TILE_CELLS;
		const texels = ALPHA_SIZE * ALPHA_SIZE;
		const cells = new Uint8Array(n * n);
		const effects: ClutterEffect[] = [];
		const indexOf = new Map<number, number>();
		tile.chunks.forEach((chunk, id) => {
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) {
					if (chunk.holes[row] & (1 << col)) continue;
					const gx = cx * 8 + col;
					const gz = cy * 8 + row;
					// Nothing grows under water.
					if (chunk.water && chunk.water.coverage[row] & (1 << col) && chunk.water.height > tm.inner[gz * n + gx]) continue;
					// The layer covering most of the cell, by its alpha over the cell's texels.
					let dominant = 0;
					if (chunk.layers.length > 1 && chunk.alpha) {
						let others = 0;
						let best = -1;
						let bestSum = 0;
						for (let l = 1; l < chunk.layers.length; l++) {
							let sum = 0;
							for (let ty = row * 8; ty < row * 8 + 8; ty++) {
								for (let tx = col * 8; tx < col * 8 + 8; tx++) sum += chunk.alpha[(l - 1) * texels + ty * ALPHA_SIZE + tx];
							}
							others += sum;
							if (sum > bestSum) {
								bestSum = sum;
								best = l;
							}
						}
						if (best > 0 && bestSum > 64 * 255 - others) dominant = best;
					}
					const effectId = chunk.layers[dominant]?.effectId ?? 0;
					if (!effectId) continue;
					const effect = this.effectCache.get(effectId);
					if (!effect) continue;
					let effectIndex = indexOf.get(effectId);
					if (effectIndex === undefined) {
						if (effects.length >= 255) continue;
						const density = Math.round(effect.density * this.clutterSettings.density);
						if (!density) continue;
						effectIndex = effects.length;
						effects.push({ density, doodads: effect.doodads });
						indexOf.set(effectId, effectIndex);
					}
					cells[gz * n + gx] = effectIndex + 1;
				}
			}
		});
		const source: ClutterSource | null = effects.length ? { effects, cells, outer: tm.outer, inner: tm.inner } : null;
		this.clutter.addTile(key, originX, originZ, source);
	}

	/** Clutter settings changed: regenerate every tile's clutter. */
	refreshClutter(): void {
		this.clutter.enabled = this.clutterSettings.enabled;
		for (const index of this.tileMeshes.keys()) this.clutterDirty.add(index);
	}

	/**
	 * Gives layers painted before the scan finished their texture's usual effect (spec 7.7.2
	 * "Apply ground effects to scene"), as one undoable command; returns how many chunks changed.
	 */
	applyGroundEffects(): number {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: { layers: typeof model.tiles[0]['chunks'][0]['layers']; alpha: Uint8Array | null }; after: { layers: typeof model.tiles[0]['chunks'][0]['layers']; alpha: Uint8Array | null } }[] = [];
		let bytes = 0;
		model.tiles.forEach((tile, tileIndex) => {
			tile.chunks.forEach((chunk, chunkId) => {
				const missing = chunk.layers.filter((l) => l.effectId === undefined && this.effectFor(model.textures[l.texture]));
				if (!missing.length) return;
				const snapshot = () => ({ layers: chunk.layers.map((l) => ({ ...l })), alpha: chunk.alpha ? chunk.alpha.slice() : null });
				const before = snapshot();
				for (const layer of missing) layer.effectId = this.effectFor(model.textures[layer.texture]);
				changes.push({ tileIndex, chunkId, before, after: snapshot() });
				bytes += (chunk.alpha?.length ?? 0) * 2 + 256;
				model.markDirty(tile);
			});
		});
		if (changes.length) {
			this.commands.push({
				label: 'Apply ground effects',
				bytes,
				undo: () => {
					for (const c of changes) model.restorePaint(c.tileIndex, c.chunkId, c.before.layers, c.before.alpha);
				},
				redo: () => {
					for (const c of changes) model.restorePaint(c.tileIndex, c.chunkId, c.after.layers, c.after.alpha);
				},
			});
		}
		return changes.length;
	}

	/**
	 * Rewrites changed chunks' alpha maps into the tile's atlas texture (spec 7.5): layer 1-3
	 * alpha goes to the R, G and B channels of the chunk's 64x64 atlas region.
	 */
	private updateTileAlpha(index: number, chunkIds: Set<number>): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const tile = this.model.tiles[index];
		const data = tm.alpha.image.data as Uint8Array;
		const texels = ALPHA_SIZE * ALPHA_SIZE;
		for (const id of chunkIds) {
			const chunk = tile.chunks[id];
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			for (let layer = 0; layer < 3; layer++) {
				const map = chunk.alpha && layer < chunk.layers.length - 1 ? chunk.alpha.subarray(layer * texels, (layer + 1) * texels) : null;
				for (let y = 0; y < ALPHA_SIZE; y++) {
					const row = ((cy * ALPHA_SIZE + y) * ALPHA_ATLAS_SIZE + cx * ALPHA_SIZE) * 4 + layer;
					for (let x = 0; x < ALPHA_SIZE; x++) data[row + x * 4] = map ? map[y * ALPHA_SIZE + x] : 0;
				}
			}
		}
		tm.alpha.needsUpdate = true;
	}

	/** Flashes a red ring over chunks that could not take the texture (spec 7.5). */
	private flashBlocked(stroke: PaintStroke): void {
		while (stroke.blocked.length) {
			const { x, z } = stroke.blocked.pop()!;
			const ring = makeRing(4);
			(ring.material as THREE.LineBasicMaterial).color.set(0xe04040);
			const positions = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
			const corners = [[x + 0.5, z + 0.5], [x + CHUNK_SIZE - 0.5, z + 0.5], [x + CHUNK_SIZE - 0.5, z + CHUNK_SIZE - 0.5], [x + 0.5, z + CHUNK_SIZE - 0.5]];
			corners.forEach(([px, pz], i) => positions.setXYZ(i, px, (this.model.surfaceAt(px, pz) ?? 0) + 0.3, pz));
			positions.needsUpdate = true;
			ring.visible = true;
			this.scene.add(ring);
			this.flags.push({ ring, until: performance.now() + 1200 });
			this.onNotice('That chunk already has 4 textures');
		}
	}

	/**
	 * Recomputes area-weighted lattice normals for the vertices of cells [sx0..sx1]x[sz0..sz1],
	 * accumulating over those cells plus a one-cell ring, exactly as the full build does.
	 */
	private recomputeNormals(tm: TileMesh, sx0: number, sx1: number, sz0: number, sz1: number): void {
		const n = TILE_CELLS;
		const w = n + 1;
		const outerCount = w * w;
		const normals = tm.latticeNormals;
		const inZeroOuter = (gx: number, gz: number) => gx >= sx0 && gx <= sx1 + 1 && gz >= sz0 && gz <= sz1 + 1;
		const inZeroInner = (gx: number, gz: number) => gx >= sx0 && gx <= sx1 && gz >= sz0 && gz <= sz1;
		for (let gz = sz0; gz <= sz1 + 1; gz++) {
			for (let gx = sx0; gx <= sx1 + 1; gx++) normals.fill(0, (gz * w + gx) * 3, (gz * w + gx) * 3 + 3);
		}
		for (let gz = sz0; gz <= sz1; gz++) {
			for (let gx = sx0; gx <= sx1; gx++) normals.fill(0, (outerCount + gz * n + gx) * 3, (outerCount + gz * n + gx) * 3 + 3);
		}

		const ax0 = Math.max(0, sx0 - 1);
		const ax1 = Math.min(n - 1, sx1 + 1);
		const az0 = Math.max(0, sz0 - 1);
		const az1 = Math.min(n - 1, sz1 + 1);
		const add = (index: number, x: number, y: number, z: number) => {
			normals[index * 3] += x;
			normals[index * 3 + 1] += y;
			normals[index * 3 + 2] += z;
		};
		for (let gz = az0; gz <= az1; gz++) {
			for (let gx = ax0; gx <= ax1; gx++) {
				// The cell's four fan triangles, wound as the mesh builds them.
				const x0 = gx * CELL;
				const z0 = gz * CELL;
				const h00 = tm.outer[gz * w + gx];
				const h10 = tm.outer[gz * w + gx + 1];
				const h01 = tm.outer[(gz + 1) * w + gx];
				const h11 = tm.outer[(gz + 1) * w + gx + 1];
				const hc = tm.inner[gz * n + gx];
				const corners: [number, number, number, number, number, boolean][] = [
					[x0, h00, z0, gz * w + gx, 0, inZeroOuter(gx, gz)],
					[x0 + CELL, h10, z0, gz * w + gx + 1, 0, inZeroOuter(gx + 1, gz)],
					[x0 + CELL, h11, z0 + CELL, (gz + 1) * w + gx + 1, 0, inZeroOuter(gx + 1, gz + 1)],
					[x0, h01, z0 + CELL, (gz + 1) * w + gx, 0, inZeroOuter(gx, gz + 1)],
				];
				const centre: [number, number, number] = [x0 + CELL / 2, hc, z0 + CELL / 2];
				const centreIndex = outerCount + gz * n + gx;
				const centreIn = inZeroInner(gx, gz);
				// Triangles (tl, c, tr), (tr, c, br), (br, c, bl), (bl, c, tl).
				const order = [0, 1, 1, 2, 2, 3, 3, 0];
				for (let t = 0; t < 4; t++) {
					const a = corners[order[t * 2]];
					const b = corners[order[t * 2 + 1]];
					const abx = centre[0] - a[0], aby = centre[1] - a[1], abz = centre[2] - a[2];
					const acx = b[0] - a[0], acy = b[1] - a[1], acz = b[2] - a[2];
					const nx = aby * acz - abz * acy;
					const ny = abz * acx - abx * acz;
					const nz = abx * acy - aby * acx;
					if (a[5]) add(a[3], nx, ny, nz);
					if (b[5]) add(b[3], nx, ny, nz);
					if (centreIn) add(centreIndex, nx, ny, nz);
				}
			}
		}

		const normalize = (index: number) => {
			const o = index * 3;
			const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
			normals[o] /= len;
			normals[o + 1] /= len;
			normals[o + 2] /= len;
		};
		for (let gz = sz0; gz <= sz1 + 1; gz++) for (let gx = sx0; gx <= sx1 + 1; gx++) normalize(gz * w + gx);
		for (let gz = sz0; gz <= sz1; gz++) for (let gx = sx0; gx <= sx1; gx++) normalize(outerCount + gz * n + gx);
	}

	get walking(): boolean {
		return this.walker.active;
	}

	/** Drops to the ground under the camera and walks, or lifts back to the fly camera (Tab). */
	setWalking(on: boolean): void {
		if (on === this.walker.active) return;
		if (!on) {
			this.walker.stop();
			this.controls.enabled = true;
			this.controls.set(this.camera.position.clone(), this.walker.yaw, this.walker.pitch);
			return;
		}
		this.endStroke();
		const cam = this.camera.position;
		const floor = this.walker.floorAt(cam.x, cam.z, cam.y, cam.y - 5000);
		if (!floor) {
			this.onNotice('There’s no ground under the camera to stand on');
			return;
		}
		this.controls.enabled = false;
		this.walker.dropFrom(cam, this.controls.yaw);
		this.walker.start();
	}

	undo(): void {
		this.endStroke();
		this.commands.undo();
	}

	redo(): void {
		this.endStroke();
		this.commands.redo();
	}

	start(): void {
		this.clock.start();
		const loop = () => {
			if (this.disposed) return;
			this.frame = requestAnimationFrame(loop);
			this.update(Math.min(this.clock.getDelta(), 0.1));
			this.render();
		};
		loop();
	}

	private update(dt: number): void {
		this.updateCursor();
		if (this.stroke && this.cursor) {
			this.stroke.apply(this.cursor.x, this.cursor.z, dt);
			if (this.stroke instanceof PaintStroke) this.flashBlocked(this.stroke);
		}
		for (const [index, chunks] of this.model.dirtyHeights) {
			this.model.dirtyHeights.delete(index);
			this.strokeTiles.add(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue;
			this.updateTileHeights(index, chunks);
		}
		// Culling bounds refresh once the edit is over (stroke end, ramp, undo, redo).
		if (!this.stroke && this.strokeTiles.size) this.refreshBounds();
		for (const [index, chunks] of this.model.dirtyAlpha) {
			this.model.dirtyAlpha.delete(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue;
			this.updateTileAlpha(index, chunks);
		}
		for (const index of this.model.dirtyWater) {
			this.model.dirtyWater.delete(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue; // The rebuild brings the water too.
			this.buildTileWater(index);
		}
		liquidTime.value += dt;
		// Clutter regenerates once the edit is over, not per stroke frame (spec 7.7.1).
		if (!this.stroke && this.clutterDirty.size) {
			for (const index of [...this.clutterDirty]) {
				this.clutterDirty.delete(index);
				this.rebuildClutter(index);
			}
		}
		const ground = this.model.surfaceAt(this.camera.position.x, this.camera.position.z);
		this.clutter.update(performance.now(), this.camera.position, ground ?? -Infinity);
		const now = performance.now();
		for (let i = this.flags.length - 1; i >= 0; i--) {
			if (now < this.flags[i].until) continue;
			const [flag] = this.flags.splice(i, 1);
			this.scene.remove(flag.ring);
			flag.ring.geometry.dispose();
			(flag.ring.material as THREE.Material).dispose();
		}
		for (const index of this.model.dirtyTiles) {
			this.model.dirtyTiles.delete(index);
			void this.buildTile(this.model.tiles[index]);
		}
		if (this.walker.active) this.walker.update(dt);
		else this.controls.update(dt, (x, z) => this.model.heightAt(x, z) ?? -Infinity, (x, z) => this.model.surfaceAt(x, z) ?? -Infinity);
		this.updateRings();
		this.updateStatus(dt);
	}

	/** The ground under the mouse, by marching the pick ray against the height field. */
	private updateCursor(): void {
		this.cursor = null;
		if (this.walker.active || this.controls.locked || Number.isNaN(this.mouse.x)) return;
		this.raycaster.setFromCamera(this.mouse, this.camera);
		const o = this.raycaster.ray.origin;
		const d = this.raycaster.ray.direction;
		let prevT = 0;
		let prevF: number | null = null;
		for (let t = 0; t < CURSOR_REACH; t += Math.max(0.5, t * 0.02)) {
			const x = o.x + d.x * t;
			const z = o.z + d.z * t;
			const s = this.model.surfaceAt(x, z);
			if (s === null) {
				prevF = null;
				continue;
			}
			const f = o.y + d.y * t - s;
			if (f <= 0) {
				if (prevF === null) return; // Started underground or entered from outside.
				// Bisect between the last point above and this one below.
				let lo = prevT;
				let hi = t;
				for (let i = 0; i < 24; i++) {
					const mid = (lo + hi) / 2;
					const mx = o.x + d.x * mid;
					const mz = o.z + d.z * mid;
					const ms = this.model.surfaceAt(mx, mz);
					if (ms === null || o.y + d.y * mid - ms > 0) lo = mid;
					else hi = mid;
				}
				const hx = o.x + d.x * hi;
				const hz = o.z + d.z * hi;
				const height = this.model.surfaceAt(hx, hz);
				if (height !== null) this.cursor = { x: hx, z: hz, height };
				return;
			}
			prevT = t;
			prevF = f;
		}
	}

	/** Lays the brush ring (and the ramp's anchor ring) on the terrain. */
	private updateRings(): void {
		if (this.tool !== 'sculpt' || this.brush.mode !== 'ramp') this.rampStart = null;
		const show = this.cursor !== null && !this.walker.active && !this.controls.locked;
		this.ring.visible = show;
		const radius =
			this.tool === 'paint' ? (this.paint.mode === 'paint' || this.paint.mode === 'erase' ? this.paint.radius : 2)
			: this.tool === 'holes' ? this.holes.radius
			: this.tool === 'water' ? (this.water.mode === 'flood' ? 2 : this.water.radius)
			: this.brush.radius;
		if (show && this.cursor) this.layRing(this.ring, this.cursor.x, this.cursor.z, radius, this.cursor.height);
		this.rampRing.visible = this.rampStart !== null;
		if (this.rampStart) this.layRing(this.rampRing, this.rampStart.x, this.rampStart.z, Math.min(this.brush.radius, 3), this.rampStart.h);
	}

	private layRing(ring: THREE.LineLoop, x: number, z: number, radius: number, fallback: number): void {
		const positions = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
		const count = positions.count;
		for (let i = 0; i < count; i++) {
			const a = (i / count) * Math.PI * 2;
			const px = x + Math.cos(a) * radius;
			const pz = z + Math.sin(a) * radius;
			positions.setXYZ(i, px, (this.model.surfaceAt(px, pz) ?? fallback) + 0.15, pz);
		}
		positions.needsUpdate = true;
	}

	private updateStatus(dt: number): void {
		this.fpsFrames++;
		this.fpsTime += dt;
		if (this.fpsTime >= 0.5) {
			this.fps = Math.round(this.fpsFrames / this.fpsTime);
			this.fpsFrames = 0;
			this.fpsTime = 0;
		}
		let layers: number | null = null;
		if (this.cursor) {
			const tile = this.model.tileAt(this.cursor.x, this.cursor.z);
			if (tile) {
				const cx = Math.min(Math.floor((this.cursor.x - tile.x * TILE_SIZE) / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
				const cy = Math.min(Math.floor((this.cursor.z - tile.y * TILE_SIZE) / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
				layers = tile.chunks[cy * CHUNKS_PER_TILE + cx].layers.length;
			}
		}
		this.onStatus({ cursor: this.cursor, layers, fps: this.fps });
	}

	private render(): void {
		if (this.hasWater) this.groundPass.render(this.renderer, this.terrain, this.camera);
		this.renderer.render(this.scene, this.camera);
	}

	/** Starts the active tool at the cursor (left button). */
	private beginStroke(): void {
		if (!this.cursor || this.walker.active || this.controls.locked) return;
		if (this.tool === 'paint') {
			this.stroke = new PaintStroke(this.model, this.paint, this.effectFor);
			return;
		}
		if (this.tool === 'holes') {
			this.stroke = new HoleStroke(this.model, this.holes);
			return;
		}
		if (this.tool === 'water') {
			const stroke = new WaterStroke(this.model, this.water, this.cursor.height);
			if (this.water.mode === 'flood') {
				// Flood fills once per click, like the ramp.
				const filled = stroke.applyFlood(this.cursor.x, this.cursor.z);
				const command = stroke.finish();
				if (command) this.commands.push(command);
				else if (!filled) this.onNotice('Flood fill needs ground below the surface height; raise the height or click a hollow');
				return;
			}
			this.stroke = stroke;
			return;
		}
		if (this.tool !== 'sculpt') return;
		if (this.brush.mode === 'ramp') {
			if (!this.rampStart) {
				this.rampStart = { x: this.cursor.x, z: this.cursor.z, h: this.cursor.height };
				return;
			}
			const stroke = new SculptStroke(this.model, this.brush, this.cursor.height);
			stroke.applyRamp(this.rampStart, { x: this.cursor.x, z: this.cursor.z, h: this.cursor.height });
			const command = stroke.finish();
			if (command) this.commands.push(command);
			this.rampStart = null;
			return;
		}
		this.stroke = new SculptStroke(this.model, this.brush, this.cursor.height);
	}

	/** Ends the open stroke, committing it as one undoable command. */
	private endStroke(): void {
		if (!this.stroke) return;
		const command = this.stroke.finish();
		this.stroke = null;
		if (command) this.commands.push(command);
	}

	/** Recomputes culling bounds of the tiles an edit touched (cheap once per edit). */
	private refreshBounds(): void {
		for (const index of this.strokeTiles) {
			const tm = this.tileMeshes.get(index);
			if (!tm) continue;
			tm.geometry.computeBoundingSphere();
			tm.geometry.computeBoundingBox();
		}
		this.strokeTiles.clear();
	}

	/** A 512x288 WebP render for the scene library (spec 6.2), from the current view. */
	async thumbnail(): Promise<Uint8Array | null> {
		const target = new THREE.WebGLRenderTarget(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		const aspect = this.camera.aspect;
		this.camera.aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;
		this.camera.updateProjectionMatrix();
		const ringWas = this.ring.visible;
		this.ring.visible = false;
		this.rampRing.visible = false;
		if (this.hasWater) this.groundPass.render(this.renderer, this.terrain, this.camera);
		this.renderer.setRenderTarget(target);
		this.renderer.render(this.scene, this.camera);
		this.ring.visible = ringWas;
		const pixels = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4);
		await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, pixels);
		this.renderer.setRenderTarget(null);
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
		target.dispose();
		// GL reads rows bottom-up.
		const flipped = new Uint8ClampedArray(pixels.length);
		const row = THUMBNAIL_WIDTH * 4;
		for (let y = 0; y < THUMBNAIL_HEIGHT; y++) flipped.set(pixels.subarray(y * row, (y + 1) * row), (THUMBNAIL_HEIGHT - 1 - y) * row);
		const drawn = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		drawn.getContext('2d')!.putImageData(new ImageData(flipped, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), 0, 0);
		try {
			const blob = await drawn.convertToBlob({ type: 'image/webp', quality: 0.85 });
			return new Uint8Array(await blob.arrayBuffer());
		} catch {
			return null;
		}
	}

	private readonly onMouseDown = (e: MouseEvent): void => {
		if (this.walker.active) return;
		if (e.button === 2) {
			this.endStroke();
			this.controls.lock();
		} else if (e.button === 0 && !this.controls.locked) {
			this.beginStroke();
		}
	};

	private readonly onMouseUp = (e: MouseEvent): void => {
		if (e.button === 0) this.endStroke();
		if (e.button === 2 && this.controls.locked) document.exitPointerLock();
	};

	private readonly onMouseMove = (e: MouseEvent): void => {
		const rect = this.canvas.getBoundingClientRect();
		this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	};

	private readonly onMouseLeave = (): void => {
		this.mouse.set(NaN, NaN);
	};

	private readonly onContextMenu = (e: Event): void => {
		e.preventDefault();
	};

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		if (this.disposed || e.altKey) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
			e.preventDefault();
			if (e.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
			e.preventDefault();
			this.redo();
			return;
		}
		if (e.ctrlKey || e.metaKey) return;
		if (e.code === 'Tab') {
			e.preventDefault();
			this.setWalking(!this.walker.active);
		}
	};

	private readonly onResize = (): void => {
		const width = this.canvas.clientWidth || window.innerWidth;
		const height = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	};

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.endStroke();
		this.walker.stop();
		this.controls.enabled = false;
		this.canvas.removeEventListener('mousedown', this.onMouseDown);
		this.canvas.removeEventListener('mousemove', this.onMouseMove);
		this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
		this.canvas.removeEventListener('contextmenu', this.onContextMenu);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('resize', this.onResize);
		for (const index of [...this.tileMeshes.keys()]) this.dropTile(index);
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.rampRing.geometry.dispose();
		(this.rampRing.material as THREE.Material).dispose();
		this.renderer.dispose();
	}
}
