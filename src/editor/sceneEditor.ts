import * as THREE from 'three';
import { TILE_SIZE } from '../formats/adt';
import { ALPHA_ATLAS_SIZE, buildSplatTerrain, type SplatGeometry } from '../explorer/splatMesh';
import type { SceneModel, SceneTile } from '../scene/sceneModel';
import type { AsyncStorageApi } from '../worker/protocol';
import { FlyControls } from '../viewer/flyControls';
import { WalkControls } from '../viewer/walkControls';
import { createAlphaTexture, createSplatMaterial, seaMask } from '../viewer/terrainMaterials';
import { TextureCache } from '../viewer/textureCache';
import { supportsCompressedTextures } from '../viewer/textures';

const SKY = new THREE.Color(0x9ec4e4);
/** Camera distance limits for small scenes. */
const NEAR = 0.5;
const FAR = 40000;
/** Thumbnails for the scene library (and later galleries), spec 6.2. */
const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 288;

interface TileMesh {
	group: THREE.Group;
	geometries: THREE.BufferGeometry[];
	materials: THREE.Material[];
	alpha: THREE.Texture;
	textures: number[];
}

function toBufferGeometry(g: SplatGeometry): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
	geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
	geometry.setAttribute('chunkIndex', new THREE.BufferAttribute(g.chunks, 1));
	geometry.setAttribute('skirt', new THREE.BufferAttribute(g.skirt, 1));
	geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;
}

/**
 * The editor viewport (spec 4): renders a SceneModel's tiles with the explorer's splat terrain
 * under the scene's lighting, rebuilding only dirty tiles, with a fly camera and a basic walk
 * mode on terrain-only collision (Phase 1: no avatar, no objects).
 */
export class SceneEditor {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly controls: FlyControls;
	private readonly walker: WalkControls;
	private readonly textures: TextureCache;
	private readonly tileMeshes = new Map<number, TileMesh>();
	private readonly clock = new THREE.Clock();
	private frame = 0;
	private disposed = false;
	/** Something the user should know, shown by the editor bar. */
	onNotice: (text: string) => void = () => {};

	constructor(
		private readonly canvas: HTMLCanvasElement,
		storage: AsyncStorageApi,
		readonly model: SceneModel,
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.textures = new TextureCache(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy());
		this.camera = new THREE.PerspectiveCamera(60, 1, NEAR, FAR);
		this.controls = new FlyControls(this.camera, canvas);
		this.walker = new WalkControls(this.camera, canvas);
		this.controls.onTakeOver = () => this.setWalking(false);
		this.walker.world = {
			terrain: (x, z) => this.model.heightAt(x, z) ?? -Infinity,
			surface: (x, z) => this.model.surfaceAt(x, z) ?? -Infinity,
			ready: () => true,
			// Phase 1: terrain-only collision, no buildings, no liquids.
			nearBuilding: () => false,
			cast: () => null,
			sweep: (_from, move) => move,
			pushOut: () => new THREE.Vector3(),
			liquid: () => null,
		};

		this.scene.background = SKY;
		// The scene's lighting: Phase 1 renders every scene with the one built-in preset
		// (environment.lightPreset 0), a daylight sun and sky light as the explorer starts with.
		const sun = new THREE.DirectionalLight(0xfff2dd, Math.PI);
		sun.position.set(-0.6, 1, 0.45);
		const ambient = new THREE.HemisphereLight(0x8899aa, 0x8899aa, Math.PI);
		this.scene.add(sun, ambient);
		// The explorer's sea mask tints terrain below sea level; a scene has no sea.
		seaMask.uSeaBounds.value.set(1e9, 1e9, 1, 1);

		// A click looks around while flying (walking manages the mouse itself).
		canvas.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('resize', this.onResize);
		this.onResize();

		// Start over the spawn point, looking north across the scene.
		const [sx, , sz] = model.meta.spawn.position;
		const span = Math.max(model.tilesX, model.tilesY) * TILE_SIZE;
		this.controls.set(new THREE.Vector3(sx, span * 0.35, sz + span * 0.4), 0, -0.6);
	}

	/** Loads the texture palette and builds every tile; the scene is in view when this resolves. */
	async load(): Promise<void> {
		for (const tile of this.model.tiles) await this.buildTile(tile);
		this.render();
	}

	private async buildTile(tile: SceneTile): Promise<void> {
		const index = tile.y * this.model.tilesX + tile.x;
		const { root, tex } = this.model.tileRenderData(tile);
		const terrain = buildSplatTerrain(root, tex);
		const textures = await this.textures.acquire(terrain.textures);
		if (this.disposed) {
			this.textures.release(terrain.textures);
			return;
		}
		this.dropTile(index);
		const alpha = createAlphaTexture(terrain.alpha, ALPHA_ATLAS_SIZE);
		const geometry = toBufferGeometry(terrain.geometry);
		const materials = terrain.groups.map((g, i) => {
			geometry.addGroup(g.start, g.count, i);
			return createSplatMaterial(alpha, g.layers, textures);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.matrixAutoUpdate = false;
		const group = new THREE.Group();
		group.add(mesh);
		group.position.set(tile.x * TILE_SIZE, 0, tile.y * TILE_SIZE);
		group.updateMatrixWorld(true);
		this.scene.add(group);
		this.tileMeshes.set(index, { group, geometries: [geometry], materials, alpha, textures: terrain.textures });
	}

	private dropTile(index: number): void {
		const mesh = this.tileMeshes.get(index);
		if (!mesh) return;
		this.tileMeshes.delete(index);
		this.scene.remove(mesh.group);
		for (const g of mesh.geometries) g.dispose();
		for (const m of mesh.materials) m.dispose();
		mesh.alpha.dispose();
		this.textures.release(mesh.textures);
	}

	get walking(): boolean {
		return this.walker.active;
	}

	/** Drops to the ground under the camera and walks, or lifts back to the fly camera (Tab). */
	setWalking(on: boolean): void {
		if (on === this.walker.active) return;
		if (!on) {
			this.walker.stop();
			this.controls.enabled = true;
			this.controls.set(this.camera.position.clone(), this.walker.yaw, this.walker.pitch);
			return;
		}
		const cam = this.camera.position;
		const floor = this.walker.floorAt(cam.x, cam.z, cam.y, cam.y - 5000);
		if (!floor) {
			this.onNotice('There’s no ground under the camera to stand on');
			return;
		}
		this.controls.enabled = false;
		this.walker.dropFrom(cam, this.controls.yaw);
		this.walker.start();
	}

	start(): void {
		this.clock.start();
		const loop = () => {
			if (this.disposed) return;
			this.frame = requestAnimationFrame(loop);
			this.update(Math.min(this.clock.getDelta(), 0.1));
			this.render();
		};
		loop();
	}

	private update(dt: number): void {
		for (const index of this.model.dirtyTiles) {
			this.model.dirtyTiles.delete(index);
			void this.buildTile(this.model.tiles[index]);
		}
		if (this.walker.active) this.walker.update(dt);
		else this.controls.update(dt, (x, z) => this.model.heightAt(x, z) ?? -Infinity, (x, z) => this.model.surfaceAt(x, z) ?? -Infinity);
	}

	private render(): void {
		this.renderer.render(this.scene, this.camera);
	}

	/** A 512x288 WebP render for the scene library (spec 6.2), from the current view. */
	async thumbnail(): Promise<Uint8Array | null> {
		const target = new THREE.WebGLRenderTarget(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		const aspect = this.camera.aspect;
		this.camera.aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;
		this.camera.updateProjectionMatrix();
		this.renderer.setRenderTarget(target);
		this.renderer.render(this.scene, this.camera);
		const pixels = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4);
		await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, pixels);
		this.renderer.setRenderTarget(null);
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
		target.dispose();
		// GL reads rows bottom-up.
		const flipped = new Uint8ClampedArray(pixels.length);
		const row = THUMBNAIL_WIDTH * 4;
		for (let y = 0; y < THUMBNAIL_HEIGHT; y++) flipped.set(pixels.subarray(y * row, (y + 1) * row), (THUMBNAIL_HEIGHT - 1 - y) * row);
		const drawn = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		drawn.getContext('2d')!.putImageData(new ImageData(flipped, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), 0, 0);
		try {
			const blob = await drawn.convertToBlob({ type: 'image/webp', quality: 0.85 });
			return new Uint8Array(await blob.arrayBuffer());
		} catch {
			return null;
		}
	}

	private readonly onMouseDown = (): void => {
		if (!this.walker.active && !this.controls.locked) this.controls.lock();
	};

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		if (this.disposed || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		if (e.code === 'Tab') {
			e.preventDefault();
			this.setWalking(!this.walker.active);
		}
	};

	private readonly onResize = (): void => {
		const width = this.canvas.clientWidth || window.innerWidth;
		const height = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	};

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.walker.stop();
		this.controls.enabled = false;
		this.canvas.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('resize', this.onResize);
		for (const index of [...this.tileMeshes.keys()]) this.dropTile(index);
		this.renderer.dispose();
	}
}
