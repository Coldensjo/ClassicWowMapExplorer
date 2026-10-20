import type { CopyMap } from '../explorer/copyWorld';
import type { MapSummary } from '../explorer/maps';
import { TILE_SIZE } from '../formats/adt';
import { MAX_COPIED_TILES } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The map grid is 64x64 tiles; each is drawn CELL pixels across (canvas 512x512). */
const MAP_TILES = 64;
const CELL = 8;
/** Minimap thumbnails are fetched this size and drawn down to a cell. */
const THUMB_SIZE = 16;
const THUMB_BATCH = 64;

/**
 * The Copy from world area picker (spec 7.2): a map list and a top-down overview of the chosen
 * map's tiles (minimap pictures where they exist), on which the user drags a tile-aligned
 * rectangle of 1x1 to 6x6 tiles. Tiles the map doesn't have may sit inside the rectangle; they
 * become void in the scene.
 */
export class CopyPicker {
	private maps: CopyMap[] = [];
	private summary: MapSummary | null = null;
	/** Decoded minimap pictures by tile index (y * 64 + x), ready to draw. */
	private readonly thumbs = new Map<number, OffscreenCanvas>();
	/** Bumped per map change, so stale summaries and thumbnails are dropped. */
	private generation = 0;
	private drag: { anchor: [number, number] } | null = null;
	/** The chosen rectangle in map tile coordinates, both corners inclusive. */
	selection: { tileMin: [number, number]; tileMax: [number, number] } | null = null;

	private readonly canvas = $<HTMLCanvasElement>('scene-map-canvas');

	constructor(
		private readonly storage: () => AsyncStorageApi,
		private readonly notice: (text: string) => void,
	) {
		this.canvas.addEventListener('mousedown', this.onDown);
		window.addEventListener('mousemove', this.onMove);
		window.addEventListener('mouseup', this.onUp);
		$('scene-map').addEventListener('change', () => void this.loadMap());
	}

	/** The chosen map, or null while the list loads. */
	get map(): CopyMap | null {
		const id = Number($<HTMLSelectElement>('scene-map').value);
		return this.maps.find((m) => m.id === id) ?? null;
	}

	/** Fills the map list on first open (parsing every WDT takes a moment) and shows the map. */
	async open(): Promise<void> {
		const select = $<HTMLSelectElement>('scene-map');
		if (!this.maps.length) {
			select.replaceChildren(new Option('Loading maps…', ''));
			select.disabled = true;
			try {
				this.maps = await this.storage().listCopyMaps();
			} catch (e) {
				this.notice(`The map list can't be read: ${e instanceof Error ? e.message : e}`);
				return;
			}
			select.replaceChildren(...this.maps.map((m) => new Option(`${m.name} (${m.tileCount} tiles)`, String(m.id))));
			select.disabled = false;
		}
		await this.loadMap();
	}

	private async loadMap(): Promise<void> {
		const generation = ++this.generation;
		this.summary = null;
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
		this.draw();
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

	/** The map tile under a mouse event, clamped to the grid. */
	private tileAt(e: MouseEvent): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		const x = Math.floor(((e.clientX - rect.left) / rect.width) * MAP_TILES);
		const y = Math.floor(((e.clientY - rect.top) / rect.height) * MAP_TILES);
		return [Math.max(0, Math.min(MAP_TILES - 1, x)), Math.max(0, Math.min(MAP_TILES - 1, y))];
	}

	private readonly onDown = (e: MouseEvent): void => {
		if (e.button !== 0 || !this.summary) return;
		e.preventDefault();
		const anchor = this.tileAt(e);
		this.drag = { anchor };
		this.applyDrag(anchor);
	};

	private readonly onMove = (e: MouseEvent): void => {
		if (this.drag) this.applyDrag(this.tileAt(e));
	};

	private readonly onUp = (): void => {
		this.drag = null;
	};

	/** The rectangle between the anchor and the cursor, the far corner held to 6 tiles away. */
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

	/** The selection line under the map: size in tiles and yards, and any void tiles in it. */
	private describe(): void {
		const info = $('scene-copy-info');
		if (!this.summary) {
			info.textContent = 'Loading the map overview…';
			return;
		}
		if (!this.selection) {
			info.textContent = `Drag a rectangle of up to ${MAX_COPIED_TILES}×${MAX_COPIED_TILES} tiles over the map.`;
			return;
		}
		const { tileMin, tileMax } = this.selection;
		const w = tileMax[0] - tileMin[0] + 1;
		const h = tileMax[1] - tileMin[1] + 1;
		let empty = 0;
		for (let y = tileMin[1]; y <= tileMax[1]; y++) {
			for (let x = tileMin[0]; x <= tileMax[0]; x++) {
				if (!this.summary.tiles.some((t) => t.x === x && t.y === y)) empty++;
			}
		}
		info.textContent =
			`${w}×${h} tiles · ${Math.round(w * TILE_SIZE)}×${Math.round(h * TILE_SIZE)} yd` +
			` · tiles ${tileMin[0]}_${tileMin[1]} to ${tileMax[0]}_${tileMax[1]}` +
			(empty ? ` · ${empty} empty tile${empty === 1 ? '' : 's'} (void)` : '');
	}

	private draw(): void {
		const ctx = this.canvas.getContext('2d')!;
		ctx.fillStyle = '#14181d';
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
		if (this.summary) {
			ctx.fillStyle = '#2c333b';
			for (const tile of this.summary.tiles) {
				const thumb = this.thumbs.get(tile.y * MAP_TILES + tile.x);
				if (thumb) ctx.drawImage(thumb, tile.x * CELL, tile.y * CELL, CELL, CELL);
				else ctx.fillRect(tile.x * CELL, tile.y * CELL, CELL, CELL);
			}
		}
		if (this.selection) {
			const { tileMin, tileMax } = this.selection;
			const x = tileMin[0] * CELL;
			const y = tileMin[1] * CELL;
			const w = (tileMax[0] - tileMin[0] + 1) * CELL;
			const h = (tileMax[1] - tileMin[1] + 1) * CELL;
			ctx.fillStyle = 'rgba(255, 194, 75, 0.25)';
			ctx.fillRect(x, y, w, h);
			ctx.strokeStyle = '#ffc24b';
			ctx.lineWidth = 1;
			ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
		}
	}
}
