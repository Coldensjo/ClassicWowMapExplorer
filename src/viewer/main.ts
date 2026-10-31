import { droppedFolderToSource, filesToSource } from './folderPicker';
import { createStorageClient } from '../worker/client';
import type { SourceInit } from '../worker/protocol';
import type { ProductInfo } from '../casc/config';
import { perf } from './perf';
import { isTyping } from './typing';
import { knownFolders, productName, productRank, REFERENCE_PRODUCT } from './clientConfig';
import { showScenes } from '../editor/scenesUi';
import { folderWasLinked, rememberFolderLinked, showFolderLost, wireLanding } from '../editor/landing';
import type { StorageStats } from '../casc/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// The landing page's art, icons and feature cards, before anything shows.
wireLanding();
const status = $('status');

const storage = createStorageClient((message) => showProgress(message), () => ($('game-updated').hidden = false));

$('game-updated-reload').addEventListener('click', () => location.reload());

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

/** Shows the loading bar at a step, over the folder button (kept in the layout, so the card doesn't change size). */
function showProgress(message: string): void {
	perf.log('load', message);
	const step = LOADING_STEPS.find(([pattern]) => pattern.test(message));
	const appearing = $('loading').hidden;
	$('start').classList.add('loading');
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
	$('start').classList.remove('loading');
	$('loading-fill').style.width = '0%';
}

/** Takes the folder card out of the landing page: the scene library takes its place. */
function dismissStart(): void {
	$('start').hidden = true;
}

/** Where the game version chosen on the landing page is remembered, for the next visit. */
const PRODUCT_KEY = 'foreverForge.product';
/** Every game version in the folder, for the version choice. */
let installed: ProductInfo[] = [];

/** The one open of the chosen game version, for the scene library and the editor. */
let opened: Promise<StorageStats> | null = null;

function openStorage(): Promise<StorageStats> {
	opened ??= storage.open($<HTMLSelectElement>('product').value);
	return opened;
}

/** The builder's landing screen (spec 3.1): opens the install and shows the scene library. */
async function openScenes(): Promise<void> {
	const button = $<HTMLButtonElement>('product-open');
	button.disabled = true;
	$<HTMLButtonElement>('pick').disabled = true;
	try {
		const stats = await openStorage();
		hideProgress();
		dismissStart();
		// For the next visit, which can't keep the folder itself: it says the connection was lost.
		rememberFolderLinked();
		showScenes(storage, stats);
	} catch (e) {
		perf.log('error', `could not open: ${(e as Error).message}`);
		setStatus(`Could not open: ${(e as Error).message}`, true);
		// Another version can be chosen and opened afresh.
		opened = null;
		button.disabled = false;
		$<HTMLButtonElement>('pick').disabled = false;
		if (installed.length > 1) $('product-step').hidden = false;
	}
}

/** The game version chosen on an earlier visit, if any. */
function savedProduct(): string | null {
	try {
		return localStorage.getItem(PRODUCT_KEY);
	} catch {
		// Storage blocked: the automatic choice.
		return null;
	}
}

/** Remembers the game version chosen, so the next visit opens it without asking. */
function rememberProduct(product: string): void {
	try {
		localStorage.setItem(PRODUCT_KEY, product);
	} catch {
		// Not remembered: the next visit chooses again.
	}
}

async function useSource(init: SourceInit): Promise<void> {
	showProgress('Reading .build.info');
	try {
		const products = (await storage.setSource(init)).filter((p) => p.product.startsWith('wow'));
		// Once each: a version can be listed with several builds, and opening it picks the one that can be read.
		installed = products.filter((p, i) => products.findIndex((q) => q.product === p.product) === i);
		installed.sort((a, b) => productRank(a.product) - productRank(b.product));
		const select = $<HTMLSelectElement>('product');
		select.replaceChildren(...products.map((p) => new Option(`${productName(p.product)} ${p.version}`, p.product)));
		const saved = savedProduct();
		// The version chosen before, if it's still installed. Otherwise the reference client, or
		// another classic build as best-effort: the continent file IDs are the classic ones.
		const preferred = products.find((p) => p.product === saved) ?? products.find((p) => p.product === REFERENCE_PRODUCT) ?? products.find((p) => p.product.startsWith('wow_classic'));
		if (preferred) {
			// Nothing to choose: straight in to the scene library.
			select.value = preferred.product;
			await openScenes();
			return;
		}
		hideProgress();
		$('product-step').hidden = products.length === 0;
		setStatus(products.length ? 'No Classic version found; choose a game version and press Open.' : 'No World of Warcraft game found in this folder.', true);
	} catch (e) {
		console.error('Reading the game folder failed', e);
		setStatus(folderProblem(init, e), true);
	}
}

/** What to tell the user when a folder couldn't be read, with the reason. */
function folderProblem(init: SourceInit, error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	if (init.kind === 'http') return `World of Warcraft was found but couldn't be read (${reason}). Choose its folder instead.`;
	const hasBuildInfo = init.files.some(({ path }) => path === '.build.info');
	const dataFiles = init.files.filter(({ path }) => /^data\/data\//i.test(path)).length;
	const counts = `Got ${init.files.length} files: ${hasBuildInfo ? '.build.info found' : '.build.info missing'}, ${dataFiles} in Data/data.`;
	if (!hasBuildInfo && dataFiles) {
		// The browser's folder dialog leaves out hidden files (.build.info) on macOS and Linux.
		return `${counts} The browser's folder dialog left out .build.info, a hidden file. Drag the folder onto this page instead.`;
	}
	return `${counts} That doesn't look like the World of Warcraft folder: choose the one that contains ${knownFolders().join(' or ')} (not that folder itself). Reason: ${reason}`;
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
	// A folder opened here before, and the browser can't keep it: say so, over the button.
	else if (folderWasLinked()) showFolderLost(true);
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
	const source = await filesToSource(input.files ?? []);
	// Emptied once read: the browser keeps a filled file input in the page's saved state, and
	// re-sends that (every file in the install, tens of MB) after each key press, a stall each time.
	input.value = '';
	showProgress('Reading your folder');
	await useSource(source);
});

// Several versions and none of them Classic: the one chosen opens, and is remembered.
$('product-open').addEventListener('click', () => {
	rememberProduct($<HTMLSelectElement>('product').value);
	void openScenes();
});

// --- Notices: what a key just changed ---

let noticeTimer = 0;

/** A line low in the middle saying what just changed; it fades after a moment. */
function notify(text: string): void {
	const el = $('notice');
	el.textContent = text;
	el.classList.add('show');
	clearTimeout(noticeTimer);
	noticeTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

// --- Keys belong to the scene ---

// Text boxes and lists keep keys while in use; everything else hands them back once used, and
// clicking the scene or pressing Esc always does.
document.addEventListener('change', (e) => {
	if (!isTyping(e) || e.target instanceof HTMLSelectElement) (e.target as HTMLElement).blur();
});
document.addEventListener('click', (e) => {
	// Space flies up; it mustn't fold a panel or press a button again.
	(e.target as Element).closest<HTMLElement>('summary, button')?.blur();
});
$('view').addEventListener('pointerdown', () => {
	(document.activeElement as HTMLElement | null)?.blur();
});
document.addEventListener('keydown', (e) => {
	if (e.code === 'Escape' && isTyping(e)) (e.target as HTMLElement).blur();
});

// --- Debug log ---

// F9 saves what the app recorded (freezes, loading, the WebGL calls that waited) to a file, for a bug report.
window.addEventListener('keydown', (e) => {
	if (e.code !== 'F9' || isTyping(e)) return;
	e.preventDefault();
	perf.save();
	notify('Debug log saved to your downloads');
});
