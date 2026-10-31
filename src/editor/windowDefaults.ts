import type { WindowRect } from '../ui';

/**
 * Where the browser windows (the texture browser, the object browser, the NPC library) open
 * before the user moves them: the bottom left of the viewport, 16px in from the left and
 * bottom edges, at the size the design places them (decided 2026-10-30; see
 * src/ui/specs/floating-window.md). The side panel controls have the right.
 */
export function browserWindowRect(): WindowRect {
	return { x: 16, bottom: 16, width: 360, height: 487 };
}
