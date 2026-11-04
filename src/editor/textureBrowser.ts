import type { Image } from '../formats/blp';
import type { FileStatus } from '../casc/storage';
import type { AsyncStorageApi } from '../worker/protocol';
import {
	assetGrid,
	assetTile,
	button,
	el,
	floatingWindow,
	icon,
	iconButton,
	loading,
	setAssetTileDisabled,
	setAssetTileLayout,
	setAssetTileSelected,
	setSliderValue,
	slider,
	textInput,
	type AssetTileHandle,
	type FloatingWindowHandle,
	type SliderHandle,
} from '../ui';
import { listfileDate, refreshListfile, tilesetListfile } from './listfile';
import { browserWindowRect } from './windowDefaults';
import { applyGridView, COLUMNS_BY_SCALE, loadScale, loadView, saveScale, saveView, tileLayout, viewToggle, type BrowserView } from './browserView';
import { BASE_TEXTURES, textureName } from './baseTextures';

/**
 * The Texture browser window (spec 7.3 and 7.5; design in src/ui/specs/texture-browser.md): a
 * floating window, shown only while the Paint tool is active, holding the sampled-chunk section
 * and the listfile's tileset textures with search, a tile-size slider and lazy thumbnails decoded
 * in the worker. Files whose data is not in the local install show dimmed and cannot be picked
 * (spec 7.1). Clicking a tile selects it as the paint brush; clicking the selected tile again
 * leaves no texture selected, and the brush then refuses to paint until one is picked.
 *
 * The browser owns the window and its DOM; the editor panels tell it when sampling starts and
 * stops and hand it each sample's textures, and it asks them to arm a sample.
 *
 * In the Paint tool's Swap texture mode the same window is the **Texture swap** window
 * (src/ui/specs/texture-swap.md §4.2): two slots above the sampler, the existing texture and its
 * replacement, each an asset tile. Clicking a slot makes it active and shows its pickers (the
 * sampler for Existing; the sampler and the browser for Replacement); a pick fills the slot and
 * moves on to the other if it is empty, and with both filled the window shrinks to the slots.
 * The slots' FileDataIDs live in the editor's paint settings, where the stroke reads them; the
 * active slot is this window's own state.
 */

interface Item {
	fdid: number;
	path: string;
	/** "elwynn / elwynngrassbase01" for tileset/elwynn/elwynngrassbase01.blp. */
	label: string;
	status: FileStatus;
	tile: AssetTileHandle;
	canvas: HTMLCanvasElement;
	drawn: boolean;
}

/** What the sampled section shows. */
type SampleState = { kind: 'unsampled' } | { kind: 'sampling' } | { kind: 'results'; items: Item[] };

/** The Texture swap window's two slots. */
export type SwapSlot = 'existing' | 'replacement';

/** Where the swap slots' textures live: the editor's paint settings, read here, written by the panels. */
export interface SwapSlots {
	readonly swapFrom: number;
	readonly swapTo: number;
}

/** How many matches are put in the grid at once; search narrows the rest. */
const MAX_SHOWN = 400;
/** Thumbnail pixels, enough for the largest tile. */
const THUMB = 128;
/** Thumbnails decoded per worker batch. */
const BATCH = 16;
const STORAGE_KEY = 'wdb.window.texture-browser.2'; // .2: the default moved to the bottom left on 2026-10-30
const SCALE_KEY = 'wdb.texture-browser.scale.2'; // .2: the default moved to the middle stop on 2026-10-30
const VIEW_KEY = 'wdb.texture-browser.view';
/**
 * The window's least height while the Replacement slot shows the sampler and the browser
 * together (texture-swap.md §4.4), so the grid keeps a couple of rows of tiles.
 */
const SWAP_MIN_HEIGHT = 790;

/** Decoded thumbnails, kept across scenes for the session. */
const thumbCache = new Map<number, Image | null>();

export class TextureBrowser {
	private readonly window: FloatingWindowHandle;
	private readonly search: HTMLInputElement;
	private readonly scale: SliderHandle;
	private readonly grid: HTMLDivElement;
	private readonly count: HTMLElement;
	private readonly picked: HTMLElement;
	private readonly refresh: HTMLButtonElement;
	private readonly sampleSection: HTMLElement;
	private readonly sampleBody: HTMLDivElement;
	private readonly sampleToggle: HTMLButtonElement;
	private sampleOpen = true;
	private readonly main: HTMLDivElement;
	/** The Texture swap slots (texture-swap.md §4.2), shown only in swap mode. */
	private readonly slotsSection: HTMLElement;
	private readonly slotTiles: Record<SwapSlot, { tile: AssetTileHandle; canvas: HTMLCanvasElement }>;
	private swapMode = false;
	private activeSlot: SwapSlot | null = null;
	/** Tile size, 1 (smallest) to 3: the grid's columns, or the list's picture size. */
	private scaleStop = loadScale(SCALE_KEY);
	/** The list as a grid of tiles or a list of rows. */
	private view: BrowserView = loadView(VIEW_KEY);
	private sample: SampleState = { kind: 'unsampled' };
	/** The result shown before a sample was armed, to go back to when it is cancelled. */
	private lastResults: Item[] | null = null;

	private items: Item[] = [];
	private readonly observer: IntersectionObserver;
	private readonly queue: Item[] = [];
	private loadingThumbs = false;
	/** The selected texture, or 0 for none. */
	private selected: number;
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		selected: number,
		private readonly slots: SwapSlots,
		private readonly onPick: (fdid: number) => void,
		/** A swap slot was filled, or cleared (fdid 0); the owner stores it. */
		private readonly onSwapPick: (slot: SwapSlot, fdid: number) => void,
		private readonly onNotice: (text: string) => void,
		/** Asked to arm (true) or disarm (false) the next ground click as a chunk sample. */
		private readonly onSampleRequest: (on: boolean) => void,
	) {
		this.selected = selected;
		this.window = floatingWindow({
			title: 'Texture browser',
			id: 'texture-browser',
			defaultRect: browserWindowRect(),
			minWidth: 300,
			minHeight: 240,
			storageKey: STORAGE_KEY,
		});
		this.window.show(false);

		// The swap slots: a heading over a tile for each, an arrow between them.
		const slot = (which: SwapSlot, heading: string) => {
			const canvas = document.createElement('canvas');
			canvas.width = THUMB;
			canvas.height = THUMB;
			const tile = assetTile({ label: 'Empty', picture: canvas, onActivate: () => this.setActiveSlot(this.activeSlot === which ? null : which) });
			const column = el('div', { class: 'texture-swap-slot' }, el('h3', { class: 'texture-swap-slot-heading' }, heading), tile.root);
			return { column, tile, canvas };
		};
		const existing = slot('existing', 'Existing');
		const replacement = slot('replacement', 'Replacement');
		this.slotTiles = { existing, replacement };
		this.slotsSection = el(
			'section',
			{ class: 'texture-swap-slots', 'aria-label': 'Textures to swap', hidden: true },
			existing.column,
			el('span', { class: 'texture-swap-arrow', 'aria-hidden': 'true' }, icon('right', { size: 'md' })),
			replacement.column,
		);

		// Sampled textures: heading row, collapsible body, divider.
		this.sampleToggle = iconButton({ icon: 'up', label: 'Collapse sampled textures', variant: 'ghost', size: 'xs', onClick: () => this.setSampleOpen(!this.sampleOpen) });
		this.sampleToggle.setAttribute('aria-expanded', 'true');
		this.sampleBody = el('div', { class: 'texture-browser-sample-body' });
		this.sampleSection = el(
			'section',
			{ class: 'texture-browser-sample', 'aria-label': 'Sampled textures' },
			el('div', { class: 'texture-browser-sample-head' }, el('h3', { class: 'texture-browser-heading' }, 'Sampled textures'), this.sampleToggle),
			this.sampleBody,
		);

		// The browser: the view toggle, search and tile size, the grid, the footer line.
		const views = viewToggle('texture-browser-view', this.view, (v) => this.setView(v));
		const search = textInput({ ariaLabel: 'Search textures', type: 'search', icon: 'search', placeholder: 'Search… e.g. elwynn grass', autocomplete: 'off', spellcheck: false, size: 'sm', onInput: () => this.renderList() });
		this.search = search.input;
		this.scale = slider({ ariaLabel: 'Tile size', value: this.scaleStop, min: 1, max: 3, stops: 3, showInput: false, size: 'sm', onInput: (v) => this.setScale(v) });
		const smaller = iconButton({ icon: 'minus', label: 'Smaller tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop - 1) });
		const larger = iconButton({ icon: 'plus', label: 'Larger tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop + 1) });
		const tools = el('div', { class: 'asset-browser-tools' }, views.root, search.root, el('div', { class: 'asset-browser-scale', role: 'group', 'aria-label': 'Tile size' }, smaller, this.scale.root, larger));
		this.grid = assetGrid(COLUMNS_BY_SCALE[this.scaleStop - 1], { 'aria-label': 'Textures' });
		applyGridView(this.grid, this.view, this.scaleStop);
		this.grid.classList.add('asset-browser-grid', 'ds-scroll');
		this.count = el('span', { class: 'asset-browser-count' });
		this.picked = el('span', { class: 'asset-browser-picked' });
		this.refresh = iconButton({ icon: 'reset', label: 'Fetch the listfile afresh', variant: 'ghost', size: 'xs', onClick: () => void this.loadEntries(true) });
		// Count and refresh share the first line; the picked texture wraps onto its own.
		const footer = el('div', { class: 'asset-browser-footer' }, this.count, this.refresh, this.picked);
		this.main = el('div', { class: 'asset-browser-main' }, tools, el('div', { class: 'asset-browser-grid-wrap' }, this.grid), footer);
		this.window.body.append(this.slotsSection, this.sampleSection, this.main);

		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const item = this.items.find((i) => i.tile.root === e.target);
				if (item && !item.drawn) this.queue.push(item);
			}
			void this.drainThumbnails();
		}, { root: this.grid });

		this.renderSample();
		this.syncSlots();
		this.syncPicked();
		void this.loadEntries(false);
	}

	/** Shows the window (the Paint tool is active) or hides it. */
	setVisible(on: boolean): void {
		this.window.show(on);
	}

	// ---- Texture swap (texture-swap.md) ----

	/** Makes the window the Texture swap window, or the Texture browser again. */
	setSwapMode(on: boolean): void {
		if (on === this.swapMode) return;
		this.swapMode = on;
		this.activeSlot = null;
		this.syncSwap();
	}

	/** Activates a slot (its pickers appear), or none (the browser hides and the window shrinks). */
	setActiveSlot(slot: SwapSlot | null): void {
		if (slot === this.activeSlot) return;
		this.activeSlot = slot;
		this.syncSwap();
	}

	/** Deactivates the active slot (Esc); false when there was none. */
	deactivateSlot(): boolean {
		if (!this.activeSlot) return false;
		this.setActiveSlot(null);
		return true;
	}

	/** The texture a tile shows as picked: the active slot's in swap mode, else the brush's. */
	private currentPick(): number {
		if (!this.swapMode) return this.selected;
		return this.activeSlot === 'existing' ? this.slots.swapFrom : this.activeSlot === 'replacement' ? this.slots.swapTo : 0;
	}

	private fdidOf(slot: SwapSlot): number {
		return slot === 'existing' ? this.slots.swapFrom : this.slots.swapTo;
	}

	/**
	 * Lays the window out for the mode and the active slot (§4.2's table): the slots in swap mode;
	 * the sampler for an active slot, held open for Existing; the browser for Replacement; the
	 * window hugging the slots and sampler, or at least tall enough for the grid too.
	 */
	private syncSwap(): void {
		const swap = this.swapMode;
		const active = this.activeSlot;
		this.slotsSection.hidden = !swap;
		this.sampleSection.hidden = swap && active === null;
		this.main.hidden = swap && active !== 'replacement';
		this.applySampleOpen();
		this.window.setTitle(swap ? 'Texture swap' : 'Texture browser');
		this.window.setHeightFit(!swap ? null : active === 'replacement' ? { minHeight: SWAP_MIN_HEIGHT } : 'hug');
		// A sample armed while the sampler is out of sight would take the next ground click unseen.
		if (this.sampleSection.hidden && this.sample.kind === 'sampling') this.onSampleRequest(false);
		this.syncSlots();
		this.syncSelection();
		this.syncSampleAvailability();
	}

	/** The slots' tiles: active is selected; filled shows the thumbnail and name, empty the fill. */
	private syncSlots(): void {
		for (const slot of ['existing', 'replacement'] as const) {
			const { tile, canvas } = this.slotTiles[slot];
			const fdid = this.fdidOf(slot);
			const listed = this.items.find((i) => i.fdid === fdid);
			const name = fdid ? (listed?.label ?? textureName(fdid)) : 'Empty';
			tile.label.textContent = name;
			tile.root.title = fdid ? (listed?.path ?? name) : `${slot === 'existing' ? 'Existing' : 'Replacement'} texture: none chosen yet`;
			setAssetTileSelected(tile.root, this.activeSlot === slot);
			this.paintThumbnail(canvas, fdid);
			if (fdid && !thumbCache.has(fdid) && (listed?.status ?? 'ok') === 'ok') {
				void this.loadThumbnail(fdid).then(() => {
					if (!this.disposed && this.fdidOf(slot) === fdid) this.paintThumbnail(canvas, fdid);
				});
			}
		}
	}

	/** Sampled tiles can fill the Existing slot even when their file is not local (§2.1 #16). */
	private syncSampleAvailability(): void {
		if (this.sample.kind !== 'results') return;
		const anyGoes = this.swapMode && this.activeSlot === 'existing';
		for (const item of this.sample.items) setAssetTileDisabled(item.tile.root, !anyGoes && (item.status === 'not-local' || item.status === 'no-encoding'));
	}

	// ---- View and tile size ----

	private setScale(value: number): void {
		const scale = Math.min(3, Math.max(1, Math.round(value)));
		this.scaleStop = scale;
		setSliderValue(this.scale.root, scale);
		this.applyView();
		saveScale(SCALE_KEY, scale);
	}

	private setView(view: BrowserView): void {
		this.view = view;
		this.applyView();
		saveView(VIEW_KEY, view);
	}

	/** Lays the grid and its tiles out for the view and tile size (the sampled tiles stay a grid). */
	private applyView(): void {
		applyGridView(this.grid, this.view, this.scaleStop);
		const { layout, pictureSize } = tileLayout(this.view, this.scaleStop);
		for (const item of this.items) setAssetTileLayout(item.tile.root, layout, pictureSize);
	}

	// ---- The list ----

	private async loadEntries(refresh: boolean): Promise<void> {
		this.count.textContent = 'Loading the texture list…';
		let entries: { fdid: number; path: string }[];
		try {
			const progress = (t: string) => (this.count.textContent = t);
			entries = await (refresh ? refreshListfile(progress) : tilesetListfile(progress));
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
		// Only textures the opened root knows stay listed (spec 7.1); not-local ones stay, dimmed.
		this.items = entries
			.map((e, i) => this.makeItem(e.fdid, e.path, statuses[i]))
			.filter((item) => fallback || item.status !== 'unknown');
		if (!fallback) {
			const date = await listfileDate();
			this.refresh.title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		}
		this.renderList();
		this.syncSlots();
		this.syncPicked();
	}

	/** A tile for the list (laid out for the current view) or, with `inList` false, the sampled grid. */
	private makeItem(fdid: number, path: string, status: FileStatus, inList = true): Item {
		const parts = path.replace(/\.blp$/, '').split('/');
		const label = parts.slice(1).join(' / ');
		const canvas = document.createElement('canvas');
		canvas.width = THUMB;
		canvas.height = THUMB;
		const tile = assetTile({
			label,
			title: status === 'not-local' ? `${path}\nNot downloaded in your install yet` : path,
			picture: canvas,
			selected: fdid === this.currentPick(),
			disabled: status === 'not-local' || status === 'no-encoding',
			...(inList ? tileLayout(this.view, this.scaleStop) : {}),
			onActivate: () => this.pick(fdid),
		});
		if (status !== 'ok') tile.root.dataset.unavailable = '';
		return { fdid, path, label, status, tile, canvas, drawn: false };
	}

	/**
	 * Selects a texture, or un-selects it when it is the selected one already. In swap mode the
	 * pick fills the active slot (or clears it, picked again); the other slot becomes active if
	 * it is empty, and with both filled no slot is, so the pickers go away (§2.1 #4, #11).
	 */
	private pick(fdid: number): void {
		if (this.swapMode) {
			const slot = this.activeSlot;
			if (!slot) return;
			if (this.fdidOf(slot) === fdid) {
				this.onSwapPick(slot, 0);
			} else {
				this.onSwapPick(slot, fdid);
				const other: SwapSlot = slot === 'existing' ? 'replacement' : 'existing';
				this.activeSlot = this.fdidOf(other) ? null : other;
			}
			this.syncSwap();
			return;
		}
		this.selected = this.selected === fdid ? 0 : fdid;
		this.onPick(this.selected);
		this.syncSelection();
	}

	/** Fills the grid with what matches the search, up to the cap. */
	private renderList(): void {
		const tokens = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = this.items.filter((i) => tokens.every((t) => i.path.includes(t)));
		const shown = matches.slice(0, MAX_SHOWN);
		this.grid.replaceChildren(...shown.map((i) => i.tile.root));
		for (const item of shown) if (!item.drawn) this.observer.observe(item.tile.root);
		this.count.textContent =
			matches.length > shown.length ? `Showing ${shown.length} of ${matches.length.toLocaleString()} — search to narrow` : `${matches.length.toLocaleString()} texture${matches.length === 1 ? '' : 's'}`;
		this.syncSelection();
	}

	private syncSelection(): void {
		const pick = this.currentPick();
		const sampled = this.sample.kind === 'results' ? this.sample.items : [];
		for (const item of [...this.items, ...sampled]) setAssetTileSelected(item.tile.root, item.fdid === pick);
		this.syncPicked();
	}

	private syncPicked(): void {
		const name = (fdid: number) => this.labelOf(fdid) ?? textureName(fdid);
		this.picked.textContent = this.swapMode
			? this.slots.swapTo ? `Swapping in ${name(this.slots.swapTo)}` : 'No replacement chosen'
			: this.selected ? `Painting with ${name(this.selected)}` : 'No texture selected';
	}

	// ---- Sampled textures (spec 7.5) ----

	private setSampleOpen(open: boolean): void {
		this.sampleOpen = open;
		this.sampleToggle.replaceChildren(icon(open ? 'up' : 'down', { size: 'sm' }));
		this.sampleToggle.setAttribute('aria-label', open ? 'Collapse sampled textures' : 'Expand sampled textures');
		this.sampleToggle.title = this.sampleToggle.getAttribute('aria-label') ?? '';
		this.sampleToggle.setAttribute('aria-expanded', String(open));
		this.applySampleOpen();
	}

	/** The sampler is its only picker while the Existing slot is active, so it is held open then. */
	private applySampleOpen(): void {
		const forced = this.swapMode && this.activeSlot === 'existing';
		this.sampleToggle.hidden = forced;
		this.sampleBody.hidden = !forced && !this.sampleOpen;
	}

	/** The panels armed or disarmed a sample. */
	setSampling(on: boolean): void {
		if (on) {
			if (this.sample.kind === 'results') this.lastResults = this.sample.items;
			this.sample = { kind: 'sampling' };
		} else if (this.sample.kind === 'sampling') {
			this.sample = this.lastResults ? { kind: 'results', items: this.lastResults } : { kind: 'unsampled' };
		}
		this.renderSample();
	}

	/**
	 * Shows a sampled chunk's textures (base first), or the no-textures message for an empty
	 * sample; null clears the section back to unsampled.
	 */
	showSample(fdids: number[] | null): void {
		if (fdids === null) {
			this.sample = { kind: 'unsampled' };
			this.lastResults = null;
			this.renderSample();
			return;
		}
		const seen = new Set<number>();
		const items: Item[] = [];
		for (const fdid of fdids) {
			if (seen.has(fdid)) continue;
			seen.add(fdid);
			const listed = this.items.find((i) => i.fdid === fdid);
			items.push(this.makeItem(fdid, listed?.path ?? `tileset/${textureName(fdid).toLowerCase()}.blp`, listed?.status ?? 'ok', false));
		}
		this.sample = { kind: 'results', items };
		this.lastResults = items;
		this.renderSample();
		this.queue.push(...items);
		void this.drainThumbnails();
	}

	private renderSample(): void {
		const message = (text: string) => el('p', { class: 'texture-browser-sample-text' }, text);
		const again = () => button({ label: 'Sample another chunk', variant: 'outline', size: 'sm', onClick: () => this.onSampleRequest(true) });
		switch (this.sample.kind) {
			case 'unsampled':
				this.sampleBody.replaceChildren(
					message('Sample a chunk in your scene to see textures that are being used.'),
					button({ label: 'Sample chunk', variant: 'primary', size: 'sm', onClick: () => this.onSampleRequest(true) }),
				);
				break;
			case 'sampling':
				this.sampleBody.replaceChildren(
					loading({ label: 'Waiting for a chunk', size: 48 }),
					message('Click a chunk in your scene to sample its textures.'),
					button({ label: 'Cancel (Esc)', variant: 'outline', size: 'sm', onClick: () => this.onSampleRequest(false) }),
				);
				break;
			case 'results': {
				const items = this.sample.items;
				if (items.length === 0) {
					this.sampleBody.replaceChildren(icon('alert', { size: 'lg' }), message('No textures found on the sampled chunk.'), again());
				} else {
					const row = assetGrid(4, { 'aria-label': 'Sampled textures' });
					row.classList.add('texture-browser-sample-grid');
					row.append(...items.map((i) => i.tile.root));
					this.sampleBody.replaceChildren(row, again());
				}
				break;
			}
		}
		this.syncSelection();
		this.syncSampleAvailability();
	}

	// ---- Thumbnails ----

	/** Decodes queued thumbnails in worker batches and draws them. */
	private async drainThumbnails(): Promise<void> {
		if (this.loadingThumbs) return;
		this.loadingThumbs = true;
		try {
			while (this.queue.length && !this.disposed) {
				const batch = this.queue.splice(0, BATCH).filter((i) => !i.drawn);
				const need = batch.filter((i) => !thumbCache.has(i.fdid) && i.status === 'ok');
				if (need.length) {
					const images = await this.storage.loadThumbnails(need.map((i) => i.fdid), THUMB);
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
		this.observer.unobserve(item.tile.root);
		this.paintThumbnail(item.canvas, item.fdid);
	}

	/** Decodes one texture's thumbnail into the cache, for a slot filled before its tile was drawn. */
	private async loadThumbnail(fdid: number): Promise<void> {
		if (thumbCache.has(fdid)) return;
		try {
			const [image] = await this.storage.loadThumbnails([fdid], THUMB);
			thumbCache.set(fdid, image ?? null);
		} catch {
			// Thumbnails are decoration; the name still shows.
		}
	}

	/** Draws the cached thumbnail of a texture into a canvas, or clears it (0, or none cached). */
	private paintThumbnail(canvas: HTMLCanvasElement, fdid: number): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, THUMB, THUMB);
		const image = fdid ? thumbCache.get(fdid) : null;
		if (!image) return;
		const pixels = new Uint8ClampedArray(image.width * image.height * 4);
		pixels.set(image.rgba.subarray(0, pixels.length));
		const data = new ImageData(pixels, image.width, image.height);
		const off = new OffscreenCanvas(image.width, image.height);
		off.getContext('2d')!.putImageData(data, 0, 0);
		ctx.drawImage(off, 0, 0, THUMB, THUMB);
	}

	/** A texture's listfile label; null when it isn't listed. */
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
		this.window.dispose();
	}
}

/** The starter textures, for the fallback list when there is no listfile. */
function fallbackFdids(): number[] {
	return BASE_TEXTURES.map((t) => t.fdid);
}

/** The editor's top bar height, so the window opens just under it. */
