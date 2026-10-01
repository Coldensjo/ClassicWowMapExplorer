import * as THREE from 'three';
import { setLiquidsVisible } from './terrainMaterials';

/** Texels across the height map. */
const SIZE = 1024;
/** Yards across the height map on the ground, and how much more per yard of altitude. */
const SPAN = 5000;
const SPAN_PER_ALTITUDE = 8;
const SPAN_MAX = 30000;
/** The map is redrawn this often (ms), sooner if the camera has moved this share of its span. */
const REDRAW_INTERVAL = 1000;
const REDRAW_MOVE = 0.1;

/**
 * Shared by every material that takes mountain shadows (see applyTerrainShadow).
 * uTerrainShadowRange: x = view distance the shadow maps reach (where these take over), y = strength (0 off, 1 full).
 */
export const terrainShadowUniforms = {
	uHeightMap: { value: null as THREE.Texture | null },
	/** World position to height map coordinates (xy, 0-1). */
	uHeightMatrix: { value: new THREE.Matrix4() },
	/** Towards the sun (or moon), and how far shadow rays look (yards). */
	uLightDir: { value: new THREE.Vector4(0, 1, 0, 1000) },
	uTerrainShadowRange: { value: new THREE.Vector2(400, 0) },
};

/**
 * Light from the sun reaching a point, as far as the terrain lets it: a ray towards the sun,
 * marched through the height map with steps growing with distance, softly shadowed by how
 * nearly any ridge on the way reaches it.
 */
const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uHeightMap;
uniform mat4 uHeightMatrix;
uniform vec4 uLightDir;
uniform vec2 uTerrainShadowRange;
varying vec3 vTerrainShadowWorld;
float terrainShadow(float viewDistance) {
	if (uTerrainShadowRange.y <= 0.0) return 1.0;
	float weight = smoothstep(uTerrainShadowRange.x * 0.85, uTerrainShadowRange.x, viewDistance);
	if (weight <= 0.0) return 1.0;
	vec3 dir = normalize(uLightDir.xyz);
	float across = length(dir.xz);
	if (dir.y <= 0.0 || across < 1e-3) return 1.0;
	vec2 walk = dir.xz / across;
	float rise = dir.y / across;
	vec3 p = vTerrainShadowWorld;
	float light = 1.0;
	for (int i = 1; i <= 20; i++) {
		float f = float(i) / 20.0;
		float t = uLightDir.w * f * f + 2.0;
		vec2 xz = p.xz + walk * t;
		vec4 uv = uHeightMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
		vec2 c = uv.xy * 0.5 + 0.5;
		if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) break;
		// Green says there's terrain there at all (nothing drawn stays 0).
		vec2 ground = texture2D(uHeightMap, c).rg;
		if (ground.g < 0.5) continue;
		// How far below the ray the ground is, against a penumbra growing with distance.
		float clearance = p.y + t * rise - ground.r;
		light = min(light, clamp(clearance / (t * 0.04 + 1.0) + 0.5, 0.0, 1.0));
	}
	return mix(1.0, mix(0.2, 1.0, smoothstep(0.0, 1.0, light)), weight * uTerrainShadowRange.y);
}
`;

/**
 * Gives a lit material shadows of mountains and hills beyond the reach of the shadow maps: the
 * sun's light on it is scaled by terrainShadow. Wraps whatever onBeforeCompile it has.
 */
export function applyTerrainShadow(material: THREE.Material): void {
	const base = material.onBeforeCompile;
	const baseKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		base.call(material, shader, renderer);
		Object.assign(shader.uniforms, terrainShadowUniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainShadowWorld;')
			.replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
				{
					vec4 p = vec4(transformed, 1.0);
					#ifdef USE_INSTANCING
						p = instanceMatrix * p;
					#endif
					vTerrainShadowWorld = (modelMatrix * p).xyz;
				}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${SHADOW_GLSL}`)
			.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
			.replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight );\n\t\tdirectLight.color *= terrainShadow( length( vViewPosition ) );');
	};
	material.customProgramCacheKey = () => `${baseKey()}-terrain-shadow`;
}

/**
 * Keeps the height map around the camera up to date: the terrain drawn from straight above,
 * each texel the height of the ground there.
 */
export class TerrainShadowPass {
	private readonly target: THREE.WebGLRenderTarget;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
	private readonly clearColor = new THREE.Color();
	private readonly center = new THREE.Vector2(Infinity, Infinity);
	private span = 0;
	private lastDraw = 0;

	constructor(renderer: THREE.WebGLRenderer) {
		const linearFloat = renderer.extensions.has('OES_texture_float_linear') && renderer.extensions.has('EXT_color_buffer_float');
		this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
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
				#include <logdepthbuf_pars_vertex>
				varying float vHeight;
				void main() {
					vec4 world = modelMatrix * vec4(position, 1.0);
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
		terrainShadowUniforms.uHeightMap.value = this.target.texture;
	}

	/** Redraws the map when it's due; strength: how dark the shadows are (0 for none, when it isn't drawn either). */
	update(renderer: THREE.WebGLRenderer, terrain: THREE.Object3D, position: THREE.Vector3, altitude: number, lightDir: THREE.Vector3, shadowRange: number, strength: number, now: number): void {
		const u = terrainShadowUniforms;
		u.uTerrainShadowRange.value.set(shadowRange, strength);
		const on = strength > 0;
		const span = Math.min(SPAN + altitude * SPAN_PER_ALTITUDE, SPAN_MAX);
		u.uLightDir.value.set(lightDir.x, lightDir.y, lightDir.z, span * 0.45);
		if (!on) return;
		const moved = Math.hypot(position.x - this.center.x, position.z - this.center.y) > this.span * REDRAW_MOVE;
		const resized = Math.abs(span - this.span) > this.span * 0.2;
		if (!moved && !resized && now - this.lastDraw < REDRAW_INTERVAL) return;
		this.lastDraw = now;
		this.span = span;
		this.center.set(position.x, position.z);

		const c = this.camera;
		c.left = -span / 2;
		c.right = span / 2;
		c.top = span / 2;
		c.bottom = -span / 2;
		c.position.set(position.x, 10000, position.z);
		c.lookAt(position.x, 0, position.z);
		c.updateProjectionMatrix();
		c.updateMatrixWorld();
		u.uHeightMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);

		const parent = terrain.parent;
		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor(this.clearColor);
		setLiquidsVisible(false);
		this.scene.add(terrain);
		renderer.setClearColor(0x000000, 0);
		renderer.setRenderTarget(this.target);
		renderer.render(this.scene, c);
		renderer.setRenderTarget(null);
		renderer.setClearColor(this.clearColor, clearAlpha);
		parent?.add(terrain);
		setLiquidsVisible(true);
	}
}
