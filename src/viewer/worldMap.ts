import type { MapAssignment, WorldMapInfo } from '../explorer/worldMap';
import type { Image } from '../formats/blp';
import type { AsyncStorageApi } from '../worker/protocol';

/** Where the camera is, in WoW coordinates on a map, and which way it faces (radians, 0 north, turning west). */
export interface WorldMapView {
	mapId: number;
	x: number;
	y: number;
	facing: number;
}

const EXPLORED_KEY = 'mapExplorer.explored';
const ALL_KEY = 'mapExplorer.worldMapAll';
/** UiMap types. */
const CONTINENT = 2;
const ZONE = 3;

/**
 * The game's world map, zone by zone: its pictures, with the parts you've explored filled in as
 * in the game (WorldMapOverlay pieces revealed by their areas), where the camera is, and a click
 * to fly anywhere. Explored areas are those the camera has been down among, remembered between visits.
 */
export class WorldMap {
	private maps: Map<number, WorldMapInfo> | null = null;
	private loading: Promise<void> | null = null;
	private readonly images = new Map<number, HTMLCanvasElement | null>();
	private current: WorldMapInfo | null = null;
	private explored = new Set<number>();
	private showAll = false;
	private saveTimer = 0;
	private readonly ctx: CanvasRenderingContext2D;

	constructor(
		private readonly panel: HTMLElement,
		private readonly canvas: HTMLCanvasElement,
		private readonly storage: AsyncStorageApi,
		private readonly where: () => WorldMapView | null,
		private readonly onPick: (mapId: number, x: number, y: number) => void,
		private readonly areaName: (mapId: number, x: number, y: number) => string | null,
		private readonly arrow: HTMLCanvasElement | null,
		private readonly ui: { title: HTMLElement; up: HTMLButtonElement; count: HTMLElement; all: HTMLInputElement; forget: HTMLButtonElement; close: HTMLButtonElement; hover: HTMLElement },
	) {
		this.ctx = canvas.getContext('2d')!;
		try {
			this.explored = new Set(JSON.parse(localStorage.getItem(EXPLORED_KEY) ?? '[]') as number[]);
			this.showAll = localStorage.getItem(ALL_KEY) === '1';
		} catch {
			// Storage blocked: nothing explored yet.
		}
		ui.all.checked = this.showAll;
		ui.all.addEventListener('change', () => {
			this.showAll = ui.all.checked;
			try {
				localStorage.setItem(ALL_KEY, this.showAll ? '1' : '0');
			} catch {
				// Not remembered.
			}
			this.draw();
		});
		ui.forget.addEventListener('click', () => {
			this.explored.clear();
			this.save();
			this.draw();
		});
		ui.up.addEventListener('click', () => this.goUp());
		ui.close.addEventListener('click', () => this.close());
		canvas.addEventListener('click', (e) => this.click(e));
		canvas.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.goUp();
		});
		canvas.addEventListener('mousemove', (e) => this.hover(e));
		canvas.addEventListener('mouseleave', () => (ui.hover.textContent = ''));
		window.addEventListener('keydown', (e) => {
			if (e.code === 'Escape' && this.isOpen) {
				e.stopPropagation();
				this.close();
			}
		}, true);
	}

	get isOpen(): boolean {
		return !this.panel.hidden;
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else void this.open();
	}

	async open(): Promise<void> {
		this.panel.hidden = false;
		document.exitPointerLock?.();
		await this.load();
		const view = this.where();
		this.show(view ? this.mapAt(view.mapId, view.x, view.y, ZONE) ?? this.mapAt(view.mapId, view.x, view.y, CONTINENT) : null);
	}

	close(): void {
		this.panel.hidden = true;
	}

	/** Marks an area (and the zone it's in, passed too) as explored. */
	explore(areas: number[]): void {
		let added = false;
		for (const a of areas) {
			if (!a || this.explored.has(a)) continue;
			this.explored.add(a);
			added = true;
		}
		if (!added) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => this.save(), 2000);
		if (this.isOpen) this.draw();
	}

	/** Called a few times a second while open, so the arrow follows the camera. */
	update(): void {
		if (this.isOpen && this.current) this.draw();
	}

	private save(): void {
		try {
			localStorage.setItem(EXPLORED_KEY, JSON.stringify([...this.explored]));
		} catch {
			// Not remembered.
		}
	}

	private load(): Promise<void> {
		this.loading ??= this.storage.loadWorldMaps([0, 1]).then((list) => {
			this.maps = new Map(list.map((m) => [m.id, m]));
		}, (e) => {
			console.warn('World map unavailable:', e);
			this.maps = new Map();
		});
		return this.loading;
	}

	/** The smallest map of a type whose world covers a point. */
	private mapAt(mapId: number, x: number, y: number, type: number): WorldMapInfo | null {
		let best: WorldMapInfo | null = null;
		let bestSize = Infinity;
		for (const m of this.maps?.values() ?? []) {
			if (m.type !== type) continue;
			const a = this.assignment(m, mapId, x, y);
			if (!a) continue;
			const size = (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]);
			if (size < bestSize) {
				bestSize = size;
				best = m;
			}
		}
		return best;
	}

	private assignment(m: WorldMapInfo, mapId: number, x: number, y: number): MapAssignment | null {
		return m.assignments.find((a) => a.mapId === mapId && x >= a.min[0] && x <= a.max[0] && y >= a.min[1] && y <= a.max[1]) ?? null;
	}

	/** WoW coordinates -> pixels on a map's picture; north is up, west left. */
	private toPicture(m: WorldMapInfo, a: MapAssignment, x: number, y: number): [number, number] {
		const u = a.uiMin[0] + ((a.max[1] - y) / (a.max[1] - a.min[1])) * (a.uiMax[0] - a.uiMin[0]);
		const v = a.uiMin[1] + ((a.max[0] - x) / (a.max[0] - a.min[0])) * (a.uiMax[1] - a.uiMin[1]);
		return [u * m.width, v * m.height];
	}

	/** Pixels on a map's picture -> WoW coordinates, through whichever of its assignments covers them. */
	private fromPicture(m: WorldMapInfo, px: number, py: number): { mapId: number; x: number; y: number } | null {
		const u = px / m.width;
		const v = py / m.height;
		for (const a of m.assignments) {
			if (u < a.uiMin[0] || u > a.uiMax[0] || v < a.uiMin[1] || v > a.uiMax[1]) continue;
			const fu = (u - a.uiMin[0]) / (a.uiMax[0] - a.uiMin[0]);
			const fv = (v - a.uiMin[1]) / (a.uiMax[1] - a.uiMin[1]);
			return { mapId: a.mapId, x: a.max[0] - fv * (a.max[0] - a.min[0]), y: a.max[1] - fu * (a.max[1] - a.min[1]) };
		}
		return null;
	}

	private show(m: WorldMapInfo | null): void {
		this.current = m;
		this.canvas.width = m?.width ?? 1002;
		this.canvas.height = m?.height ?? 668;
		const parent = m ? this.maps?.get(m.parent) : undefined;
		this.ui.up.hidden = !parent || m!.type === CONTINENT;
		this.ui.up.textContent = parent ? `◂ ${parent.name}` : '';
		this.ui.title.textContent = m?.name ?? 'No map here';
		if (!m) {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			this.ui.count.textContent = '';
			return;
		}
		const files = [...m.tiles.map((t) => t.fdid), ...m.overlays.flatMap((o) => o.tiles.map((t) => t.fdid))].filter((f) => !this.images.has(f));
		this.draw();
		if (!files.length) return;
		for (const f of files) this.images.set(f, null);
		this.storage.loadImages(files).then((images) => {
			images.forEach((img, i) => this.images.set(files[i], img ? toCanvas(img) : null));
			if (this.current === m) this.draw();
		}, (e) => console.warn('World map pictures unavailable:', e));
	}

	private goUp(): void {
		const parent = this.current ? this.maps?.get(this.current.parent) : undefined;
		if (parent && this.current!.type !== CONTINENT) this.show(parent);
	}

	private revealed(o: WorldMapInfo['overlays'][number]): boolean {
		return o.areas.some((a) => this.explored.has(a));
	}

	private draw(): void {
		const m = this.current;
		if (!m) return;
		const ctx = this.ctx;
		ctx.clearRect(0, 0, m.width, m.height);
		for (const t of m.tiles) {
			const img = this.images.get(t.fdid);
			if (img) ctx.drawImage(img, t.col * m.tileWidth, t.row * m.tileHeight);
		}
		let explored = 0;
		for (const o of m.overlays) {
			const shown = this.revealed(o);
			if (shown) explored++;
			if (!shown && !this.showAll) continue;
			// Unexplored parts, when shown anyway, are faded so the explored ones stand out.
			ctx.globalAlpha = shown ? 1 : 0.45;
			for (const t of o.tiles) {
				const img = this.images.get(t.fdid);
				if (img) ctx.drawImage(img, o.x + t.col * o.tileSize, o.y + t.row * o.tileSize);
			}
			ctx.globalAlpha = 1;
		}
		this.ui.count.textContent = m.overlays.length ? `Explored ${explored} of ${m.overlays.length}` : '';

		// The camera's place and heading, if it's on this map.
		const view = this.where();
		const a = view ? this.assignment(m, view.mapId, view.x, view.y) : null;
		if (!view || !a) return;
		const [px, py] = this.toPicture(m, a, view.x, view.y);
		ctx.save();
		ctx.translate(px, py);
		// Facing 0 is north (up on the map), turning west (left) as it grows.
		ctx.rotate(-view.facing);
		if (this.arrow) {
			const s = 32;
			ctx.drawImage(this.arrow, -s / 2, -s / 2, s, s);
		} else {
			ctx.beginPath();
			ctx.moveTo(0, -12);
			ctx.lineTo(8, 9);
			ctx.lineTo(0, 4);
			ctx.lineTo(-8, 9);
			ctx.closePath();
			ctx.fillStyle = '#ffd100';
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2;
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}

	private pictureAt(e: MouseEvent): [number, number] {
		const rect = this.canvas.getBoundingClientRect();
		return [((e.clientX - rect.left) / rect.width) * this.canvas.width, ((e.clientY - rect.top) / rect.height) * this.canvas.height];
	}

	/** On a continent: open the zone clicked. On a zone: fly there. */
	private click(e: MouseEvent): void {
		const m = this.current;
		if (!m) return;
		const at = this.fromPicture(m, ...this.pictureAt(e));
		if (!at) return;
		if (m.type !== ZONE) {
			const zone = this.mapAt(at.mapId, at.x, at.y, ZONE);
			if (zone) this.show(zone);
			return;
		}
		this.onPick(at.mapId, at.x, at.y);
		this.close();
	}

	private hover(e: MouseEvent): void {
		const m = this.current;
		const at = m ? this.fromPicture(m, ...this.pictureAt(e)) : null;
		if (!m || !at) {
			this.ui.hover.textContent = '';
			return;
		}
		const name = m.type === ZONE ? this.areaName(at.mapId, at.x, at.y) : this.mapAt(at.mapId, at.x, at.y, ZONE)?.name ?? null;
		this.ui.hover.textContent = name ? `${name} · ${m.type === ZONE ? 'click to fly there' : 'click to open'}` : '';
	}
}

function toCanvas(img: Image): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
	return canvas;
}
