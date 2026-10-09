import { expect, test } from 'bun:test';
import { compose, fromQuaternion, identity, multiply, rotationX, rotationY, rotationZ, scaling, translation, type Mat4 } from '../src/explorer/mat4';

/** Transforms a point (w = 1) by a column-major matrix. */
function apply(m: Mat4, [x, y, z]: [number, number, number]): number[] {
	return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
}

const near = (actual: number[], expected: number[]) => {
	expect(actual.length).toBe(expected.length);
	actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 5));
};

test('identity leaves points alone and is neutral under multiply', () => {
	const m = compose(translation(1, 2, 3), rotationY(30), scaling(2));
	near([...multiply(identity(), m)], [...m]);
	near([...multiply(m, identity())], [...m]);
	near(apply(identity(), [4, 5, 6]), [4, 5, 6]);
});

test('translation and scaling move and stretch points', () => {
	near(apply(translation(1, 2, 3), [10, 10, 10]), [11, 12, 13]);
	near(apply(scaling(3), [1, 2, 3]), [3, 6, 9]);
});

test('right-handed rotations turn x to y about Z, y to z about X, and z to x about Y', () => {
	near(apply(rotationZ(90), [1, 0, 0]), [0, 1, 0]);
	near(apply(rotationX(90), [0, 1, 0]), [0, 0, 1]);
	near(apply(rotationY(90), [0, 0, 1]), [1, 0, 0]);
});

test('multiply applies the right matrix first', () => {
	const m = multiply(translation(10, 0, 0), scaling(2));
	near(apply(m, [1, 0, 0]), [12, 0, 0]); // scaled to 2, then moved
	const reversed = multiply(scaling(2), translation(10, 0, 0));
	near(apply(reversed, [1, 0, 0]), [22, 0, 0]);
});

test('compose chains left to right like nested multiplies', () => {
	const a = translation(1, 0, 0), b = rotationZ(90), c = scaling(2);
	near([...compose(a, b, c)], [...multiply(multiply(a, b), c)]);
});

test('fromQuaternion matches the equivalent axis rotations', () => {
	const s = Math.SQRT1_2;
	near([...fromQuaternion(0, 0, s, s)], [...rotationZ(90)]);
	near([...fromQuaternion(s, 0, 0, s)], [...rotationX(90)]);
	near([...fromQuaternion(0, s, 0, s)], [...rotationY(90)]);
	near([...fromQuaternion(0, 0, 0, 1)], [...identity()]);
});

test('multiplying a rotation by its inverse gives identity', () => {
	near([...multiply(rotationY(37), rotationY(-37))], [...identity()]);
});
