import * as THREE from 'three';
import type { FlightData } from '../explorer/flights';
import type { Ride } from './flyControls';
import type { Side } from './nameplates';
import { worldFromWow } from './regionData';
import type { ContinentPlacement } from './terrain';
import { behindCamera } from './screen';

export interface FlightMaster {
	id: number;
	name: string;
	mapId: number;
	position: THREE.Vector3;
	alliance: boolean;
	horde: boolean;
}

/** An unbroken stretch of a route, in the world of the continent it is on. */
interface Leg {
	map: number;
	points: THREE.Vector3[];
}

interface Route {
	from: number;
	to: number;
	legs: Leg[];
	/** Yards flown, not counting the jumps between legs. */
	length: number;
	lines: THREE.Line[];
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

	/** The flight network the client's own tables give (TaxiNodes, TaxiPath and TaxiPathNode). */
	setData(file: FlightData, continents: ContinentPlacement[]): void {
		const placements = new Map(continents.filter((c) => !c.instance).map((c) => [c.mapId, c]));
		this.masters.clear();
		for (const n of file.nodes) {
			const placement = placements.get(n.map);
			if (!placement) continue;
			this.masters.set(n.id, { id: n.id, name: n.name, mapId: n.map, position: worldFromWow(placement, n.x, n.y, n.z), alliance: n.alliance, horde: n.horde });
		}
		for (const r of this.routes) for (const line of r.lines) line.geometry.dispose();
		this.group.clear();
		this.routes = [];
		for (const p of file.paths) {
			const from = this.masters.get(p.from);
			const to = this.masters.get(p.to);
			if (!from || !to) continue;
			// A leg on a map that isn't in the world can't be flown, nor so the route.
			if (p.legs.some((leg) => !placements.has(leg.map))) continue;
			const legs: Leg[] = p.legs.map((leg) => {
				const placement = placements.get(leg.map)!;
				const points: THREE.Vector3[] = [];
				for (let i = 0; i < leg.points.length; i += 3) points.push(worldFromWow(placement, leg.points[i], leg.points[i + 1], leg.points[i + 2]));
				return { map: leg.map, points };
			});
			let length = 0;
			const lines = legs.map((leg) => {
				for (let i = 1; i < leg.points.length; i++) length += leg.points[i].distanceTo(leg.points[i - 1]);
				const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leg.points), this.materials.alliance);
				line.frustumCulled = true;
				this.group.add(line);
				return line;
			});
			this.routes.push({ from: p.from, to: p.to, legs, length, lines });
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
			for (const line of r.lines) {
				line.visible = this.usable(r);
				line.material = this.materials[this.side];
			}
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
	plan(from: number, to: number): { legs: THREE.Vector3[][]; stops: string[]; length: number } | null {
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
		// The routes one after another; where one ends the flight master the next starts at, on the same map, they join.
		const legs: THREE.Vector3[][] = [];
		let lastMap = -1;
		for (const r of chain) {
			r.legs.forEach((leg, k) => {
				if (k === 0 && legs.length && leg.map === lastMap) legs.at(-1)!.push(...leg.points.slice(1));
				else legs.push([...leg.points]);
				lastMap = leg.map;
			});
		}
		return { legs, stops: chain.slice(0, -1).map((r) => this.masters.get(r.to)!.name), length: distance.get(to)! };
	}

	/**
	 * A ride along a planned flight, at a multiple of the mounts' speed. It flies each leg to its end and
	 * then starts the next where it begins, a jump to the other side of the world as in the game.
	 */
	ride(legs: THREE.Vector3[][], speedScale = 1): Ride & { remaining(): number } {
		const curves = legs.map((points) => {
			const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone().setY(p.y + SEAT)), false, 'centripetal');
			// Fine enough steps that the speed stays even over a path kilometres long.
			curve.arcLengthDivisions = points.length * 8;
			return { curve, length: curve.getLength() };
		});
		const total = curves.reduce((sum, c) => sum + c.length, 0);
		const speed = FLIGHT_SPEED * speedScale;
		let travelled = 0;
		const tangent = new THREE.Vector3();
		const point = new THREE.Vector3();
		/** The leg a distance is on, and how far along it. */
		const locate = (distance: number) => {
			let start = 0;
			for (const c of curves) {
				if (distance < start + c.length) return { c, at: distance - start };
				start += c.length;
			}
			const last = curves.at(-1)!;
			return { c: last, at: last.length };
		};
		return {
			step(dt: number) {
				travelled += dt * speed;
				if (travelled >= total) return null;
				const { c, at } = locate(travelled);
				return c.curve.getPointAt(at / c.length, point);
			},
			heading() {
				// A little ahead, so turns are seen coming, but not past the end of the leg.
				const { c, at } = locate(travelled);
				return c.curve.getTangentAt(Math.min(1, (at + speed * 1.5) / c.length), tangent).normalize();
			},
			remaining: () => Math.max(0, (total - travelled) / speed),
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
