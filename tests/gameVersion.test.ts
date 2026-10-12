import { describe, expect, test } from 'bun:test';
import { captureCamera, restoreCamera, productLabel, gameOrder, moveGame, gameHotkey } from '../src/viewer/gameVersion';

describe('game switching camera coordinates', () => {
	const position = { x: 17333.333333333336, y: -17.1234567890123, z: 26106.666666666668 };
	const yaw = 1.234567890123;
	const pitch = -0.345678901234;
	test('map zero and exact orientation/absolute height survive round trips', () => {
		const map = { mapId: 0, offsetX: 3, offsetY: -8 };
		const view = captureCamera(position, yaw, pitch, map);
		expect(view.mapId).toBe(0);
		expect(restoreCamera(view, map)).toEqual([position.x, position.y, position.z]);
		expect(view.yaw).toBe(yaw);
		expect(view.pitch).toBe(pitch);
	});
	test('repositioned dungeons use local map coordinates in both directions', () => {
		const before = { mapId: 36, offsetX: -30, offsetY: 75 };
		const after = { mapId: 36, offsetX: 40, offsetY: 110 };
		const view = captureCamera(position, yaw, pitch, before);
		const [x, y, z] = restoreCamera(view, after);
		const returned = captureCamera({ x, y, z }, view.yaw, view.pitch, after);
		expect(returned.position[0]).toBeCloseTo(view.position[0], 9);
		expect(returned.position[1]).toBe(position.y);
		expect(returned.position[2]).toBeCloseTo(view.position[2], 9);
		expect(returned.yaw).toBe(yaw);
		expect(returned.pitch).toBe(pitch);
	});
	test('open sea keeps absolute world coordinates', () => {
		const view = captureCamera(position, yaw, pitch, null);
		expect(restoreCamera(view, null)).toEqual([position.x, position.y, position.z]);
	});
	test('missing or mismatched maps reject without modifying the snapshot', () => {
		const view = captureCamera(position, yaw, pitch, {mapId: 36, offsetX: 10, offsetY: 20});
		const saved = structuredClone(view);
		expect(() => restoreCamera(view, null)).toThrow('unavailable');
		expect(() => restoreCamera(view, {mapId: 1, offsetX: 10, offsetY: 20})).toThrow('unavailable');
		expect(view).toEqual(saved);
	});
	test('invalid coordinates and directions are rejected', () => {
		const view = captureCamera(position, yaw, pitch, null);
		expect(() => restoreCamera({...view, yaw: NaN}, null)).toThrow('Invalid');
		expect(() => restoreCamera({...view, position: [Infinity, 0, 0]}, null)).toThrow('Invalid');
	});
	test('only the requested Beta product is called Forever', () => {
		expect(productLabel('wow_classic_beta')).toBe('Forever');
		expect(productLabel('wow_classic')).toBe('MoP Classic');
		expect(productLabel('wow')).toBe('Retail');
		expect(productLabel('wow_classic_era')).toBe('Classic');
	});
});



describe('ordered game selection', () => {
	const products = ['wow', 'wow_classic', 'wow_classic_era', 'wowt', 'wowxptr', 'wow_anniversary', 'wow_classic_beta'];
	test('default keys select exact products, independent of discovery order or duplicates', () => {
		const order = gameOrder([...products, 'wow_classic_era'], null);
		expect(order).toEqual(['wow_classic_beta', 'wow_classic_era', 'wow', 'wow_classic', 'wowt', 'wowxptr', 'wow_anniversary']);
		expect(order.map((_, i) => gameHotkey(i))).toEqual(['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7']);
	});
	test('persisted order is deduplicated and only installed games appear; newly installed games append', () => {
		expect(gameOrder(products, ['wow', 'gone', 'wow', 17, 'wow_classic_era'])).toEqual(['wow', 'wow_classic_era', 'wow_classic_beta', 'wow_classic', 'wowt', 'wowxptr', 'wow_anniversary']);
		expect(gameOrder(['wow'], {bad: true})).toEqual(['wow']);
		expect(gameOrder([], products)).toEqual([]);
	});
	test('moving either direction assigns shortcuts by the new order and leaves source unchanged', () => {
		const order = gameOrder(products, null);
		const moved = moveGame(order, 'wow', 'wow_classic_beta', false);
		expect(moved.slice(0, 3)).toEqual(['wow', 'wow_classic_beta', 'wow_classic_era']);
		expect(gameOrder(products, JSON.parse(JSON.stringify(moved)))).toEqual(moved);
		expect(moveGame(moved, 'wow', 'wow_classic_era', true)).toEqual(order);
		expect(moveGame(order, 'missing', 'wow', false)).toEqual(order);
		expect(moveGame(order, 'wow', 'wow', false)).toEqual(order);
	});
});
