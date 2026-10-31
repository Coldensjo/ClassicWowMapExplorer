/**
 * Menu: the floating panel and an action menu opened from a button. Spec: specs/dropdown.md
 * §4, §6, §7.3 and §11 (headings, separators and checkable choices); styles in menu.css. The
 * select (select.ts) reuses menuPanel() and menuOption() for its listbox.
 */
import { icon, type IconName } from '../icons';
import { el, uid } from '../dom';
import { revealInPanel, showPanel, whileOpen, type Placement } from '../popover';

export interface MenuItem {
	label: string;
	icon?: IconName;
	/** Shown in the danger colour; the caller confirms elsewhere if the action can't be undone. */
	destructive?: boolean;
	disabled?: boolean;
	/**
	 * A choice in a group of choices (dropdown.md §11): `true` or `false` makes the item a
	 * `menuitemradio`, checked (semibold, a trailing checkmark) when true. Change it later with
	 * the handle's setChecked(), by the item's `id`.
	 */
	checked?: boolean;
	/** For setChecked(); any string unique within the menu. */
	id?: string;
	onSelect: () => void;
}

/** A small muted caption over a group of items, e.g. "Hotkey format". Not focusable. */
export interface MenuHeading {
	heading: string;
}

/** A thin rule between groups of items. */
export interface MenuSeparator {
	separator: true;
}

export type MenuEntry = MenuItem | MenuHeading | MenuSeparator;

export interface MenuOptions {
	/** Side of the anchor the panel opens on; flips when it does not fit. Default bottom. */
	placement?: Extract<Placement, 'top' | 'bottom'>;
}

export interface MenuHandle {
	root: HTMLUListElement;
	open(): void;
	close(): void;
	toggle(): void;
	isOpen(): boolean;
	/** Checks or unchecks the choice item with this `id`; others in the menu are left alone. */
	setChecked(id: string, checked: boolean): void;
}

/** The bare `.ds-menu` panel, hidden until opened; `role` is listbox or menu. */
export function menuPanel(role: 'listbox' | 'menu', attrs: Record<string, string | undefined> = {}): HTMLUListElement {
	return el('ul', { class: 'ds-menu ds-scroll', role, id: uid('menu'), hidden: true, ...attrs });
}

export interface MenuOptionParts {
	label: string;
	icon?: IconName;
	role: 'option' | 'menuitem' | 'menuitemradio';
	id?: string;
	destructive?: boolean;
	disabled?: boolean;
}

/** One `.ds-menu-option` row. A selected option gets its checkmark from setOptionSelected(). */
export function menuOption(parts: MenuOptionParts): HTMLLIElement {
	return el(
		'li',
		{
			class: 'ds-menu-option',
			role: parts.role,
			id: parts.id ?? uid('option'),
			tabindex: parts.role === 'option' ? undefined : -1,
			'data-destructive': parts.destructive ? '' : undefined,
			'aria-disabled': parts.disabled ? 'true' : undefined,
		},
		parts.icon ? icon(parts.icon, { size: 'sm' }) : null,
		el('span', { class: 'ds-menu-option-label' }, parts.label),
	);
}

/** A menu heading row: `<li class="ds-menu-heading">`, outside the keyboard order. */
export function menuHeading(text: string): HTMLLIElement {
	return el('li', { class: 'ds-menu-heading', role: 'presentation' }, text);
}

/** A rule between groups: `<li class="ds-menu-separator" role="separator">`. */
export function menuSeparator(): HTMLLIElement {
	return el('li', { class: 'ds-menu-separator', role: 'separator' });
}

/**
 * Marks an option selected (semibold plus a trailing checkmark) or not: `aria-selected` on a
 * listbox option, `aria-checked` on a menu's choice item.
 */
export function setOptionSelected(option: HTMLElement, selected: boolean): void {
	option.setAttribute(option.getAttribute('role') === 'menuitemradio' ? 'aria-checked' : 'aria-selected', selected ? 'true' : 'false');
	const mark = option.querySelector('.ds-menu-option-check');
	if (selected && !mark) {
		const check = icon('checkmark', { size: 'sm' });
		check.classList.add('ds-menu-option-check');
		option.append(check);
	} else if (!selected && mark) {
		mark.remove();
	}
}

/**
 * Attaches an action menu to `anchor`: clicking it (or ↓ / Enter / Space on it) opens the
 * panel below; ↓/↑ move between items, Enter/Space activate, Escape and clicking outside close.
 * Headings and separators between the items are skipped by the keys.
 */
export function menu(anchor: HTMLElement, entries: MenuEntry[], options: MenuOptions = {}): MenuHandle {
	const root = menuPanel('menu', { 'aria-labelledby': anchor.id || undefined });
	anchor.setAttribute('aria-haspopup', 'menu');
	anchor.setAttribute('aria-expanded', 'false');
	anchor.setAttribute('aria-controls', root.id);

	const rows: HTMLLIElement[] = [];
	const byId = new Map<string, HTMLLIElement>();
	for (const entry of entries) {
		if ('heading' in entry) {
			root.append(menuHeading(entry.heading));
			continue;
		}
		if ('separator' in entry) {
			root.append(menuSeparator());
			continue;
		}
		const item = entry;
		const choice = item.checked !== undefined;
		const row = menuOption({ label: item.label, icon: item.icon, role: choice ? 'menuitemradio' : 'menuitem', destructive: item.destructive, disabled: item.disabled });
		if (choice) setOptionSelected(row, item.checked === true);
		if (item.id) byId.set(item.id, row);
		row.addEventListener('click', () => {
			if (item.disabled) return;
			close();
			item.onSelect();
		});
		rows.push(row);
		root.append(row);
	}

	let release: (() => void) | null = null;
	const enabled = () => rows.filter((row) => row.getAttribute('aria-disabled') !== 'true');
	const focusRow = (row: HTMLElement | undefined) => {
		if (!row) return;
		row.focus({ preventScroll: true });
		revealInPanel(root, row);
	};

	function open(): void {
		if (release) return;
		showPanel(root, anchor, { placement: options.placement ?? 'bottom' });
		anchor.setAttribute('aria-expanded', 'true');
		release = whileOpen([root, anchor], (reason) => {
			close();
			if (reason === 'escape') anchor.focus();
		});
		focusRow(enabled()[0]);
	}

	function close(): void {
		if (!release) return;
		release();
		release = null;
		root.hidden = true;
		anchor.setAttribute('aria-expanded', 'false');
	}

	anchor.addEventListener('click', () => (release ? close() : open()));
	anchor.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			open();
			if (event.key === 'ArrowUp') focusRow(enabled().at(-1));
		}
	});
	root.addEventListener('keydown', (event) => {
		const list = enabled();
		const index = list.indexOf(document.activeElement as HTMLLIElement);
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				focusRow(list[(index + 1) % list.length]);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusRow(list[(index - 1 + list.length) % list.length]);
				break;
			case 'Home':
				event.preventDefault();
				focusRow(list[0]);
				break;
			case 'End':
				event.preventDefault();
				focusRow(list.at(-1));
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				(document.activeElement as HTMLElement | null)?.click();
				break;
			case 'Tab':
				close();
				break;
		}
	});

	return {
		root,
		open,
		close,
		toggle: () => (release ? close() : open()),
		isOpen: () => release !== null,
		setChecked: (id, checked) => {
			const row = byId.get(id);
			if (row) setOptionSelected(row, checked);
		},
	};
}
