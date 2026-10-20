import type { Image } from '../formats/blp';
import type { FileStatus } from '../casc/storage';
import type { AsyncStorageApi } from '../worker/protocol';
import { listfileDate, refreshListfile, tilesetListfile } from './listfile';
import { textureName } from './baseTextures';

/**
 * The texture asset browser (spec 7.3, Phase 2's texture-only cut): the tileset textures of the
 * listfile with substring/token search and lazy thumbnails decoded in the worker. Files whose
 * data is not in the local install show greyed and cannot be picked (spec 7.1). Clicking an entry
 * selects it as the paint brush.
 */

interface Item {
	fdid: number;
	path: string;
	/** "elwynn / elwynngrassbase01" for tileset/elwynn/elwynngrassbase01.blp. */
	label: string;
	status: FileStatus;
	element: HTMLButtonElement;
	canvas: HTMLCanvasElement;
	drawn: boolean;
}

/** How many matches are put in the panel at once; search narrows the rest. */
const MAX_SHOWN = 400;
const THUMB = 56;
/** Thumbnails decoded per worker batch. */
const BATCH = 16;

/** Decoded thumbnails, kept across scenes for the session. */
const thumbCache = new Map<number, Image | null>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class TextureBrowser {
	private items: Item[] = [];
	private readonly observer: IntersectionObserver;
	private readonly queue: Item[] = [];
	private loadingThumbs = false;
	private selected: number;
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		selected: number,
		private readonly onPick: (fdid: number) => void,
		private readonly onNotice: (text: string) => void,
	) {
		this.selected = selected;
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const item = this.items.find((i) => i.element === e.target);
				if (item && !item.drawn) this.queue.push(item);
			}
			void this.drainThumbnails();
		}, { root: $('texture-grid') });
		$<HTMLInputElement>('texture-search').value = '';
		this.wire();
		void this.loadEntries(false);
	}

	private wire(): void {
		$('texture-search').oninput = () => this.renderList();
		$('texture-refresh').onclick = () => void this.loadEntries(true);
	}

	private async loadEntries(refresh: boolean): Promise<void> {
		$('texture-count').textContent = 'Loading the texture list…';
		let entries: { fdid: number; path: string }[];
		try {
			entries = await (refresh ? refreshListfile((t) => ($('texture-count').textContent = t)) : tilesetListfile((t) => ($('texture-count').textContent = t)));
		} catch (e) {
			// No listfile (offline, or the fetch failed): fall back to the scene's own palette.
			this.onNotice(`The listfile couldn't be loaded: ${e instanceof Error ? e.message : e}. Showing only this scene's textures.`);
			entries = [];
		}
		if (this.disposed) return;
		const fallback = entries.length === 0;
		if (fallback) {
			const seen = new Set<number>();
			for (const fdid of [this.selected, ...fallbackFdids()]) {
				if (fdid && !seen.has(fdid)) {
					seen.add(fdid);
					entries.push({ fdid, path: `tileset/${textureName(fdid).toLowerCase()}.blp` });
				}
			}
		}
		let statuses: FileStatus[] = [];
		try {
			statuses = await this.storage.fileStatus(entries.map((e) => e.fdid));
		} catch {
			statuses = entries.map(() => 'ok');
		}
		if (this.disposed) return;
		// Only textures the opened root knows stay listed (spec 7.1); not-local ones stay, greyed.
		this.items = entries
			.map((e, i) => this.makeItem(e.fdid, e.path, statuses[i]))
			.filter((item) => fallback || item.status !== 'unknown');
		if (!fallback) {
			const date = await listfileDate();
			$('texture-refresh').title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		}
		this.renderList();
	}

	private makeItem(fdid: number, path: string, status: FileStatus): Item {
		const element = document.createElement('button');
		element.className = 'texture-item';
		const parts = path.replace(/\.blp$/, '').split('/');
		const label = parts.slice(1).join(' / ');
		const canvas = document.createElement('canvas');
		canvas.width = THUMB;
		canvas.height = THUMB;
		const name = document.createElement('span');
		name.textContent = label;
		element.append(canvas, name);
		element.title = status === 'not-local' ? `${path}\nNot downloaded in your install yet` : path;
		if (status !== 'ok') {
			element.classList.add('greyed');
			element.disabled = status === 'not-local' || status === 'no-encoding';
		}
		element.addEventListener('click', () => {
			this.selected = fdid;
			this.onPick(fdid);
			this.syncSelection();
		});
		return { fdid, path, label, status, element, canvas, drawn: false };
	}

	/** Fills the grid with what matches the search, up to the cap. */
	private renderList(): void {
		const grid = $('texture-grid');
		const tokens = $<HTMLInputElement>('texture-search').value.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = this.items.filter((i) => tokens.every((t) => i.path.includes(t)));
		const shown = matches.slice(0, MAX_SHOWN);
		grid.replaceChildren(...shown.map((i) => i.element));
		for (const item of shown) if (!item.drawn) this.observer.observe(item.element);
		$('texture-count').textContent =
			matches.length > shown.length ? `Showing ${shown.length} of ${matches.length} — search to narrow` : `${matches.length} textures`;
		this.syncSelection();
	}

	private syncSelection(): void {
		for (const item of this.items) item.element.classList.toggle('active', item.fdid === this.selected);
	}

	/** Decodes queued thumbnails in worker batches and draws them. */
	private async drainThumbnails(): Promise<void> {
		if (this.loadingThumbs) return;
		this.loadingThumbs = true;
		try {
			while (this.queue.length && !this.disposed) {
				const batch = this.queue.splice(0, BATCH).filter((i) => !i.drawn);
				const need = batch.filter((i) => !thumbCache.has(i.fdid) && i.status === 'ok');
				if (need.length) {
					const images = await this.storage.loadThumbnails(need.map((i) => i.fdid), 128);
					need.forEach((item, k) => thumbCache.set(item.fdid, images[k]));
				}
				for (const item of batch) this.draw(item);
			}
		} catch {
			// Thumbnails are decoration; the names still work.
		} finally {
			this.loadingThumbs = false;
		}
	}

	private draw(item: Item): void {
		item.drawn = true;
		this.observer.unobserve(item.element);
		const image = thumbCache.get(item.fdid);
		if (!image) return;
		const ctx = item.canvas.getContext('2d');
		if (!ctx) return;
		const pixels = new Uint8ClampedArray(image.width * image.height * 4);
		pixels.set(image.rgba.subarray(0, pixels.length));
		const data = new ImageData(pixels, image.width, image.height);
		const off = new OffscreenCanvas(image.width, image.height);
		off.getContext('2d')!.putImageData(data, 0, 0);
		ctx.drawImage(off, 0, 0, THUMB, THUMB);
	}

	/** A texture's listfile label, for the "Painting with…" line; null when it isn't listed. */
	labelOf(fdid: number): string | null {
		return this.items.find((i) => i.fdid === fdid)?.label ?? null;
	}

	/** The selected texture changed from outside (another scene opened). */
	select(fdid: number): void {
		this.selected = fdid;
		this.syncSelection();
	}

	dispose(): void {
		this.disposed = true;
		this.observer.disconnect();
		this.queue.length = 0;
		$('texture-grid').replaceChildren();
		$('texture-search').oninput = null;
		$('texture-refresh').onclick = null;
	}
}

/** The starter textures, for the fallback list when there is no listfile. */
function fallbackFdids(): number[] {
	return [187138, 187127, 188990, 188576, 187018, 186901, 188824, 189020];
}
