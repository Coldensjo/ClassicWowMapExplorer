import type { FileStatus } from '../casc/storage';
import type { ObjectKind } from '../explorer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import {
	assetGrid,
	assetTile,
	el,
	floatingWindow,
	iconButton,
	segmentedControl,
	setAssetTileLayout,
	setAssetTileSelected,
	setSliderValue,
	slider,
	textInput,
	type AssetTileHandle,
	type FloatingWindowHandle,
	type SliderHandle,
} from '../ui';
import { listfile, listfileDate, refreshListfile, type ListfileEntry } from './listfile';
import { ModelThumbs } from './modelThumbs';
import { applyGridView, COLUMNS_BY_SCALE, loadScale, loadView, saveScale, saveView, tileLayout, viewToggle, type BrowserView } from './browserView';

/** What the Place tool drops on a click: a model picked from the browser (spec 7.8). */
export interface PlaceAsset {
	kind: ObjectKind;
	fdid: number;
	label: string;
}

interface Item {
	fdid: number;
	path: string;
	/** "trees / elwynntreecanopy04" for the deep world paths. */
	label: string;
	status: FileStatus;
}

/** How many matches are put in the grid at once; search narrows the rest. */
const MAX_SHOWN = 200;
const STORAGE_KEY = 'wdb.window.object-browser';
const SCALE_KEY = 'wdb.object-browser.scale';
const VIEW_KEY = 'wdb.object-browser.view';
/** How long the "click in the scene" toast stays after a pick. */
const TOAST_MS = 4000;
/** Model thumbnails rendered at most once per session beyond the IndexedDB cache. */
const sessionThumbs = new Map<string, string | null>();

/**
 * The Object browser window (spec 7.3; design in src/ui/specs/object-browser.md): a floating
 * window, shown only while the Place tool is active, with the doodad and building tabs of the
 * listfile, substring/token search, a tile-size slider and lazy 3D thumbnails rendered offscreen
 * and cached by build. Files whose data is not in the local install show dimmed and cannot be
 * picked (spec 7.1). Clicking a tile arms it as the Place tool's asset and a toast in the window
 * says to click in the scene; clicking the armed tile again disarms it.
 */
export class ModelBrowser {
	private readonly window: FloatingWindowHandle;
	private readonly thumbs: ModelThumbs;
	private readonly search: HTMLInputElement;
	private readonly scale: SliderHandle;
	private readonly grid: HTMLDivElement;
	private readonly count: HTMLElement;
	private readonly picked: HTMLElement;
	private readonly refresh: HTMLButtonElement;
	private readonly toast: HTMLDivElement;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;
	/** Tile size, 1 (smallest) to 3: the grid's columns, or the list's picture size. */
	private scaleStop = loadScale(SCALE_KEY);
	/** The list as a grid of tiles or a list of rows. */
	private view: BrowserView = loadView(VIEW_KEY);

	private readonly items: Record<ObjectKind, Item[]> = { m2: [], wmo: [] };
	private readonly loadedTabs = new Set<ObjectKind>();
	private tab: ObjectKind = 'm2';
	private readonly observer: IntersectionObserver;
	private readonly pending = new Map<Element, Item>();
	/** The tiles in the grid, by file, so the selection mark can move without a rebuild. */
	private readonly tiles = new Map<number, AssetTileHandle>();
	private selected: PlaceAsset | null = null;
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly onPick: (asset: PlaceAsset | null) => void,
		private readonly onNotice: (text: string) => void,
	) {
		this.thumbs = new ModelThumbs(storage, build);
		this.window = floatingWindow({
			title: 'Object browser',
			id: 'object-browser',
			defaultRect: { right: 28, y: topBarHeight() + 10, width: 360, height: 487 },
			minWidth: 300,
			minHeight: 240,
			storageKey: STORAGE_KEY,
		});
		this.window.show(false);

		const tabs = segmentedControl({
			name: 'object-browser-kind',
			label: 'Asset kind',
			value: 'm2',
			options: [
				{ value: 'm2', label: 'Doodads', title: 'M2 doodads under world/' },
				{ value: 'wmo', label: 'Buildings', title: 'WMO buildings (root files)' },
			],
			onChange: (value) => this.setTab(value as ObjectKind),
		});
		const views = viewToggle('object-browser-view', this.view, (v) => this.setView(v));
		const search = textInput({ ariaLabel: 'Search models', type: 'search', icon: 'search', placeholder: 'Search… e.g. elwynn tree', autocomplete: 'off', spellcheck: false, size: 'sm', onInput: () => this.renderList() });
		this.search = search.input;
		this.scale = slider({ ariaLabel: 'Tile size', value: this.scaleStop, min: 1, max: 3, stops: 3, showInput: false, size: 'sm', onInput: (v) => this.setScale(v) });
		const smaller = iconButton({ icon: 'minus', label: 'Smaller tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop - 1) });
		const larger = iconButton({ icon: 'plus', label: 'Larger tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop + 1) });
		const tools = el('div', { class: 'asset-browser-tools' }, views.root, search.root, el('div', { class: 'asset-browser-scale', role: 'group', 'aria-label': 'Tile size' }, smaller, this.scale.root, larger));
		this.grid = assetGrid(COLUMNS_BY_SCALE[this.scaleStop - 1], { 'aria-label': 'Models' });
		applyGridView(this.grid, this.view, this.scaleStop);
		this.grid.classList.add('asset-browser-grid', 'ds-scroll');
		this.count = el('span', { class: 'asset-browser-count' });
		this.picked = el('span', { class: 'asset-browser-picked' });
		this.refresh = iconButton({ icon: 'reset', label: 'Fetch the listfile afresh', variant: 'ghost', size: 'xs', onClick: () => void this.loadEntries(this.tab, true) });
		const footer = el('div', { class: 'asset-browser-footer' }, this.count, this.refresh, this.picked);
		// The selection toast the design draws at the window's bottom (Toast, "Show selection toast?").
		this.toast = el('div', { class: 'ds-toast asset-browser-toast', role: 'status', hidden: true }, el('p', { class: 'ds-toast-message' }, 'Click in the scene to place the selected object.'));
		this.toast.addEventListener('click', () => this.hideToast());
		this.window.body.append(el('div', { class: 'asset-browser-main' }, tabs.root, tools, el('div', { class: 'asset-browser-grid-wrap' }, this.grid, this.toast), footer));

		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const item = this.pending.get(e.target);
				if (item) void this.drawThumb(e.target as HTMLElement, item);
				this.observer.unobserve(e.target);
				this.pending.delete(e.target);
			}
		}, { root: this.grid });
		this.syncPicked();
		this.setTab('m2');
	}

	/** Shows the window (the Place tool is active) or hides it. */
	setVisible(on: boolean): void {
		this.window.show(on);
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

	/** Lays the grid and its tiles out for the view and tile size. */
	private applyView(): void {
		applyGridView(this.grid, this.view, this.scaleStop);
		const { layout, pictureSize } = tileLayout(this.view, this.scaleStop);
		for (const tile of this.tiles.values()) setAssetTileLayout(tile.root, layout, pictureSize);
	}

	// ---- Tabs and the list ----

	private setTab(tab: ObjectKind): void {
		this.tab = tab;
		if (!this.loadedTabs.has(tab)) {
			this.loadedTabs.add(tab);
			void this.loadEntries(tab, false);
		} else {
			this.renderList();
		}
	}

	private async loadEntries(kind: ObjectKind, refresh: boolean): Promise<void> {
		this.count.textContent = 'Loading the model list…';
		const list = kind === 'm2' ? 'doodad' : 'wmo';
		let entries: ListfileEntry[] = [];
		try {
			const progress = (t: string) => (this.count.textContent = t);
			entries = await (refresh ? refreshListfile(progress, list) : listfile(list, progress));
		} catch (e) {
			this.onNotice(`The listfile couldn't be loaded: ${e instanceof Error ? e.message : e}. Doodads and buildings need it to browse.`);
		}
		if (this.disposed) return;
		let statuses: FileStatus[] = [];
		try {
			statuses = await this.storage.fileStatus(entries.map((e) => e.fdid));
		} catch {
			statuses = entries.map(() => 'ok');
		}
		if (this.disposed) return;
		// Only files the opened root knows stay listed (spec 7.1); not-local ones stay, dimmed.
		this.items[kind] = entries.flatMap((e, i) => {
			if (statuses[i] === 'unknown') return [];
			const parts = e.path.replace(/\.(m2|wmo)$/, '').split('/');
			return [{ fdid: e.fdid, path: e.path, label: parts.slice(-2).join(' / '), status: statuses[i] }];
		});
		const date = await listfileDate(list);
		this.refresh.title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		if (this.tab === kind) this.renderList();
	}

	/** Fills the grid with what matches the search, up to the cap. */
	private renderList(): void {
		this.observer.disconnect();
		this.pending.clear();
		this.tiles.clear();
		const tokens = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = this.items[this.tab].filter((i) => tokens.every((t) => i.path.includes(t)));
		const shown = matches.slice(0, MAX_SHOWN);
		this.grid.replaceChildren(...shown.map((item) => this.makeTile(item).root));
		const noun = this.tab === 'm2' ? 'doodad' : 'building';
		this.count.textContent =
			matches.length > shown.length ? `Showing ${shown.length} of ${matches.length.toLocaleString()} — search to narrow` : `${matches.length.toLocaleString()} ${noun}${matches.length === 1 ? '' : 's'}`;
	}

	private makeTile(item: Item): AssetTileHandle {
		const img = document.createElement('img');
		img.alt = '';
		img.decoding = 'async';
		const tile = assetTile({
			label: item.label,
			title: item.status === 'not-local' ? `${item.path}\nNot downloaded in your install yet` : item.path,
			picture: img,
			selected: this.isSelected(item),
			disabled: item.status !== 'ok',
			...tileLayout(this.view, this.scaleStop),
			onActivate: () => this.pick(item),
		});
		this.tiles.set(item.fdid, tile);
		if (item.status === 'ok') {
			const cached = sessionThumbs.get(`${this.tab}:${item.fdid}`);
			if (cached) img.src = cached;
			else if (cached === undefined) {
				this.pending.set(tile.root, item);
				this.observer.observe(tile.root);
			}
		}
		return tile;
	}

	private isSelected(item: Item): boolean {
		return this.selected !== null && this.selected.kind === this.tab && this.selected.fdid === item.fdid;
	}

	/** Arms a model for placing, or disarms it when it is the armed one already. */
	private pick(item: Item): void {
		this.selected = this.isSelected(item) ? null : { kind: this.tab, fdid: item.fdid, label: item.label };
		this.onPick(this.selected);
		this.syncSelection();
		if (this.selected) this.showToast();
		else this.hideToast();
	}

	private syncSelection(): void {
		for (const [fdid, tile] of this.tiles) setAssetTileSelected(tile.root, this.selected !== null && this.selected.kind === this.tab && this.selected.fdid === fdid);
		this.syncPicked();
	}

	private syncPicked(): void {
		this.picked.textContent = this.selected ? `Placing ${this.selected.label}` : 'Nothing picked yet';
	}

	private showToast(): void {
		this.toast.hidden = false;
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => this.hideToast(), TOAST_MS);
	}

	private hideToast(): void {
		this.toast.hidden = true;
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastTimer = null;
	}

	// ---- Thumbnails ----

	private async drawThumb(element: HTMLElement, item: Item): Promise<void> {
		const kind = this.tab;
		const key = `${kind}:${item.fdid}`;
		if (sessionThumbs.has(key)) return;
		sessionThumbs.set(key, null);
		try {
			const bytes = await this.thumbs.thumbnail(kind, item.fdid);
			if (!bytes || this.disposed) return;
			const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
			sessionThumbs.set(key, url);
			const img = element.querySelector('img');
			if (img && element.isConnected) img.src = url;
		} catch {
			// Thumbnails are decoration; the names still work.
		}
	}

	dispose(): void {
		this.disposed = true;
		this.hideToast();
		this.observer.disconnect();
		this.pending.clear();
		this.thumbs.dispose();
		this.window.dispose();
	}
}

/** The editor's top bar height, so the window opens just under it. */
function topBarHeight(): number {
	return document.getElementById('editor-bar')?.offsetHeight ?? 0;
}
