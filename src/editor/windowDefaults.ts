import type { WindowRect } from '../ui';

/**
 * Where the browser windows (the texture browser, the object browser, the NPC library) open
 * before the user moves them: the bottom left of the viewport, 16px in from the edge and 16px
 * above the status bar, at the size the design places them (decided 2026-10-30; see
 * src/ui/specs/floating-window.md). The side panel controls have the right.
 */
export function browserWindowRect(): WindowRect {
	return { x: 16, bottom: statusBarHeight() + 16, width: 360, height: 487 };
}

/** The status bar's height from its token, since the bar may still be hidden when a window is made. */
function statusBarHeight(): number {
	const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-bar-height'));
	return Number.isFinite(value) ? value : 22;
}
