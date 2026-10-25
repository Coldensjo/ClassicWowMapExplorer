import * as THREE from 'three';
import type { ModelData, ModelKind } from '../explorer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import { createModelMaterial, type SkinUniforms } from '../viewer/modelMaterials';
import { TextureCache } from '../viewer/textureCache';
import { supportsCompressedTextures } from '../viewer/textures';
import { kvGet, kvSet } from '../scene/db';

/** World axes from a model's (x forward, y left, z up), as the portraits renderer uses. */
const MODEL_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
/** The model turned a little from face-on, for a three-quarter view. */
const FACING = Math.PI + 0.7;
/** Vertical field of view (degrees), and the room left round the model (share of its size). */
const FOV = 30;
const MARGIN = 1.1;
/** Rendered size; shown at half that, so it stays sharp on dense screens. */
const SIZE = 112;

/**
 * Thumbnails for the doodad and building browser (spec 7.3): each model is rendered once with an
 * offscreen renderer of its own, lazily and one at a time, then cached in IndexedDB as WebP keyed
 * by build and FDID, so later sessions never render it again.
 */
export class ModelThumbs {
	private renderer: THREE.WebGLRenderer | null = null;
	private textures: TextureCache | null = null;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20000);
	private queue: Promise<unknown> = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		private readonly build: string,
	) {
		this.scene.add(new THREE.AmbientLight(0xffffff, 2.2));
		const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
		key.position.set(-1.5, 2, 3);
		const rim = new THREE.DirectionalLight(0xbfd4ff, 1);
		rim.position.set(2, 1.5, -2);
		this.scene.add(key, rim);
	}

	/** The renderer is made on first use, so browsers that never show models pay nothing. */
	private lazyRenderer(): { renderer: THREE.WebGLRenderer; textures: TextureCache } {
		if (!this.renderer) {
			this.renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(SIZE, SIZE), antialias: true, alpha: true });
			this.renderer.setSize(SIZE, SIZE, false);
			this.renderer.setClearColor(0x000000, 0);
			this.textures = new TextureCache(this.storage, supportsCompressedTextures(this.renderer), 1);
		}
		return { renderer: this.renderer, textures: this.textures! };
	}

	/**
	 * A model's thumbnail as WebP bytes, from the cache or rendered now; null when the model can't
	 * be read. Requests run one at a time, so a scroll through the browser can't stampede the worker.
	 * NPCs (spec 7.9) pass a creature display or a preset handle as fdid; a preset's cache key
	 * names its look, since the handle changes with every edit.
	 */
	thumbnail(kind: ModelKind, fdid: number, cacheKey = `${kind}:${fdid}`): Promise<Uint8Array | null> {
		const run = this.queue.then(() => (this.disposed ? null : this.make(kind, fdid, cacheKey)));
		this.queue = run.catch(() => null);
		return run;
	}

	private async make(kind: ModelKind, fdid: number, cacheKey: string): Promise<Uint8Array | null> {
		const key = `thumb:${this.build}:${cacheKey}`;
		const cached = await kvGet<Uint8Array | null>(key).catch(() => undefined);
		if (cached !== undefined) return cached;
		let bytes: Uint8Array | null = null;
		try {
			const [data] = await this.storage.loadModels([{ fdid, kind }]);
			if (data && data.batches.length && !this.disposed) bytes = await this.render(data);
		} catch {
			bytes = null;
		}
		// Unreadable models cache their null too, so they aren't retried every session.
		await kvSet(key, bytes).catch(() => {});
		return bytes;
	}

	private async render(data: ModelData): Promise<Uint8Array | null> {
		const { renderer, textures } = this.lazyRenderer();
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
		if (data.baked) geometry.setAttribute('baked', new THREE.BufferAttribute(data.baked, 4));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		// Animated models (NPCs) keep their vertices in bind space: pose them in their first Stand frame.
		let boneTexture: THREE.DataTexture | null = null;
		let skin: SkinUniforms | null = null;
		const a = data.animation;
		if (a) {
			geometry.setAttribute('boneIndex', new THREE.BufferAttribute(a.boneIndex, 4));
			geometry.setAttribute('boneWeight', new THREE.BufferAttribute(a.boneWeight, 4, true));
			boneTexture = new THREE.DataTexture(a.data, a.bones * 3, a.data.length / (a.bones * 12), THREE.RGBAFormat, THREE.FloatType);
			boneTexture.magFilter = boneTexture.minFilter = THREE.NearestFilter;
			boneTexture.needsUpdate = true;
			const row = a.clips[0]?.row ?? 0;
			skin = { uBoneTex: { value: boneTexture as THREE.Texture }, uPoseA: { value: new THREE.Vector3(row, row, 0) }, uPoseB: { value: new THREE.Vector3(row, row, 0) }, uPoseMix: { value: 0 } };
		}
		const drawn = data.batches.filter((b) => !b.material.collision).sort((a, b) => a.order - b.order);
		const ids = [...new Set(drawn.map((b) => b.material.texture).filter((t) => t))];
		const loaded = await textures.acquire(ids);
		const materials = drawn.map((b, i) => {
			geometry.addGroup(b.start, b.count, i);
			return createModelMaterial(b.material, loaded.get(b.material.texture) ?? null, !!data.baked, skin);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.applyMatrix4(new THREE.Matrix4().makeRotationY(FACING).multiply(MODEL_BASIS));
		this.scene.add(mesh);

		// Frame the drawn triangles: the bounds in view space, after the facing turn. A posed model's
		// bounds come from its bind-space vertices, which stand close enough to the pose for framing.
		const box = new THREE.Box3().setFromObject(mesh);
		const centre = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const radius = Math.max(size.x, size.y, size.z, 0.1) / 2;
		const distance = (radius * MARGIN) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
		this.camera.position.set(centre.x, centre.y + radius * 0.25, centre.z + distance);
		this.camera.lookAt(centre);
		renderer.render(this.scene, this.camera);

		this.scene.remove(mesh);
		geometry.dispose();
		for (const m of materials) m.dispose();
		boneTexture?.dispose();
		textures.release(ids);
		try {
			const blob = await (renderer.domElement as unknown as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality: 0.85 });
			return new Uint8Array(await blob.arrayBuffer());
		} catch {
			return null;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.renderer?.dispose();
		this.renderer = null;
	}
}
