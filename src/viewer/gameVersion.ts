import { isTyping } from './typing';
import { TILE_SIZE } from '../formats/adt';

export const GAME_PRODUCTS = ['wow_classic_beta', 'wow_classic_era', 'wow'] as const;
export function productLabel(product: string): string {
	const labels: Record<string, string> = {
		wow_classic_beta: 'Forever', wow_classic_era: 'Classic', wow: 'Retail',
		wow_classic: 'MoP Classic', wow_anniversary: 'Classic Anniversary',
		wowt: 'Retail PTR', wowxptr: 'Retail PTR (next patch)', wow_beta: 'Retail Beta',
		wow_classic_ptr: 'MoP Classic PTR', wow_classic_era_ptr: 'Classic Era PTR',
	};
	return labels[product] ?? product;
}

/** One entry per installed product; a saved order wins, newly discovered products go last. */
export function gameOrder(products: readonly string[], saved: unknown): string[] {
	const available = new Set(products);
	const preferred = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
	return [...new Set([...preferred, ...GAME_PRODUCTS, ...products])].filter(id => available.has(id));
}

export function moveGame(order: readonly string[], product: string, target: string, after: boolean): string[] {
	if (product === target || !order.includes(product) || !order.includes(target)) return [...order];
	const next = order.filter(id => id !== product);
	next.splice(next.indexOf(target) + Number(after), 0, product);
	return next;
}

export function gameHotkey(index: number): string {
	return index < 10 ? 'Ctrl+' + ((index + 1) % 10) : '';
}

export interface CameraView {
	mapId: number | null;
	/** Map-local horizontal coordinates, or world coordinates over open sea. Height is absolute. */
	position: [number, number, number];
	yaw: number;
	pitch: number;
}
interface Placement { mapId: number; offsetX: number; offsetY: number }

export function captureCamera(position: { x: number; y: number; z: number }, yaw: number, pitch: number, map: Placement | null): CameraView {
	return {
		mapId: map?.mapId ?? null,
		position: [position.x - (map?.offsetX ?? 0) * TILE_SIZE, position.y, position.z - (map?.offsetY ?? 0) * TILE_SIZE],
		yaw, pitch,
	};
}

export function restoreCamera(view: CameraView, map: Placement | null): [number, number, number] {
	if (view.mapId !== null && map?.mapId !== view.mapId) throw new Error('This map is unavailable in the selected game.');
	if (![...view.position, view.yaw, view.pitch].every(Number.isFinite)) throw new Error('Invalid camera position.');
	return [view.position[0] + (map?.offsetX ?? 0) * TILE_SIZE, view.position[1], view.position[2] + (map?.offsetY ?? 0) * TILE_SIZE];
}


/** Number-row shortcuts are handled before continent and emote bindings. */
export function gameShortcutIndex(event: KeyboardEvent): number | null {
	if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || isTyping(event)) return null;
	const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
	return digit === undefined ? null : (Number(digit) + 9) % 10;
}
