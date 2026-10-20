import type { FileStatus } from '../casc/storage';
import type { ObjectKind } from '../explorer/objects';
import type { AsyncStorageApi } from '../worker/protocol';
import { listfile, listfileDate, refreshListfile, type ListfileEntry } from './listfile';
import { ModelThumbs } from './modelThumbs';

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

/** How many matches are put in the panel at once; search narrows the rest. */
const MAX_SHOWN = 200;
/** Model thumbnails rendered at most once per session beyond the IndexedDB cache. */
const sessionThumbs = new Map<string, string | null>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The doodad and building tabs of the asset browser (spec 7.3): the world models and WMO roots of
 * the listfile with substring/token search and lazy 3D thumbnails rendered offscreen and cached by
 * build. Files whose data is not in the local install show greyed and cannot be picked (spec 7.1).
 * Clicking an entry arms it as the Place tool's asset.
 */
export class ModelBrowser {
	private readonly thumbs: ModelThumbs;
	private readonly items: Record<ObjectKind, Item[]> = { m2: [], wmo: [] };
	private readonly loadedTabs = new Set<ObjectKind>();
	private tab: ObjectKind = 'm2';
	private readonly observer: IntersectionObserver;
	private readonly pending = new Map<Element, Item>();
	private selected: PlaceAsset | null = null;
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly onPick: (asset: PlaceAsset) => void,
		private readonly onNotice: (text: string) => void,
	) {
		this.thumbs = new ModelThumbs(storage, build);
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const item = this.pending.get(e.target);
				if (item) void this.drawThumb(e.target as HTMLElement, item);
				this.observer.unobserve(e.target);
				this.pending.delete(e.target);
			}
		}, { root: $('model-grid') });
		this.wire();
		this.setTab('m2');
	}

	private wire(): void {
		$('model-tab-m2').onclick = () => this.setTab('m2');
		$('model-tab-wmo').onclick = () => this.setTab('wmo');
		$('model-search').oninput = () => this.renderList();
		$('model-refresh').onclick = () => void this.loadEntries(this.tab, true);
	}

	private setTab(tab: ObjectKind): void {
		this.tab = tab;
		$('model-tab-m2').classList.toggle('active', tab === 'm2');
		$('model-tab-wmo').classList.toggle('active', tab === 'wmo');
		if (!this.loadedTabs.has(tab)) {
			this.loadedTabs.add(tab);
			void this.loadEntries(tab, false);
		} else {
			this.renderList();
		}
	}

	private async loadEntries(kind: ObjectKind, refresh: boolean): Promise<void> {
		const counter = $('model-count');
		counter.textContent = 'Loading the model list…';
		const list = kind === 'm2' ? 'doodad' : 'wmo';
		let entries: ListfileEntry[] = [];
		try {
			entries = await (refresh ? refreshListfile((t) => (counter.textContent = t), list) : listfile(list, (t) => (counter.textContent = t)));
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
		// Only files the opened root knows stay listed (spec 7.1); not-local ones stay, greyed.
		this.items[kind] = entries.flatMap((e, i) => {
			if (statuses[i] === 'unknown') return [];
			const parts = e.path.replace(/\.(m2|wmo)$/, '').split('/');
			return [{ fdid: e.fdid, path: e.path, label: parts.slice(-2).join(' / '), status: statuses[i] }];
		});
		const date = await listfileDate(list);
		$('model-refresh').title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		if (this.tab === kind) this.renderList();
	}

	/** Fills the grid with what matches the search, up to the cap. */
	private renderList(): void {
		const grid = $('model-grid');
		this.observer.disconnect();
		this.pending.clear();
		const tokens = $<HTMLInputElement>('model-search').value.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = this.items[this.tab].filter((i) => tokens.every((t) => i.path.includes(t)));
		const shown = matches.slice(0, MAX_SHOWN);
		grid.replaceChildren(...shown.map((item) => this.makeElement(item)));
		$('model-count').textContent =
			matches.length > shown.length ? `Showing ${shown.length} of ${matches.length} — search to narrow` : `${matches.length} ${this.tab === 'm2' ? 'doodads' : 'buildings'}`;
	}

	private makeElement(item: Item): HTMLButtonElement {
		const element = document.createElement('button');
		element.className = 'texture-item';
		const img = document.createElement('img');
		img.width = 56;
		img.height = 56;
		img.alt = '';
		const name = document.createElement('span');
		name.textContent = item.label;
		element.append(img, name);
		element.title = item.status === 'not-local' ? `${item.path}\nNot downloaded in your install yet` : item.path;
		if (item.status !== 'ok') {
			element.classList.add('greyed');
			element.disabled = true;
		} else {
			element.addEventListener('click', () => {
				this.selected = { kind: this.tab, fdid: item.fdid, label: item.label };
				this.onPick(this.selected);
				this.syncSelection();
			});
		}
		if (this.selected && this.selected.kind === this.tab && this.selected.fdid === item.fdid) element.classList.add('active');
		if (item.status === 'ok') {
			const cached = sessionThumbs.get(`${this.tab}:${item.fdid}`);
			if (cached) img.src = cached;
			else if (cached === undefined) {
				this.pending.set(element, item);
				this.observer.observe(element);
			}
		}
		return element;
	}

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

	private syncSelection(): void {
		for (const element of $('model-grid').children) {
			const img = element as HTMLButtonElement;
			img.classList.toggle('active', img.title.startsWith(this.pathOfSelected() ?? '\u0000'));
		}
	}

	private pathOfSelected(): string | null {
		if (!this.selected) return null;
		return this.items[this.selected.kind].find((i) => i.fdid === this.selected!.fdid)?.path ?? null;
	}

	dispose(): void {
		this.disposed = true;
		this.observer.disconnect();
		this.pending.clear();
		this.thumbs.dispose();
		$('model-grid').replaceChildren();
		$('model-search').oninput = null;
		$('model-refresh').onclick = null;
		$('model-tab-m2').onclick = null;
		$('model-tab-wmo').onclick = null;
	}
}
