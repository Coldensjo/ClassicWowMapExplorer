import type { ProductInfo } from '../casc/config';
import type { FileStatus, StorageStats } from '../casc/storage';
import type { ClutterEffect } from '../explorer/groundEffects';
import type { AreaInfo, LightingData } from '../explorer/lighting';
import type { MapSummary } from '../explorer/maps';
import type { LiquidLooks } from '../explorer/clientDb';
import type { WmoArea } from '../explorer/wmoArea';
import type { Place } from '../explorer/places';
import type { WorldMapInfo } from '../explorer/worldMap';
import type { ModelData, ModelKind, Placement } from '../explorer/objects';
import type { CharacterModelInfo, CreatureDisplaySummary, CustomizationOption, GearDisplay, HumanoidPreset } from '../explorer/npcs';
import type { NpcPreset } from '../scene/types';
import type { CopyMap, CopyTile } from '../explorer/copyWorld';
import type { CharacterModel, FarTile, InstanceMap, LoadedTexture, MapListing, NearTile, PlayerLook, TileTexture } from '../explorer/world';
import type { CharacterOutfit, CharacterRace } from '../explorer/display';
import type { Image } from '../formats/blp';

export type SourceInit =
	| { kind: 'files'; files: { path: string; file: File }[] }
	/** The install the portable launcher or dev server found, served at this URL (ending in '/'). */
	| { kind: 'http'; base: string };

/** Methods the storage worker exposes; every call is async across the worker boundary. */
export interface StorageApi {
	/** Where the page is served from, for files beside it (the worker's own URL is under assets/). */
	setPageUrl(url: string): void;
	setSource(source: SourceInit): ProductInfo[];
	open(product: string): StorageStats;
	loadMap(wdtFdid: number): MapSummary;
	minimapThumbnails(wdtFdid: number, coords: [number, number][], size: number): { x: number; y: number; image: Image | null }[];
	loadFarTiles(wdtFdid: number, wdlFdid: number): FarTile[];
	loadInstance(mapId: number): InstanceMap | null;
	listMaps(): MapListing[];
	loadTileTextures(wdtFdid: number, coords: [number, number][], maxSize: number, compressed: boolean): TileTexture[];
	loadNearTile(wdtFdid: number, x: number, y: number, compressed: boolean): NearTile;
	loadTextures(fdids: number[], compressed: boolean): LoadedTexture[];
	loadTileObjects(wdtFdid: number, x: number, y: number): Placement[];
	/** Maps a scene can copy from: a readable WDT with at least one ADT tile (spec 7.2). */
	listCopyMaps(): CopyMap[];
	/** One source tile's terrain, water and placements for Copy from world (spec 6.5). */
	loadCopyTile(wdtFdid: number, x: number, y: number): CopyTile;
	/** Models to draw; NPCs by creature display ID ('creature') or preset handle ('npcPreset', see defineNpcPreset). */
	loadModels(models: { fdid: number; kind: ModelKind }[]): (ModelData | null)[];
	/** Every creature display with a model, for the NPCs tab (spec 7.9.2). */
	listCreatureDisplays(): CreatureDisplaySummary[];
	/** The playable race and sex models the custom NPC editor can dress (spec 7.9.3). */
	characterModels(): CharacterModelInfo[];
	/** A race and sex's customization options and choices (spec 7.9.3). */
	customizationOptions(race: number, sex: number): CustomizationOption[];
	/** The gear browser's item displays per slot, named where the client names them (Q8). */
	gearDisplays(): GearDisplay[];
	/** Names of the item displays given, null where unnamed. */
	gearNames(displays: number[]): (string | null)[];
	/** A humanoid display as preset fields for "Customize as new" (Q9), or null. */
	humanoidPreset(displayId: number): HumanoidPreset | null;
	/** Defines a custom preset under a handle, for loadModels kind 'npcPreset'. */
	defineNpcPreset(handle: number, preset: NpcPreset): void;
	/** The walking character: the races it can be, and one dressed as a look with the clips given. */
	characterRaces(): CharacterRace[];
	loadCharacter(race: number, sex: number, hd: boolean, look: number, clips: number[], outfit: CharacterOutfit | null, torch: boolean): CharacterModel | null;
	/** The play-mode avatar (spec 7.10): a creature display or preset handle dressed as an NPC is, animated with the clips given. */
	loadPlayerModel(look: PlayerLook, clips: number[]): ModelData | null;
	loadLighting(mapIds: number[]): LightingData;
	loadAreas(): AreaInfo[];
	loadLiquidLooks(): LiquidLooks;
	loadPlaces(): Place[];
	wmoArea(wmoId: number, nameSet: number, groupId: number): WmoArea | null;
	loadFont(fdid: number): Uint8Array;
	loadInterfaceImages(paths: string[]): (Image | null)[];
	loadImages(fdids: number[]): (Image | null)[];
	/** Every map with a readable WDT, for the ground effect scan (spec 7.7.2). */
	scanMaps(): { id: number; name: string; wdt: number }[];
	/** Scans a slice of one map's _tex0 ADTs for (texture, effect, count) triples (spec 7.7.2). */
	scanMapGroundEffects(wdtFdid: number, offset: number, count: number): { pairs: [number, number, number][]; next: number | null };
	/** What each GroundEffectTexture scatters, for the editor's clutter (spec 7.7.1). */
	clutterEffects(ids: number[]): (ClutterEffect | null)[];
	/** Images decoded at the mip closest to maxSize, for asset-browser thumbnails (spec 7.3). */
	loadThumbnails(fdids: number[], maxSize: number): (Image | null)[];
	/** Whether each file's data is really in the local install ('not-local' shows greyed, spec 7.1). */
	fileStatus(fdids: number[]): FileStatus[];
	textureOpacity(fdids: number[]): number[];
	loadWorldMaps(mapIds: number[]): WorldMapInfo[];
}

export type AsyncStorageApi = {
	[K in keyof StorageApi]: (...args: Parameters<StorageApi[K]>) => Promise<ReturnType<StorageApi[K]>>;
};

export type Request = { id: number; method: keyof StorageApi; args: unknown[] };

export type Response =
	| { id: number; result: unknown }
	| { id: number; error: string }
	| { id: -1; progress: string }
	/** The game was updated since the storage was opened: reads fail until the page is reloaded. */
	| { id: -1; changed: true };
