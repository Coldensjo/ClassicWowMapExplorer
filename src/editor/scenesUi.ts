import type { StorageStats } from '../casc/storage';
import type { AsyncStorageApi } from '../worker/protocol';
import { SceneLibrary, type SceneSummary } from '../scene/library';
import { SceneModel } from '../scene/sceneModel';
import { MAX_BLANK_TILES } from '../scene/types';
import { EditorPanels } from './editorPanels';
import { SceneEditor } from './sceneEditor';

/**
 * Base textures to start a blank scene with (spec 3.2): tileset textures sampled from the Forever
 * beta's own zones, until the Phase 2 asset browser lets any be picked.
 */
const BASE_TEXTURES = [
	{ name: 'Grass (Elwynn Forest)', fdid: 187138 },
	{ name: 'Forest floor (Elwynn Forest)', fdid: 187127 },
	{ name: 'Grass (Westfall)', fdid: 188990 },
	{ name: 'Snow (Dun Morogh)', fdid: 188576 },
	{ name: 'Dirt (Durotar)', fdid: 187018 },
	{ name: 'Savanna (the Barrens)', fdid: 186901 },
	{ name: 'Jungle grass (Stranglethorn)', fdid: 188824 },
	{ name: 'Sand (the coast)', fdid: 189020 },
];

/** Autosave to the library while a scene is open (spec 7.11). */
const AUTOSAVE_SECONDS = 30;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const library = new SceneLibrary();
let storage: AsyncStorageApi;
let stats: StorageStats;
let onExplore: () => void;

let editor: SceneEditor | null = null;
let panels: EditorPanels | null = null;
let lastSaved = '';
let autosaveTimer = 0;

/** The scene library screen (spec 3.1): the saved scenes, New scene, import and export. */
export function showScenes(openedStorage: AsyncStorageApi, openedStats: StorageStats, explore: () => void): void {
	storage = openedStorage;
	stats = openedStats;
	onExplore = explore;
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

	// New scene: a name, a grid of 1x1 to 3x3 tiles and a base texture (spec 3.2).
	const sizes = (select: HTMLSelectElement) => {
		select.replaceChildren(...Array.from({ length: MAX_BLANK_TILES }, (_, i) => new Option(String(i + 1), String(i + 1))));
	};
	sizes($('scene-tiles-x') as HTMLSelectElement);
	sizes($('scene-tiles-y') as HTMLSelectElement);
	$<HTMLSelectElement>('scene-texture').replaceChildren(...BASE_TEXTURES.map((t) => new Option(t.name, String(t.fdid))));
	$('scene-new').addEventListener('click', () => {
		$('scene-create').hidden = false;
		$<HTMLInputElement>('scene-name').value = '';
		$<HTMLInputElement>('scene-name').focus();
	});
	$('scene-create-cancel').addEventListener('click', () => ($('scene-create').hidden = true));
	$('scene-create-form').addEventListener('submit', (e) => {
		e.preventDefault();
		const model = SceneModel.blank({
			name: $<HTMLInputElement>('scene-name').value.trim() || 'Untitled scene',
			tilesX: Number($<HTMLSelectElement>('scene-tiles-x').value),
			tilesY: Number($<HTMLSelectElement>('scene-tiles-y').value),
			baseTexture: Number($<HTMLSelectElement>('scene-texture').value),
			client: { product: stats.product, build: stats.buildName },
		});
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
			const { model } = await library.import(new Uint8Array(await file.arrayBuffer()));
			if (model.meta.client.build !== stats.buildName) notice(`This scene was made with build ${model.meta.client.build}; textures it uses may differ here.`);
			await refreshList();
		} catch (error) {
			notice(error instanceof Error ? error.message : String(error));
		}
	});

	// The editor bar.
	$('editor-save').addEventListener('click', () => void saveOpen(true));
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
			const open = button('Open', 'primary', () => void library.load(s.id).then(({ model }) => openEditor(model)).catch((e) => notice(String(e instanceof Error ? e.message : e))));
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
	editor.onNotice = notice;
	panels = new EditorPanels(editor);
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
	$('editor-bar').hidden = true;
	$('scenes').hidden = false;
	await refreshList();
}
