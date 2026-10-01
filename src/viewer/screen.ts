import type * as THREE from 'three';

/**
 * Whether a point projected with Vector3.project lies behind the camera (or past its far plane).
 * Projected depth runs -1 to 1 with a normal depth buffer, but 1 (near) to 0 (far) with a
 * reversed one, where points behind the camera come out below 0 rather than above 1.
 */
export function behindCamera(projected: THREE.Vector3, camera: THREE.Camera): boolean {
	return camera.reversedDepth ? projected.z < 0 || projected.z > 1 : projected.z > 1;
}
