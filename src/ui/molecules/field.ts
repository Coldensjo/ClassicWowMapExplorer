/**
 * Field helpers shared by the text input, slider, stepper and select: the labelled shell and
 * the field box. Styles in field.css. Not a molecule of its own; the molecules that build on
 * it are.
 */
import { el, uid, type Child } from '../dom';

/** A field box's size: `md` is the 40px box, `sm` the 30px one (text-input.md §10). */
export type FieldSize = 'md' | 'sm';

export interface FieldShellOptions {
	/** Caption above the control. */
	label?: string;
	/** Accessible name when there is no visible label. */
	ariaLabel?: string;
	/** Shows "Optional" after the label. */
	optional?: boolean;
	/** Supporting text below the control. */
	hint?: string;
	/** The id the control will carry, so the label can point at it. Made when omitted. */
	controlId?: string;
}

export interface FieldShell {
	root: HTMLDivElement;
	label: HTMLLabelElement | null;
	hint: HTMLParagraphElement | null;
	/** The id the control should carry (`for` of the label). */
	controlId: string;
	/** The id of the hint, for `aria-describedby`, when there is one. */
	hintId: string | null;
}

/** Builds the `.ds-field` stack around `body`: label row above, supporting text below. */
export function fieldShell(options: FieldShellOptions, body: HTMLElement): FieldShell {
	const controlId = options.controlId ?? uid('field');
	const root = el('div', { class: 'ds-field' });
	let label: HTMLLabelElement | null = null;
	if (options.label) {
		label = el('label', { class: 'ds-field-label', for: controlId }, options.label);
		root.append(
			el('div', { class: 'ds-field-label-row' }, label, options.optional ? el('span', { class: 'ds-field-optional' }, 'Optional') : null),
		);
	}
	root.append(body);
	let hint: HTMLParagraphElement | null = null;
	let hintId: string | null = null;
	if (options.hint) {
		hintId = `${controlId}-hint`;
		hint = el('p', { class: 'ds-field-hint', id: hintId }, options.hint);
		root.append(hint);
	}
	return { root, label, hint, controlId, hintId };
}

/** Makes the 40px `.ds-field-box` and focuses `control` when any part of it is pressed. */
export function fieldBox(control: HTMLElement, ...children: Child[]): HTMLDivElement {
	const box = el('div', { class: 'ds-field-box' }, ...children);
	box.addEventListener('pointerdown', (event) => {
		if (event.target === control) return;
		event.preventDefault();
		control.focus();
	});
	return box;
}

/** Marks a field invalid with a message in place of its hint, or clears it with null. */
export function setFieldInvalid(root: HTMLElement, message: string | null): void {
	const control = root.querySelector<HTMLElement>('.ds-field-control');
	let hint = root.querySelector<HTMLElement>('.ds-field-hint');
	if (message) {
		root.dataset.invalid = '';
		control?.setAttribute('aria-invalid', 'true');
		if (!hint) {
			hint = el('p', { class: 'ds-field-hint', id: `${control?.id ?? uid('field')}-hint` });
			root.append(hint);
			control?.setAttribute('aria-describedby', hint.id);
		}
		if (hint.dataset.original === undefined) hint.dataset.original = hint.textContent ?? '';
		hint.textContent = message;
	} else {
		delete root.dataset.invalid;
		control?.removeAttribute('aria-invalid');
		if (hint && hint.dataset.original !== undefined) {
			hint.textContent = hint.dataset.original;
			delete hint.dataset.original;
			if (!hint.textContent) hint.remove();
		}
	}
}
