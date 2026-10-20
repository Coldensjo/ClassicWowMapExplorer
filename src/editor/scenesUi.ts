import type { StorageStats } from '../casc/storage';
import type { CopyTile } from '../explorer/copyWorld';
import type { AsyncStorageApi } from '../worker/protocol';
import { createCopiedScene, selectionCentre } from '../scene/copyScene';
import { zoneLightAt } from '../explorer/lighting';
import { SceneLibrary, type SceneSummary } from '../scene/library';
import { SceneModel } from '../scene/sceneModel';
import { MAX_BLANK_TILES } from '../scene/types';
import { decodeFile, readSceneFile } from '../scene/wscene';
import { CopyPicker } from './copyPicker';
import { EditorPanels } from './editorPanels';
import { groundEffectScan, type GroundEffectScan } from './groundEffectScan';
import { SceneEditor } from './sceneEditor';

import { BASE_TEXTURES } from './baseTextures';

/** Autosave to the library while a scene is open (spec 7.11). */
const AUTOSAVE_SECONDS = 30;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const library = new SceneLibrary();
let storage: AsyncStorageApi;
let stats: StorageStats;
let onExplore: () => void;

let editor: SceneEditor | null = null;
let panels: EditorPanels | null = null;
let scan: GroundEffectScan | null = null;
let picker: CopyPicker | null = null;
let lastSaved = '';
let autosaveTimer = 0;

/** The scene library screen (spec 3.1): the saved scenes, New scene, import and export. */
export function showScenes(openedStorage: AsyncStorageApi, openedStats: StorageStats, explore: () => void): void {
	storage = openedStorage;
	stats = openedStats;
	onExplore = explore;
	// The ground effect scan (spec 3.1) starts in the background; editing does not wait for it.
	scan = groundEffectScan(storage, stats.buildName);
	scan.onStatus = (text, paused) => {
		const element = $('status-scan');
		element.textContent = text;
		element.hidden = !text;
		if (paused) element.textContent += ' — click to resume';
	};
	wireOnce();
	$('scenes-build').textContent = `${stats.product} ${stats.version}`;
	$('scenes').hidden = false;
	void refreshList();
}

let wired = false;
function wireOnce(): void {
	if (wired) return;
	wired = true;

	$('scenes-explore').addEventListener('click', () => {
		$('scenes').hidden = true;
		onExplore();
	});

	$('status-scan').addEventListener('click', () => scan?.setPaused(!scan.paused));

	// New scene: a name, then blank tiles or a copied area (spec 3.2).
	const sizes = (select: HTMLSelectElement) => {
		select.replaceChildren(...Array.from({ length: MAX_BLANK_TILES }, (_, i) => new Option(String(i + 1), String(i + 1))));
	};
	sizes($('scene-tiles-x') as HTMLSelectElement);
	sizes($('scene-tiles-y') as HTMLSelectElement);
	$<HTMLSelectElement>('scene-texture').replaceChildren(...BASE_TEXTURES.map((t) => new Option(t.name, String(t.fdid))));
	picker = new CopyPicker(() => storage, notice);
	const syncStart = () => {
		const copy = $<HTMLSelectElement>('scene-start').value === 'copy';
		$('scene-blank-options').hidden = copy;
		$('scene-copy-options').hidden = !copy;
		$('scene-create-form').classList.toggle('copy', copy);
		if (copy) void picker!.open();
	};
	$('scene-start').addEventListener('change', syncStart);
	$('scene-new').addEventListener('click', () => {
		$('scene-create').hidden = false;
		$<HTMLInputElement>('scene-name').value = '';
		$<HTMLInputElement>('scene-name').focus();
		syncStart();
	});
	$('scene-create-cancel').addEventListener('click', () => ($('scene-create').hidden = true));
	$('scene-create-form').addEventListener('submit', (e) => {
		e.preventDefault();
		if ($<HTMLSelectElement>('scene-start').value === 'copy') {
			void createCopy();
			return;
		}
		const baseTexture = Number($<HTMLSelectElement>('scene-texture').value);
		const model = SceneModel.blank({
			name: $<HTMLInputElement>('scene-name').value.trim() || 'Untitled scene',
			tilesX: Number($<HTMLSelectElement>('scene-tiles-x').value),
			tilesY: Number($<HTMLSelectElement>('scene-tiles-y').value),
			baseTexture,
			client: { product: stats.product, build: stats.buildName },
		});
		// The base layer carries its texture's usual clutter where the scan already knows it (spec 7.7.2).
		const effect = scan?.effectFor(baseTexture) ?? 0;
		if (effect) {
			for (const tile of model.tiles) for (const chunk of tile.chunks) chunk.layers[0].effectId = effect;
		}
		$('scene-create').hidden = true;
		void openEditor(model, true);
	});

	$('scene-import').addEventListener('click', () => $<HTMLInputElement>('scene-import-input').click());
	$('scene-import-input').addEventListener('change', async (e) => {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const scene = await library.import(new Uint8Array(await file.arrayBuffer()));
			if (scene.client.build !== stats.buildName) notice(`This scene was made with build ${scene.client.build}; what it references may differ here.`);
			await refreshList();
		} catch (error) {
			notice(error instanceof Error ? error.message : String(error));
		}
	});

	// The editor bar.
	$('editor-save').addEventListener('click', () => void saveOpen(true));
	wireEditorBar();
}

/** Source tiles that exist in the map but can't be read from this client. */
class MissingTilesError extends Error {
	constructor(readonly tiles: string[]) {
		super(`tile${tiles.length === 1 ? '' : 's'} ${tiles.join(', ')} ${tiles.length === 1 ? "isn't" : "aren't"} in your client`);
	}
}

/** Progress while source tiles load, shown in the New scene dialog (spec 7.2). */
function createProgress(text: string | null): void {
	const element = $('scene-create-progress');
	element.hidden = !text;
	element.textContent = text ?? '';
}

/** Reads every source tile of the rectangle, row-major, reporting progress. */
async function loadCopyTiles(wdt: number, tileMin: [number, number], tileMax: [number, number], progress: (text: string) => void): Promise<CopyTile[]> {
	const total = (tileMax[0] - tileMin[0] + 1) * (tileMax[1] - tileMin[1] + 1);
	const tiles: CopyTile[] = [];
	// Every unreadable tile is collected, so the user sees all of them at once (spec 6.5).
	const missing: string[] = [];
	for (let y = tileMin[1]; y <= tileMax[1]; y++) {
		for (let x = tileMin[0]; x <= tileMax[0]; x++) {
			progress(`Reading tile ${tiles.length + missing.length + 1} of ${total} (${x}_${y})…`);
			try {
				tiles.push(await storage.loadCopyTile(wdt, x, y));
			} catch {
				missing.push(`${x}_${y}`);
			}
		}
	}
	if (missing.length) throw new MissingTilesError(missing);
	return tiles;
}

/** Creates a scene from the picker's map, rectangle and options (spec 7.2). */
async function createCopy(): Promise<void> {
	const map = picker?.map;
	const selection = picker?.selection;
	if (!map || !selection) {
		notice('Pick a map and drag the area to copy first');
		return;
	}
	const form = $<HTMLFormElement>('scene-create-form');
	const buttons = form.querySelectorAll('button');
	buttons.forEach((b) => (b.disabled = true));
	try {
		const tiles = await loadCopyTiles(map.wdt, selection.tileMin, selection.tileMax, createProgress);
		createProgress('Building the scene…');
		// The scene starts with the light of the zone at the selection's centre (spec 7.2); when
		// the light tables can't be read it keeps the default preset.
		let lightPreset = 0;
		try {
			const { wowX, wowY } = selectionCentre(selection.tileMin, selection.tileMax);
			lightPreset = zoneLightAt((await storage.loadLighting([map.id])).zones, map.id, wowX, wowY);
		} catch {
			// The default preset it is.
		}
		const model = createCopiedScene({
			name: $<HTMLInputElement>('scene-name').value.trim() || map.name,
			client: { product: stats.product, build: stats.buildName },
			map: { id: map.id, directory: map.directory },
			tileMin: selection.tileMin,
			tileMax: selection.tileMax,
			includeDoodads: $<HTMLInputElement>('scene-include-doodads').checked,
			includeWmos: $<HTMLInputElement>('scene-include-wmos').checked,
			lightPreset,
		}, tiles);
		$('scene-create').hidden = true;
		await openEditor(model, true);
	} catch (e) {
		notice(`The area couldn't be copied: ${e instanceof Error ? e.message : e}`);
	} finally {
		createProgress(null);
		buttons.forEach((b) => (b.disabled = false));
	}
}

/** Progress while a saved scene's source tiles load, over the scene list. */
function openProgress(text: string | null): void {
	const element = $('scenes-progress');
	element.hidden = !text;
	element.textContent = text ?? '';
}

/** Opens a saved scene; a copied one reads its source map first (spec 6.5). */
async function openSavedScene(id: string): Promise<void> {
	try {
		const bytes = await library.bytes(id);
		const file = readSceneFile(bytes);
		if (!file.scene.base) {
			await openEditor(decodeFile(file).model);
			return;
		}
		const base = file.scene.base;
		openProgress(`Looking for ${base.mapDirectory} in this client…`);
		const maps = await storage.listCopyMaps();
		const map = maps.find((m) => m.id === base.mapId);
		if (!map) {
			notice(`This scene copies map "${base.mapDirectory}" (${base.mapId}), which isn't in this client, so it can't open.`);
			return;
		}
		let tiles: CopyTile[];
		try {
			tiles = await loadCopyTiles(map.wdt, base.tileMin, base.tileMax, openProgress);
		} catch (e) {
			if (!(e instanceof MissingTilesError)) throw e;
			notice(`This scene copies ${map.name} (${base.mapDirectory}), but ${e.message}, so it can't open.`);
			return;
		}
		openProgress('Building the scene…');
		const decoded = decodeFile(file, tiles);
		await openEditor(decoded.model);
		// The source may have changed since the copy (spec 6.5): overrides apply as stored, with a warning.
		const warnings: string[] = [];
		if (base.build !== stats.buildName) {
			warnings.push(`This scene was copied from build ${base.build}; the terrain and objects underneath may have changed since then in build ${stats.buildName}. Your edits are applied as saved.`);
		}
		if (decoded.missingObjects) {
			warnings.push(`${decoded.missingObjects} edited copied object${decoded.missingObjects === 1 ? ' is' : 's are'} no longer in the source map and ${decoded.missingObjects === 1 ? 'was' : 'were'} dropped.`);
		}
		if (warnings.length) notice(warnings.join(' '));
	} catch (e) {
		notice(`The scene couldn't be opened: ${e instanceof Error ? e.message : e}`);
	} finally {
		openProgress(null);
	}
}

function wireEditorBar(): void {
	$('editor-export').addEventListener('click', async () => {
		if (!editor) return;
		await saveOpen(true);
		download(`${editor.model.meta.name}.wscene`, await library.bytes(editor.model.meta.id));
	});
	$('editor-back').addEventListener('click', () => void closeEditor());
}

async function refreshList(): Promise<void> {
	let scenes: SceneSummary[] = [];
	try {
		scenes = await library.list();
	} catch (e) {
		notice(`The scene library can't be read: ${e instanceof Error ? e.message : e}`);
	}
	const list = $('scene-list');
	list.replaceChildren(
		...scenes.map((s) => {
			const row = document.createElement('div');
			row.className = 'scene-row';
			const thumb = document.createElement(s.thumbnail ? 'img' : 'div');
			thumb.className = 'scene-thumb';
			if (s.thumbnail && thumb instanceof HTMLImageElement) thumb.src = URL.createObjectURL(s.thumbnail);
			const label = document.createElement('div');
			label.className = 'scene-label';
			const name = document.createElement('div');
			name.textContent = s.name;
			const details = document.createElement('div');
			details.className = 'muted small';
			details.textContent = `${s.size.tilesX}×${s.size.tilesY} tiles · ${s.kind} · ${new Date(s.modified).toLocaleString()}`;
			label.append(name, details);
			const open = button('Open', 'primary', () => void openSavedScene(s.id));
			const exportButton = button('Export', '', () => void library.bytes(s.id).then((bytes) => download(`${s.name}.wscene`, bytes)));
			const remove = button('Delete', '', () => {
				if (confirm(`Delete "${s.name}"? This can't be undone.`)) void library.delete(s.id).then(refreshList);
			});
			row.append(thumb, label, open, exportButton, remove);
			return row;
		}),
	);
	$('scene-list-empty').hidden = scenes.length > 0;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
	const b = document.createElement('button');
	b.textContent = label;
	if (className) b.className = className;
	b.addEventListener('click', onClick);
	return b;
}

function download(name: string, bytes: Uint8Array): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let noticeTimer = 0;

function notice(text: string): void {
	const box = $('notice');
	box.textContent = text;
	box.classList.add('show');
	clearTimeout(noticeTimer);
	noticeTimer = window.setTimeout(() => box.classList.remove('show'), 6000);
}

async function openEditor(model: SceneModel, isNew = false): Promise<void> {
	$('scenes').hidden = true;
	$('editor-bar').hidden = false;
	$('editor-name').textContent = model.meta.name;
	setSaveState('');
	editor = new SceneEditor($<HTMLCanvasElement>('view'), storage, model);
	// A console handle on the open editor, for poking at the model and managers while testing.
	(window as { editor?: SceneEditor }).editor = editor;
	editor.onNotice = notice;
	// Newly painted layers take the effect their texture usually carries (spec 7.7.2).
	editor.effectFor = (fdid) => scan?.effectFor(fdid) ?? 0;
	panels = new EditorPanels(editor, storage);
	try {
		await editor.load();
	} catch (e) {
		notice(`The scene couldn't be shown: ${e instanceof Error ? e.message : e}`);
	}
	editor.start();
	lastSaved = isNew ? '' : model.meta.modified;
	if (isNew) await saveOpen(true);
	autosaveTimer = window.setInterval(() => void saveOpen(false), AUTOSAVE_SECONDS * 1000);
	document.addEventListener('visibilitychange', autosaveOnHide);
}

function autosaveOnHide(): void {
	if (document.visibilityState === 'hidden') void saveOpen(false);
}

/** Saves the open scene; forced also renders a fresh thumbnail, unforced only when changed. */
async function saveOpen(force: boolean): Promise<void> {
	if (!editor) return;
	const model = editor.model;
	if (!force && model.meta.modified === lastSaved) return;
	setSaveState('Saving…');
	try {
		await library.save(model, force ? await editor.thumbnail() : null);
		lastSaved = model.meta.modified;
		setSaveState(`Saved ${new Date().toLocaleTimeString()}`);
	} catch (e) {
		setSaveState('');
		notice(`Saving failed: ${e instanceof Error ? e.message : e}. Export the scene to keep it.`);
	}
}

function setSaveState(text: string): void {
	$('editor-status').textContent = text;
}

async function closeEditor(): Promise<void> {
	if (!editor) return;
	clearInterval(autosaveTimer);
	document.removeEventListener('visibilitychange', autosaveOnHide);
	await saveOpen(false);
	panels?.dispose();
	panels = null;
	editor.dispose();
	editor = null;
	delete (window as { editor?: SceneEditor }).editor;
	$('editor-bar').hidden = true;
	$('scenes').hidden = false;
	await refreshList();
}
