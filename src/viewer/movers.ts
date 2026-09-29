import * as THREE from 'three';
import type { SpawnMovement } from '../explorer/spawns';

/** Pause at each wander stop, seconds. */
const WANDER_PAUSE: [number, number] = [4, 12];
/** Terrain within this many yards of the walker's own height is the ground it walks on. */
const GROUND_SNAP = 3;
/** Turning speed, radians per second. */
const TURN_RATE = Math.PI * 2;

/** Ground height at a world position; NaN or -Infinity where unknown (or a hole). */
export type GroundAt = (x: number, z: number) => number;

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** Shortest signed difference between two angles. */
function angleDelta(from: number, to: number): number {
	return THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

/**
 * A creature walking like the server moves it: round its waypoints (pausing where the path says),
 * or wandering to random spots within its radius of home. Moves the placement's matrix in place.
 */
export class Mover {
	walking = false;
	private readonly position: THREE.Vector3;
	private readonly home: THREE.Vector3;
	private readonly points: THREE.Vector3[] = [];
	private readonly waits: number[] = [];
	/** Placement rotation and scale, without translation. */
	private readonly base: THREE.Matrix4;
	private readonly from = new THREE.Vector3();
	private readonly target = new THREE.Vector3();
	private next = 0;
	private wait: number;
	private facing: number;
	private readonly turn = new THREE.Matrix4();

	/** offset: continent space -> world (the tile's placement). */
	constructor(private readonly movement: SpawnMovement, private readonly matrix: THREE.Matrix4, offset: THREE.Vector3) {
		this.position = new THREE.Vector3().setFromMatrixPosition(matrix);
		this.home = this.position.clone();
		this.base = matrix.clone().setPosition(0, 0, 0);
		this.facing = movement.orientation;
		const p = movement.path;
		for (let i = 0; i + 3 < p.length; i += 4) {
			this.points.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]).add(offset));
			this.waits.push(p[i + 3]);
		}
		if (this.points.length) {
			// Start toward the waypoint nearest the spawn point.
			let best = Infinity;
			this.points.forEach((q, i) => {
				const d = q.distanceToSquared(this.position);
				if (d < best) {
					best = d;
					this.next = i;
				}
			});
			this.wait = 0;
		} else {
			// Wanderers start at different moments.
			this.wait = Math.random() * WANDER_PAUSE[1];
		}
	}

	/** Advances by dt seconds; returns whether the matrix changed. */
	update(dt: number, ground: GroundAt): boolean {
		if (!this.walking) {
			this.wait -= dt;
			if (this.wait > 0) return false;
			this.pickTarget(ground);
			this.from.copy(this.position);
			this.walking = true;
		}
		const dx = this.target.x - this.position.x;
		const dz = this.target.z - this.position.z;
		const remaining = Math.hypot(dx, dz);
		const step = this.movement.speed * dt;
		if (remaining > 1e-3) {
			// Facing is a WoW orientation: x north (-z here), y west (-x here).
			const heading = Math.atan2(-dx, -dz);
			const delta = angleDelta(this.facing, heading);
			this.facing += Math.sign(delta) * Math.min(Math.abs(delta), TURN_RATE * dt);
		}
		if (step >= remaining) {
			this.position.copy(this.target);
			this.arrive();
		} else {
			this.position.x += (dx / remaining) * step;
			this.position.z += (dz / remaining) * step;
			// Height along the straight line, then onto the ground where the ground is close by
			// (not indoors or on a bridge, where the terrain is far below or above).
			const total = Math.hypot(this.target.x - this.from.x, this.target.z - this.from.z) || 1;
			const t = 1 - (remaining - step) / total;
			this.position.y = THREE.MathUtils.lerp(this.from.y, this.target.y, t);
			const g = ground(this.position.x, this.position.z);
			if (Number.isFinite(g) && Math.abs(g - this.position.y) < GROUND_SNAP) this.position.y = g;
		}
		this.turn.makeRotationZ(this.facing - this.movement.orientation);
		this.matrix.copy(this.base).multiply(this.turn).setPosition(this.position);
		return true;
	}

	private pickTarget(ground: GroundAt): void {
		if (this.points.length) {
			this.target.copy(this.points[this.next]);
			return;
		}
		const r = this.movement.wander * Math.sqrt(Math.random());
		const a = Math.random() * Math.PI * 2;
		this.target.set(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
		// Outdoors, walk to the ground at the new spot.
		const homeGround = ground(this.home.x, this.home.z);
		const g = ground(this.target.x, this.target.z);
		if (Number.isFinite(homeGround) && Math.abs(homeGround - this.home.y) < GROUND_SNAP && Number.isFinite(g)) this.target.y = g;
	}

	private arrive(): void {
		if (this.points.length) {
			this.wait = this.waits[this.next];
			this.next = (this.next + 1) % this.points.length;
			// Paths often run on without stopping; keep walking then.
			if (this.wait <= 0) {
				this.from.copy(this.position);
				this.target.copy(this.points[this.next]);
				return;
			}
		} else {
			this.wait = between(WANDER_PAUSE);
		}
		this.walking = false;
	}
}
