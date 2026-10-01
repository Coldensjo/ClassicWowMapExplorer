import * as THREE from 'three';
import { setLiquidsVisible } from './terrainMaterials';

/** Texels across the height map (and the shade map worked out from it). */
const SIZE = 1024;
/** Yards across the height map on the ground, and how much more per yard of altitude. */
const SPAN = 5000;
const SPAN_PER_ALTITUDE = 8;
const SPAN_MAX = 30000;
/** The map is redrawn this often (ms), sooner if the camera has moved this share of its span. */
const REDRAW_INTERVAL = 1000;
const REDRAW_MOVE = 0.1;
/** The shade map is worked out again once the light has turned this far (cosine of the angle; about a quarter of a degree). */
const RESHADE_TURN = 0.99999;

/**
 * Shared by every material that takes mountain shadows (see applyTerrainShadow).
 * uTerrainShadowRange: x = view distance the shadow maps reach (where these take over), y = strength (0 off, 1 full).
 */
export const terrainShadowUniforms = {
	/** The shade map (see SHADE_FRAGMENT). */
	uTerrainShade: { value: null as THREE.Texture | null },
	/** World position to height map coordinates (xy, -1 to 1). */
	uHeightMatrix: { value: new THREE.Matrix4() },
	uTerrainShadowRange: { value: new THREE.Vector2(400, 0) },
};

/**
 * Works out the shade map, a texel for each of the height map's: light from the sun reaching
 * the ground there, as far as the terrain lets it. A ray towards the sun is marched through the
 * height map with steps growing with distance, softly shadowed by how nearly any ridge on the
 * way reaches it. Each ridge's shadow lightens with height above the ground (by 1 / its
 * penumbra per yard); the one that shades the ground most is kept for points above it, so a
 * tower or a tree can rise out of a valley's shadow.
 * Out: r = light on the ground (before clamping), g = how much more per yard up, b = the ground's height.
 */
const SHADE_FRAGMENT = /* glsl */ `
uniform sampler2D uHeightMap;
uniform mat4 uHeightInverse;
uniform mat4 uHeightMatrix;
// Towards the light, and how far shadow rays look (yards).
uniform vec4 uLightDir;
varying vec2 vUv;
void main() {
	vec2 here = texture2D(uHeightMap, vUv).rg;
	vec3 dir = normalize(uLightDir.xyz);
	float across = length(dir.xz);
	// No terrain here (green says there is), or the light straight overhead or below the horizon: lit.
	if (here.g < 0.5 || dir.y <= 0.0 || across < 1e-3) {
		gl_FragColor = vec4(2.0, 0.0, here.r, 1.0);
		return;
	}
	vec2 xz = (uHeightInverse * vec4(vUv * 2.0 - 1.0, 0.0, 1.0)).xz;
	vec2 walk = dir.xz / across;
	float rise = dir.y / across;
	float light = 2.0;
	float perYard = 0.0;
	for (int i = 1; i <= 20; i++) {
		float f = float(i) / 20.0;
		float t = uLightDir.w * f * f + 2.0;
		vec2 at = xz + walk * t;
		vec2 c = (uHeightMatrix * vec4(at.x, 0.0, at.y, 1.0)).xy * 0.5 + 0.5;
		if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) break;
		vec2 ground = texture2D(uHeightMap, c).rg;
		if (ground.g < 0.5) continue;
		// How far below the ray the ground is, against a penumbra growing with distance.
		float penumbra = t * 0.04 + 1.0;
		float l = (here.r + t * rise - ground.r) / penumbra + 0.5;
		if (l < light) {
			light = l;
			perYard = 1.0 / penumbra;
		}
	}
	// Kept within a little of the 0-1 range, so it blends smoothly between texels.
	gl_FragColor = vec4(clamp(light, -1.0, 2.0), perYard, here.r, 1.0);
}
`;

/** Light from the sun reaching a point, as far as the terrain lets it: read from the shade map. */
const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uTerrainShade;
uniform mat4 uHeightMatrix;
uniform vec2 uTerrainShadowRange;
varying vec3 vTerrainShadowWorld;
float terrainShadow(float viewDistance) {
	if (uTerrainShadowRange.y <= 0.0) return 1.0;
	float weight = smoothstep(uTerrainShadowRange.x * 0.85, uTerrainShadowRange.x, viewDistance);
	if (weight <= 0.0) return 1.0;
	vec3 p = vTerrainShadowWorld;
	vec2 c = (uHeightMatrix * vec4(p.x, 0.0, p.z, 1.0)).xy * 0.5 + 0.5;
	if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) return 1.0;
	vec3 shade = texture2D(uTerrainShade, c).rgb;
	float light = clamp(shade.r + (p.y - shade.b) * shade.g, 0.0, 1.0);
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
					#ifdef USE_BATCHING
						p = batchingMatrix * p;
					#endif
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
 * Keeps the height map around the camera up to date (the terrain drawn from straight above,
 * each texel the height of the ground there), and the shade map worked out from it.
 */
export class TerrainShadowPass {
	private readonly target: THREE.WebGLRenderTarget;
	private readonly shadeTarget: THREE.WebGLRenderTarget;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
	private readonly shadeScene = new THREE.Scene();
	private readonly shadeCamera = new THREE.OrthographicCamera();
	private readonly shadeUniforms = {
		uHeightMap: { value: null as THREE.Texture | null },
		uHeightInverse: { value: new THREE.Matrix4() },
		uHeightMatrix: terrainShadowUniforms.uHeightMatrix,
		uLightDir: { value: new THREE.Vector4(0, 1, 0, 1000) },
	};
	/** The light the shade map was last worked out for, and whether it's to be again. */
	private readonly shadedDir = new THREE.Vector3();
	private shadeDue = true;
	private readonly clearColor = new THREE.Color();
	private readonly center = new THREE.Vector2(Infinity, Infinity);
	private span = 0;
	private lastDraw = 0;

	constructor(renderer: THREE.WebGLRenderer) {
		const linearFloat = renderer.extensions.has('OES_texture_float_linear') && renderer.extensions.has('EXT_color_buffer_float');
		const options = {
			type: linearFloat ? THREE.FloatType : THREE.HalfFloatType,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: false,
		} as const;
		this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { ...options, format: THREE.RGFormat, depthBuffer: true });
		this.shadeTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, { ...options, format: THREE.RGBAFormat, depthBuffer: false });
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
		this.shadeUniforms.uHeightMap.value = this.target.texture;
		const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
			uniforms: this.shadeUniforms,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}`,
			fragmentShader: SHADE_FRAGMENT,
			depthTest: false,
			depthWrite: false,
		}));
		quad.frustumCulled = false;
		this.shadeScene.add(quad);
		terrainShadowUniforms.uTerrainShade.value = this.shadeTarget.texture;
	}

	/** Redraws the maps when they're due; strength: how dark the shadows are (0 for none, when they aren't drawn either). */
	update(renderer: THREE.WebGLRenderer, terrain: THREE.Object3D, position: THREE.Vector3, altitude: number, lightDir: THREE.Vector3, shadowRange: number, strength: number, now: number): void {
		const u = terrainShadowUniforms;
		u.uTerrainShadowRange.value.set(shadowRange, strength);
		if (strength <= 0) return;
		const span = Math.min(SPAN + altitude * SPAN_PER_ALTITUDE, SPAN_MAX);
		const moved = Math.hypot(position.x - this.center.x, position.z - this.center.y) > this.span * REDRAW_MOVE;
		const resized = Math.abs(span - this.span) > this.span * 0.2;
		const clearColor = renderer.getClearColor(this.clearColor);
		const clearAlpha = renderer.getClearAlpha();

		if (moved || resized || now - this.lastDraw >= REDRAW_INTERVAL) {
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
			this.shadeUniforms.uHeightInverse.value.copy(u.uHeightMatrix.value).invert();

			const parent = terrain.parent;
			setLiquidsVisible(false);
			this.scene.add(terrain);
			renderer.setClearColor(0x000000, 0);
			renderer.setRenderTarget(this.target);
			renderer.render(this.scene, c);
			parent?.add(terrain);
			setLiquidsVisible(true);
			this.shadeDue = true;
		}

		const dir = this.shadeUniforms.uLightDir.value;
		if (lightDir.dot(this.shadedDir) / (lightDir.length() * this.shadedDir.length() || 1) < RESHADE_TURN) this.shadeDue = true;
		if (!this.shadeDue) {
			renderer.setRenderTarget(null);
			renderer.setClearColor(clearColor, clearAlpha);
			return;
		}
		this.shadeDue = false;
		this.shadedDir.copy(lightDir);
		dir.set(lightDir.x, lightDir.y, lightDir.z, this.span * 0.45);
		renderer.setRenderTarget(this.shadeTarget);
		renderer.render(this.shadeScene, this.shadeCamera);
		renderer.setRenderTarget(null);
		renderer.setClearColor(clearColor, clearAlpha);
	}
}
