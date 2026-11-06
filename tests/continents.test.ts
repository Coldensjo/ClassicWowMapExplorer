import { expect, test } from 'bun:test';
import { pickContinents, type ContinentCandidate } from '../src/explorer/continents';

const map = (id: number, name: string, over: Partial<ContinentCandidate> = {}): ContinentCandidate => ({ id, directory: name, name, instanceType: 0, wdt: 1000 + id, zones: 10, root: true, ...over });

test('the continents are the open-world maps the world map shows whole, with several zones', () => {
	const maps = [
		map(1, 'Kalimdor'),
		map(0, 'Azeroth'),
		map(530, 'Outland'),
		// A dungeon, one whose WDT isn't in the install, one the world map has no map of the whole of (Deepholm), and a one-zone pocket.
		map(36, 'Deadmines', { instanceType: 1 }),
		map(571, 'Northrend', { wdt: 0 }),
		map(646, 'Deepholm', { zones: 1, root: false }),
		map(648, 'LostIsles', { zones: 2, root: false }),
		map(1064, 'MoguIslandDailyArea', { zones: 1 }),
		map(870, 'Pandaria'),
	];
	expect(pickContinents(maps).map((m) => m.name)).toEqual(['Azeroth', 'Kalimdor', 'Outland', 'Pandaria']);
});

test('where the world map names no continent, the Eastern Kingdoms and Kalimdor are drawn', () => {
	const maps = [map(1, 'Kalimdor', { root: false, zones: 0 }), map(0, 'Azeroth', { root: false, zones: 0 }), map(36, 'Deadmines', { instanceType: 1, root: false, zones: 0 })];
	expect(pickContinents(maps).map((m) => m.name)).toEqual(['Azeroth', 'Kalimdor']);
});
