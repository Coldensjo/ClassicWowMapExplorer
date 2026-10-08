import { CHARACTER_OUTFITS, type CharacterOutfit, type CharacterRace } from '../explorer/spawns';
import type { CharacterLook } from './character';
import type { Portraits } from './portraits';

/** Picture widths (CSS px) the zoom goes between. */
const ZOOM_MIN = 64;
const ZOOM_MAX = 360;
const ZOOM_DEFAULT = 128;
/** Pictures are this much taller than wide. */
const TILE_ASPECT = 4 / 3;
/** Pictures drawn at once: each waits mostly on the storage worker. */
const DRAWING_AT_ONCE = 3;
/** Pictures are drawn in steps of this many pixels wide, so a little zooming reuses them. */
const WIDTH_STEP = 64;
const ZOOM_KEY = 'mapExplorer.formZoom';

/** The picker's controls, in index.html. */
export interface FormPickerElements {
	root: HTMLElement;
	grid: HTMLElement;
	count: HTMLElement;
	race: HTMLSelectElement;
	sex: HTMLSelectElement;
	model: HTMLSelectElement;
	zoom: HTMLInputElement;
	close: HTMLButtonElement;
}

interface Tile {
	look: CharacterLook;
	key: string;
	button: HTMLButtonElement;
	img: HTMLImageElement;
	/** Place in the grid, top first, for which to draw first. */
	order: number;
}

/** A look's picture once drawn, and how wide it was drawn; null when the look has no model. */
type Picture = { url: string; width: number } | null;

const SEXES = ['Male', 'Female'];

/** The same look, picture for picture: race, sex, model and look or outfit. */
const lookKey = (l: CharacterLook) => `${l.race}:${l.sex}:${l.hd ? 'hd' : 'sd'}:${l.outfit ?? l.look}`;

/**
 * The travel form picker: every look the install has, as pictures in a grid to scroll through
 * and zoom (the slider, or Ctrl and the wheel), narrowed by race, sex and model. Only the
 * pictures in view are drawn, and each once (again only to zoom in past it).
 */
export class FormPicker {
	private races: CharacterRace[] = [];
	private chosen: CharacterLook | null = null;
	private tiles: Tile[] = [];
	private readonly byButton = new Map<Element, Tile>();
	private readonly inView = new Set<Tile>();
	private readonly pictures = new Map<string, Picture>();
	private readonly drawing = new Set<string>();
	private readonly observer: IntersectionObserver;
	/** The grid needs building again (new races, or a filter changed while closed). */
	private stale = true;
	private tileWidth = ZOOM_DEFAULT;

	constructor(
		private readonly ui: FormPickerElements,
		private readonly portraits: () => Portraits,
		private readonly onPick: (look: CharacterLook) => void,
	) {
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				const tile = this.byButton.get(e.target);
				if (!tile) continue;
				if (e.isIntersecting) this.inView.add(tile);
				else this.inView.delete(tile);
			}
			this.pump();
		}, { root: ui.grid, rootMargin: '200px 0px' });

		try {
			const saved = Number(localStorage.getItem(ZOOM_KEY));
			if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) this.tileWidth = saved;
		} catch {
			// Storage blocked: the default zoom.
		}
		ui.zoom.min = String(ZOOM_MIN);
		ui.zoom.max = String(ZOOM_MAX);
		ui.zoom.value = String(this.tileWidth);
		this.applyZoom(this.tileWidth);
		ui.zoom.addEventListener('input', () => this.zoomTo(Number(ui.zoom.value)));
		// Ctrl and the wheel (or a pinch on a touchpad, which browsers send as that) zooms; the wheel alone scrolls.
		ui.grid.addEventListener('wheel', (e) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			this.zoomTo(this.tileWidth * Math.exp(-e.deltaY * 0.002));
		}, { passive: false });

		for (const select of [ui.race, ui.sex, ui.model]) select.addEventListener('change', () => this.build());
		ui.close.addEventListener('click', () => this.close());
		ui.root.addEventListener('click', (e) => {
			if (e.target === ui.root) this.close();
		});
		ui.grid.addEventListener('click', (e) => {
			const button = (e.target as Element).closest('.form-tile');
			const tile = button && this.byButton.get(button);
			if (!tile) return;
			this.onPick({ ...tile.look });
			this.close();
		});
		window.addEventListener('keydown', (e) => {
			if (e.code === 'Escape' && this.isOpen) this.close();
		});
	}

	get isOpen(): boolean {
		return !this.ui.root.hidden;
	}

	/** The races there are looks for, and how many each sex has. */
	setRaces(races: CharacterRace[]): void {
		this.races = races;
		this.ui.race.replaceChildren(new Option('All races', ''), ...races.map((r) => new Option(r.name, String(r.race))));
		this.stale = true;
		if (this.isOpen) this.build();
	}

	/** Opens on the model the character wears, with its look marked and scrolled to. */
	open(current: CharacterLook): void {
		this.chosen = { ...current };
		if (document.pointerLockElement) document.exitPointerLock();
		const model = current.hd ? 'hd' : 'sd';
		if (this.ui.model.value !== model) {
			this.ui.model.value = model;
			this.stale = true;
		}
		// Narrowed to another race, the look worn wouldn't be there to mark.
		if (this.ui.race.value && this.ui.race.value !== String(current.race)) {
			this.ui.race.value = '';
			this.stale = true;
		}
		this.ui.root.hidden = false;
		if (this.stale) this.build();
		else this.mark();
		const chosen = this.ui.grid.querySelector<HTMLElement>('.form-tile.chosen');
		if (chosen) chosen.scrollIntoView({ block: 'center' });
		else this.ui.grid.scrollTop = 0;
		this.ui.grid.focus({ preventScroll: true });
		this.pump();
	}

	close(): void {
		this.ui.root.hidden = true;
	}

	toggle(current: CharacterLook): void {
		if (this.isOpen) this.close();
		else this.open(current);
	}

	/** Lays out a tile for each look the race, sex and model chosen have: outfits first, then race by race. */
	private build(): void {
		this.stale = false;
		this.observer.disconnect();
		this.byButton.clear();
		this.inView.clear();
		this.tiles = [];
		const hd = this.ui.model.value === 'hd';
		const model = hd ? 'hd' : 'sd';
		const race = this.ui.race.value ? Number(this.ui.race.value) : null;
		const sexes = this.ui.sex.value ? [Number(this.ui.sex.value)] : [0, 1];
		const races = this.races.filter((r) => race === null || r.race === race);
		const sections: HTMLElement[] = [];

		const outfits: CharacterLook[] = [];
		for (const [key, o] of Object.entries(CHARACTER_OUTFITS)) {
			const r = races.find((x) => x.race === o.race);
			for (const sex of sexes) if (r?.sexes[sex][model]) outfits.push({ race: o.race, sex, hd, look: 0, outfit: key as CharacterOutfit });
		}
		if (outfits.length) {
			sections.push(this.section('Outfits', outfits.map((look) => [look, `${CHARACTER_OUTFITS[look.outfit!].name}, ${SEXES[look.sex].toLowerCase()}`])));
		}
		for (const r of races) {
			for (const sex of sexes) {
				const count = r.sexes[sex][model];
				if (!count) continue;
				const looks: [CharacterLook, string][] = [];
				for (let i = 0; i < count; i++) looks.push([{ race: r.race, sex, hd, look: i, outfit: null }, `${r.name} ${SEXES[sex].toLowerCase()}, look ${i + 1} of ${count}`]);
				sections.push(this.section(`${r.name} ${SEXES[sex].toLowerCase()}`, looks));
			}
		}
		const looks = this.tiles.length;
		this.ui.count.textContent = `${looks.toLocaleString()} ${looks === 1 ? 'look' : 'looks'}`;
		this.ui.grid.replaceChildren(...sections);
		if (!sections.length) {
			const none = document.createElement('p');
			none.className = 'muted';
			none.textContent = 'No looks for this race, sex and model.';
			this.ui.grid.append(none);
		}
		this.ui.grid.scrollTop = 0;
		this.mark();
		for (const tile of this.tiles) this.observer.observe(tile.button);
	}

	/** A heading and its tiles, each with its label as the tooltip. */
	private section(title: string, looks: [CharacterLook, string][]): HTMLElement {
		const section = document.createElement('section');
		section.className = 'forms-section';
		const heading = document.createElement('h3');
		heading.textContent = title;
		const count = document.createElement('span');
		count.className = 'muted small';
		count.textContent = ` ${looks.length}`;
		heading.append(count);
		const grid = document.createElement('div');
		grid.className = 'forms-tiles';
		for (const [look, label] of looks) {
			const button = document.createElement('button');
			button.className = 'plain form-tile';
			button.title = label;
			button.setAttribute('aria-label', label);
			const img = document.createElement('img');
			img.alt = '';
			img.draggable = false;
			const caption = document.createElement('span');
			caption.textContent = look.outfit ? SEXES[look.sex] : String(look.look + 1);
			button.append(img, caption);
			const tile: Tile = { look, key: lookKey(look), button, img, order: this.tiles.length };
			this.tiles.push(tile);
			this.byButton.set(button, tile);
			this.show(tile);
			grid.append(button);
		}
		section.append(heading, grid);
		return section;
	}

	/** Marks the look worn. */
	private mark(): void {
		const key = this.chosen ? lookKey(this.chosen) : '';
		for (const tile of this.tiles) {
			const on = tile.key === key;
			tile.button.classList.toggle('chosen', on);
			tile.button.setAttribute('aria-pressed', String(on));
		}
	}

	/** Shows a tile's picture if it has been drawn, at whatever size. */
	private show(tile: Tile): void {
		const picture = this.pictures.get(tile.key);
		tile.button.classList.toggle('missing', picture === null);
		if (picture && tile.img.src !== picture.url) tile.img.src = picture.url;
		tile.button.classList.toggle('drawn', !!picture);
	}

	/** Device pixels a picture needs to be wide at this zoom, in steps of WIDTH_STEP. */
	private get wantedWidth(): number {
		const px = this.tileWidth * Math.min(window.devicePixelRatio || 1, 2);
		return Math.ceil(px / WIDTH_STEP) * WIDTH_STEP;
	}

	/** Draws the pictures in view that aren't drawn yet, or not big enough for the zoom, top first. */
	private pump(): void {
		if (!this.isOpen || this.drawing.size >= DRAWING_AT_ONCE) return;
		const width = this.wantedWidth;
		const waiting = [...this.inView]
			.filter((t) => !this.drawing.has(t.key) && this.needs(t.key, width))
			.sort((a, b) => a.order - b.order);
		for (const tile of waiting) {
			if (this.drawing.size >= DRAWING_AT_ONCE) break;
			if (this.drawing.has(tile.key)) continue;
			void this.draw(tile.key, tile.look, width);
		}
	}

	private needs(key: string, width: number): boolean {
		if (!this.pictures.has(key)) return true;
		const picture = this.pictures.get(key);
		return picture !== null && picture!.width < width;
	}

	private async draw(key: string, look: CharacterLook, width: number): Promise<void> {
		this.drawing.add(key);
		let picture: Picture = null;
		try {
			const blob = await this.portraits().draw(look, width, Math.round(width * TILE_ASPECT));
			if (blob) picture = { url: URL.createObjectURL(blob), width };
		} catch (e) {
			console.warn(`Travel form ${key}:`, e);
		}
		const before = this.pictures.get(key);
		if (before) URL.revokeObjectURL(before.url);
		// A failed redraw keeps the smaller picture.
		this.pictures.set(key, picture ?? before ?? null);
		this.drawing.delete(key);
		for (const tile of this.tiles) if (tile.key === key) this.show(tile);
		this.pump();
	}

	/** Zooms to a picture width, keeping the same part of the grid in view. */
	private zoomTo(width: number): void {
		const w = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, width)));
		if (w === this.tileWidth) return;
		const grid = this.ui.grid;
		const along = grid.scrollHeight > grid.clientHeight ? (grid.scrollTop + grid.clientHeight / 2) / grid.scrollHeight : 0;
		this.applyZoom(w);
		this.ui.zoom.value = String(w);
		grid.scrollTop = along * grid.scrollHeight - grid.clientHeight / 2;
		try {
			localStorage.setItem(ZOOM_KEY, String(w));
		} catch {
			// Storage blocked: not remembered.
		}
		this.pump();
	}

	private applyZoom(width: number): void {
		this.tileWidth = width;
		this.ui.grid.style.setProperty('--tile', `${width}px`);
	}
}
