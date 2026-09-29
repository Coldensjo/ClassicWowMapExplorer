import * as THREE from 'three';
import type { SplatLayer } from '../explorer/splatMesh';

/** Colour the sea floor fades to with depth below sea level. */
const DEEP_WATER = new THREE.Color(0x0e2c3c);
/** Depth (yards) at which the sea floor is fully tinted. */
const DEEP_WATER_DEPTH = 45;

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

const VERTEX_PARS = /* glsl */ `
#ifdef TERRAIN_SPLAT
	attribute float chunkIndex;
	varying float vChunk;
	varying vec2 vTileUv;
#endif
varying float vWorldY;
`;

const VERTEX_MAIN = /* glsl */ `
#ifdef TERRAIN_SPLAT
	vChunk = chunkIndex;
	vTileUv = uv;
#endif
	vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uDeepWater;
varying float vWorldY;
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
	diffuseColor.rgb = mix(diffuseColor.rgb, uDeepWater, clamp(-vWorldY / ${DEEP_WATER_DEPTH.toFixed(1)}, 0.0, 0.92));
`;

function patch(material: THREE.MeshLambertMaterial, uniforms: Record<string, THREE.IUniform>, key: string): void {
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms, { uDeepWater: { value: DEEP_WATER } });
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
			.replace('#include <map_fragment>', FRAGMENT_MAP);
	};
	material.customProgramCacheKey = () => key;
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

/** Water: rippling normals for moving sun glints, and more opaque at grazing angles. */
function waterMaterial(color: number, opacity: number): THREE.MeshPhongMaterial {
	const material = new THREE.MeshPhongMaterial({ color, specular: 0x9ab4c8, shininess: 120, transparent: true, opacity, depthWrite: false });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = liquidTime;
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${LIQUID_VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${LIQUID_VERTEX_MAIN}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${WAVES}`)
			.replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
				vec2 slope = waveSlope(vLiquidPos.xz, uTime) + waveSlope(vLiquidPos.xz * 3.1, uTime * 1.7) * 0.5;
				normal = normalize((viewMatrix * vec4(-slope.x, 1.0, -slope.y, 0.0)).xyz);`)
			.replace('#include <opaque_fragment>', /* glsl */ `
				float facing = abs(dot(normalize(vViewPosition), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
				diffuseColor.a = mix(0.97, diffuseColor.a, facing);
				#include <opaque_fragment>`);
	};
	material.customProgramCacheKey = () => 'liquid-water';
	return material;
}

/** Lava: a slowly churning glow. Unlit, as it's its own light source. */
function magmaMaterial(color: number): THREE.MeshBasicMaterial {
	const material = new THREE.MeshBasicMaterial({ color });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = liquidTime;
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\n${LIQUID_VERTEX_PARS}`)
			.replace('#include <project_vertex>', `#include <project_vertex>\n${LIQUID_VERTEX_MAIN}`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${WAVES}`)
			.replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
				vec2 p = vLiquidPos.xz * 0.35;
				float t = uTime * 0.25;
				float n = sin(p.x + sin(p.y * 1.3 + t) * 1.7 + t) * sin(p.y * 0.8 - sin(p.x * 1.1 - t) * 1.4 - t * 0.7);
				float crust = smoothstep(0.35, 0.9, n);
				diffuseColor.rgb = mix(diffuseColor.rgb * 1.25, vec3(0.16, 0.05, 0.03), crust * 0.85);`);
	};
	material.customProgramCacheKey = () => 'liquid-magma';
	return material;
}

export const liquidMaterials = {
	water: waterMaterial(0x2a5c75, 0.72),
	ocean: waterMaterial(0x1b4a66, 0.9),
	slime: waterMaterial(0x4f7d24, 0.88),
	magma: magmaMaterial(0xff5b14),
};