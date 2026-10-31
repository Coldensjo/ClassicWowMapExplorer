import type { GearDisplay } from '../explorer/npcs';
import type { Image } from '../formats/blp';
import type { EquipSlot, NpcPreset } from '../scene/types';
import { assetGrid, assetTile, button, el, iconButton, setAssetGridColumns, setAssetTileSelected, setSliderValue, slider, textInput, type SliderHandle } from '../ui';
import type { AsyncStorageApi } from '../worker/protocol';
import { COLUMNS_BY_SCALE, loadScale, saveScale } from './browserView';
import { ModelThumbs, type ThumbFrame } from './modelThumbs';

/** A gear entry as the editor searches and browses it: the display plus its label and the text it matches on. */
export interface GearEntry extends GearDisplay {
	label: string;
	search: string;
}

/** Slots whose gear is a model of its own (helmets, shoulders, weapons); the rest is texture sections laid on the skin. */
const MODEL_SLOTS = new Set<EquipSlot>(['head', 'shoulder', 'mainHand', 'offHand', 'ranged']);
/**
 * Where on a standing body each texture slot's gear shows (shares of the height, feet 0 to
 * top 1, and how wide), for picturing it worn: the band of a bare body the picture frames.
 * The arms hang at the sides, so gloves and bracers frame wider than the trunk.
 */
const BODY_FRAMES: Partial<Record<EquipSlot, ThumbFrame>> = {
	chest: { lo: 0.45, hi: 0.9, width: 0.4 },
	shirt: { lo: 0.45, hi: 0.9, width: 0.4 },
	tabard: { lo: 0.32, hi: 0.88, width: 0.4 },
	wrist: { lo: 0.36, hi: 0.62, width: 0.5 },
	hands: { lo: 0.28, hi: 0.54, width: 0.5 },
	waist: { lo: 0.42, hi: 0.68, width: 0.35 },
	legs: { lo: 0.06, hi: 0.6, width: 0.35 },
	feet: { lo: 0, hi: 0.24, width: 0.35 },
	back: { lo: 0.18, hi: 0.95, width: 0.45, behind: true },
};
/** Entries put in the grid at once; Show more appends another page. */
const PAGE = 200;
/** Thumbnails decoded per worker batch. */
const BATCH = 12;
/** Longest side an icon is decoded at. */
const THUMB = 128;
/** The tile size, kept across sessions (npc-studio.md §4). */
const SCALE_KEY = 'wdb.npc-studio.scale';
/** Pictures made at most once per session (display ID -> object URL, null while one is being made or when it failed). */
const sessionThumbs = new Map<number, string | null>();

/**
 * The NPC studio's Browse Piece view (spec 7.9.3; design: NPC Studio View=Browse Piece
 * `38:20368`, src/ui/specs/npc-studio.md §4): every display a slot offers as a grid of
 * pictures in the rail's place while the preview stays. A heading row (back and the slot's
 * name), a search box with the tile-size slider, then the gear asset grid at 5, 4 or 3 columns
 * and a muted count line. Item-backed gear shows its item icon; NPC-only helmets, shoulders
 * and weapons are rendered from their own model, and NPC-only armour is rendered worn on a
 * bare body of the NPC's race and sex, framed on the part it covers. Clicking a tile wears it
 * at once, so the preview shows it; Back returns to the Gear tab.
 */
export class GearBrowser {
	readonly root: HTMLDivElement;
	private readonly heading: HTMLHeadingElement;
	private readonly search: HTMLInputElement;
	private readonly scale: SliderHandle;
	private readonly scroller: HTMLDivElement;
	private readonly grid: HTMLDivElement;
	private readonly count: HTMLParagraphElement;
	private readonly thumbs: ModelThumbs;
	private readonly observer: IntersectionObserver;
	private readonly queue: { element: HTMLElement; entry: GearEntry }[] = [];
	/** The tiles in the grid by display, for moving the selection mark. */
	private readonly tiles = new Map<number, HTMLButtonElement>();
	private draining = false;
	private slot: EquipSlot | null = null;
	/** The race and sex armour is pictured on. */
	private body: { race: number; sex: 0 | 1 } = { race: 1, sex: 0 };
	private entries: GearEntry[] = [];
	private matches: GearEntry[] = [];
	private shown = 0;
	private current = 0;
	private scaleStop = loadScale(SCALE_KEY);
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly hooks: {
			/** The worker handle a preset loads under (defines it there first), for the bodies armour is pictured on. */
			handleOf: (preset: NpcPreset) => number;
			onPick: (slot: EquipSlot, display: number) => void;
			onBack: () => void;
		},
	) {
		this.thumbs = new ModelThumbs(storage, build);

		// The heading row: back to the Gear tab, and the slot's name.
		const back = iconButton({ icon: 'left', label: 'Back to the gear', variant: 'secondary', size: 'sm', onClick: () => this.hooks.onBack() });
		this.heading = el('h3', { class: 'npc-studio-browse-heading' });
		const head = el('div', { class: 'npc-studio-browse-head' }, back, this.heading);

		// The tools row: the search box filling, the 140px tile-size group after it.
		const search = textInput({
			ariaLabel: 'Search for assets',
			type: 'search',
			icon: 'search',
			placeholder: 'Search for assets…',
			autocomplete: 'off',
			spellcheck: false,
			onInput: () => this.renderList(true),
		});
		this.search = search.input;
		this.scale = slider({ ariaLabel: 'Tile size', value: this.scaleStop, min: 1, max: 3, stops: 3, showInput: false, size: 'sm', onInput: (v) => this.setScale(v) });
		const smaller = iconButton({ icon: 'minus', label: 'Smaller tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop - 1) });
		const larger = iconButton({ icon: 'plus', label: 'Larger tiles', variant: 'ghost', size: 'xs', onClick: () => this.setScale(this.scaleStop + 1) });
		const tools = el('div', { class: 'asset-browser-tools' }, search.root, el('div', { class: 'asset-browser-scale', role: 'group', 'aria-label': 'Tile size' }, smaller, this.scale.root, larger));

		// The gear asset grid, scrolling on its own, with the count under it.
		this.grid = assetGrid(COLUMNS_BY_SCALE[this.scaleStop - 1], { 'aria-label': 'Gear' });
		this.scroller = el('div', { class: 'npc-studio-browse-grid ds-scroll' }, this.grid);
		this.count = el('p', { class: 'npc-studio-browse-count' });
		this.root = el('div', { class: 'npc-studio-browse', hidden: true }, head, tools, this.scroller, this.count);

		this.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const element = e.target as HTMLElement;
					const entry = this.matches.find((g) => g.id === Number(element.dataset.id));
					this.observer.unobserve(element);
					if (entry && !sessionThumbs.has(entry.id)) this.queue.push({ element, entry });
				}
				void this.drain();
			},
			{ root: this.scroller },
		);
	}

	get isOpen(): boolean {
		return !this.root.hidden;
	}

	/** Shows a slot's gear for a body (race and sex), with what the draft wears marked and scrolled to. */
	open(slot: EquipSlot, label: string, entries: GearEntry[], current: number, body: { race: number; sex: 0 | 1 }): void {
		this.slot = slot;
		this.body = body;
		this.entries = entries;
		this.current = current;
		this.heading.textContent = label;
		this.search.value = '';
		this.root.hidden = false;
		this.renderList(true);
		this.search.focus();
	}

	close(): void {
		this.root.hidden = true;
		this.observer.disconnect();
		this.queue.length = 0;
		this.grid.replaceChildren();
		this.tiles.clear();
		this.slot = null;
		this.entries = [];
		this.matches = [];
	}

	/** The tile size: 1 to 3, the grid's columns 5, 4 or 3 (Gear Asset Grid Scale Min, Mid, Max). */
	private setScale(value: number): void {
		const scale = Math.min(3, Math.max(1, Math.round(value)));
		this.scaleStop = scale;
		setSliderValue(this.scale.root, scale);
		setAssetGridColumns(this.grid, COLUMNS_BY_SCALE[scale - 1]);
		saveScale(SCALE_KEY, scale);
	}

	/** Fills the grid with what matches the filter, a page at a time (fresh: from the first page). */
	private renderList(fresh: boolean): void {
		if (fresh) {
			this.observer.disconnect();
			this.queue.length = 0;
			this.tiles.clear();
			const tokens = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
			this.matches = this.entries.filter((g) => tokens.every((t) => g.search.includes(t)));
			// The first page, or enough of them to include what is worn.
			const worn = this.matches.findIndex((g) => g.id === this.current);
			this.shown = Math.min(this.matches.length, Math.max(PAGE, worn >= 0 ? Math.ceil((worn + 1) / PAGE) * PAGE : 0));
			this.grid.replaceChildren(...this.matches.slice(0, this.shown).map((g) => this.makeTile(g)));
		} else {
			this.grid.querySelector('.npc-studio-browse-more')?.remove();
			const from = this.shown;
			this.shown = Math.min(this.matches.length, this.shown + PAGE);
			this.grid.append(...this.matches.slice(from, this.shown).map((g) => this.makeTile(g)));
		}
		const rest = this.matches.length - this.shown;
		if (rest > 0) {
			const more = button({ label: `Show ${Math.min(PAGE, rest)} more`, variant: 'outline', size: 'sm', onClick: () => this.renderList(false) });
			more.classList.add('npc-studio-browse-more');
			this.grid.append(more);
		}
		const named = this.matches.filter((g) => g.name).length;
		this.count.textContent = !this.matches.length
			? this.entries.length ? 'Nothing matches' : 'Nothing to choose from'
			: this.matches.length === this.entries.length
				? `${this.entries.length} to choose from, ${named} with a name`
				: `${this.matches.length} of ${this.entries.length} match`;
		if (fresh) {
			this.scroller.scrollTop = 0;
			this.tiles.get(this.current)?.scrollIntoView({ block: 'center' });
		}
	}

	private makeTile(g: GearEntry): HTMLElement {
		const img = document.createElement('img');
		img.alt = '';
		img.decoding = 'async';
		const missing = g.status !== 'ok';
		const tile = assetTile({
			label: g.name ?? g.label,
			title: `${g.name ?? g.label}\nItem display ${g.id}${g.name ? '' : ' (no item name: labelled by its file)'}${missing ? '\nNot downloaded in your install yet' : ''}`,
			picture: img,
			selected: g.id === this.current,
			disabled: missing,
			onActivate: () => {
				if (this.slot === null) return;
				const before = this.tiles.get(this.current);
				if (before) setAssetTileSelected(before, false);
				this.current = g.id;
				setAssetTileSelected(tile.root, true);
				this.hooks.onPick(this.slot, g.id);
			},
		});
		tile.root.dataset.id = String(g.id);
		this.tiles.set(g.id, tile.root);
		if (!missing) {
			const cached = sessionThumbs.get(g.id);
			if (cached) img.src = cached;
			else if (cached === undefined) this.observer.observe(tile.root);
		}
		return tile.frame;
	}

	/** Makes the pictures of the visible entries, a batch at a time, and puts them in. */
	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length && !this.disposed) {
				const batch = this.queue.splice(0, BATCH).filter(({ entry }) => !sessionThumbs.has(entry.id));
				for (const { entry } of batch) sessionThumbs.set(entry.id, null);
				// Icons decode together in the worker; models and dressed bodies render one by one.
				const pictures = batch.filter(({ entry }) => entry.icon);
				const images = pictures.length ? await this.storage.loadThumbnails(pictures.map(({ entry }) => entry.icon), THUMB).catch(() => []) : [];
				const { race, sex } = this.body;
				await Promise.all(
					batch.map(async ({ element, entry }) => {
						let url: string | null = null;
						try {
							const at = pictures.findIndex((p) => p.entry === entry);
							let bytes: Uint8Array | null = null;
							if (at >= 0) url = images[at] ? await imageUrl(images[at]) : null;
							else if (MODEL_SLOTS.has(entry.slot)) bytes = await this.thumbs.thumbnail('itemDisplay', entry.id, `item:${entry.id}`);
							else {
								// Worn on a bare body in its default look, so the picture is the gear's, not the draft's.
								const preset: NpcPreset = { id: `thumb:${race}:${sex}:${entry.id}`, name: '', race, sex, customization: {}, equipment: { [entry.slot]: entry.id } };
								// The framing is part of the key, so a changed framing draws afresh.
								const frame = BODY_FRAMES[entry.slot];
								const framing = frame ? `@${frame.lo}-${frame.hi}-${frame.width ?? ''}${frame.behind ? 'b' : ''}` : '';
								bytes = await this.thumbs.thumbnail('npcPreset', () => this.hooks.handleOf(preset), `gear:${race}:${sex}:${entry.id}${framing}`, frame);
							}
							if (bytes) url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
						} catch {
							// Pictures are decoration; the names still work.
						}
						sessionThumbs.set(entry.id, url);
						const img = element.querySelector('img');
						if (url && img && element.isConnected) img.src = url;
					}),
				);
			}
		} finally {
			this.draining = false;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.close();
		this.thumbs.dispose();
		this.root.remove();
	}
}

/** A decoded picture as an object URL (WebP), or null when the browser can't make one. */
async function imageUrl(image: Image): Promise<string | null> {
	if (!image.width || !image.height) return null;
	const canvas = new OffscreenCanvas(image.width, image.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const pixels = new Uint8ClampedArray(image.width * image.height * 4);
	pixels.set(image.rgba.subarray(0, pixels.length));
	ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
	return URL.createObjectURL(blob);
}
