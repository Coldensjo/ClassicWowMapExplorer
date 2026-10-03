import * as THREE from 'three';
import { TILE_SIZE } from '../formats/adt';
import { MAP_ORIGIN, worldFromWow, type RegionData, type TavernEntry } from './regionData';
import type { ContinentPlacement } from './terrain';
import { behindCamera } from './screen';

/** Yards; inn names show within this distance. */
const RANGE = 1500;
const COLOR = 0xffd060;

interface Rested {
	tavern: TavernEntry;
	placement: ContinentPlacement;
	/** Where its name goes: the top of the shape. */
	top: THREE.Vector3;
}

/**
 * The inns and cities where resting builds up (areatrigger_tavern): the server's own trigger
 * shapes, drawn as glowing spheres and boxes, with their names, and whether the camera is in one.
 */
export class RestedAreas {
	readonly group = new THREE.Group();
	private rested: Rested[] = [];
	private readonly pool: HTMLDivElement[] = [];
	private readonly projected = new THREE.Vector3();
	private inside: Rested | null = null;
	private lastCheck = 0;
	private readonly material = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
	private readonly lineMaterial = new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0.6 });

	constructor(private readonly container: HTMLElement) {
		this.group.visible = false;
		this.group.name = 'rested areas';
	}

	setData(data: RegionData, continents: ContinentPlacement[]): void {
		for (const child of [...this.group.children]) {
			this.group.remove(child);
			(child as THREE.Mesh).geometry?.dispose();
		}
		this.rested = [];
		const placements = new Map(continents.filter((c) => !c.instance).map((c) => [c.mapId, c]));
		for (const t of data.taverns) {
			const placement = placements.get(t.map);
			if (!placement) continue;
			const centre = worldFromWow(placement, t.x, t.y, t.z);
			let shape: THREE.BufferGeometry;
			let topY: number;
			if (t.box) {
				// Length along WoW x (world -z), width along WoW y (world -x); a box looks the same turned half round.
				const [length, width, height, o] = t.box;
				shape = new THREE.BoxGeometry(width, height, length);
				shape.rotateY(o);
				topY = height / 2;
			} else {
				shape = new THREE.SphereGeometry(t.radius, 24, 12);
				topY = t.radius;
			}
			const mesh = new THREE.Mesh(shape, this.material);
			mesh.position.copy(centre);
			mesh.renderOrder = 10;
			const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shape, 20), this.lineMaterial);
			edges.position.copy(centre);
			this.group.add(mesh, edges);
			this.rested.push({ tavern: t, placement, top: centre.clone().setY(centre.y + topY) });
		}
	}

	set shown(shown: boolean) {
		this.group.visible = shown;
		if (!shown) {
			this.inside = null;
			this.hideFrom(0);
		}
	}

	get shown(): boolean {
		return this.group.visible;
	}

	/** Whether the camera stands in one, for the panel. */
	get status(): string {
		if (!this.shown) return '';
		return this.inside ? `Rested area: ${this.inside.tavern.place}` : '';
	}

	update(now: number, camera: THREE.PerspectiveCamera, width: number, height: number): void {
		if (!this.shown) return;
		const cam = camera.position;
		if (now - this.lastCheck > 250) {
			this.lastCheck = now;
			this.inside = this.rested.find((r) => this.contains(r, cam)) ?? null;
		}
		let shown = 0;
		for (const r of this.rested) {
			const distance = r.top.distanceTo(cam);
			if (distance > RANGE) continue;
			this.projected.copy(r.top).project(camera);
			if (behindCamera(this.projected, camera) || Math.abs(this.projected.x) > 1.05 || Math.abs(this.projected.y) > 1.05) continue;
			const el = this.element(shown++);
			const [name, detail] = el.children as unknown as [HTMLElement, HTMLElement];
			if (name.textContent !== r.tavern.name) name.textContent = r.tavern.name;
			detail.textContent = `${distance.toFixed(0)} yd`;
			el.classList.toggle('current', r === this.inside);
			const x = (this.projected.x * 0.5 + 0.5) * width;
			const y = (-this.projected.y * 0.5 + 0.5) * height;
			el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
			el.style.opacity = String(1 - 0.5 * Math.min(1, distance / RANGE));
			el.hidden = false;
		}
		this.hideFrom(shown);
	}

	/** Whether a world position is inside an inn's trigger, worked out in WoW coordinates as the server does. */
	private contains(r: Rested, p: THREE.Vector3): boolean {
		const t = r.tavern;
		const x = MAP_ORIGIN - (p.z - r.placement.offsetY * TILE_SIZE);
		const y = MAP_ORIGIN - (p.x - r.placement.offsetX * TILE_SIZE);
		const dx = x - t.x, dy = y - t.y, dz = p.y - t.z;
		if (!t.box) return dx * dx + dy * dy + dz * dz <= t.radius * t.radius;
		const [length, width, height, o] = t.box;
		const lx = dx * Math.cos(o) + dy * Math.sin(o);
		const ly = -dx * Math.sin(o) + dy * Math.cos(o);
		return Math.abs(lx) <= length / 2 && Math.abs(ly) <= width / 2 && Math.abs(dz) <= height / 2;
	}

	private element(i: number): HTMLDivElement {
		let el = this.pool[i];
		if (!el) {
			el = document.createElement('div');
			el.className = 'beacon rested';
			const name = document.createElement('span');
			name.className = 'beacon-name';
			const detail = document.createElement('span');
			detail.className = 'beacon-distance';
			el.append(name, detail);
			this.container.prepend(el);
			this.pool[i] = el;
		}
		return el;
	}

	private hideFrom(i: number): void {
		for (; i < this.pool.length; i++) if (!this.pool[i].hidden) this.pool[i].hidden = true;
	}
}
