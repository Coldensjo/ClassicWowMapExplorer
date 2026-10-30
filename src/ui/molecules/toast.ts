/**
 * Toast: a transient status message. Spec: specs/toast.md; styles in toast.css.
 *
 * showToast() adds a toast to the one live region, announces it politely, and removes it after
 * its duration (longer for longer messages; paused while hovered or focused). At most three
 * show at once; the oldest leaves first. Clicking a toast dismisses it.
 */
import { el } from '../dom';
import { button } from './button';

export interface ToastOptions {
	message: string;
	/** Overrides the computed duration. */
	durationMs?: number;
	/** A small button below the message, e.g. Undo. Pressing it dismisses the toast. */
	action?: { label: string; onClick: () => void };
}

export interface ToastHandle {
	dismiss(): void;
	readonly root: HTMLElement;
}

const MAX_SHOWN = 3;
const BASE_MS = 4000;
const EXTRA_MS_PER_20_CHARS = 1000;
const FREE_CHARS = 40;

let region: HTMLElement | null = null;
const shown: ToastHandle[] = [];

function getRegion(): HTMLElement {
	if (!region || !region.isConnected) {
		region = el('div', { class: 'ds-toast-region', role: 'status', 'aria-live': 'polite' });
		document.body.append(region);
	}
	return region;
}

function reducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Shows a toast and returns a handle to dismiss it early. */
export function showToast(options: ToastOptions | string): ToastHandle {
	const opts = typeof options === 'string' ? { message: options } : options;
	const duration = opts.durationMs ?? BASE_MS + Math.max(0, opts.message.length - FREE_CHARS) / 20 * EXTRA_MS_PER_20_CHARS;

	const root = el('div', { class: 'ds-toast', tabindex: 0 }, el('p', { class: 'ds-toast-message' }, opts.message));
	if (opts.action) {
		const action = opts.action;
		const actionButton = button({
			label: action.label,
			variant: 'secondary',
			size: 'sm',
			onClick: (event) => {
				event.stopPropagation();
				dismiss();
				action.onClick();
			},
		});
		actionButton.classList.add('ds-toast-action');
		root.append(actionButton);
	}

	let remaining = duration;
	let startedAt = 0;
	let timer = 0;
	let done = false;

	const start = () => {
		startedAt = Date.now();
		timer = window.setTimeout(dismiss, remaining);
	};
	const pause = () => {
		window.clearTimeout(timer);
		remaining = Math.max(0, remaining - (Date.now() - startedAt));
	};

	function dismiss(): void {
		if (done) return;
		done = true;
		window.clearTimeout(timer);
		const index = shown.indexOf(handle);
		if (index >= 0) shown.splice(index, 1);
		const remove = () => root.remove();
		if (reducedMotion()) {
			remove();
		} else {
			root.dataset.leaving = '';
			root.addEventListener('animationend', remove, { once: true });
			window.setTimeout(remove, 400);
		}
	}

	root.addEventListener('pointerenter', pause);
	root.addEventListener('pointerleave', start);
	root.addEventListener('focusin', pause);
	root.addEventListener('focusout', start);
	root.addEventListener('click', dismiss);
	root.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' || event.key === 'Enter') dismiss();
	});

	const handle: ToastHandle = { root, dismiss };
	while (shown.length >= MAX_SHOWN) shown[0].dismiss();
	shown.push(handle);
	getRegion().append(root);
	start();
	return handle;
}

/** Dismisses every toast now. */
export function dismissToasts(): void {
	for (const toast of [...shown]) toast.dismiss();
}
