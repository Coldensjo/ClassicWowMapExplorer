import type { GearDisplay } from '../explorer/npcs';
import type { Image } from '../formats/blp';
import type { EquipSlot, NpcPreset } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';
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
/** Pictures made at most once per session (display ID -> object URL, null while one is being made or when it failed). */
const sessionThumbs = new Map<number, string | null>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The custom NPC editor's slot browser (spec 7.9.3): every display a slot offers as a grid of
 * pictures, filtered by name, in place of the form while the preview stays. Item-backed gear
 * shows its item icon; NPC-only helmets, shoulders and weapons are rendered from their own
 * model, and NPC-only armour is rendered worn on a bare body of the NPC's race and sex, framed
 * on the part it covers. Clicking a picture wears it at once, so the preview shows it; Back
 * returns to the form.
 */
export class GearBrowser {
	private readonly thumbs: ModelThumbs;
	private readonly observer: IntersectionObserver;
	private readonly queue: { element: HTMLElement; entry: GearEntry }[] = [];
	private draining = false;
	private slot: EquipSlot | null = null;
	/** The race and sex armour is pictured on. */
	private body: { race: number; sex: 0 | 1 } = { race: 1, sex: 0 };
	private entries: GearEntry[] = [];
	private matches: GearEntry[] = [];
	private shown = 0;
	private current = 0;
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
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const element = e.target as HTMLElement;
				const entry = this.matches.find((g) => g.id === Number(element.dataset.id));
				this.observer.unobserve(element);
				if (entry && !sessionThumbs.has(entry.id)) this.queue.push({ element, entry });
			}
			void this.drain();
		}, { root: $('npc-browse-grid') });
		$('npc-browse-back').onclick = () => this.hooks.onBack();
		$('npc-browse-search').oninput = () => this.renderList(true);
	}

	get isOpen(): boolean {
		return !$('npc-editor-browse').hidden;
	}

	/** Shows a slot's gear for a body (race and sex), with what the draft wears marked and scrolled to. */
	open(slot: EquipSlot, label: string, entries: GearEntry[], current: number, body: { race: number; sex: 0 | 1 }): void {
		this.slot = slot;
		this.body = body;
		this.entries = entries;
		this.current = current;
		$('npc-browse-title').textContent = label;
		$<HTMLInputElement>('npc-browse-search').value = '';
		$('npc-editor-browse').hidden = false;
		this.renderList(true);
		$('npc-browse-search').focus();
	}

	close(): void {
		$('npc-editor-browse').hidden = true;
		this.observer.disconnect();
		this.queue.length = 0;
		$('npc-browse-grid').replaceChildren();
		this.slot = null;
		this.entries = [];
		this.matches = [];
	}

	/** Fills the grid with what matches the filter, a page at a time (fresh: from the first page). */
	private renderList(fresh: boolean): void {
		const grid = $('npc-browse-grid');
		if (fresh) {
			this.observer.disconnect();
			this.queue.length = 0;
			const tokens = $<HTMLInputElement>('npc-browse-search').value.toLowerCase().split(/\s+/).filter(Boolean);
			this.matches = this.entries.filter((g) => tokens.every((t) => g.search.includes(t)));
			// The first page, or enough of them to include what is worn.
			const worn = this.matches.findIndex((g) => g.id === this.current);
			this.shown = Math.min(this.matches.length, Math.max(PAGE, worn >= 0 ? Math.ceil((worn + 1) / PAGE) * PAGE : 0));
			grid.replaceChildren(...this.matches.slice(0, this.shown).map((g) => this.makeElement(g)));
		} else {
			grid.querySelector('.npc-browse-more')?.remove();
			const from = this.shown;
			this.shown = Math.min(this.matches.length, this.shown + PAGE);
			grid.append(...this.matches.slice(from, this.shown).map((g) => this.makeElement(g)));
		}
		const rest = this.matches.length - this.shown;
		if (rest > 0) {
			const more = document.createElement('button');
			more.className = 'npc-browse-more';
			more.textContent = `Show ${Math.min(PAGE, rest)} more of ${rest}`;
			more.addEventListener('click', () => this.renderList(false));
			grid.append(more);
		}
		const named = this.matches.filter((g) => g.name).length;
		$('npc-browse-count').textContent = this.matches.length === this.entries.length
			? `${this.entries.length} to choose from, ${named} with a name`
			: `${this.matches.length} of ${this.entries.length} match`;
		if (fresh) {
			grid.scrollTop = 0;
			grid.querySelector('.active')?.scrollIntoView({ block: 'center' });
		}
	}

	private makeElement(g: GearEntry): HTMLButtonElement {
		const element = document.createElement('button');
		element.type = 'button';
		element.className = 'texture-item';
		element.dataset.id = String(g.id);
		const img = document.createElement('img');
		img.width = 64;
		img.height = 64;
		img.alt = '';
		const caption = document.createElement('span');
		caption.textContent = g.name ?? g.label;
		element.append(img, caption);
		element.title = `${g.name ?? g.label}\nItem display ${g.id}${g.name ? '' : ' (no item name: labelled by its file)'}${g.status !== 'ok' ? '\nNot downloaded in your install yet' : ''}`;
		if (g.status !== 'ok') {
			element.classList.add('greyed');
			element.disabled = true;
		} else {
			element.addEventListener('click', () => {
				if (this.slot === null) return;
				this.current = g.id;
				this.hooks.onPick(this.slot, g.id);
				for (const other of $('npc-browse-grid').children) other.classList.toggle('active', other === element);
			});
			const cached = sessionThumbs.get(g.id);
			if (cached) img.src = cached;
			else if (cached === undefined) this.observer.observe(element);
		}
		if (g.id === this.current) element.classList.add('active');
		return element;
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
		$('npc-browse-back').onclick = null;
		$('npc-browse-search').oninput = null;
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
