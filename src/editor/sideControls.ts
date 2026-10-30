import {
	attachTooltip,
	bindModeShortcuts,
	el,
	grabBar,
	icon,
	iconButton,
	modeController,
	setGrabBarValue,
	setMode,
	type GrabBarHandle,
	type ModeId,
} from '../ui';

/**
 * The side panel controls (design "Side Panel Controls"; src/ui/specs/side-panel-controls.md):
 * the vertical mode controller beside a grab bar beside the tool panel, docked down the right
 * of the viewport. The dock owns the frame: the panel's width (dragged with the grab bar,
 * stepped with its arrow keys, remembered in localStorage), collapsing to the mode column alone
 * (dragging the panel narrower than its minimum, a double click or Enter on the grab bar), the
 * title, the description line and the column of modules. The editor panels (editorPanels.ts)
 * decide which modules the active tool shows and what they do.
 */

const STORAGE_KEY = 'wdb.side-controls';
/** The panel's narrowest width; dragged narrower, it collapses. */
const MIN_WIDTH = 120;
/** The panel's widest width, and its width until the user drags it, as drawn. */
const MAX_WIDTH = 320;

interface State {
	width: number;
	collapsed: boolean;
}

function load(): State | null {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
		if (typeof parsed !== 'object' || parsed === null) return null;
		const v = parsed as Record<string, unknown>;
		return typeof v.width === 'number' && Number.isFinite(v.width) && typeof v.collapsed === 'boolean' ? { width: v.width, collapsed: v.collapsed } : null;
	} catch {
		return null;
	}
}

function save(state: State): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Private mode or full storage: the width just isn't remembered.
	}
}

// ---- Modules ----

export interface DockModuleOptions {
	title: string;
	/** A help button after the title, opening a complex tooltip with this text and content. */
	help?: { text: string; content?: Node };
	/** The body's children. */
	children?: (HTMLElement | null | false | undefined)[];
	/** Shown over the dimmed, inert body while there is nothing to edit; see setModuleEmpty(). */
	emptyText?: string;
}

export interface DockModule {
	root: HTMLElement;
	/** The column the module's controls go in. */
	body: HTMLDivElement;
}

/**
 * One section of the tool panel: a title row (with an optional help button) over a body. The
 * panel's column of modules scrolls as one; a divider separates each module from the next.
 */
export function dockModule(options: DockModuleOptions): DockModule {
	const header = el('div', { class: 'dock-module-header' }, el('h3', { class: 'dock-module-title' }, options.title));
	if (options.help) {
		const help = iconButton({ icon: 'help', variant: 'ghost', size: 'xs', label: `About ${options.title.toLowerCase()}` });
		attachTooltip(help, { variant: 'complex', text: options.help.text, content: options.help.content, placement: 'left' });
		header.append(help);
	}
	const body = el('div', { class: 'dock-module-body' }, ...(options.children ?? []));
	const content = el('div', { class: 'dock-module-content' }, body);
	if (options.emptyText) content.append(el('div', { class: 'dock-module-empty', hidden: true }, icon('info'), el('span', {}, options.emptyText)));
	const root = el('section', { class: 'dock-module', 'aria-label': options.title }, header, content);
	return { root, body };
}

/** Dims and disables a module's body and shows its empty-state text, or brings it back. */
export function setModuleEmpty(module: DockModule, empty: boolean): void {
	module.root.toggleAttribute('data-empty', empty);
	module.body.inert = empty;
	const note = module.root.querySelector<HTMLElement>('.dock-module-empty');
	if (note) note.hidden = !empty;
}

/** A centred note under a control, e.g. "Buildings can't be scaled." */
export function dockNote(text: string): HTMLParagraphElement {
	return el('p', { class: 'dock-note' }, text);
}

/** Controls side by side, sharing the width: the X, Y and Z fields. */
export function dockRow(...children: HTMLElement[]): HTMLDivElement {
	return el('div', { class: 'dock-row' }, ...children);
}

// ---- The dock ----

export interface DockContent {
	/** The panel's title: the mode's name, e.g. "Sculpt terrain". */
	title: string;
	/** The line under the title; null hides it. */
	description?: string | null;
	modules: HTMLElement[];
}

export interface SideControlsOptions {
	/** The selected chip; null selects none (a tool with no chip, such as Revert to base). */
	mode: ModeId | null;
	onMode: (mode: ModeId) => void;
	/** The 1 to 7 shortcuts work only while this returns true (not while playing). */
	shortcutsEnabled?: () => boolean;
}

export class SideControls {
	readonly root: HTMLDivElement;
	private readonly controller: HTMLElement;
	private readonly grab: GrabBarHandle;
	private readonly title: HTMLHeadingElement;
	private readonly description: HTMLParagraphElement;
	private readonly modules: HTMLDivElement;
	private state: State;
	private readonly unbind: () => void;

	constructor(options: SideControlsOptions) {
		this.state = load() ?? { width: MAX_WIDTH, collapsed: false };
		const controller = modeController({ value: options.mode ?? 'sculpt', orientation: 'vertical', onChange: options.onMode });
		this.controller = controller.root;
		if (options.mode === null) setMode(this.controller, null);
		this.unbind = bindModeShortcuts(this.controller, window, () => !this.root.hidden && (options.shortcutsEnabled?.() ?? true));
		this.grab = grabBar({
			label: 'Resize tool panel',
			value: this.state.collapsed ? 0 : this.state.width,
			// Below MIN_WIDTH the drag collapses the panel rather than squeezing it.
			min: 0,
			max: MAX_WIDTH,
			orientation: 'vertical',
			grows: 'start',
			onChange: (width) => {
				if (width < MIN_WIDTH) {
					this.state.collapsed = true;
				} else {
					this.state.width = width;
					this.state.collapsed = false;
				}
				this.apply();
			},
			onToggle: () => this.setCollapsed(!this.state.collapsed),
		});
		this.title = el('h2', { class: 'side-controls-title' });
		this.description = el('p', { class: 'side-controls-description', hidden: true });
		this.modules = el('div', { class: 'side-controls-modules ds-scroll' });
		this.root = el(
			'div',
			{ id: 'side-controls' },
			el('div', { class: 'side-controls-rail' }, this.controller, el('div', { class: 'side-controls-grab' }, this.grab.root)),
			el(
				'section',
				{ class: 'side-controls-panel', 'aria-labelledby': 'side-controls-title' },
				el('div', { class: 'side-controls-header' }, this.title),
				this.description,
				this.modules,
			),
		);
		this.title.id = 'side-controls-title';
		this.apply();
	}

	get collapsed(): boolean {
		return this.state.collapsed;
	}

	/** Collapses the panel to the mode column, or brings it back at its last width. */
	setCollapsed(collapsed: boolean): void {
		if (collapsed === this.state.collapsed) return;
		this.state.collapsed = collapsed;
		this.apply();
	}

	/** Selects a chip without firing onMode; null selects none. */
	setMode(mode: ModeId | null): void {
		setMode(this.controller, mode);
	}

	/** Replaces the panel's title, description and modules. */
	setContent(content: DockContent): void {
		this.title.textContent = content.title;
		this.setDescription(content.description ?? null);
		this.modules.replaceChildren(...content.modules);
		this.modules.scrollTop = 0;
	}

	setDescription(text: string | null): void {
		this.description.textContent = text ?? '';
		this.description.hidden = text === null || text === '';
	}

	/** Shows or hides the whole dock (the `hidden` attribute). */
	show(on: boolean): void {
		this.root.hidden = !on;
	}

	dispose(): void {
		this.unbind();
		this.root.remove();
	}

	private apply(): void {
		this.state.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(this.state.width)));
		this.root.style.setProperty('--dock-panel-width', `${this.state.width}px`);
		this.root.toggleAttribute('data-collapsed', this.state.collapsed);
		setGrabBarValue(this.grab.root, this.state.collapsed ? 0 : this.state.width);
		save(this.state);
	}
}
