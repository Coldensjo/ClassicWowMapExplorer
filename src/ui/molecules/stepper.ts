/**
 * Stepper factory. Spec: specs/stepper.md; styles in field.css, button.css and stepper.css.
 *
 * A number field with minus and plus buttons. The native number input is the real control
 * (↑/↓ step it); the buttons are outside the Tab order, repeat while held, and disable at the
 * limits. Typing commits on Enter, blur or a step, clamped and rounded to the step's precision.
 */
import { el, snap } from '../dom';
import { fieldBox } from './field';
import { iconButton } from './button';

export interface StepperOptions {
	/** Accessible name of the input; the stepper shows no label of its own. */
	label: string;
	/** `null` is an empty field, allowed only with a `placeholder`. */
	value: number | null;
	min?: number;
	max?: number;
	step?: number;
	/** Shown when empty; makes an empty value legal. */
	placeholder?: string;
	disabled?: boolean;
	title?: string;
	id?: string;
	/** CSS length for the field; default 72px (`--stepper-field-width`). */
	fieldWidth?: string;
	onChange?: (value: number | null) => void;
}

export interface StepperHandle {
	root: HTMLDivElement;
	input: HTMLInputElement;
}

const HOLD_DELAY = 400;
const HOLD_INTERVAL = 60;

/** Makes a stepper: `<div class="ds-stepper" role="group">`. */
export function stepper(options: StepperOptions): StepperHandle {
	const min = options.min ?? -Infinity;
	const max = options.max ?? Infinity;
	const step = options.step ?? 1;
	const allowEmpty = options.placeholder !== undefined;

	const input = el('input', {
		class: 'ds-field-control',
		type: 'number',
		inputmode: 'decimal',
		id: options.id,
		min: Number.isFinite(min) ? min : undefined,
		max: Number.isFinite(max) ? max : undefined,
		step,
		placeholder: options.placeholder,
		disabled: options.disabled,
		title: options.title,
		'aria-label': options.label,
	});
	input.value = options.value === null ? '' : String(options.value);

	const box = fieldBox(input, input);
	box.classList.add('ds-stepper-field');
	const minus = iconButton({ icon: 'minus', variant: 'secondary', size: 'md', label: `Decrease ${options.label}`, disabled: options.disabled });
	const plus = iconButton({ icon: 'plus', variant: 'secondary', size: 'md', label: `Increase ${options.label}`, disabled: options.disabled });
	minus.tabIndex = -1;
	plus.tabIndex = -1;
	const root = el('div', { class: 'ds-stepper', role: 'group', 'aria-label': options.label, 'aria-disabled': options.disabled ? 'true' : undefined }, minus, box, plus);
	if (options.fieldWidth) root.style.setProperty('--stepper-field-width', options.fieldWidth);

	let last: number | null = options.value;

	const current = (): number | null => {
		if (input.value.trim() === '') return null;
		const n = Number(input.value);
		return Number.isNaN(n) ? null : n;
	};

	const limits = () => {
		if (options.disabled) return;
		const v = current();
		minus.disabled = v !== null && v <= min;
		plus.disabled = v !== null && v >= max;
	};

	const commit = (value: number | null) => {
		if (value === null) {
			if (!allowEmpty) {
				input.value = last === null ? '' : String(last);
				return;
			}
		} else {
			value = snap(value, Number.isFinite(min) ? min : value, Number.isFinite(max) ? max : value, step);
		}
		input.value = value === null ? '' : String(value);
		limits();
		if (value !== last) {
			last = value;
			options.onChange?.(value);
		}
	};

	const stepBy = (direction: 1 | -1) => {
		const v = current();
		const start = v === null ? (Number.isFinite(min) ? min : 0) : v;
		commit(v === null ? start : start + direction * step);
	};

	const hold = (button: HTMLButtonElement, direction: 1 | -1) => {
		let timer = 0;
		const stop = () => {
			window.clearTimeout(timer);
			window.clearInterval(timer);
			timer = 0;
		};
		button.addEventListener('pointerdown', (event) => {
			if (button.disabled || event.button !== 0) return;
			event.preventDefault();
			stepBy(direction);
			timer = window.setTimeout(() => {
				timer = window.setInterval(() => {
					if (button.disabled) stop();
					else stepBy(direction);
				}, HOLD_INTERVAL);
			}, HOLD_DELAY);
		});
		for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
	};
	hold(minus, -1);
	hold(plus, 1);

	input.addEventListener('change', () => commit(current()));
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit(current());
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const direction = event.key === 'ArrowUp' ? 1 : -1;
			const factor = event.shiftKey ? 10 : 1;
			const v = current();
			commit(v === null ? (Number.isFinite(min) ? min : 0) : v + direction * step * factor);
		} else if (event.key === 'PageUp' || event.key === 'PageDown') {
			event.preventDefault();
			const v = current() ?? (Number.isFinite(min) ? min : 0);
			commit(v + (event.key === 'PageUp' ? 1 : -1) * step * 10);
		}
	});
	limits();

	return { root, input };
}

/** Sets the stepper's value (null empties it) without firing onChange. */
export function setStepperValue(root: HTMLElement, value: number | null): void {
	const input = root.querySelector<HTMLInputElement>('.ds-field-control');
	if (!input) return;
	input.value = value === null ? '' : String(value);
	const buttons = root.querySelectorAll<HTMLButtonElement>('.ds-icon-button');
	if (buttons.length === 2 && root.getAttribute('aria-disabled') !== 'true') {
		const min = input.min === '' ? -Infinity : Number(input.min);
		const max = input.max === '' ? Infinity : Number(input.max);
		buttons[0].disabled = value !== null && value <= min;
		buttons[1].disabled = value !== null && value >= max;
	}
}
