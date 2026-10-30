/**
 * Slider factory. Spec: specs/slider.md; styles in field.css and slider.css.
 *
 * A native range input (so keys, pointer and touch come free) with a caption above and an
 * editable value field beside it. Dragging updates the field live; typing a value commits on
 * Enter or blur, clamped to the range and rounded to the step. The molecule keeps no model
 * state: it reports through onInput and onChange and callers move it with setSliderValue().
 */
import { el, snap } from '../dom';
import { fieldBox, fieldShell } from './field';

export interface SliderOptions {
	/** Caption above; also the accessible name. */
	label?: string;
	/** Required when `label` is omitted. */
	ariaLabel?: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	/** Unit shown after the value, e.g. "%" or "yd"; also read out with the value. */
	suffix?: string;
	/** Show the editable value field; default true. */
	showInput?: boolean;
	disabled?: boolean;
	/** Tooltip on the range, e.g. a shortcut hint. */
	title?: string;
	id?: string;
	/** While dragging or typing. */
	onInput?: (value: number) => void;
	/** On release or commit. */
	onChange?: (value: number) => void;
}

export interface SliderHandle {
	root: HTMLDivElement;
	range: HTMLInputElement;
	/** The value field, when shown. */
	input: HTMLInputElement | null;
}

/** Makes a slider: `<div class="ds-field ds-slider">`. */
export function slider(options: SliderOptions): SliderHandle {
	const min = options.min ?? 0;
	const max = options.max ?? 100;
	const step = options.step ?? 1;
	const range = el('input', {
		class: 'ds-slider-range',
		type: 'range',
		id: options.id,
		min,
		max,
		step,
		disabled: options.disabled,
		title: options.title,
		'aria-label': options.label ? undefined : options.ariaLabel,
	});
	range.value = String(options.value);

	let input: HTMLInputElement | null = null;
	const row = el('div', { class: 'ds-slider-row' }, range);
	if (options.showInput ?? true) {
		input = el('input', {
			class: 'ds-field-control',
			type: 'number',
			inputmode: 'decimal',
			min,
			max,
			step,
			disabled: options.disabled,
			'aria-label': `${options.label ?? options.ariaLabel ?? ''} value`.trim(),
		});
		input.value = range.value;
		const box = fieldBox(input, input, options.suffix ? el('span', { class: 'ds-field-suffix', 'aria-hidden': 'true' }, options.suffix) : null);
		box.classList.add('ds-slider-input');
		row.append(box);
	}

	const shell = fieldShell({ label: options.label, controlId: options.id }, row);
	range.id = shell.controlId;
	shell.root.classList.add('ds-slider');

	const describe = () => {
		range.setAttribute('aria-valuetext', options.suffix ? `${range.value} ${options.suffix}` : range.value);
	};
	describe();

	range.addEventListener('input', () => {
		if (input) input.value = range.value;
		describe();
		options.onInput?.(Number(range.value));
	});
	range.addEventListener('change', () => options.onChange?.(Number(range.value)));

	if (input) {
		const field = input;
		const commit = () => {
			const typed = Number(field.value);
			if (field.value.trim() === '' || Number.isNaN(typed)) {
				field.value = range.value;
				return;
			}
			const value = snap(typed, min, max, step);
			field.value = String(value);
			if (String(value) !== range.value) {
				range.value = String(value);
				describe();
				options.onInput?.(value);
				options.onChange?.(value);
			}
		};
		field.addEventListener('input', () => {
			const typed = Number(field.value);
			if (field.value.trim() !== '' && !Number.isNaN(typed)) options.onInput?.(snap(typed, min, max, step));
		});
		field.addEventListener('change', commit);
		field.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
			} else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.shiftKey) {
				event.preventDefault();
				const direction = event.key === 'ArrowUp' ? 1 : -1;
				field.value = String(snap(Number(field.value || range.value) + direction * step * 10, min, max, step));
				commit();
			}
		});
	}

	return { root: shell.root, range, input };
}

/** Moves the slider (and its field) to `value` without firing onInput or onChange. */
export function setSliderValue(root: HTMLElement, value: number): void {
	const range = root.querySelector<HTMLInputElement>('.ds-slider-range');
	const input = root.querySelector<HTMLInputElement>('.ds-slider-input .ds-field-control');
	if (!range) return;
	range.value = String(value);
	if (input) input.value = range.value;
	const suffix = root.querySelector('.ds-field-suffix')?.textContent;
	range.setAttribute('aria-valuetext', suffix ? `${range.value} ${suffix}` : range.value);
}
