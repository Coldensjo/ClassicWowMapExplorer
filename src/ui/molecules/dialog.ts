/**
 * Dialog factory. Spec: specs/dialog.md; styles in dialog.css.
 *
 * A modal confirmation on the native <dialog> element, which gives the top layer, focus
 * containment, Escape and the ::backdrop scrim for free. dialog() builds and opens one and
 * resolves with the choice; confirmDialog() is the common yes/no shape as a boolean. The
 * element is appended to <body> for its life and removed when it closes.
 */
import { el, uid } from '../dom';
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
