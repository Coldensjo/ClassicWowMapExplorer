/**
 * Colour input factory. Spec: specs/color-input.md; styles in color-input.css.
 *
 * A row like the switch's: a text label on the left and a swatch on the right that opens the
 * browser's own colour picker (a native <input type="color"> laid over the swatch). The picker
 * reports every change while it is open through onInput and the final one through onChange,
 * like the slider, so a caller can preview a colour and record it once. The molecule owns no
 * state beyond the input: callers move it with setColorValue().
 */
import { el } from '../dom';

export interface ColorInputOptions {
	/** The visible text of the row. */
	label: string;
	/** The colour, as #rrggbb (what a native colour input takes and gives). */
	value: string;
	disabled?: boolean;
	title?: string;
	id?: string;
	/** Each colour the picker passes through while open. */
	onInput?: (value: string) => void;
	/** The colour the picker closes on. */
	onChange?: (value: string) => void;
}

export interface ColorInputHandle {
	root: HTMLLabelElement;
	input: HTMLInputElement;
}

/** Makes a colour input: `<label class="ds-color-input">` around the text and the swatch holding the native input. */
export function colorInput(options: ColorInputOptions): ColorInputHandle {
	const input = el('input', {
		class: 'ds-color-input-control',
		type: 'color',
		id: options.id,
		disabled: options.disabled,
		'aria-label': options.label,
	});
	input.value = options.value;
	const swatch = el('span', { class: 'ds-color-input-swatch' }, input);
	swatch.style.setProperty('--swatch-color', options.value);
	const root = el('label', { class: 'ds-color-input', title: options.title }, el('span', { class: 'ds-color-input-label' }, options.label), swatch);
	input.addEventListener('input', () => {
		swatch.style.setProperty('--swatch-color', input.value);
		options.onInput?.(input.value);
	});
	input.addEventListener('change', () => {
		swatch.style.setProperty('--swatch-color', input.value);
		options.onChange?.(input.value);
	});
	return { root, input };
}

/** Sets the colour (#rrggbb) without firing onInput or onChange. */
export function setColorValue(root: HTMLElement, value: string): void {
	const input = root.querySelector<HTMLInputElement>('.ds-color-input-control');
	const swatch = root.querySelector<HTMLElement>('.ds-color-input-swatch');
	if (input) input.value = value;
	swatch?.style.setProperty('--swatch-color', value);
}

/** Enables or disables a colour input. */
export function setColorInputDisabled(root: HTMLElement, disabled: boolean): void {
	const input = root.querySelector<HTMLInputElement>('.ds-color-input-control');
	if (input) input.disabled = disabled;
}
