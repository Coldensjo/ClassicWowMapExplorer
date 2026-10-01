import * as THREE from 'three';

const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = THREE.MathUtils.degToRad(89.5);
const MIN_CLEARANCE = 2;

interface Flight {
	from: THREE.Vector3;
	to: THREE.Vector3;
	fromYaw: number;
	toYaw: number;
	fromPitch: number;
	toPitch: number;
	t: number;
	duration: number;
}

/**
 * Free-flying camera: lock() captures the mouse for looking around, WASD to move, Space/C for up/down,
 * Shift to boost, mouse wheel to zoom along the view direction. Speed scales with height
 * above the ground, so the same controls work from treetop level to the whole continent.
 */
export class FlyControls {
	yaw = 0;
	pitch = 0;
	private readonly keys = new Set<string>();
	private zoomVelocity = 0;
	private flight: Flight | null = null;
	/** Ground height under the camera at the end of the last update. */
	private lastGround = -Infinity;
	/** How far below the ground the camera may still be while it eases up after the ground popped. */
	private groundEase = 0;
	/** Height above ground at the last update. */
	altitude = 0;
	speed = 0;

	constructor(
		private readonly camera: THREE.PerspectiveCamera,
		private readonly element: HTMLElement,
	) {

		document.addEventListener('mousemove', (e) => {
			if (document.pointerLockElement !== element) return;
			// Browsers now and then report a bogus jump (the hidden cursor being recentred), which
			// would snap the view; no real flick covers a third of the window in one event.
			if (Math.abs(e.movementX) > window.innerWidth / 3 || Math.abs(e.movementY) > window.innerHeight / 3) return;
			this.flight = null;
			this.yaw -= e.movementX * LOOK_SENSITIVITY;
			this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
		});
		element.addEventListener('wheel', (e) => {
			e.preventDefault();
			this.flight = null;
			this.zoomVelocity += -Math.sign(e.deltaY) * 2.5;
		}, { passive: false });
		window.addEventListener('keydown', (e) => {
			if (e.target instanceof HTMLInputElement) return;
			this.keys.add(e.code);
			if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC'].includes(e.code)) this.flight = null;
			if (e.code === 'Space') e.preventDefault();
		});
		window.addEventListener('keyup', (e) => this.keys.delete(e.code));
		window.addEventListener('blur', () => this.keys.clear());
	}

	/** Adjusts a move so it doesn't pass through solid things; set by the viewer. */
	collide: ((from: THREE.Vector3, move: THREE.Vector3) => THREE.Vector3) | null = null;

	/** Passing through everything: walls, floors and the ground (G toggles, in the viewer). */
	ghost = false;

	lock(): void {
		if (this.locked) return;
		// Raw mouse movement skips the OS pointer acceleration, which is also where the spurious
		// jumps come from; fall back to the plain lock where it isn't supported.
		const request = (this.element.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void).call(this.element, { unadjustedMovement: true });
		if (request instanceof Promise) request.catch(() => this.element.requestPointerLock());
	}

	get locked(): boolean {
		return document.pointerLockElement === this.element;
	}

	forward(out = new THREE.Vector3()): THREE.Vector3 {
		return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
	}

	/** Smoothly moves the camera to a position and orientation. */
	flyTo(position: THREE.Vector3, yaw: number, pitch: number, duration = 2): void {
		// Take the short way round when turning.
		let fromYaw = this.yaw;
		while (yaw - fromYaw > Math.PI) fromYaw += Math.PI * 2;
		while (fromYaw - yaw > Math.PI) fromYaw -= Math.PI * 2;
		this.flight = { from: this.camera.position.clone(), to: position.clone(), fromYaw, toYaw: yaw, fromPitch: this.pitch, toPitch: pitch, t: 0, duration };
	}

	set(position: THREE.Vector3, yaw: number, pitch: number): void {
		this.camera.position.copy(position);
		this.yaw = yaw;
		this.pitch = pitch;
		this.flight = null;
		this.lastGround = -Infinity;
		this.groundEase = 0;
		this.apply();
	}

	/**
	 * groundHeight is where the camera can't go below (-Infinity over holes such as cave and mine
	 * entrances); surfaceHeight is the terrain surface ignoring holes.
	 */
	update(dt: number, groundHeight: (x: number, z: number) => number, surfaceHeight: (x: number, z: number) => number = groundHeight): void {
		const pos = this.camera.position;
		// The ground under the camera rose without it moving: a tile's detailed heights replaced the
		// coarse ones. Ease up out of it rather than snapping.
		const groundNow = groundHeight(pos.x, pos.z);
		if (Number.isFinite(groundNow) && Number.isFinite(this.lastGround) && groundNow > this.lastGround) {
			this.groundEase = Math.max(this.groundEase, groundNow - this.lastGround);
		}
		this.groundEase *= Math.exp(-dt * 6);
		if (this.groundEase < 0.01) this.groundEase = 0;
		const surface = surfaceHeight(pos.x, pos.z);
		this.altitude = Math.max(0, pos.y - Math.max(surface, 0));
		// Underground (entered through a hole): caves and mines lie below the surface, so the
		// ground only stops the camera when it comes from above.
		const aboveGround = pos.y >= surface - 0.5;

		if (this.flight) {
			const f = this.flight;
			f.t = Math.min(1, f.t + dt / f.duration);
			const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
			pos.lerpVectors(f.from, f.to, e);
			this.yaw = f.fromYaw + (f.toYaw - f.fromYaw) * e;
			this.pitch = f.fromPitch + (f.toPitch - f.fromPitch) * e;
			if (f.t >= 1) this.flight = null;
		} else {
			const k = this.keys;
			const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 5 : 1;
			this.speed = THREE.MathUtils.clamp(this.altitude * 0.8, 25, 25000) * boost;

			const forward = this.forward();
			const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
			const move = new THREE.Vector3();
			if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
			if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
			if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
			if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
			if (k.has('Space') || k.has('KeyE')) move.y += 1;
			if (k.has('KeyC') || k.has('KeyQ')) move.y -= 1;
			const delta = new THREE.Vector3();
			if (move.lengthSq() > 0) delta.addScaledVector(move.normalize(), this.speed * dt);

			// Wheel zoom: move along the view by a fraction of the current height, decaying smoothly.
			if (Math.abs(this.zoomVelocity) > 0.01) {
				const step = this.zoomVelocity * Math.max(this.altitude, 20) * 0.12 * Math.min(1, dt * 8);
				delta.addScaledVector(forward, step);
				this.zoomVelocity *= Math.pow(0.004, dt);
			}
			// Walls, floors and ceilings of buildings and caves are solid (flights between views aren't).
			pos.add(this.collide && !this.ghost ? this.collide(pos, delta) : delta);
		}

		const ground = groundHeight(pos.x, pos.z);
		const floor = ground + MIN_CLEARANCE - this.groundEase;
		if (aboveGround && !this.ghost && pos.y < floor) pos.y = floor;
		this.lastGround = ground;
		this.apply();
	}

	private apply(): void {
		this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
	}
}
