/**
 * Floating-panel helpers for the menu, select and tooltip: positioning a fixed panel beside an
 * anchor in the viewport, flipping when there is no room, and closing on outside presses.
 * Panels are appended to <body> and `position: fixed`, so a scrolling panel never clips them.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface PositionOptions {
	/** Preferred side; flipped to the opposite side when it does not fit. Default bottom. */
	placement?: Placement;
	/** Distance between anchor and panel, in px. */
	offset?: number;
	/** Give the panel the anchor's width (a select's list). */
	matchWidth?: boolean;
	/** For top/bottom: align the panel's start edge with the anchor's (default) or centre it. */
	align?: 'start' | 'center';
	/** Space kept from the viewport edges. */
	margin?: number;
}

export interface Placed {
	placement: Placement;
	/** The anchor's centre along the panel's edge, in px from the panel's start, for a nubbin. */
	anchorCenter: number;
}

/** Shows a hidden panel beside its anchor (appending it to <body> first) and returns the placement used. */
export function showPanel(panel: HTMLElement, anchor: Element, options: PositionOptions = {}): Placed {
	if (!panel.isConnected) document.body.append(panel);
	panel.hidden = false;
	const placed = positionPanel(panel, anchor, options);
	panel.dataset.placement = placed.placement;
	return placed;
}

/** Scrolls `panel` so `row` is in view, without scrolling anything else (scrollIntoView could move the page). */
export function revealInPanel(panel: HTMLElement, row: HTMLElement): void {
	const top = row.offsetTop;
	const bottom = top + row.offsetHeight;
	if (top < panel.scrollTop) panel.scrollTop = top;
	else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
}

const OPPOSITE: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Positions `panel` (already in the DOM and visible) next to `anchor`. */
export function positionPanel(panel: HTMLElement, anchor: Element, options: PositionOptions = {}): Placed {
	const offset = options.offset ?? 4;
	const margin = options.margin ?? 8;
	const a = anchor.getBoundingClientRect();
	if (options.matchWidth) panel.style.minInlineSize = `${a.width}px`;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	let p = panel.getBoundingClientRect();

	let placement = options.placement ?? 'bottom';
	const fits = (side: Placement): boolean => {
		switch (side) {
			case 'bottom':
				return a.bottom + offset + p.height <= vh - margin;
			case 'top':
				return a.top - offset - p.height >= margin;
			case 'right':
				return a.right + offset + p.width <= vw - margin;
			case 'left':
				return a.left - offset - p.width >= margin;
		}
	};
	if (!fits(placement) && fits(OPPOSITE[placement])) placement = OPPOSITE[placement];

	let left: number;
	let top: number;
	if (placement === 'top' || placement === 'bottom') {
		left = options.align === 'center' ? a.left + a.width / 2 - p.width / 2 : a.left;
		top = placement === 'bottom' ? a.bottom + offset : a.top - offset - p.height;
	} else {
		top = a.top + a.height / 2 - p.height / 2;
		left = placement === 'right' ? a.right + offset : a.left - offset - p.width;
	}
	left = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - p.width));
	top = Math.min(Math.max(margin, top), Math.max(margin, vh - margin - p.height));
	panel.style.left = `${Math.round(left)}px`;
	panel.style.top = `${Math.round(top)}px`;

	const anchorCenter = placement === 'top' || placement === 'bottom' ? a.left + a.width / 2 - left : a.top + a.height / 2 - top;
	return { placement, anchorCenter };
}

/**
 * Calls `onClose` on a pointer press outside every element in `inside`, on Escape, and when
 * the window scrolls or resizes. Returns a function that stops listening.
 */
export function whileOpen(inside: Element[], onClose: (reason: 'outside' | 'escape' | 'scroll') => void): () => void {
	const onPointer = (event: PointerEvent) => {
		const target = event.target;
		if (target instanceof Node && inside.some((node) => node.contains(target))) return;
		onClose('outside');
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape') onClose('escape');
	};
	const onScroll = (event: Event) => {
		if (event.target instanceof Node && inside.some((node) => node.contains(event.target as Node))) return;
		onClose('scroll');
	};
	const onResize = () => onClose('scroll');
	document.addEventListener('pointerdown', onPointer, true);
	document.addEventListener('keydown', onKey, true);
	window.addEventListener('scroll', onScroll, true);
	window.addEventListener('resize', onResize);
	return () => {
		document.removeEventListener('pointerdown', onPointer, true);
		document.removeEventListener('keydown', onKey, true);
		window.removeEventListener('scroll', onScroll, true);
		window.removeEventListener('resize', onResize);
	};
}
