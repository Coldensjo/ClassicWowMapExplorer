import { expect, test } from 'bun:test';
import type { PathNode } from '../src/explorer/flights';
import { transportLegs } from '../src/explorer/transportRoutes';

const node = (i: number, x: number, map = 1, flags = 0, delay = 0, y = 0): PathNode => ({ i, x, y, z: 0, map, flags, delay });

test('a route that never jumps is closed with its first three nodes again, and the waits are only where the nodes say', () => {
	// The third node is a stop (flag 2) of 30 seconds.
	const legs = transportLegs([0, 1, 2, 3, 4].map((i) => node(i, i * 10, 1, i === 2 ? 2 : 0, i === 2 ? 30 : 99)));
	expect(legs).toHaveLength(1);
	expect(legs[0].map).toBe(1);
	expect(legs[0].points).toEqual([
		0, 0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 30, 30, 0, 0, 0, 40, 0, 0, 0,
		// The first three again, without their waits.
		0, 0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0,
	]);
});

test('a route that already ends on its own start is not closed again', () => {
	// The fourth node is where the second is (as the Feathermoon ferry's does).
	const legs = transportLegs([node(0, 0), node(1, 10, 1, 0, 0, 5), node(2, 20), node(3, 10, 1, 0, 0, 5), node(4, 0)]);
	expect(legs[0].points).toHaveLength(20);
});

test('a route jumps to a leg of its own after a teleport node, or where the map changes, but not after the first node', () => {
	// Nodes out of order are put in order by their index; the first node's flag marks the loop's end, not a jump.
	const legs = transportLegs([node(3, 40), node(0, 0, 1, 1), node(2, 20, 1, 1), node(1, 10)]);
	expect(legs.map((l) => [l.map, l.points.length / 4])).toEqual([[1, 3], [1, 1]]);
	expect(transportLegs([node(0, 0), node(1, 10), node(2, 20, 0)]).map((l) => l.map)).toEqual([1, 0]);
	expect(legs[0].points.filter((_, k) => k % 4 === 0)).toEqual([0, 10, 20]);
});
