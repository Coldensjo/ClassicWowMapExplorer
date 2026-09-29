import { parseAdtRoot, TILE_CELLS, TILE_SIZE, tileGrids } from '../formats/adt';
import { parseAdtTex } from '../formats/adtTex';
import { blpTexture, type TextureData } from '../formats/blp';
import type { LiquidKind } from '../formats/mh2o';
import { parseWdl, WDL_CELLS } from '../formats/wdl';
import { liquidKinds } from './clientDb';
import { loadAreas, loadLighting, type AreaInfo, type LightingData } from './lighting';
import { buildLiquidMeshes, type LiquidMesh } from './liquidMesh';
import type { MapExplorer } from './maps';
import { KNOWN_MAPS } from './maps';
import { loadM2, loadWmo, parsePlacements, type ModelData, type ObjectKind, type Placement } from './objects';
import { DisplayResolver, SpawnSource } from './spawns';
import { buildSplatTerrain, type SplatTerrain } from './splatMesh';
import { buildTerrainMesh, type TerrainGeometry } from './terrainMesh';

/** MPHD flags that switch alpha maps from 4-bit to 8-bit. */
const MPHD_BIG_ALPHA = 0x4 | 0x80;
/** MCNK flag: 4-bit alpha maps are already 64x64 and need no fix-up. */
const MCNK_DO_NOT_FIX_ALPHA = 0x8000;

export interface FarTile {
	x: number;
	y: number;
	/** False for WDL-only tiles (open sea floor) that have no ADT or textures. */
	hasAdt: boolean;
	geometry: TerrainGeometry;
	/** 17x17 outer heights, for height queries. */
	heights: Float32Array;
}

export interface NearTile {
	x: number;
	y: number;
	/** Texture-layered terrain, or null if the tile's _tex0 file couldn't be read. */
	terrain: SplatTerrain | null;
	/** Plain mesh with the baked map texture, used when terrain is null. */
	fallback: { geometry: TerrainGeometry; texture: TextureData | null } | null;
	/** 129x129 outer heights, for height queries. */
	heights: Float32Array;
	liquids: LiquidMesh[];
	/** AreaTable ID per chunk (y * 16 + x). */
	areaIds: Uint32Array;
}

export interface LoadedTexture {
	fdid: number;
	texture: TextureData | null;
}

export interface TileTexture {
	x: number;
	y: number;
	texture: TextureData | null;
}

/** Builds renderable terrain for the viewer, on top of the map explorer's WDT cache. */
export class WorldLoader {
	constructor(private readonly maps: MapExplorer) {}

	private get storage() {
		return this.maps.storage;
	}

	async loadFarTiles(wdtFdid: number, wdlFdid: number): Promise<FarTile[]> {
		const wdt = await this.maps.wdt(wdtFdid);
		const wdl = parseWdl(await this.storage.readFile(wdlFdid));
		return wdl.map((t) => ({
			x: t.x,
			y: t.y,
			hasAdt: wdt.tiles[t.y * 64 + t.x] !== null,
			geometry: buildTerrainMesh(t.outer, t.inner, WDL_CELLS, TILE_SIZE, null, 60),
			heights: t.outer,
		}));
	}

	/** Baked map textures, starting at the largest mip no bigger than maxSize. */
	async loadTileTextures(wdtFdid: number, coords: [number, number][], maxSize: number, compressed: boolean): Promise<TileTexture[]> {
		const wdt = await this.maps.wdt(wdtFdid);
		return Promise.all(coords.map(async ([x, y]) => ({
			x,
			y,
			texture: await this.readTexture(wdt.tiles[y * 64 + x]?.files.mapTexture ?? 0, maxSize, compressed),
		})));
	}

	async loadNearTile(wdtFdid: number, x: number, y: number, compressed: boolean): Promise<NearTile> {
		const wdt = await this.maps.wdt(wdtFdid);
		const tile = wdt.tiles[y * 64 + x];
		if (!tile) throw new Error(`Map has no tile ${x}_${y}`);
		const [rootBytes, texBytes, kindOf] = await Promise.all([
			this.storage.readFile(tile.files.root),
			tile.files.tex0 ? this.storage.readFile(tile.files.tex0).catch(() => null) : null,
			this.liquidKind(),
		]);
		const root = parseAdtRoot(rootBytes);
		const liquids = buildLiquidMeshes(root.liquids, kindOf);
		const areaIds = new Uint32Array(256);
		for (const c of root.chunks) areaIds[c.indexY * 16 + c.indexX] = c.areaId;

		if (texBytes) {
			const tex = parseAdtTex(texBytes, (wdt.flags & MPHD_BIG_ALPHA) !== 0, (i) => !(root.chunks[i]?.flags & MCNK_DO_NOT_FIX_ALPHA));
			const terrain = buildSplatTerrain(root, tex);
			return { x, y, terrain, fallback: null, heights: terrain.heights, liquids, areaIds };
		}
		const grids = tileGrids(root);
		return {
			x,
			y,
			terrain: null,
			fallback: {
				geometry: buildTerrainMesh(grids.outer, grids.inner, TILE_CELLS, TILE_SIZE, grids.holes, 30),
				texture: await this.readTexture(tile.files.mapTexture, Infinity, compressed),
			},
			heights: grids.outer,
			liquids,
			areaIds,
		};
	}

	/** M2 and WMO placements on a tile, from its _obj0 file. */
	async loadTileObjects(wdtFdid: number, x: number, y: number): Promise<Placement[]> {
		const tile = (await this.maps.wdt(wdtFdid)).tiles[y * 64 + x];
		const [placements, spawns] = await Promise.all([
			tile?.files.obj0 ? this.storage.readFile(tile.files.obj0).then(parsePlacements) : ([] as Placement[]),
			this.tileSpawns(wdtFdid, x, y),
		]);
		return placements.concat(spawns);
	}

	private readonly spawnSources = new Map<number, Promise<SpawnSource | null>>();
	private displayResolver: DisplayResolver | null = null;

	/** Created on first use, so its tables only load once spawns are shown. */
	private get displays(): DisplayResolver {
		this.displayResolver ??= new DisplayResolver(this.storage);
		return this.displayResolver;
	}

	/** Creatures and game objects on a tile, from public/spawns (empty if that data is absent). */
	private async tileSpawns(wdtFdid: number, x: number, y: number): Promise<Placement[]> {
		const mapId = KNOWN_MAPS.find((m) => m.wdt === wdtFdid)?.mapId;
		if (mapId === undefined) return [];
		let source = this.spawnSources.get(mapId);
		if (!source) {
			source = SpawnSource.load(mapId);
			this.spawnSources.set(mapId, source);
		}
		const spawns = await source;
		if (!spawns) return [];
		try {
			const [scale, reaction] = await Promise.all([this.displays.scaleLookup(), this.displays.reactionLookup()]);
			return spawns.placements(x, y, scale, reaction);
		} catch (e) {
			console.warn('Display tables unavailable; skipping spawns', e);
			return [];
		}
	}

	/** Renderable geometry for models; null where a model can't be read. */
	async loadModels(models: { fdid: number; kind: ObjectKind }[]): Promise<(ModelData | null)[]> {
		return Promise.all(models.map(async ({ fdid, kind }) => {
			try {
				if (kind === 'wmo') return await loadWmo(this.storage, fdid, await this.liquidKind());
				if (kind === 'creature') {
					const creature = await this.displays.creature(fdid);
					return creature ? { ...(await loadM2(this.storage, creature.fdid, creature.options)), fdid } : null;
				}
				if (kind === 'object') {
					// Game objects are either M2 or WMO; the file's first chunk says which.
					const file = await this.displays.object(fdid);
					if (!file) return null;
					const head = await this.storage.readFile(file);
					const isWmo = head[0] === 0x52 && head[1] === 0x45 && head[2] === 0x56 && head[3] === 0x4d; // 'REVM'
					const model = isWmo ? await loadWmo(this.storage, file, await this.liquidKind()) : await loadM2(this.storage, file);
					return { ...model, fdid };
				}
				return await loadM2(this.storage, fdid);
			} catch (e) {
				console.warn(`Model ${fdid}:`, e);
				return null;
			}
		}));
	}

	loadLighting(mapIds: number[]): Promise<LightingData> {
		return loadLighting(this.storage, mapIds);
	}

	loadAreas(): Promise<AreaInfo[]> {
		return loadAreas(this.storage);
	}

	/** Terrain layer textures at full resolution. */
	async loadTextures(fdids: number[], compressed: boolean): Promise<LoadedTexture[]> {
		return Promise.all(fdids.map(async (fdid) => ({ fdid, texture: await this.readTexture(fdid, Infinity, compressed) })));
	}

	private liquidKindPromise: Promise<(type: number) => LiquidKind> | null = null;

	private liquidKind(): Promise<(type: number) => LiquidKind> {
		this.liquidKindPromise ??= liquidKinds(this.storage);
		return this.liquidKindPromise;
	}
	private async readTexture(fdid: number, maxSize: number, compressed: boolean): Promise<TextureData | null> {
		if (fdid === 0 || this.storage.status(fdid) !== 'ok') return null;
		try {
			return blpTexture(await this.storage.readFile(fdid), maxSize, compressed);
		} catch {
			return null;
		}
	}
}
