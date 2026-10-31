/**
 * Tooltip factories. Spec: specs/tooltip.md; styles in tooltip.css and key-command.css.
 *
 * tooltip() makes the element; attachTooltip() ties one to an anchor. A simple tooltip shows
 * on hover (after a short delay, or at once when moving between tooltipped controls) and on
 * focus, and hides on leave, blur or Escape; it describes the anchor through aria-describedby.
 * A complex tooltip opens on click and stays until Escape or a press outside; with extra
 * interactive content it is a non-modal dialog rather than a tooltip.
 */
import { el, uid } from '../dom';
import { hidePanel, showPanel, whileOpen, type Placement } from '../popover';
import { kbd } from './key-command';

export interface TooltipOptions {
	text: string;
	/** Simple only: a small keycap after the text. */
	shortcut?: string;
	/** `simple` (default) or `complex`. */
	variant?: 'simple' | 'complex';
	/** The side of the anchor the tooltip sits on; default top. Flips when it does not fit. */
	placement?: Placement;
	/** Complex only: extra content below the text. */
	content?: Node;
}

export interface TooltipHandle {
	show(): void;
	hide(): void;
	destroy(): void;
	readonly root: HTMLElement;
}

const SHOW_DELAY = 500;
const WARM_WINDOW = 300;

/** The moment the last tooltip hid, so a neighbour can show without the delay. */
let lastHidden = 0;

/** Makes a tooltip element (not yet positioned): `<div class="ds-tooltip" role="tooltip">`. */
export function tooltip(options: TooltipOptions): HTMLElement {
	const variant = options.variant ?? 'simple';
	const body = el('div', { class: 'ds-tooltip-body' }, el('span', { class: 'ds-tooltip-text' }, options.text));
	if (variant === 'simple' && options.shortcut) body.append(kbd(options.shortcut, { size: 'sm' }));
	if (variant === 'complex' && options.content) body.append(el('div', { class: 'ds-tooltip-content' }, options.content));
	return el(
		'div',
		{
			class: 'ds-tooltip',
			id: uid('tooltip'),
			role: variant === 'complex' && options.content ? 'dialog' : 'tooltip',
			'data-variant': variant,
			'data-placement': options.placement ?? 'top',
			hidden: true,
		},
		body,
		el('span', { class: 'ds-tooltip-nubbin', 'aria-hidden': 'true' }),
	);
}

/** Attaches a tooltip to `anchor` and wires its show and hide behaviour. */
export function attachTooltip(anchor: HTMLElement, options: TooltipOptions): TooltipHandle {
	const root = tooltip(options);
	const variant = options.variant ?? 'simple';
	const placement = options.placement ?? 'top';
	let timer = 0;
	let release: (() => void) | null = null;

	const place = () => {
		// The nubbin's 4px plus the 4px gap from the anchor edge to its tip.
		const placed = showPanel(root, anchor, { placement, offset: 8, align: 'center' });
		root.style.setProperty('--tooltip-anchor', `${Math.round(placed.anchorCenter)}px`);
	};

	function show(): void {
		window.clearTimeout(timer);
		if (!root.hidden) return;
		place();
		if (variant === 'simple') {
			anchor.setAttribute('aria-describedby', root.id);
		} else {
			anchor.setAttribute('aria-expanded', 'true');
			release = whileOpen([root, anchor], () => hide());
		}
	}

	function hide(): void {
		window.clearTimeout(timer);
		if (root.hidden) return;
		hidePanel(root);
		lastHidden = Date.now();
		if (variant === 'simple') anchor.removeAttribute('aria-describedby');
		else anchor.setAttribute('aria-expanded', 'false');
		release?.();
		release = null;
	}

	const listeners: Array<[string, EventListener]> = [];
	const on = (type: string, listener: EventListener) => {
		anchor.addEventListener(type, listener);
		listeners.push([type, listener]);
	};

	if (variant === 'simple') {
		on('pointerenter', () => {
			window.clearTimeout(timer);
			const delay = Date.now() - lastHidden < WARM_WINDOW ? 0 : SHOW_DELAY;
			timer = window.setTimeout(show, delay);
		});
		on('pointerleave', hide);
		on('pointerdown', hide);
		on('focusin', show);
		on('focusout', hide);
		on('keydown', (event) => {
			if ((event as KeyboardEvent).key === 'Escape') hide();
		});
	} else {
		anchor.setAttribute('aria-expanded', 'false');
		anchor.setAttribute('aria-controls', root.id);
		on('click', () => (root.hidden ? show() : hide()));
	}

	return {
		root,
		show,
		hide,
		destroy() {
			hide();
			for (const [type, listener] of listeners) anchor.removeEventListener(type, listener);
			root.remove();
		},
	};
}
