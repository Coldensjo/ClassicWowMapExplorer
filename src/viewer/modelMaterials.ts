import * as THREE from 'three';
import type { ModelMaterial } from '../explorer/objects';
import { Blend } from '../formats/m2';

/**
 * A material for one M2 or WMO batch, following the file's blend mode and flags. baked: the
 * geometry has a 'baked' attribute (WMO interior lighting), see applyBakedLighting.
 */
export function createModelMaterial(m: ModelMaterial, texture: THREE.Texture | null, baked: boolean): THREE.Material {
	const params: THREE.MeshLambertMaterialParameters = {
		map: texture,
		color: texture ? 0xffffff : 0x8a8a80,
		side: m.twoSided ? THREE.DoubleSide : THREE.FrontSide,
		fog: !m.unfogged,
		opacity: m.opacity,
		transparent: m.opacity < 1,
	};
	const material = m.unlit ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
	if (baked && material instanceof THREE.MeshLambertMaterial) applyBakedLighting(material);

	switch (m.blend) {
		case Blend.Opaque:
			break;
		case Blend.AlphaKey:
			material.alphaTest = 0.5;
			break;
		case Blend.Alpha:
			material.transparent = true;
			material.depthWrite = false;
			break;
		case Blend.NoAlphaAdd:
		case Blend.Add:
		case Blend.BlendAdd:
			material.transparent = true;
			material.depthWrite = false;
			material.blending = THREE.AdditiveBlending;
			break;
		case Blend.Mod:
		case Blend.Mod2x:
			material.transparent = true;
			material.depthWrite = false;
			material.blending = THREE.CustomBlending;
			material.blendSrc = THREE.DstColorFactor;
			material.blendDst = m.blend === Blend.Mod2x ? THREE.SrcColorFactor : THREE.ZeroFactor;
			break;
	}
	return material;
}

// Point lights (the torch) are summed first in lights_fragment_begin; snapshot them before the
// spot and directional lights are added, so interiors can keep the torch but drop the sun.
const LIGHTS_BEGIN_WITH_TORCH = THREE.ShaderChunk.lights_fragment_begin.replace(
	'#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
	'vec3 torchDirect = reflectedLight.directDiffuse;\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
);

/**
 * WMO interiors are lit by baked vertex colours, not the sun: per vertex, baked.a blends from
 * normal lighting (0) to baked.rgb as the ambient light plus only the torch as direct light (1).
 */
function applyBakedLighting(material: THREE.MeshLambertMaterial): void {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute vec4 baked;\nvarying vec4 vBaked;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBaked = baked;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying vec4 vBaked;')
			.replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_WITH_TORCH)
			.replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
				reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, torchDirect, vBaked.a);
				reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, diffuseColor.rgb * vBaked.rgb, vBaked.a);`);
	};
	material.customProgramCacheKey = () => 'wmo-baked';
}
