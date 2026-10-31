/**
 * Dialog factory. Spec: specs/dialog.md; styles in dialog.css.
 *
 * A modal confirmation on the native <dialog> element, which gives the top layer, focus
 * containment, Escape and the ::backdrop scrim for free. dialog() builds and opens one and
 * resolves with the choice; confirmDialog() is the common yes/no shape as a boolean. The
 * element is appended to <body> for its life and removed when it closes. formDialog() is the
 * same shell around a caller-built form (the scene dialogs), with a scrolling body.
 */
import { el, uid, type Child } from '../dom';
import { button, iconButton, type ButtonVariant } from './button';

export interface DialogAction {
	label: string;
	/** `secondary` (default for the safe choice), `outline` (default for the committing one), `primary`. */
	variant?: ButtonVariant;
	/** Shown in the danger colour, for an action that cannot be undone. */
	destructive?: boolean;
}

export interface DialogOptions {
	title: string;
	/** One paragraph, or several. */
	message: string | string[];
	/** The committing action at the right. */
	confirm: DialogAction;
	/** The safe action at the left; default "Cancel". Escape and the close button pick it. */
	cancel?: DialogAction;
	id?: string;
}

export interface DialogHandle {
	root: HTMLDialogElement;
	/** Resolves `true` for the confirming action, `false` for cancel, Escape or the close button. */
	result: Promise<boolean>;
	/** Closes it as a cancel. */
	close(): void;
}

/** Opens a modal dialog: `<dialog class="ds-dialog">`, resolved by `result`. */
export function dialog(options: DialogOptions): DialogHandle {
	const titleId = uid('dialog-title');
	const messageId = uid('dialog-message');
	let settled = false;
	let resolve!: (value: boolean) => void;
	const result = new Promise<boolean>((r) => (resolve = r));
	const root = el('dialog', { class: 'ds-dialog', id: options.id, 'aria-labelledby': titleId, 'aria-describedby': messageId });
	const finish = (value: boolean) => {
		if (settled) return;
		settled = true;
		resolve(value);
		if (root.open) root.close();
		root.remove();
	};
	const cancel = options.cancel ?? { label: 'Cancel' };
	const cancelButton = button({ label: cancel.label, variant: cancel.variant ?? 'secondary', size: 'md', onClick: () => finish(false) });
	const confirmButton = button({ label: options.confirm.label, variant: options.confirm.variant ?? 'outline', size: 'md', onClick: () => finish(true) });
	if (cancel.destructive) cancelButton.dataset.destructive = 'true';
	if (options.confirm.destructive) confirmButton.dataset.destructive = 'true';
	const messages = Array.isArray(options.message) ? options.message : [options.message];
	root.append(
		el(
			'div',
			{ class: 'ds-dialog-header' },
			el('h2', { class: 'ds-dialog-title', id: titleId }, options.title),
			iconButton({ icon: 'close', label: 'Close', variant: 'ghost', size: 'xs', onClick: () => finish(false) }),
		),
		el('div', { class: 'ds-dialog-body', id: messageId }, ...messages.map((text) => el('p', { class: 'ds-dialog-message' }, text))),
		el('div', { class: 'ds-dialog-footer' }, cancelButton, confirmButton),
	);
	// Escape fires cancel then close; closing any other way (the form, the browser) is a cancel too.
	root.addEventListener('cancel', (event) => {
		event.preventDefault();
		finish(false);
	});
	root.addEventListener('close', () => finish(false));
	document.body.append(root);
	root.showModal();
	// The safe choice has focus first, so Enter does nothing drastic.
	cancelButton.focus();
	return { root, result, close: () => finish(false) };
}

/** A yes/no question as a dialog: resolves `true` when the confirming button is pressed. */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
	return dialog(options).result;
}

export interface FormDialogOptions {
	title: string;
	/** The content under the title's divider: a padded column with 16px between items. */
	body: Child[];
	/** Buttons under a divider at the foot; one fills the width, two share it. Omit to keep the action in the body. */
	footer?: HTMLElement[];
	/** `card` (default): the opaque card of a question. `panel`: the translucent, blurred panel the scene dialogs draw. */
	look?: 'card' | 'panel';
	/** Runs when it closes any way but `close()`: Escape, the close button, the browser. */
	onCancel?: () => void;
	id?: string;
}

export interface FormDialogHandle {
	root: HTMLDialogElement;
	/** The body column, for a caller that adds or swaps content later. */
	body: HTMLDivElement;
	/** Whether it is still open. */
	readonly open: boolean;
	/** Closes and removes it, as a finished dialog does (no `onCancel`). */
	close(): void;
}

/**
 * Opens a modal dialog around a caller-built form: the same title row and dividers as a
 * question, a scrolling body of fields, and an optional footer of buttons. The caller wires
 * its own buttons and calls `close()` when done; Escape and the close button cancel.
 */
export function formDialog(options: FormDialogOptions): FormDialogHandle {
	const titleId = uid('dialog-title');
	let settled = false;
	const root = el('dialog', { class: 'ds-dialog', id: options.id, 'aria-labelledby': titleId, 'data-form': 'true', 'data-look': options.look ?? 'card' });
	const finish = (cancelled: boolean) => {
		if (settled) return;
		settled = true;
		if (root.open) root.close();
		root.remove();
		if (cancelled) options.onCancel?.();
	};
	const body = el('div', { class: 'ds-dialog-form-body ds-scroll' }, ...options.body);
	root.append(
		el(
			'div',
			{ class: 'ds-dialog-header' },
			el('h2', { class: 'ds-dialog-title', id: titleId }, options.title),
			iconButton({ icon: 'close', label: 'Close', variant: 'ghost', size: 'xs', onClick: () => finish(true) }),
		),
		body,
	);
	if (options.footer?.length) root.append(el('div', { class: 'ds-dialog-footer ds-dialog-form-footer' }, ...options.footer));
	root.addEventListener('cancel', (event) => {
		event.preventDefault();
		finish(true);
	});
	root.addEventListener('close', () => finish(true));
	document.body.append(root);
	root.showModal();
	// The first field has focus, so typing starts at once.
	body.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus();
	return {
		root,
		body,
		get open() {
			return !settled;
		},
		close: () => finish(false),
	};
}
