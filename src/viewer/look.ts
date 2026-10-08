/**
 * How far the view turns per pixel of mouse movement, for flying and walking alike. The View
 * panel scales it: raw mouse movement skips the system's pointer acceleration, which on a Mac
 * makes the normal setting feel slow.
 */

/** Radians per pixel at the normal setting. */
const LOOK_SENSITIVITY = 0.0022;

export const MOUSE_SPEED_MIN = 0.25;
export const MOUSE_SPEED_MAX = 4;

let scale = 1;

export function mouseSpeed(): number {
	return scale;
}

export function setMouseSpeed(value: number): void {
	scale = Math.min(MOUSE_SPEED_MAX, Math.max(MOUSE_SPEED_MIN, value));
}

/** Radians of turn per pixel of mouse movement. */
export function lookPerPixel(): number {
	return LOOK_SENSITIVITY * scale;
}
