import type { CopyMap } from '../explorer/copyWorld';
import type { SceneModel } from '../scene/sceneModel';
import { MAX_BLANK_TILES } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';
import { button, el, formDialog, select, sizeGrid, textInput, toggleSwitch } from '../ui';
import { BASE_TEXTURES } from './baseTextures';
import { CopyPicker } from './copyPicker';

/** What the New scene dialog asks for: blank flat tiles, or an area copied from a map (spec 3.2). */
export type NewSceneRequest =
	| { kind: 'blank'; name: string; tilesX: number; tilesY: number; baseTexture: number }
	| { kind: 'copy'; name: string; map: CopyMap; tileMin: [number, number]; tileMax: [number, number]; includeDoodads: boolean; includeWmos: boolean };

export interface NewSceneDialogOptions {
	storage: () => AsyncStorageApi;
	notice: (text: string) => void;
	/**
	 * Builds the scene; `progress` reports loading text under the form while it runs. A
	 * rejection keeps the dialog open with its message shown.
	 */
	create: (request: NewSceneRequest, progress: (text: string | null) => void) => Promise<SceneModel>;
	/** The scene is built and the dialog has closed. */
	onCreated: (model: SceneModel) => void;
}

/**
 * The New scene dialog (Figma "Dialog - New Scene", specs/scene-dialogs.md §2): a name, Start
 * from (Blank terrain or Copy from world), then either the base texture and the size grid, or
 * the map picker with its doodad and building switches, and Create scene across the foot.
 */
export function openNewSceneDialog(options: NewSceneDialogOptions): void {
	const name = textInput({ label: 'Scene name', placeholder: 'my_scene_01', maxLength: 80, autocomplete: 'off', spellcheck: false });
	let mode: 'blank' | 'copy' = 'blank';
	const start = select({
		label: 'Start from',
		options: [
			{ value: 'blank', label: 'Blank terrain' },
			{ value: 'copy', label: 'Copy from world' },
		],
		value: mode,
		onChange: (value) => setMode(value as 'blank' | 'copy'),
	});

	// Blank terrain: the base texture and the size.
	let baseTexture = BASE_TEXTURES[0].fdid;
	const texture = select({
		label: 'Base texture',
		options: BASE_TEXTURES.map((t) => ({ value: String(t.fdid), label: t.name })),
		value: String(baseTexture),
		onChange: (value) => (baseTexture = Number(value)),
	});
	const grid = sizeGrid({ max: MAX_BLANK_TILES });
	const blankSection = el(
		'div',
		{ class: 'scene-dialog-section' },
		texture.root,
		el('div', { class: 'scene-dialog-panel' }, el('p', { class: 'scene-dialog-hint scene-dialog-hint-strong' }, 'Choose the size of your scene by selecting tiles on grid below:'), grid.root),
	);

	// Copy from world: the map, the area and what comes with it.
	const picker = new CopyPicker(options.storage, options.notice);
	const doodads = toggleSwitch({ label: 'Include doodads (objects)', checked: true });
	const buildings = toggleSwitch({ label: 'Include buildings', checked: true });
	const copySection = el('div', { class: 'scene-dialog-section', hidden: true }, picker.mapField, picker.root, doodads.root, buildings.root);

	const status = el('p', { class: 'scene-dialog-status', 'aria-live': 'polite', hidden: true });
	const create = button({ label: 'Create scene', variant: 'primary', size: 'md', onClick: () => void submit() });

	const handle = formDialog({
		title: 'New scene',
		look: 'panel',
		body: [name.root, start.root, blankSection, copySection, status],
		footer: [create],
		onCancel: () => picker.dispose(),
	});

	function setMode(next: 'blank' | 'copy'): void {
		mode = next;
		blankSection.hidden = next !== 'blank';
		copySection.hidden = next !== 'copy';
		if (next === 'copy') void picker.open();
	}

	const progress = (text: string | null): void => {
		status.hidden = !text;
		status.textContent = text ?? '';
	};

	let busy = false;
	async function submit(): Promise<void> {
		if (busy) return;
		let request: NewSceneRequest;
		const typed = name.input.value.trim();
		if (mode === 'blank') {
			const size = grid.value();
			request = { kind: 'blank', name: typed || 'Untitled scene', tilesX: size.x1 - size.x0 + 1, tilesY: size.y1 - size.y0 + 1, baseTexture };
		} else {
			const map = picker.map;
			const selection = picker.selection;
			if (!map || !selection) {
				options.notice('Pick a map and drag the area to copy first');
				return;
			}
			request = {
				kind: 'copy',
				name: typed || map.name,
				map,
				tileMin: selection.tileMin,
				tileMax: selection.tileMax,
				includeDoodads: doodads.input.checked,
				includeWmos: buildings.input.checked,
			};
		}
		busy = true;
		create.disabled = true;
		try {
			const model = await options.create(request, progress);
			// Closed while loading: the scene is dropped rather than opened behind the user's back.
			if (!handle.open) return;
			picker.dispose();
			handle.close();
			options.onCreated(model);
		} catch (e) {
			options.notice(`The scene couldn't be created: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
			progress(null);
			create.disabled = false;
		}
	}

	// Enter in the name field creates, as a form would.
	name.input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
		}
	});
}
