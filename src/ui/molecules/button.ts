/**
 * Button and icon button factories. Spec: specs/buttons.md; styles in button.css.
 *
 * button() makes a text button with an optional leading 16px icon; iconButton() an icon-only
 * button that must be named. Both return the native <button>, so callers can add listeners,
 * ids and titles as they would on any element. Pressed (toggled) and disabled state are set
 * with the setters so the ARIA stays right.
 */
import { icon, type IconName, type IconSize } from '../icons';
import { el } from '../dom';

export type ButtonVariant = 'primary' | 'secondary' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions {
	/** The visible text. */
	label: string;
	/** `primary` for the main action, `secondary` (default) or `outline` for the rest. */
	variant?: ButtonVariant;
	/** Height 30, 38 or 48px; default `sm`. */
	size?: ButtonSize;
	/** A leading 16px icon. */
	icon?: IconName;
	disabled?: boolean;
	/** Toggled on (`aria-pressed`), for toolbar-style buttons. */
	pressed?: boolean;
	/** Tooltip text. */
	title?: string;
	/** `button` (default) or `submit`. */
	type?: 'button' | 'submit';
	id?: string;
	onClick?: (event: MouseEvent) => void;
}

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface IconButtonOptions {
	icon: IconName;
	/** The accessible name; also the tooltip unless `title` is given. */
	label: string;
	/** Circular `primary` or `secondary` (default), or square `ghost`. */
	variant?: IconButtonVariant;
	/** Box 24 (`xs`, ghost only), 32, 40 or 48px. Default `lg`, or `xs` for ghost. */
	size?: IconButtonSize;
	disabled?: boolean;
	pressed?: boolean;
	title?: string;
	id?: string;
	onClick?: (event: MouseEvent) => void;
}

/** The icon size each icon-button variant draws at each box size (buttons.md §5–7). */
const ICON_SIZES: Record<'circle' | 'ghost', Record<IconButtonSize, IconSize>> = {
	circle: { xs: 'sm', sm: 'sm', md: 'lg', lg: 'lg' },
	ghost: { xs: 'sm', sm: 'lg', md: 'lg', lg: 'lg' },
};

function base(options: { disabled?: boolean; pressed?: boolean; title?: string; id?: string; type?: string; onClick?: (e: MouseEvent) => void }): HTMLButtonElement {
	const node = el('button', {
		type: options.type ?? 'button',
		id: options.id,
		title: options.title,
		disabled: options.disabled,
	});
	if (options.pressed !== undefined) setPressed(node, options.pressed);
	if (options.onClick) node.addEventListener('click', options.onClick);
	return node;
}

/** Makes a text button: `<button class="ds-button" data-variant data-size>`. */
export function button(options: ButtonOptions): HTMLButtonElement {
	const node = base(options);
	node.className = 'ds-button';
	node.dataset.variant = options.variant ?? 'secondary';
	node.dataset.size = options.size ?? 'sm';
	if (options.icon) node.append(icon(options.icon, { size: 'sm' }));
	node.append(el('span', { class: 'ds-button-label' }, options.label));
	return node;
}

/** Makes an icon-only button named by `label`: `<button class="ds-icon-button" …>`. */
export function iconButton(options: IconButtonOptions): HTMLButtonElement {
	const variant = options.variant ?? 'secondary';
	const size = options.size ?? (variant === 'ghost' ? 'xs' : 'lg');
	const node = base({ ...options, title: options.title ?? options.label });
	node.className = 'ds-icon-button';
	node.dataset.variant = variant;
	node.dataset.size = size;
	node.setAttribute('aria-label', options.label);
	node.append(icon(options.icon, { size: ICON_SIZES[variant === 'ghost' ? 'ghost' : 'circle'][size] }));
	return node;
}

/** Toggles a button's on state (`aria-pressed`). */
export function setPressed(button: HTMLButtonElement, on: boolean): void {
	button.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** Enables or disables a button. */
export function setDisabled(button: HTMLButtonElement, disabled: boolean): void {
	button.disabled = disabled;
}
