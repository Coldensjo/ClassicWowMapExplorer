/**
 * Grab bar factory. Spec: specs/grab-bar.md; styles in grab-bar.css.
 *
 * A separator that resizes a panel. Dragging it reports a new size through onChange; arrow
 * keys step it, Home and End jump to the limits, Enter and a double click toggle (collapse or
 * restore) through onToggle. The molecule keeps the current value only to report it in ARIA;
 * the caller owns the panel's size and calls setGrabBarValue() when it changes elsewhere.
 */
import { el } from '../dom';

export interface GrabBarOptions {
	/** Accessible name, e.g. "Resize tool panel". */
	label: string;
	/** The panel's current size in px. */
	value: number;
	min: number;
	max: number;
	/** Keyboard step in px; default 16. */
	step?: number;
	/** `horizontal` (default): a bar above or below a panel. `vertical`: beside one. */
	orientation?: 'horizontal' | 'vertical';
	/**
	 * Which way a drag makes the panel bigger: `start` (up, or left) for a panel below or to
	 * the right of the bar, `end` (down, or right) for one above or to the left. Default start.
	 */
	grows?: 'start' | 'end';
	onChange: (value: number) => void;
	onToggle?: () => void;
}

export interface GrabBarHandle {
	root: HTMLDivElement;
}

/** Makes a grab bar: `<div class="ds-grab-bar" role="separator" tabindex="0">`. */
export function grabBar(options: GrabBarOptions): GrabBarHandle {
	const step = options.step ?? 16;
	const vertical = options.orientation === 'vertical';
	const sign = (options.grows ?? 'start') === 'start' ? -1 : 1;
	const root = el(
		'div',
		{
			class: 'ds-grab-bar',
			role: 'separator',
			tabindex: 0,
			'aria-label': options.label,
			'aria-orientation': vertical ? 'vertical' : 'horizontal',
			'aria-valuemin': options.min,
			'aria-valuemax': options.max,
			'aria-valuenow': options.value,
		},
		el('span', { class: 'ds-grab-bar-handle', 'aria-hidden': 'true' }),
	);

	const clamp = (v: number) => Math.min(options.max, Math.max(options.min, Math.round(v)));
	const current = () => Number(root.getAttribute('aria-valuenow'));
	const commit = (v: number) => {
		const value = clamp(v);
		if (value === current()) return;
		root.setAttribute('aria-valuenow', String(value));
		options.onChange(value);
	};

	let startPos = 0;
	let startValue = 0;
	root.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		root.setPointerCapture(event.pointerId);
		root.dataset.dragging = '';
		startPos = vertical ? event.clientX : event.clientY;
		startValue = current();
	});
	root.addEventListener('pointermove', (event) => {
		if (root.dataset.dragging === undefined) return;
		const delta = (vertical ? event.clientX : event.clientY) - startPos;
		commit(startValue + sign * delta);
	});
	const stop = () => delete root.dataset.dragging;
	root.addEventListener('pointerup', stop);
	root.addEventListener('pointercancel', stop);
	root.addEventListener('lostpointercapture', stop);
	root.addEventListener('dblclick', () => options.onToggle?.());

	root.addEventListener('keydown', (event) => {
		const grow = vertical ? 'ArrowRight' : 'ArrowDown';
		const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
		switch (event.key) {
			case grow:
				event.preventDefault();
				commit(current() + sign * step);
				break;
			case shrink:
				event.preventDefault();
				commit(current() - sign * step);
				break;
			case 'Home':
				event.preventDefault();
				commit(options.min);
				break;
			case 'End':
				event.preventDefault();
				commit(options.max);
				break;
			case 'Enter':
				event.preventDefault();
				options.onToggle?.();
				break;
		}
	});

	return { root };
}

/** Records the panel's size (after the caller changed it) without firing onChange. */
export function setGrabBarValue(root: HTMLElement, value: number): void {
	root.setAttribute('aria-valuenow', String(Math.round(value)));
}
