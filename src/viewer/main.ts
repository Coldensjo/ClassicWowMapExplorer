import { droppedFolderToSource, filesToSource, hasDirectoryPicker, pickDirectory } from '../app/folderPicker';
import { createStorageClient } from '../worker/client';
import type { SourceInit } from '../worker/protocol';
import type { SpawnInfo } from '../explorer/spawns';
import type { MapCategory, MapListing } from '../explorer/world';
import type { HighlightGroup, HighlightSettings } from './highlights';
import { Viewer, type HudInfo } from './viewer';
import { setVolume, volumeSetting, type VolumeChannel } from './volume';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');

const storage = createStorageClient((message) => showProgress(message));

/** A message under the buttons; errors also end the loading bar, so the buttons come back. */
function setStatus(text: string, isError = false): void {
	status.textContent = text;
	status.className = isError ? 'bad' : 'muted';
	if (isError) hideProgress();
}

// --- Loading bar ---

/**
 * How far along each loading step starts, as a share of the whole. Reading the folder is the
 * longest step (the browser listing every file), but it reports nothing, so the bar creeps
 * toward where it ends meanwhile.
 */
const LOADING_STEPS: [RegExp, number, string][] = [
	[/^Reading your folder/, 0.02, 'Reading your World of Warcraft folder'],
	[/^Reading \.build\.info/, 0.45, 'Finding the game version'],
	[/^Reading local indexes/, 0.5, 'Opening the game files'],
	[/^Reading encoding table/, 0.57, 'Opening the game files'],
	[/^Reading root table/, 0.64, 'Opening the game files'],
	[/^Reading Eastern Kingdoms/, 0.72, 'Loading Eastern Kingdoms'],
	[/^Reading Kalimdor/, 0.82, 'Loading Kalimdor'],
	[/^Placing/, 0.88, 'Placing dungeons and other maps'],
	[/^Reading lighting/, 0.9, 'Loading light and zones'],
	[/^Starting/, 0.97, 'Starting'],
];
/** Where the bar creeps to while the folder is read, and how long that takes (s). */
const FOLDER_CREEP = [0.42, 20] as const;

/** Shows the loading bar at a step, in place of the folder buttons. */
function showProgress(message: string): void {
	const step = LOADING_STEPS.find(([pattern]) => pattern.test(message));
	const appearing = $('loading').hidden;
	$('drop').hidden = true;
	$('loading').hidden = false;
	// A bar that was hidden has no width to animate from until it's laid out once.
	if (appearing) void $('loading-fill').offsetWidth;
	status.textContent = '';
	if (!step) return;
	const fill = $('loading-fill');
	const creep = step === LOADING_STEPS[0];
	const target = creep ? FOLDER_CREEP[0] : step[1];
	fill.style.transition = creep ? `width ${FOLDER_CREEP[1]}s cubic-bezier(0.1, 0.7, 0.3, 1)` : '';
	// Never backwards, whatever order messages arrive in.
	if (parseFloat(fill.style.width || '0') < target * 100) fill.style.width = `${target * 100}%`;
	$('loading-text').textContent = `${step[2]}…`;
}

function hideProgress(): void {
	$('loading').hidden = true;
	$('drop').hidden = false;
	$('loading-fill').style.width = '0%';
}

async function useSource(init: SourceInit): Promise<void> {
	showProgress('Reading .build.info');
	try {
		const products = (await storage.setSource(init)).filter((p) => p.product.startsWith('wow'));
		const select = $<HTMLSelectElement>('product');
		select.replaceChildren(...products.map((p) => new Option(`${p.product} ${p.version}`, p.product)));
		// Prefer a classic build: the continent file IDs are the classic ones.
		const preferred = products.find((p) => p.product === 'wow_classic_beta') ?? products.find((p) => p.product.startsWith('wow_classic'));
		if (preferred) {
			// Nothing to choose: straight in.
			select.value = preferred.product;
			await explore();
			return;
		}
		hideProgress();
		$('product-step').hidden = products.length === 0;
		setStatus(products.length ? 'No Classic version found; choose a game version and press Explore.' : 'No World of Warcraft game found in this folder.', true);
	} catch {
		setStatus('That isn\'t the World of Warcraft folder. Choose the folder that contains _classic_ or _classic_beta_ (not that folder itself).', true);
	}
}

// Dropping the folder on the page works like choosing it.
const drop = $('drop');
const start = $('start');
start.addEventListener('dragover', (e) => {
	e.preventDefault();
	drop.classList.add('dragging');
});
start.addEventListener('dragleave', (e) => {
	if (e.target === start) drop.classList.remove('dragging');
});
start.addEventListener('drop', async (e) => {
	e.preventDefault();
	drop.classList.remove('dragging');
	const entry = e.dataTransfer?.items[0]?.webkitGetAsEntry();
	if (!entry?.isDirectory) {
		setStatus('Drop the World of Warcraft folder itself, not a file.', true);
		return;
	}
	showProgress('Reading your folder');
	await useSource(await droppedFolderToSource(entry as FileSystemDirectoryEntry));
});

// After "Upload", the browser lists the whole folder before telling the page anything; show
// the bar as soon as the dialog closes (the page gets focus back), and drop it if it was cancelled.
let choosingFolder = false;
$('pick').addEventListener('click', () => {
	choosingFolder = true;
	$<HTMLInputElement>('pick-input').click();
});
window.addEventListener('focus', () => {
	if (choosingFolder) showProgress('Reading your folder');
});
$('pick-input').addEventListener('cancel', () => {
	choosingFolder = false;
	hideProgress();
});
$<HTMLInputElement>('pick-input').addEventListener('change', async (event) => {
	choosingFolder = false;
	const files = (event.target as HTMLInputElement).files ?? [];
	showProgress('Reading your folder');
	await useSource(filesToSource(files));
});

if (!hasDirectoryPicker) $('pick-direct').hidden = true;
$('pick-direct').addEventListener('click', async () => {
	try {
		const init = await pickDirectory();
		if (init) await useSource(init);
	} catch (e) {
		setStatus((e as Error).message, true);
	}
});

$('explore').addEventListener('click', () => void explore());

/** Opens the chosen game version and starts the viewer. */
async function explore(): Promise<void> {
	const button = $<HTMLButtonElement>('explore');
	button.disabled = true;
	for (const id of ['pick', 'pick-direct']) $<HTMLButtonElement>(id).disabled = true;
	try {
		await storage.open($<HTMLSelectElement>('product').value);
		const viewer = new Viewer($('view'), storage, showHud, showInfo, $('nameplates'));
		// For poking at the scene from the console (and test scripts) while developing.
		if (import.meta.env.DEV) (globalThis as unknown as { mapExplorerViewer: Viewer }).mapExplorerViewer = viewer;
		viewer.onShotStatus = showShotStatus;
		await viewer.load((text) => showProgress(text));
		showProgress('Starting');
		$('start').hidden = true;
		$('hud').hidden = $('help').hidden = false;
		viewer.start();
		void setUpMapPicker(viewer);
		setUpHighlights(viewer);
		setUpSound();
	} catch (e) {
		setStatus(`Could not start: ${(e as Error).message}`, true);
		button.disabled = false;
		for (const id of ['pick', 'pick-direct']) $<HTMLButtonElement>(id).disabled = false;
	}
}

// --- Going to any map ---

const MAP_GROUPS: [MapCategory, string][] = [
	['continent', 'Continents'],
	['dungeon', 'Dungeons'],
	['raid', 'Raids'],
	['battleground', 'Battlegrounds'],
	['other', 'Other maps'],
];

/** Every map in the install, grouped, to jump straight to (many have no way in from the world). */
async function setUpMapPicker(viewer: Viewer): Promise<void> {
	const picker = $<HTMLSelectElement>('map-picker');
	let maps: MapListing[];
	try {
		maps = await storage.listMaps();
	} catch (e) {
		console.warn('Map list unavailable:', e);
		return;
	}
	const placeholder = new Option(`Go to map… (${maps.length})`, '');
	placeholder.disabled = true;
	const groups = MAP_GROUPS.map(([category, label]) => {
		const group = document.createElement('optgroup');
		group.label = label;
		group.append(...maps.filter((m) => m.category === category).map((m) => new Option(m.name, String(m.id))));
		return group;
	}).filter((g) => g.children.length);
	picker.replaceChildren(placeholder, ...groups);
	picker.value = '';
	picker.hidden = false;
	picker.addEventListener('change', async () => {
		const id = Number(picker.value);
		const name = picker.selectedOptions[0]?.textContent ?? `Map ${id}`;
		// Back to the placeholder, and out of the way of the flying keys.
		picker.value = '';
		picker.blur();
		if (!(await viewer.goToMap(id))) console.warn(`${name} couldn't be loaded`);
	});
}

// --- Highlighting things on the ground ---

const HIGHLIGHT_KEY = 'mapExplorer.highlight';

/** The highlight panel: kinds to mark and a name to find, remembered between visits. */
function setUpHighlights(viewer: Viewer): void {
	const panel = $('highlight');
	const on = $<HTMLInputElement>('highlight-on');
	const query = $<HTMLInputElement>('highlight-query');
	const boxes = [...panel.querySelectorAll<HTMLInputElement>('#highlight-groups input')];
	let saved: Partial<HighlightSettings> = {};
	try {
		saved = JSON.parse(localStorage.getItem(HIGHLIGHT_KEY) ?? '{}');
	} catch {
		// Storage blocked or unreadable: start with nothing highlighted.
	}
	on.checked = saved.on ?? false;
	query.value = saved.query ?? '';
	for (const box of boxes) box.checked = saved.groups?.includes(box.value as HighlightGroup) ?? false;

	const apply = () => {
		const settings: HighlightSettings = {
			on: on.checked,
			groups: boxes.filter((b) => b.checked).map((b) => b.value as HighlightGroup),
			query: query.value,
		};
		panel.classList.toggle('off', !settings.on);
		viewer.setHighlights(settings);
		try {
			localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify(settings));
		} catch {
			// Not remembered; it still works for this visit.
		}
	};
	for (const box of [on, ...boxes]) {
		box.addEventListener('change', () => {
			// Choosing a kind turns highlighting on.
			if (box !== on && box.checked) on.checked = true;
			apply();
			// Out of the way of the flying keys, which inputs keep for themselves.
			box.blur();
		});
	}
	query.addEventListener('input', () => {
		if (query.value.trim()) on.checked = true;
		apply();
	});
	query.addEventListener('keydown', (e) => {
		if (e.code === 'Enter' || e.code === 'Escape') query.blur();
	});
	window.addEventListener('keydown', (e) => {
		if (e.code !== 'KeyH' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
		on.checked = !on.checked;
		apply();
	});
	apply();
	panel.hidden = false;
}

// --- Volume ---

/** The Sound panel: a slider per kind of sound, applied as they move. */
function setUpSound(): void {
	const panel = $('sound');
	for (const slider of panel.querySelectorAll<HTMLInputElement>('input[type=range]')) {
		const channel = slider.dataset.channel as VolumeChannel;
		const shown = slider.nextElementSibling as HTMLOutputElement;
		slider.value = String(Math.round(volumeSetting(channel) * 100));
		shown.value = `${slider.value}%`;
		slider.addEventListener('input', () => {
			setVolume(channel, Number(slider.value) / 100);
			shown.value = `${slider.value}%`;
		});
		// Out of the way of the flying keys once let go.
		slider.addEventListener('change', () => slider.blur());
	}
	// Space flies up; it mustn't fold the panel.
	panel.querySelector('summary')!.addEventListener('click', (e) => (e.currentTarget as HTMLElement).blur());
	panel.hidden = false;
}

// --- Hiding the interface ---

// U, or Alt+Z as in the game: everything drawn over the world goes, for a clear view or
// screenshots. The NVIDIA overlay takes Alt+Z for itself where it's installed, hence U too.
window.addEventListener('keydown', (e) => {
	const toggle = e.altKey ? e.code === 'KeyZ' : e.code === 'KeyU' && !e.ctrlKey && !e.metaKey;
	if (!toggle || $('start').hidden === false || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
	e.preventDefault();
	document.body.classList.toggle('ui-hidden');
});

// --- Screenshots ---

let shotStatusTimer = 0;

/** Screenshot progress (P); kept on screen even with the interface hidden, but never in the picture. */
function showShotStatus(text: string | null, done = false): void {
	const el = $('shot-status');
	clearTimeout(shotStatusTimer);
	el.hidden = !text;
	el.textContent = text ?? '';
	if (done) shotStatusTimer = window.setTimeout(() => (el.hidden = true), 5000);
}

// --- Clicked creature or object ---

document.addEventListener('pointerlockchange', () => {
	$('crosshair').hidden = !document.pointerLockElement;
});
$('info-close').addEventListener('click', () => ($('info').hidden = true));
window.addEventListener('keydown', (e) => {
	if (e.code === 'Escape') $('info').hidden = true;
});

/** Book text uses $B for line breaks and $N for the reader's name. */
function pageText(text: string): string {
	return text.replace(/\$[Bb]/g, '\n').replace(/\$[Nn]/g, 'traveler').replace(/\$[Cc]/g, 'adventurer');
}

function showInfo(info: SpawnInfo): void {
	const isNpc = info.type === 'npc';
	$('info-kind').textContent = [isNpc ? 'NPC' : 'Object', info.kind, info.rank].filter(Boolean).join(' · ');
	$('info-name').textContent = info.name;
	$('info-sub').textContent = info.subname ? `<${info.subname}>` : '';
	const facts: [string, string][] = [];
	if (info.level) facts.push(['Level', info.level]);
	facts.push([isNpc ? 'NPC ID' : 'Object ID', String(info.entry)], ['Spawn', String(info.guid)]);
	$('info-facts').replaceChildren(...facts.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));

	const pages = $('info-pages');
	pages.replaceChildren();
	(info.pages ?? []).forEach((text, i) => {
		if (i > 0) pages.append(document.createElement('hr'));
		pages.append(pageText(text));
	});

	// Wowhead uses the same creature/object template IDs; its tooltip script decorates these links.
	const path = `${isNpc ? 'npc' : 'object'}=${info.entry}`;
	const links = [
		['Wowhead Forever', `https://www.wowhead.com/forever/${path}`],
		['Wowhead Classic', `https://www.wowhead.com/classic/${path}`],
	].map(([label, href]) => {
		const a = document.createElement('a');
		a.href = href;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = label;
		return a;
	});
	$('info-links').replaceChildren(...links);
	$('info').hidden = false;
	(window as unknown as { $WowheadPower?: { refreshLinks?: () => void } }).$WowheadPower?.refreshLinks?.();
}

let shownZone: string | null = null;
let shownSubzone: string | null = null;

/** Shows the zone banner when entering a new zone, or just the subzone within the same zone. */
function announceZone(zone: string | null, subzone: string | null): void {
	if (!zone || (zone === shownZone && subzone === shownSubzone)) return;
	const newZone = zone !== shownZone;
	shownZone = zone;
	shownSubzone = subzone;
	if (!newZone && !subzone) return;
	$('zone-name').textContent = newZone ? zone : subzone ?? '';
	$('subzone-name').textContent = newZone ? subzone ?? '' : '';
	const banner = $('zone-banner');
	banner.classList.remove('show');
	void banner.offsetWidth; // restart the animation
	banner.classList.add('show');
}

function showHud(info: HudInfo): void {
	announceZone(info.zone, info.subzone);
	$('highlight-status').textContent = info.highlights;
	$('hud-location').textContent = info.zone ? [info.zone, info.subzone].filter(Boolean).join(' · ') : info.location;
	$('hud-coords').textContent = info.zone ? `${info.location} · ${info.coordinates}` : info.coordinates;
	const rows: [string, string][] = [
		['Time', info.time],
		['Names for', info.side],
		['Music', info.music],
		['Altitude', `${info.altitude.toFixed(0)} yd above ground`],
		['Speed', `${info.speed.toFixed(0)} yd/s`],
		['Collision', info.collision],
		['Detail', info.near],
		['Objects', info.objects],
		['Textures', info.textures],
		['FPS', info.fps.toFixed(0)],
	];
	$('hud-stats').replaceChildren(...rows.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));
}
