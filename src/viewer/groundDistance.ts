import * as THREE from 'three';
import { groundDistance, setLiquidsVisible } from './terrainMaterials';

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
