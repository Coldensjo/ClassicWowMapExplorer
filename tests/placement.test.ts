import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { matrixToPlacement, objectMatrix, uprightRotation } from '../src/editor/placement';

/** Compares matrices element-wise: equivalent Euler angles must land on the same transform. */
function nearMatrix(a: THREE.Matrix4, b: THREE.Matrix4): void {
	a.elements.forEach((v, i) => expect(v).toBeCloseTo(b.elements[i], 4));
}

test('matrixToPlacement inverts objectMatrix for arbitrary placements', () => {
	const cases = [
		{ position: [100.5, -3.25, 2047] as [number, number, number], rotation: [12, 215, -40] as [number, number, number], scale: 1.75 },
		{ position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 },
		{ position: [533.3, 80, 533.3] as [number, number, number], rotation: [-170, 89.5, 90] as [number, number, number], scale: 0.3 },
		{ position: [1, 2, 3] as [number, number, number], rotation: [45, 0, -135] as [number, number, number], scale: 4 },
	];
	for (const placement of cases) {
		const matrix = objectMatrix(placement);
		const back = matrixToPlacement(matrix);
		nearMatrix(objectMatrix(back), matrix);
		expect(back.scale).toBeCloseTo(placement.scale, 4);
		back.position.forEach((v, i) => expect(v).toBeCloseTo(placement.position[i], 4));
	}
});

test('an upright placement keeps the model standing and facing its yaw', () => {
	// Model space is z-up: its up (0, 0, 1) must come out as world up (0, 1, 0) for any yaw.
	for (const yaw of [0, 36.5, 90, 180, 270]) {
		const matrix = objectMatrix({ position: [10, 5, 20], rotation: uprightRotation(yaw), scale: 2 });
		const up = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
		expect(up.x).toBeCloseTo(0, 5);
		expect(up.y).toBeCloseTo(1, 5);
		expect(up.z).toBeCloseTo(0, 5);
	}
	// Turning the yaw turns the model's forward around world Y, counter-clockwise seen from above.
	const forward = (yaw: number) => new THREE.Vector3(1, 0, 0).transformDirection(objectMatrix({ position: [0, 0, 0], rotation: uprightRotation(yaw), scale: 1 }));
	const f0 = forward(0);
	const f90 = forward(90);
	expect(f0.dot(f90)).toBeCloseTo(0, 5);
	expect(f0.y).toBeCloseTo(0, 5);
	expect(f90.y).toBeCloseTo(0, 5);
});

test('a gizmo-dragged matrix decomposes to a placement that rebuilds it', () => {
	// Compose a transform the way the gizmo would leave it: arbitrary rotation and uniform scale.
	const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.2, 2.8, 'XYZ'));
	const matrix = new THREE.Matrix4().compose(new THREE.Vector3(-50, 12, 900), quaternion, new THREE.Vector3(1.5, 1.5, 1.5));
	const placement = matrixToPlacement(matrix);
	nearMatrix(objectMatrix(placement), matrix);
});
