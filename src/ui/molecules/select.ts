/**
 * Select factory. Spec: specs/dropdown.md; styles in field.css, select.css and menu.css.
 *
 * A select-only combobox: the trigger is a button showing the value; the list is a .ds-menu
 * listbox in the top layer. Keyboard follows the WAI-ARIA pattern: Enter, Space, ↓ and ↑ open;
 * arrows, Home and End move the active option; typing jumps to a matching option; Enter or
 * Space selects; Escape and Tab close without changing. onChange fires only when the value
 * changes. The molecule owns no model state: setSelectValue() and setSelectOptions() update it.
 */
import { icon } from '../icons';
import { el, uid } from '../dom';
import { hidePanel, revealInPanel, showPanel, whileOpen } from '../popover';
import { fieldShell } from './field';
import { menuOption, menuPanel, setOptionSelected } from './menu';

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SelectOptions {
	label?: string;
	/** Required when `label` is omitted. */
	ariaLabel?: string;
	options: SelectOption[];
	/** The selected value, or null for none (then `placeholder` shows). */
	value: string | null;
	placeholder?: string;
	hint?: string;
	disabled?: boolean;
	title?: string;
	id?: string;
	onChange?: (value: string) => void;
}

export interface SelectHandle {
	root: HTMLDivElement;
	trigger: HTMLButtonElement;
	list: HTMLUListElement;
}

interface State {
	options: SelectOption[];
	rows: HTMLLIElement[];
	value: string | null;
	active: number;
}

const TYPEAHEAD_RESET = 500;

/** Makes a select: `<div class="ds-field ds-select">` with its listbox. */
export function select(options: SelectOptions): SelectHandle {
	const valueId = uid('select-value');
	const valueNode = el('span', { class: 'ds-select-value', id: valueId });
	let chevron = icon('down', { size: 'sm' });
	const swapChevron = (name: 'down' | 'up') => {
		const next = icon(name, { size: 'sm' });
		chevron.replaceWith(next);
		chevron = next;
	};
	const list = menuPanel('listbox');
	const trigger = el(
		'button',
		{
			class: 'ds-field-box ds-select-trigger',
			type: 'button',
			role: 'combobox',
			id: options.id,
			title: options.title,
			disabled: options.disabled,
			'aria-haspopup': 'listbox',
			'aria-expanded': 'false',
			'aria-controls': list.id,
			'aria-label': options.label ? undefined : options.ariaLabel,
		},
		valueNode,
		chevron,
	);
	const shell = fieldShell({ label: options.label, hint: options.hint, controlId: options.id }, trigger);
	trigger.id = shell.controlId;
	if (shell.label) {
		shell.label.id = `${trigger.id}-label`;
		trigger.setAttribute('aria-labelledby', `${shell.label.id} ${valueId}`);
		list.setAttribute('aria-labelledby', shell.label.id);
	} else if (options.ariaLabel) {
		list.setAttribute('aria-label', options.ariaLabel);
	}
	if (shell.hintId) trigger.setAttribute('aria-describedby', shell.hintId);
	const root = shell.root;
	root.classList.add('ds-select');
	if (options.disabled) root.setAttribute('aria-disabled', 'true');

	const state: State = { options: [], rows: [], value: options.value, active: -1 };
	let release: (() => void) | null = null;
	let typed = '';
	let typedAt = 0;

	const render = () => {
		const current = state.options.find((o) => o.value === state.value);
		valueNode.textContent = current ? current.label : (options.placeholder ?? '');
		if (current) delete root.dataset.empty;
		else root.dataset.empty = '';
		state.rows.forEach((row, i) => setOptionSelected(row, state.options[i].value === state.value));
	};

	const setActive = (index: number) => {
		state.rows.forEach((row, i) => {
			if (i === index) row.dataset.active = '';
			else delete row.dataset.active;
		});
		state.active = index;
		const row = state.rows[index];
		if (row) {
			trigger.setAttribute('aria-activedescendant', row.id);
			revealInPanel(list, row);
		} else {
			trigger.removeAttribute('aria-activedescendant');
		}
	};

	const enabledIndexes = () => state.options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

	const choose = (index: number) => {
		const option = state.options[index];
		if (!option || option.disabled) return;
		close();
		trigger.focus();
		if (option.value !== state.value) {
			state.value = option.value;
			render();
			options.onChange?.(option.value);
		}
	};

	function open(fromEnd = false): void {
		if (release || trigger.disabled) return;
		showPanel(list, trigger, { placement: 'bottom', matchWidth: true });
		trigger.setAttribute('aria-expanded', 'true');
		swapChevron('up');
		const selected = state.options.findIndex((o) => o.value === state.value && !o.disabled);
		const candidates = enabledIndexes();
		setActive(selected >= 0 ? selected : fromEnd ? (candidates.at(-1) ?? -1) : (candidates[0] ?? -1));
		release = whileOpen([list, trigger], (reason) => {
			close();
			if (reason === 'escape') trigger.focus();
		});
	}

	function close(): void {
		if (!release) return;
		release();
		release = null;
		hidePanel(list);
		trigger.setAttribute('aria-expanded', 'false');
		swapChevron('down');
		setActive(-1);
	}

	const move = (delta: number) => {
		const candidates = enabledIndexes();
		if (!candidates.length) return;
		const at = candidates.indexOf(state.active);
		const next = at < 0 ? (delta > 0 ? 0 : candidates.length - 1) : Math.min(candidates.length - 1, Math.max(0, at + delta));
		setActive(candidates[next]);
	};

	const typeahead = (key: string) => {
		const now = Date.now();
		typed = now - typedAt > TYPEAHEAD_RESET ? key : typed + key;
		typedAt = now;
		const candidates = enabledIndexes();
		const start = candidates.indexOf(state.active);
		for (let n = 1; n <= candidates.length; n++) {
			const i = candidates[(start + n) % candidates.length];
			if (state.options[i].label.toLowerCase().startsWith(typed.toLowerCase())) {
				if (!release) open();
				setActive(i);
				return;
			}
		}
	};

	trigger.addEventListener('click', () => (release ? close() : open()));
	trigger.addEventListener('keydown', (event) => {
		const isOpen = release !== null;
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (isOpen) move(1);
				else open();
				break;
			case 'ArrowUp':
				event.preventDefault();
				if (isOpen) move(-1);
				else open(true);
				break;
			case 'Home':
			case 'End':
				if (!isOpen) return;
				event.preventDefault();
				move(event.key === 'Home' ? -Infinity : Infinity);
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				if (isOpen) choose(state.active);
				else open();
				break;
			case 'Tab':
				close();
				break;
			default:
				if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
					event.preventDefault();
					typeahead(event.key);
				}
		}
	});
	list.addEventListener('pointermove', (event) => {
		const row = (event.target as Element).closest<HTMLLIElement>('.ds-menu-option');
		if (row) setActive(state.rows.indexOf(row));
	});
	list.addEventListener('click', (event) => {
		const row = (event.target as Element).closest<HTMLLIElement>('.ds-menu-option');
		if (row) choose(state.rows.indexOf(row));
	});

	const apply = (next: SelectOption[]) => {
		state.options = next;
		state.rows = next.map((o) => menuOption({ label: o.label, role: 'option', disabled: o.disabled }));
		list.replaceChildren(...state.rows);
		render();
	};
	apply(options.options);

	handles.set(root, {
		apply,
		setValue: (v) => {
			state.value = v;
			render();
		},
	});
	return { root, trigger, list };
}

interface Internal {
	apply(options: SelectOption[]): void;
	setValue(value: string | null): void;
}

const handles = new WeakMap<HTMLElement, Internal>();

/** Selects `value` (or none, for null) without firing onChange. */
export function setSelectValue(root: HTMLElement, value: string | null): void {
	handles.get(root)?.setValue(value);
}

/** Replaces the options, keeping the current value if it is still present. */
export function setSelectOptions(root: HTMLElement, options: SelectOption[]): void {
	handles.get(root)?.apply(options);
}
