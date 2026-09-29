import type { ProductInfo } from '../casc/config';
import type { StorageStats } from '../casc/storage';
import type { AreaInfo, LightingData } from '../explorer/lighting';
import type { MapSummary, TileDetails } from '../explorer/maps';
import type { MusicData, WmoArea } from '../explorer/music';
import type { ModelData, ObjectKind, Placement } from '../explorer/objects';
import type { FarTile, LoadedTexture, NearTile, TileTexture } from '../explorer/world';
import type { Image } from '../formats/blp';

export type SourceInit =
	| { kind: 'handle'; handle: FileSystemDirectoryHandle }
	| { kind: 'files'; files: { path: string; file: File }[] };

/** Methods the storage worker exposes; every call is async across the worker boundary. */
export interface StorageApi {
	setSource(source: SourceInit): ProductInfo[];
	open(product: string): StorageStats;
	loadMap(wdtFdid: number): MapSummary;
	loadTile(wdtFdid: number, x: number, y: number): TileDetails;
	minimapThumbnails(wdtFdid: number, coords: [number, number][], size: number): { x: number; y: number; image: Image | null }[];
	loadFarTiles(wdtFdid: number, wdlFdid: number): FarTile[];
	loadTileTextures(wdtFdid: number, coords: [number, number][], maxSize: number, compressed: boolean): TileTexture[];
	loadNearTile(wdtFdid: number, x: number, y: number, compressed: boolean): NearTile;
	loadTextures(fdids: number[], compressed: boolean): LoadedTexture[];
	loadTileObjects(wdtFdid: number, x: number, y: number): Placement[];
	loadModels(models: { fdid: number; kind: ObjectKind; variant?: string }[]): (ModelData | null)[];
	loadLighting(mapIds: number[]): LightingData;
	loadAreas(): AreaInfo[];
	loadMusic(): MusicData;
	wmoArea(wmoId: number, nameSet: number, groupId: number): WmoArea | null;
	loadSound(fdid: number): Uint8Array;
}

export type AsyncStorageApi = {
	[K in keyof StorageApi]: (...args: Parameters<StorageApi[K]>) => Promise<ReturnType<StorageApi[K]>>;
};

export type Request = { id: number; method: keyof StorageApi; args: unknown[] };

export type Response =
	| { id: number; result: unknown }
	| { id: number; error: string }
	| { id: -1; progress: string };
