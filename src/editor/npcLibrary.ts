import type { CreatureDisplaySummary } from '../explorer/npcs';
import type { NpcAppearance, NpcPreset } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';
import {
	assetGrid,
	assetTile,
	button,
	el,
	floatingWindow,
	icon,
	iconButton,
	menu,
	setAssetGridColumns,
	setAssetTileSelected,
	setSliderValue,
	slider,
	textInput,
	tile,
	type AssetTileHandle,
	type FloatingWindowHandle,
	type MenuHandle,
	type MenuItem,
	type SliderHandle,
} from '../ui';
import { listfile, listfileDate, refreshListfile } from './listfile';
import { ModelThumbs } from './modelThumbs';
import { creatureDisplays, type NpcAsset } from './npcs';

/** A model and its skin variants, as Existing NPCs groups them (spec 7.9.2). */
interface CreatureModel {
	fdid: number;
	/** The listfile path, lower case, or "" when the listfile lacks the model. */
	path: string;
	/** "murloc / murloc" for creature/murloc/murloc.m2; "model 125576" without a listfile. */
	label: string;
	variants: CreatureDisplaySummary[];
}

/** Which page of the library shows. */
type View = { kind: 'main' } | { kind: 'local' } | { kind: 'favorites' } | { kind: 'existing' } | { kind: 'variants'; model: CreatureModel };
type ViewKind = View['kind'];

/** A thumbnail to draw into a tile once it scrolls into view. */
interface ThumbJob {
	kind: 'creature' | 'npcPreset';
	fdid: number;
	key: string;
}

/** Model tiles put in the grid at once; search narrows the rest. */
const MAX_MODELS = 120;
/** Tile size stops: the slider's value is the stop, the grid gets its columns. */
const COLUMNS_BY_SCALE = [5, 4, 3];
const DEFAULT_SCALE = 3;
const STORAGE_KEY = 'wdb.window.npc-library';
const SCALE_KEY = 'wdb.npc-library.scale';
const FAVORITES_KEY = 'wdb.npc-library.favorites';
/** How long the "click in the scene" toast stays after a pick. */
const TOAST_MS = 4000;
const HEADINGS: Record<Exclude<ViewKind, 'main' | 'variants'>, string> = { local: 'Local NPCs', favorites: 'Favorites', existing: 'Existing NPCs' };
/** Thumbnails rendered at most once per session beyond the IndexedDB cache. */
const sessionThumbs = new Map<string, string | null>();

/** How a preset's thumbnail is cached: by its look, since its worker handle changes with every edit. */
export function presetThumbKey(preset: NpcPreset): string {
	let h = 2166136261;
	for (const c of JSON.stringify([preset.race, preset.sex, preset.customization, preset.equipment])) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return `preset:${(h >>> 0).toString(16)}`;
}

export interface NpcLibraryHooks {
	/** The worker handle a preset is loaded under (defines it there first). */
	handleOf: (preset: NpcPreset) => number;
	/** Create new NPC: the NPC studio on a blank NPC. */
	onNew: () => void;
	/** Edit: the studio on this preset. */
	onEdit: (preset: NpcPreset) => void;
	/** Remix: the studio on a new NPC prefilled from this preset. */
	onRemixPreset: (preset: NpcPreset) => void;
	/** Remix: the studio on a new NPC prefilled from a pre-baked humanoid display. */
	onRemixDisplay: (displayId: number) => void;
	/** Delete: the caller confirms and removes the preset from the library. */
	onDelete: (preset: NpcPreset) => void;
	onExport: (preset: NpcPreset) => void;
	onImport: (file: File) => void;
}

/**
 * The NPC library window (spec 7.9; design in src/ui/specs/npc-library.md): a floating window,
 * shown only while the NPCs tool is active, with a main view of three doors and a Create new NPC
 * button, and under each door a browser with search, a tile-size slider and a grid of NPC
 * tiles with lazy thumbnails. Local NPCs are the user's custom presets (spec 7.9.3), Existing
 * NPCs every CreatureDisplayInfo entry whose model is in the client, grouped by model with the
 * skins as variants (spec 7.9.2), and Favorites what was starred from either. Clicking a tile
 * arms it as what the NPCs tool places; clicking the armed tile again disarms it. Each tile's
 * "…" menu edits, remixes, favourites, exports or deletes it.
 */
export class NpcLibrary {
	private readonly window: FloatingWindowHandle;
	private readonly thumbs: ModelThumbs;
	private readonly main: HTMLDivElement;
	private readonly browse: HTMLDivElement;
	private readonly heading: HTMLHeadingElement;
	private readonly createSmall: HTMLButtonElement;
	private readonly importInput: HTMLInputElement;
	private readonly search: HTMLInputElement;
	private readonly scale: SliderHandle;
	private readonly grid: HTMLDivElement;
	private readonly empty: HTMLDivElement;
	private readonly count: HTMLElement;
	private readonly pickedLine: HTMLElement;
	private readonly refresh: HTMLButtonElement;
	private readonly toast: HTMLDivElement;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;

	private view: View = { kind: 'main' };
	/** Each view's search text, kept while the user moves between them. */
	private readonly queries: Record<ViewKind, string> = { main: '', local: '', favorites: '', existing: '', variants: '' };
	/** Tile size, 1 (smallest) to 3. */
	private scaleStop = loadScale();
	private models: CreatureModel[] = [];
	private readonly displays = new Map<number, CreatureDisplaySummary>();
	/** Progress text while the creature list loads; null once it is in. */
	private loadingText: string | null = 'Loading the creature list…';
	private presets: NpcPreset[] = [];
	private favorites: NpcAppearance[] = loadFavorites();
	private selected: NpcAsset | null = null;
	/** The tiles in the grid, by appearance key (or `model:<fdid>` for a multi-variant tile). */
	private readonly tiles = new Map<string, AssetTileHandle>();
	/** The tile menus of the current grid, closed and removed on the next render. */
	private menus: MenuHandle[] = [];
	private readonly observer: IntersectionObserver;
	private readonly pending = new Map<Element, ThumbJob>();
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly onPick: (asset: NpcAsset | null) => void,
		private readonly onNotice: (text: string) => void,
		private readonly hooks: NpcLibraryHooks,
	) {
		this.thumbs = new ModelThumbs(storage, build);
		this.window = floatingWindow({
			title: 'NPC library',
			id: 'npc-library',
			defaultRect: { right: 28, y: topBarHeight() + 10, width: 360, height: 487 },
			minWidth: 300,
			minHeight: 240,
			storageKey: STORAGE_KEY,
		});
		this.window.show(false);

		// The hidden file input behind Import .wnpc…
		this.importInput = el('input', { type: 'file', accept: '.wnpc,application/json', hidden: true, 'aria-hidden': 'true' });
		this.importInput.addEventListener('change', () => {
			const file = this.importInput.files?.[0];
			this.importInput.value = '';
			if (file) this.hooks.onImport(file);
		});

		// The main view: three doors and Create new NPC.
		const door = (title: string, description: string | undefined, kind: 'local' | 'favorites' | 'existing') => tile({ title, description, onActivate: () => this.setView({ kind }) });
		const create = button({ label: 'Create new NPC', variant: 'primary', size: 'lg', icon: 'plus' });
		this.attachCreateMenu(create);
		this.main = el(
			'div',
			{ class: 'npc-library-main' },
			door('Local NPCs', 'Created in this scene.', 'local'),
			door('Favorites', undefined, 'favorites'),
			door('Existing NPCs', 'From the game files.', 'existing'),
			el('div', { class: 'npc-library-create' }, create),
		);

		// The sub-views: heading row, search and tile size, the grid, the footer line.
		const back = iconButton({ icon: 'left', label: 'Back', variant: 'secondary', size: 'sm', onClick: () => this.setView(this.view.kind === 'variants' ? { kind: 'existing' } : { kind: 'main' }) });
		this.heading = el('h3', { class: 'npc-library-heading' });
		this.createSmall = iconButton({ icon: 'plus', label: 'Create new NPC', variant: 'primary', size: 'sm' });
		this.attachCreateMenu(this.createSmall);
		const head = el('div', { class: 'npc-library-head' }, back, this.heading, this.createSmall);
		const search = textInput({
			ariaLabel: 'Search NPCs',
			type: 'search',
			icon: 'search',
			placeholder: 'Search for NPCs…',
			autocomplete: 'off',
			spellcheck: false,
			onInput: () => {
				this.queries[this.view.kind] = this.search.value;
				this.renderList();
			},
		});
		this.search = search.input;
		this.scale = slider({ ariaLabel: 'Tile size', value: this.scaleStop, min: 1, max: 3, stops: 3, showInput: false, onInput: (v) => this.setScale(v) });
		const smaller = iconButton({ icon: 'minus', label: 'Smaller tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop - 1) });
		const larger = iconButton({ icon: 'plus', label: 'Larger tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop + 1) });
		const tools = el('div', { class: 'asset-browser-tools' }, search.root, el('div', { class: 'asset-browser-scale', role: 'group', 'aria-label': 'Tile size' }, smaller, this.scale.root, larger));
		this.grid = assetGrid(COLUMNS_BY_SCALE[this.scaleStop - 1], { 'aria-label': 'NPCs' });
		this.grid.classList.add('asset-browser-grid', 'npc-library-grid', 'ds-scroll');
		this.empty = el('div', { class: 'npc-library-empty', hidden: true });
		this.count = el('span', { class: 'asset-browser-count' });
		this.pickedLine = el('span', { class: 'asset-browser-picked' });
		this.refresh = iconButton({ icon: 'reset', label: 'Fetch the listfile afresh', variant: 'ghost', size: 'xs', onClick: () => void this.loadCreatures(true) });
		const footer = el('div', { class: 'asset-browser-footer' }, this.count, this.refresh, this.pickedLine);
		// The selection toast the design draws at the window's bottom (Toast, "Show selection toast?").
		this.toast = el('div', { class: 'ds-toast asset-browser-toast', role: 'status', hidden: true }, el('p', { class: 'ds-toast-message' }, 'Click in the scene to place selected NPC.'));
		this.toast.addEventListener('click', () => this.hideToast());
		this.browse = el('div', { class: 'asset-browser-main', hidden: true }, head, tools, el('div', { class: 'asset-browser-grid-wrap' }, this.grid, this.empty, this.toast), footer);
		this.window.body.append(this.main, this.browse, this.importInput);

		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const job = this.pending.get(e.target);
				if (job) void this.drawThumb(e.target as HTMLElement, job);
				this.observer.unobserve(e.target);
				this.pending.delete(e.target);
			}
		}, { root: this.grid });

		this.syncPicked();
		void this.loadCreatures(false);
	}

	/** Shows the window (the NPCs tool is active) or hides it. */
	setVisible(on: boolean): void {
		this.window.show(on);
		if (!on) this.closeMenus();
	}

	/** The picked appearance, or null. */
	get picked(): NpcAsset | null {
		return this.selected;
	}

	/** Whether a display is a pre-baked humanoid, which Remix can open. */
	isHumanoid(displayId: number): boolean {
		return this.displays.get(displayId)?.humanoid ?? false;
	}

	/** A short description of an appearance for the properties panel. */
	describe(appearance: NpcAppearance): string {
		if (appearance.kind === 'custom') return `Custom: ${this.presets.find((p) => p.id === appearance.presetId)?.name ?? 'a preset of this scene'}`;
		const d = this.displays.get(appearance.displayId);
		const model = d && this.models.find((m) => m.fdid === d.model);
		if (!model) return `Creature display ${appearance.displayId}`;
		return `${model.label} · variant ${model.variants.indexOf(d) + 1} (display ${appearance.displayId})`;
	}

	/** Shows the Local NPCs view (after making or importing a preset). */
	showLocal(): void {
		this.setView({ kind: 'local' });
	}

	// ---- Views ----

	private setView(view: View): void {
		this.view = view;
		this.closeMenus();
		const main = view.kind === 'main';
		this.main.hidden = !main;
		this.browse.hidden = main;
		if (main) {
			this.hideToast();
			return;
		}
		this.heading.textContent = view.kind === 'variants' ? `Variants: ${view.model.label}` : HEADINGS[view.kind];
		this.createSmall.hidden = view.kind !== 'local';
		this.refresh.hidden = view.kind !== 'existing' && view.kind !== 'variants';
		this.search.value = this.queries[view.kind];
		this.renderList();
	}

	/** The create menu on a button: the NPC studio, or a .wnpc import. */
	private attachCreateMenu(anchor: HTMLButtonElement): void {
		menu(anchor, [
			{ label: 'New custom NPC…', icon: 'npc', onSelect: () => this.hooks.onNew() },
			{ label: 'Import .wnpc…', icon: 'download', onSelect: () => this.importInput.click() },
		]);
	}

	// ---- Tile size ----

	private setScale(value: number): void {
		const scale = Math.min(3, Math.max(1, Math.round(value)));
		this.scaleStop = scale;
		setSliderValue(this.scale.root, scale);
		setAssetGridColumns(this.grid, COLUMNS_BY_SCALE[scale - 1]);
		try {
			localStorage.setItem(SCALE_KEY, String(scale));
		} catch {
			// Forgetting the tile size is fine.
		}
	}

	// ---- The creature list (spec 7.9.2) ----

	private async loadCreatures(refresh: boolean): Promise<void> {
		this.setLoading('Loading the creature list…');
		let list: CreatureDisplaySummary[] = [];
		try {
			list = await creatureDisplays(this.storage);
		} catch (e) {
			this.onNotice(`The creature list couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		if (this.disposed) return;
		let paths = new Map<number, string>();
		try {
			const progress = (t: string) => this.setLoading(t);
			const entries = await (refresh ? refreshListfile(progress, 'creature') : listfile('creature', progress));
			paths = new Map(entries.map((e) => [e.fdid, e.path]));
		} catch (e) {
			this.onNotice(`The listfile couldn't be loaded: ${e instanceof Error ? e.message : e}. Creatures are listed by model number.`);
		}
		if (this.disposed) return;
		const byModel = new Map<number, CreatureModel>();
		for (const d of list) {
			this.displays.set(d.id, d);
			let model = byModel.get(d.model);
			if (!model) {
				const path = paths.get(d.model) ?? '';
				const parts = path.replace(/\.m2$/, '').split('/');
				model = { fdid: d.model, path, label: path ? parts.slice(-2).join(' / ') : `model ${d.model}`, variants: [] };
				byModel.set(d.model, model);
			}
			model.variants.push(d);
		}
		this.models = [...byModel.values()].sort((a, b) => a.label.localeCompare(b.label));
		for (const m of this.models) m.variants.sort((a, b) => a.id - b.id);
		const date = await listfileDate('creature');
		this.refresh.title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		this.loadingText = null;
		this.renderList();
	}

	private setLoading(text: string): void {
		this.loadingText = text;
		if (this.view.kind === 'existing' || this.view.kind === 'favorites') this.count.textContent = text;
	}

	// ---- The grid ----

	/** Fills the grid with what the view shows and the search matches. */
	private renderList(): void {
		this.closeMenus();
		this.observer.disconnect();
		this.pending.clear();
		this.tiles.clear();
		const view = this.view;
		if (view.kind === 'main') return;
		const tokens = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
		const matching = (...texts: string[]) => tokens.every((t) => texts.some((text) => text.includes(t)));
		let frames: HTMLElement[] = [];
		let countText = '';
		let emptyText: string | null = null;
		let offerCreate = false;
		switch (view.kind) {
			case 'local': {
				const matches = this.presets.filter((p) => matching(presetName(p).toLowerCase()));
				frames = matches.map((p) => this.makePresetTile(p).frame);
				countText = `${matches.length} custom NPC${matches.length === 1 ? '' : 's'}`;
				if (!this.presets.length) {
					emptyText = "You haven't created any local NPCs yet.";
					offerCreate = true;
				} else if (!matches.length) emptyText = 'No NPCs match your search.';
				break;
			}
			case 'favorites': {
				const entries = this.favoriteEntries().filter((f) => matching(f.label.toLowerCase()));
				frames = entries.map((f) => f.make().frame);
				countText = `${entries.length} favorite${entries.length === 1 ? '' : 's'}`;
				if (!this.favorites.length) emptyText = "You haven't saved any favorites yet.";
				else if (!entries.length && !this.loadingText) emptyText = 'No NPCs match your search.';
				break;
			}
			case 'existing': {
				const matches = this.models.filter((m) => tokens.every((t) => m.path.includes(t) || m.label.includes(t) || m.variants.some((v) => String(v.id) === t)));
				const shown = matches.slice(0, MAX_MODELS);
				frames = shown.map((m) => (m.variants.length === 1 ? this.makeDisplayTile(m, 0, m.label) : this.makeModelTile(m)).frame);
				const displays = matches.reduce((n, m) => n + m.variants.length, 0);
				countText = matches.length > shown.length ? `Showing ${shown.length} of ${matches.length.toLocaleString()} models — search to narrow` : `${matches.length.toLocaleString()} models, ${displays.toLocaleString()} displays`;
				if (!matches.length && !this.loadingText) emptyText = 'No NPCs match your search.';
				break;
			}
			case 'variants': {
				const model = view.model;
				const indices = model.variants.map((_, i) => i).filter((i) => matching(`variant ${i + 1}`, String(model.variants[i].id)));
				frames = indices.map((i) => this.makeDisplayTile(model, i, `variant ${i + 1}`).frame);
				countText = `${indices.length} variant${indices.length === 1 ? '' : 's'} of ${model.label}`;
				if (!indices.length) emptyText = 'No variants match your search.';
				break;
			}
		}
		this.grid.replaceChildren(...frames);
		this.grid.hidden = emptyText !== null;
		this.renderEmpty(emptyText, offerCreate);
		this.count.textContent = this.loadingText && (view.kind === 'existing' || view.kind === 'favorites') ? this.loadingText : countText;
		this.syncSelection();
	}

	private renderEmpty(text: string | null, offerCreate: boolean): void {
		this.empty.hidden = text === null;
		if (text === null) return;
		const create = offerCreate ? button({ label: 'Create NPC', variant: 'outline', size: 'sm', icon: 'plus' }) : null;
		if (create) this.attachCreateMenu(create);
		this.empty.replaceChildren(icon('alert', { size: 'lg' }), el('p', { class: 'npc-library-empty-text' }, text), ...(create ? [create] : []));
	}

	/** The favorites that still exist, each with how to make its tile. */
	private favoriteEntries(): { label: string; make: () => AssetTileHandle }[] {
		const entries: { label: string; make: () => AssetTileHandle }[] = [];
		for (const favorite of this.favorites) {
			if (favorite.kind === 'custom') {
				const preset = this.presets.find((p) => p.id === favorite.presetId);
				if (preset) entries.push({ label: presetName(preset), make: () => this.makePresetTile(preset) });
			} else {
				const d = this.displays.get(favorite.displayId);
				const model = d && this.models.find((m) => m.fdid === d.model);
				if (!d || !model) continue;
				const index = model.variants.indexOf(d);
				const label = model.variants.length === 1 ? model.label : `${model.label} ${index + 1}`;
				entries.push({ label, make: () => this.makeDisplayTile(model, index, label) });
			}
		}
		return entries;
	}

	/** One tile, with its thumbnail queued and its menu attached. */
	private makeTile(options: { key: string; label: string; title: string; disabled?: boolean; badge?: string; items?: MenuItem[]; thumb?: ThumbJob; onActivate: () => void }): AssetTileHandle {
		const img = document.createElement('img');
		img.alt = '';
		img.decoding = 'async';
		let action: HTMLButtonElement | undefined;
		if (options.items) {
			action = iconButton({ icon: 'more', label: `More for ${options.label}`, variant: 'secondary', size: 'sm' });
			this.menus.push(menu(action, options.items));
		}
		const handle = assetTile({ label: options.label, title: options.title, picture: img, disabled: options.disabled, badge: options.badge, action, onActivate: options.onActivate });
		this.tiles.set(options.key, handle);
		if (options.thumb) this.queueThumb(handle.root, img, options.thumb);
		return handle;
	}

	private makePresetTile(preset: NpcPreset): AssetTileHandle {
		const appearance: NpcAppearance = { kind: 'custom', presetId: preset.id };
		const name = presetName(preset);
		return this.makeTile({
			key: appearanceKey(appearance),
			label: name,
			title: `${name}\nClick to pick it for placing`,
			items: [
				{ label: 'Edit', onSelect: () => this.hooks.onEdit(preset) },
				{ label: 'Remix', onSelect: () => this.hooks.onRemixPreset(preset) },
				this.favoriteItem(appearance),
				{ label: 'Export .wnpc', onSelect: () => this.hooks.onExport(preset) },
				{ label: 'Delete', destructive: true, onSelect: () => this.hooks.onDelete(preset) },
			],
			thumb: { kind: 'npcPreset', fdid: this.hooks.handleOf(preset), key: presetThumbKey(preset) },
			onActivate: () => this.pick({ appearance, label: preset.name || 'custom NPC' }),
		});
	}

	/** A single creature display as a tile: one model's only skin, or one variant of many. */
	private makeDisplayTile(model: CreatureModel, index: number, label: string): AssetTileHandle {
		const d = model.variants[index];
		const appearance: NpcAppearance = { kind: 'creature', displayId: d.id };
		const notes = `${d.humanoid ? '\nHumanoid: can be remixed into a custom NPC' : ''}${d.status === 'not-local' ? '\nNot downloaded in your install yet' : ''}`;
		return this.makeTile({
			key: appearanceKey(appearance),
			label,
			title: `${model.label} · variant ${index + 1} (display ${d.id})${notes}`,
			disabled: d.status !== 'ok',
			items: [{ label: 'Remix', disabled: !d.humanoid, onSelect: () => this.hooks.onRemixDisplay(d.id) }, this.favoriteItem(appearance)],
			thumb: d.status === 'ok' ? { kind: 'creature', fdid: d.id, key: `creature:${d.id}` } : undefined,
			onActivate: () => this.pick({ appearance, label: `${model.label} ${index + 1}` }),
		});
	}

	/** A model with several skins: the "N variants" tile that opens the Variants view. */
	private makeModelTile(model: CreatureModel): AssetTileHandle {
		const first = model.variants.find((v) => v.status === 'ok');
		return this.makeTile({
			key: `model:${model.fdid}`,
			label: model.label,
			title: `${model.path || `Model file ${model.fdid}`}\n${model.variants.length} variants: click to see them`,
			disabled: !first,
			badge: `${model.variants.length} variants`,
			thumb: first ? { kind: 'creature', fdid: first.id, key: `creature:${first.id}` } : undefined,
			onActivate: () => this.setView({ kind: 'variants', model }),
		});
	}

	/** Closes and removes the current grid's menus, whose panels live on <body> once opened. */
	private closeMenus(): void {
		for (const handle of this.menus) {
			handle.close();
			handle.root.remove();
		}
		this.menus = [];
	}

	// ---- Picking (spec 7.9.1) ----

	/** Arms an appearance for placing, or disarms it when it is the armed one already. */
	private pick(asset: NpcAsset): void {
		const same = this.selected !== null && appearanceKey(this.selected.appearance) === appearanceKey(asset.appearance);
		this.selected = same ? null : asset;
		this.onPick(this.selected);
		this.syncSelection();
		if (this.selected) this.showToast();
		else this.hideToast();
	}

	private syncSelection(): void {
		const picked = this.selected?.appearance ?? null;
		const key = picked ? appearanceKey(picked) : null;
		const pickedModel = picked?.kind === 'creature' ? this.displays.get(picked.displayId)?.model : undefined;
		for (const [tileKey, handle] of this.tiles) {
			// A multi-variant tile shows selected while one of its variants is armed.
			setAssetTileSelected(handle.root, tileKey === key || (pickedModel !== undefined && tileKey === `model:${pickedModel}`));
		}
		this.syncPicked();
	}

	private syncPicked(): void {
		this.pickedLine.textContent = this.selected ? `Placing ${this.selected.label}` : 'Nothing picked yet';
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

	// ---- Favorites ----

	private isFavorite(appearance: NpcAppearance): boolean {
		const key = appearanceKey(appearance);
		return this.favorites.some((f) => appearanceKey(f) === key);
	}

	private favoriteItem(appearance: NpcAppearance): MenuItem {
		const on = this.isFavorite(appearance);
		return { label: on ? 'Remove from favorites' : 'Add to favorites', onSelect: () => this.toggleFavorite(appearance) };
	}

	private toggleFavorite(appearance: NpcAppearance): void {
		const key = appearanceKey(appearance);
		this.favorites = this.isFavorite(appearance) ? this.favorites.filter((f) => appearanceKey(f) !== key) : [...this.favorites, appearance];
		try {
			localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites));
		} catch {
			// Forgetting favorites across sessions is the worst case.
		}
		// The menus name the new state; the Favorites view gains or loses the tile.
		const top = this.grid.scrollTop;
		this.renderList();
		this.grid.scrollTop = top;
	}

	// ---- Custom presets (spec 7.9.3) ----

	/** Shows the preset library's contents; called whenever it changes. */
	setPresets(presets: NpcPreset[]): void {
		this.presets = presets;
		if (this.selected?.appearance.kind === 'custom' && !presets.some((p) => p.id === (this.selected!.appearance as { presetId: string }).presetId)) {
			this.selected = null;
			this.onPick(null);
			this.hideToast();
		}
		if (this.view.kind === 'local' || this.view.kind === 'favorites') this.renderList();
		else this.syncSelection();
	}

	/** Drops a preset's cached thumbnail after an edit, so the list shows the new look. */
	forgetThumb(key: string): void {
		const url = sessionThumbs.get(key);
		if (url) URL.revokeObjectURL(url);
		sessionThumbs.delete(key);
	}

	// ---- Thumbnails ----

	private queueThumb(element: HTMLElement, img: HTMLImageElement, job: ThumbJob): void {
		const cached = sessionThumbs.get(job.key);
		if (cached) img.src = cached;
		else if (cached === undefined) {
			this.pending.set(element, job);
			this.observer.observe(element);
		}
	}

	private async drawThumb(element: HTMLElement, job: ThumbJob): Promise<void> {
		if (sessionThumbs.has(job.key)) return;
		sessionThumbs.set(job.key, null);
		try {
			const bytes = await this.thumbs.thumbnail(job.kind, job.fdid, job.key);
			if (!bytes || this.disposed) return;
			const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
			sessionThumbs.set(job.key, url);
			const img = element.querySelector('img');
			if (img && element.isConnected) img.src = url;
		} catch {
			// Thumbnails are decoration; the names still work.
		}
	}

	dispose(): void {
		this.disposed = true;
		this.hideToast();
		this.closeMenus();
		this.observer.disconnect();
		this.pending.clear();
		this.thumbs.dispose();
		this.window.dispose();
	}
}

function presetName(preset: NpcPreset): string {
	return preset.name || 'Unnamed NPC';
}

/** One string per appearance, to compare and to key tiles by. */
function appearanceKey(appearance: NpcAppearance): string {
	return appearance.kind === 'custom' ? `custom:${appearance.presetId}` : `creature:${appearance.displayId}`;
}

/** The favorites kept from last time: an array of appearances. */
function loadFavorites(): NpcAppearance[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((f): f is NpcAppearance => {
			if (typeof f !== 'object' || f === null) return false;
			const v = f as Record<string, unknown>;
			return (v.kind === 'creature' && typeof v.displayId === 'number') || (v.kind === 'custom' && typeof v.presetId === 'string');
		});
	} catch {
		return [];
	}
}

/** The tile size kept from last time, 1 (smallest) to 3. */
function loadScale(): number {
	try {
		const scale = Number(localStorage.getItem(SCALE_KEY));
		return scale >= 1 && scale <= 3 ? Math.round(scale) : DEFAULT_SCALE;
	} catch {
		return DEFAULT_SCALE;
	}
}

/** The editor's top bar height, so the window opens just under it. */
function topBarHeight(): number {
	return document.getElementById('editor-bar')?.offsetHeight ?? 0;
}
