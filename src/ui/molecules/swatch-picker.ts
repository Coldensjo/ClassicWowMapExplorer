/**
 * Swatch picker factory. Spec: specs/color-swatch.md; styles in swatch-picker.css.
 *
 * Native radios behind coloured squares: arrows move and select, each swatch has a name that
 * screen readers hear and a tooltip shows, since colour alone says nothing. The molecule keeps
 * no state beyond the inputs.
 */
import { el } from '../dom';
import { attachTooltip } from './tooltip';

export interface SwatchOption {
	value: string;
	/** Any CSS colour: the one raw colour value the design system takes from data. */
	color: string;
	/** Accessible name and tooltip; default "Colour n of m". */
	name?: string;
	disabled?: boolean;
}

export interface SwatchPickerOptions {
	/** Caption above the swatches. */
	label?: string;
	/** Required when `label` is omitted. */
	ariaLabel?: string;
	/** Radio name, unique per picker on the page. */
	name: string;
	options: SwatchOption[];
	/** The selected value, or null for none. */
	value: string | null;
	onChange?: (value: string) => void;
}

export interface SwatchPickerHandle {
	root: HTMLDivElement;
}

/** Makes a swatch picker: `<div class="ds-swatch-picker" role="radiogroup">`. */
export function swatchPicker(options: SwatchPickerOptions): SwatchPickerHandle {
	const root = el('div', { class: 'ds-swatch-picker', role: 'radiogroup', 'aria-label': options.label ? undefined : options.ariaLabel });
	if (options.label) {
		const label = el('span', { class: 'ds-swatch-picker-label', id: `${options.name}-label` }, options.label);
		root.setAttribute('aria-labelledby', label.id);
		root.append(label);
	}
	const swatches = el('div', { class: 'ds-swatch-picker-swatches' });
	options.options.forEach((option, i) => {
		const name = option.name ?? `Colour ${i + 1} of ${options.options.length}`;
		const input = el('input', {
			class: 'ds-swatch-input ds-visually-hidden',
			type: 'radio',
			name: options.name,
			value: option.value,
			disabled: option.disabled,
			'aria-label': name,
		});
		input.checked = option.value === options.value;
		const swatch = el('label', { class: 'ds-swatch' }, input, el('span', { class: 'ds-swatch-dot', 'aria-hidden': 'true' }));
		swatch.style.setProperty('--swatch-color', option.color);
		attachTooltip(swatch, { text: name, placement: 'top' });
		swatches.append(swatch);
	});
	root.append(swatches);
	if (options.onChange) {
		const onChange = options.onChange;
		root.addEventListener('change', (event) => {
			const input = event.target;
			if (input instanceof HTMLInputElement && input.checked) onChange(input.value);
		});
	}
	return { root };
}

/** Selects the swatch with `value` (or none, for null) without firing onChange. */
export function setSwatchValue(root: HTMLElement, value: string | null): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-swatch-input')) {
		input.checked = input.value === value;
	}
}
