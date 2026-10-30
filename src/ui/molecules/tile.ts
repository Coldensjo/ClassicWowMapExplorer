/**
 * Interactive tile factory. Spec: specs/interactive-tile.md; styles in tile.css.
 *
 * A card that opens a deeper view: a <button> with onActivate, or an <a> when given a href.
 * Its accessible name is the title; the description is joined through aria-describedby.
 */
import { icon } from '../icons';
import { el, uid } from '../dom';

export interface TileOptions {
	title: string;
	/** One line below the title ("Show body?"). */
	description?: string;
	/** Renders an <a> to this URL instead of a <button>. */
	href?: string;
	disabled?: boolean;
	id?: string;
	onActivate?: (event: MouseEvent) => void;
}

/** Makes a tile: `<button class="ds-tile">` or `<a class="ds-tile" href>`. */
export function tile(options: TileOptions): HTMLButtonElement | HTMLAnchorElement {
	const descriptionId = options.description ? uid('tile-description') : undefined;
	const text = el(
		'span',
		{ class: 'ds-tile-text' },
		el('span', { class: 'ds-tile-title' }, options.title),
		options.description ? el('span', { class: 'ds-tile-description', id: descriptionId }, options.description) : null,
	);
	const chevron = icon('right', { size: 'sm' });
	const common = { class: 'ds-tile', id: options.id, 'aria-describedby': descriptionId };
	let root: HTMLButtonElement | HTMLAnchorElement;
	if (options.href) {
		root = el('a', { ...common, href: options.disabled ? undefined : options.href, 'aria-disabled': options.disabled ? 'true' : undefined }, text, chevron);
	} else {
		root = el('button', { ...common, type: 'button', disabled: options.disabled }, text, chevron);
	}
	if (options.onActivate) {
		const onActivate = options.onActivate;
		root.addEventListener('click', (event: Event) => {
			if (root.getAttribute('aria-disabled') === 'true') {
				event.preventDefault();
				return;
			}
			onActivate(event as MouseEvent);
		});
	}
	return root;
}
