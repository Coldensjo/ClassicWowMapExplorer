import { droppedFolderToSource, filesToSource, hasDirectoryPicker, pickDirectory } from '../app/folderPicker';
import { createStorageClient } from '../worker/client';
import type { SourceInit } from '../worker/protocol';
import type { Place } from '../explorer/places';
import type { SpawnInfo } from '../explorer/spawns';
import type { MapCategory, MapListing } from '../explorer/world';
import type { HighlightGroup, HighlightSettings } from './highlights';
import { Minimap } from './minimap';
import { canPose, POSES } from './spawnEditor';
import { isTyping } from './typing';
import { FLY_SPEED_RANGE, FLY_SPEED_STEP, Viewer, type HudInfo, type ViewSettings } from './viewer';
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
		setStatus(init.kind === 'http'
			? 'World of Warcraft was found but couldn\'t be read. Choose its folder instead.'
			: 'That isn\'t the World of Warcraft folder. Choose the folder that contains _classic_ or _classic_beta_ (not that folder itself).', true);
	}
}

/**
 * The portable launcher (and the dev server) look for World of Warcraft on this computer and
 * serve it under /__wow/; when they found it, there's nothing to choose. A plain web server
 * has no such path, and then the folder is chosen by hand.
 */
async function findWow(): Promise<void> {
	const base = new URL('__wow/', location.href).href;
	let found = false;
	try {
		const response = await fetch(`${base}.build.info`, { method: 'HEAD' });
		// Some servers answer every path with the page itself.
		found = response.ok && !response.headers.get('Content-Type')?.includes('text/html');
	} catch {
		// Not served from here.
	}
	$('start').classList.remove('finding');
	if (found) await useSource({ kind: 'http', base });
}
void findWow();

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
	const input = event.target as HTMLInputElement;
	const source = filesToSource(input.files ?? []);
	// Emptied once read: the browser keeps a filled file input in the page's saved state, and
	// re-sends that (every file in the install, tens of MB) after each key press, a stall each time.
	input.value = '';
	showProgress('Reading your folder');
	await useSource(source);
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

/** Fonts\FRIZQT__.TTF, Friz Quadrata: the game's font for names over heads and most of its interface. */
const GAME_FONT = 615960;

/**
 * Takes the game's own font from the install for the names over NPCs, as the game draws them.
 * Without it they fall back to a font of this computer's.
 */
async function loadGameFont(): Promise<void> {
	try {
		const face = new FontFace('Friz Quadrata', new Uint8Array(await storage.loadFont(GAME_FONT)));
		document.fonts.add(await face.load());
	} catch (e) {
		console.warn('Game font unavailable:', e);
	}
}

/** Opens the chosen game version and starts the viewer. */
async function explore(): Promise<void> {
	const button = $<HTMLButtonElement>('explore');
	button.disabled = true;
	for (const id of ['pick', 'pick-direct']) $<HTMLButtonElement>(id).disabled = true;
	try {
		await storage.open($<HTMLSelectElement>('product').value);
		const font = loadGameFont();
		const viewer = new Viewer($('view'), storage, showHud, showInfo, $('nameplates'));
		// For poking at the scene from the console (and test scripts) while developing.
		if (import.meta.env.DEV) (globalThis as unknown as { mapExplorerViewer: Viewer }).mapExplorerViewer = viewer;
		viewer.onShotStatus = showShotStatus;
		await viewer.load((text) => showProgress(text));
		await font;
		showProgress('Starting');
		$('start').hidden = true;
		$('hud').hidden = $('side').hidden = $('menubar').hidden = false;
		setUpMenus(viewer);
		setUpView(viewer);
		viewer.start();
		setUpMinimap(viewer);
		void setUpGoTo(viewer);
		setUpHighlights(viewer);
		setUpEditor(viewer);
		setUpPlace(viewer);
		setUpSound(viewer);
		setUpHelp();
	} catch (e) {
		setStatus(`Could not start: ${(e as Error).message}`, true);
		button.disabled = false;
		for (const id of ['pick', 'pick-direct']) $<HTMLButtonElement>(id).disabled = false;
	}
}

// --- Remembered settings ---

function readSaved<T>(key: string): Partial<T> {
	try {
		return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
	} catch {
		// Storage blocked or unreadable: the defaults.
		return {};
	}
}

function save(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Not remembered; it still applies for this visit.
	}
}

// --- Notices: what a key just changed ---

let noticeTimer = 0;

/** A line low in the middle saying what just changed; it fades after a moment. Shown even with the interface hidden. */
function notify(text: string): void {
	const el = $('notice');
	el.textContent = text;
	el.classList.add('show');
	clearTimeout(noticeTimer);
	noticeTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

const onOff = (on: boolean) => (on ? 'on' : 'off');

/** Minutes after midnight as HH:MM. */
function clock(minutes: number): string {
	const m = Math.floor(minutes) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A speed multiplier as ×1, ×2.4, ×0.59 and so on. */
function speedLabel(scale: number): string {
	return `×${Number(scale.toPrecision(2))}`;
}

// --- Keys belong to the world ---

// Text boxes and lists keep keys while in use; everything else hands them back once used, and
// clicking the world or pressing Esc always does.
document.addEventListener('change', (e) => {
	if (!isTyping(e) || e.target instanceof HTMLSelectElement) (e.target as HTMLElement).blur();
});
document.addEventListener('click', (e) => {
	// Space flies up; it mustn't fold a panel or press a button again.
	(e.target as Element).closest<HTMLElement>('summary, button')?.blur();
});
$('view').addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur());
document.addEventListener('keydown', (e) => {
	if (e.code === 'Escape' && isTyping(e)) (e.target as HTMLElement).blur();
});

// --- The View panel and the HUD ---

const VIEW_KEY = 'mapExplorer.view';
type SavedView = Partial<ViewSettings> & { stats: boolean };

/** Called with each HUD update, for the parts of the page that follow the viewer. */
const hudFollowers: (() => void)[] = [];

/** The View panel: every setting the keys toggle, the time of day and the HUD's stats; remembered between visits. */
function setUpView(viewer: Viewer): void {
	const panel = $('view-panel');
	const { stats = false, ...settings } = readSaved<SavedView>(VIEW_KEY);
	viewer.settings = settings;
	const statsBox = $<HTMLInputElement>('stats-on');
	const controls = [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')];
	const remember = () => save(VIEW_KEY, { ...viewer.settings, stats: statsBox.checked });
	const sync = () => {
		const s = viewer.settings;
		for (const c of controls) {
			const value = s[c.dataset.setting as keyof ViewSettings];
			if (c instanceof HTMLInputElement) c.checked = value as boolean;
			else c.value = String(value);
		}
	};
	const setStats = (on: boolean) => {
		statsBox.checked = on;
		$('hud-stats').hidden = !on;
	};
	setStats(stats);
	sync();
	for (const c of controls) {
		c.addEventListener('change', () => {
			viewer.settings = { [c.dataset.setting!]: c instanceof HTMLInputElement ? c.checked : c.value };
			remember();
		});
	}
	statsBox.addEventListener('change', () => {
		setStats(statsBox.checked);
		remember();
	});
	window.addEventListener('keydown', (e) => {
		if (e.code !== 'KeyK' || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
		setStats(!statsBox.checked);
		remember();
		notify(`Performance stats ${onOff(statsBox.checked)}`);
	});

	// The time of day: the slider follows the clock unless it's being dragged.
	const time = $<HTMLInputElement>('time');
	const timeOut = $('time-out');
	const now = $<HTMLButtonElement>('time-now');
	let dragging = false;
	const syncTime = () => {
		const minutes = viewer.timeMinutes;
		if (!dragging) time.value = String(Math.round(minutes / 15) * 15);
		timeOut.textContent = clock(minutes);
		timeOut.classList.toggle('shifted', !viewer.timeIsLocal);
		timeOut.title = viewer.timeIsLocal ? 'Your local time' : 'Moved from your local time';
		now.disabled = viewer.timeIsLocal;
	};
	time.addEventListener('pointerdown', () => (dragging = true));
	window.addEventListener('pointerup', () => (dragging = false));
	time.addEventListener('input', () => {
		viewer.timeMinutes = Number(time.value);
		syncTime();
	});
	now.addEventListener('click', () => {
		viewer.resetTime();
		syncTime();
	});
	syncTime();
	hudFollowers.push(syncTime);

	// The flying speed: a slider in powers of two either side of normal.
	const speed = $<HTMLInputElement>('fly-speed');
	const speedOut = $('fly-speed-out');
	const speedReset = $<HTMLButtonElement>('fly-speed-reset');
	speed.min = String(-FLY_SPEED_RANGE);
	speed.max = String(FLY_SPEED_RANGE);
	speed.step = String(FLY_SPEED_STEP);
	const syncSpeed = () => {
		const scale = viewer.settings.flySpeed;
		speed.value = String(Math.log2(scale));
		speedOut.textContent = speedLabel(scale);
		speedOut.classList.toggle('shifted', scale !== 1);
		speedReset.disabled = scale === 1;
	};
	speed.addEventListener('input', () => {
		viewer.settings = { flySpeed: 2 ** Number(speed.value) };
		syncSpeed();
		remember();
	});
	speedReset.addEventListener('click', () => {
		viewer.settings = { flySpeed: 1 };
		syncSpeed();
		remember();
	});
	syncSpeed();

	viewer.onChange = (change) => {
		const s = viewer.settings;
		sync();
		syncTime();
		syncSpeed();
		syncSound(viewer);
		remember();
		notify({
			torch: () => `Torch ${onOff(s.torch)}`,
			clutter: () => `Grass and flowers ${onOff(s.clutter)}`,
			collision: () => (s.collision ? 'Collision on: walls and floors stop you' : 'Collision off: flying through walls'),
			side: () => `Name colours as the ${s.side === 'alliance' ? 'Alliance' : 'Horde'} sees them`,
			mapNames: () => `Dungeon and raid names ${onOff(s.mapNames)}`,
			npcNames: () => `Names over NPCs ${onOff(s.npcNames)}`,
			cinematic: () => (s.cinematic ? 'Cinematic camera: turning glides after the mouse' : 'Cinematic camera off'),
			grading: () => `Colour grading ${onOff(s.grading)}`,
			shadows: () => `Shadows ${onOff(s.shadows)}`,
			fog: () => `Fog and sun shafts ${onOff(s.fog)}`,
			creatures: () => `NPCs and monsters ${onOff(s.creatures)}`,
			gameObjects: () => `Objects ${onOff(s.gameObjects)}`,
			spiritHealers: () => `Spirit healers ${onOff(s.spiritHealers)}`,
			flySpeed: () => `Flying speed ${speedLabel(s.flySpeed)}`,
			time: () => (viewer.timeIsLocal ? `Local time, ${clock(viewer.timeMinutes)}` : `Time of day ${clock(viewer.timeMinutes)}`),
			sound: () => `Music and sound ${onOff(viewer.soundOn ?? false)}`,
		}[change]());
	};

	// Clicking the coordinates copies a link that opens this view.
	$('hud-coords').addEventListener('click', () => void copyLink(viewer));
}

/** Copies a link that opens this view. */
async function copyLink(viewer: Viewer): Promise<void> {
	try {
		await navigator.clipboard.writeText(viewer.shareLink());
		notify('Link to this view copied');
	} catch {
		notify('Couldn’t copy: the browser didn’t allow it');
	}
}

// --- The menus ---

/**
 * The menu bar: a click opens a menu, and while one is open, pointing at another opens that
 * instead, as in a desktop app. Commands close the menu; switches and sliders keep it open.
 * Clicking anywhere else or Esc closes it.
 */
function setUpMenus(viewer: Viewer): void {
	const menus = [...document.querySelectorAll<HTMLElement>('#menubar .menu')];
	let open: HTMLElement | null = null;
	const setOpen = (menu: HTMLElement | null) => {
		open = menu;
		for (const m of menus) {
			m.classList.toggle('open', m === menu);
			m.querySelector('.menu-button')!.setAttribute('aria-expanded', String(m === menu));
			m.querySelector<HTMLElement>('.menu-panel')!.hidden = m !== menu;
		}
		if (menu && document.pointerLockElement) document.exitPointerLock();
	};
	for (const m of menus) {
		const button = m.querySelector('.menu-button')!;
		button.addEventListener('click', () => setOpen(open === m ? null : m));
		button.addEventListener('pointerenter', () => {
			if (open && open !== m) setOpen(m);
		});
		m.querySelector('.menu-panel')!.addEventListener('click', (e) => {
			if ((e.target as Element).closest('.menu-item')) setOpen(null);
		});
	}
	document.addEventListener('pointerdown', (e) => {
		if (open && !open.contains(e.target as Node)) setOpen(null);
	});
	window.addEventListener('keydown', (e) => {
		if (e.code === 'Escape' && open) setOpen(null);
	});

	$('menu-link').addEventListener('click', () => void copyLink(viewer));
	$('menu-shot').addEventListener('click', () => viewer.toggleShot());
	$('menu-hide').addEventListener('click', toggleInterface);
}

function fillList(id: string, rows: [string, string][]): void {
	$(id).replaceChildren(...rows.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));
}

// --- The minimap ---

function setUpMinimap(viewer: Viewer): void {
	const minimap = new Minimap($('minimap'), storage, () => viewer.minimapView(), (mapId, x, y) => viewer.flyOver(mapId, x, y));
	$('minimap-in').addEventListener('click', () => minimap.zoomBy(-1));
	$('minimap-out').addEventListener('click', () => minimap.zoomBy(1));
}

// --- Going places ---

const MAP_GROUPS: [MapCategory, string][] = [
	['continent', 'Continents'],
	['dungeon', 'Dungeons'],
	['raid', 'Raids'],
	['battleground', 'Battlegrounds'],
	['other', 'Other maps'],
];
const MAP_KINDS: Record<MapCategory, string> = { continent: 'Continent', dungeon: 'Dungeon', raid: 'Raid', battleground: 'Battleground', other: 'Other map' };
/** Matches shown at most. */
const GOTO_LIMIT = 40;

interface Destination {
	name: string;
	/** What it is, or where it lies. */
	sub: string;
	/** Zones before maps before towns, among matches as good as each other. */
	order: number;
	category?: MapCategory;
	/** The name lower-cased, without accents or apostrophes, for matching. */
	key: string;
	go: () => Promise<boolean>;
}

const searchKey = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ'’]/g, '');

/** How well a name matches: the start of it, the start of a word in it, anywhere in it, or not at all (-1). */
function matchScore(key: string, query: string): number {
	if (key.startsWith(query)) return 0;
	if (key.split(/[\s-]+/).some((word) => word.startsWith(query))) return 1;
	return key.includes(query) ? 2 : -1;
}

/**
 * Go to: a search over every zone, town and landmark, and every map in the install (many have
 * no way in from the world). Empty, it lists the maps by kind, as a way in to all of them.
 */
async function setUpGoTo(viewer: Viewer): Promise<void> {
	const input = $<HTMLInputElement>('goto-query');
	const list = $('goto-results');
	const [maps, places] = await Promise.all([
		storage.listMaps().catch((e): MapListing[] => {
			console.warn('Map list unavailable:', e);
			return [];
		}),
		storage.loadPlaces().catch((e): Place[] => {
			console.warn('Zones and towns unavailable:', e);
			return [];
		}),
	]);
	const mapNames = new Map(maps.map((m) => [m.id, m.name]));
	const destination = (name: string, sub: string, order: number, go: () => Promise<boolean>, category?: MapCategory): Destination => ({ name, sub, order, category, key: searchKey(name), go });
	// Only places on maps in the install, and not a battleground's own zone (the map stands for it).
	const placesHere = places.filter((p) => mapNames.has(p.mapId) && !(p.kind === 'zone' && mapNames.get(p.mapId) === p.name));
	const destinations = [
		...placesHere.filter((p) => p.kind === 'zone').map((p) => destination(p.name, 'Zone', 0, () => viewer.goToPlace(p))),
		...maps.map((m) => destination(m.name, MAP_KINDS[m.category], 1, () => viewer.goToMap(m.id), m.category)),
		...placesHere.filter((p) => p.kind === 'place').map((p) => destination(p.name, p.zone ?? mapNames.get(p.mapId) ?? '', 2, () => viewer.goToPlace(p))),
	];

	let shown: Destination[] = [];
	let active = -1;

	const item = (d: Destination) => {
		const li = document.createElement('li');
		li.role = 'option';
		li.id = `goto-${shown.length}`;
		const name = document.createElement('span');
		name.textContent = d.name;
		const sub = document.createElement('span');
		sub.className = 'sub';
		sub.textContent = d.sub;
		li.append(name, sub);
		// Before the box loses focus, which closes the list.
		li.addEventListener('mousedown', (e) => {
			e.preventDefault();
			void pick(d);
		});
		shown.push(d);
		return li;
	};
	const note = (text: string, className: string) => {
		const li = document.createElement('li');
		li.className = className;
		li.textContent = text;
		return li;
	};
	const setActive = (index: number) => {
		active = index;
		list.querySelectorAll('[aria-selected]').forEach((li) => li.removeAttribute('aria-selected'));
		const li = index >= 0 ? $(`goto-${index}`) : null;
		li?.setAttribute('aria-selected', 'true');
		li?.scrollIntoView({ block: 'nearest' });
		if (li) input.setAttribute('aria-activedescendant', li.id);
		else input.removeAttribute('aria-activedescendant');
	};
	const render = () => {
		const query = searchKey(input.value.trim());
		shown = [];
		const rows: HTMLLIElement[] = [];
		if (!query) {
			for (const [category, label] of MAP_GROUPS) {
				const group = destinations.filter((d) => d.category === category);
				if (!group.length) continue;
				rows.push(note(label, 'group'), ...group.map(item));
			}
		} else {
			const matches = destinations
				.map((d) => ({ d, score: matchScore(d.key, query) }))
				.filter((m) => m.score >= 0)
				.sort((a, b) => a.score - b.score || a.d.order - b.d.order || a.d.name.length - b.d.name.length || a.d.name.localeCompare(b.d.name))
				.slice(0, GOTO_LIMIT);
			rows.push(...matches.map((m) => item(m.d)));
			if (!matches.length) rows.push(note('Nothing by that name', 'empty'));
		}
		list.replaceChildren(...rows);
		list.hidden = false;
		input.setAttribute('aria-expanded', 'true');
		setActive(query && shown.length ? 0 : -1);
	};
	const close = () => {
		list.hidden = true;
		input.setAttribute('aria-expanded', 'false');
		input.value = '';
		setActive(-1);
	};
	const pick = async (d: Destination) => {
		input.blur();
		if (!(await d.go())) notify(`${d.name} isn’t in this install`);
	};

	input.addEventListener('focus', render);
	input.addEventListener('input', render);
	input.addEventListener('blur', close);
	input.addEventListener('keydown', (e) => {
		if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
			e.preventDefault();
			if (shown.length) setActive((active + (e.code === 'ArrowDown' ? 1 : shown.length - 1 + (active < 0 ? 1 : 0))) % shown.length);
		} else if (e.code === 'Enter') {
			const d = shown[Math.max(active, 0)];
			if (d) void pick(d);
		}
	});
	window.addEventListener('keydown', (e) => {
		if (e.key !== '/' || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
		e.preventDefault();
		if (document.pointerLockElement) document.exitPointerLock();
		input.focus();
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
	const saved = readSaved<HighlightSettings>(HIGHLIGHT_KEY);
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
		$('highlight-menu').classList.toggle('on', settings.on);
		viewer.setHighlights(settings);
		save(HIGHLIGHT_KEY, settings);
	};
	for (const box of [on, ...boxes]) {
		box.addEventListener('change', () => {
			// Choosing a kind turns highlighting on.
			if (box !== on && box.checked) on.checked = true;
			apply();
		});
	}
	query.addEventListener('input', () => {
		if (query.value.trim()) on.checked = true;
		apply();
	});
	query.addEventListener('keydown', (e) => {
		if (e.code === 'Enter') query.blur();
	});
	window.addEventListener('keydown', (e) => {
		if (e.code !== 'KeyH' || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
		on.checked = !on.checked;
		apply();
		notify(`Highlights ${onOff(on.checked)}`);
	});
	apply();
}

// --- Editing NPCs and objects ---

/** The spawn the info card shows, if any. */
let shownSpawn: SpawnInfo | null = null;

/** The Edit panel, F2, and the editing part of the info card. */
function setUpEditor(viewer: Viewer): void {
	const editor = viewer.editor;
	const on = $<HTMLInputElement>('edit-on');
	const fields = [...document.querySelectorAll<HTMLInputElement>('#info-edit [data-place]')];
	const setActive = (active: boolean) => {
		// Editing starts with whatever's open on the card.
		const open = $('info').hidden ? null : shownSpawn;
		editor.setActive(active);
		if (active && open) editor.select(open);
	};
	editor.onState = (state) => {
		on.checked = state.active;
		$('edit-menu').classList.toggle('on', state.active);
		$<HTMLButtonElement>('edit-undo').disabled = !state.canUndo;
		$<HTMLButtonElement>('edit-redo').disabled = !state.canRedo;
		$<HTMLButtonElement>('edit-export').disabled = $<HTMLButtonElement>('edit-clear').disabled = state.count === 0;
		$('edit-count').textContent = state.count ? `${state.count} NPC${state.count === 1 ? ' or object' : 's and objects'} changed` : 'Nothing changed yet';
		$('edit-status').textContent = state.active ? 'Click an NPC or object, then drag it. Right-drag to look around.' : '';
		$('info-edit').hidden = !state.active;
	};
	const selection = (info: SpawnInfo | null, edited: boolean) => {
		$<HTMLButtonElement>('menu-duplicate').disabled = $<HTMLButtonElement>('menu-delete').disabled = !info || !editor.active;
		$<HTMLButtonElement>('menu-reset').disabled = !info || !editor.active || !edited || !!info.created;
	};
	// Poses, grouped; the ones the selected model can't show are greyed out once it has loaded.
	const pose = $<HTMLSelectElement>('edit-pose');
	for (const [group, poses] of POSES) {
		const optgroup = document.createElement('optgroup');
		optgroup.label = group;
		for (const [id, name] of poses) optgroup.append(new Option(name, String(id)));
		pose.append(optgroup);
	}
	const markPoses = () => {
		const animations = editor.selectedAnimations();
		for (const option of pose.options) option.disabled = !!animations && option.value !== '0' && !canPose(animations, Number(option.value));
	};
	pose.addEventListener('pointerdown', markPoses);
	pose.addEventListener('focus', markPoses);
	pose.addEventListener('change', () => {
		const id = Number(pose.value);
		editor.setPlace({ pose: id || undefined });
	});
	editor.onSelect = (info, edited) => {
		selection(info, edited);
		if (!info) {
			$('info').hidden = true;
			return;
		}
		showInfo(info);
		const { x, y, z, o, scale } = info.place;
		const values: Record<string, number> = { x, y, z, o: DEGREES_PER_RADIAN * o, scale };
		for (const f of fields) f.value = String(Number(values[f.dataset.place!].toFixed(f.dataset.place === 'scale' ? 3 : 2)));
		$<HTMLButtonElement>('edit-reset').disabled = !edited || !!info.created;
		$('edit-pose').parentElement!.hidden = info.type !== 'npc';
		pose.value = String(info.place.pose ?? 0);
		markPoses();
		$('edit-badge').textContent = info.created ? `A copy (spawn ${info.guid}), only here` : edited ? 'Changed here' : '';
	};
	for (const f of fields) {
		f.addEventListener('change', () => {
			const value = Number(f.value);
			if (!Number.isFinite(value)) return;
			const key = f.dataset.place as 'x' | 'y' | 'z' | 'o' | 'scale';
			if (key === 'scale' && value <= 0) return;
			editor.setPlace({ [key]: key === 'o' ? (((value % 360) + 360) % 360) / DEGREES_PER_RADIAN : value });
		});
		f.addEventListener('keydown', (e) => {
			if (e.code === 'Enter') f.blur();
		});
	}
	on.addEventListener('change', () => setActive(on.checked));
	$('edit-duplicate').addEventListener('click', () => editor.duplicate());
	$('edit-delete').addEventListener('click', () => editor.remove());
	$('edit-reset').addEventListener('click', () => editor.reset());
	$('menu-place').addEventListener('click', () => openPlace(true));
	$<HTMLInputElement>('edit-props').addEventListener('change', (e) => (editor.props = (e.target as HTMLInputElement).checked));
	$<HTMLInputElement>('edit-buildings').addEventListener('change', (e) => (editor.buildings = (e.target as HTMLInputElement).checked));
	$('menu-duplicate').addEventListener('click', () => editor.duplicate());
	$('menu-delete').addEventListener('click', () => editor.remove());
	$('menu-reset').addEventListener('click', () => editor.reset());
	$('edit-undo').addEventListener('click', () => editor.undo());
	$('edit-redo').addEventListener('click', () => editor.redo());
	$('edit-export').addEventListener('click', () => {
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([editor.exportJson()], { type: 'application/json' }));
		link.download = 'mapexplorer-edits.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	});
	const file = $<HTMLInputElement>('edit-import-file');
	$('edit-import').addEventListener('click', () => file.click());
	file.addEventListener('change', async () => {
		const chosen = file.files?.[0];
		file.value = '';
		if (!chosen) return;
		try {
			notify(`Imported ${editor.importJson(await chosen.text())} changes`);
		} catch (e) {
			notify(`Could not import: ${(e as Error).message}`);
		}
	});
	$('edit-clear').addEventListener('click', () => {
		if (confirm('Put every NPC and object back as the spawn data has it? This removes all your changes and copies.')) editor.clearAll();
	});
	window.addEventListener('keydown', (e) => {
		if (e.code !== 'F2' || isTyping(e)) return;
		e.preventDefault();
		setActive(!editor.active);
		notify(editor.active ? 'Editing on: click an NPC or object' : 'Editing off');
	});
	editor.onState(editor.state);
	selection(null, false);
}

/** Opens or closes the Place panel; set up by setUpPlace. */
let openPlace: (on: boolean) => void = () => {};

/** Results shown at most in the Place panel. */
const PLACE_LIMIT = 80;

/**
 * The Place panel: every creature and game object template (public/spawns/templates.json), by
 * name or ID. Choosing one hands it to the editor, which carries it under the mouse until a click.
 */
function setUpPlace(viewer: Viewer): void {
	const panel = $('place');
	const query = $<HTMLInputElement>('place-query');
	const list = $('place-results');
	const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-tab]')];
	type Row = { entry: number; name: string; sub: string; key: string };
	let rows: Record<'npc' | 'object', Row[]> | null = null;
	let tab: 'npc' | 'object' = 'npc';
	let loading: Promise<void> | null = null;

	const load = () => {
		loading ??= storage.listTemplates().then((t) => {
			const keyed = (r: [number, string, string][]) => r.map(([entry, name, sub]) => ({ entry, name, sub, key: searchKey(name) }))
				.sort((a, b) => a.name.localeCompare(b.name));
			rows = { npc: keyed(t.npcs), object: keyed(t.objects) };
		}, (e) => {
			console.warn('Templates:', e);
			rows = { npc: [], object: [] };
		});
		return loading;
	};

	const render = () => {
		const item = (text: string, className = '') => {
			const li = document.createElement('li');
			li.className = className;
			li.textContent = text;
			return li;
		};
		if (!rows) {
			list.replaceChildren(item('Reading the list…', 'empty'));
			return;
		}
		const q = searchKey(query.value.trim());
		const id = Number(q);
		let found: Row[];
		if (!q) found = rows[tab].slice(0, PLACE_LIMIT);
		else if (Number.isInteger(id) && id > 0) found = rows[tab].filter((r) => r.entry === id);
		else {
			found = rows[tab].map((r) => ({ r, score: matchScore(r.key, q) }))
				.filter((m) => m.score >= 0)
				.sort((a, b) => a.score - b.score || a.r.name.length - b.r.name.length)
				.slice(0, PLACE_LIMIT)
				.map((m) => m.r);
		}
		if (!found.length) {
			list.replaceChildren(item(rows[tab].length ? 'Nothing by that name' : 'No list: run npm run spawns', 'empty'));
			return;
		}
		list.replaceChildren(...found.map((r) => {
			const li = item(r.name);
			const sub = document.createElement('span');
			sub.className = 'sub';
			sub.textContent = `${r.sub} · ${r.entry}`;
			li.append(sub);
			li.addEventListener('click', async () => {
				for (const other of list.children) other.classList.remove('chosen');
				li.classList.add('chosen');
				// Keys back to the world, so Esc cancels and the camera flies.
				query.blur();
				if (!(await viewer.editor.place(tab, r.entry))) notify('Can’t place that here: point at the ground on a map');
			});
			return li;
		}));
	};

	openPlace = (on: boolean) => {
		panel.hidden = !on;
		if (!on) return;
		viewer.editor.setActive(true);
		query.focus();
		query.select();
		render();
		void load().then(render);
	};
	$('place-close').addEventListener('click', () => openPlace(false));
	query.addEventListener('input', render);
	query.addEventListener('keydown', (e) => {
		if (e.code === 'Escape') openPlace(false);
		else if (e.code === 'Enter') (list.querySelector('li:not(.empty)') as HTMLElement | null)?.click();
	});
	for (const button of tabs) {
		button.addEventListener('click', () => {
			tab = button.dataset.tab as 'npc' | 'object';
			for (const b of tabs) b.setAttribute('aria-selected', String(b === button));
			render();
		});
	}
}

/** Radians to degrees. */
const DEGREES_PER_RADIAN = 180 / Math.PI;

// --- Sound ---

/** The Sound panel's on/off box, which is greyed out until the music is read. */
function syncSound(viewer: Viewer): void {
	const box = $<HTMLInputElement>('sound-on');
	box.checked = viewer.soundOn ?? false;
	box.disabled = viewer.soundOn === null;
}

/** The Sound panel: music and sound on or off, and a slider per kind of sound, applied as they move. */
function setUpSound(viewer: Viewer): void {
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
	}
	$('sound-on').addEventListener('change', (e) => {
		viewer.soundOn = (e.target as HTMLInputElement).checked;
	});
	// The music is read after the world opens.
	hudFollowers.push(() => syncSound(viewer));
}

// --- Help ---

const HELP_KEY = 'mapExplorer.helpSeen';

/** The list of controls: ? or F1, or the button bottom left; shown once by itself on the first visit. */
function setUpHelp(): void {
	const help = $('help');
	const show = (on: boolean) => {
		help.hidden = !on;
		if (on && document.pointerLockElement) document.exitPointerLock();
	};
	$('help-hint').addEventListener('click', () => show(Boolean(help.hidden)));
	$('help-close').addEventListener('click', () => show(false));
	help.addEventListener('click', (e) => {
		if (e.target === help) show(false);
	});
	window.addEventListener('keydown', (e) => {
		if (isTyping(e)) return;
		if (e.key === '?' || e.code === 'F1') {
			e.preventDefault();
			show(Boolean(help.hidden));
		} else if (e.code === 'Escape') {
			show(false);
		}
	});
	let seen = true;
	try {
		seen = localStorage.getItem(HELP_KEY) === '1';
		localStorage.setItem(HELP_KEY, '1');
	} catch {
		// Storage blocked: not shown by itself, as it couldn't be remembered as seen.
	}
	if (!seen) show(true);
}

// --- Hiding the interface ---

// U, or Alt+Z as in the game: everything drawn over the world goes, for a clear view or
// screenshots. The NVIDIA overlay takes Alt+Z for itself where it's installed, hence U too.
window.addEventListener('keydown', (e) => {
	const toggle = e.altKey ? e.code === 'KeyZ' : e.code === 'KeyU' && !e.ctrlKey && !e.metaKey;
	if (!toggle || $('start').hidden === false || isTyping(e)) return;
	e.preventDefault();
	toggleInterface();
});

function toggleInterface(): void {
	const hidden = document.body.classList.toggle('ui-hidden');
	notify(hidden ? 'Interface hidden: U brings it back' : 'Interface shown');
}

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
	if (e.code === 'Escape' && !isTyping(e)) $('info').hidden = true;
});

/** Book text uses $B for line breaks and $N for the reader's name. */
function pageText(text: string): string {
	return text.replace(/\$[Bb]/g, '\n').replace(/\$[Nn]/g, 'traveler').replace(/\$[Cc]/g, 'adventurer');
}

function showInfo(info: SpawnInfo): void {
	shownSpawn = info;
	const isNpc = info.type === 'npc';
	// The map's own props and buildings: no names, no Wowhead pages; their model file instead.
	const isModel = info.type === 'm2' || info.type === 'wmo';
	$('info-kind').textContent = isModel ? `${info.kind} · part of the map` : [isNpc ? 'NPC' : 'Object', info.kind, info.rank].filter(Boolean).join(' · ');
	$('info-name').textContent = info.name;
	$('info-sub').textContent = info.subname ? `<${info.subname}>` : '';
	const facts: [string, string][] = [];
	if (info.level) facts.push(['Level', info.level]);
	if (isModel) facts.push(['Model file', String(info.entry)], ['Placement', String(info.guid)]);
	else facts.push([isNpc ? 'NPC ID' : 'Object ID', String(info.entry)], ['Spawn', String(info.guid)]);
	fillList('info-facts', facts);

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
	$('info-links').replaceChildren(...(isModel ? [] : links));
	$('info-source').hidden = isModel;
	$('info').hidden = false;
	$('info').scrollTop = 0;
	(window as unknown as { $WowheadPower?: { refreshLinks?: () => void } }).$WowheadPower?.refreshLinks?.();
}

let shownZone: string | null = null;
let shownSubzone: string | null = null;

/** Fades a line of zone text in, holds it and fades it out again, from the start. */
function fadeZoneLine(el: HTMLElement): void {
	el.classList.remove('show');
	void el.offsetWidth; // restart the animation
	el.classList.add('show');
}

/**
 * Zone text as the game's ZoneText.lua shows it: a new zone shows its name with the subzone
 * under it; within a zone only the subzone line shows, and leaving a subzone for the open zone
 * shows the zone's name there.
 */
function announceZone(zone: string | null, subzone: string | null): void {
	if (!zone || (zone === shownZone && subzone === shownSubzone)) return;
	const newZone = zone !== shownZone;
	shownZone = zone;
	shownSubzone = subzone;
	$('zone-name').textContent = zone;
	if (newZone) fadeZoneLine($('zone-name'));
	const sub = subzone ?? (newZone ? '' : zone);
	$('subzone-name').textContent = sub;
	if (sub) fadeZoneLine($('subzone-name'));
}

function showHud(info: HudInfo): void {
	announceZone(info.zone, info.subzone);
	$('highlight-status').textContent = info.highlights;
	$('hud-location').textContent = info.zone ? [info.zone, info.subzone].filter(Boolean).join(' · ') : info.location;
	$('hud-coords').textContent = info.zone ? `${info.location} · ${info.coordinates}` : info.coordinates;
	fillList('hud-view', [
		['Time', info.time],
		['Altitude', `${info.altitude.toFixed(0)} yd above ground`],
		['Music', info.music],
	]);
	if (!$('hud-stats').hidden) {
		fillList('hud-stats', [
			['Speed', `${info.speed.toFixed(0)} yd/s`],
			['Detail', info.near],
			['Objects', info.objects],
			['Textures', info.textures],
			['FPS', info.fps.toFixed(0)],
		]);
	}
	for (const follow of hudFollowers) follow();
}
