/**
 * The .wscene format (spec 6.1-6.6): what scene.json holds. A scene contains only the user's own
 * data plus references to game files by FileDataID; game asset bytes are never stored. Units and
 * layout follow ADT, so a future ADT export stays possible (spec G9).
 */

export type Vec3 = [number, number, number];

/** Where a binary array lives in the container: a byte range of one of the .bin files. */
export interface BinRef {
	buf: string;
	offset: number;
	length: number;
}

export interface Scene {
	format: 'wscene';
	version: 2;
	/** UUID, stable across edits, import and export. */
	id: string;
	name: string;
	/** ISO dates. */
	created: string;
	modified: string;
	client: {
		/** e.g. "wow_classic_beta" (Forever beta). */
		product: string;
		/** Build name from the build config. */
		build: string;
	};
	/** 1..3 tiles each way blank, 1..6 copied. */
	size: { tilesX: number; tilesY: number };
	/** null = blank scene; set = copied scene (spec 6.5). */
	base: WorldBase | null;
	spawn: { position: Vec3; yaw: number };
	environment: {
		/** Light.db2 ID, or a built-in preset. */
		lightPreset: number;
		/** 0..2880 (half-minutes), as in WoW lighting. */
		timeOfDay: number;
		fog?: { start: number; end: number };
	};
	/** Play-mode avatar; null = default. */
	player: NpcAppearance | null;
	/** FDID palette; chunk layers index into this. */
	textures: number[];
	/** tilesX * tilesY, row-major. */
	tiles: Tile[];
	objects: PlacedObject[];
	/** Custom NPCs used in this scene (spec 6.6), copied in so the file is self-contained. */
	npcPresets: NpcPreset[];
	npcs: PlacedNpc[];
}

export interface Tile {
	x: number;
	y: number;
	/**
	 * Blank scenes: all 256 chunks, row-major (y * 16 + x).
	 * Copied scenes: null; the base map supplies the chunks.
	 */
	chunks: Chunk[] | null;
	/** Copied scenes only: edited chunks, keyed by chunk index (0..255). */
	overrides?: Record<number, ChunkOverride>;
}

export interface Chunk {
	/** Float32Array(145), absolute heights, in ADT MCVT order (rows of 9 and 8 interleaved). */
	heights: BinRef;
	/** Uint8Array(145 * 4) RGBA, like MCCV (0x7f neutral); optional. */
	vertexShade?: BinRef;
	/** 1..4 layers; layer 0 is the base and has no alpha. */
	layers: ChunkLayer[];
	/** Uint8Array(64 * 64 * (layers.length - 1)), layer-major; null when one layer. */
	alpha: BinRef | null;
	/** 64-bit hole mask as hex (16 chars): row 0's 8 cells in the first byte, bit n = cell n. */
	holes: string;
	water: WaterSettings | null;
}

/**
 * Each present field replaces that channel of the base chunk.
 * layers and alpha are always overridden together.
 * water: null = water removed; absent = base water kept.
 */
export type ChunkOverride = Partial<Chunk>;

export interface ChunkLayer {
	/** Index into scene.textures. */
	texture: number;
	/** GroundEffectTexture ID; absent = no clutter (spec 7.7). */
	effectId?: number;
	// reserved for later: flags
}

export interface WaterSettings {
	/** LiquidType.db2 ID (water, ocean, magma, slime). */
	kind: number;
	/** Flat surface height. */
	height: number;
}

export interface PlacedObject {
	/** UUID, stable across edits. */
	id: string;
	/** Copied scenes only: set when this edits a base object (spec 6.5). */
	baseKey?: string;
	kind: 'm2' | 'wmo';
	fdid: number;
	/** World yards, scene space. */
	position: Vec3;
	/** Degrees, X/Y/Z as in MDDF/MODF. */
	rotation: Vec3;
	/** M2 only; WMO = 1. */
	scale: number;
	/** WMO only. */
	doodadSet?: number;
	/** WMO only. */
	nameSet?: number;
	locked?: boolean;
	/** Editor grouping label. */
	group?: string;
}

/** A copied scene's source: a reference to the map plus the user's removals (spec 6.5). */
export interface WorldBase {
	/** Map.db2 ID. */
	mapId: number;
	/** Map.db2 directory, for messages and checks. */
	mapDirectory: string;
	/** First source ADT tile (x, y). */
	tileMin: [number, number];
	/** Last source ADT tile, inclusive; max 6x6. */
	tileMax: [number, number];
	/** Build the copy was made from. */
	build: string;
	/** Copy options (spec 7.2). */
	includeDoodads: boolean;
	includeWmos: boolean;
	/** baseKeys of copied objects the user deleted. */
	removedObjects: string[];
}

/** How an NPC or the player avatar looks. */
export type NpcAppearance =
	| { kind: 'creature'; displayId: number } // CreatureDisplayInfo ID (spec 7.9.2)
	| { kind: 'custom'; presetId: string }; // NpcPreset in scene.npcPresets

export interface NpcPreset {
	/** UUID. */
	id: string;
	/** Preset label, e.g. "Stormwind Guard (custom)". */
	name: string;
	/** ChrRaces ID. */
	race: number;
	sex: 0 | 1;
	/** e.g. skin, face, hair style, hair color. */
	customization: Record<string, number>;
	/** ItemDisplayInfo ID per slot. */
	equipment: Partial<Record<EquipSlot, number>>;
}

export type EquipSlot =
	| 'head' | 'shoulder' | 'back' | 'chest' | 'shirt' | 'tabard'
	| 'wrist' | 'hands' | 'waist' | 'legs' | 'feet'
	| 'mainHand' | 'offHand' | 'ranged';

export interface PlacedNpc {
	/** UUID, stable across edits. */
	id: string;
	appearance: NpcAppearance;
	/** Shown on the nameplate in play mode. */
	name?: string;
	/** e.g. "<Innkeeper>". */
	subName?: string;
	/** Scene space. */
	position: Vec3;
	/** Degrees. */
	facing: number;
	/** Default 1. */
	scale: number;
	/** MVP: idle only; reserved for later behaviors. */
	animation: 'idle';
	locked?: boolean;
	group?: string;
}

/** Blank scenes: 1x1 to 3x3 tiles; copied scenes: up to 6x6 (spec 6, Q3). */
export const MAX_BLANK_TILES = 3;
export const MAX_COPIED_TILES = 6;
/** The format version this code writes; loaders migrate every older one (spec 6.4). */
export const SCENE_VERSION = 2;
