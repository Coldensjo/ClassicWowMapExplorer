/** Minimal column-major 4x4 matrices (same layout as three.js), for use in the worker. */
export type Mat4 = Float32Array;

export function identity(): Mat4 {
	const m = new Float32Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Float32Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
	const m = identity();
	m[12] = x;
	m[13] = y;
	m[14] = z;
	return m;
}

export function scaling(s: number): Mat4 {
	const m = identity();
	m[0] = m[5] = m[10] = s;
	return m;
}

const RAD = Math.PI / 180;

export function rotationX(deg: number): Mat4 {
	const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
	const m = identity();
	m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
	return m;
}

export function rotationY(deg: number): Mat4 {
	const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
	const m = identity();
	m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
	return m;
}

export function rotationZ(deg: number): Mat4 {
	const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
	const m = identity();
	m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
	return m;
}

export function fromQuaternion(x: number, y: number, z: number, w: number): Mat4 {
	const m = identity();
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;
	m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy;
	m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx;
	m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy);
	return m;
}

export function compose(...ms: Mat4[]): Mat4 {
	return ms.reduce((acc, m) => multiply(acc, m));
}
