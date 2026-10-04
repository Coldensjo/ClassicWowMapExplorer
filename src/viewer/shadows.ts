import * as THREE from 'three';
import type { SunLight } from 'three/addons/lights/SunLight.js';

/** How a mesh takes part in the sun's shadows: casts and receives, casts only up close (small things), or only receives. */
export type ShadowRole = 'cast' | 'near' | 'receive';

/** The far cascade's culling frustum, which small things stay out of. */
let farCascade: THREE.Frustum | null = null;

/** The light whose cascades 'near' meshes keep to the first of. */
export function setShadowLight(light: SunLight): void {
	farCascade = light.shadow.getFrustum(1);
}

/**
 * Marks a material as one that casts no shadow even on a mesh that does: glows, beams and
 * other see-through or added-on surfaces, which would otherwise cast as solid shapes.
 */
export function setNoShadow(material: THREE.Material): void {
	material.userData.noShadow = true;
}

type Group = THREE.BufferGeometry['groups'][number];

/**
 * Material groups as the shadow pass needs them, swapped in for its length. The pass draws each
 * group of a mesh separately, yet most draw with the same depth material: runs of those are
 * merged into one draw, and groups that cast nothing are left out. A model's dozen batches
 * become one or two draws, a terrain tile's dozens of texture groups one.
 */
const shadowGroups = new Map<THREE.BufferGeometry, { own: Group[]; shadow: Group[] }>();
let swapped = false;

/**
 * Which depth material the shadow pass will use for a material: '' for plain depth, the texture
 * for alpha-tested ones (leaves, railings), null for those that cast nothing.
 */
function depthKey(material: THREE.Material | undefined): string | null {
	if (!material || material.userData.noShadow || !material.visible) return null;
	const map = (material as THREE.MeshLambertMaterial).map;
	return material.alphaTest > 0 && map ? `${map.id}:${material.alphaTest}` : '';
}

/** Sorted, merged index ranges [start, end). */
function union(ranges: [number, number][]): [number, number][] {
	const out: [number, number][] = [];
	for (const [a, b] of ranges.sort((x, y) => x[0] - y[0])) {
		const last = out[out.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else out.push([a, b]);
	}
	return out;
}

/**
 * Depth doesn't depend on draw order or on which material drew a triangle, so a mesh's casting
 * triangles can be drawn as few ranges as possible: every plain-depth group's triangles as one
 * union (one- and two-sided alike, drawn two-sided), then each alpha-tested texture's, less any
 * already covered (models often draw the same triangles twice, as a base and a glow layer).
 */
function register(geometry: THREE.BufferGeometry, materials: THREE.Material[]): void {
	if (shadowGroups.has(geometry) || !geometry.groups.length) return;
	const byKey = new Map<string, { ranges: [number, number][]; material: number; doubleSided: boolean }>();
	for (const g of geometry.groups) {
		const index = g.materialIndex ?? 0;
		const key = depthKey(materials[index]);
		if (key === null) continue;
		const entry = byKey.get(key) ?? { ranges: [], material: index, doubleSided: false };
		entry.ranges.push([g.start, g.start + g.count]);
		// Drawn with a two-sided material if any of its groups is, so none of their faces is lost.
		if (materials[index].side === THREE.DoubleSide && !entry.doubleSided) {
			entry.material = index;
			entry.doubleSided = true;
		}
		byKey.set(key, entry);
	}
	const shadow: Group[] = [];
	const plain = byKey.get('');
	const covered = plain ? union(plain.ranges) : [];
	for (const [a, b] of covered) shadow.push({ start: a, count: b - a, materialIndex: plain!.material });
	for (const [key, entry] of byKey) {
		if (key === '') continue;
		for (const [a, b] of union(entry.ranges)) {
			if (covered.some(([c, d]) => c <= a && b <= d)) continue;
			shadow.push({ start: a, count: b - a, materialIndex: entry.material });
		}
	}
	shadowGroups.set(geometry, { own: geometry.groups, shadow });
	geometry.addEventListener('dispose', () => {
		if (swapped) geometry.groups = shadowGroups.get(geometry)?.own ?? geometry.groups;
		shadowGroups.delete(geometry);
	});
}

/**
 * The sun's shadows fall on this mesh and, by its role, it casts them (bar its setNoShadow
 * materials). Small things cast only in the near cascade: further off their shadows are a few
 * texels, and a town's worth of crates and fences would cost the far cascade hundreds of draws.
 */
export function useShadows(mesh: THREE.Mesh, role: ShadowRole = 'cast'): void {
	mesh.receiveShadow = true;
	if (role === 'receive') return;
	mesh.castShadow = true;
	register(mesh.geometry, Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
	if (role === 'near') {
		const test = mesh.intersectsFrustum;
		mesh.intersectsFrustum = (frustum) => frustum !== farCascade && test.call(mesh, frustum);
	}
}

/**
 * Swaps the shadow groups in for the shadow pass. Three draws a frame as: list what's in view,
 * render the shadow maps, draw the list; the list has its groups by then, so the swap can only
 * come between. This sentinel, first in the scene, is the shadow pass's first draw: it swaps,
 * and the scene's onAfterRender swaps back.
 */
export function installShadowGroups(scene: THREE.Scene): void {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
	const sentinel = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
	sentinel.castShadow = true;
	sentinel.frustumCulled = false;
	sentinel.onBeforeShadow = () => {
		if (swapped) return;
		swapped = true;
		for (const [g, groups] of shadowGroups) g.groups = groups.shadow;
	};
	scene.add(sentinel);
	scene.children.unshift(scene.children.pop()!);
	const after = scene.onAfterRender;
	scene.onAfterRender = (...args) => {
		after.apply(scene, args);
		if (!swapped) return;
		swapped = false;
		for (const [g, groups] of shadowGroups) g.groups = groups.own;
	};
}

/** The side three's shadow pass draws a material's faces with (WebGLShadowMap's shadowSide). */
const SHADOW_SIDE: Record<THREE.Side, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

/**
 * Stand-ins for how the shadow pass will draw an object's meshes: the depth materials three
 * picks for them (WebGLShadowMap's getDepthMaterial), on the same kind of mesh. Compiled ahead
 * (with Post.compileAsync's shadowPass), the first shadow drawn of a new kind of model doesn't
 * stop the frame to build its shader. Only meshes set to cast count; those with their own depth
 * material are left to whoever made it. The materials are kept, never disposed: that would let three delete the programs.
 */
export function shadowStandIns(object: THREE.Object3D): THREE.Object3D[] {
	const out: THREE.Object3D[] = [];
	const seen = new Set<string>();
	object.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh || !mesh.castShadow || mesh.customDepthMaterial || (mesh as unknown as THREE.BatchedMesh).isBatchedMesh) return;
		const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
		for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
			if (depthKey(m) === null) continue;
			const { map, alphaMap } = m as THREE.MeshLambertMaterial;
			const alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
			const side = m.shadowSide ?? SHADOW_SIDE[m.side];
			const key = `${instanced} ${!!map} ${!!alphaMap} ${alphaTest > 0} ${side}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const depth = new THREE.MeshDepthMaterial({ map, alphaMap, alphaTest, side });
			out.push(instanced ? new THREE.InstancedMesh(mesh.geometry, depth, 1) : new THREE.Mesh(mesh.geometry, depth));
		}
	});
	return out;
}

/**
 * Shadow stand-ins for the kinds of mesh most models and tiles are: instanced or not, untextured,
 * textured or alpha-tested, each side. Compiled while the world loads, so even the first ones are ready.
 */
export function commonShadowStandIns(): THREE.Object3D[] {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
	const map = new THREE.Texture();
	const group = new THREE.Group();
	for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
		// The depth material takes the texture even when it's not alpha-tested, a shader of its own.
		for (const [alphaTest, textured] of [[0, false], [0, true], [0.5, true]] as const) {
			const material = new THREE.MeshLambertMaterial({ side, alphaTest, map: textured ? map : null });
			for (const mesh of [new THREE.Mesh(geometry, material), new THREE.InstancedMesh(geometry, material, 1)]) {
				mesh.castShadow = true;
				group.add(mesh);
			}
		}
	}
	return shadowStandIns(group);
}
