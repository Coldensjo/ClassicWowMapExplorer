import { MAX_BLANK_TILES } from '../scene/types';
import { button, el, formDialog, sizeGrid, textInput } from '../ui';

/** How a scene may grow (specs/scene-dialogs.md §3): the new size and where the old tiles sit in it. */
export interface SceneGrowth {
	tilesX: number;
	tilesY: number;
	offsetX: number;
	offsetY: number;
}

export interface SceneSettingsResult {
	name: string;
	/** Set when the size grid picked more tiles than the scene has. */
	grow: SceneGrowth | null;
}

export interface SceneSettingsDialogOptions {
	name: string;
	size: { tilesX: number; tilesY: number };
	/** For a scene copied from the world, the map it copies; its size can't change. */
	copiedFrom: string | null;
	/** Applies the settings; a rejection keeps the dialog open with the message shown. */
	save: (result: SceneSettingsResult) => Promise<void>;
	notice: (text: string) => void;
}

/**
 * The Scene settings dialog (Figma "In-scene Settings", specs/scene-dialogs.md §3): the scene's
 * name, and for a blank scene the size grid with the present tiles locked in the middle so new
 * ones can be added on any side; Save settings in the body. Opened from a scene card's menu on
 * the landing page and from the scene control panel's menu in the editor.
 */
export function openSceneSettingsDialog(options: SceneSettingsDialogOptions): void {
	const name = textInput({ label: 'Scene name', value: options.name, maxLength: 80, autocomplete: 'off', spellcheck: false });
	const grid = options.copiedFrom === null ? sizeGrid({ max: MAX_BLANK_TILES, locked: options.size }) : null;
	const { tilesX, tilesY } = options.size;
	const panel = grid
		? el('div', { class: 'scene-dialog-panel' }, el('p', { class: 'scene-dialog-hint scene-dialog-hint-strong' }, 'Edit the size of your scene by selecting tiles on grid below:'), grid.root)
		: el('div', { class: 'scene-dialog-panel' }, el('p', { class: 'scene-dialog-hint' }, `This scene copies ${tilesX}x${tilesY} tiles of ${options.copiedFrom}, so its size can't change here.`));
	const save = button({ label: 'Save settings', variant: 'primary', size: 'md', onClick: () => void submit() });
	const handle = formDialog({ title: 'Scene settings', look: 'panel', body: [name.root, panel, save] });

	let busy = false;
	async function submit(): Promise<void> {
		if (busy) return;
		let grow: SceneGrowth | null = null;
		if (grid?.locked) {
			const pick = grid.value();
			const next = { tilesX: pick.x1 - pick.x0 + 1, tilesY: pick.y1 - pick.y0 + 1 };
			if (next.tilesX !== tilesX || next.tilesY !== tilesY) {
				grow = { ...next, offsetX: grid.locked.x0 - pick.x0, offsetY: grid.locked.y0 - pick.y0 };
			}
		}
		busy = true;
		save.disabled = true;
		try {
			await options.save({ name: name.input.value.trim() || options.name, grow });
			handle.close();
		} catch (e) {
			options.notice(`The settings couldn't be saved: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
			save.disabled = false;
		}
	}

	name.input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
		}
	});
	name.input.select();
}
