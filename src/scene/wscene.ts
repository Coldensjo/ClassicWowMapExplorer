import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { CopyTile } from '../explorer/copyWorld';
import { CHUNK_HEIGHTS, CHUNKS_PER_TILE } from '../formats/adt';
import { ALPHA_SIZE } from '../formats/adtTex';
import { baseObjectsFromCopy, baseTileFromCopy, cloneChunk, composeObjects, matchesTemplate } from './copyScene';
import { sameWater, SceneModel, type SceneBaseData, type SceneChunk, type SceneTile, type SceneWater } from './sceneModel';
import { MAX_SCENE_TILES, SCENE_VERSION, SCENE_WEATHERS, type BinRef, type Chunk, type ChunkLayer, type ChunkOverride, type EquipSlot, type NpcAppearance, type NpcPreset, type PlacedNpc, type PlacedObject, type Scene, type Tile, type Vec3, type WaterSettings } from './types';
import { isNpcPose } from './npcPoses';

/**
 * The .wscene container (spec 6.2): a zip holding scene.json plus the binary arrays it references
 * and a thumbnail. Loaders accept only these files, so the same validation can later run on a
 * server (spec 14.1).
 */
const CONTAINER_FILES = ['scene.json', 'heights.bin', 'alpha.bin', 'shade.bin', 'thumbnail.webp'] as const;

const CHUNK_COUNT = CHUNKS_PER_TILE * CHUNKS_PER_TILE;
const HEIGHTS_BYTES = CHUNK_HEIGHTS * 4;
const SHADE_BYTES = CHUNK_HEIGHTS * 4;
const ALPHA_BYTES = ALPHA_SIZE * ALPHA_SIZE;

/** Grows a byte stream and hands out BinRefs into it. */
class BinWriter {
	private readonly parts: Uint8Array[] = [];
	private offset = 0;

	constructor(private readonly buf: string) {}

	add(bytes: Uint8Array): BinRef {
		this.parts.push(bytes);
		const ref: BinRef = { buf: this.buf, offset: this.offset, length: bytes.length };
		this.offset += bytes.length;
		return ref;
	}

	bytes(): Uint8Array {
		const all = new Uint8Array(this.offset);
		let at = 0;
		for (const p of this.parts) {
			all.set(p, at);
			at += p.length;
		}
		return all;
	}
}

function holesToHex(holes: Uint8Array): string {
	return [...holes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function holesFromHex(hex: string): Uint8Array {
	if (!/^[0-9a-fA-F]{16}$/.test(hex)) throw new Error(`Bad hole mask "${hex}"`);
	return new Uint8Array(Array.from({ length: 8 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
}

// ---- Byte-for-byte channel comparisons, for the save-time sweep (spec 6.5) ----

function sameF32(a: Float32Array, b: Float32Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameU8(a: Uint8Array | null, b: Uint8Array | null): boolean {
	if (!a || !b) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameLayers(a: ChunkLayer[], b: ChunkLayer[]): boolean {
	return a.length === b.length && a.every((l, i) => l.texture === b[i].texture && l.effectId === b[i].effectId);
}

/** Serializes a scene to .wscene bytes. The thumbnail is a 512x288 WebP render, when one is given. */
export function encodeScene(model: SceneModel, thumbnail: Uint8Array | null = null): Uint8Array {
	const heights = new BinWriter('heights.bin');
	const alpha = new BinWriter('alpha.bin');
	const shade = new BinWriter('shade.bin');

	const checkPaint = (c: SceneChunk): void => {
		if (c.layers.length < 1 || c.layers.length > 4) throw new Error(`A chunk has ${c.layers.length} texture layers`);
		const expectAlpha = (c.layers.length - 1) * ALPHA_BYTES;
		if ((c.alpha?.length ?? 0) !== expectAlpha) throw new Error(`A chunk with ${c.layers.length} layers has ${c.alpha?.length ?? 0} alpha bytes, expected ${expectAlpha}`);
	};
	const heightBytes = (c: SceneChunk): Uint8Array => new Uint8Array(c.heights.buffer, c.heights.byteOffset, c.heights.byteLength);
	const waterOut = (water: SceneWater): WaterSettings => ({ kind: water.kind, height: water.height, coverage: holesToHex(water.coverage) });

	const encodeChunk = (c: SceneChunk): Chunk => {
		checkPaint(c);
		return {
			heights: heights.add(heightBytes(c)),
			...(c.vertexShade ? { vertexShade: shade.add(c.vertexShade) } : {}),
			layers: c.layers,
			alpha: c.alpha ? alpha.add(c.alpha) : null,
			holes: holesToHex(c.holes),
			water: c.water ? waterOut(c.water) : null,
		};
	};

	/** The channels of a working chunk that differ from its base, or null for none (spec 6.5). */
	const encodeOverride = (c: SceneChunk, b: SceneChunk): ChunkOverride | null => {
		const o: ChunkOverride = {};
		if (!sameF32(c.heights, b.heights)) o.heights = heights.add(heightBytes(c));
		if (c.vertexShade && !sameU8(c.vertexShade, b.vertexShade)) o.vertexShade = shade.add(c.vertexShade);
		// Layers and alpha are always overridden together (spec 6.1).
		if (!sameLayers(c.layers, b.layers) || !sameU8(c.alpha, b.alpha)) {
			checkPaint(c);
			o.layers = c.layers;
			o.alpha = c.alpha ? alpha.add(c.alpha) : null;
		}
		if (!sameU8(c.holes, b.holes)) o.holes = holesToHex(c.holes);
		if (!sameWater(c.water, b.water)) o.water = c.water ? waterOut(c.water) : null;
		return Object.keys(o).length ? o : null;
	};

	let tiles: Tile[];
	let base = model.meta.base;
	let objects = model.objects;
	if (model.baseData && base) {
		// A copied scene saves only its diffs: the sweep compares each touched chunk to the base
		// and writes the channels that differ, so edits undone back to base don't bloat the file.
		const baseData = model.baseData;
		tiles = model.tiles.map((tile, tileIndex) => {
			const touched = model.touchedChunks.get(tileIndex);
			const overrides: Record<number, ChunkOverride> = {};
			let any = false;
			if (touched) {
				const ids = touched === 'all' ? tile.chunks.map((_, i) => i) : [...touched];
				for (const id of ids) {
					const override = encodeOverride(tile.chunks[id], baseData.tiles[tileIndex].chunks[id]);
					if (override) {
						overrides[id] = override;
						any = true;
					}
				}
			}
			return { x: tile.x, y: tile.y, chunks: null, ...(any ? { overrides } : {}) };
		});
		// Objects: an entry still matching its base object is dropped; a base object with no entry
		// at all was deleted, and its key goes to removedObjects (spec 6.5).
		const templates = new Map(baseData.objects.map((t) => [t.baseKey, t]));
		objects = model.objects.filter((o) => {
			if (!o.baseKey) return true;
			const t = templates.get(o.baseKey);
			return !t || !matchesTemplate(o, t);
		});
		const present = new Set(model.objects.map((o) => o.baseKey));
		base = { ...base, removedObjects: baseData.objects.filter((t) => !present.has(t.baseKey)).map((t) => t.baseKey) };
	} else {
		tiles = model.tiles.map((tile) => ({ x: tile.x, y: tile.y, chunks: tile.chunks.map(encodeChunk) }));
	}

	// Only presets an NPC (or the player) wears travel with the scene (spec 6.6).
	model.pruneUnusedPresets();
	const scene: Scene = {
		format: 'wscene',
		version: SCENE_VERSION,
		...model.meta,
		base,
		textures: model.textures,
		tiles,
		objects,
		npcPresets: model.npcPresets,
		npcs: model.npcs,
	};

	const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
		'scene.json': [strToU8(JSON.stringify(scene)), { level: 6 }],
		'heights.bin': [heights.bytes(), { level: 6 }],
		'alpha.bin': [alpha.bytes(), { level: 6 }],
	};
	const shadeBytes = shade.bytes();
	if (shadeBytes.length) files['shade.bin'] = [shadeBytes, { level: 6 }];
	if (thumbnail) files['thumbnail.webp'] = [thumbnail, { level: 0 }];
	return zipSync(files);
}

export interface DecodedScene {
	model: SceneModel;
	thumbnail: Uint8Array | null;
	/** Copied scenes: stored object edits whose base object the source no longer lists, dropped (spec 6.5). */
	missingObjects: number;
}

/** A .wscene container opened but not yet turned into a model, so callers can look at scene.base first. */
export interface SceneFile {
	scene: Scene;
	files: Record<string, Uint8Array>;
	thumbnail: Uint8Array | null;
}

/** Unzips and validates the container and the scene.json version, migrating older versions. */
export function readSceneFile(bytes: Uint8Array): SceneFile {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch (e) {
		throw new Error(`Not a .wscene file: ${e instanceof Error ? e.message : e}`);
	}
	for (const name of Object.keys(files)) {
		if (!(CONTAINER_FILES as readonly string[]).includes(name)) throw new Error(`Not a .wscene file: it contains "${name}"`);
	}
	if (!files['scene.json']) throw new Error('Not a .wscene file: scene.json is missing');

	let scene: Scene;
	try {
		scene = JSON.parse(strFromU8(files['scene.json'])) as Scene;
	} catch (e) {
		throw new Error(`scene.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
	}
	if (scene.format !== 'wscene') throw new Error('Not a scene: scene.json has no wscene marker');
	if (!Number.isInteger(scene.version) || scene.version < 1) throw new Error('Not a scene: bad version');
	if (scene.version > SCENE_VERSION) {
		throw new Error(`This scene was made with a newer version of the builder (format ${scene.version}; this build reads up to ${SCENE_VERSION}). Update to open it.`);
	}
	migrate(scene);
	return { scene, files, thumbnail: files['thumbnail.webp'] ?? null };
}

/**
 * The same container under a fresh id, name and dates, for duplicating a saved scene without
 * decoding it (a copied scene would need its source map for that).
 */
export function copySceneFile(file: SceneFile, name: string): Uint8Array {
	const now = new Date().toISOString();
	const scene: Scene = { ...file.scene, id: crypto.randomUUID(), name, created: now, modified: now };
	return zipSync({ ...file.files, 'scene.json': strToU8(JSON.stringify(scene)) });
}

/**
 * The same container renamed in place, keeping its id, so a saved scene renames without being
 * decoded (a copied one would need its source map for that). `modified` is the new stamp.
 */
export function renameSceneFile(file: SceneFile, name: string, modified: string): Uint8Array {
	const scene: Scene = { ...file.scene, name, modified };
	return zipSync({ ...file.files, 'scene.json': strToU8(JSON.stringify(scene)) });
}

/**
 * Reads .wscene bytes back into a SceneModel, refusing anything but a valid container. A copied
 * scene needs its source tiles loaded first (readSceneFile says whether scene.base is set), passed
 * here row-major over the base rectangle.
 */
export function decodeScene(bytes: Uint8Array, copyTiles?: CopyTile[]): DecodedScene {
	return decodeFile(readSceneFile(bytes), copyTiles);
}

/** Turns an opened container into a model; see decodeScene. */
export function decodeFile(file: SceneFile, copyTiles?: CopyTile[]): DecodedScene {
	const { model, missingObjects } = toModel(file.scene, file.files, copyTiles);
	return { model, thumbnail: file.thumbnail, missingObjects };
}

/** Brings an older scene.json up to the current version, step by step (spec 6.4). */
function migrate(scene: Omit<Scene, 'version'> & { version: number }): void {
	if (scene.version === 1) {
		scene.base = null;
		scene.player = null;
		scene.npcPresets = [];
		scene.npcs = [];
		scene.version = 2;
	}
}

function toModel(scene: Scene, files: Record<string, Uint8Array>, copyTiles?: CopyTile[]): { model: SceneModel; missingObjects: number } {
	const { tilesX, tilesY } = scene.size ?? {};
	if (!Number.isInteger(tilesX) || !Number.isInteger(tilesY) || tilesX < 1 || tilesY < 1 || tilesX > MAX_SCENE_TILES || tilesY > MAX_SCENE_TILES) {
		throw new Error(`Bad scene size ${tilesX}x${tilesY}`);
	}
	if (!Array.isArray(scene.tiles) || scene.tiles.length !== tilesX * tilesY) {
		throw new Error(`The scene says ${tilesX}x${tilesY} tiles but holds ${scene.tiles?.length ?? 0}`);
	}
	if (!Array.isArray(scene.textures) || !scene.textures.every((t) => Number.isInteger(t) && t >= 0)) throw new Error('Bad texture palette');

	const read = (ref: BinRef, expected: number, what: string): Uint8Array => {
		const file = files[ref?.buf];
		if (!file) throw new Error(`${what} points at missing file "${ref?.buf}"`);
		if (!Number.isInteger(ref.offset) || ref.offset < 0 || ref.length !== expected || ref.offset + ref.length > file.length) {
			throw new Error(`${what} has a bad range ${ref.offset}+${ref.length} of ${file.length}`);
		}
		return file.slice(ref.offset, ref.offset + ref.length);
	};
	const readHeights = (ref: BinRef, what: string): Float32Array => {
		const bytes = read(ref, HEIGHTS_BYTES, what);
		const heights = new Float32Array(bytes.buffer, bytes.byteOffset, CHUNK_HEIGHTS);
		if (!heights.every(Number.isFinite)) throw new Error(`${what.replace(/ heights$/, '')} has non-finite heights`);
		return heights;
	};
	const checkLayers = (layers: ChunkLayer[], what: string): void => {
		if (!Array.isArray(layers) || layers.length < 1 || layers.length > 4) throw new Error(`${what} has ${layers?.length ?? 0} texture layers`);
		for (const layer of layers) {
			if (!Number.isInteger(layer.texture) || layer.texture < 0 || layer.texture >= scene.textures.length) {
				throw new Error(`${what} paints texture ${layer.texture}, outside the palette of ${scene.textures.length}`);
			}
		}
	};
	const readWater = (water: WaterSettings, what: string): SceneWater => {
		if (!(Number.isInteger(water?.kind) && Number.isFinite(water?.height))) throw new Error(`${what} has bad water settings`);
		// Scenes written before the v0.4 coverage mask carry none: water covers the chunk.
		return { kind: water.kind, height: water.height, coverage: water.coverage ? holesFromHex(water.coverage) : new Uint8Array(8).fill(0xff) };
	};

	const meta = {
		id: scene.id,
		name: scene.name,
		created: scene.created,
		modified: scene.modified,
		client: scene.client,
		size: scene.size,
		base: scene.base,
		spawn: scene.spawn,
		environment: readEnvironment(scene.environment),
		player: scene.player,
	};

	if (!scene.base) {
		const tiles: SceneTile[] = scene.tiles.map((tile, index) => {
			if (tile.x !== index % tilesX || tile.y !== Math.floor(index / tilesX)) throw new Error(`Tile ${index} is out of order`);
			if (!Array.isArray(tile.chunks) || tile.chunks.length !== CHUNK_COUNT) {
				throw new Error(`Tile ${tile.x}_${tile.y} holds ${tile.chunks?.length ?? 0} chunks, expected ${CHUNK_COUNT}`);
			}
			const chunks = tile.chunks.map((c, i): SceneChunk => {
				const what = `Tile ${tile.x}_${tile.y} chunk ${i}`;
				checkLayers(c.layers, what);
				const expectAlpha = (c.layers.length - 1) * ALPHA_BYTES;
				if (expectAlpha === 0 && c.alpha) throw new Error(`${what} has one layer but an alpha map`);
				if (expectAlpha > 0 && !c.alpha) throw new Error(`${what} has ${c.layers.length} layers but no alpha map`);
				return {
					heights: readHeights(c.heights, `${what} heights`),
					vertexShade: c.vertexShade ? read(c.vertexShade, SHADE_BYTES, `${what} shading`) : null,
					layers: c.layers,
					alpha: c.alpha ? read(c.alpha, expectAlpha, `${what} alpha`) : null,
					holes: holesFromHex(c.holes),
					water: c.water ? readWater(c.water, what) : null,
				};
			});
			return { x: tile.x, y: tile.y, chunks };
		});

		const presets = validPresets(scene.npcPresets ?? []);
		const model = new SceneModel(meta, scene.textures, tiles, validObjects(scene.objects ?? []), presets, validNpcs(scene.npcs ?? [], presets));
		return { model, missingObjects: 0 };
	}

	// A copied scene (spec 6.5): rebuild the base from the source tiles, then lay the overrides,
	// removals and object edits on top.
	const base = scene.base;
	const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < 64);
	if (!Number.isInteger(base.mapId) || base.mapId < 0 || typeof base.mapDirectory !== 'string' || !pair(base.tileMin) || !pair(base.tileMax)) {
		throw new Error('Bad world base');
	}
	if (base.tileMax[0] - base.tileMin[0] + 1 !== tilesX || base.tileMax[1] - base.tileMin[1] + 1 !== tilesY) {
		throw new Error('The world base rectangle does not match the scene size');
	}
	if (!Array.isArray(base.removedObjects) || !base.removedObjects.every((k) => typeof k === 'string')) throw new Error('Bad removed object list');
	if (!copyTiles) throw new Error('This scene is a world copy; its source tiles must be read first');
	if (copyTiles.length !== tilesX * tilesY) throw new Error(`The world base covers ${tilesX * tilesY} tiles but ${copyTiles.length} were read`);

	const textureIndex = (fdid: number): number => {
		const index = scene.textures.indexOf(fdid);
		if (index >= 0) return index;
		scene.textures.push(fdid);
		return scene.textures.length - 1;
	};
	const baseTiles = copyTiles.map((copy) => baseTileFromCopy(copy, textureIndex));
	const baseData: SceneBaseData = { tiles: baseTiles, objects: baseObjectsFromCopy(copyTiles, base) };

	const touched = new Map<number, Set<number>>();
	const tiles: SceneTile[] = scene.tiles.map((tile, index) => {
		if (tile.x !== index % tilesX || tile.y !== Math.floor(index / tilesX)) throw new Error(`Tile ${index} is out of order`);
		if (tile.chunks) throw new Error(`Tile ${tile.x}_${tile.y} of a copied scene holds full chunks`);
		const chunks = baseTiles[index].chunks.map(cloneChunk);
		for (const [key, override] of Object.entries(tile.overrides ?? {})) {
			const id = Number(key);
			if (!Number.isInteger(id) || id < 0 || id >= CHUNK_COUNT) throw new Error(`Tile ${tile.x}_${tile.y} overrides chunk "${key}"`);
			const what = `Tile ${tile.x}_${tile.y} chunk ${id} override`;
			const chunk = chunks[id];
			if (override.heights) chunk.heights = readHeights(override.heights, `${what} heights`);
			if (override.vertexShade) chunk.vertexShade = read(override.vertexShade, SHADE_BYTES, `${what} shading`);
			if (override.layers) {
				checkLayers(override.layers, what);
				const expectAlpha = (override.layers.length - 1) * ALPHA_BYTES;
				if (expectAlpha === 0 && override.alpha) throw new Error(`${what} has one layer but an alpha map`);
				if (expectAlpha > 0 && !override.alpha) throw new Error(`${what} has ${override.layers.length} layers but no alpha map`);
				chunk.layers = override.layers;
				chunk.alpha = override.alpha ? read(override.alpha, expectAlpha, `${what} alpha`) : null;
			} else if (override.alpha) {
				throw new Error(`${what} has an alpha map without its layers`);
			}
			if (override.holes !== undefined) chunk.holes = holesFromHex(override.holes);
			if ('water' in override) chunk.water = override.water ? readWater(override.water, what) : null;
			let set = touched.get(index);
			if (!set) touched.set(index, (set = new Set()));
			set.add(id);
		}
		return { x: tile.x, y: tile.y, chunks };
	});

	const { objects, missing } = composeObjects(validObjects(scene.objects ?? []), baseData.objects, base.removedObjects);
	const presets = validPresets(scene.npcPresets ?? []);
	const model = new SceneModel(meta, scene.textures, tiles, objects, presets, validNpcs(scene.npcs ?? [], presets), baseData);
	// Loaded overrides count as touched, so the next save's sweep re-checks them (spec 6.5).
	for (const [index, set] of touched) model.touchedChunks.set(index, set);
	return { model, missingObjects: missing };
}

const EQUIP_SLOTS: EquipSlot[] = ['head', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist', 'hands', 'waist', 'legs', 'feet', 'mainHand', 'offHand', 'ranged'];

/** The scene's environment (spec 6.1) with what's missing or malformed put back to the defaults, so an odd file still opens. */
export function readEnvironment(environment: Partial<Scene['environment']> | undefined): Scene['environment'] {
	const e = environment ?? {};
	const out: Scene['environment'] = {
		lightPreset: Number.isInteger(e.lightPreset) && e.lightPreset! >= 0 ? e.lightPreset! : 0,
		timeOfDay: Number.isFinite(e.timeOfDay) ? ((Math.round(e.timeOfDay!) % 2880) + 2880) % 2880 : 1440,
	};
	if (e.fog && Number.isFinite(e.fog.start) && Number.isFinite(e.fog.end)) out.fog = { start: e.fog.start, end: e.fog.end };
	if (e.fogOn === false) out.fogOn = false;
	if (e.weather && SCENE_WEATHERS.includes(e.weather)) out.weather = e.weather;
	return out;
}

/** Checks the embedded custom NPC presets (spec 6.6) and keeps only the fields the format defines. */
export function validPresets(presets: NpcPreset[]): NpcPreset[] {
	if (!Array.isArray(presets)) throw new Error('Bad NPC preset list');
	const seen = new Set<string>();
	return presets.map((p, i) => {
		const what = `NPC preset ${i}`;
		if (typeof p?.id !== 'string' || !p.id || seen.has(p.id)) throw new Error(`${what} has a missing or repeated id`);
		seen.add(p.id);
		if (!Number.isInteger(p.race) || p.race <= 0) throw new Error(`${what} has a bad race`);
		if (p.sex !== 0 && p.sex !== 1) throw new Error(`${what} has a bad sex`);
		const customization: Record<string, number> = {};
		for (const [option, choice] of Object.entries(p.customization ?? {})) {
			if (!/^\d+$/.test(option) || !Number.isInteger(choice) || choice < 0) throw new Error(`${what} has a bad customization choice`);
			customization[option] = choice;
		}
		const equipment: Partial<Record<EquipSlot, number>> = {};
		for (const [slot, display] of Object.entries(p.equipment ?? {})) {
			if (!EQUIP_SLOTS.includes(slot as EquipSlot)) throw new Error(`${what} dresses an unknown slot "${slot}"`);
			if (!Number.isInteger(display) || display <= 0) throw new Error(`${what} has a bad item display in ${slot}`);
			equipment[slot as EquipSlot] = display;
		}
		return { id: p.id, name: typeof p.name === 'string' ? p.name : '', ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}), race: p.race, sex: p.sex, customization, equipment };
	});
}

/** Checks placed NPCs (spec 7.9): custom ones must wear a preset embedded in the scene. */
export function validNpcs(npcs: PlacedNpc[], presets: NpcPreset[]): PlacedNpc[] {
	if (!Array.isArray(npcs)) throw new Error('Bad NPC list');
	const presetIds = new Set(presets.map((p) => p.id));
	const seen = new Set<string>();
	return npcs.map((n, i) => {
		const what = `NPC ${i}`;
		if (typeof n?.id !== 'string' || !n.id || seen.has(n.id)) throw new Error(`${what} has a missing or repeated id`);
		seen.add(n.id);
		const a = n.appearance as NpcAppearance | undefined;
		let appearance: NpcAppearance;
		if (a?.kind === 'creature' && Number.isInteger(a.displayId) && a.displayId > 0) appearance = { kind: 'creature', displayId: a.displayId };
		else if (a?.kind === 'custom' && typeof a.presetId === 'string' && presetIds.has(a.presetId)) appearance = { kind: 'custom', presetId: a.presetId };
		else throw new Error(`${what} has a bad appearance`);
		if (!Array.isArray(n.position) || n.position.length !== 3 || !n.position.every(Number.isFinite)) throw new Error(`${what} has a bad position`);
		if (!Number.isFinite(n.facing)) throw new Error(`${what} has a bad facing`);
		if (!Number.isFinite(n.scale) || n.scale <= 0) throw new Error(`${what} has a bad scale`);
		return {
			id: n.id,
			appearance,
			...(typeof n.name === 'string' && n.name ? { name: n.name } : {}),
			...(typeof n.subName === 'string' && n.subName ? { subName: n.subName } : {}),
			position: [n.position[0], n.position[1], n.position[2]],
			facing: n.facing,
			scale: n.scale,
			animation: 'idle',
			...(Number.isInteger(n.idle) && n.idle! > 0 ? { idle: n.idle } : {}),
			...(isNpcPose(n.pose) ? { pose: n.pose } : {}),
			...(n.locked === true ? { locked: true } : {}),
			...(typeof n.group === 'string' && n.group ? { group: n.group } : {}),
		};
	});
}

/** Checks placed objects (spec 7.8) and keeps only the fields the format defines. */
function validObjects(objects: PlacedObject[]): PlacedObject[] {
	if (!Array.isArray(objects)) throw new Error('Bad placed object list');
	const seen = new Set<string>();
	const vec3 = (v: Vec3, what: string): Vec3 => {
		if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`${what} has a bad vector`);
		return [v[0], v[1], v[2]];
	};
	return objects.map((o, i) => {
		const what = `Placed object ${i}`;
		if (typeof o?.id !== 'string' || !o.id || seen.has(o.id)) throw new Error(`${what} has a missing or repeated id`);
		seen.add(o.id);
		if (o.kind !== 'm2' && o.kind !== 'wmo') throw new Error(`${what} has kind "${o.kind}"`);
		if (!Number.isInteger(o.fdid) || o.fdid <= 0) throw new Error(`${what} has a bad file ID`);
		if (!Number.isFinite(o.scale) || o.scale <= 0) throw new Error(`${what} has a bad scale`);
		const sets = (value: number | undefined, name: string): number | undefined => {
			if (value === undefined) return undefined;
			if (!Number.isInteger(value) || value < 0) throw new Error(`${what} has a bad ${name}`);
			return value;
		};
		return {
			id: o.id,
			...(typeof o.baseKey === 'string' && o.baseKey ? { baseKey: o.baseKey } : {}),
			kind: o.kind,
			fdid: o.fdid,
			position: vec3(o.position, what),
			rotation: vec3(o.rotation, what),
			// WMO scale is fixed at 1 (spec 6.1).
			scale: o.kind === 'wmo' ? 1 : o.scale,
			...(o.kind === 'wmo' ? { doodadSet: sets(o.doodadSet, 'doodad set') ?? 0, nameSet: sets(o.nameSet, 'name set') ?? 0 } : {}),
			...(o.locked === true ? { locked: true } : {}),
			...(typeof o.group === 'string' && o.group ? { group: o.group } : {}),
		};
	});
}
