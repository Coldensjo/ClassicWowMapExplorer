import * as THREE from 'three';
import { groundDistance, seaFloor, setLiquidsVisible } from './terrainMaterials';

/** Resolution of the pass relative to the screen: water depth needn't be sharper than this. */
const SCALE = 0.5;
/**
 * Yards; ground further than this isn't drawn, and reads as no ground (deep water). Shallows and
 * foam that far off are under a pixel, and it saves drawing every distant tile a second time.
 */
const RANGE = 3000;

/**
 * Renders how far the ground is from the camera under each pixel (terrain only, no liquids),
 * before the frame. Water compares it with its own distance to know how deep it is there: the
 * game's water is clear and light at the shore, darker and opaque further out, with foam where
 * it meets the land.
 */
export class GroundDistancePass {
	private readonly target: THREE.WebGLRenderTarget;
	private readonly scene = new THREE.Scene();
	private readonly size = new THREE.Vector2();
	private readonly clearColor = new THREE.Color();
	/** The view's camera with the far plane pulled in to RANGE. */
	private readonly camera = new THREE.PerspectiveCamera();

	constructor(renderer: THREE.WebGLRenderer) {
		// Full floats keep shallow water exact far away; half floats if the GPU can't render to them.
		const float = renderer.extensions.has('EXT_color_buffer_float');
		this.target = new THREE.WebGLRenderTarget(1, 1, {
			type: float ? THREE.FloatType : THREE.HalfFloatType,
			format: THREE.RedFormat,
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			generateMipmaps: false,
			depthBuffer: true,
			// Float depth, for a reversed depth buffer to be precise out to the pass's range.
			depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
		});
		this.scene.overrideMaterial = new THREE.ShaderMaterial({
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
		groundDistance.uGroundDistance.value = this.target.texture;
	}

	/**
	 * Builds the pass's shader for detailed tiles (plain meshes; the low-detail ones are batched,
	 * drawn at the start) in the background, rather than mid-frame when the first one arrives.
	 */
	async warm(renderer: THREE.WebGLRenderer): Promise<void> {
		// three builds a shader for the attributes a mesh has: a tile's position and normal.
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
		const mesh = new THREE.Mesh(geometry, this.scene.overrideMaterial!);
		renderer.setRenderTarget(this.target);
		const compiled = renderer.compileAsync(mesh, this.camera, this.scene);
		renderer.setRenderTarget(null);
		await compiled;
	}

	/** Draws the terrain group on its own (borrowed from the main scene for the pass). */
	render(renderer: THREE.WebGLRenderer, terrain: THREE.Object3D, camera: THREE.PerspectiveCamera): void {
		renderer.getDrawingBufferSize(this.size);
		const width = Math.max(1, Math.round(this.size.x * SCALE));
		const height = Math.max(1, Math.round(this.size.y * SCALE));
		if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
		groundDistance.uScreenSize.value.copy(this.size);

		// Not its children: the torch rides on the view's camera.
		this.camera.copy(camera, false);
		this.camera.far = Math.min(camera.far, RANGE);
		this.camera.updateProjectionMatrix();

		const parent = terrain.parent;
		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor(this.clearColor);
		setLiquidsVisible(false);
		this.scene.add(terrain);
		// Nothing drawn reads as 0: no ground there, as deep as can be.
		renderer.setClearColor(0x000000, 0);
		renderer.setRenderTarget(this.target);
		renderer.render(this.scene, this.camera);
		renderer.setRenderTarget(null);
		renderer.setClearColor(this.clearColor, clearAlpha);
		parent?.add(terrain);
		setLiquidsVisible(true);
	}
}

/** Texels across the sea floor map, and yards across it on the ground: about 0.6 yards a texel. */
const FLOOR_SIZE = 1024;
const FLOOR_SPAN = 640;
/** Redrawn this often (ms), for tiles that have come in since, and sooner once the camera has moved this far (yards). */
const FLOOR_REDRAW_INTERVAL = 1000;
const FLOOR_REDRAW_MOVE = 64;

/**
 * Keeps the sea floor map around the camera up to date: the terrain drawn from straight above,
 * each texel the height of the ground there (see seaFloor).
 */
export class SeaFloorPass {
	private readonly target: THREE.WebGLRenderTarget;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-FLOOR_SPAN / 2, FLOOR_SPAN / 2, FLOOR_SPAN / 2, -FLOOR_SPAN / 2, 1, 20000);
	private readonly clearColor = new THREE.Color();
	private readonly center = new THREE.Vector2(Infinity, Infinity);
	private lastDraw = -Infinity;

	constructor(renderer: THREE.WebGLRenderer) {
		const linearFloat = renderer.extensions.has('OES_texture_float_linear') && renderer.extensions.has('EXT_color_buffer_float');
		this.target = new THREE.WebGLRenderTarget(FLOOR_SIZE, FLOOR_SIZE, {
			type: linearFloat ? THREE.FloatType : THREE.HalfFloatType,
			format: THREE.RGFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: false,
			depthBuffer: true,
		});
		this.scene.overrideMaterial = new THREE.ShaderMaterial({
			vertexShader: /* glsl */ `
				#include <common>
				#include <batching_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				varying float vHeight;
				void main() {
					vec4 local = vec4(position, 1.0);
					#ifdef USE_BATCHING
						#include <batching_vertex>
						local = batchingMatrix * local;
					#endif
					vec4 world = modelMatrix * local;
					vHeight = world.y;
					gl_Position = projectionMatrix * viewMatrix * world;
					#include <logdepthbuf_vertex>
				}`,
			fragmentShader: /* glsl */ `
				#include <logdepthbuf_pars_fragment>
				varying float vHeight;
				void main() {
					#include <logdepthbuf_fragment>
					gl_FragColor = vec4(vHeight, 1.0, 0.0, 1.0);
				}`,
			side: THREE.DoubleSide,
		});
		this.camera.up.set(0, 0, -1);
		seaFloor.uSeaFloor.value = this.target.texture;
	}

	/** Builds the pass's shader for detailed tiles in the background (see GroundDistancePass.warm). */
	async warm(renderer: THREE.WebGLRenderer): Promise<void> {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
		const mesh = new THREE.Mesh(geometry, this.scene.overrideMaterial!);
		renderer.setRenderTarget(this.target);
		const compiled = renderer.compileAsync(mesh, this.camera, this.scene);
		renderer.setRenderTarget(null);
		await compiled;
	}

	/** Redraws the map around a position when it's due. */
	update(renderer: THREE.WebGLRenderer, terrain: THREE.Object3D, position: THREE.Vector3, now: number): void {
		const moved = Math.hypot(position.x - this.center.x, position.z - this.center.y) > FLOOR_REDRAW_MOVE;
		if (!moved && now - this.lastDraw < FLOOR_REDRAW_INTERVAL) return;
		this.lastDraw = now;
		// On whole texels, so the heights read between them don't shift as it follows the camera.
		const texel = FLOOR_SPAN / FLOOR_SIZE;
		this.center.set(Math.round(position.x / texel) * texel, Math.round(position.z / texel) * texel);

		const c = this.camera;
		c.position.set(this.center.x, 10000, this.center.y);
		c.lookAt(this.center.x, 0, this.center.y);
		c.updateMatrixWorld();
		seaFloor.uSeaFloorMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);

		const parent = terrain.parent;
		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor(this.clearColor);
		setLiquidsVisible(false);
		this.scene.add(terrain);
		// Nothing drawn reads as no ground (green 0).
		renderer.setClearColor(0x000000, 0);
		renderer.setRenderTarget(this.target);
		renderer.render(this.scene, c);
		renderer.setRenderTarget(null);
		renderer.setClearColor(this.clearColor, clearAlpha);
		parent?.add(terrain);
		setLiquidsVisible(true);
	}
}
