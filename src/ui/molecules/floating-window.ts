/**
 * Floating window factory. Spec: specs/floating-window.md; styles in floating-window.css.
 *
 * A panel that floats over the viewport and can be moved (drag the header, or arrow keys on
 * it), resized (drag the bottom-right grip, or arrow keys on it) and collapsed to its header
 * (the button in the title row). It is kept inside the viewport, and with a storageKey its
 * place, size and collapsed state come back next session. The caller fills `body` and shows or
 * hides the whole window with show(); the molecule owns only the frame.
 */
import { icon } from '../icons';
import { el, uid } from '../dom';
import { iconButton } from './button';

export interface WindowRect {
	/** Distance from the viewport's left edge, in px. Omit it and give `right` to anchor there. */
	x?: number;
	/** Distance from the viewport's right edge, in px, used when `x` is omitted. */
	right?: number;
	/** Distance from the top, in px. Omit it and give `bottom` to anchor there; default 0. */
	y?: number;
	/** Distance from the viewport's bottom edge, in px, used when `y` is omitted. */
	bottom?: number;
	width: number;
	height: number;
}

export interface FloatingWindowOptions {
	title: string;
	/** Where the window opens and how big it is, before the user moves it. */
	defaultRect: WindowRect;
	/** Smallest size the grip can make it; defaults 280 × 160. */
	minWidth?: number;
	minHeight?: number;
	/** Start collapsed to the header. Default expanded. */
	collapsed?: boolean;
	/** A localStorage key; given, the place, size and collapsed state persist under it. */
	storageKey?: string;
	id?: string;
	onCollapsedChange?: (collapsed: boolean) => void;
}

export interface FloatingWindowHandle {
	root: HTMLElement;
	/** Where the caller's content goes. */
	body: HTMLDivElement;
	readonly collapsed: boolean;
	setCollapsed(collapsed: boolean): void;
	/** Shows or hides the window (the `hidden` attribute). */
	show(on: boolean): void;
	/** Removes the window and its window-level listeners. */
	dispose(): void;
}

interface State {
	x: number;
	y: number;
	width: number;
	height: number;
	collapsed: boolean;
}

/** Keyboard step for moving and resizing, in px. */
const STEP = 16;

function isState(value: unknown): value is State {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return ['x', 'y', 'width', 'height'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k])) && typeof v.collapsed === 'boolean';
}

function load(key: string | undefined): State | null {
	if (!key) return null;
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
		return isState(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function save(key: string | undefined, state: State): void {
	if (!key) return;
	try {
		localStorage.setItem(key, JSON.stringify(state));
	} catch {
		// Storage full or blocked: the window just forgets its place.
	}
}

/** Makes a floating window, appended to <body>: `<section class="ds-floating-window">`. */
export function floatingWindow(options: FloatingWindowOptions): FloatingWindowHandle {
	const minWidth = options.minWidth ?? 280;
	const minHeight = options.minHeight ?? 160;
	const titleId = uid('window-title');
	const rect = options.defaultRect;
	const state: State = load(options.storageKey) ?? {
		x: rect.x ?? Math.max(0, window.innerWidth - rect.width - (rect.right ?? 0)),
		y: rect.y ?? (rect.bottom === undefined ? 0 : Math.max(0, window.innerHeight - rect.height - rect.bottom)),
		width: rect.width,
		height: rect.height,
		collapsed: options.collapsed ?? false,
	};

	const handle = el('div', { class: 'ds-floating-window-handle', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'));
	const toggle = iconButton({
		icon: state.collapsed ? 'plus' : 'minus',
		label: state.collapsed ? `Expand ${options.title}` : `Collapse ${options.title}`,
		variant: 'ghost',
		size: 'xs',
		onClick: () => setCollapsed(!state.collapsed),
	});
	toggle.setAttribute('aria-expanded', String(!state.collapsed));
	const title = el('h2', { class: 'ds-floating-window-title', id: titleId }, options.title);
	const header = el(
		'div',
		{
			class: 'ds-floating-window-header',
			tabindex: 0,
			'aria-label': `Move ${options.title}`,
			title: 'Drag to move; arrow keys move it too',
		},
		handle,
		el('div', { class: 'ds-floating-window-title-row' }, title, toggle),
	);
	const body = el('div', { class: 'ds-floating-window-body' });
	const grip = el(
		'button',
		{ class: 'ds-floating-window-grip', type: 'button', 'aria-label': `Resize ${options.title}`, title: 'Drag to resize; arrow keys resize it too' },
		icon('drag-to-expand', { size: 'sm' }),
	);
	const root = el('section', { class: 'ds-floating-window', id: options.id, 'aria-labelledby': titleId }, header, body, grip);

	/** Keeps the window inside the viewport: at least its header stays reachable. */
	const clamp = () => {
		const headerHeight = header.offsetHeight || 60;
		state.width = Math.min(Math.max(minWidth, state.width), window.innerWidth);
		state.height = Math.min(Math.max(minHeight, state.height), window.innerHeight);
		state.x = Math.min(Math.max(0, state.x), Math.max(0, window.innerWidth - state.width));
		state.y = Math.min(Math.max(0, state.y), Math.max(0, window.innerHeight - headerHeight));
	};

	const apply = () => {
		root.style.setProperty('--window-x', `${Math.round(state.x)}px`);
		root.style.setProperty('--window-y', `${Math.round(state.y)}px`);
		root.style.setProperty('--window-width', `${Math.round(state.width)}px`);
		root.style.setProperty('--window-height', `${Math.round(state.height)}px`);
		root.toggleAttribute('data-collapsed', state.collapsed);
	};

	const commit = () => {
		clamp();
		apply();
		save(options.storageKey, state);
	};

	const setCollapsed = (collapsed: boolean) => {
		if (collapsed === state.collapsed) return;
		state.collapsed = collapsed;
		toggle.replaceChildren(icon(collapsed ? 'plus' : 'minus', { size: 'sm' }));
		toggle.setAttribute('aria-label', collapsed ? `Expand ${options.title}` : `Collapse ${options.title}`);
		toggle.title = toggle.getAttribute('aria-label') ?? '';
		toggle.setAttribute('aria-expanded', String(!collapsed));
		commit();
		options.onCollapsedChange?.(collapsed);
	};

	// Pointer drags: the header moves, the grip resizes. Both capture the pointer so a fast drag
	// that leaves the element keeps working.
	const drag = (surface: HTMLElement, onMove: (dx: number, dy: number) => void) => {
		let startX = 0;
		let startY = 0;
		let from: State | null = null;
		surface.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			if (event.target instanceof Element && event.target.closest('button') !== (surface === grip ? grip : null)) return;
			event.preventDefault();
			surface.setPointerCapture(event.pointerId);
			startX = event.clientX;
			startY = event.clientY;
			from = { ...state };
			root.toggleAttribute('data-dragging', true);
		});
		surface.addEventListener('pointermove', (event) => {
			if (!from) return;
			Object.assign(state, { x: from.x, y: from.y, width: from.width, height: from.height });
			onMove(event.clientX - startX, event.clientY - startY);
			clamp();
			apply();
		});
		const stop = () => {
			if (!from) return;
			from = null;
			root.toggleAttribute('data-dragging', false);
			commit();
		};
		surface.addEventListener('pointerup', stop);
		surface.addEventListener('pointercancel', stop);
		surface.addEventListener('lostpointercapture', stop);
	};
	drag(header, (dx, dy) => {
		state.x += dx;
		state.y += dy;
	});
	drag(grip, (dx, dy) => {
		state.width += dx;
		state.height += dy;
	});

	// Arrow keys on the header move it, on the grip resize it; Enter on the header toggles.
	const arrows = (event: KeyboardEvent): [number, number] | null => {
		switch (event.key) {
			case 'ArrowLeft':
				return [-STEP, 0];
			case 'ArrowRight':
				return [STEP, 0];
			case 'ArrowUp':
				return [0, -STEP];
			case 'ArrowDown':
				return [0, STEP];
			default:
				return null;
		}
	};
	header.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			setCollapsed(!state.collapsed);
			return;
		}
		const delta = arrows(event);
		if (!delta) return;
		event.preventDefault();
		state.x += delta[0];
		state.y += delta[1];
		commit();
	});
	grip.addEventListener('keydown', (event) => {
		const delta = arrows(event);
		if (!delta) return;
		event.preventDefault();
		state.width += delta[0];
		state.height += delta[1];
		commit();
	});

	const onResize = () => {
		clamp();
		apply();
	};
	window.addEventListener('resize', onResize);

	document.body.append(root);
	toggle.replaceChildren(icon(state.collapsed ? 'plus' : 'minus', { size: 'sm' }));
	commit();

	return {
		root,
		body,
		get collapsed() {
			return state.collapsed;
		},
		setCollapsed,
		show(on) {
			root.hidden = !on;
			if (on) onResize();
		},
		dispose() {
			window.removeEventListener('resize', onResize);
			root.remove();
		},
	};
}
