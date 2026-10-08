import type { ProductInfo } from '../casc/config';
import { CHUNK_SIZE } from '../formats/adt';
import type { Image } from '../formats/blp';
import { TILE_FILE_KINDS } from '../formats/wdt';
import { shadeHeights } from '../explorer/heightColors';
import { KNOWN_MAPS, type MapSummary, type TileDetails } from '../explorer/maps';
import { createStorageClient } from '../worker/client';
import { filesToSource, hasDirectoryPicker, pickDirectory } from './folderPicker';
import type { SourceInit } from '../worker/protocol';

const THUMB = 32;
const THUMB_BATCH = 48;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
const log = $('log');
const overview = $<HTMLCanvasElement>('overview');
const hover = $('hover');

const storage = createStorageClient((message) => setStatus(`${message}…`), () => setStatus('The game was updated while this page was open; reload it to read the new files.', true));

let current: { summary: MapSummary; x0: number; y0: number; cols: number; rows: number } | null = null;
let overviewToken = 0;

function setStatus(text: string, isError = false): void {
	status.textContent = text;
	status.className = isError ? 'bad' : 'muted';
	const li = document.createElement('li');
	li.textContent = text;
	if (isError) li.className = 'bad';
	log.prepend(li);
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	const escape = (v: unknown) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return strings.reduce((out, s, i) => out + s + (i < values.length ? escape(values[i]) : ''), '');
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function fillDl(dl: HTMLElement, entries: [string, unknown][]): void {
	dl.innerHTML = entries.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function drawImage(canvas: HTMLCanvasElement, image: Image | undefined | null): void {
	if (!image) {
		canvas.width = canvas.height = 1;
		return;
	}
	canvas.width = image.width;
	canvas.height = image.height;
	canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
}

// --- Folder selection ---

async function useSource(init: SourceInit): Promise<void> {
	setStatus('Reading .build.info');
	try {
		const products = (await storage.setSource(init)).filter((p) => p.product.startsWith('wow'));
		showProducts(products);
	} catch (e) {
		setStatus(`${(e as Error).message}. Pick the World of Warcraft folder itself (the one containing .build.info).`, true);
	}
}

function showProducts(products: ProductInfo[]): void {
	const select = $<HTMLSelectElement>('product');
	select.innerHTML = products
		.map((p) => html`<option value="${p.product}">${p.product} ${p.version}${p.active ? '' : ' (inactive)'}</option>`)
		.join('');
	select.hidden = $('open').hidden = products.length === 0;
	setStatus(products.length ? `Found ${products.length} installed products. Choose one and press Open.` : 'No WoW products found in .build.info', !products.length);
}

// The folder input is the default: Chromium's directory picker refuses anything under
// Program Files ("contains system files"), which is where WoW installs by default.
$('pick').addEventListener('click', () => $<HTMLInputElement>('pick-input').click());

// Direct access skips enumerating the whole folder, but only works for installs outside system folders.
if (!hasDirectoryPicker) $('pick-direct').hidden = true;
$('pick-direct').addEventListener('click', async () => {
	try {
		const init = await pickDirectory();
		if (init) await useSource(init);
	} catch (e) {
		setStatus((e as Error).message, true);
	}
});

$<HTMLInputElement>('pick-input').addEventListener('change', async (event) => {
	const files = (event.target as HTMLInputElement).files ?? [];
	setStatus(`Selected ${files.length.toLocaleString()} files`);
	await useSource(await filesToSource(files));
});

$('open').addEventListener('click', async () => {
	const product = $<HTMLSelectElement>('product').value;
	const button = $<HTMLButtonElement>('open');
	button.disabled = true;
	try {
		const stats = await storage.open(product);
		const total = Object.values(stats.timings).reduce((a, b) => a + b, 0);
		fillDl($('stats'), [
			['Build', stats.buildName || stats.version],
			['Index entries', stats.indexEntries.toLocaleString()],
			['Encoding pages', stats.encodingPages.toLocaleString()],
			['Root files', stats.rootFiles.toLocaleString()],
			['Named files', stats.rootNamedFiles.toLocaleString()],
			...Object.entries(stats.timings).map(([k, v]): [string, string] => [capitalize(k.replace('Reading ', '')), `${v} ms`]),
		]);
		$('stats-section').hidden = $('map-section').hidden = false;
		setStatus(`Opened ${stats.product} in ${total} ms`);
	} catch (e) {
		setStatus(`Could not open storage: ${(e as Error).message}`, true);
	} finally {
		button.disabled = false;
	}
});

// --- Map overview ---

$<HTMLSelectElement>('map').innerHTML = KNOWN_MAPS.map((m) => html`<option value="${m.wdt}">${m.name} (${m.directory})</option>`).join('');

$('load-map').addEventListener('click', async () => {
	const custom = Number($<HTMLInputElement>('wdt-fdid').value);
	const wdtFdid = custom > 0 ? custom : Number($<HTMLSelectElement>('map').value);
	try {
		await loadMap(wdtFdid);
	} catch (e) {
		setStatus(`Could not load map ${wdtFdid}: ${(e as Error).message}`, true);
	}
});

async function loadMap(wdtFdid: number): Promise<void> {
	const token = ++overviewToken;
	const summary = await storage.loadMap(wdtFdid);
	const xs = summary.tiles.map((t) => t.x);
	const ys = summary.tiles.map((t) => t.y);
	const x0 = Math.min(...xs);
	const y0 = Math.min(...ys);
	current = { summary, x0, y0, cols: Math.max(...xs) - x0 + 1, rows: Math.max(...ys) - y0 + 1 };

	showAvailability(summary);
	$('overview-hint').textContent = 'Click a tile to read it. Minimaps stream in from the local archives.';
	overview.width = current.cols * THUMB;
	overview.height = current.rows * THUMB;
	const ctx = overview.getContext('2d')!;
	ctx.fillStyle = '#0b0d10';
	ctx.fillRect(0, 0, overview.width, overview.height);
	ctx.fillStyle = '#2a2f37';
	for (const t of summary.tiles) ctx.fillRect((t.x - x0) * THUMB, (t.y - y0) * THUMB, THUMB - 1, THUMB - 1);

	setStatus(`Map ${wdtFdid}: ${summary.tileCount} tiles. Loading minimaps`);
	const start = performance.now();
	const coords = summary.tiles.map((t): [number, number] => [t.x, t.y]);
	for (let i = 0; i < coords.length; i += THUMB_BATCH) {
		const thumbs = await storage.minimapThumbnails(wdtFdid, coords.slice(i, i + THUMB_BATCH), THUMB);
		if (token !== overviewToken) return;
		for (const { x, y, image } of thumbs) {
			if (!image) continue;
			ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), (x - x0) * THUMB, (y - y0) * THUMB);
		}
	}
	setStatus(`Loaded ${coords.length} minimaps in ${Math.round(performance.now() - start)} ms`);
}

function showAvailability(summary: MapSummary): void {
	const statuses = ['ok', 'not-local', 'unknown', 'no-encoding', 'none'] as const;
	const used = statuses.filter((s) => TILE_FILE_KINDS.some((k) => summary.availability[k][s]));
	$('availability').innerHTML =
		html`<tr><th>Tile file</th>` + used.map((s) => html`<th>${s}</th>`).join('') + '</tr>' +
		TILE_FILE_KINDS.map((k) =>
			html`<tr><td>${k}</td>` +
			used.map((s) => html`<td class="${s === 'ok' ? 'ok' : s === 'none' ? '' : 'bad'}">${summary.availability[k][s] ?? ''}</td>`).join('') +
			'</tr>').join('');
}

function tileAt(event: MouseEvent): { x: number; y: number } | null {
	if (!current) return null;
	const rect = overview.getBoundingClientRect();
	const x = Math.floor(((event.clientX - rect.left) / rect.width) * current.cols) + current.x0;
	const y = Math.floor(((event.clientY - rect.top) / rect.height) * current.rows) + current.y0;
	return current.summary.tiles.some((t) => t.x === x && t.y === y) ? { x, y } : null;
}

overview.addEventListener('mousemove', (event) => {
	const tile = tileAt(event);
	hover.hidden = !tile;
	if (!tile) return;
	hover.textContent = `Tile ${tile.x}_${tile.y}`;
	hover.style.left = `${event.offsetX + 14}px`;
	hover.style.top = `${event.offsetY + 10}px`;
});
overview.addEventListener('mouseleave', () => (hover.hidden = true));

overview.addEventListener('click', async (event) => {
	const tile = tileAt(event);
	if (!tile || !current) return;
	try {
		showTile(await storage.loadTile(current.summary.wdtFdid, tile.x, tile.y));
	} catch (e) {
		setStatus(`Could not load tile: ${(e as Error).message}`, true);
	}
});

// --- Tile details ---

function showTile(tile: TileDetails): void {
	$('tile-panel').hidden = false;
	$('tile-title').textContent = `Tile ${tile.x}_${tile.y}`;

	const grid = tile.heightGrid;
	drawImage($('tile-heights'), grid && { width: grid.size, height: grid.size, rgba: shadeHeights(grid.heights, grid.size, CHUNK_SIZE / 8) });
	drawImage($('tile-minimap'), tile.minimap);
	drawImage($('tile-maptexture'), tile.mapTexture);

	fillDl($('tile-facts'), [
		['Chunks', tile.chunkCount],
		['Height range', grid ? `${grid.min.toFixed(1)} to ${grid.max.toFixed(1)} yd` : '–'],
		['Area IDs', tile.areaIds.join(', ') || '–'],
		['Water', tile.hasWater ? 'yes' : 'no'],
		['Chunks with holes', tile.holeChunks],
		['Map texture', tile.mapTexture ? `${tile.mapTexture.sourceSize}` : '–'],
		['Root chunks', tile.rootChunkIds.join(' ')],
		['Read time', `${tile.timeMs} ms`],
	]);
	$('tile-files').innerHTML = html`<tr><th>File</th><th>File ID</th><th>Status</th></tr>` +
		tile.files.map((f) => html`<tr><td>${f.kind}</td><td>${f.fdid || '–'}</td><td class="${f.status === 'ok' ? 'ok' : f.status === 'none' ? '' : 'bad'}">${f.status}</td></tr>`).join('');
	$('tile-errors').innerHTML = tile.errors.map((e) => html`<li>${e}</li>`).join('');
	setStatus(`Read tile ${tile.x}_${tile.y} in ${tile.timeMs} ms`);
}
