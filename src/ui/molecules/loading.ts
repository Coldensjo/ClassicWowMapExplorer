/**
 * Loading indicator factory. Spec: specs/loading-indicator.md; styles in loading.css.
 *
 * A status region holding the turning ring and a visually hidden label, so screen readers hear
 * what is loading. Use the start screen's progress bar when progress is known; this is for
 * when it is not.
 */
import { el } from '../dom';

export interface LoadingOptions {
	/** What is loading, for screen readers; default "Loading…". */
	label?: string;
	/** Diameter in px; default 124. */
	size?: number;
}

/** Makes a loading indicator: `<div class="ds-loading" role="status">`. */
export function loading(options: LoadingOptions = {}): HTMLDivElement {
	const root = el(
		'div',
		{ class: 'ds-loading', role: 'status', 'aria-live': 'polite' },
		el('span', { class: 'ds-loading-ring', 'aria-hidden': 'true' }),
		el('span', { class: 'ds-visually-hidden' }, options.label ?? 'Loading…'),
	);
	if (options.size) root.style.setProperty('--loading-size', `${options.size}px`);
	return root;
}
