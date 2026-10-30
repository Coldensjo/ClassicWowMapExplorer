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
 * The bottom controls (design "Bottom Controls"; src/ui/specs/bottom-controls.md): the mode
 * controller bar over a grab bar over the tool panel, docked across the bottom of the viewport.
 * The dock owns the frame: the panel's height (dragged with the grab bar, stepped with its
 * arrow keys, remembered in localStorage), collapsing to the bar alone (a double click or Enter
 * on the grab bar), the description line and the row of modules. The editor panels
 * (editorPanels.ts) decide which modules the active tool shows and what they do.
 */

const STORAGE_KEY = 'wdb.bottom-controls';
/** The panel's smallest height, as the design's minimum. */
const MIN_HEIGHT = 180;
/** The panel's height until the user drags it, as drawn. */
const DEFAULT_HEIGHT = 240;
/** Room kept above the panel for the top bar, the mode bar and some of the scene. */
const RESERVED_ABOVE = 220;

interface State {
	height: number;
	collapsed: boolean;
}

function load(): State | null {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
		if (typeof parsed !== 'object' || parsed === null) return null;
		const v = parsed as Record<string, unknown>;
		return typeof v.height === 'number' && Number.isFinite(v.height) && typeof v.collapsed === 'boolean' ? { height: v.height, collapsed: v.collapsed } : null;
	} catch {
		return null;
	}
}

function save(state: State): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Private mode or full storage: the height just isn't remembered.
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
	/** The scrolling column the module's controls go in. */
	body: HTMLDivElement;
}

/**
 * One column of the tool panel: a title row (with an optional help button), a divider and a
 * body that scrolls on its own.
 */
export function dockModule(options: DockModuleOptions): DockModule {
	const header = el('div', { class: 'dock-module-header' }, el('h3', { class: 'dock-module-title' }, options.title));
	if (options.help) {
		const help = iconButton({ icon: 'help', variant: 'ghost', size: 'xs', label: `About ${options.title.toLowerCase()}` });
		attachTooltip(help, { variant: 'complex', text: options.help.text, content: options.help.content, placement: 'top' });
		header.append(help);
	}
	const body = el('div', { class: 'dock-module-body ds-scroll' }, ...(options.children ?? []));
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
	/** The line across the top of the panel; null hides it. */
	description?: string | null;
	modules: HTMLElement[];
}

export interface BottomControlsOptions {
	/** The selected chip; null selects none (a tool with no chip, such as Revert to base). */
	mode: ModeId | null;
	onMode: (mode: ModeId) => void;
	/** The 1 to 7 shortcuts work only while this returns true (not while playing). */
	shortcutsEnabled?: () => boolean;
}

export class BottomControls {
	readonly root: HTMLDivElement;
	private readonly controller: HTMLElement;
	private readonly grab: GrabBarHandle;
	private readonly description: HTMLParagraphElement;
	private readonly modules: HTMLDivElement;
	private state: State;
	private readonly unbind: () => void;
	private readonly onResize = (): void => this.applyHeight();

	constructor(options: BottomControlsOptions) {
		this.state = load() ?? { height: DEFAULT_HEIGHT, collapsed: false };
		const controller = modeController({ value: options.mode ?? 'sculpt', onChange: options.onMode });
		this.controller = controller.root;
		if (options.mode === null) setMode(this.controller, null);
		this.unbind = bindModeShortcuts(this.controller, window, () => !this.root.hidden && (options.shortcutsEnabled?.() ?? true));
		this.grab = grabBar({
			label: 'Resize tool panel',
			value: this.state.height,
			min: MIN_HEIGHT,
			// The real ceiling follows the viewport (applyHeight clamps); the bar only needs an upper bound.
			max: 4000,
			grows: 'start',
			onChange: (height) => {
				this.state.height = height;
				this.state.collapsed = false;
				this.applyHeight();
			},
			onToggle: () => this.setCollapsed(!this.state.collapsed),
		});
		this.description = el('p', { class: 'bottom-controls-description', hidden: true });
		this.modules = el('div', { class: 'bottom-controls-modules' });
		this.root = el(
			'div',
			{ id: 'bottom-controls' },
			el('div', { class: 'bottom-controls-bar' }, this.controller),
			el('div', { class: 'bottom-controls-grab' }, this.grab.root),
			el('section', { class: 'bottom-controls-panel', 'aria-label': 'Tool panel' }, this.description, this.modules),
		);
		window.addEventListener('resize', this.onResize);
		this.applyHeight();
	}

	get collapsed(): boolean {
		return this.state.collapsed;
	}

	/** Collapses the panel to the mode bar, or brings it back. */
	setCollapsed(collapsed: boolean): void {
		this.state.collapsed = collapsed;
		this.applyHeight();
	}

	/** Selects a chip without firing onMode; null selects none. */
	setMode(mode: ModeId | null): void {
		setMode(this.controller, mode);
	}

	/** Replaces the panel's description and modules. */
	setContent(content: DockContent): void {
		this.setDescription(content.description ?? null);
		this.modules.replaceChildren(...content.modules);
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
		window.removeEventListener('resize', this.onResize);
		this.root.remove();
	}

	private maxHeight(): number {
		return Math.max(MIN_HEIGHT, window.innerHeight - RESERVED_ABOVE);
	}

	private applyHeight(): void {
		const max = this.maxHeight();
		this.state.height = Math.min(max, Math.max(MIN_HEIGHT, Math.round(this.state.height)));
		this.root.style.setProperty('--dock-panel-height', `${this.state.height}px`);
		this.root.toggleAttribute('data-collapsed', this.state.collapsed);
		this.grab.root.setAttribute('aria-valuemax', String(max));
		setGrabBarValue(this.grab.root, this.state.height);
		save(this.state);
	}
}
