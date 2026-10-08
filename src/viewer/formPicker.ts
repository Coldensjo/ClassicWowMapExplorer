import { CHARACTER_OUTFITS, type CharacterOutfit, type CharacterRace } from '../explorer/spawns';
import type { CharacterLook } from './character';
import type { Portraits } from './portraits';
import { GameScrollbar } from './scrollbar';

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
/** The layout (CSS px): space between tiles, a tile's caption under its picture, a heading, the space after a section. */
const GAP = 6;
const CAPTION = 18;
const HEADING = 30;
const SECTION_GAP = 12;
/** Rows kept laid out above and below the view (px), so scrolling doesn't show them appear. */
const OVERSCAN = 400;

/** The picker's controls, in index.html. */
export interface FormPickerElements {
	root: HTMLElement;
	grid: HTMLElement;
	heading: HTMLElement;
	scrollbar: HTMLElement;
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
	label: string;
	caption: string;
	section: number;
}

interface Section {
	title: string;
	/** Index of its first tile, and how many. */
	start: number;
	count: number;
}

/** A row of the laid-out grid: a section's heading, or a run of its tiles. */
interface Row {
	top: number;
	height: number;
	section: number;
	/** The tiles in it (none for a heading). */
	start: number;
	end: number;
}

/** A look's picture once drawn, and how wide it was drawn; null when the look has no model. */
type Picture = { url: string; width: number } | null;

const SEXES = ['Male', 'Female'];

/** The same look, picture for picture: race, sex, model and look or outfit. */
const lookKey = (l: CharacterLook) => `${l.race}:${l.sex}:${l.hd ? 'hd' : 'sd'}:${l.outfit ?? l.look}`;

/**
 * The travel form picker: every look the install has, as pictures in a grid to scroll through
 * and zoom (the slider, or Ctrl and the wheel), narrowed by race, sex and model. There can be
 * thousands, so only the rows in view are in the page, laid out again as it scrolls, and only
 * their pictures are drawn, each once (again only to zoom in past it).
 */
export class FormPicker {
	private races: CharacterRace[] = [];
	private chosen: CharacterLook | null = null;
	private tiles: Tile[] = [];
	private sections: Section[] = [];
	private rows: Row[] = [];
	/** The rows in the page, by index into rows. */
	private readonly shown = new Map<number, HTMLElement>();
	/** The tiles in the page, by index into tiles. */
	private readonly buttons = new Map<number, HTMLButtonElement>();
	private readonly pictures = new Map<string, Picture>();
	private readonly drawing = new Set<string>();
	/** Holds the rows, as tall as all of them. */
	private readonly sizer = document.createElement('div');
	private readonly scrollbar: GameScrollbar;
	/** The grid needs building again (new races, or a filter changed while closed). */
	private stale = true;
	private tileWidth = ZOOM_DEFAULT;
	/** Laid out: columns, a tile's width and its row's height, for this width of grid. */
	private columns = 1;
	private cellWidth = ZOOM_DEFAULT;
	private rowHeight = 0;
	private laidOutFor = -1;
	private frame = 0;

	constructor(
		private readonly ui: FormPickerElements,
		private readonly portraits: () => Portraits,
		private readonly onPick: (look: CharacterLook) => void,
	) {
		this.sizer.className = 'forms-sizer';
		ui.grid.append(this.sizer);
		this.scrollbar = new GameScrollbar(ui.grid, () => this.rowHeight + GAP);
		ui.scrollbar.replaceWith(this.scrollbar.element);
		this.scrollbar.element.id = ui.scrollbar.id;

		try {
			const saved = Number(localStorage.getItem(ZOOM_KEY));
			if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) this.tileWidth = saved;
		} catch {
			// Storage blocked: the default zoom.
		}
		ui.zoom.min = String(ZOOM_MIN);
		ui.zoom.max = String(ZOOM_MAX);
		ui.zoom.value = String(this.tileWidth);
		ui.zoom.addEventListener('input', () => this.zoomTo(Number(ui.zoom.value)));
		// Ctrl and the wheel (or a pinch on a touchpad, which browsers send as that) zooms; the wheel alone scrolls.
		ui.grid.addEventListener('wheel', (e) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			this.zoomTo(this.tileWidth * Math.exp(-e.deltaY * 0.002));
		}, { passive: false });
		ui.grid.addEventListener('scroll', () => this.schedule(), { passive: true });
		new ResizeObserver(() => {
			if (this.isOpen && ui.grid.clientWidth !== this.laidOutFor) this.relayout();
		}).observe(ui.grid);

		for (const select of [ui.race, ui.sex, ui.model]) select.addEventListener('change', () => this.build());
		ui.close.addEventListener('click', () => this.close());
		ui.root.addEventListener('click', (e) => {
			if (e.target === ui.root) this.close();
		});
		ui.grid.addEventListener('click', (e) => {
			const button = (e.target as Element).closest<HTMLElement>('.form-tile');
			const tile = button && this.tiles[Number(button.dataset.tile)];
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
		else this.relayout();
		const key = lookKey(current);
		const index = this.tiles.findIndex((t) => t.key === key);
		this.scrollToTile(index, 'center');
		this.ui.grid.focus({ preventScroll: true });
	}

	close(): void {
		this.ui.root.hidden = true;
	}

	/** Lists a tile for each look the race, sex and model chosen have: outfits first, then race by race. */
	private build(): void {
		this.stale = false;
		const hd = this.ui.model.value === 'hd';
		const model = hd ? 'hd' : 'sd';
		const race = this.ui.race.value ? Number(this.ui.race.value) : null;
		const sexes = this.ui.sex.value ? [Number(this.ui.sex.value)] : [0, 1];
		const races = this.races.filter((r) => race === null || r.race === race);
		this.tiles = [];
		this.sections = [];
		const section = (title: string) => this.sections.push({ title, start: this.tiles.length, count: 0 }) - 1;

		let outfits = -1;
		for (const [key, o] of Object.entries(CHARACTER_OUTFITS)) {
			const r = races.find((x) => x.race === o.race);
			for (const sex of sexes) {
				if (!r?.sexes[sex][model]) continue;
				if (outfits < 0) outfits = section('Outfits');
				const look: CharacterLook = { race: o.race, sex, hd, look: 0, outfit: key as CharacterOutfit };
				this.tiles.push({ look, key: lookKey(look), label: `${o.name}, ${SEXES[sex].toLowerCase()}`, caption: SEXES[sex], section: outfits });
			}
		}
		for (const r of races) {
			for (const sex of sexes) {
				const count = r.sexes[sex][model];
				if (!count) continue;
				const s = section(`${r.name} ${SEXES[sex].toLowerCase()}`);
				for (let i = 0; i < count; i++) {
					const look: CharacterLook = { race: r.race, sex, hd, look: i, outfit: null };
					this.tiles.push({ look, key: lookKey(look), label: `${r.name} ${SEXES[sex].toLowerCase()}, look ${i + 1} of ${count}`, caption: String(i + 1), section: s });
				}
			}
		}
		for (const s of this.sections) s.count = this.tiles.filter((t) => this.sections[t.section] === s).length;
		const looks = this.tiles.length;
		this.ui.count.textContent = `${looks.toLocaleString()} ${looks === 1 ? 'look' : 'looks'}`;
		this.relayout();
		this.ui.grid.scrollTop = 0;
		this.render();
	}

	/** Works out the rows for the grid's width and the zoom, and lays out again what's in view. */
	private relayout(): void {
		const width = this.ui.grid.clientWidth;
		this.laidOutFor = width;
		this.columns = Math.max(1, Math.floor((width + GAP) / (this.tileWidth + GAP)));
		this.cellWidth = Math.max(1, (width - GAP * (this.columns - 1)) / this.columns);
		this.rowHeight = Math.round(this.cellWidth * TILE_ASPECT) + CAPTION;
		this.rows = [];
		let top = 0;
		this.sections.forEach((s, i) => {
			this.rows.push({ top, height: HEADING, section: i, start: 0, end: 0 });
			top += HEADING;
			for (let start = s.start; start < s.start + s.count; start += this.columns) {
				this.rows.push({ top, height: this.rowHeight, section: i, start, end: Math.min(start + this.columns, s.start + s.count) });
				top += this.rowHeight + GAP;
			}
			top += SECTION_GAP;
		});
		this.sizer.style.height = `${top}px`;
		for (const el of this.shown.values()) el.remove();
		this.shown.clear();
		this.buttons.clear();
		this.ui.grid.querySelector('.forms-none')?.remove();
		if (!this.tiles.length) {
			const none = document.createElement('p');
			none.className = 'muted forms-none';
			none.textContent = 'No looks for this race, sex and model.';
			this.ui.grid.append(none);
		}
		this.render();
		this.scrollbar.update();
	}

	private schedule(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	/** The first row reaching below y (a binary search: rows are in order). */
	private rowAt(y: number): number {
		let lo = 0;
		let hi = this.rows.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const r = this.rows[mid];
			if (r.top + r.height + GAP <= y) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	/** Puts the rows near the view in the page and takes the rest out; then draws what's in view. */
	private render(): void {
		if (!this.isOpen || !this.rows.length) {
			this.ui.heading.hidden = true;
			return;
		}
		const { scrollTop, clientHeight } = this.ui.grid;
		const first = this.rowAt(scrollTop - OVERSCAN);
		const last = this.rowAt(scrollTop + clientHeight + OVERSCAN);
		for (const [i, el] of this.shown) {
			if (i >= first && i <= last) continue;
			el.remove();
			this.shown.delete(i);
			const row = this.rows[i];
			for (let t = row.start; t < row.end; t++) this.buttons.delete(t);
		}
		const chosen = this.chosen ? lookKey(this.chosen) : '';
		for (let i = first; i <= last; i++) {
			if (this.shown.has(i)) continue;
			const el = this.row(this.rows[i], chosen);
			this.shown.set(i, el);
			this.sizer.append(el);
		}
		// The section at the top stays named above the grid, as a sticky heading would.
		const top = this.rows[this.rowAt(scrollTop)];
		this.ui.heading.hidden = !top || (top.start === top.end && top.top >= scrollTop);
		if (top) this.setHeading(this.ui.heading, this.sections[top.section]);
		this.pump();
	}

	private setHeading(el: HTMLElement, section: Section): void {
		const count = document.createElement('span');
		count.className = 'muted small';
		count.textContent = ` ${section.count.toLocaleString()}`;
		el.replaceChildren(section.title, count);
	}

	/** A row's element: a heading, or its tiles with what pictures there are. */
	private row(row: Row, chosen: string): HTMLElement {
		const el = document.createElement('div');
		el.style.top = `${row.top}px`;
		el.style.height = `${row.height}px`;
		if (row.start === row.end) {
			el.className = 'forms-row forms-heading';
			this.setHeading(el, this.sections[row.section]);
			return el;
		}
		el.className = 'forms-row forms-tiles';
		el.style.gridTemplateColumns = `repeat(${this.columns}, minmax(0, 1fr))`;
		for (let t = row.start; t < row.end; t++) {
			const tile = this.tiles[t];
			const button = document.createElement('button');
			button.className = 'plain form-tile';
			button.dataset.tile = String(t);
			button.title = tile.label;
			button.setAttribute('aria-label', tile.label);
			const on = tile.key === chosen;
			button.classList.toggle('chosen', on);
			button.setAttribute('aria-pressed', String(on));
			const img = document.createElement('img');
			img.alt = '';
			img.draggable = false;
			const caption = document.createElement('span');
			caption.textContent = tile.caption;
			button.append(img, caption);
			this.buttons.set(t, button);
			this.show(t, button);
			el.append(button);
		}
		return el;
	}

	/** Shows a tile's picture if it has been drawn, at whatever size. */
	private show(index: number, button: HTMLButtonElement): void {
		const picture = this.pictures.get(this.tiles[index].key);
		const img = button.firstElementChild as HTMLImageElement;
		if (picture && img.getAttribute('src') !== picture.url) img.src = picture.url;
		button.classList.toggle('missing', picture === null);
		button.classList.toggle('drawn', !!picture);
	}

	/** Scrolls a tile into view: its row at the top, or in the middle. */
	private scrollToTile(index: number, where: 'top' | 'center'): void {
		const row = index < 0 ? undefined : this.rows.find((r) => index >= r.start && index < r.end);
		const grid = this.ui.grid;
		grid.scrollTop = !row ? 0 : where === 'center' ? row.top + row.height / 2 - grid.clientHeight / 2 : row.top;
		this.render();
	}

	/** Device pixels a picture needs to be wide at this zoom, in steps of WIDTH_STEP. */
	private get wantedWidth(): number {
		const px = this.cellWidth * Math.min(window.devicePixelRatio || 1, 2);
		return Math.ceil(px / WIDTH_STEP) * WIDTH_STEP;
	}

	/** Draws the pictures in view that aren't drawn yet, or not big enough for the zoom, top first. */
	private pump(): void {
		if (!this.isOpen || this.drawing.size >= DRAWING_AT_ONCE) return;
		const width = this.wantedWidth;
		const { scrollTop, clientHeight } = this.ui.grid;
		const last = this.rowAt(scrollTop + clientHeight);
		for (let i = this.rowAt(scrollTop); i <= last && this.drawing.size < DRAWING_AT_ONCE; i++) {
			const row = this.rows[i];
			for (let t = row.start; t < row.end && this.drawing.size < DRAWING_AT_ONCE; t++) {
				const tile = this.tiles[t];
				if (!this.drawing.has(tile.key) && this.needs(tile.key, width)) void this.draw(tile.key, tile.look, width);
			}
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
		if (before && picture) URL.revokeObjectURL(before.url);
		// A failed redraw keeps the smaller picture.
		this.pictures.set(key, picture ?? before ?? null);
		this.drawing.delete(key);
		for (const [t, button] of this.buttons) if (this.tiles[t].key === key) this.show(t, button);
		this.pump();
	}

	/** Zooms to a picture width, keeping the tile in the middle of the view there. */
	private zoomTo(width: number): void {
		const w = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, width)));
		if (w === this.tileWidth) return;
		const grid = this.ui.grid;
		const middle = this.rows[this.rowAt(grid.scrollTop + grid.clientHeight / 2)];
		const anchor = middle ? (middle.start === middle.end ? this.sections[middle.section].start : middle.start) : -1;
		this.tileWidth = w;
		this.ui.zoom.value = String(w);
		try {
			localStorage.setItem(ZOOM_KEY, String(w));
		} catch {
			// Storage blocked: not remembered.
		}
		if (!this.isOpen) return;
		this.relayout();
		this.scrollToTile(anchor, 'center');
	}
}
