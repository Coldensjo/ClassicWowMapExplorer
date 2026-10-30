/**
 * Text input factory. Spec: specs/text-input.md; styles in field.css and text-input.css.
 *
 * A labelled single-line field with optional leading icon, prefix, suffix and supporting text.
 * The search box the asset browsers need is this with `icon: 'search'`, `type: 'search'` and
 * `ariaLabel` instead of a label.
 */
import { icon, type IconName } from '../icons';
import { el } from '../dom';
import { fieldBox, fieldShell, setFieldInvalid, type FieldSize } from './field';

export interface TextInputOptions {
	label?: string;
	/** Required when `label` is omitted. */
	ariaLabel?: string;
	optional?: boolean;
	value?: string;
	placeholder?: string;
	type?: 'text' | 'search' | 'number' | 'password' | 'email' | 'url';
	/** Leading 16px icon. */
	icon?: IconName;
	prefix?: string;
	suffix?: string;
	/** Supporting text below the field. */
	hint?: string;
	/** `md` (default) is the 40px box; `sm` the 30px one the browser toolbars use. */
	size?: FieldSize;
	disabled?: boolean;
	readOnly?: boolean;
	maxLength?: number;
	autocomplete?: string;
	spellcheck?: boolean;
	title?: string;
	id?: string;
	/** Every keystroke. */
	onInput?: (value: string) => void;
	/** On commit: Enter or leaving the field. */
	onChange?: (value: string) => void;
}

export interface TextInputHandle {
	root: HTMLDivElement;
	input: HTMLInputElement;
	box: HTMLDivElement;
}

/** Makes a text input: `<div class="ds-field ds-text-input">`. */
export function textInput(options: TextInputOptions): TextInputHandle {
	const input = el('input', {
		class: 'ds-field-control',
		type: options.type ?? 'text',
		id: options.id,
		placeholder: options.placeholder,
		disabled: options.disabled,
		readonly: options.readOnly,
		maxlength: options.maxLength,
		autocomplete: options.autocomplete,
		spellcheck: options.spellcheck === undefined ? undefined : String(options.spellcheck),
		title: options.title,
		'aria-label': options.label ? undefined : options.ariaLabel,
	});
	input.value = options.value ?? '';
	const box = fieldBox(
		input,
		options.icon ? icon(options.icon, { size: 'sm' }) : null,
		options.prefix ? el('span', { class: 'ds-field-prefix', 'aria-hidden': 'true' }, options.prefix) : null,
		input,
		options.suffix ? el('span', { class: 'ds-field-suffix', 'aria-hidden': 'true' }, options.suffix) : null,
	);
	const shell = fieldShell({ ...options, controlId: options.id }, box);
	input.id = shell.controlId;
	if (shell.hintId) input.setAttribute('aria-describedby', shell.hintId);
	shell.root.classList.add('ds-text-input');
	if (options.size === 'sm') shell.root.dataset.size = 'sm';
	if (options.onInput) {
		const onInput = options.onInput;
		input.addEventListener('input', () => onInput(input.value));
	}
	if (options.onChange) {
		const onChange = options.onChange;
		input.addEventListener('change', () => onChange(input.value));
	}
	return { root: shell.root, input, box };
}

/** Sets the field's text without firing onInput or onChange. */
export function setTextValue(root: HTMLElement, value: string): void {
	const input = root.querySelector<HTMLInputElement>('.ds-field-control');
	if (input) input.value = value;
}

export { setFieldInvalid as setInvalid };
