import * as THREE from 'three';
import { lookPerPixel } from './look';
import { isTyping } from './typing';
import { WALKABLE } from './walkable';

/** Speeds in yards per second, as in the original game. */
export const RUN_SPEED = 7;
export const WALK_SPEED = 2.5;
export const BACK_SPEED = 4.5;
export const SWIM_SPEED = 4.72;
export const SWIM_BACK_SPEED = 2.5;
/** Turning with the keys, radians per second: half a turn a second. */
const TURN_RATE = Math.PI;
/** The emulators' jump: upward speed at take-off, gravity and the fastest fall (yd/s, yd/s²). */
const JUMP_SPEED = 7.96;
export const GRAVITY = 19.29;
const TERMINAL_SPEED = 60;
/** Ledges up to this high are stepped up without jumping (yards). */
const STEP_UP = 1;
/**
 * Walls are felt for at heights from the knees to the head at most this far apart (yards), and
 * at no more than this many heights, for the tallest forms.
 */
const WALL_PROBE_GAP = 0.25;
const WALL_PROBES_MAX = 16;
/** Ground up to this far below is followed down (slopes, stairs) rather than fallen to. */
const SNAP_DOWN = 1.2;
/** How quickly a slide down a too-steep slope picks up speed, as a share of gravity along it. */
const SLIDE_GRIP = 0.8;
/** The character's size at scale 1 (a human): capsule radius and height, yards. */
const RADIUS = 0.4;
const HEIGHT = 2;
/**
 * Water deeper than this share of the height is swum in, with the feet this share below the
 * surface while swimming (head and shoulders out).
 */
const SWIM_DEPTH = 0.65;
const SWIM_FLOAT = 0.75;
/**
 * Swimming starts this much deeper than SWIM_DEPTH and stops this much shallower (yards), so
 * wading along that depth over a bumpy bottom doesn't flicker between the two.
 */
const SWIM_BAND = 0.12;
/** Rising and sinking in water (Space, X), yd/s. */
const SWIM_RISE = 4;
/** Out of the water, a shore up to this far above the surface can be climbed onto. */
const SHORE_CLIMB = 0.6;

/** On the skateboard: pushing tops out at this speed, the slope and drag cap it at the next (yd/s). */
const PUSH_SPEED = 12;
const SKATE_MAX = 30;
/** Speeding up with a push, and slowing with the brake (yd/s²). */
const PUSH_ACCEL = 5;
const BRAKE = 12;
/** Rolling resistance (yd/s²) and air drag (per yard): coasting on the flat slows to a stop over a few seconds. */
const ROLL_FRICTION = 0.6;
const AIR_DRAG = 0.004;
/** Turning on the board, radians per second when slow; it carves wider the faster it goes. */
const SKATE_TURN_RATE = Math.PI * 0.9;
const SKATE_TURN_FALLOFF = 14;
/** A takedown's swing reaches this far for a human (yards), and further the faster the board goes (yards per yd/s). */
const TAKEDOWN_REACH = 3.5;
const TAKEDOWN_REACH_PER_SPEED = 0.1;
/** Swinging from the air reaches this many times as far. */
const TAKEDOWN_AIR_REACH = 1.3;
/** A takedown's swing (E) spins the rider round in this long (s), hitting this far into it (share). */
export const SWING_TIME = 0.6;
const SWING_HIT = 0.4;
/** A takedown's burst: speeds the board up like this (yd/s², past what pushing reaches) for this long, plus this for each one taken down, up to the most (s). */
const BURST_ACCEL = 5;
const BURST_TIME = 1.2;
const BURST_PER_TAKEDOWN = 0.3;
const BURST_MAX = 3;
/** Nitro (Shift, once its bar is full): speeds the board up like this (yd/s²) for this long (s), up to this fast (yd/s). */
const NITRO_ACCEL = 16;
const NITRO_TIME = 3;
const NITRO_MAX = 45;
/** Faster than the board's top speed once nothing drives it, it slows back to it like this (share per second). */
const OVERSPEED_EASE = 1.5;
/** The mega jump: straight up this fast (yd/s), and this much faster forward (yd/s). */
const MEGA_JUMP_SPEED = 28;
const MEGA_JUMP_PUSH = 4;
/**
 * Steering the board in the air: the way it flies turns toward the way it points at most this
 * fast (radians a second), and W and S push it on or hold it back like this (yd/s²), W only up
 * to pushing speed.
 */
const AIR_STEER = 1.2;
const AIR_PUSH = 3;
/**
 * Wall grip (from an ore vein): for this long (s) the board rides up any wall or slope, at any
 * speed, met this head-on at least (share of its speed going into it), rising up to this much
 * per yard across; holding W climbs at this speed at least (yd/s), gravity or no.
 */
const GRIP_TIME = 10;
const GRIP_HEAD_ON = 0.25;
const GRIP_RISE = 40;
const GRIP_CLIMB = 10;
/** Surfing (from a fishing spot): how long (s), and the speed the water carries the board at, at least (yd/s). */
const SURF_TIME = 10;
const SURF_SPEED = 22;
/** A kick (Q) pushes this much speed onto the board over its length (yd/s, s), up to the cap after (yd/s). */
const KICK_BOOST = 5;
export const KICK_TIME = 0.4;
const KICK_MAX = 20;
/** The tricks a second Space in the air after an ollie does, one at random. */
export const TRICKS = ['Kickflip', 'Heelflip', '360 Shove-it', '360 Flip', 'Impossible', 'Body Varial'] as const;
export type SkateTrick = (typeof TRICKS)[number];
/** A trick takes this long (s): landing sooner is a bail. */
export const TRICK_TIME = 0.5;
/** Ground falling away faster than a thrown body would, by more than this (yards), throws the board into the air. */
const LAUNCH_GAP = 0.06;
/** At this speed the board rides up ground too steep to walk, rising at most this much per yard across. */
const CLIMB_SPEED = 10;
const MAX_RISE = 5;
/** At this speed it rides up walls met at least this head-on (the share of its speed going into them). */
const WALL_SPEED = 13;
const WALL_HEAD_ON = 0.6;
/** The share of speed kept turning from the ground up a wall, and from coming down it back to rolling. */
const WALL_KEEP = 0.9;
/** Going over a wall's top, it's carried this fast onto it (yd/s). */
const WALL_OVER = 2.5;

/** A press that moves the mouse further than this (pixels) is a drag, not a click. */
const DRAG_THRESHOLD = 4;
/** ms before asking again to hide the mouse when the browser refused (still showing it from the last press). */
const CAPTURE_RETRY = 100;

const MAX_PITCH = THREE.MathUtils.degToRad(87);
/** Camera distance from the head: closest, furthest and to start with (yards). */
const MIN_ZOOM = 1;
const MAX_ZOOM = 35;
const START_ZOOM = 9;
/** Each wheel notch moves the camera this many times nearer or further. */
const ZOOM_STEP = 1.2;
/** The camera stops this far in front of a wall or the ground between it and the character. */
const CAMERA_GAP = 0.6;
/** How quickly the camera eases back out once nothing's in the way (1/e of the way per 1/rate s). */
const CAMERA_EASE_OUT = 3;
/** The camera looks at this share of the height above the feet: about the top of the head. */
const EYE = 0.9;
/** How long a newly placed character waits for its ground to load before falling anyway (s). */
const SETTLE_TIMEOUT = 15;
/**
 * Falling this long means there was nothing under it after all (a gap the game's data leaves
 * open, or ground not loaded): it's put back where it last stood (s).
 */
const LOST_FALL = 8;

/** What the character stands on, the surface's normal (pointing up), and a building's TerrainType (null for the terrain). */
interface Floor {
	y: number;
	normal: THREE.Vector3;
	ground: number | null;
}

/** What the walking character collides with and stands on; the viewer supplies it. */
export interface WalkWorld {
	/** Terrain height; -Infinity over holes (cave and mine entrances) and off the map. */
	terrain(x: number, z: number): number;
	/** Terrain surface ignoring holes: what counts as above or below ground. */
	surface(x: number, z: number): number;
	/** Whether the terrain there has loaded in full detail. */
	ready(x: number, z: number): boolean;
	/** Whether a building's bounds come within margin of a point (else casts can be skipped). */
	nearBuilding(at: THREE.Vector3, margin: number): boolean;
	/** Nearest building surface along a ray, within far. */
	cast(from: THREE.Vector3, direction: THREE.Vector3, far: number): { distance: number; normal: THREE.Vector3; ground: number } | null;
	/** A move across cut short so it keeps radius from building walls, sliding along them as if upright. */
	sweep(from: THREE.Vector3, move: THREE.Vector3, radius: number): THREE.Vector3;
	/** How far to move a point so no wall is within radius of it horizontally. */
	pushOut(at: THREE.Vector3, radius: number): THREE.Vector3;
	/** The liquid surface over a point, if it's under one, and whether that's the open sea. */
	liquid(at: THREE.Vector3): { surface: number; sea: boolean } | null;
}

export type WalkState = 'settling' | 'ground' | 'air' | 'swim';

/** Shortest signed difference between two angles. */
export function angleDelta(from: number, to: number): number {
	return THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A character on foot, moved as in World of Warcraft, with a camera orbiting behind it. W/S run
 * and backpedal, A/D turn (strafe while the right button is held), Q/E strafe, Space jumps; the
 * mouse turns the camera, and with the right button held the character too; the wheel zooms.
 * As in the game, the mouse stays shown, and is hidden only while turning: dragging with the
 * left button turns the camera, and holding the right button turns the character too.
 */
export class WalkControls {
	/** Feet, in world space. */
	readonly position = new THREE.Vector3();
	/** Which way the character faces: the same angle as the camera's yaw (0 north, turning west). */
	facing = 0;
	/** The camera's turn away from behind the character, and its pitch. */
	private orbit = 0;
	pitch = -0.25;
	private zoom = START_ZOOM;
	private zoomTarget = START_ZOOM;
	/** Where the camera is after walls and the ground pull it in. */
	private distance = START_ZOOM;
	readonly velocity = new THREE.Vector3();
	state: WalkState = 'settling';
	private settleTime = 0;
	/** Where it last stood on the ground, and facing which way, to be put back after a fall into nothing. */
	private readonly lastStand = new THREE.Vector3();
	private lastStandFacing = 0;
	private hasStood = false;
	/** Walking rather than running (the walk key toggles). */
	walkMode = false;
	/** On a slope too steep to stand on: sliding down it. */
	sliding = false;
	/** Seconds since leaving the ground, and whether that was a jump. */
	airTime = 0;
	jumped = false;
	/** The movement asked for, relative to the facing: forward (+1 / -1 back) and right (+1 / -1 left). */
	readonly intent = new THREE.Vector2();
	/** Turning with the keys: +1 left, -1 right, 0 not. */
	turning = 0;
	/** Horizontal speed over the ground at the last update. */
	speed = 0;
	/** The speed the keys ask for (running against a wall, the feet still run at it). */
	moveSpeed = 0;
	/** What it's standing on, for footsteps: a building's TerrainType, or null on the terrain. */
	ground: number | null = null;
	/** Scale of the character (its race): size and how near walls it can go. */
	scale = 1;
	/** Riding a skateboard (X on land gets on and off). */
	skating = false;
	/** The board's speed along the facing (negative rolling back). */
	boardSpeed = 0;
	/** The ground's normal under the feet, for the board to lie on. */
	readonly groundNormal = new THREE.Vector3(0, 1, 0);
	/** Seconds left of a kick pushing the board along. */
	kickTime = 0;
	/** Seconds left of a takedown's swing. */
	swingTime = 0;
	/** Seconds left of a takedown's burst of speed (the board's on fire meanwhile). */
	burstTime = 0;
	/** Seconds left of wall grip: the board rides up anything. */
	gripTime = 0;
	/** Seconds left surfing: the board rides on water. */
	surfTime = 0;
	/** On the board on the water's surface (surfing) at the last update. */
	onWater = false;
	/** The nitro bar, 0 to 1 (filled by points; full, Shift fires it), and seconds left of nitro burning. */
	nitro = 0;
	nitroTime = 0;
	/** Called as the swing comes round to hit. */
	onSwingHit: (() => void) | null = null;
	/** The trick being done in the air, and how long into the air it began (s). */
	trick: SkateTrick | null = null;
	trickStart = 0;
	/** Called when a trick starts, with its name. */
	onTrick: ((name: SkateTrick) => void) | null = null;
	/** Riding up or down a wall: the way out of it (level); null when not. */
	wall: THREE.Vector3 | null = null;
	/** How fast the ground rose (+) or fell under the board last frame (yd/s), carried into the air off a ramp. */
	climb = 0;
	private readonly keys = new Set<string>();
	private buttons = 0;
	/** Whether a mouse button went down on the view (so an uncaptured drag turns the camera). */
	private dragging = false;
	active = false;
	world: WalkWorld | null = null;

	constructor(
		private readonly camera: THREE.PerspectiveCamera,
		private readonly element: HTMLElement,
	) {
		element.addEventListener('mousedown', (e) => {
			if (!this.active) return;
			this.dragging = true;
			this.dragged = 0;
			this.buttons = e.buttons;
			// Taking hold with the right button turns the character to where the camera looks, and
			// hides the mouse while it's held (as in the game), so it can turn without running out of screen.
			if (e.button === 2) {
				this.faceCamera();
				this.capture();
			}
		});
		window.addEventListener('mouseup', (e) => {
			this.buttons = e.buttons;
			// The mouse shows again once neither button is held.
			if (!(e.buttons & 3)) {
				this.dragging = false;
				this.release();
			}
		});
		element.addEventListener('contextmenu', (e) => {
			if (this.active) e.preventDefault();
		});
		document.addEventListener('mousemove', (e) => {
			if (!this.active) return;
			this.buttons = e.buttons;
			// Only while a button is held: left turns the camera, right the character too.
			if (!(this.dragging && e.buttons & 3)) {
				// The button came up somewhere it wasn't heard: show the mouse again.
				if (this.dragging) {
					this.dragging = false;
					this.release();
				}
				return;
			}
			// The first movement after the mouse is hidden or shown is the browser moving it there, not the hand.
			if (this.skipMove) {
				this.skipMove = false;
				return;
			}
			// See FlyControls: now and then a bogus jump comes through.
			if (Math.abs(e.movementX) > window.innerWidth / 3 || Math.abs(e.movementY) > window.innerHeight / 3) return;
			this.dragged += Math.abs(e.movementX) + Math.abs(e.movementY);
			// A left press that turns into a drag hides the mouse too; a plain click leaves it be.
			if (this.wasDrag) this.capture();
			const turn = -e.movementX * lookPerPixel();
			if (this.steering) this.facing += turn;
			else this.orbit += turn;
			this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * lookPerPixel(), -MAX_PITCH, MAX_PITCH);
		});
		element.addEventListener('wheel', (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * ZOOM_STEP ** Math.sign(e.deltaY), MIN_ZOOM, MAX_ZOOM);
		}, { passive: false });
		window.addEventListener('keydown', (e) => {
			if (!this.active || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
			this.keys.add(e.code);
			if (e.code === 'Space') e.preventDefault();
			if ((e.code === 'NumpadDivide' || e.code === 'Backslash') && !e.repeat) this.walkMode = !this.walkMode;
			// X sinks in water; on land it gets on or off the skateboard.
			if (e.code === 'KeyX' && !e.repeat && this.state !== 'swim') this.toggleBoard();
			// On the board Q kicks and E swings for a takedown, rather than strafing.
			if (e.code === 'KeyQ' && !e.repeat) this.kick();
			if (e.code === 'KeyE' && !e.repeat) this.swing();
			if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) this.fireNitro();
			if (e.code === 'Space' && !e.repeat) this.startTrick();
		});
		window.addEventListener('keyup', (e) => this.keys.delete(e.code));
		window.addEventListener('blur', () => {
			this.keys.clear();
			this.buttons = 0;
			this.dragging = false;
			this.release();
		});
		document.addEventListener('pointerlockchange', () => {
			const asked = this.requesting;
			this.requesting = false;
			this.skipMove = true;
			const locked = document.pointerLockElement === element;
			// Hidden for walking only once flying again: show it, rather than leave flying turned by it.
			if (!this.active) {
				if (asked && locked) document.exitPointerLock();
				return;
			}
			// Let go before the hiding took (a quick click): show it again.
			if (locked && !this.dragging) this.release();
			// Asked again while the last showing was still under way, which the browser refuses: ask now it's done.
			else if (!locked && this.dragging && this.wantHidden) this.capture();
		});
		document.addEventListener('pointerlockerror', () => {
			this.requesting = false;
		});
	}

	/** A request to hide the mouse is under way. */
	private requesting = false;
	/** The mouse should be hidden (a button is turning the view). */
	private wantHidden = false;
	/** Skip the next movement: the jump from hiding or showing the mouse. */
	private skipMove = false;

	/** Pixels the mouse has moved since a button went down on the view. */
	private dragged = 0;

	/** Whether the last press on the view turned the camera rather than clicked (so it shouldn't select what's under it). */
	get wasDrag(): boolean {
		return this.dragged > DRAG_THRESHOLD;
	}

	/**
	 * Hides the mouse while a button turns the view, asking the browser once (asking again while
	 * a request is under way only gets refused). The plain kind, not the raw movement flying uses:
	 * switching raw input on and off with every press makes the browser stall.
	 */
	private capture(): void {
		this.wantHidden = true;
		if (document.pointerLockElement === this.element || this.requesting) return;
		this.requesting = true;
		const request = this.element.requestPointerLock() as Promise<void> | undefined;
		// Refused (an earlier showing still under way): pointerlockchange asks again once it's done,
		// or, if that came first, ask again in a moment.
		request?.catch?.(() => {
			this.requesting = false;
			setTimeout(() => {
				if (this.active && this.dragging && this.wantHidden) this.capture();
			}, CAPTURE_RETRY);
		});
	}

	private release(): void {
		this.wantHidden = false;
		if (document.pointerLockElement === this.element) document.exitPointerLock();
	}


	/** The right button is held: the mouse turns the character, and A/D strafe. */
	private get steering(): boolean {
		return (this.buttons & 2) !== 0;
	}

	private faceCamera(): void {
		this.facing += this.orbit;
		this.orbit = 0;
	}

	/** The camera's yaw: behind the character, turned by the orbit. */
	get yaw(): number {
		return this.facing + this.orbit;
	}

	/** Capsule radius and height for the character's size. */
	get radius(): number {
		return RADIUS * this.scale;
	}

	get height(): number {
		return HEIGHT * this.scale;
	}

	/** Whether the camera is so close the character would fill the view (it's hidden then). */
	get firstPerson(): boolean {
		return this.distance < MIN_ZOOM * 0.9;
	}

	/**
	 * Puts the character's feet at a point, facing a way, with the camera behind it. It holds
	 * still until the ground there has loaded, then stands on what's under it, or with drop,
	 * falls to it.
	 */
	place(feet: THREE.Vector3, facing: number, pitch = this.pitch, drop = false): void {
		this.dropping = drop;
		this.position.copy(feet);
		this.facing = facing;
		this.orbit = 0;
		this.pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH);
		this.velocity.set(0, 0, 0);
		this.boardSpeed = 0;
		this.climb = 0;
		this.wall = null;
		this.state = 'settling';
		this.settleTime = 0;
		this.hasStood = false;
		this.sliding = false;
		this.airTime = 0;
		this.jumped = false;
		this.distance = this.zoom = this.zoomTarget;
		this.updateCamera(0);
	}

	/** Puts the character's head where the camera is, facing its way, to fall from there to the ground. */
	dropFrom(eye: THREE.Vector3, facing: number): void {
		this.place(eye.clone().setY(eye.y - this.height * EYE), facing, this.pitch, true);
	}

	/** Set by place: once its ground has loaded, the character falls to it rather than being put on it. */
	private dropping = false;

	/** Gets on the skateboard (or off it), if not on it (or off it) already. */
	setSkating(on: boolean): void {
		if (on !== this.skating) this.toggleBoard();
	}

	/** Gets on the skateboard, rolling on at the speed it was going, or off it. */
	private toggleBoard(): void {
		this.skating = !this.skating;
		const f = this.facing;
		this.boardSpeed = this.skating ? -Math.sin(f) * this.velocity.x - Math.cos(f) * this.velocity.z : 0;
		this.climb = 0;
		this.kickTime = 0;
		this.swingTime = 0;
		this.burstTime = 0;
		this.nitroTime = 0;
		this.surfTime = 0;
		this.gripTime = 0;
		this.onWater = false;
		this.trick = null;
		this.wall = null;
	}

	/**
	 * Surfing, from a fishing spot: on the board (out of the water if swimming), riding the
	 * water's surface fast for a while. Back in it when that runs out, unless ashore by then.
	 */
	surf(): void {
		this.setSkating(true);
		this.surfTime = SURF_TIME;
		this.boardSpeed = Math.max(this.boardSpeed, SURF_SPEED);
		if (this.state === 'swim') {
			const water = this.world!.liquid(this.position);
			if (water) this.position.y = water.surface;
			this.state = 'ground';
			this.velocity.y = 0;
		}
	}

	/** Wall grip, from an ore vein: on the board, it rides up any wall or slope for a while. */
	grip(): void {
		this.setSkating(true);
		this.gripTime = GRIP_TIME;
	}

	/** Climbing with wall grip: gripping, and W held. */
	private get gripClimbing(): boolean {
		return this.gripTime > 0 && this.intent.x > 0;
	}

	/** Surfing: the water's surface at a point (from just under y), or null when not surfing or there's no water there. */
	private surfAt(x: number, y: number, z: number): number | null {
		if (this.surfTime <= 0) return null;
		return this.world!.liquid(new THREE.Vector3(x, y - 0.05, z))?.surface ?? null;
	}

	/** Kicking the board along: a kick under way, or Q held to go on kicking, on the ground. */
	get kicking(): boolean {
		return this.skating && this.state === 'ground' && (this.kickTime > 0 || this.keys.has('KeyQ'));
	}

	/** On the board on the ground, a foot comes down and pushes it along (once the last kick is done). */
	private kick(): void {
		if (this.skating && this.state === 'ground' && this.kickTime <= 0) this.kickTime = KICK_TIME;
	}

	/** On the board, a spinning swing for a takedown (once the last one is done). */
	private swing(): void {
		if (this.skating && this.swingTime <= 0) this.swingTime = SWING_TIME;
	}

	/** Flings the board high into the air, carrying on the way it was going, a little faster; tricks can be done up there. */
	megaJump(): void {
		if (!this.skating) return;
		const forward = this.forward();
		const speed = Math.max(0, this.state === 'ground' ? this.boardSpeed : this.velocity.dot(forward)) + MEGA_JUMP_PUSH;
		this.wall = null;
		this.velocity.copy(forward).multiplyScalar(speed).setY(MEGA_JUMP_SPEED);
		this.leaveGround(true);
	}

	/** Fills the nitro bar by a share of it (not while it burns). */
	chargeNitro(share: number): void {
		if (this.nitroTime <= 0) this.nitro = Math.min(1, this.nitro + share);
	}

	/** On the board with the bar full: nitro burns, draining it. */
	private fireNitro(): void {
		if (this.skating && this.nitro >= 1 && this.nitroTime <= 0) this.nitroTime = NITRO_TIME;
	}

	/** How far a takedown's swing reaches now (yards): further for a bigger body, going faster, and from the air. */
	get takedownReach(): number {
		return (TAKEDOWN_REACH * this.scale + Math.abs(this.boardSpeed) * TAKEDOWN_REACH_PER_SPEED) * (this.state === 'air' ? TAKEDOWN_AIR_REACH : 1);
	}

	/** A takedown's reward: a burst of speed, longer for more taken down at once (and carrying on from one still going). */
	boost(count: number): void {
		if (this.skating) this.burstTime = Math.min(BURST_MAX, Math.max(this.burstTime, BURST_TIME + BURST_PER_TAKEDOWN * count));
	}

	/** In the air after an ollie, Space again does a trick, one of TRICKS at random. */
	private startTrick(): void {
		if (!this.skating || this.state !== 'air' || !this.jumped || this.trick || this.airTime < 0.05) return;
		this.trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
		this.trickStart = this.airTime;
		this.onTrick?.(this.trick);
	}

	/** Starts: takes the keys and mouse. */
	start(): void {
		this.active = true;
		this.keys.clear();
		// Walking, the mouse is shown, and hidden only while the right button is held.
		this.release();
	}

	stop(): void {
		this.active = false;
		this.keys.clear();
		this.buttons = 0;
		this.dragging = false;
		this.release();
	}

	/**
	 * The highest floor between top and bottom at x, z: the terrain, or a building's floor found
	 * by casting down. Null when there's none in that range.
	 */
	floorAt(x: number, z: number, top: number, bottom: number): Floor | null {
		const world = this.world!;
		let best: Floor | null = null;
		const t = world.terrain(x, z);
		if (t <= top && t >= bottom) best = { y: t, normal: this.terrainNormal(x, z), ground: null };
		const from = new THREE.Vector3(x, top, z);
		const reach = top - bottom;
		if (reach > 0 && world.nearBuilding(from, reach + 1)) {
			const hit = world.cast(from, DOWN, reach);
			if (hit && (!best || top - hit.distance > best.y)) {
				// Two-sided surfaces can be hit from their back: the floor's normal points up either way.
				const normal = hit.normal.clone();
				if (normal.y < 0) normal.negate();
				best = { y: top - hit.distance, normal, ground: hit.ground };
			}
		}
		return best;
	}

	/** The terrain's slope at a point, from its heights either side (holes ignored). */
	private terrainNormal(x: number, z: number): THREE.Vector3 {
		const s = this.world!;
		const e = 0.5;
		const dx = (s.surface(x + e, z) - s.surface(x - e, z)) / (2 * e);
		const dz = (s.surface(x, z + e) - s.surface(x, z - e)) / (2 * e);
		return new THREE.Vector3(-dx, 1, -dz).normalize();
	}

	/** The way the keys (and mouse buttons) ask to move, relative to the facing; also turns with A/D. */
	private readInput(dt: number): void {
		const k = this.keys;
		const both = (this.buttons & 3) === 3;
		let forward = 0;
		let right = 0;
		let turn = 0;
		if (k.has('KeyW') || k.has('ArrowUp') || both) forward += 1;
		if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
		if (k.has('KeyE')) right += 1;
		if (k.has('KeyQ')) right -= 1;
		const left = k.has('KeyA') || k.has('ArrowLeft');
		const rightKey = k.has('KeyD') || k.has('ArrowRight');
		// A/D turn, or strafe while the right button is held (the arrows always turn).
		if (this.steering) {
			if (k.has('KeyA')) right -= 1;
			if (k.has('KeyD')) right += 1;
			if (k.has('ArrowLeft')) turn += 1;
			if (k.has('ArrowRight')) turn -= 1;
		} else {
			if (left) turn += 1;
			if (rightKey) turn -= 1;
		}
		// The board only goes the way it points.
		if (this.skating) right = 0;
		this.intent.set(Math.sign(forward), THREE.MathUtils.clamp(right, -1, 1));
		this.turning = Math.sign(turn);
		const rate = this.wall ? 0 : this.skating ? SKATE_TURN_RATE / (1 + Math.abs(this.boardSpeed) / SKATE_TURN_FALLOFF) : TURN_RATE;
		const turned = this.turning * rate * dt;
		this.facing += turned;
		// The camera keeps behind the character as it turns, except while the left button holds it
		// where it's been put: then only the character turns.
		if (this.dragging && this.buttons & 1 && !this.steering) this.orbit -= turned;
	}

	/** Horizontal velocity for the keys: forward, back and sideways at their speeds, for running, walking or swimming. */
	private wantedVelocity(swimming: boolean): THREE.Vector3 {
		const { x: forward, y: right } = this.intent;
		const out = new THREE.Vector3();
		this.moveSpeed = 0;
		if (!forward && !right) return out;
		const speed = swimming
			? forward < 0 ? SWIM_BACK_SPEED : SWIM_SPEED
			: this.walkMode ? WALK_SPEED : forward < 0 ? BACK_SPEED : RUN_SPEED;
		const f = this.facing;
		out.set(-Math.sin(f) * forward + Math.cos(f) * right, 0, -Math.cos(f) * forward - Math.sin(f) * right);
		this.moveSpeed = speed;
		return out.normalize().multiplyScalar(speed);
	}

	update(dt: number): void {
		const world = this.world;
		if (!world || dt <= 0) return;
		this.readInput(dt);
		// The burst runs out in the air too, so it isn't saved for after a jump.
		if (this.burstTime > 0) this.burstTime = this.skating ? Math.max(0, this.burstTime - dt) : 0;
		if (this.surfTime > 0) this.surfTime = this.skating ? Math.max(0, this.surfTime - dt) : 0;
		if (this.gripTime > 0) this.gripTime = this.skating ? Math.max(0, this.gripTime - dt) : 0;
		if (this.nitroTime > 0) {
			this.nitroTime = this.skating ? Math.max(0, this.nitroTime - dt) : 0;
			this.nitro = this.nitroTime / NITRO_TIME;
		}
		if (this.swingTime > 0) {
			const hit = SWING_TIME * (1 - SWING_HIT);
			const was = this.swingTime;
			this.swingTime = Math.max(0, this.swingTime - dt);
			if (was > hit && this.swingTime <= hit && this.skating) this.onSwingHit?.();
		}
		const before = this.position.clone();
		switch (this.state) {
			case 'settling':
				this.settle(dt);
				break;
			case 'ground':
				this.walk(dt);
				break;
			case 'air':
				this.fall(dt);
				break;
			case 'swim':
				this.swim(dt);
				break;
		}
		this.speed = dt > 0 ? Math.hypot(this.position.x - before.x, this.position.z - before.z) / dt : 0;
		this.updateCamera(dt);
	}

	/** Holds still until the ground under the character has loaded, then stands on it. */
	private settle(dt: number): void {
		const p = this.position;
		this.settleTime += dt;
		const timedOut = this.settleTime > SETTLE_TIMEOUT;
		if (!this.world!.ready(p.x, p.z) && !timedOut) return;
		if (this.dropping) {
			// Already down on something (the camera was at the ground): stand; else fall to it.
			const under = this.floorAt(p.x, p.z, p.y + 1.5, p.y - 0.3);
			if (under) {
				p.y = under.y;
				this.state = 'ground';
			} else {
				this.leaveGround(false);
			}
			return;
		}
		// The floor it was put on, or the one under it; failing those, the detailed ground a little
		// above (the coarse ground it was put on can sit below it), but not the storey above.
		const floor = this.floorAt(p.x, p.z, p.y + 1.5, p.y - 50) ?? this.floorAt(p.x, p.z, p.y + 5, p.y - 50);
		if (floor) {
			p.y = floor.y;
			this.state = 'ground';
		} else if (timedOut) {
			this.leaveGround(false);
		}
	}

	/**
	 * Moves horizontally by move, stopped and slid along by building walls anywhere from the
	 * knees to the head (ledges below the knees are stepped up instead). The body is felt at
	 * heights no more than WALL_PROBE_GAP apart, so a beam, rail or sill between two of them
	 * can't be walked through, and again after a slide at one height until none changes the
	 * move, so sliding off one wall can't take it into another at a height already felt.
	 */
	private moveAcross(move: THREE.Vector3): void {
		const world = this.world!;
		const p = this.position;
		const r = this.radius;
		const length = move.length();
		if (length < 1e-6) return;
		const middle = p.clone().setY(p.y + this.height * 0.5);
		if (world.nearBuilding(middle, length + this.height + r)) {
			const low = STEP_UP + 0.1;
			const high = Math.max(low, this.height - 0.1);
			const probes = Math.min(WALL_PROBES_MAX, Math.ceil((high - low) / WALL_PROBE_GAP) + 1);
			const from = new THREE.Vector3();
			for (let round = 0; round < 3; round++) {
				let changed = false;
				for (let i = 0; i < probes; i++) {
					from.set(p.x, p.y + (probes > 1 ? low + ((high - low) * i) / (probes - 1) : low), p.z);
					const next = world.sweep(from, move, r);
					next.y = 0;
					if (next.distanceToSquared(move) > 1e-12) changed = true;
					move = next;
				}
				if (!changed) break;
			}
			p.add(move);
			// Keep off walls slid along at an angle.
			const out = world.pushOut(p.clone().setY(p.y + this.height * 0.5), r);
			p.x += out.x;
			p.z += out.z;
		} else {
			p.add(move);
		}
	}

	/**
	 * Whether a move from start ran into the side of the terrain: ground higher than top where it
	 * was standing above the ground (underground, in a cave, the terrain is overhead and doesn't count).
	 */
	private intoTerrain(start: THREE.Vector3, top: number): boolean {
		const world = this.world!;
		const p = this.position;
		return world.terrain(p.x, p.z) > top && start.y >= world.surface(start.x, start.z) - 0.5;
	}

	/** Down the slope: the horizontal part of a floor's normal, normalised. */
	private static downhill(normal: THREE.Vector3): THREE.Vector3 {
		const d = new THREE.Vector3(normal.x, 0, normal.z);
		return d.lengthSq() > 1e-8 ? d.normalize() : d;
	}

	/**
	 * On the skateboard: W pushes, S brakes, A/D carve; slopes speed it up or slow it down, walls
	 * stop it, and it flies off any crest the ground falls away from faster than it would fall.
	 * Space ollies, carrying the speed and any climb up a ramp into the air.
	 */
	private skate(dt: number): void {
		const world = this.world!;
		const p = this.position;
		const here = this.floorAt(p.x, p.z, p.y + 0.1, p.y - 0.5);
		// Surfing, the water's flat.
		const wave = this.surfAt(p.x, p.y, p.z);
		const normal = wave !== null && wave >= (here?.y ?? -Infinity) - 0.05 ? UP : here?.normal ?? UP;
		this.groundNormal.copy(normal);
		this.sliding = false;
		const forward = this.forward();
		// Turning carves: the speed carries round onto the new facing.
		let speed = this.boardSpeed;
		// The speed is along the ground: up or down a slope less of it goes across, and gravity pulls along it.
		const { cos, sin } = WalkControls.slopeAlong(normal, forward);
		// Gripping and climbing, gravity doesn't hold it back going up.
		if (!(this.gripClimbing && sin > 0)) speed -= GRAVITY * sin * dt;
		const push = this.intent.x;
		// Up ground too steep to walk, gripping, it climbs at a steady pace at least.
		if (this.gripClimbing && normal.y < WALKABLE && sin > 0) speed = Math.max(speed, GRIP_CLIMB);
		if (push > 0 && speed < PUSH_SPEED) speed = Math.min(PUSH_SPEED, speed + PUSH_ACCEL * dt);
		// Holding Q kicks again as each kick ends.
		if (this.kickTime <= 0 && this.keys.has('KeyQ')) this.kickTime = KICK_TIME;
		if (this.kickTime > 0) {
			this.kickTime -= dt;
			if (speed < KICK_MAX) speed = Math.min(KICK_MAX, speed + (KICK_BOOST / KICK_TIME) * dt);
		}
		if (this.burstTime > 0) speed = Math.max(speed, 0) + BURST_ACCEL * dt;
		if (this.nitroTime > 0) speed = Math.max(speed, 0) + NITRO_ACCEL * dt;
		// The water carries a surfing board along fast.
		if (this.onWater && this.surfTime > 0) speed = Math.max(speed, SURF_SPEED);
		const slow = (push < 0 ? BRAKE : 0) + ROLL_FRICTION + AIR_DRAG * speed * speed;
		speed -= Math.sign(speed) * Math.min(Math.abs(speed), slow * dt);
		speed = THREE.MathUtils.clamp(speed, -SKATE_MAX, NITRO_MAX);
		// Past the top speed with no nitro, it eases back to it rather than stopping short.
		if (speed > SKATE_MAX && this.nitroTime <= 0) speed -= (speed - SKATE_MAX) * Math.min(1, OVERSPEED_EASE * dt);
		this.moveSpeed = Math.abs(speed);
		this.velocity.copy(forward).multiplyScalar(speed * cos);
		if (this.keys.has('Space')) {
			this.velocity.y = JUMP_SPEED + Math.max(0, this.climb);
			this.leaveGround(true);
			this.fall(dt);
			return;
		}
		if ((speed >= WALL_SPEED || (this.gripTime > 0 && speed > 1)) && this.hitWall(forward, speed * cos * dt)) return;

		const start = p.clone();
		this.moveAcross(this.velocity.clone().multiplyScalar(dt));
		const across = Math.hypot(p.x - start.x, p.z - start.z);
		// Fast enough, it rides up ground too steep to walk (or carries on up it, once on it), up to near sheer.
		const climbing = Math.abs(speed) >= CLIMB_SPEED || normal.y < WALKABLE || this.gripTime > 0;
		let top = start.y + STEP_UP + (climbing ? across * MAX_RISE : 0);
		// Gripping, it climbs terrain up to near sheer: reaching up to the ground ahead, if that's
		// all, rather than up through whatever's overhead (a cave's roof, the land over a mine).
		if (this.gripTime > 0 && start.y >= world.surface(start.x, start.z) - 0.5) {
			const ahead = world.terrain(p.x, p.z);
			if (ahead > top && ahead <= start.y + STEP_UP + across * GRIP_RISE) top = ahead + 0.05;
		}
		if (this.intoTerrain(start, top)) p.copy(start);
		// Down a steep slope fast it drops further each frame: follow it, or launch off it below.
		const snap = SNAP_DOWN + Math.abs(speed) * dt * 1.5;
		let floor = this.floorAt(p.x, p.z, top, start.y - snap);
		if (!climbing && floor && floor.normal.y < WALKABLE && floor.y > start.y + 0.05) {
			p.copy(start);
			floor = here;
		}
		// Surfing, the water's surface is the ground, over whatever's under it.
		const sea = this.surfAt(p.x, floor ? floor.y : start.y, p.z);
		this.onWater = sea !== null && sea >= (floor?.y ?? -Infinity) && sea <= top;
		if (this.onWater) floor = { y: sea!, normal: UP.clone(), ground: null };
		const thrown = start.y + this.climb * dt - 0.5 * GRAVITY * dt * dt;
		if (!floor || (Math.abs(speed) > 4 && floor.y < thrown - LAUNCH_GAP)) {
			// Off an edge or over a crest (the top of a ramp): fly on as it was going, climb and all.
			this.velocity.set((p.x - start.x) / dt, this.climb, (p.z - start.z) / dt);
			this.leaveGround(false);
			return;
		}
		// Whatever the walls left of the move is its speed now; running into one stops it.
		const moved = (p.x - start.x) * forward.x + (p.z - start.z) * forward.z;
		const rose = floor.y - start.y;
		this.boardSpeed = Math.abs(moved) < 1e-6 ? 0 : (Math.sign(moved) * Math.hypot(moved, rose)) / dt;
		this.velocity.set((p.x - start.x) / dt, 0, (p.z - start.z) / dt);
		this.climb = rose / dt;
		p.y = floor.y;
		this.ground = floor.ground;
		if (floor.normal.y >= WALKABLE) {
			this.lastStand.copy(p);
			this.lastStandFacing = this.facing;
			this.hasStood = true;
		}
		const water = this.onWater ? null : world.liquid(p);
		if (water && water.surface - p.y > SWIM_DEPTH * this.height + SWIM_BAND) this.startSwimming();
	}

	/** Which way the character faces, level. */
	private forward(): THREE.Vector3 {
		return new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing));
	}

	/** Up or down a slope going forward: the cosine and sine of its angle (sine positive uphill). */
	private static slopeAlong(normal: THREE.Vector3, forward: THREE.Vector3): { cos: number; sin: number } {
		const rise = -(normal.x * forward.x + normal.z * forward.z) / Math.max(normal.y, 0.2);
		const cos = 1 / Math.hypot(1, rise);
		return { cos, sin: rise * cos };
	}

	/**
	 * Rolling fast at a wall (a building's, or a solid doodad's) more head-on than glancing: rides
	 * up it, the speed into it turned upward, the speed along it kept. True if it did.
	 */
	private hitWall(forward: THREE.Vector3, step: number): boolean {
		const world = this.world!;
		const p = this.position;
		const from = new THREE.Vector3(p.x, p.y + this.height * 0.4, p.z);
		const reach = step + this.radius + 0.1;
		if (!world.nearBuilding(from, reach + 1)) return false;
		const hit = world.cast(from, forward, reach);
		if (!hit || Math.abs(hit.normal.y) > 0.3) return false;
		const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
		if (n.dot(forward) > 0) n.negate();
		const speed = this.velocity.length();
		const into = -this.velocity.dot(n);
		if (into < speed * (this.gripTime > 0 ? GRIP_HEAD_ON : WALL_HEAD_ON)) return false;
		// Too slow to ride up a wall but for the grip, it must be one: up past the head, not a rock or a vein it's run into.
		if (speed < WALL_SPEED) {
			const high = world.cast(new THREE.Vector3(p.x, p.y + this.height + 0.3, p.z), forward, reach + 0.3);
			if (!high || Math.abs(high.normal.y) > 0.3) return false;
		}
		p.addScaledVector(forward, Math.max(0, hit.distance - this.radius - 0.02));
		// Gripping, even a slow board starts up it.
		this.velocity.addScaledVector(n, into).setY(this.gripTime > 0 ? Math.max(into * WALL_KEEP, GRIP_CLIMB) : into * WALL_KEEP);
		this.leaveGround(false);
		this.wall = n;
		return true;
	}

	/**
	 * Riding a wall: the board's against it, rising as gravity slows it and then coming back down,
	 * sliding along it as it was going. Over its top it flies off, onto what's beyond if it can; back
	 * at its foot the fall turns into speed rolling away (backwards, as off a ramp); Space jumps off it.
	 */
	private wallRide(dt: number): void {
		const world = this.world!;
		const p = this.position;
		const n = this.wall!;
		const v = this.velocity;
		if (this.keys.has('Space') && this.airTime > 0.1) {
			this.wall = null;
			v.addScaledVector(n, JUMP_SPEED * 0.6);
			v.y = Math.max(v.y, 0) + JUMP_SPEED * 0.6;
			this.leaveGround(true);
			return;
		}
		// Gripping with W held, it climbs on up at a steady pace at least; else gravity slows it and brings it down.
		if (this.gripClimbing) v.y = Math.max(v.y, GRIP_CLIMB);
		else v.y -= GRAVITY * dt;
		// Along the wall only.
		v.addScaledVector(n, -v.dot(n));
		this.moveAcross(new THREE.Vector3(v.x * dt, 0, v.z * dt));
		let y = p.y + v.y * dt;
		if (v.y > 0) {
			const head = p.clone().setY(p.y + this.height);
			const roof = world.cast(head, UP, v.y * dt + 0.05);
			if (roof) {
				y = p.y + Math.max(0, roof.distance - 0.05);
				v.y = 0;
			}
		}
		// The wall still there, at the board?
		const against = world.cast(new THREE.Vector3(p.x, y + 0.2, p.z), n.clone().negate(), this.radius + 0.4);
		if (!against || Math.abs(against.normal.y) > 0.5) {
			// Over the top or off its end: fly on, nudged over its top if still going up.
			if (v.y > 0) v.addScaledVector(n, -WALL_OVER);
			p.y = y;
			this.wall = null;
			return;
		}
		// The ground along the wall can rise under it (a slope at its foot): the board never goes into it.
		const ground = p.y >= world.surface(p.x, p.z) - STEP_UP ? world.terrain(p.x, p.z) : -Infinity;
		if (y < ground) {
			y = ground;
			if (v.y > 0) v.y = 0;
		}
		if (v.y <= 0) {
			const floor = this.floorAt(p.x, p.z, p.y + STEP_UP, y - 0.01);
			if (floor) {
				// Down at its foot: the fall becomes speed rolling away from the wall.
				p.y = floor.y;
				this.wall = null;
				this.state = 'ground';
				v.addScaledVector(n, -v.y * WALL_KEEP).setY(0);
				const forward = this.forward();
				this.boardSpeed = v.x * forward.x + v.z * forward.z;
				this.climb = 0;
				return;
			}
		}
		p.y = y;
	}

	/** On the ground: runs, steps up and down, slides off steep slopes, jumps, walks off edges and into water. */
	private walk(dt: number): void {
		if (this.skating) {
			this.skate(dt);
			return;
		}
		const p = this.position;
		const want = this.wantedVelocity(false);
		const here = this.floorAt(p.x, p.z, p.y + 0.1, p.y - 0.5);
		this.sliding = !!here && here.normal.y < WALKABLE;
		if (this.sliding) {
			// Too steep to stand on: slide down it, faster and faster, and the keys can't take you up it.
			const down = WalkControls.downhill(here!.normal);
			const sin = Math.sqrt(1 - here!.normal.y ** 2);
			const along = this.velocity.dot(down);
			this.velocity.copy(down).multiplyScalar(Math.max(0, along) + GRAVITY * sin * SLIDE_GRIP * dt);
			const up = want.dot(down);
			if (up < 0) want.addScaledVector(down, -up);
			want.add(this.velocity);
		} else {
			this.velocity.copy(want);
		}
		if (this.keys.has('Space') && !this.sliding) {
			this.velocity.copy(want);
			this.velocity.y = JUMP_SPEED;
			this.leaveGround(true);
			this.fall(dt);
			return;
		}

		const start = p.clone();
		this.moveAcross(want.clone().multiplyScalar(dt));
		if (this.intoTerrain(start, start.y + STEP_UP)) p.copy(start);
		let floor = this.floorAt(p.x, p.z, start.y + STEP_UP, start.y - SNAP_DOWN);
		// Walking up into ground too steep to stand on: only the part of the move along or down the slope goes.
		if (floor && floor.normal.y < WALKABLE && floor.y > start.y + 0.05) {
			const down = WalkControls.downhill(floor.normal);
			const move = p.clone().sub(start).setY(0);
			const into = move.dot(down);
			if (into < 0) move.addScaledVector(down, -into);
			p.copy(start);
			this.moveAcross(move);
			floor = this.floorAt(p.x, p.z, start.y + STEP_UP, start.y - SNAP_DOWN);
			if (floor && floor.normal.y < WALKABLE && floor.y > start.y + 0.05) {
				p.copy(start);
				floor = here;
			}
		}
		if (!floor) {
			// Walked off an edge (or into a hole): fall, carrying on the way it was going.
			this.velocity.set((p.x - start.x) / dt, 0, (p.z - start.z) / dt);
			this.leaveGround(false);
			return;
		}
		p.y = floor.y;
		this.ground = floor.ground;
		if (!this.sliding) {
			this.lastStand.copy(p);
			this.lastStandFacing = this.facing;
			this.hasStood = true;
		}
		const water = this.world!.liquid(p);
		if (water && water.surface - p.y > SWIM_DEPTH * this.height + SWIM_BAND) this.startSwimming();
	}

	private leaveGround(jumped: boolean): void {
		this.state = 'air';
		this.onWater = false;
		this.kickTime = 0;
		this.trick = null;
		this.airTime = 0;
		this.jumped = jumped;
		this.sliding = false;
	}

	/** In the air: keeps the speed it left the ground with, falls, and lands (or splashes down). */
	private fall(dt: number): void {
		const p = this.position;
		this.airTime += dt;
		if (this.airTime > LOST_FALL && this.hasStood) {
			this.place(this.lastStand, this.lastStandFacing);
			return;
		}
		if (this.wall) {
			this.wallRide(dt);
			return;
		}
		if (this.skating) this.airControl(dt);
		const v = this.velocity;

		v.y = Math.max(v.y - GRAVITY * dt, -TERMINAL_SPEED);
		const start = p.clone();
		this.moveAcross(new THREE.Vector3(v.x * dt, 0, v.z * dt));
		if (this.intoTerrain(start, start.y + STEP_UP * 0.5)) p.copy(start);
		// A wall in the way takes that speed away.
		if (dt > 0) {
			v.x = (p.x - start.x) / dt;
			v.z = (p.z - start.z) / dt;
		}
		let y = p.y + v.y * dt;
		if (v.y > 0) {
			// The head hits a ceiling.
			const head = p.clone().setY(p.y + this.height);
			if (this.world!.nearBuilding(head, v.y * dt + 1)) {
				const hit = this.world!.cast(head, UP, v.y * dt + 0.05);
				if (hit) {
					y = p.y + Math.max(0, hit.distance - 0.05);
					v.y = 0;
				}
			}
		}
		const top = Math.max(p.y, y) + (v.y <= 0 ? STEP_UP * 0.5 : 0.1);
		const floor = this.floorAt(p.x, p.z, top, Math.min(p.y, y) - 0.01);
		if (floor && (v.y <= 0 || floor.y >= y)) {
			y = Math.max(y, floor.y);
			if (v.y <= 0) {
				p.y = y;
				this.state = 'ground';
				// The board lands rolling the way it faces, with what of its speed goes along the ground there.
				this.climb = v.y;
				const forward = this.forward();
				const { cos, sin } = WalkControls.slopeAlong(floor.normal, forward);
				this.boardSpeed = (v.x * forward.x + v.z * forward.z) * cos + v.y * sin;
				this.velocity.y = 0;
				return;
			}
		}
		p.y = y;
		// Still rising (jumped out of the water), it doesn't fall back in until it comes down.
		if (v.y > 0) return;
		// Surfing, coming down on the water lands on it, rolling on as on the ground.
		const wave = this.skating ? this.surfAt(p.x, p.y, p.z) : null;
		if (wave !== null && p.y <= wave) {
			p.y = wave;
			this.state = 'ground';
			this.onWater = true;
			this.climb = v.y;
			const forward = this.forward();
			this.boardSpeed = v.x * forward.x + v.z * forward.z;
			v.y = 0;
			return;
		}
		const water = this.world!.liquid(p);
		if (water && water.surface - p.y > SWIM_DEPTH * this.height + SWIM_BAND) this.startSwimming();
	}

	/** A little steering on the board in the air: turning it bends the flight round; W pushes on and S holds back, gently. */
	private airControl(dt: number): void {
		const v = this.velocity;
		const forward = this.forward();
		const across = Math.hypot(v.x, v.z);
		if (across > 0.5) {
			const heading = Math.atan2(v.x, v.z);
			// Toward the nose, or the tail when flying backwards.
			let delta = angleDelta(heading, Math.atan2(forward.x, forward.z));
			if (Math.abs(delta) > Math.PI / 2) delta = angleDelta(heading, Math.atan2(-forward.x, -forward.z));
			const turned = heading + Math.sign(delta) * Math.min(Math.abs(delta), AIR_STEER * dt);
			v.x = Math.sin(turned) * across;
			v.z = Math.cos(turned) * across;
		}
		const push = this.intent.x;
		if (push > 0 && across < PUSH_SPEED) {
			v.x += forward.x * AIR_PUSH * dt;
			v.z += forward.z * AIR_PUSH * dt;
		} else if (push < 0 && across > 0) {
			const slowed = Math.max(0, across - AIR_PUSH * dt) / across;
			v.x *= slowed;
			v.z *= slowed;
		}
	}

	private startSwimming(): void {
		this.state = 'swim';
		this.skating = false;
		this.wall = null;
		this.velocity.y = 0;
		this.sliding = false;
	}

	/**
	 * Swimming: at the surface unless sinking (X) or diving (forward while steering with the
	 * camera looking down); Space rises, and at the surface jumps up out of the water (to fall
	 * back in, or onto a ledge). A shallow enough bottom, or a low shore, stands you up.
	 */
	private swim(dt: number): void {
		const p = this.position;
		const water = this.world!.liquid(p);
		const floating = water ? water.surface - SWIM_FLOAT * this.height : -Infinity;
		const want = this.wantedVelocity(true);
		if (this.keys.has('Space') && water && p.y >= floating - 0.05) {
			this.velocity.set(want.x, JUMP_SPEED, want.z);
			this.leaveGround(true);
			this.fall(dt);
			return;
		}
		let rise = 0;
		if (this.keys.has('Space')) rise += SWIM_RISE;
		if (this.keys.has('KeyX')) rise -= SWIM_RISE;
		// Steering, forward follows the camera up and down, as in the game, once under the surface.
		if (this.steering && this.intent.x > 0) {
			const dive = Math.sin(this.pitch) * want.length();
			if (dive < 0 || p.y < floating - 0.05) {
				want.multiplyScalar(Math.cos(this.pitch));
				rise += dive;
			}
		}
		const start = p.clone();
		this.moveAcross(want.clone().multiplyScalar(dt));
		const climb = Math.max(start.y, floating) + SWIM_FLOAT * this.height + SHORE_CLIMB;
		if (this.intoTerrain(start, climb)) p.copy(start);
		this.velocity.set(want.x, rise, want.z);
		let y = Math.min(p.y + rise * dt, floating);
		// The bottom, a bank or a shore: stand on it if the water there is shallow enough.
		const floor = this.floorAt(p.x, p.z, climb, y - 0.01);
		if (floor && floor.y >= y) {
			y = floor.y;
			const depth = water ? water.surface - floor.y : 0;
			// Shallow enough (see SWIM_BAND), and ground that can be stood on, not a steep bank it would slide back off.
			if (depth < SWIM_DEPTH * this.height - SWIM_BAND && floor.normal.y >= WALKABLE) {
				p.y = y;
				this.state = 'ground';
				this.velocity.set(0, 0, 0);
				return;
			}
		}
		// How fast it really goes up or down (held at the surface or on the bottom, not at all), for the animation.
		this.velocity.y = dt > 0 ? (y - p.y) / dt : 0;
		p.y = y;
		if (!water) this.leaveGround(false);
	}

	/** The camera behind and above the character's head, pulled in front of anything in between. */
	private updateCamera(dt: number): void {
		const world = this.world;
		const ease = 1 - Math.exp(-dt * 12);
		this.zoom += (this.zoomTarget - this.zoom) * (dt > 0 ? ease : 1);
		const target = this.position.clone().setY(this.position.y + this.height * EYE);
		const yaw = this.yaw;
		const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(yaw) * Math.cos(this.pitch));
		let reach = this.zoom;
		if (world) {
			if (world.nearBuilding(target, reach + 1)) {
				const hit = world.cast(target, back, reach + CAMERA_GAP);
				if (hit) reach = Math.min(reach, hit.distance - CAMERA_GAP);
			}
			// The ground, unless the character is underground (in a cave), where it's overhead.
			if (target.y >= world.surface(target.x, target.z)) {
				const step = 0.5;
				for (let d = step; d <= reach + CAMERA_GAP; d += step) {
					const x = target.x + back.x * d;
					const y = target.y + back.y * d;
					const z = target.z + back.z * d;
					if (y < world.terrain(x, z) + 0.3) {
						reach = Math.min(reach, d - CAMERA_GAP);
						break;
					}
				}
			}
		}
		reach = Math.max(0.1, reach);
		// In at once, so nothing hides the character; back out gently.
		if (reach < this.distance || dt <= 0) this.distance = reach;
		else this.distance += (reach - this.distance) * (1 - Math.exp(-dt * CAMERA_EASE_OUT));
		this.camera.position.copy(target).addScaledVector(back, this.distance);
		this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, yaw, 0, 'YXZ'));
	}
}
