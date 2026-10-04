import * as THREE from 'three';
import type { Ride } from './flyControls';
import type { ObjectManager } from './objects';
import { worldFromWow } from './regionData';
import type { ContinentPlacement } from './terrain';

export type TransportKind = 'ship' | 'zeppelin';

/** public/spawns/transports.json, from VMaNGOS's transports and the client's TaxiPathNode (tools/buildRegions.ts). */
interface TransportFile {
	transports: {
		entry: number;
		name: string;
		kind: TransportKind;
		/** The WMO it's drawn with. */
		model: number;
		/** A round trip, in ms. */
		period: number;
		/**
		 * The route, a leg per unbroken stretch (it jumps between them, and from the last back to the
		 * first): [x, y, z, wait in seconds, ...] in WoW coordinates. As in the game's splines, a leg's
		 * first and last nodes only shape the curve; the transport travels from its second to its second-last.
		 */
		legs: { map: number; points: number[] }[];
	}[];
}

/** Where the camera sits on board, in the model's own space (x aft, y right, z up). */
const SEATS: Record<TransportKind, THREE.Vector3> = {
	ship: new THREE.Vector3(-8, 0, 15),
	zeppelin: new THREE.Vector3(-3, -8, -12),
};
/** Yards: transports nearer the camera than this are placed in the world, and let go again past FAR. */
const NEAR = 3000;
const FAR = 3600;
/** ms a transport takes to get up to speed leaving a dock, and to slow down coming in. */
const RAMP = 15000;
/** Yards: docks of different transports this close together are the same pier or tower. */
const SAME_DOCK = 250;
/** Arc-length samples per stretch between two nodes, so the speed stays even along a curve. */
const DIVISIONS = 16;

/** WoW coordinates (x north, y west, z up) -> the world's axes, without the map's placement. */
const WORLD_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));

interface Leg {
	map: number;
	/** Through the nodes, in WoW coordinates. */
	curve: THREE.CatmullRomCurve3;
	length: number;
}

/** A stretch of the timetable: waiting at a dock, or moving along a leg from one arc length to another. */
interface Stage {
	leg: number;
	from: number;
	to: number;
	/** ms into the period. */
	start: number;
	duration: number;
	dock: boolean;
	/** Moving off from a dock, or coming in to one: the speed ramps there. */
	easeIn: boolean;
	easeOut: boolean;
}

export interface Transport {
	entry: number;
	name: string;
	kind: TransportKind;
	model: number;
	period: number;
	legs: Leg[];
	stages: Stage[];
	/** ms into each period at which the timetable starts (where a wait at a dock runs over the period's end). */
	shift: number;
	/** The stages spent at a dock, in route order: the stage's index, where the dock is (WoW coordinates) and what it's called. */
	docks: { stage: number; map: number; point: THREE.Vector3; name: string }[];
	/** Placed in the world (near the camera). */
	placed: boolean;
}

/** Where a transport is at a moment. */
interface Pose {
	transport: Transport;
	leg: Leg;
	stage: number;
	/** ms until the stage ends. */
	remaining: number;
	/** WoW coordinates, and its facing (WoW orientation: radians from north towards west). */
	position: THREE.Vector3;
	facing: number;
}

/** Share of a stretch covered after t of its duration ms, ramping up or down at the ends. */
function eased(stage: Stage, t: number): number {
	const ramp = Math.min(RAMP, stage.duration / 3);
	const a = stage.easeIn ? ramp : 0;
	const b = stage.easeOut ? ramp : 0;
	// Full speed in the middle, such that the whole stretch takes its duration.
	const v = 1 / (stage.duration - a / 2 - b / 2);
	if (t < a) return (v * t * t) / (2 * a);
	if (t > stage.duration - b) return 1 - (v * (stage.duration - t) ** 2) / (2 * b);
	return v * (a / 2 + t - a);
}

/**
 * The boats and zeppelins, sailing and flying their routes on the server's schedule: each round
 * trip takes its period, so a transport is in the same place at the same moment for everyone. The
 * waits at the docks take their share of it and the moving stretches share the rest by length.
 * Those near the camera are drawn (by the ObjectManager, as buildings), and can be ridden.
 */
export class Transports {
	private list: Transport[] = [];
	private placements = new Map<number, ContinentPlacement>();
	private readonly matrix = new THREE.Matrix4();
	private readonly turn = new THREE.Matrix4();
	private readonly tangent = new THREE.Vector3();
	/** Called once the transports are read. */
	onChange: () => void = () => {};

	constructor(private readonly objects: ObjectManager) {}

	static async loadFile(): Promise<TransportFile | null> {
		try {
			const response = await fetch('spawns/transports.json');
			return response.ok ? ((await response.json()) as TransportFile) : null;
		} catch (e) {
			console.warn('Boats and zeppelins unavailable:', e);
			return null;
		}
	}

	/** areaName names a dock from where it is, when the transport's own name doesn't say. */
	setData(file: TransportFile, continents: ContinentPlacement[], areaName: (mapId: number, x: number, y: number) => string | null): void {
		this.placements = new Map(continents.filter((c) => !c.instance).map((c) => [c.mapId, c]));
		for (const t of this.list) this.objects.removeLoose(`transport:${t.entry}`);
		this.list = file.transports.map((t) => {
			const nodes = t.legs.map((l) => {
				const points: THREE.Vector3[] = [];
				const waits: number[] = [];
				for (let i = 0; i + 3 < l.points.length; i += 4) {
					points.push(new THREE.Vector3(l.points[i], l.points[i + 1], l.points[i + 2]));
					waits.push(l.points[i + 3] * 1000);
				}
				return { points, waits };
			});
			const legs = t.legs.map((l, i): Leg => {
				const curve = new THREE.CatmullRomCurve3(nodes[i].points, false, 'centripetal');
				curve.arcLengthDivisions = Math.max(1, nodes[i].points.length - 1) * DIVISIONS;
				return { map: l.map, curve, length: curve.getLength() };
			});
			// Moving time per yard: what's left of the period after the waits, over the whole route
			// (without each leg's end nodes, which are only there to shape it).
			const travelled = (n: { waits: number[] }) => n.waits.slice(1, -1);
			const waiting = nodes.reduce((sum, n) => sum + travelled(n).reduce((a, b) => a + b, 0), 0);
			const length = legs.reduce((sum, l, i) => {
				const lengths = l.curve.getLengths();
				const count = nodes[i].points.length;
				return sum + (count > 2 ? lengths[(count - 2) * DIVISIONS] - lengths[DIVISIONS] : l.length);
			}, 0);
			const perYard = Math.max(0, t.period - waiting) / length;
			const stages: Stage[] = [];
			let time = 0;
			legs.forEach((leg, li) => {
				// The curve passes through node i at the arc length of division i * DIVISIONS.
				const lengths = leg.curve.getLengths();
				const at = (i: number) => lengths[i * DIVISIONS];
				const { points, waits } = nodes[li];
				const first = Math.min(1, points.length - 1);
				const end = Math.max(first, points.length - 2);
				let from = at(first);
				let fromDock = false;
				for (let i = first; i <= end; i++) {
					if (i > first && (waits[i] > 0 || i === end) && at(i) > from) {
						const duration = (at(i) - from) * perYard;
						stages.push({ leg: li, from, to: at(i), start: time, duration, dock: false, easeIn: fromDock, easeOut: waits[i] > 0 });
						time += duration;
						from = at(i);
						fromDock = false;
					}
					if (waits[i] > 0) {
						stages.push({ leg: li, from, to: from, start: time, duration: waits[i], dock: true, easeIn: false, easeOut: false });
						time += waits[i];
						fromDock = true;
					}
				}
			});
			const pointOf = (s: Stage) => legs[s.leg].curve.getPointAt(s.from / legs[s.leg].length);
			// A loop that starts and ends at the same dock waits there over the period's end: one wait,
			// so the timetable starts that much into the period.
			let shift = 0;
			const [head, tail] = [stages[0], stages.at(-1)!];
			if (stages.length > 2 && head.dock && tail.dock && legs[head.leg].map === legs[tail.leg].map && pointOf(head).distanceTo(pointOf(tail)) < 1) {
				shift = head.duration;
				stages.shift();
				for (const s of stages) s.start -= shift;
				tail.duration += shift;
			}
			const dockStages = stages.flatMap((s, i) => (s.dock ? [i] : []));
			// "Ratchet and Booty Bay": the docks in the order the route reaches them.
			const named = t.name.split(' and ');
			const docks = dockStages.map((stage, i) => {
				const s = stages[stage];
				const map = legs[s.leg].map;
				const point = pointOf(s);
				return { stage, map, point, name: (named.length === dockStages.length ? named[i] : null) ?? areaName(map, point.x, point.y) ?? 'the dock' };
			});
			return { entry: t.entry, name: t.name, kind: t.kind, model: t.model, period: t.period, legs, stages, shift, docks, placed: false };
		}).filter((t) => t.stages.length);
		this.onChange();
	}

	/** Every boat and zeppelin, by name. */
	get transports(): Transport[] {
		return this.list;
	}

	get(entry: number): Transport | undefined {
		return this.list.find((t) => t.entry === entry);
	}

	/** How far into its timetable a transport is at a moment (ms since 1970). */
	private phase(t: Transport, now: number): number {
		return THREE.MathUtils.euclideanModulo(now - t.shift, t.period);
	}

	/** Where a transport is at a moment. */
	private pose(t: Transport, now: number): Pose {
		const phase = this.phase(t, now);
		let i = t.stages.length - 1;
		while (i > 0 && t.stages[i].start > phase) i--;
		const s = t.stages[i];
		const leg = t.legs[s.leg];
		const into = THREE.MathUtils.clamp(phase - s.start, 0, s.duration);
		const along = s.dock ? s.from : s.from + (s.to - s.from) * eased(s, into);
		const u = THREE.MathUtils.clamp(along / leg.length, 0, 1);
		const position = leg.curve.getPointAt(u);
		const d = leg.curve.getTangentAt(u, this.tangent);
		return { transport: t, leg, stage: i, remaining: s.duration - into, position, facing: Math.atan2(d.y, d.x) };
	}

	/** A pose's world matrix, or null when its map isn't laid out. */
	private place(pose: Pose, out: THREE.Matrix4): THREE.Matrix4 | null {
		const placement = this.placements.get(pose.leg.map);
		if (!placement) return null;
		const p = worldFromWow(placement, pose.position.x, pose.position.y, pose.position.z);
		// The ship's and the zeppelin's bows point down their models' -x.
		return out.makeTranslation(p.x, p.y, p.z).multiply(WORLD_BASIS).multiply(this.turn.makeRotationZ(pose.facing + Math.PI));
	}

	/** Moves the transports to where they are now, placing those near the camera and letting the rest go. */
	update(now: number, camera: THREE.Vector3): void {
		for (const t of this.list) {
			const key = `transport:${t.entry}`;
			const m = this.place(this.pose(t, now), this.matrix);
			const distance = m ? camera.distanceTo(new THREE.Vector3().setFromMatrixPosition(m)) : Infinity;
			if (m && distance < (t.placed ? FAR : NEAR)) {
				this.objects.placeLoose(key, 'wmo', t.model, m);
				t.placed = true;
			} else if (t.placed) {
				this.objects.removeLoose(key);
				t.placed = false;
			}
		}
	}

	/** Where on board the camera goes now, and which way the transport faces (camera yaw); null off the laid-out maps. */
	seat(t: Transport, now: number): { position: THREE.Vector3; yaw: number } | null {
		const pose = this.pose(t, now);
		const m = this.place(pose, new THREE.Matrix4());
		// Facing north (0) is yaw 0; both turn the same way.
		return m ? { position: SEATS[t.kind].clone().applyMatrix4(m), yaw: pose.facing } : null;
	}

	/** Riding on board, wherever it goes, until got off. */
	ride(t: Transport): Ride {
		let last: THREE.Vector3 | null = null;
		const heading = new THREE.Vector3();
		return {
			step: () => {
				const seat = this.seat(t, Date.now());
				if (seat) {
					last = seat.position;
					heading.set(-Math.sin(seat.yaw), 0, -Math.cos(seat.yaw));
				}
				return last;
			},
			heading: () => heading,
		};
	}

	/** What a transport is doing: at which dock and for how long more, or which it's making for and when it gets there. */
	status(t: Transport, now: number): { docked: boolean; dock: string; seconds: number; next: string } {
		const pose = this.pose(t, now);
		const phase = this.phase(t, now);
		// The dock it's at, or the next one along.
		let k = t.docks.findIndex((d) => d.stage >= pose.stage);
		if (k < 0) k = 0;
		const dock = t.docks[k];
		const next = t.docks[(k + 1) % t.docks.length];
		const docked = dock.stage === pose.stage;
		const seconds = docked ? pose.remaining : THREE.MathUtils.euclideanModulo(t.stages[dock.stage].start - phase, t.period);
		return { docked, dock: dock.name, seconds: seconds / 1000, next: (docked ? next : dock).name };
	}

	/**
	 * The dock nearest a point on a map, and when each transport calling there next leaves it
	 * (seconds) and for where; null if no transport calls on this map.
	 */
	nearestDock(position: THREE.Vector3, mapId: number, now: number): { name: string; distance: number; departures: { transport: Transport; to: string; seconds: number; docked: boolean }[] } | null {
		const placement = this.placements.get(mapId);
		if (!placement) return null;
		const docks = this.list.flatMap((t) => t.docks.flatMap((d, k) => {
			if (d.map !== mapId) return [];
			const world = worldFromWow(placement, d.point.x, d.point.y, d.point.z);
			return [{ t, d, k, s: t.stages[d.stage], world, distance: world.distanceTo(position) }];
		}));
		if (!docks.length) return null;
		const nearest = docks.reduce((a, b) => (b.distance < a.distance ? b : a));
		const departures = docks.filter((d) => d.world.distanceTo(nearest.world) < SAME_DOCK).map(({ t, k, s }) => {
			const left = THREE.MathUtils.euclideanModulo(s.start + s.duration - this.phase(t, now), t.period);
			return { transport: t, to: t.docks[(k + 1) % t.docks.length].name, seconds: left / 1000, docked: left < s.duration };
		}).sort((a, b) => a.seconds - b.seconds);
		return { name: nearest.d.name, distance: nearest.distance, departures };
	}
}
