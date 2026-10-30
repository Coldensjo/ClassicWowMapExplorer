/**
 * Asset tile and asset grid factories. Spec: specs/asset-tile.md; styles in asset-tile.css.
 *
 * assetTile() makes a <button> with a square picture and a one-line label; the caller draws the
 * picture (a canvas it paints a thumbnail into, or an img) and owns which tile is selected,
 * moving the mark with setAssetTileSelected(). assetGrid() makes the grid the tiles sit in,
 * with a column count that setAssetGridColumns() changes.
 */
import { el } from '../dom';

export interface AssetTileOptions {
	/** The one-line caption under the picture; also the accessible name. */
	label: string;
	/** Tooltip, e.g. the asset's full path; defaults to the label. */
	title?: string;
	/** What to show: a canvas the caller draws into, or an image. Empty shows the inset fill. */
	picture?: HTMLCanvasElement | HTMLImageElement;
	selected?: boolean;
	/** Unavailable assets are shown dimmed and cannot be picked. */
	disabled?: boolean;
	id?: string;
	onActivate?: (event: MouseEvent) => void;
}

export interface AssetTileHandle {
	root: HTMLButtonElement;
	/** The square the picture sits in; replace its child to change the picture. */
	picture: HTMLDivElement;
	label: HTMLSpanElement;
}

/** Makes an asset tile: `<button class="ds-asset-tile" aria-pressed>`. */
export function assetTile(options: AssetTileOptions): AssetTileHandle {
	const picture = el('div', { class: 'ds-asset-tile-picture', 'aria-hidden': 'true' }, options.picture ?? null);
	const label = el('span', { class: 'ds-asset-tile-label' }, options.label);
	const root = el(
		'button',
		{
			class: 'ds-asset-tile',
			type: 'button',
			id: options.id,
			title: options.title ?? options.label,
			disabled: options.disabled,
			'aria-pressed': options.selected ? 'true' : 'false',
		},
		picture,
		label,
	);
	if (options.onActivate) root.addEventListener('click', options.onActivate);
	return { root, picture, label };
}

/** Marks a tile selected or not without firing its onActivate. */
export function setAssetTileSelected(root: HTMLElement, selected: boolean): void {
	root.setAttribute('aria-pressed', selected ? 'true' : 'false');
}

/** Makes an asset grid: `<div class="ds-asset-grid">` with `columns` equal columns (default 3). */
export function assetGrid(columns = 3, attrs: Record<string, string> = {}): HTMLDivElement {
	const grid = el('div', { class: 'ds-asset-grid', ...attrs });
	setAssetGridColumns(grid, columns);
	return grid;
}

/** Changes how many columns a grid has. */
export function setAssetGridColumns(grid: HTMLElement, columns: number): void {
	grid.style.setProperty('--asset-grid-columns', String(Math.max(1, Math.round(columns))));
}
