import type { CopyMap } from '../explorer/copyWorld';
import type { MapSummary } from '../explorer/maps';
import { TILE_SIZE } from '../formats/adt';
import { MAX_COPIED_TILES } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';
import { el, iconButton, select, setSelectOptions, setSelectValue, setSliderValue, slider } from '../ui';

/** The map grid is 64x64 tiles. */
const MAP_TILES = 64;
/** Minimap thumbnails are fetched this size and drawn down (or up, when zoomed in) to a cell. */
const THUMB_SIZE = 32;
const THUMB_BATCH = 64;
/** Zoom 1 fits the map's tiles in the viewport; 8 shows them eight times as large. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1;
/** At zoom 1 a map smaller than this many tiles across is drawn no bigger than this would be. */
const MIN_SPAN = 8;
/** The canvas backing store stays within this many device pixels a side; CSS scales the rest. */
const MAX_CANVAS = 4096;

/**
 * The Copy from world area picker (spec 7.2, specs/scene-dialogs.md §2.2): a Map select, and a
 * panel with a hint line, a zoom row (minus, slider, plus) and a square viewport scrolling
 * over the chosen map's tiles (minimap pictures where they exist), on which the user drags a
 * tile-aligned rectangle of 1x1 to MAX_COPIED_TILES tiles each way. Tiles the map doesn't have
 * may sit inside the rectangle; they become void in the scene. Zoom 1 fits the map's tiles to
 * the viewport; the slider, the buttons and Ctrl/Cmd + wheel zoom, and scrolling pans.
 */
export class CopyPicker {
	/** The Map select, a field of its own above the panel. */
	readonly mapField: HTMLElement;
	/** The panel: hint, zoom row and the map viewport. */
	readonly root: HTMLElement;
	/** The chosen rectangle in map tile coordinates, both corners inclusive. */
	selection: { tileMin: [number, number]; tileMax: [number, number] } | null = null;

	private maps: CopyMap[] = [];
	private summary: MapSummary | null = null;
	/** Decoded minimap pictures by tile index (y * 64 + x), ready to draw. */
	private readonly thumbs = new Map<number, OffscreenCanvas>();
	/** Bumped per map change, so stale summaries and thumbnails are dropped. */
	private generation = 0;
	private drag: { anchor: [number, number] } | null = null;
	private zoom = ZOOM_MIN;
	/** The map's tiles' bounding box, which zoom 1 fits to the viewport. */
	private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;

	private readonly canvas = el('canvas', { class: 'scene-map-canvas', 'aria-label': 'Map overview; drag to pick the area to copy' });
	private readonly viewport = el('div', { class: 'scene-map-viewport ds-scroll' }, this.canvas);
	private readonly hint = el('p', { class: 'scene-dialog-hint', 'aria-live': 'polite' });
	private readonly zoomSlider;
	private readonly mapSelect;
	/** The Map select's value (the select keeps no readable one). */
	private mapId: number | null = null;
	private readonly observer: ResizeObserver;

	constructor(
		private readonly storage: () => AsyncStorageApi,
		private readonly notice: (text: string) => void,
	) {
		this.mapSelect = select({
			label: 'Map',
			options: [],
			value: null,
			placeholder: 'Loading maps…',
			onChange: (value) => {
				this.mapId = Number(value);
				void this.loadMap();
			},
		});
		this.mapField = this.mapSelect.root;
		this.zoomSlider = slider({
			ariaLabel: 'Zoom',
			value: ZOOM_MIN,
			min: ZOOM_MIN,
			max: ZOOM_MAX,
			step: 0.1,
			size: 'sm',
			showInput: false,
			onInput: (value) => this.setZoom(value),
		});
		const zoomRow = el(
			'div',
			{ class: 'scene-map-zoom' },
			iconButton({ icon: 'minus', label: 'Zoom out', variant: 'ghost', size: 'xs', onClick: () => this.setZoom(this.zoom - ZOOM_STEP) }),
			this.zoomSlider.root,
			iconButton({ icon: 'plus', label: 'Zoom in', variant: 'ghost', size: 'xs', onClick: () => this.setZoom(this.zoom + ZOOM_STEP) }),
		);
		this.root = el('div', { class: 'scene-dialog-panel scene-map-panel' }, this.hint, zoomRow, this.viewport);

		this.canvas.addEventListener('pointerdown', this.onDown);
		this.canvas.addEventListener('pointermove', this.onMove);
		this.canvas.addEventListener('pointerup', this.onUp);
		this.canvas.addEventListener('pointercancel', this.onUp);
		this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
		// The viewport's width decides the cell size, so a resize re-lays the map out around its centre.
		this.observer = new ResizeObserver(() => this.layout());
		this.observer.observe(this.viewport);
		this.describe();
	}

	/** The chosen map, or null while the list loads. */
	get map(): CopyMap | null {
		return this.maps.find((m) => m.id === this.mapId) ?? null;
	}

	/** Fills the map list on first open (parsing every WDT takes a moment) and shows the map. */
	async open(): Promise<void> {
		if (!this.maps.length) {
			try {
				this.maps = await this.storage().listCopyMaps();
			} catch (e) {
				this.notice(`The map list can't be read: ${e instanceof Error ? e.message : e}`);
				return;
			}
			// Maps are listed by name; a repeated name gets its directory after it.
			const names = new Map<string, number>();
			for (const m of this.maps) names.set(m.name, (names.get(m.name) ?? 0) + 1);
			setSelectOptions(
				this.mapSelect.root,
				this.maps.map((m) => ({ value: String(m.id), label: (names.get(m.name) ?? 0) > 1 ? `${m.name} (${m.directory})` : m.name })),
			);
			if (this.maps.length) {
				this.mapId = this.maps[0].id;
				setSelectValue(this.mapSelect.root, String(this.mapId));
			}
		}
		await this.loadMap();
	}

	/** Stops listening; the picker is not reused after its dialog closes. */
	dispose(): void {
		this.generation++;
		this.observer.disconnect();
	}

	private async loadMap(): Promise<void> {
		const generation = ++this.generation;
		this.summary = null;
		this.bounds = null;
		this.selection = null;
		this.drag = null;
		this.thumbs.clear();
		this.draw();
		this.describe();
		const map = this.map;
		if (!map) return;
		let summary: MapSummary;
		try {
			summary = await this.storage().loadMap(map.wdt);
		} catch (e) {
			this.notice(`The map can't be read: ${e instanceof Error ? e.message : e}`);
			return;
		}
		if (generation !== this.generation) return;
		this.summary = summary;
		if (summary.tiles.length) {
			const xs = summary.tiles.map((t) => t.x);
			const ys = summary.tiles.map((t) => t.y);
			this.bounds = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
		}
		this.zoom = ZOOM_MIN;
		setSliderValue(this.zoomSlider.root, this.zoom);
		this.layout();
		this.centreOnMap();
		this.describe();
		// Minimap pictures fill in batch by batch behind the grid.
		const coords = summary.tiles.map((t) => [t.x, t.y] as [number, number]);
		for (let i = 0; i < coords.length; i += THUMB_BATCH) {
			let batch: { x: number; y: number; image: { width: number; height: number; rgba: Uint8Array } | null }[];
			try {
				batch = await this.storage().minimapThumbnails(map.wdt, coords.slice(i, i + THUMB_BATCH), THUMB_SIZE);
			} catch {
				return;
			}
			if (generation !== this.generation) return;
			for (const tile of batch) {
				if (!tile.image) continue;
				const off = new OffscreenCanvas(tile.image.width, tile.image.height);
				off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tile.image.rgba), tile.image.width, tile.image.height), 0, 0);
				this.thumbs.set(tile.y * MAP_TILES + tile.x, off);
			}
			this.draw();
		}
	}

	// ---- Zoom and layout ----

	/** A tile's side in CSS pixels at the current zoom: zoom 1 fits the map's tiles to the viewport. */
	private cellSize(): number {
		const width = this.viewport.clientWidth || 342;
		const span = this.bounds ? Math.max(MIN_SPAN, this.bounds.x1 - this.bounds.x0 + 1, this.bounds.y1 - this.bounds.y0 + 1) : MAP_TILES;
		return (width / span) * this.zoom;
	}

	/** Sizes the canvas for the zoom, keeping what was under the viewport's centre (or `focus`) in place. */
	private layout(focus?: { x: number; y: number }): void {
		const before = Number(this.canvas.style.width.replace('px', '')) || 0;
		const fx = focus?.x ?? this.viewport.clientWidth / 2;
		const fy = focus?.y ?? this.viewport.clientHeight / 2;
		const keepX = before ? (this.viewport.scrollLeft + fx) / before : 0.5;
		const keepY = before ? (this.viewport.scrollTop + fy) / before : 0.5;
		const css = this.cellSize() * MAP_TILES;
		const dpr = window.devicePixelRatio || 1;
		const backing = Math.round(Math.min(MAX_CANVAS, css * dpr));
		this.canvas.style.width = `${css}px`;
		this.canvas.style.height = `${css}px`;
		if (this.canvas.width !== backing) this.canvas.width = this.canvas.height = backing;
		this.draw();
		if (before) {
			this.viewport.scrollLeft = keepX * css - fx;
			this.viewport.scrollTop = keepY * css - fy;
		}
	}

	/** Scrolls so the map's tiles sit in the middle of the viewport. */
	private centreOnMap(): void {
		const cell = this.cellSize();
		const b = this.bounds ?? { x0: 0, y0: 0, x1: MAP_TILES - 1, y1: MAP_TILES - 1 };
		this.viewport.scrollLeft = ((b.x0 + b.x1 + 1) / 2) * cell - this.viewport.clientWidth / 2;
		this.viewport.scrollTop = ((b.y0 + b.y1 + 1) / 2) * cell - this.viewport.clientHeight / 2;
	}

	private setZoom(zoom: number, focus?: { x: number; y: number }): void {
		const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom * 10) / 10));
		if (next === this.zoom) return;
		this.zoom = next;
		setSliderValue(this.zoomSlider.root, next);
		this.layout(focus);
	}

	private readonly onWheel = (e: WheelEvent): void => {
		// Plain scrolling pans; with Ctrl or Cmd (a trackpad pinch) it zooms about the cursor.
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const rect = this.viewport.getBoundingClientRect();
		this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top });
	};

	// ---- The selection ----

	/** The map tile under a pointer event, clamped to the grid. */
	private tileAt(e: PointerEvent): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		const x = Math.floor(((e.clientX - rect.left) / rect.width) * MAP_TILES);
		const y = Math.floor(((e.clientY - rect.top) / rect.height) * MAP_TILES);
		return [Math.max(0, Math.min(MAP_TILES - 1, x)), Math.max(0, Math.min(MAP_TILES - 1, y))];
	}

	private readonly onDown = (e: PointerEvent): void => {
		if (e.button !== 0 || !this.summary) return;
		e.preventDefault();
		this.canvas.setPointerCapture(e.pointerId);
		const anchor = this.tileAt(e);
		this.drag = { anchor };
		this.applyDrag(anchor);
	};

	private readonly onMove = (e: PointerEvent): void => {
		if (this.drag) this.applyDrag(this.tileAt(e));
	};

	private readonly onUp = (): void => {
		this.drag = null;
	};

	/** The rectangle between the anchor and the cursor, the far corner held within the limit. */
	private applyDrag(to: [number, number]): void {
		const anchor = this.drag!.anchor;
		const clamp = (a: number, c: number) => Math.max(a - (MAX_COPIED_TILES - 1), Math.min(a + (MAX_COPIED_TILES - 1), c));
		const cx = clamp(anchor[0], to[0]);
		const cy = clamp(anchor[1], to[1]);
		this.selection = {
			tileMin: [Math.min(anchor[0], cx), Math.min(anchor[1], cy)],
			tileMax: [Math.max(anchor[0], cx), Math.max(anchor[1], cy)],
		};
		this.draw();
		this.describe();
	}

	/** The hint line: how to pick, or the pick's size in tiles and yards and any void tiles in it. */
	private describe(): void {
		if (this.map && !this.summary) {
			this.hint.textContent = 'Loading the map overview…';
			return;
		}
		if (!this.selection) {
			this.hint.textContent = `Drag a rectangle of up to ${MAX_COPIED_TILES}x${MAX_COPIED_TILES} tiles on the map.`;
			return;
		}
		const { tileMin, tileMax } = this.selection;
		const w = tileMax[0] - tileMin[0] + 1;
		const h = tileMax[1] - tileMin[1] + 1;
		let empty = 0;
		for (let y = tileMin[1]; y <= tileMax[1]; y++) {
			for (let x = tileMin[0]; x <= tileMax[0]; x++) {
				if (!this.summary!.tiles.some((t) => t.x === x && t.y === y)) empty++;
			}
		}
		this.hint.textContent =
			`${w}x${h} tiles · ${Math.round(w * TILE_SIZE)}x${Math.round(h * TILE_SIZE)} yd` +
			` · tiles ${tileMin[0]}_${tileMin[1]} to ${tileMax[0]}_${tileMax[1]}` +
			(empty ? ` · ${empty} empty tile${empty === 1 ? '' : 's'} (void)` : '');
	}

	// ---- Drawing ----

	private draw(): void {
		const ctx = this.canvas.getContext('2d');
		if (!ctx || !this.canvas.width) return;
		// The page's tokens colour the map: the page behind it, plain surfaces for tiles without a
		// picture, and the accent for the pick (its wash is the accent at low alpha, since the
		// selection token is a color-mix the canvas can't take).
		const style = getComputedStyle(this.canvas);
		const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
		const page = token('--color-bg-page', '#0d0d0d');
		const surface = token('--color-bg-surface', '#383838');
		const accent = token('--color-accent', '#006fb4');
		const css = this.cellSize() * MAP_TILES;
		const scale = this.canvas.width / css;
		const cell = this.cellSize();
		ctx.setTransform(scale, 0, 0, scale, 0, 0);
		ctx.globalAlpha = 1;
		ctx.fillStyle = page;
		ctx.fillRect(0, 0, css, css);
		if (this.summary) {
			ctx.fillStyle = surface;
			for (const tile of this.summary.tiles) {
				const thumb = this.thumbs.get(tile.y * MAP_TILES + tile.x);
				if (thumb) ctx.drawImage(thumb, tile.x * cell, tile.y * cell, cell, cell);
				else ctx.fillRect(tile.x * cell, tile.y * cell, cell, cell);
			}
		}
		if (this.selection) {
			const { tileMin, tileMax } = this.selection;
			const x = tileMin[0] * cell;
			const y = tileMin[1] * cell;
			const w = (tileMax[0] - tileMin[0] + 1) * cell;
			const h = (tileMax[1] - tileMin[1] + 1) * cell;
			ctx.globalAlpha = 0.2;
			ctx.fillStyle = accent;
			ctx.fillRect(x, y, w, h);
			ctx.globalAlpha = 1;
			ctx.strokeStyle = accent;
			ctx.lineWidth = 2;
			ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
		}
	}
}
