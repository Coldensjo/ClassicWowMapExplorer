import * as THREE from 'three';

/**
 * Bytes sent to the GPU per frame, at most (one texture always goes, however big). three only
 * uploads a texture the first time it's drawn, so a batch of models or a tile arriving together
 * sent all their textures in one frame: a freeze of tens to hundreds of ms while the GPU took them.
 */
const FRAME_BYTES = 4 * 1024 * 1024;
/** ms of main-thread time spent uploading per frame, at most. */
const FRAME_MS = 4;

interface Job {
	textures: THREE.Texture[];
	/** Geometry bytes the object's first draw will upload; counted, not uploaded here (three has no call for it). */
	geometryBytes: number;
	resolve: () => void;
}

/**
 * Sends objects' textures to the GPU a few at a time between frames, before the objects are
 * shown, so their first draw has nothing large left to upload.
 */
export class UploadQueue {
	private readonly jobs: Job[] = [];
	private readonly queued = new WeakSet<THREE.Texture>();
	private readonly disposed = new WeakSet<THREE.Texture>();
	private readonly counted = new WeakSet<THREE.BufferGeometry>();
	private readonly onDispose = (event: { target: THREE.Texture }) => this.disposed.add(event.target);

	constructor(private readonly renderer: THREE.WebGLRenderer) {}

	get pending(): number {
		return this.jobs.length;
	}

	/**
	 * Resolves once the object's textures are on the GPU. Its materials must be compiled already
	 * (see Post.compileAsync): their uniforms, where patched shaders' textures are found, exist from then.
	 */
	upload(object: THREE.Object3D): Promise<void> {
		const textures: THREE.Texture[] = [];
		let geometryBytes = 0;
		const materials = new Set<THREE.Material>();
		object.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (mesh.geometry && !this.counted.has(mesh.geometry)) {
				this.counted.add(mesh.geometry);
				geometryBytes += geometrySize(mesh.geometry);
			}
			const material = mesh.material;
			if (material) for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
		});
		const add = (value: unknown) => {
			const texture = value as THREE.Texture | null;
			if (!texture?.isTexture || this.queued.has(texture) || !this.needsUpload(texture)) return;
			this.queued.add(texture);
			texture.addEventListener('dispose', this.onDispose);
			textures.push(texture);
		};
		for (const material of materials) {
			// A built-in material's own maps (map, alphaMap...) reach its uniforms only when drawn;
			// shader patches' textures are in the uniforms from compiling.
			for (const value of Object.values(material)) add(value);
			const uniforms = (this.renderer.properties.get(material) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
			for (const u of Object.values(uniforms ?? {})) {
				if (Array.isArray(u?.value)) u.value.forEach(add);
				else add(u?.value);
			}
		}
		if (!textures.length && !geometryBytes) return Promise.resolve();
		return new Promise((resolve) => this.jobs.push({ textures, geometryBytes, resolve }));
	}

	/** Resolves once the texture is on the GPU. */
	texture(texture: THREE.Texture): Promise<void> {
		if (this.queued.has(texture) || !this.needsUpload(texture)) return Promise.resolve();
		this.queued.add(texture);
		texture.addEventListener('dispose', this.onDispose);
		return new Promise((resolve) => this.jobs.push({ textures: [texture], geometryBytes: 0, resolve }));
	}

	/** Call once per frame, before drawing: uploads the next textures, up to the frame's budget. */
	drain(): void {
		if (!this.jobs.length) return;
		const start = performance.now();
		let bytes = 0;
		let sent = 0;
		while (this.jobs.length) {
			const job = this.jobs[0];
			while (job.textures.length) {
				const texture = job.textures[0];
				const size = this.needsUpload(texture) ? textureSize(texture) : 0;
				if (sent && size && (bytes + size > FRAME_BYTES || performance.now() - start > FRAME_MS)) break;
				job.textures.shift();
				this.queued.delete(texture);
				texture.removeEventListener('dispose', this.onDispose);
				if (!size) continue;
				this.renderer.initTexture(texture);
				bytes += size;
				sent++;
			}
			if (job.textures.length) break;
			// Its geometry goes up when it's first drawn, next frame; that counts against this one.
			if (sent && job.geometryBytes && bytes + job.geometryBytes > FRAME_BYTES) break;
			bytes += job.geometryBytes;
			sent++;
			this.jobs.shift();
			job.resolve();
		}
	}

	/** Whether the texture has data three hasn't sent to the GPU yet. */
	private needsUpload(texture: THREE.Texture): boolean {
		if (this.disposed.has(texture) || texture.version === 0 || (texture as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return false;
		return (this.renderer.properties.get(texture) as { __version?: number }).__version !== texture.version;
	}
}

function textureSize(texture: THREE.Texture): number {
	const mipmaps = texture.mipmaps as unknown as { data?: ArrayBufferView }[] | undefined;
	if ((texture as THREE.CompressedTexture).isCompressedTexture && mipmaps?.length) return mipmaps.reduce((n, m) => n + (m.data?.byteLength ?? 0), 0);
	const image = texture.image as { data?: ArrayBufferView; width?: number; height?: number; depth?: number } | null;
	const base = image?.data?.byteLength ?? (image?.width ?? 0) * (image?.height ?? 0) * (image?.depth ?? 1) * 4;
	return texture.generateMipmaps ? Math.ceil(base * 4 / 3) : base;
}

function geometrySize(geometry: THREE.BufferGeometry): number {
	let n = geometry.index?.array.byteLength ?? 0;
	for (const attribute of Object.values(geometry.attributes)) n += (attribute as THREE.BufferAttribute).array?.byteLength ?? 0;
	return n;
}
