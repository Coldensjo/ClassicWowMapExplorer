import * as THREE from 'three';
import { placementMatrix } from '../explorer/objects';
import type { PlacedObject, Vec3 } from '../scene/types';

const DEG = 180 / Math.PI;

/** A placed object's model → scene-space matrix, by the ADT placement convention (spec 6.1). */
export function objectMatrix(o: Pick<PlacedObject, 'position' | 'rotation' | 'scale'>): THREE.Matrix4 {
	const [x, y, z] = o.position;
	const [rx, ry, rz] = o.rotation;
	return new THREE.Matrix4().fromArray(placementMatrix(x, y, z, rx, ry, rz, o.scale));
}

/**
 * A scene-space matrix back to placement fields: the inverse of placementMatrix, whose rotation is
 * Ry(ry-90) · Rz(-rx) · Rx(rz-90) — a YZX Euler. Scale is kept uniform (spec 6.1).
 */
export function matrixToPlacement(matrix: THREE.Matrix4): { position: Vec3; rotation: Vec3; scale: number } {
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	matrix.decompose(position, quaternion, scale);
	const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YZX');
	return {
		position: [position.x, position.y, position.z],
		rotation: [-euler.z * DEG, euler.y * DEG + 90, euler.x * DEG + 90],
		scale: scale.x,
	};
}

/** An upright placement's rotation fields: facing yaw (degrees), no lean. */
export function uprightRotation(yaw: number): Vec3 {
	return [0, yaw, 0];
}
