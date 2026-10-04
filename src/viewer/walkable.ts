import * as THREE from 'three';

/**
 * The steepest ground the game lets you walk up: about 50 degrees. Past that you slide off.
 * Compared against the up component of the surface's normal, cos(50°).
 */
export const WALKABLE = Math.cos(THREE.MathUtils.degToRad(50));
/** Slopes within this many degrees under the limit are marked as close to it. */
const NEAR_LIMIT = 5;

/** 1 while surfaces are tinted by whether they can be walked on; shared by every patched material. */
const walkableUniforms = {
	uWalkable: { value: 0 },
};

/** Tints terrain and buildings green where they can be walked on and red where they're too steep. */
export function setWalkableShown(shown: boolean): void {
	walkableUniforms.uWalkable.value = shown ? 1 : 0;
}

// Each triangle's own slope, not the smoothed vertex normals: the game collides with the
// triangles. Facing the camera, so a ceiling seen from below counts as steep.
const WALKABLE_GLSL = /* glsl */ `
uniform float uWalkable;
varying vec3 vWalkableView;
vec3 walkableTint(vec3 color) {
	vec3 n = normalize(cross(dFdx(vWalkableView), dFdy(vWalkableView)));
	if (dot(n, vWalkableView) > 0.0) n = -n;
	float up = (vec4(n, 0.0) * viewMatrix).y;
	float walkable = ${WALKABLE.toFixed(4)};
	float nearLimit = ${Math.cos(THREE.MathUtils.degToRad(50 - NEAR_LIMIT)).toFixed(4)};
	vec3 tint = up >= nearLimit ? vec3(0.25, 0.9, 0.3) : up >= walkable ? vec3(1.0, 0.75, 0.15) : vec3(0.95, 0.2, 0.15);
	// Keep some of the light and texture so the shapes still read.
	float light = dot(color, vec3(0.299, 0.587, 0.114));
	return mix(color, tint * (0.35 + 0.9 * light), 0.7);
}
`;

/** Lets a material show walkable slopes (see setWalkableShown). Wraps whatever onBeforeCompile it has. */
export function applyWalkable(material: THREE.Material): void {
	const base = material.onBeforeCompile;
	const baseKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		base.call(material, shader, renderer);
		Object.assign(shader.uniforms, walkableUniforms);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vWalkableView;')
			.replace('#include <project_vertex>', '#include <project_vertex>\nvWalkableView = mvPosition.xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${WALKABLE_GLSL}`)
			.replace('#include <opaque_fragment>', 'if (uWalkable > 0.5) outgoingLight = walkableTint(outgoingLight);\n#include <opaque_fragment>');
	};
	material.customProgramCacheKey = () => `${baseKey()}-walkable`;
}
