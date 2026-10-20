import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { CHUNK_HEIGHTS, CHUNKS_PER_TILE } from '../formats/adt';
import { ALPHA_SIZE } from '../formats/adtTex';
import { SceneModel, type SceneChunk, type SceneTile } from './sceneModel';
import { MAX_COPIED_TILES, SCENE_VERSION, type BinRef, type Chunk, type Scene, type Tile } from './types';

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

/** Serializes a scene to .wscene bytes. The thumbnail is a 512x288 WebP render, when one is given. */
export function encodeScene(model: SceneModel, thumbnail: Uint8Array | null = null): Uint8Array {
	if (model.meta.base) throw new Error('Copied scenes are not supported yet');
	const heights = new BinWriter('heights.bin');
	const alpha = new BinWriter('alpha.bin');
	const shade = new BinWriter('shade.bin');

	const tiles: Tile[] = model.tiles.map((tile) => ({
		x: tile.x,
		y: tile.y,
		chunks: tile.chunks.map((c): Chunk => {
			if (c.layers.length < 1 || c.layers.length > 4) throw new Error(`A chunk has ${c.layers.length} texture layers`);
			const expectAlpha = (c.layers.length - 1) * ALPHA_BYTES;
			if ((c.alpha?.length ?? 0) !== expectAlpha) throw new Error(`A chunk with ${c.layers.length} layers has ${c.alpha?.length ?? 0} alpha bytes, expected ${expectAlpha}`);
			return {
				heights: heights.add(new Uint8Array(c.heights.buffer, c.heights.byteOffset, c.heights.byteLength)),
				...(c.vertexShade ? { vertexShade: shade.add(c.vertexShade) } : {}),
				layers: c.layers,
				alpha: c.alpha ? alpha.add(c.alpha) : null,
				holes: holesToHex(c.holes),
				water: c.water,
			};
		}),
	}));

	const scene: Scene = {
		format: 'wscene',
		version: SCENE_VERSION,
		...model.meta,
		textures: model.textures,
		tiles,
		objects: model.objects,
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
}

/** Reads .wscene bytes back into a SceneModel, refusing anything but a valid container. */
export function decodeScene(bytes: Uint8Array): DecodedScene {
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
	return { model: toModel(scene, files), thumbnail: files['thumbnail.webp'] ?? null };
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

function toModel(scene: Scene, files: Record<string, Uint8Array>): SceneModel {
	if (scene.base) throw new Error('Copied scenes are not supported yet');
	const { tilesX, tilesY } = scene.size ?? {};
	if (!Number.isInteger(tilesX) || !Number.isInteger(tilesY) || tilesX < 1 || tilesY < 1 || tilesX > MAX_COPIED_TILES || tilesY > MAX_COPIED_TILES) {
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

	const tiles: SceneTile[] = scene.tiles.map((tile, index) => {
		if (tile.x !== index % tilesX || tile.y !== Math.floor(index / tilesX)) throw new Error(`Tile ${index} is out of order`);
		if (!Array.isArray(tile.chunks) || tile.chunks.length !== CHUNK_COUNT) {
			throw new Error(`Tile ${tile.x}_${tile.y} holds ${tile.chunks?.length ?? 0} chunks, expected ${CHUNK_COUNT}`);
		}
		const chunks = tile.chunks.map((c, i): SceneChunk => {
			const what = `Tile ${tile.x}_${tile.y} chunk ${i}`;
			if (!Array.isArray(c.layers) || c.layers.length < 1 || c.layers.length > 4) throw new Error(`${what} has ${c.layers?.length ?? 0} texture layers`);
			for (const layer of c.layers) {
				if (!Number.isInteger(layer.texture) || layer.texture < 0 || layer.texture >= scene.textures.length) {
					throw new Error(`${what} paints texture ${layer.texture}, outside the palette of ${scene.textures.length}`);
				}
			}
			const heightBytes = read(c.heights, HEIGHTS_BYTES, `${what} heights`);
			const heights = new Float32Array(heightBytes.buffer, heightBytes.byteOffset, CHUNK_HEIGHTS);
			if (!heights.every(Number.isFinite)) throw new Error(`${what} has non-finite heights`);
			const expectAlpha = (c.layers.length - 1) * ALPHA_BYTES;
			if (expectAlpha === 0 && c.alpha) throw new Error(`${what} has one layer but an alpha map`);
			if (expectAlpha > 0 && !c.alpha) throw new Error(`${what} has ${c.layers.length} layers but no alpha map`);
			if (c.water !== null && !(Number.isInteger(c.water?.kind) && Number.isFinite(c.water?.height))) throw new Error(`${what} has bad water settings`);
			return {
				heights,
				vertexShade: c.vertexShade ? read(c.vertexShade, SHADE_BYTES, `${what} shading`) : null,
				layers: c.layers,
				alpha: c.alpha ? read(c.alpha, expectAlpha, `${what} alpha`) : null,
				holes: holesFromHex(c.holes),
				water: c.water,
			};
		});
		return { x: tile.x, y: tile.y, chunks };
	});

	return new SceneModel(
		{
			id: scene.id,
			name: scene.name,
			created: scene.created,
			modified: scene.modified,
			client: scene.client,
			size: scene.size,
			base: scene.base,
			spawn: scene.spawn,
			environment: scene.environment,
			player: scene.player,
		},
		scene.textures,
		tiles,
		scene.objects ?? [],
		scene.npcPresets ?? [],
		scene.npcs ?? [],
	);
}
