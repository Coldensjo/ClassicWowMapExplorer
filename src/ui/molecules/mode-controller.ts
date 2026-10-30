/**
 * Mode controller factory. Spec: specs/mode-controller.md; styles in mode-controller.css.
 *
 * The editor's tool switcher: a radio group of seven chips in a fixed order, exactly one
 * checked. ←/→ move and switch; bindModeShortcuts() adds the number keys 1 to 7, which follow
 * the chip order. Each chip carries a simple tooltip with its name and number. The editor owns
 * the current mode: it listens with onChange and calls setMode() when the mode changes
 * elsewhere.
 */
import { icon, type IconName } from '../icons';
import { el, isTyping } from '../dom';
import { attachTooltip } from './tooltip';

export type ModeId = 'environment' | 'sculpt' | 'paint' | 'water' | 'holes' | 'objects' | 'npcs';

export interface ModeDefinition {
	id: ModeId;
	icon: IconName;
	label: string;
}

/** The seven modes in chip order; shortcuts 1 to 7 follow it. */
export const MODES: readonly ModeDefinition[] = [
	{ id: 'environment', icon: 'sun', label: 'Environment' },
	{ id: 'sculpt', icon: 'sculpt', label: 'Sculpt' },
	{ id: 'paint', icon: 'paint', label: 'Paint' },
	{ id: 'water', icon: 'water', label: 'Water' },
	{ id: 'holes', icon: 'hole', label: 'Holes' },
	{ id: 'objects', icon: 'container', label: 'Objects' },
	{ id: 'npcs', icon: 'npc', label: 'NPCs' },
];

export interface ModeControllerOptions {
	value: ModeId;
	/** Which chips to show, in chip order; default all seven. */
	modes?: ModeId[];
	disabledModes?: ModeId[];
	/** Radio name; default "editor-mode". */
	name?: string;
	/** The group's accessible name; default "Editor mode". */
	label?: string;
	/** Show each chip's tooltip with its name and number; default true. */
	tooltips?: boolean;
	onChange?: (mode: ModeId) => void;
}

export interface ModeControllerHandle {
	root: HTMLDivElement;
}

/** Makes the bar: `<div class="ds-mode-controller" role="radiogroup">`. */
export function modeController(options: ModeControllerOptions): ModeControllerHandle {
	const shown = options.modes ? MODES.filter((m) => options.modes!.includes(m.id)) : MODES;
	const root = el('div', { class: 'ds-mode-controller', role: 'radiogroup', 'aria-label': options.label ?? 'Editor mode' });
	shown.forEach((mode, i) => {
		const input = el('input', {
			class: 'ds-mode-chip-input ds-visually-hidden',
			type: 'radio',
			name: options.name ?? 'editor-mode',
			value: mode.id,
			disabled: options.disabledModes?.includes(mode.id),
		});
		input.checked = mode.id === options.value;
		const chip = el(
			'label',
			{ class: 'ds-mode-chip', 'data-mode': mode.id },
			input,
			icon(mode.icon, { size: 'lg' }),
			el('span', { class: 'ds-mode-chip-label' }, mode.label),
		);
		if (options.tooltips ?? true) attachTooltip(chip, { text: mode.label, shortcut: String(i + 1), placement: 'top' });
		root.append(chip);
	});
	if (options.onChange) {
		const onChange = options.onChange;
		root.addEventListener('change', (event) => {
			const input = event.target;
			if (input instanceof HTMLInputElement && input.checked) onChange(input.value as ModeId);
		});
	}
	return { root };
}

/** Selects `mode` without firing onChange. */
export function setMode(root: HTMLElement, mode: ModeId): void {
	for (const input of root.querySelectorAll<HTMLInputElement>('.ds-mode-chip-input')) {
		input.checked = input.value === mode;
	}
}

/**
 * Makes the number keys select the chips in order (1 for the first shown chip) from anywhere
 * on the page except while typing in a field. Selecting through a shortcut fires onChange like
 * a click. Returns a function that removes the listener.
 */
export function bindModeShortcuts(root: HTMLElement, target: Window | HTMLElement = window): () => void {
	const onKey = (event: Event) => {
		const key = event as KeyboardEvent;
		if (key.ctrlKey || key.metaKey || key.altKey || isTyping(key.target)) return;
		const n = Number(key.key);
		if (!Number.isInteger(n) || n < 1) return;
		const inputs = root.querySelectorAll<HTMLInputElement>('.ds-mode-chip-input');
		const input = inputs[n - 1];
		if (!input || input.disabled || input.checked) return;
		key.preventDefault();
		input.click();
	};
	target.addEventListener('keydown', onKey);
	return () => target.removeEventListener('keydown', onKey);
}
