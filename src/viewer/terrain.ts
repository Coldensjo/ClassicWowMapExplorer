import * as THREE from 'three';
import { TILE_CELLS, TILE_SIZE } from '../formats/adt';
import { WDL_CELLS } from '../formats/wdl';
import { ALPHA_ATLAS_SIZE, type SplatGeometry } from '../explorer/splatMesh';
import type { FarTile, NearTile } from '../explorer/world';
import type { TerrainGeometry } from '../explorer/terrainMesh';
import type { AsyncStorageApi } from '../worker/protocol';
import type { ObjectLevel, ObjectManager } from './objects';
import { TextureCache } from './textureCache';
import { createAlphaTexture, createFarMaterial, createSplatMaterial, liquidMaterials } from './terrainMaterials';
import { perf } from './perf';
import { createTexture } from './textures';

/** Full-detail tiles load within this distance of the camera and unload beyond the drop distance. */
const NEAR_LOAD_DISTANCE = 900;
const NEAR_DROP_DISTANCE = 1400;
const MAX_NEAR_IN_FLIGHT = 3;
/** Buildings show out to this distance; scattered doodads only on full-detail tiles. */
const WMO_DISTANCE = 3000;
const FAR_TEXTURE_SIZE = 128;
const FAR_TEXTURE_BATCH = 32;

export interface ContinentPlacement {
	name: string;
	/** Map.db2 ID (0 Eastern Kingdoms, 1 Kalimdor). */
	mapId: number;
	wdt: number;
	/** Where the continent's tile (0, 0) sits in the shared world grid, in tiles. */
	offsetX: number;
	offsetY: number;
}

interface TileState {
	continent: ContinentPlacement;
	x: number;
	y: number;
	/** World-space north-west corner. */
	originX: number;
	originZ: number;
	hasAdt: boolean;
	maxHeight: number;
	far: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
	farHeights: Float32Array;
	near: NearState | null;
	nearHeights: Float32Array | null;
	/** AreaTable ID per chunk while the tile is detailed. */
	areaIds: Uint32Array | null;
	nearLoading: boolean;
	distance: number;
	objectLevel: ObjectLevel;
}

/** A loaded full-detail tile and everything that must be released when it unloads. */
interface NearState {
	object: THREE.Group;
	geometries: THREE.BufferGeometry[];
	materials: THREE.Material[];
	ownTextures: THREE.Texture[];
	sharedTextures: number[];
}

export interface TerrainStats {
	farTiles: number;
	farTextures: number;
	nearTiles: number;
	nearLoading: number;
	layerTextures: number;
}

function toBufferGeometry(g: TerrainGeometry | SplatGeometry): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
	if ('colors' in g) {
		geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
		geometry.setAttribute('chunkIndex', new THREE.BufferAttribute(g.chunks, 1));
	}
	geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;
}

function liquidGeometry(positions: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	const normals = new Float32Array(positions.length);
	for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
	geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	geometry.computeBoundingSphere();
	return geometry;
}

/** Bilinear sample of an (n+1)x(n+1) outer height grid at tile-local coordinates. */
function sampleGrid(heights: Float32Array, n: number, lx: number, lz: number): number {
	const fx = THREE.MathUtils.clamp((lx / TILE_SIZE) * n, 0, n);
	const fz = THREE.MathUtils.clamp((lz / TILE_SIZE) * n, 0, n);
	const x0 = Math.min(Math.floor(fx), n - 1);
	const z0 = Math.min(Math.floor(fz), n - 1);
	const tx = fx - x0;
	const tz = fz - z0;
	const row = n + 1;
	const h00 = heights[z0 * row + x0];
	const h10 = heights[z0 * row + x0 + 1];
	const h01 = heights[(z0 + 1) * row + x0];
	const h11 = heights[(z0 + 1) * row + x0 + 1];
	return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/**
 * Owns every terrain tile in the world. All tiles always have a low-detail mesh from the
 * WDL; tiles near the camera swap to their full ADT mesh and texture.
 */
export class TerrainManager {
	readonly group = new THREE.Group();
	private readonly tiles = new Map<string, TileState>();
	private nearInFlight = 0;
	private farTexturesLoaded = 0;
	private farTexturesTotal = 0;
	private readonly layerTextures: TextureCache;

	constructor(
		private readonly storage: AsyncStorageApi,
		private readonly compressed: boolean,
		private readonly anisotropy: number,
		private readonly objects: ObjectManager,
		private readonly prepare: (object: THREE.Object3D) => Promise<void>,
	) {
		this.layerTextures = new TextureCache(storage, compressed, anisotropy);
	}

	private static objectKey(t: TileState): string {
		return `${t.continent.wdt}:${t.x}_${t.y}`;
	}

	private static key(gx: number, gy: number): string {
		return `${gx},${gy}`;
	}

	addContinent(continent: ContinentPlacement, farTiles: FarTile[]): void {
		for (const t of farTiles) {
			const gx = t.x + continent.offsetX;
			const gy = t.y + continent.offsetY;
			// Sea-floor tiles without an ADT get a colour close to deep water so they don't show as blocks.
			const material = createFarMaterial(t.hasAdt ? 0x5f6d48 : 0x14303f);
			const far = new THREE.Mesh(toBufferGeometry(t.geometry), material);
			far.position.set(gx * TILE_SIZE, 0, gy * TILE_SIZE);
			far.matrixAutoUpdate = false;
			far.updateMatrix();
			this.group.add(far);

			let maxHeight = -Infinity;
			for (const h of t.heights) maxHeight = Math.max(maxHeight, h);
			this.tiles.set(TerrainManager.key(gx, gy), {
				continent,
				x: t.x,
				y: t.y,
				originX: gx * TILE_SIZE,
				originZ: gy * TILE_SIZE,
				hasAdt: t.hasAdt,
				maxHeight,
				far,
				farHeights: t.heights,
				near: null,
				nearHeights: null,
				areaIds: null,
				nearLoading: false,
				distance: Infinity,
				objectLevel: 'none',
			});
		}
	}

	/** World-space bounds of all tiles, in yards. */
	bounds(): THREE.Box2 {
		const box = new THREE.Box2();
		for (const t of this.tiles.values()) {
			box.expandByPoint(new THREE.Vector2(t.originX, t.originZ));
			box.expandByPoint(new THREE.Vector2(t.originX + TILE_SIZE, t.originZ + TILE_SIZE));
		}
		return box;
	}

	/**
	 * Where to look to frame a continent: the centre of mass of its land tiles and the
	 * north-south span of the middle 90%, so stray islands don't pull the view off.
	 */
	focus(continent: ContinentPlacement): { center: THREE.Vector2; extent: number } {
		const land = [...this.tiles.values()].filter((t) => t.continent === continent && t.hasAdt);
		const center = new THREE.Vector2();
		for (const t of land) center.add(new THREE.Vector2(t.originX + TILE_SIZE / 2, t.originZ + TILE_SIZE / 2));
		center.divideScalar(Math.max(1, land.length));
		const zs = land.map((t) => t.originZ).sort((a, b) => a - b);
		const extent = zs.length ? zs[Math.floor(zs.length * 0.95)] - zs[Math.floor(zs.length * 0.05)] + TILE_SIZE : TILE_SIZE;
		return { center, extent };
	}

	/** Streams low-detail textures for every tile, nearest to the given point first. */
	async loadFarTextures(near: THREE.Vector3): Promise<void> {
		const pending = [...this.tiles.values()].filter((t) => t.hasAdt);
		this.farTexturesTotal = pending.length;
		pending.sort((a, b) => this.planarDistance(a, near) - this.planarDistance(b, near));
		const byContinent = new Map<number, TileState[]>();
		for (let i = 0; i < pending.length; i += FAR_TEXTURE_BATCH) {
			byContinent.clear();
			for (const t of pending.slice(i, i + FAR_TEXTURE_BATCH)) {
				const list = byContinent.get(t.continent.wdt) ?? [];
				list.push(t);
				byContinent.set(t.continent.wdt, list);
			}
			await Promise.all([...byContinent].map(async ([wdt, list]) => {
				const results = await this.storage.loadTileTextures(wdt, list.map((t) => [t.x, t.y]), FAR_TEXTURE_SIZE, this.compressed);
				results.forEach((r, k) => {
					if (!r.texture) return;
					const material = list[k].far.material;
					material.map = createTexture(r.texture, this.anisotropy);
					material.color.set(0xffffff);
					material.needsUpdate = true;
					this.farTexturesLoaded++;
				});
			}));
		}
	}

	private planarDistance(t: TileState, p: THREE.Vector3): number {
		const dx = Math.max(t.originX - p.x, 0, p.x - (t.originX + TILE_SIZE));
		const dz = Math.max(t.originZ - p.z, 0, p.z - (t.originZ + TILE_SIZE));
		return Math.hypot(dx, dz);
	}

	/** Chooses which tiles need full detail, loading nearest first and dropping distant ones. */
	update(camera: THREE.Vector3): void {
		const wanted: TileState[] = [];
		for (const t of this.tiles.values()) {
			if (!t.hasAdt) continue;
			const dy = Math.max(0, camera.y - t.maxHeight);
			t.distance = Math.hypot(this.planarDistance(t, camera), dy);
			if (t.near && t.distance > NEAR_DROP_DISTANCE) this.dropNear(t);
			else if (!t.near && !t.nearLoading && t.distance < NEAR_LOAD_DISTANCE) wanted.push(t);
			// Doodads wait for the detailed terrain so they sit on the right ground.
			const level: ObjectLevel = t.near ? 'all' : t.distance < WMO_DISTANCE ? 'wmo' : 'none';
			if (level !== t.objectLevel) {
				t.objectLevel = level;
				const offset = new THREE.Vector3(t.continent.offsetX * TILE_SIZE, 0, t.continent.offsetY * TILE_SIZE);
				this.objects.setTileLevel(TerrainManager.objectKey(t), t.continent.wdt, t.x, t.y, offset, level);
			}
		}
		wanted.sort((a, b) => a.distance - b.distance);
		for (const t of wanted) {
			if (this.nearInFlight >= MAX_NEAR_IN_FLIGHT) break;
			void this.loadNear(t);
		}
	}

	private async loadNear(t: TileState): Promise<void> {
		t.nearLoading = true;
		this.nearInFlight++;
		try {
			const tile = await this.storage.loadNearTile(t.continent.wdt, t.x, t.y, this.compressed);
			const sharedTextures = tile.terrain?.textures ?? [];
			const textures = await this.layerTextures.acquire(sharedTextures);
			// The camera may have moved on while this loaded.
			if (t.distance > NEAR_DROP_DISTANCE) {
				this.layerTextures.release(sharedTextures);
				return;
			}
			const near = perf.time('near.build', () => this.buildNear(tile, textures, sharedTextures));
			await this.prepare(near.object);
			t.near = near;
			t.near.object.position.set(t.originX, 0, t.originZ);
			t.near.object.updateMatrixWorld(true);
			this.group.add(t.near.object);
			t.nearHeights = tile.heights;
			t.areaIds = tile.areaIds;
			t.far.visible = false;
		} catch (e) {
			console.warn(`Tile ${t.continent.name} ${t.x}_${t.y}:`, e);
		} finally {
			t.nearLoading = false;
			this.nearInFlight--;
		}
	}

	private buildNear(tile: NearTile, textures: Map<number, THREE.Texture | null>, sharedTextures: number[]): NearState {
		const state: NearState = { object: new THREE.Group(), geometries: [], materials: [], ownTextures: [], sharedTextures };
		const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => {
			const mesh = new THREE.Mesh(geometry, material);
			mesh.matrixAutoUpdate = false;
			state.object.add(mesh);
			state.geometries.push(geometry);
			return mesh;
		};

		if (tile.terrain) {
			const alpha = createAlphaTexture(tile.terrain.alpha, ALPHA_ATLAS_SIZE);
			state.ownTextures.push(alpha);
			const geometry = toBufferGeometry(tile.terrain.geometry);
			const materials = tile.terrain.groups.map((g, i) => {
				geometry.addGroup(g.start, g.count, i);
				return createSplatMaterial(alpha, g.layers, textures);
			});
			state.materials.push(...materials);
			add(geometry, materials);
		} else if (tile.fallback) {
			const map = tile.fallback.texture ? createTexture(tile.fallback.texture, this.anisotropy) : null;
			if (map) state.ownTextures.push(map);
			const material = createFarMaterial(map ? 0xffffff : 0x5f6d48);
			material.map = map;
			state.materials.push(material);
			add(toBufferGeometry(tile.fallback.geometry), material);
		}

		for (const liquid of tile.liquids) {
			// Shared materials; drawn after the terrain so the ground shows through.
			add(liquidGeometry(liquid.positions, liquid.indices), liquidMaterials[liquid.kind]).renderOrder = 1;
		}
		return state;
	}

	private dropNear(t: TileState): void {
		if (!t.near) return;
		const near = t.near;
		this.group.remove(near.object);
		for (const g of near.geometries) g.dispose();
		for (const m of near.materials) m.dispose();
		for (const tex of near.ownTextures) tex.dispose();
		this.layerTextures.release(near.sharedTextures);
		perf.record('near.drop', 0);
		t.near = null;
		t.nearHeights = null;
		t.areaIds = null;
		t.far.visible = true;
	}
	private tileAt(x: number, z: number): TileState | undefined {
		return this.tiles.get(TerrainManager.key(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)));
	}

	/** Terrain height at a world position, from the most detailed data loaded; -Infinity off the map. */
	heightAt(x: number, z: number): number {
		const t = this.tileAt(x, z);
		if (!t) return -Infinity;
		const lx = x - t.originX;
		const lz = z - t.originZ;
		return t.nearHeights ? sampleGrid(t.nearHeights, TILE_CELLS, lx, lz) : sampleGrid(t.farHeights, WDL_CELLS, lx, lz);
	}

	/** AreaTable ID at a world position, if its tile is loaded in detail. */
	areaAt(x: number, z: number): number | null {
		const t = this.tileAt(x, z);
		if (!t?.areaIds) return null;
		const cx = THREE.MathUtils.clamp(Math.floor((x - t.originX) / (TILE_SIZE / 16)), 0, 15);
		const cy = THREE.MathUtils.clamp(Math.floor((z - t.originZ) / (TILE_SIZE / 16)), 0, 15);
		return t.areaIds[cy * 16 + cx] || null;
	}

	/** Which continent and tile a world position falls in. */
	locate(x: number, z: number): { continent: ContinentPlacement; tileX: number; tileY: number } | null {
		const t = this.tileAt(x, z);
		return t ? { continent: t.continent, tileX: t.x, tileY: t.y } : null;
	}

	stats(): TerrainStats {
		let nearTiles = 0;
		for (const t of this.tiles.values()) if (t.near) nearTiles++;
		return { farTiles: this.tiles.size, farTextures: this.farTexturesLoaded, nearTiles, nearLoading: this.nearInFlight, layerTextures: this.layerTextures.size };
	}

	get farTextureProgress(): [number, number] {
		return [this.farTexturesLoaded, this.farTexturesTotal];
	}
}
