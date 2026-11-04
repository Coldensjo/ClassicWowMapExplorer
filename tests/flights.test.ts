import { expect, test } from 'bun:test';
import { buildFlights } from '../src/explorer/flights';

type Row = Record<number, number | string | number[]>;

/** A table of rows by field number; an array field holds a list. */
function table(rows: Record<number, Row>) {
	const value = (id: number, field: number, index: number) => {
		const v = rows[id]?.[field];
		return Array.isArray(v) ? v[index] ?? null : v ?? null;
	};
	return {
		ids: () => Object.keys(rows).map(Number),
		getInt: (id: number, field: number, index = 0) => value(id, field, index) as number | null,
		getFloat: (id: number, field: number, index = 0) => value(id, field, index) as number | null,
		getString: (id: number, field: number) => value(id, field, 0) as string | null,
	};
}

/** A flight master: name 0, position 1, map 5, mask bit 7, side flags 8. */
const node = (map: number, name: string, flags: number, bit = 1, pos = [0, 0, 0]) => ({ 0: name, 1: pos, 5: map, 7: bit, 8: flags });
/** A route: from 1, to 2, cost 3. */
const route = (from: number, to: number) => ({ 1: from, 2: to, 3: 1 });
/** A node of a route: position 0, path 2, index 3, map 4, flags 5. */
const point = (path: number, i: number, map: number, flags: number, x: number) => ({ 0: [x, 0, 0], 2: path, 3: i, 4: map, 5: flags });

test('flight masters are those with a side by their flags and a bit in the mask, on the continents', () => {
	const nodes = table({
		1: node(0, 'Stormwind', 1, 1, [1.234, 2, 3]),
		2: node(0, 'Orgrimmar', 3, 2, [4, 5, 6]),
		// No side, no bit, off the continents, and an old one.
		3: node(0, 'Quest', 0, 3),
		4: node(0, 'Nobit', 1, 0),
		5: node(530, 'Outland', 1, 5),
		6: node(0, 'zzOLD Somewhere', 1, 6),
	});
	const paths = table({ 7: route(1, 2), 8: route(1, 3) });
	const points = table({
		1: { 0: [10.123, 20, 30], 2: 7, 3: 1, 4: 0, 5: 0 },
		2: point(7, 0, 0, 0, 1),
		3: point(8, 0, 0, 0, 5),
		4: point(8, 1, 0, 0, 6),
	});
	const flights = buildFlights(nodes, paths, points, new Set([0, 1]));
	expect(flights.nodes).toEqual([
		{ id: 1, name: 'Stormwind', map: 0, x: 1.23, y: 2, z: 3, alliance: true, horde: false },
		{ id: 2, name: 'Orgrimmar', map: 0, x: 4, y: 5, z: 6, alliance: true, horde: true },
	]);
	// Only the route between two of them, its points in the order of their nodes and rounded.
	expect(flights.paths).toEqual([{ id: 7, from: 1, to: 2, cost: 1, legs: [{ map: 0, points: [1, 0, 0, 10.1, 20, 30] }] }]);
});

test('a route that changes map, or passes a teleport node, is a leg on each side of the jump', () => {
	const nodes = table({ 1: node(530, "Zul'Aman", 1), 2: node(0, "Light's Hope", 1), 3: node(0, 'Elsewhere', 1) });
	const paths = table({
		// Over the sea to the other map.
		10: route(1, 2),
		// On one map, with a teleport node in the middle.
		11: route(2, 3),
		// A jump that leaves a lone node after it: only the stretch that can be flown stays.
		12: route(3, 2),
	});
	const points = table({
		1: point(10, 0, 530, 0, 1), 2: point(10, 1, 530, 0, 2), 3: point(10, 2, 0, 0, 3), 4: point(10, 3, 0, 0, 4),
		5: point(11, 0, 0, 0, 5), 6: point(11, 1, 0, 1, 6), 7: point(11, 2, 0, 0, 7), 8: point(11, 3, 0, 0, 8),
		9: point(12, 0, 0, 0, 9), 10: point(12, 1, 0, 0, 10), 11: point(12, 2, 530, 0, 11),
	});
	const flights = buildFlights(nodes, paths, points, new Set([0, 530]));
	expect(flights.paths.find((p) => p.id === 10)!.legs).toEqual([{ map: 530, points: [1, 0, 0, 2, 0, 0] }, { map: 0, points: [3, 0, 0, 4, 0, 0] }]);
	expect(flights.paths.find((p) => p.id === 11)!.legs).toEqual([{ map: 0, points: [5, 0, 0, 6, 0, 0] }, { map: 0, points: [7, 0, 0, 8, 0, 0] }]);
	expect(flights.paths.find((p) => p.id === 12)!.legs).toEqual([{ map: 0, points: [9, 0, 0, 10, 0, 0] }]);
});
