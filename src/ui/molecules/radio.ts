/**
 * Radio group factory. Spec: specs/radio.md; styles in radio.css.
 *
 * Native radios inside a <fieldset>, so arrow keys move and select, Tab enters on the checked
 * option and leaves the group, and disabled options are skipped. Each option may carry an info
 * button (a ghost icon button) that is a separate control.
 */
import { el } from '../dom';
import { iconButton } from './button';

export interface RadioOption {
	value: string;
	label: string;
	disabled?: boolean;
	/** Shows a help button after the label; stays usable when the option is disabled. */
	info?: { label: string; onClick: (event: MouseEvent) => void };
}

export interface RadioGroupOptions {
	/** Shared by every option's input; unique per group on the page. */
	name: string;
	/** The group's accessible name. */
	legend: string;
	/** Hide the legend when the panel already shows a heading for the group. */
	legendHidden?: boolean;
	options: RadioOption[];
	/** The checked option; none checked when omitted. */
	value?: string;
	onChange?: (value: string) => void;
}

export interface RadioGroupHandle {
	root: HTMLFieldSetElement;
}

/** Makes a radio group: `<fieldset class="ds-radio-group">` of `.ds-radio-row` rows. */
export function radioGroup(options: RadioGroupOptions): RadioGroupHandle {
	const root = el('fieldset', { class: 'ds-radio-group' });
	root.append(
		el('legend', { class: options.legendHidden ? 'ds-radio-group-label ds-visually-hidden' : 'ds-radio-group-label' }, options.legend),
	);
	for (const option of options.options) {
		const input = el('input', {
			class: 'ds-radio-input ds-visually-hidden',
			type: 'radio',
			name: options.name,
			value: option.value,
			disabled: option.disabled,
		});
		input.checked = option.value === options.value;
		const label = el(
			'label',
			{ class: 'ds-radio' },
			input,
			el('span', { class: 'ds-radio-circle', 'aria-hidden': 'true' }, el('span', { class: 'ds-radio-dot' })),
			el('span', { class: 'ds-radio-label' }, option.label),
		);
		const row = el('div', { class: 'ds-radio-row', 'data-value': option.value }, label);
		if (option.info) {
			row.append(iconButton({ icon: 'help', variant: 'ghost', size: 'xs', label: option.info.label, onClick: option.info.onClick }));
		}
		root.append(row);
	}
	if (options.onChange) {
		const onChange = options.onChange;
		root.addEventListener('change', (event) => {
			const input = event.target;
			if (input instanceof HTMLInputElement && input.checked) onChange(input.value);
		});
	}
	return { root };
}

/** Checks the option with `value` (or none, for null) without firing onChange. */
export function setRadioValue(root: HTMLElement, value: string | null): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-radio-input')) {
		input.checked = input.value === value;
	}
}

/** Enables or disables one option; its info button is unaffected. */
export function setRadioOptionDisabled(root: HTMLElement, value: string, disabled: boolean): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-radio-input')) {
		if (input.value === value) input.disabled = disabled;
	}
}

