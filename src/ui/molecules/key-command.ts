/**
 * Key command factory. Spec: specs/key-command.md; styles in key-command.css.
 *
 * kbd() makes one keycap; kbdChord() a row of them joined with "+". Write key names as users
 * say them ("Shift", not "SHIFT"): the small size uppercases in CSS, so screen readers never
 * spell the word out.
 */
import { el, append } from '../dom';

export type KbdSize = 'md' | 'sm';

export interface KbdOptions {
	/** `md` (default, 24px) or `sm` (17px, capitals). */
	size?: KbdSize;
}

/** Makes a keycap: `<kbd class="ds-kbd">`. */
export function kbd(label: string, options: KbdOptions = {}): HTMLElement {
	return el('kbd', { class: 'ds-kbd', 'data-size': options.size === 'sm' ? 'sm' : undefined }, label);
}

/** Makes a chord such as Shift + 1: keycaps with a "+" between them. */
export function kbdChord(keys: string[], options: KbdOptions = {}): HTMLElement {
	const root = el('span', { class: 'ds-kbd-chord' });
	keys.forEach((key, i) => {
		if (i > 0) append(root, el('span', { 'aria-hidden': 'true' }, '+'));
		append(root, kbd(key, options));
	});
	return root;
}
