import * as THREE from 'three';
import type { TextureData } from '../formats/blp';
import { createFarBatchMaterial, type FarBatchUniforms } from './terrainMaterials';
import { COMPRESSED_FORMATS } from './textures';

/**
 * Most textured tiles in one batch: one layer each of its array texture. 256 is the fewest
 * layers WebGL 2 promises.
 */
export const FAR_BATCH_LAYERS = 256;
/** Texels across the per-tile info texture. */
const INFO_WIDTH = 64;
/**
 * ms; tile textures that arrive are sent to the GPU together, at most this often. Each update
 * of an array texture the GPU may still be drawing with can stall it; thousands of one-layer
 * updates as the world's textures stream in made the first seconds crawl. So each upload is a
 * new array texture instead (see upload).
 */
const UPLOAD_INTERVAL = 500;

/** A low-detail tile for a batch: its mesh, where it goes, its colour until textured, and whether it ever will be. */
export interface FarEntry {
	geometry: THREE.BufferGeometry;
	position: THREE.Vector3;
	color: number;
	textured: boolean;
}

/**
 * Low-detail tiles drawn together: one BatchedMesh (a single draw, each tile still culled on its
 * own) and one material, the tiles' map textures in layers of an array texture. Drawn one by one,
 * each with its own material, hundreds of tiles cost more to set up than to draw.
 */
export class FarBatch {
	readonly mesh: THREE.BatchedMesh;
	/** Instance IDs, in the order the entries were given. */
	readonly ids: number[] = [];
	private readonly uniforms: FarBatchUniforms;
	/** Per instance: colour (rgb, linear), and its texture's layer, or -1 while it has none (a). */
	private readonly info: Float32Array;
	private readonly layerOf = new Map<number, number>();
	private readonly layers: number;
	private maps: THREE.CompressedArrayTexture | THREE.DataArrayTexture | null = null;
	/** Textures set since the last upload wait for this timer. */
	private uploadTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(entries: FarEntry[], private readonly anisotropy: number) {
		let vertices = 0;
		let indices = 0;
		for (const e of entries) {
			vertices += e.geometry.getAttribute('position').count;
			indices += e.geometry.getIndex()?.count ?? 0;
		}
		const rows = Math.ceil(entries.length / INFO_WIDTH);
		this.info = new Float32Array(INFO_WIDTH * rows * 4);
		const infoTexture = new THREE.DataTexture(this.info, INFO_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
		infoTexture.needsUpdate = true;
		this.uniforms = { uFarMaps: { value: null }, uFarInfo: { value: infoTexture } };
		this.mesh = new THREE.BatchedMesh(entries.length, vertices, indices, createFarBatchMaterial(this.uniforms));

		const matrix = new THREE.Matrix4();
		const color = new THREE.Color();
		let layer = 0;
		for (const e of entries) {
			const id = this.mesh.addInstance(this.mesh.addGeometry(e.geometry));
			this.mesh.setMatrixAt(id, matrix.makeTranslation(e.position));
			color.set(e.color);
			this.info.set([color.r, color.g, color.b, -1], id * 4);
			if (e.textured) this.layerOf.set(id, layer++);
			this.ids.push(id);
		}
		this.layers = Math.max(1, layer);
		this.mesh.computeBoundingBox();
		this.mesh.computeBoundingSphere();
	}

	setVisible(id: number, visible: boolean): void {
		this.mesh.setVisibleAt(id, visible);
	}

	/** Gives a tile its map texture. False when it can't go in the array (another format or size than the first). */
	setTexture(id: number, data: TextureData): boolean {
		const layer = this.layerOf.get(id);
		if (layer === undefined) return false;
		const maps = (this.maps ??= this.createMaps(data));
		const compressed = data.format !== 'rgba';
		if (compressed !== maps instanceof THREE.CompressedArrayTexture || data.width !== maps.image.width || data.height !== maps.image.height) return false;
		if (compressed) {
			const mips = (maps as THREE.CompressedArrayTexture).mipmaps as unknown as { data: Uint8Array }[];
			if (mips.some((mip, i) => data.mips[i]?.data.length !== mip.data.length / this.layers)) return false;
			mips.forEach((mip, i) => mip.data.set(data.mips[i].data, layer * (mip.data.length / this.layers)));
		} else {
			const image = maps.image as { data: Uint8Array };
			image.data.set(data.mips[0].data, layer * data.width * data.height * 4);
		}
		// Textured: the texture's own colours, untinted (shown once uploaded, with the array).
		this.info.set([1, 1, 1, layer], id * 4);
		this.uploadTimer ??= setTimeout(() => this.upload(), UPLOAD_INTERVAL);
		return true;
	}

	/**
	 * Sends the array texture, every layer at once, and the tiles' info with it. Once sent, the
	 * array goes to a new texture over the same data rather than being updated in place: on
	 * Direct3D (Chrome's default on Windows) each write to a texture the GPU may still be using
	 * cost as much as copying all of it, seconds of frozen frames as the world's textures came in.
	 */
	private upload(): void {
		this.uploadTimer = null;
		const old = this.maps;
		if (old?.version) {
			// A new image, so three gives it a texture of its own.
			const { width, height, depth } = old.image;
			this.maps = this.configure(old instanceof THREE.CompressedArrayTexture
				? new THREE.CompressedArrayTexture(old.mipmaps, width, height, depth, old.format)
				: new THREE.DataArrayTexture((old.image as { data: Uint8Array }).data, width, height, depth));
			old.dispose();
		}
		if (this.maps) this.maps.needsUpdate = true;
		this.uniforms.uFarInfo.value.needsUpdate = true;
	}

	/** The array texture, laid out after the first tile texture that arrives. */
	private createMaps(first: TextureData): THREE.CompressedArrayTexture | THREE.DataArrayTexture {
		if (first.format === 'rgba') return this.configure(new THREE.DataArrayTexture(new Uint8Array(first.width * first.height * 4 * this.layers), first.width, first.height, this.layers));
		const mipmaps = first.mips.map((m) => ({ data: new Uint8Array(m.data.length * this.layers), width: m.width, height: m.height }));
		return this.configure(new THREE.CompressedArrayTexture(mipmaps as unknown as THREE.CompressedTextureMipmap[], first.width, first.height, this.layers, COMPRESSED_FORMATS[first.format]));
	}

	/** Sets up a new array texture and has the material draw with it. */
	private configure<T extends THREE.CompressedArrayTexture | THREE.DataArrayTexture>(maps: T): T {
		if (maps instanceof THREE.DataArrayTexture) maps.generateMipmaps = true;
		maps.colorSpace = THREE.SRGBColorSpace;
		maps.wrapS = maps.wrapT = THREE.ClampToEdgeWrapping;
		maps.magFilter = THREE.LinearFilter;
		maps.minFilter = THREE.LinearMipmapLinearFilter;
		maps.anisotropy = this.anisotropy;
		this.uniforms.uFarMaps.value = maps;
		return maps;
	}
}
