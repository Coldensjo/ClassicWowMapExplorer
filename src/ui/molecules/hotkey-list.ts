/**
 * Hotkey list factory. Spec: specs/hotkey-list.md; styles in hotkey-list.css.
 *
 * A list of "what a key does" rows for a tool panel: a label on the left, the keycap chord on
 * the right, and an optional tail such as "+ click" or "+ drag" after the chord. With a
 * heading ("Hotkeys") the rows sit behind a thin rule, as drawn under a radio option; without
 * one they are a plain list, as drawn in a module of their own. Write key names as users say
 * them ("Shift", "Cmd"); the caps are set in capitals by CSS.
 */
import { el } from '../dom';
import { kbd } from './key-command';

export interface HotkeyRow {
	/** What the keys do, e.g. "Raise" or "+ size". */
	label: string;
	/** The keys pressed together, e.g. ["Shift"] or ["Cmd", "D"]. */
	keys: string[];
	/** What follows the keys, e.g. "click" or "drag", shown as "+ click" (alone when there are no keys). */
	tail?: string;
}

export interface HotkeyListOptions {
	/** The heading above the rows; omitted, the rows stand alone. */
	heading?: string;
	rows: HotkeyRow[];
}

export interface HotkeyListHandle {
	root: HTMLDivElement;
}

function row(spec: HotkeyRow): HTMLLIElement {
	const keys = el('span', { class: 'ds-hotkey-keys' });
	spec.keys.forEach((key, i) => {
		if (i > 0) keys.append(el('span', { class: 'ds-hotkey-plus', 'aria-hidden': 'true' }, '+'));
		keys.append(kbd(key));
	});
	if (spec.tail) keys.append(el('span', { class: 'ds-hotkey-tail' }, spec.keys.length ? `+ ${spec.tail}` : spec.tail));
	return el('li', { class: 'ds-hotkey-row' }, el('span', { class: 'ds-hotkey-label' }, spec.label), keys);
}

/** Makes a hotkey list: `<div class="ds-hotkey-list">` with an optional heading and a `<ul>` of rows. */
export function hotkeyList(options: HotkeyListOptions): HotkeyListHandle {
	const list = el('ul', { class: 'ds-hotkey-rows' }, ...options.rows.map(row));
	const root = el(
		'div',
		{ class: 'ds-hotkey-list', 'data-headed': options.heading ? '' : undefined },
		options.heading ? el('p', { class: 'ds-hotkey-heading' }, options.heading) : null,
		list,
	);
	return { root };
}

/** Replaces the rows without touching the heading. */
export function setHotkeyRows(root: HTMLElement, rows: HotkeyRow[]): void {
	root.querySelector('.ds-hotkey-rows')?.replaceChildren(...rows.map(row));
}
