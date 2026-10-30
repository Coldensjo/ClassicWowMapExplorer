/**
 * What the three asset browsers (texture, object, NPC) share for their toolbars: the grid/list
 * view toggle, the three tile-size stops and how each is kept across sessions. The grid view's
 * stops are the grid's columns (5, 4, 3); the list view's are the row picture's size (48, 80,
 * 120px). Specs: texture-browser.md, object-browser.md and npc-library.md (the 2026-10-30
 * update), asset-tile.md §9.
 */
import { segmentedControl, setAssetGridColumns, setAssetGridLayout, type AssetTileLayout, type AssetTilePictureSize, type SegmentedControlHandle } from '../ui';

export type BrowserView = 'grid' | 'list';

/** Tile size stops: the slider's value is the stop, the grid gets its columns… */
export const COLUMNS_BY_SCALE = [5, 4, 3];
/** …or, as a list, the rows get their picture size. */
export const PICTURE_BY_SCALE: AssetTilePictureSize[] = ['sm', 'md', 'lg'];
export const DEFAULT_SCALE = 3;

/** The tile size kept from last time under `key`, 1 (smallest) to 3. */
export function loadScale(key: string): number {
	try {
		const scale = Number(localStorage.getItem(key));
		return scale >= 1 && scale <= 3 ? Math.round(scale) : DEFAULT_SCALE;
	} catch {
		return DEFAULT_SCALE;
	}
}

export function saveScale(key: string, scale: number): void {
	try {
		localStorage.setItem(key, String(scale));
	} catch {
		// Forgetting the tile size is fine.
	}
}

/** The view kept from last time under `key`; grid by default. */
export function loadView(key: string): BrowserView {
	try {
		return localStorage.getItem(key) === 'list' ? 'list' : 'grid';
	} catch {
		return 'grid';
	}
}

export function saveView(key: string, view: BrowserView): void {
	try {
		localStorage.setItem(key, view);
	} catch {
		// Forgetting the view is fine.
	}
}

/** The grid/list toggle: an icon segmented control with the grid and list icons. */
export function viewToggle(name: string, value: BrowserView, onChange: (view: BrowserView) => void): SegmentedControlHandle {
	return segmentedControl({
		name,
		label: 'View',
		variant: 'icon',
		value,
		options: [
			{ value: 'grid', label: 'Grid', icon: 'grid' },
			{ value: 'list', label: 'List', icon: 'list' },
		],
		onChange: (v) => onChange(v === 'list' ? 'list' : 'grid'),
	});
}

/** How a tile is laid out in `view` at tile size `scale`. */
export function tileLayout(view: BrowserView, scale: number): { layout: AssetTileLayout; pictureSize: AssetTilePictureSize } {
	return { layout: view === 'list' ? 'row' : 'grid', pictureSize: PICTURE_BY_SCALE[Math.min(3, Math.max(1, scale)) - 1] };
}

/** Lays the grid out for `view` at tile size `scale`. */
export function applyGridView(grid: HTMLElement, view: BrowserView, scale: number): void {
	setAssetGridLayout(grid, view === 'list' ? 'row' : 'grid');
	setAssetGridColumns(grid, COLUMNS_BY_SCALE[Math.min(3, Math.max(1, scale)) - 1]);
}
