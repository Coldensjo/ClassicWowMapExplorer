/**
 * Asset tile and asset grid factories. Spec: specs/asset-tile.md (and specs/npc-library.md
 * §2.1–2.2 for the badge and the corner action); styles in asset-tile.css.
 *
 * assetTile() makes a <button> with a square picture and a one-line label; the caller draws the
 * picture (a canvas it paints a thumbnail into, or an img) and owns which tile is selected,
 * moving the mark with setAssetTileSelected(). A tile may carry a badge (a pill on the
 * picture's bottom edge, "12 variants") and an action (a control on the picture's top-right
 * corner, a "…" menu button); since a button cannot hold a button, a tile with an action is
 * wrapped in a frame, and `frame` is what goes in the grid. assetGrid() makes the grid the
 * tiles sit in, with a column count that setAssetGridColumns() changes.
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
	/** A short pill centred on the picture's bottom edge, e.g. "12 variants". */
	badge?: string;
	/** A control laid over the picture's top-right corner, e.g. an icon button opening a menu. */
	action?: HTMLElement;
	id?: string;
	onActivate?: (event: MouseEvent) => void;
}

export interface AssetTileHandle {
	root: HTMLButtonElement;
	/** What to put in the grid: the tile itself, or the frame holding it and its action. */
	frame: HTMLElement;
	/** The square the picture sits in; replace its child to change the picture. */
	picture: HTMLDivElement;
	label: HTMLSpanElement;
	/** The badge pill, when one was given. */
	badge: HTMLSpanElement | null;
}

/** Makes an asset tile: `<button class="ds-asset-tile" aria-pressed>`. */
export function assetTile(options: AssetTileOptions): AssetTileHandle {
	const badge = options.badge ? el('span', { class: 'ds-asset-tile-badge' }, options.badge) : null;
	const picture = el('div', { class: 'ds-asset-tile-picture', 'aria-hidden': 'true' }, options.picture ?? null, badge);
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
	let frame: HTMLElement = root;
	if (options.action) {
		options.action.classList.add('ds-asset-tile-action');
		frame = el('div', { class: 'ds-asset-tile-frame' }, root, options.action);
	}
	return { root, frame, picture, label, badge };
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
