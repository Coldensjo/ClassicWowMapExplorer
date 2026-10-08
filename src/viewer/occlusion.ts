import * as THREE from 'three';
import { setLiquidsVisible } from './terrainMaterials';

/** Pixels across the view drawn to find what's hidden; the height follows the screen's shape. */
const WIDTH = 320;
/** Yards; leeway for the low-detail ground being a little off from the detailed ground it stands for. */
const MARGIN = 4;

/**
 * For a screenshot: draws how far the nearest ground or building is under each pixel of the view,
 * reads it back, and tells whether a box could show anywhere in front of it. The ground is drawn
 * from both sides, so from a cave or a mine the land overhead hides what's out in the open.
 */
export class ViewOcclusion {
	/** Null where the GPU can't render to float targets: then everything counts as in view. */
	private readonly target: THREE.WebGLRenderTarget | null;
	private readonly scene = new THREE.Scene();
	private readonly clearColor = new THREE.Color();
	private readonly viewProjection = new THREE.Matrix4();
	private readonly at = new THREE.Vector3();
	private readonly corner = new THREE.Vector4();
	private pixels = new Float32Array(0);
	private width = 0;
	private height = 0;
	/** Whether pixels hold the view from the last render. */
	private ready = false;

	constructor(renderer: THREE.WebGLRenderer) {
		this.target = renderer.extensions.has('EXT_color_buffer_float')
			? new THREE.WebGLRenderTarget(1, 1, {
				type: THREE.FloatType,
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				generateMipmaps: false,
				depthBuffer: true,
				// Float depth, for a reversed depth buffer to be precise far out.
				depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
			})
			: null;
		this.scene.overrideMaterial = new THREE.ShaderMaterial({
			side: THREE.DoubleSide,
			vertexShader: /* glsl */ `
				#include <common>
				#include <batching_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				varying vec3 vView;
				void main() {
					vec4 local = vec4(position, 1.0);
					#ifdef USE_BATCHING
						#include <batching_vertex>
						local = batchingMatrix * local;
					#endif
					#ifdef USE_INSTANCING
						local = instanceMatrix * local;
					#endif
					vec4 view = modelViewMatrix * local;
					vView = view.xyz;
					gl_Position = projectionMatrix * view;
					#include <logdepthbuf_vertex>
				}`,
			fragmentShader: /* glsl */ `
				#include <logdepthbuf_pars_fragment>
				varying vec3 vView;
				void main() {
					#include <logdepthbuf_fragment>
					gl_FragColor = vec4(length(vView), 0.0, 0.0, 1.0);
				}`,
		});
	}

	/**
	 * Draws the terrain and the buildings among the objects (both borrowed from the main scene
	 * for the pass) as the camera sees them, and reads the result back.
	 */
	render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, terrain: THREE.Object3D, objects: THREE.Object3D, buildings: Set<THREE.Object3D>): void {
		this.ready = false;
		if (!this.target) return;
		const size = renderer.getDrawingBufferSize(new THREE.Vector2());
		this.width = WIDTH;
		this.height = Math.max(1, Math.round((WIDTH * size.y) / Math.max(1, size.x)));
		if (this.target.width !== this.width || this.target.height !== this.height) this.target.setSize(this.width, this.height);
		camera.updateMatrixWorld();
		this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		camera.getWorldPosition(this.at);

		// Only the buildings: trees' leaves and grass would hide what shows between them.
		const shown = objects.children.map((child) => child.visible);
		for (const child of objects.children) child.visible &&= buildings.has(child);
		const terrainParent = terrain.parent;
		const objectsParent = objects.parent;
		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor(this.clearColor);
		setLiquidsVisible(false);
		this.scene.add(terrain, objects);
		// Nothing drawn reads as 0: open to the sky, hiding nothing.
		renderer.setClearColor(0x000000, 0);
		renderer.setRenderTarget(this.target);
		renderer.render(this.scene, camera);
		renderer.setRenderTarget(null);
		renderer.setClearColor(this.clearColor, clearAlpha);
		terrainParent?.add(terrain);
		objectsParent?.add(objects);
		setLiquidsVisible(true);
		objects.children.forEach((child, i) => (child.visible = shown[i]));

		if (this.pixels.length !== this.width * this.height * 4) this.pixels = new Float32Array(this.width * this.height * 4);
		renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, this.pixels);
		this.ready = true;
	}

	/** Whether any of a box could show in the view last rendered: in it and not behind what was drawn. */
	inView(box: THREE.Box3): boolean {
		if (!this.ready) return true;
		const distance = box.distanceToPoint(this.at);
		if (distance === 0) return true;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let i = 0; i < 8; i++) {
			const c = this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1).applyMatrix4(this.viewProjection);
			// Partly behind the camera: its outline on screen can't be told from the corners.
			if (c.w <= 0) return true;
			minX = Math.min(minX, c.x / c.w);
			maxX = Math.max(maxX, c.x / c.w);
			minY = Math.min(minY, c.y / c.w);
			maxY = Math.max(maxY, c.y / c.w);
		}
		const x0 = Math.max(0, Math.floor(((minX + 1) / 2) * this.width));
		const x1 = Math.min(this.width - 1, Math.floor(((maxX + 1) / 2) * this.width));
		const y0 = Math.max(0, Math.floor(((minY + 1) / 2) * this.height));
		const y1 = Math.min(this.height - 1, Math.floor(((maxY + 1) / 2) * this.height));
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const d = this.pixels[(y * this.width + x) * 4];
				if (d === 0 || d > distance - MARGIN) return true;
			}
		}
		return false;
	}
}
