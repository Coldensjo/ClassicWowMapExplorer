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
		maps.addLayerUpdate(layer);
		maps.needsUpdate = true;
		// Textured: the texture's own colours, untinted.
		this.info.set([1, 1, 1, layer], id * 4);
		this.uniforms.uFarInfo.value.needsUpdate = true;
		return true;
	}

	/** The array texture, laid out after the first tile texture that arrives. */
	private createMaps(first: TextureData): THREE.CompressedArrayTexture | THREE.DataArrayTexture {
		let maps: THREE.CompressedArrayTexture | THREE.DataArrayTexture;
		if (first.format === 'rgba') {
			maps = new THREE.DataArrayTexture(new Uint8Array(first.width * first.height * 4 * this.layers), first.width, first.height, this.layers);
			maps.generateMipmaps = true;
		} else {
			const mipmaps = first.mips.map((m) => ({ data: new Uint8Array(m.data.length * this.layers), width: m.width, height: m.height }));
			maps = new THREE.CompressedArrayTexture(mipmaps as unknown as THREE.CompressedTextureMipmap[], first.width, first.height, this.layers, COMPRESSED_FORMATS[first.format]);
		}
		maps.colorSpace = THREE.SRGBColorSpace;
		maps.wrapS = maps.wrapT = THREE.ClampToEdgeWrapping;
		maps.magFilter = THREE.LinearFilter;
		maps.minFilter = THREE.LinearMipmapLinearFilter;
		maps.anisotropy = this.anisotropy;
		this.uniforms.uFarMaps.value = maps;
		return maps;
	}
}
