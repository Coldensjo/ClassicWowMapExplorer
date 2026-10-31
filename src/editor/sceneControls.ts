import { button, el, icon, iconButton, menu, type MenuHandle } from '../ui';
import { hotkeyFormat, modKey, onHotkeyFormatChange, setHotkeyFormat, type HotkeyFormat } from './hotkeyFormat';

/**
 * The scene control panel (design "Scene Control Panel"; src/ui/specs/scene-control-panel.md):
 * the floating panel at the top left of the viewport while a scene is open, with the scene's
 * name and its menu (the hotkey format, Settings, Export, Exit scene), Save and Play, and Undo
 * and Redo, in three groups divided by rules. It is built once from the design system's
 * molecules and shown per open scene; the scenes UI (scenesUi.ts) owns it and answers its
 * buttons, and the editor panels (editorPanels.ts) push the play and undo state into it.
 */

export interface SceneControlsOptions {
	onSave(): void;
	onPlay(): void;
	onUndo(): void;
	onRedo(): void;
	onSettings(): void;
	onExport(): void;
	onExit(): void;
}

export class SceneControls {
	readonly root: HTMLDivElement;
	private readonly name: HTMLHeadingElement;
	private readonly save: HTMLButtonElement;
	private readonly play: HTMLButtonElement;
	private readonly undo: HTMLButtonElement;
	private readonly redo: HTMLButtonElement;
	private readonly menu: MenuHandle;
	private undoLabel: string | null = null;
	private redoLabel: string | null = null;
	private readonly unsubscribe: () => void;

	constructor(options: SceneControlsOptions) {
		this.name = el('h1', { class: 'scene-controls-name' });
		const more = iconButton({ icon: 'down', label: 'Scene menu', variant: 'ghost', size: 'xs' });
		this.menu = menu(more, [
			{ heading: 'Hotkey format' },
			{ id: 'mac', label: 'Mac', checked: hotkeyFormat() === 'mac', onSelect: () => this.chooseFormat('mac') },
			{ id: 'windows', label: 'Windows', checked: hotkeyFormat() === 'windows', onSelect: () => this.chooseFormat('windows') },
			{ separator: true },
			{ label: 'Settings', icon: 'scene', onSelect: options.onSettings },
			{ label: 'Export', icon: 'download', onSelect: options.onExport },
			{ label: 'Exit scene', icon: 'log-out', onSelect: options.onExit },
		]);
		this.menu.root.classList.add('scene-controls-menu');

		this.save = button({ label: 'Save', variant: 'outline', icon: 'save', title: 'Save the scene to your library', onClick: options.onSave });
		this.play = button({
			label: 'Play',
			variant: 'primary',
			icon: 'play',
			onClick: (event) => {
				options.onPlay();
				// Focus leaves the button so Space jumps the character instead of pressing it again.
				(event.currentTarget as HTMLButtonElement).blur();
			},
		});

		this.undo = iconButton({ icon: 'undo', label: 'Undo', variant: 'ghost', size: 'sm', disabled: true, onClick: options.onUndo });
		this.redo = iconButton({ icon: 'redo', label: 'Redo', variant: 'ghost', size: 'sm', disabled: true, onClick: options.onRedo });

		this.root = el(
			'div',
			{ id: 'scene-controls', role: 'region', 'aria-label': 'Scene', hidden: true },
			el('div', { class: 'scene-controls-group', 'data-fills': '' }, this.name, more),
			el('div', { class: 'scene-controls-group' }, this.save, this.play),
			el('div', { class: 'scene-controls-group' }, this.undo, this.redo),
		);
		this.setPlaying(false);
		this.syncHistoryTitles();
		this.unsubscribe = onHotkeyFormatChange(() => this.syncHistoryTitles());
	}

	setName(name: string): void {
		this.name.textContent = name;
		this.name.title = name;
	}

	/** Play becomes Edit while the scene is being walked; the same button comes back. */
	setPlaying(playing: boolean): void {
		this.play.querySelector('.ds-icon')?.replaceWith(icon(playing ? 'scene' : 'play', { size: 'sm' }));
		this.play.querySelector('.ds-button-label')!.textContent = playing ? 'Edit' : 'Play';
		this.play.title = playing ? 'Back to editing, with the camera where the player stands' : 'Walk the scene as your character';
	}

	/** Disables Save while a save is running. */
	setSaving(saving: boolean): void {
		this.save.disabled = saving;
	}

	/** What Undo would undo (null: nothing), shown in its tooltip and enabling it. */
	setUndo(label: string | null): void {
		this.undoLabel = label;
		this.undo.disabled = label === null;
		this.syncHistoryTitles();
	}

	setRedo(label: string | null): void {
		this.redoLabel = label;
		this.redo.disabled = label === null;
		this.syncHistoryTitles();
	}

	show(on: boolean): void {
		this.root.hidden = !on;
		if (!on) this.menu.close();
	}

	dispose(): void {
		this.unsubscribe();
		this.menu.close();
		this.root.remove();
	}

	private chooseFormat(format: HotkeyFormat): void {
		setHotkeyFormat(format);
		this.menu.setChecked('mac', format === 'mac');
		this.menu.setChecked('windows', format === 'windows');
	}

	private syncHistoryTitles(): void {
		const mod = modKey();
		this.undo.title = this.undoLabel ? `Undo: ${this.undoLabel.toLowerCase()} (${mod}+Z)` : `Nothing to undo (${mod}+Z)`;
		this.redo.title = this.redoLabel ? `Redo: ${this.redoLabel.toLowerCase()} (${mod}+Y)` : `Nothing to redo (${mod}+Y)`;
	}
}
