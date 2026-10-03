import * as THREE from 'three';
import type { Ride } from './flyControls';
import type { Side } from './nameplates';
import { worldFromWow } from './regionData';
import type { ContinentPlacement } from './terrain';
import { behindCamera } from './screen';

/** public/spawns/flights.json, from the client's TaxiNodes, TaxiPath and TaxiPathNode (tools/buildRegions.ts). */
interface FlightFile {
	nodes: { id: number; name: string; map: number; x: number; y: number; z: number; alliance: boolean; horde: boolean }[];
	/** A direct route between two flight masters, as [x, y, z, ...] in WoW coordinates. */
	paths: { id: number; from: number; to: number; cost: number; points: number[] }[];
}

export interface FlightMaster {
	id: number;
	name: string;
	mapId: number;
	position: THREE.Vector3;
	alliance: boolean;
	horde: boolean;
}

interface Route {
	from: number;
	to: number;
	points: THREE.Vector3[];
	length: number;
	line: THREE.Line;
}

/** Yards per second on a gryphon, wyvern or hippogryph, about as in the game. */
export const FLIGHT_SPEED = 32;
/** Yards; flight masters show within this distance. */
const RANGE = 4000;
const LABELLED = 12;
/** Yards above the path the camera rides, sitting on the mount. */
const SEAT = 2;
const COLORS: Record<Side, number> = { alliance: 0x4a90ff, horde: 0xff4a3a };

/**
 * The flight network: routes drawn as lines over the world, flight masters marked, and a ride
 * along the way the game would fly you from one to another (through other flight masters, if
 * there's no direct route), following the client's own flight paths.
 */
export class Flights {
	readonly group = new THREE.Group();
	private masters = new Map<number, FlightMaster>();
	private routes: Route[] = [];
	private side: Side = 'alliance';
	private readonly pool: HTMLDivElement[] = [];
	private readonly projected = new THREE.Vector3();
	private readonly materials: Record<Side, THREE.LineBasicMaterial> = {
		alliance: new THREE.LineBasicMaterial({ color: COLORS.alliance, transparent: true, opacity: 0.85 }),
		horde: new THREE.LineBasicMaterial({ color: COLORS.horde, transparent: true, opacity: 0.85 }),
	};
	/** Called when the list of flight masters for the side shown changes. */
	onChange: () => void = () => {};

	constructor(private readonly container: HTMLElement) {
		this.group.visible = false;
		this.group.name = 'flight paths';
	}

	static async loadFile(): Promise<FlightFile | null> {
		try {
			const response = await fetch('spawns/flights.json');
			return response.ok ? ((await response.json()) as FlightFile) : null;
		} catch (e) {
			console.warn('Flight paths unavailable:', e);
			return null;
		}
	}

	setData(file: FlightFile, continents: ContinentPlacement[]): void {
		const placements = new Map(continents.filter((c) => !c.instance).map((c) => [c.mapId, c]));
		this.masters.clear();
		for (const n of file.nodes) {
			const placement = placements.get(n.map);
			if (!placement) continue;
			this.masters.set(n.id, { id: n.id, name: n.name, mapId: n.map, position: worldFromWow(placement, n.x, n.y, n.z), alliance: n.alliance, horde: n.horde });
		}
		for (const r of this.routes) r.line.geometry.dispose();
		this.group.clear();
		this.routes = [];
		for (const p of file.paths) {
			const from = this.masters.get(p.from);
			const to = this.masters.get(p.to);
			if (!from || !to) continue;
			const placement = placements.get(from.mapId)!;
			const points: THREE.Vector3[] = [];
			for (let i = 0; i < p.points.length; i += 3) points.push(worldFromWow(placement, p.points[i], p.points[i + 1], p.points[i + 2]));
			let length = 0;
			for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
			const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.materials.alliance);
			line.frustumCulled = true;
			this.group.add(line);
			this.routes.push({ from: p.from, to: p.to, points, length, line });
		}
		this.applySide();
	}

	set shown(shown: boolean) {
		this.group.visible = shown;
		if (!shown) this.hideFrom(0);
	}

	get shown(): boolean {
		return this.group.visible;
	}

	setSide(side: Side): void {
		if (side === this.side) return;
		this.side = side;
		this.applySide();
	}

	/** Only the routes and flight masters the side shown can use. */
	private applySide(): void {
		for (const r of this.routes) {
			r.line.visible = this.usable(r);
			r.line.material = this.materials[this.side];
		}
		this.onChange();
	}

	private takes(m: FlightMaster | undefined): boolean {
		return !!m && (this.side === 'alliance' ? m.alliance : m.horde);
	}

	private usable(r: Route): boolean {
		return this.takes(this.masters.get(r.from)) && this.takes(this.masters.get(r.to));
	}

	/** The flight masters the side shown can use, by name. */
	get list(): FlightMaster[] {
		return [...this.masters.values()].filter((m) => this.takes(m)).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** The nearest flight master the side shown can use, on the same map. */
	nearest(position: THREE.Vector3, mapId: number): FlightMaster | null {
		let best: FlightMaster | null = null;
		let bestDistance = Infinity;
		for (const m of this.masters.values()) {
			if (m.mapId !== mapId || !this.takes(m)) continue;
			const d = m.position.distanceTo(position);
			if (d < bestDistance) {
				bestDistance = d;
				best = m;
			}
		}
		return best;
	}

	/**
	 * The way the game would fly you from one flight master to another: the shortest chain of
	 * routes the side can use. Null if there's none.
	 */
	plan(from: number, to: number): { points: THREE.Vector3[]; stops: string[]; length: number } | null {
		if (from === to) return null;
		const distance = new Map<number, number>([[from, 0]]);
		const via = new Map<number, Route>();
		const open = new Set([from]);
		while (open.size) {
			let node = -1;
			let best = Infinity;
			for (const n of open) if (distance.get(n)! < best) {
				best = distance.get(n)!;
				node = n;
			}
			open.delete(node);
			if (node === to) break;
			for (const r of this.routes) {
				if (r.from !== node || !this.usable(r)) continue;
				const d = best + r.length;
				if (d < (distance.get(r.to) ?? Infinity)) {
					distance.set(r.to, d);
					via.set(r.to, r);
					open.add(r.to);
				}
			}
		}
		if (!via.has(to)) return null;
		const chain: Route[] = [];
		for (let n = to; n !== from; n = via.get(n)!.from) chain.unshift(via.get(n)!);
		const points: THREE.Vector3[] = [];
		for (const r of chain) points.push(...(points.length ? r.points.slice(1) : r.points));
		return { points, stops: chain.slice(0, -1).map((r) => this.masters.get(r.to)!.name), length: distance.get(to)! };
	}

	/** A ride along a planned flight, at a multiple of the mounts' speed. */
	ride(points: THREE.Vector3[], speedScale = 1): Ride & { remaining(): number } {
		const lifted = points.map((p) => p.clone().setY(p.y + SEAT));
		const curve = new THREE.CatmullRomCurve3(lifted, false, 'centripetal');
		// Fine enough steps that the speed stays even over a path kilometres long.
		curve.arcLengthDivisions = lifted.length * 8;
		const length = curve.getLength();
		const speed = FLIGHT_SPEED * speedScale;
		let travelled = 0;
		const tangent = new THREE.Vector3();
		const point = new THREE.Vector3();
		return {
			step(dt: number) {
				travelled += dt * speed;
				if (travelled >= length) return null;
				return curve.getPointAt(travelled / length, point);
			},
			heading() {
				// A little ahead, so turns are seen coming.
				return curve.getTangentAt(Math.min(1, (travelled + speed * 1.5) / length), tangent).normalize();
			},
			remaining: () => Math.max(0, (length - travelled) / speed),
		};
	}

	/** Names over the flight masters near the camera. */
	update(camera: THREE.PerspectiveCamera, placement: ContinentPlacement | null, width: number, height: number): void {
		if (!this.shown || !placement) {
			this.hideFrom(0);
			return;
		}
		const cam = camera.position;
		const near = [...this.masters.values()]
			.filter((m) => m.mapId === placement.mapId && this.takes(m))
			.map((m) => ({ m, distance: m.position.distanceTo(cam) }))
			.filter((n) => n.distance < RANGE)
			.sort((a, b) => a.distance - b.distance);
		let shown = 0;
		for (const { m, distance } of near) {
			this.projected.copy(m.position).setY(m.position.y + 4).project(camera);
			if (behindCamera(this.projected, camera) || Math.abs(this.projected.x) > 1.05 || Math.abs(this.projected.y) > 1.05) continue;
			const el = this.element(shown);
			const [name, detail] = el.children as unknown as [HTMLElement, HTMLElement];
			const labelled = shown < LABELLED;
			shown++;
			const text = labelled ? m.name : '';
			if (name.textContent !== text) name.textContent = text;
			detail.textContent = labelled ? `${distance.toFixed(0)} yd` : '';
			el.style.setProperty('--beacon', `#${COLORS[this.side].toString(16)}`);
			const x = (this.projected.x * 0.5 + 0.5) * width;
			const y = (-this.projected.y * 0.5 + 0.5) * height;
			el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
			el.style.opacity = String(1 - 0.5 * Math.min(1, distance / RANGE));
			el.hidden = false;
		}
		this.hideFrom(shown);
	}

	private element(i: number): HTMLDivElement {
		let el = this.pool[i];
		if (!el) {
			el = document.createElement('div');
			el.className = 'beacon flight';
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
