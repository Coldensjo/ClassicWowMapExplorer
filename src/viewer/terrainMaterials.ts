import * as THREE from 'three';
import type { SplatLayer } from '../explorer/splatMesh';
import type { LiquidLooks } from '../explorer/clientDb';
import type { LiquidKind } from '../formats/mh2o';
import { applyTerrainShadow } from './terrainShadow';

/** Colour the sea floor fades to with depth below sea level. */
const DEEP_WATER = new THREE.Color(0x0e2c3c);
/** Depth (yards) at which the sea floor is fully tinted. */
const DEEP_WATER_DEPTH = 45;

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

/**
 * Where the open sea is (1) and isn't (0), over the continents, from TerrainManager. Land below
 * sea level away from the coast (Thousand Needles) is dry; the sea plane and the sea-floor tint
 * only apply where this says sea. Until it's built, everywhere counts as sea.
 */
export const seaMask = {
	uSeaMask: { value: white as THREE.Texture },
	/** World x and z of the mask's corner, and 1 / its size in yards. */
	uSeaBounds: { value: new THREE.Vector4(0, 0, 0, 0) },
	/**
	 * A rectangle (min x, min z, max x, max z) the sea plane leaves out: the building-only map
	 * the camera is over, so it can be seen and entered though the sea would cover it.
	 */
	uSeaHole: { value: new THREE.Vector4(0, 0, 0, 0) },
};

// The mask at a world position; outside it, the given value (sea for the plane, which reaches
// past the continents; dry for terrain, which there is only dungeons).
const SEA_MASK = /* glsl */ `
uniform sampler2D uSeaMask;
uniform vec4 uSeaBounds;
uniform vec4 uSeaHole;
bool inSeaHole(vec2 xz) {
	return xz.x > uSeaHole.x && xz.y > uSeaHole.y && xz.x < uSeaHole.z && xz.y < uSeaHole.w;
}
float seaAt(vec2 xz, float outside) {
	vec2 uv = (xz - uSeaBounds.xy) * uSeaBounds.zw;
	if (uSeaBounds.z == 0.0) return 1.0;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return outside;
	return texture2D(uSeaMask, uv).r;
}
`;

const VERTEX_PARS = /* glsl */ `
#ifdef TERRAIN_SPLAT
	attribute float chunkIndex;
	varying float vChunk;
	varying vec2 vTileUv;
#endif
varying float vWorldY;
varying vec2 vWorldXZ;
`;

const VERTEX_MAIN = /* glsl */ `
#ifdef TERRAIN_SPLAT
	vChunk = chunkIndex;
	vTileUv = uv;
#endif
	vec4 terrainWorld = modelMatrix * vec4(transformed, 1.0);
	vWorldY = terrainWorld.y;
	vWorldXZ = terrainWorld.xz;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uDeepWater;
varying float vWorldY;
varying vec2 vWorldXZ;
${SEA_MASK}
#ifdef TERRAIN_SPLAT
	uniform sampler2D uAlpha;
	uniform sampler2D uDiffuse0;
	uniform sampler2D uDiffuse1;
	uniform sampler2D uDiffuse2;
	uniform sampler2D uDiffuse3;
	uniform sampler2D uHeight0;
	uniform sampler2D uHeight1;
	uniform sampler2D uHeight2;
	uniform sampler2D uHeight3;
	uniform vec4 uRepeats;
	uniform vec4 uHeightScale;
	uniform vec4 uHeightOffset;
	uniform vec4 uLayerMask;
	uniform float uHeightBlend;
	varying float vChunk;
	varying vec2 vTileUv;
#endif
`;

// Replaces <map_fragment>: blends up to four layers with the chunk's alpha maps, like the
// client's terrain shader (weights 1 - sum(a), a1, a2, a3, optionally sharpened by height).
const FRAGMENT_MAP = /* glsl */ `
#ifdef TERRAIN_SPLAT
{
	float ci = floor(vChunk + 0.5);
	vec2 chunk = vec2(mod(ci, 16.0), floor(ci / 16.0));
	vec2 local = clamp(vTileUv * 16.0 - chunk, 0.0, 1.0);
	// Sample the 64x64 map from its first to last texel centre, never the neighbour chunk.
	vec3 a = texture2D(uAlpha, (chunk + (0.5 + local * 63.0) / 64.0) / 16.0).rgb;

	vec2 c = vTileUv * 16.0;
	vec4 d0 = texture2D(uDiffuse0, c * uRepeats.x);
	vec4 d1 = texture2D(uDiffuse1, c * uRepeats.y);
	vec4 d2 = texture2D(uDiffuse2, c * uRepeats.z);
	vec4 d3 = texture2D(uDiffuse3, c * uRepeats.w);

	vec4 w = vec4(1.0 - clamp(a.r + a.g + a.b, 0.0, 1.0), a.r, a.g, a.b) * uLayerMask;
	if (uHeightBlend > 0.5) {
		vec4 h = vec4(
			texture2D(uHeight0, c * uRepeats.x).a,
			texture2D(uHeight1, c * uRepeats.y).a,
			texture2D(uHeight2, c * uRepeats.z).a,
			texture2D(uHeight3, c * uRepeats.w).a
		) * uHeightScale + uHeightOffset;
		w *= h;
		float m = max(max(w.x, w.y), max(w.z, w.w));
		w *= 1.0 - clamp(vec4(m) - w, 0.0, 1.0);
	}
	w /= max(dot(w, vec4(1.0)), 1e-4);
	diffuseColor.rgb *= d0.rgb * w.x + d1.rgb * w.y + d2.rgb * w.z + d3.rgb * w.w;
}
#else
	#include <map_fragment>
#endif
	// Sea floor only: land below sea level inland stays its own colour.
	diffuseColor.rgb = mix(diffuseColor.rgb, uDeepWater, clamp(-vWorldY / ${DEEP_WATER_DEPTH.toFixed(1)}, 0.0, 0.92) * seaAt(vWorldXZ, 0.0));
`;

function patch(material: THREE.MeshLambertMaterial, uniforms: Record<string, THREE.IUniform>, key: string): void {
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms, seaMask, { uDeepWater: { value: DEEP_WATER } });
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
			.replace('#include <map_fragment>', FRAGMENT_MAP);
	};
	material.customProgramCacheKey = () => key;
	applyTerrainShadow(material);
}

/** Low-detail terrain: the baked map texture, with the underwater tint. */
export function createFarMaterial(color: number): THREE.MeshLambertMaterial {
	const material = new THREE.MeshLambertMaterial({ color });
	patch(material, {}, 'terrain-far');
	return material;
}

/** Full-detail terrain for one group of chunks sharing the same texture layers. */
export function createSplatMaterial(
	alpha: THREE.Texture,
	layers: SplatLayer[],
	textures: Map<number, THREE.Texture | null>,
): THREE.MeshLambertMaterial {
	const material = new THREE.MeshLambertMaterial({ vertexColors: true });
	material.defines = { TERRAIN_SPLAT: '' };
	const slot = (i: number, key: 'diffuse' | 'height') => (layers[i] && textures.get(layers[i][key])) || white;
	const vec = (fn: (l: SplatLayer) => number, fallback: number) =>
		new THREE.Vector4(...[0, 1, 2, 3].map((i) => (layers[i] ? fn(layers[i]) : fallback)) as [number, number, number, number]);
	const uniforms: Record<string, THREE.IUniform> = {
		uAlpha: { value: alpha },
		uRepeats: { value: vec((l) => l.repeats, 8) },
		uHeightScale: { value: vec((l) => l.heightScale, 0) },
		uHeightOffset: { value: vec((l) => l.heightOffset, 1) },
		uLayerMask: { value: vec(() => 1, 0) },
		uHeightBlend: { value: layers.some((l) => l.height) ? 1 : 0 },
	};
	for (let i = 0; i < 4; i++) {
		uniforms[`uDiffuse${i}`] = { value: slot(i, 'diffuse') };
		uniforms[`uHeight${i}`] = { value: slot(i, 'height') };
	}
	patch(material, uniforms, 'terrain-splat');
	return material;
}

/** The per-tile alpha atlas: linear data, sampled without mipmaps so chunks never bleed. */
export function createAlphaTexture(data: Uint8Array, size: number): THREE.DataTexture {
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

/** Seconds, advanced by the viewer each frame; drives liquid animation. */
export const liquidTime: THREE.IUniform<number> = { value: 0 };

const LIQUID_VERTEX_PARS = 'varying vec3 vLiquidPos;';
// World position, including the instance transform when drawn instanced (WMO liquids).
const LIQUID_VERTEX_MAIN = /* glsl */ `{
	vec4 p = vec4(transformed, 1.0);
	#ifdef USE_INSTANCING
		p = instanceMatrix * p;
	#endif
	vLiquidPos = (modelMatrix * p).xyz;
}`;

// A few directional waves; returns the surface slope (d/dx, d/dz) at p.
const WAVES = /* glsl */ `
uniform float uTime;
varying vec3 vLiquidPos;
vec2 waveSlope(vec2 p, float t) {
	vec2 g = vec2(0.0);
	vec4 waves[4];
	waves[0] = vec4(normalize(vec2(1.0, 0.3)), 0.21, 1.1);
	waves[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.33, 1.5);
	waves[2] = vec4(normalize(vec2(0.7, -0.8)), 0.57, 1.9);
	waves[3] = vec4(normalize(vec2(-1.0, -0.2)), 1.13, 2.6);
	for (int i = 0; i < 4; i++) {
		float k = waves[i].z;
		g += waves[i].xy * cos(dot(waves[i].xy, p) * k + t * waves[i].w) * 0.09;
	}
	return g;
}
`;

/**
 * The distance from the camera to the ground under each pixel (GroundDistancePass), and the
 * screen's size in pixels to look it up by. 0 where there's no ground: deep water.
 */
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;
export const groundDistance = {
	uGroundDistance: { value: black as THREE.Texture },
	uScreenSize: { value: new THREE.Vector2(1, 1) },
};

/** A tile's river flow map and where the tile's corner is (world x and z), on a liquid mesh's userData.flow. */
export interface FlowBinding {
	texture: THREE.Texture;
	x: number;
	z: number;
}

/** A tile's size in yards (formats/adt TILE_SIZE), over which its flow map is stretched. */
const FLOW_TILE_SIZE = 1600 / 3;

/** Ripple texture coordinates per second per unit of flow (the map's -0.5 to 0.5 doubled). */
const FLOW_SPEED = 1.2;

/** 1 while the camera is under water: surfaces are seen from below, where depth means nothing. */
const fromBelow: THREE.IUniform<number> = { value: 0 };

type WaterKind = Exclude<LiquidKind, 'magma'>;

/**
 * Shore to deep colours and the colour of light on the ripples, for liquid types that don't
 * name their own (the older ones).
 */
const DEFAULT_LOOKS: Record<WaterKind, { colors: [number, number, number]; foam: number }> = {
	water: { colors: [0x4f9fb0, 0x2f7390, 0x1b4d6a], foam: 0xc8eef0 },
	ocean: { colors: [0x5fb5b5, 0x2f7c90, 0x163f5a], foam: 0xd0f0ee },
	slime: { colors: [0x8cad48, 0x5a8a28, 0x2e4f10], foam: 0xc8dc90 },
};

interface WaterUniforms {
	uShallow: THREE.IUniform<THREE.Color>;
	uMid: THREE.IUniform<THREE.Color>;
	uDeep: THREE.IUniform<THREE.Color>;
	uFoam: THREE.IUniform<THREE.Color>;
}

/** The colour uniforms of each water material. */
const waterUniforms = new WeakMap<THREE.Material, WaterUniforms>();

/**
 * Water as the game draws it: light and clear where it's shallow, through to its deep colour
 * and nearly opaque further out, with the game's animated ripples on top (its lake and sea
 * textures hold them in their alpha, as light caught on the crests), the sky mirrored at low
 * angles and sun glints off the ripples. Slime's texture is its colour instead. How deep it is
 * under each pixel comes from the ground distance pass.
 */
function waterMaterial(kind: WaterKind, opacity: number, sea = false, flow: FlowBinding | null = null): THREE.MeshPhongMaterial {
	const material = new THREE.MeshPhongMaterial({ specular: 0x9ab4c8, shininess: 80, transparent: true, opacity, depthWrite: false });
	const water: WaterUniforms = {
		uShallow: { value: new THREE.Color() },
		uMid: { value: new THREE.Color() },
		uDeep: { value: new THREE.Color() },
		uFoam: { value: new THREE.Color() },
	};
	waterUniforms.set(material, water);
	// The river flow map of the tile this copy is for: x, y the tile's corner (world x, z), z 1 / its size, w 1 if there's one.
	const flowUniforms = {
		uFlowMap: { value: flow?.texture ?? white },
		uFlowTile: { value: new THREE.Vector4(flow?.x ?? 0, flow?.z ?? 0, 1 / FLOW_TILE_SIZE, flow ? 1 : 0) },
	};
	const book = kind === 'water' ? flipbooks.lake : flipbooks[kind];
	const slime = kind === 'slime';
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, water, book.uniforms, groundDistance, flowUniforms, { uTime: liquidTime, uFromBelow: fromBelow });
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
${LIQUID_VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>
${LIQUID_VERTEX_MAIN}`);
		if (sea) Object.assign(shader.uniforms, seaMask);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', /* glsl */ `#include <common>
				uniform vec3 uShallow;
				uniform vec3 uMid;
				uniform vec3 uDeep;
				uniform vec3 uFoam;
				uniform sampler2D uGroundDistance;
				uniform vec2 uScreenSize;
				uniform float uFromBelow;
				${WAVES}${FLIPBOOK}${FLOWING_FLIPBOOK}${sea ? SEA_MASK : ''}`)
			.replace('#include <clipping_planes_fragment>', sea
				// The sea plane: nothing where there's no open sea. Nor on the pixel row at its horizon,
				// where antialiasing works out the depth at pixel centres just past the sea's edge and
				// gets nonsense (in front of everything): a line through the trees and hills.
				? /* glsl */ `#include <clipping_planes_fragment>
					if (seaAt(vLiquidPos.xz, 1.0) < 0.5 || inSeaHole(vLiquidPos.xz)) discard;
					#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
						if (!(vFragDepth >= 1.0)) discard;
					#endif`
				: '#include <clipping_planes_fragment>')
			.replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
				// How steeply the surface is seen (1 straight down), and the depth of water under it:
				// the stretch of view ray between surface and ground, stood upright.
				float facing = abs(dot(normalize(vViewPosition), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
				float depth = 1000.0;
				if (uFromBelow < 0.5) {
					float ground = texture2D(uGroundDistance, gl_FragCoord.xy / uScreenSize).r;
					if (ground > 0.0) depth = max(ground - length(vViewPosition), 0.0) * max(facing, 0.05);
				}
				// The middle colour is a light tint that washes out under direct light; a touch of it only.
				vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 7.0, depth));
				water = mix(water, uMid, 0.15 * (1.0 - smoothstep(0.0, 3.0, depth)));
				vec2 rippleUv = vLiquidPos.xz / ${book.repeat.toFixed(1)};
				setFlow(vLiquidPos.xz);
				vec4 frame = uFramesLoaded > 0.5 ? flowingFlipbook(rippleUv) : vec4(0.0);
				${slime
					? /* glsl */ `if (uFramesLoaded > 0.5) water = frame.rgb * mix(1.0, 0.7, smoothstep(0.0, 7.0, depth));
					float ripple = 0.0;`
					: 'float ripple = uFromBelow < 0.5 ? frame.a : frame.a * 0.4;'}
				// Far off the ripples blur to an even sheen, and their repeats would show.
				ripple *= 1.0 - smoothstep(60.0, 250.0, length(vViewPosition)) * 0.7;
				diffuseColor.rgb = mix(water, uFoam, ripple * 0.3);
				// The ground shows through the shallows, with a soft edge where the water meets it.
				diffuseColor.a = mix(0.2, diffuseColor.a, smoothstep(0.0, 8.0, depth));
				diffuseColor.a = max(diffuseColor.a, ripple * 0.5) * smoothstep(0.0, 0.12, depth);`)
			// The sun glints off the ripples, not the whole surface.
			.replace('#include <specularmap_fragment>', /* glsl */ `#include <specularmap_fragment>
				specularStrength = ${slime ? '0.3' : 'uFramesLoaded > 0.5 ? 0.15 + ripple * 1.6 : 1.0'};`)
			.replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
				// Gentle swell, and the ripples' own slopes for glints that follow them.
				vec2 slope = waveSlope(vLiquidPos.xz, uTime) * 0.35;
				${slime ? '' : /* glsl */ `if (uFramesLoaded > 0.5) {
					float texel = 1.5 / 256.0;
					slope += vec2(flowingFlipbook(rippleUv + vec2(texel, 0.0)).a - frame.a, flowingFlipbook(rippleUv + vec2(0.0, texel)).a - frame.a) * 0.6;
				}`}
				normal = normalize((viewMatrix * vec4(-slope.x, 1.0, -slope.y, 0.0)).xyz);`)
			.replace('#include <opaque_fragment>', /* glsl */ `
				// More opaque, and mirroring the sky, at low angles.
				diffuseColor.a = mix(0.97, diffuseColor.a, facing);
				#ifdef USE_FOG
					outgoingLight = mix(outgoingLight, fogColor, pow(1.0 - facing, 4.0) * 0.55 * (1.0 - ripple) * (1.0 - uFromBelow));
				#endif
				#include <opaque_fragment>`);
	};
	material.customProgramCacheKey = () => (sea ? 'liquid-sea' : `liquid-${kind}`);
	return material;
}

/**
 * One of the game's animated liquid textures (XTextures\<kind>\<name>.1-30.blp). Their file IDs
 * were handed out in name order (1, 10, 11, … 19, 2, 20, …), so the first is enough to find
 * them all; they're unnamed in this build.
 */
class Flipbook {
	readonly ids: number[];
	/** The two frames shown now and how far between them, set by animate. */
	readonly uniforms = {
		uFrameA: { value: white as THREE.Texture },
		uFrameB: { value: white as THREE.Texture },
		uFrameBlend: { value: 0 },
		uFramesLoaded: { value: 0 },
	};
	private frames: THREE.Texture[] = [];

	/** fps: neighbouring frames are blended, so it flows rather than steps. repeat: yards one repeat of the texture covers. */
	constructor(firstId: number, count: number, private fps: number, readonly repeat: number) {
		const names = Array.from({ length: count }, (_, i) => String(i + 1)).sort();
		this.ids = Array.from({ length: count }, (_, i) => firstId + names.indexOf(String(i + 1)));
	}

	/** Hands over the frames once they're read. */
	setFrames(frames: THREE.Texture[]): void {
		this.frames = frames;
		this.uniforms.uFramesLoaded.value = frames.length ? 1 : 0;
	}

	/** Picks the frames for a time in seconds. */
	animate(seconds: number): void {
		if (!this.frames.length) return;
		const f = seconds * this.fps;
		const i = Math.floor(f);
		this.uniforms.uFrameA.value = this.frames[i % this.frames.length];
		this.uniforms.uFrameB.value = this.frames[(i + 1) % this.frames.length];
		this.uniforms.uFrameBlend.value = f - i;
	}
}

/** The flipbook frame now, in a shader that has a Flipbook's uniforms. */
const FLIPBOOK = /* glsl */ `
uniform sampler2D uFrameA;
uniform sampler2D uFrameB;
uniform float uFrameBlend;
uniform float uFramesLoaded;
vec4 flipbook(vec2 uv) {
	return mix(texture2D(uFrameA, uv), texture2D(uFrameB, uv), uFrameBlend);
}
`;

/**
 * The flipbook carried along by the river's flow where the tile has a flow map: two copies
 * drifting downstream half a cycle apart, each faded out as it resets, so it never stretches.
 */
const FLOWING_FLIPBOOK = /* glsl */ `
uniform sampler2D uFlowMap;
uniform vec4 uFlowTile;
vec2 flowHere = vec2(0.0);
void setFlow(vec2 xz) {
	if (uFlowTile.w < 0.5) return;
	vec2 f = texture2D(uFlowMap, (xz - uFlowTile.xy) * uFlowTile.z).rg - 0.5;
	flowHere = vec2(-f.x, f.y) * 2.0;
}
vec4 flowingFlipbook(vec2 uv) {
	// Still water (the map's 128, a hair off its middle) keeps the plain ripples.
	float moving = smoothstep(0.02, 0.06, length(flowHere));
	if (moving <= 0.0) return flipbook(uv);
	float cycle = uTime * 0.5;
	float p0 = fract(cycle);
	float p1 = fract(cycle + 0.5);
	vec2 drift = flowHere * ${FLOW_SPEED.toFixed(2)} * 2.0;
	vec4 a = flipbook(uv - drift * p0);
	vec4 b = flipbook(uv - drift * p1 + vec2(0.37, 0.61));
	return mix(flipbook(uv), mix(a, b, abs(p0 - 0.5) * 2.0), moving);
}
`;

/** The game's liquid animations: lakes and rivers, the sea, slime and lava. */
export const flipbooks = {
	lake: new Flipbook(219901, 30, 10, 8),
	ocean: new Flipbook(219855, 30, 10, 14),
	slime: new Flipbook(219991, 30, 8, 12),
	lava: new Flipbook(219795, 30, 8, 12),
};

/** Moves every liquid animation on to a time in seconds; call every frame. */
export function animateFlipbooks(seconds: number): void {
	for (const book of Object.values(flipbooks)) book.animate(seconds);
}

/**
 * Lava: the game's animated lava texture, unlit, as it's its own light source. Until the frames
 * are read, a churning stand-in of the same colour.
 */
function magmaMaterial(color: number): THREE.MeshBasicMaterial {
	const material = new THREE.MeshBasicMaterial({ color });
	const lava = flipbooks.lava;
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, lava.uniforms, { uTime: liquidTime });
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${LIQUID_VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${LIQUID_VERTEX_MAIN}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', /* glsl */ `#include <common>
				uniform float uTime;
				varying vec3 vLiquidPos;
				${FLIPBOOK}`)
			.replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
				if (uFramesLoaded > 0.5) {
					diffuseColor.rgb = flipbook(vLiquidPos.xz / ${lava.repeat.toFixed(1)}).rgb;
				} else {
					vec2 p = vLiquidPos.xz * 0.35;
					float t = uTime * 0.25;
					float n = sin(p.x + sin(p.y * 1.3 + t) * 1.7 + t) * sin(p.y * 0.8 - sin(p.x * 1.1 - t) * 1.4 - t * 0.7);
					diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.05, 0.03), smoothstep(0.35, 0.9, n) * 0.85);
				}`);
	};
	material.customProgramCacheKey = () => 'liquid-magma';
	return material;
}

/**
 * Draws liquid surfaces from above or, under water, from below (where the surface shows
 * overhead, as in the game). One side at a time: two-sided see-through surfaces cost two passes.
 */
export function setLiquidsFromBelow(below: boolean): void {
	fromBelow.value = below ? 1 : 0;
	const side = below ? THREE.BackSide : THREE.FrontSide;
	for (const m of kinds.keys()) {
		if (m.side === side) continue;
		m.side = side;
		m.needsUpdate = true;
	}
}

/** Hides every liquid surface, for the ground distance pass. */
export function setLiquidsVisible(visible: boolean): void {
	for (const m of kinds.keys()) m.visible = visible;
}

/** Which kind of liquid a surface is, by its material (for telling what the camera is in). */
export function liquidKindOf(material: THREE.Material | THREE.Material[]): LiquidKind | null {
	return Array.isArray(material) ? null : kinds.get(material) ?? null;
}

/** Every liquid material, and the kind of liquid it draws. */
const kinds = new Map<THREE.Material, LiquidKind>();
/** Water materials per liquid kind and type, each with its type's colours. */
const byType = new Map<string, { kind: WaterKind; type: number; material: THREE.Material }>();
let looks: LiquidLooks | null = null;

/** The liquid type's own colours where it has them (the newer types), else its kind's. */
function applyLook(material: THREE.Material, kind: WaterKind, type: number): void {
	const water = waterUniforms.get(material);
	if (!water) return;
	const own = looks?.types[type];
	const look = own?.colors[2] ? own : DEFAULT_LOOKS[kind];
	water.uShallow.value.setHex(look.colors[0]);
	water.uMid.value.setHex(look.colors[1]);
	water.uDeep.value.setHex(look.colors[2]);
	water.uFoam.value.setHex(look.foam || DEFAULT_LOOKS[kind].foam);
}

const OPACITY: Record<WaterKind, number> = { water: 0.85, ocean: 0.94, slime: 0.92 };

/**
 * The material for a liquid surface of a given LiquidType. With a flow map, a copy of its own
 * that carries the ripples downstream; hand it back with releaseLiquidMaterial when the tile goes.
 */
export function liquidMaterial(kind: LiquidKind, type: number, flow: FlowBinding | null = null): THREE.Material {
	if (kind === 'magma') return liquidMaterials.magma;
	if (flow) {
		const material = waterMaterial(kind, OPACITY[kind], false, flow);
		material.side = fromBelow.value ? THREE.BackSide : THREE.FrontSide;
		applyLook(material, kind, type);
		kinds.set(material, kind);
		flowing.set(material, { kind, type });
		return material;
	}
	const key = `${kind}:${type}`;
	let entry = byType.get(key);
	if (!entry) {
		const material = waterMaterial(kind, OPACITY[kind]);
		material.side = fromBelow.value ? THREE.BackSide : THREE.FrontSide;
		applyLook(material, kind, type);
		kinds.set(material, kind);
		entry = { kind, type, material };
		byType.set(key, entry);
	}
	return entry.material;
}

/** Copies made for flowing water (see liquidMaterial), with what they're of. */
const flowing = new Map<THREE.Material, { kind: WaterKind; type: number }>();

/** Done with a liquid material: frees it if it was a copy of its own, for a flow map. */
export function releaseLiquidMaterial(material: THREE.Material): void {
	if (!flowing.delete(material)) return;
	kinds.delete(material);
	material.dispose();
}

/** Gives the liquids their colours once LiquidType.db2 has been read. */
export function setLiquidLooks(value: LiquidLooks): void {
	looks = value;
	for (const { kind, type, material } of byType.values()) applyLook(material, kind, type);
	for (const [material, { kind, type }] of flowing) applyLook(material, kind, type);
	applyLook(liquidMaterials.ocean, 'ocean', value.ocean);
}

/** The sea plane's material, lava's, and the defaults per kind. */
export const liquidMaterials = {
	water: waterMaterial('water', OPACITY.water),
	ocean: waterMaterial('ocean', OPACITY.ocean, true),
	slime: waterMaterial('slime', OPACITY.slime),
	magma: magmaMaterial(0xff5b14),
};
for (const kind of ['water', 'ocean', 'slime'] as const) applyLook(liquidMaterials[kind], kind, 0);
for (const [kind, material] of Object.entries(liquidMaterials)) kinds.set(material, kind as LiquidKind);