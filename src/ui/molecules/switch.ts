/**
 * Switch factory. Spec: specs/switch.md; styles in switch.css.
 *
 * Builds on a native checkbox with role="switch", so Space toggles it, the label names it and
 * screen readers say "on" or "off". The molecule owns no state beyond the input: it reports
 * through onChange and callers move it with setChecked().
 */
import { el } from '../dom';

export interface SwitchOptions {
	/** The visible text in a row; the accessible name of a bare switch. */
	label: string;
	/** Default false: an unset switch never claims a setting is on. */
	checked?: boolean;
	disabled?: boolean;
	/** `row` (default): label left, switch right, full width. `bare`: the switch alone. */
	layout?: 'row' | 'bare';
	title?: string;
	id?: string;
	onChange?: (checked: boolean) => void;
}

export interface SwitchHandle {
	root: HTMLLabelElement;
	input: HTMLInputElement;
}

/** Makes a switch: `<label class="ds-switch" data-layout>` around the input and drawn track. */
export function toggleSwitch(options: SwitchOptions): SwitchHandle {
	const layout = options.layout ?? 'row';
	const input = el('input', {
		class: 'ds-switch-input ds-visually-hidden',
		type: 'checkbox',
		role: 'switch',
		id: options.id,
		disabled: options.disabled,
		'aria-label': layout === 'bare' ? options.label : undefined,
	});
	input.checked = options.checked ?? false;
	const track = el('span', { class: 'ds-switch-track', 'aria-hidden': 'true' }, el('span', { class: 'ds-switch-knob' }));
	const control = el('span', { class: 'ds-switch-control' }, input, track);
	const root = el(
		'label',
		{ class: 'ds-switch', 'data-layout': layout, title: options.title },
		layout === 'row' ? el('span', { class: 'ds-switch-label' }, options.label) : null,
		control,
	);
	if (options.onChange) {
		const onChange = options.onChange;
		input.addEventListener('change', () => onChange(input.checked));
	}
	return { root, input };
}

/** Sets a switch on or off without firing onChange. */
export function setChecked(root: HTMLElement, on: boolean): void {
	const input = root.querySelector<HTMLInputElement>('.ds-switch-input');
	if (input) input.checked = on;
}

/** Enables or disables a switch. */
export function setSwitchDisabled(root: HTMLElement, disabled: boolean): void {
	const input = root.querySelector<HTMLInputElement>('.ds-switch-input');
	if (input) input.disabled = disabled;
}
