/**
 * Segmented control factory. Spec: specs/segmented-control.md; styles in segmented-control.css.
 *
 * One of a few mutually exclusive modes, as native radios in a trough: ←/→ move and select,
 * Tab enters on the selected segment. The molecule keeps no state beyond the inputs.
 *
 * The text variant (default) fills its container and shares the width between labelled
 * segments; the icon variant (segmented-control.md §11) hugs 24px icon-only segments in a
 * tighter trough, each label kept for assistive technology and shown as a tooltip.
 */
import { icon, type IconName } from '../icons';
import { el } from '../dom';

export interface SegmentedOption {
	value: string;
	label: string;
	/** Tooltip, such as a shortcut hint. */
	title?: string;
	/** The 16px icon an icon segment shows in place of its label. */
	icon?: IconName;
	disabled?: boolean;
}

export interface SegmentedControlOptions {
	/** Radio name, unique per control on the page. */
	name: string;
	/** The group's accessible name, e.g. "Sculpt mode". */
	label: string;
	/** Two or more. */
	options: SegmentedOption[];
	/** The selected option; a segmented control always has one. */
	value: string;
	/** `text` (default) shows labels; `icon` shows each option's icon only. */
	variant?: 'text' | 'icon';
	onChange?: (value: string) => void;
}

export interface SegmentedControlHandle {
	root: HTMLDivElement;
}

/** Makes a segmented control: `<div class="ds-segmented-control" role="radiogroup">`. */
export function segmentedControl(options: SegmentedControlOptions): SegmentedControlHandle {
	const variant = options.variant ?? 'text';
	const root = el('div', { class: 'ds-segmented-control', role: 'radiogroup', 'aria-label': options.label });
	if (variant === 'icon') root.dataset.variant = 'icon';
	for (const option of options.options) {
		const input = el('input', {
			class: 'ds-segmented-control-input ds-visually-hidden',
			type: 'radio',
			name: options.name,
			value: option.value,
			disabled: option.disabled,
		});
		input.checked = option.value === options.value;
		root.append(
			el(
				'label',
				{ class: 'ds-segmented-control-segment', title: option.title ?? option.label },
				input,
				variant === 'icon' && option.icon ? icon(option.icon, { size: 'sm' }) : null,
				el('span', { class: variant === 'icon' ? 'ds-segmented-control-label ds-visually-hidden' : 'ds-segmented-control-label' }, option.label),
			),
		);
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

/** Selects the segment with `value` without firing onChange. */
export function setSegmentedValue(root: HTMLElement, value: string): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-segmented-control-input')) {
		input.checked = input.value === value;
	}
}

/** Enables or disables one segment. */
export function setSegmentDisabled(root: HTMLElement, value: string, disabled: boolean): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-segmented-control-input')) {
		if (input.value === value) input.disabled = disabled;
	}
}
