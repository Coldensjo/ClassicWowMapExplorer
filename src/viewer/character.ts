import * as THREE from 'three';
import { BOARD_FIRE_MODEL, type CharacterOutfit } from '../explorer/spawns';
import type { CharacterModel } from '../explorer/world';
import type { AnimationClip } from '../formats/m2Pose';
import { ANIM } from '../formats/m2Pose';
import type { AsyncStorageApi } from '../worker/protocol';
import type { LoadedEmitter, EmitterSource } from './particles';
import { EMOTE_CLIPS, isPose, type Emote } from './emotes';
import { createModelMaterial, createSkinnedDepthMaterial, type SkinUniforms } from './modelMaterials';
import { useShadows } from './shadows';
import { TextureCache } from './textureCache';
import { angleDelta, GRAVITY, RUN_SPEED, trickTime, type SkateTrick, SWIM_BACK_SPEED, SWIM_SPEED, WALK_SPEED, type WalkControls } from './walkControls';

/** How quickly the body turns toward the way it's moving (strafing), radians per second. */
const BODY_TURN_RATE = 10;
/** Seconds one animation takes to blend into the next. */
const BLEND_TIME = 0.15;
/** The walker's capsule is this tall at scale 1; the model's height sets its scale. */
const WALKER_HEIGHT = 2;
/** Falling longer than this (s) without having jumped shows the Fall animation; shorter drops keep running. */
const FALL_AFTER = 0.3;
/** Swimming up or down faster than this (yd/s) shows it; slower is drifting at the surface or on the bottom. */
const SWIM_VERTICAL = 0.5;
/** The most the body tilts up or down swimming (radians), and how quickly it gets there (per second). */
const MAX_SWIM_TILT = THREE.MathUtils.degToRad(75);
const SWIM_TILT_RATE = 4;
/** Landing after this long in the air (s), standing still, plays JumpEnd. */
const LAND_AFTER = 0.3;
/** Every sequence the character plays, sampled into its bone texture: moving about, then the emotes. */
/** The AnimationData sequence played falling off the board: dying, which ends lying on the ground. */
const DEATH = 1;
const CLIPS: number[] = [...Object.values(ANIM), ...EMOTE_CLIPS, DEATH];
/** What to play when a model lacks a sequence: the next that it has, else Stand. */
const FALLBACK: Partial<Record<number, number[]>> = {
	[ANIM.Walk]: [ANIM.Run],
	[ANIM.Run]: [ANIM.Walk],
	[ANIM.Walkbackwards]: [ANIM.Walk, ANIM.Run],
	[ANIM.JumpStart]: [ANIM.Jump, ANIM.Fall],
	[ANIM.Jump]: [ANIM.Fall],
	[ANIM.Fall]: [ANIM.Jump],
	[ANIM.SwimIdle]: [ANIM.Swim],
	[ANIM.SwimLeft]: [ANIM.Swim],
	[ANIM.SwimRight]: [ANIM.Swim],
	[ANIM.SwimBackwards]: [ANIM.Swim],
	[ANIM.SwimUp]: [ANIM.Swim],
};
/** Sequences played once and held on their last frame; the rest loop. */
const ONCE = new Set<number>([ANIM.JumpStart, ANIM.JumpEnd]);

/**
 * Who the character is: a race and sex, the classic or HD model, and which of their NPC looks it
 * wears, or a whole outfit (an NPC's look with its weapons) for its race.
 */
export interface CharacterLook {
	race: number;
	sex: number;
	hd: boolean;
	look: number;
	outfit: CharacterOutfit | null;
}

/** World axes from a model's (x forward, y left, z up): forward is north (-z), left is west (-x). */
const MODEL_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));

/** A clip playing: which, how far in (s), how fast, and whether it plays once and holds its last frame rather than looping. */
interface Playing {
	clip: AnimationClip;
	time: number;
	rate: number;
	once: boolean;
}

/** What to play next: an animation, how fast, played once or looped, and whether to start it over even if it's playing. */
interface Choice {
	id: number;
	rate: number;
	once?: boolean;
	restart?: boolean;
}

/**
 * An emote being performed: getting down into a pose, playing (or holding the pose), or getting
 * back up; repeat plays a once-off emote over and over. fresh starts the phase's clip from the top.
 */
interface Emoting {
	emote: Emote;
	repeat: boolean;
	phase: 'down' | 'play' | 'up';
	fresh: boolean;
}

/**
 * Chooses and plays the character's animations from what the walker is doing, blending each
 * into the next and running the feet at the speed it moves.
 */
class Animator {
	private readonly clips = new Map<number, AnimationClip>();
	private current: Playing | null = null;
	private previous: Playing | null = null;
	/** 0 when a new clip has just started, 1 once the previous one has faded out. */
	private fade = 1;
	private wasState = '';
	private airTime = 0;
	/** Seconds JumpEnd still has to play. */
	private landing = 0;
	private emoting: Emoting | null = null;
	/** Called when a foot comes down in the clip playing (its footstep events). */
	onStep: (() => void) | null = null;

	/** A bone's matrix in the pose now, blending the clips as the shader does; or in a frame (row) of the bone data, if given. */
	boneMatrix(bone: number, data: Float32Array, bones: number, out: THREE.Matrix4, row?: number): THREE.Matrix4 {
		const { uPoseA, uPoseB, uPoseMix } = this.uniforms;
		if (row !== undefined) {
			const m = boneRow(data, bones, bone, row);
			return out.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
		}
		const mixed = (pose: THREE.Vector3, into: number[]) => {
			const a = boneRow(data, bones, bone, pose.x), b = boneRow(data, bones, bone, pose.y);
			for (let k = 0; k < 12; k++) into[k] = a[k] * (1 - pose.z) + b[k] * pose.z;
		};
		const m: number[] = new Array(12);
		mixed(uPoseA.value, m);
		const mix = uPoseMix.value;
		if (mix > 0) {
			const other: number[] = new Array(12);
			mixed(uPoseB.value, other);
			for (let k = 0; k < 12; k++) m[k] = m[k] * (1 - mix) + other[k] * mix;
		}
		return out.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
	}

	constructor(clips: AnimationClip[], private readonly uniforms: Required<Pick<SkinUniforms, 'uPoseA' | 'uPoseB' | 'uPoseMix'>>) {
		for (const c of clips) if (c.id !== undefined) this.clips.set(c.id, c);
	}

	/** The clip for an animation, or its stand-in when the model lacks it. */
	private find(id: number): AnimationClip {
		for (const k of [id, ...(FALLBACK[id] ?? []), ANIM.Stand]) {
			const c = this.clips.get(k);
			if (c) return c;
		}
		return this.clips.values().next().value!;
	}

	/**
	 * Starts an emote; false when the model hasn't its sequence. Asked for again while it loops,
	 * repeats or holds a pose, it stops instead (getting up from a pose); a once-off one starts over.
	 */
	perform(emote: Emote, repeat: boolean): boolean {
		if (!this.clips.has(emote.play)) return false;
		const now = this.emoting;
		if (now?.emote === emote && now.phase !== 'up' && (emote.loop || isPose(emote) || now.repeat)) {
			this.stopEmote();
			return true;
		}
		const down = emote.down !== undefined && this.clips.has(emote.down) ? 'down' : 'play';
		this.emoting = { emote, repeat, phase: down, fresh: true };
		return true;
	}

	/** Drops the emote at once, without getting up. */
	cancelEmote(): void {
		this.emoting = null;
	}

	/** Ends the emote: a pose is got up from, anything else stops where it is. */
	stopEmote(): void {
		const e = this.emoting;
		if (!e) return;
		if (e.phase !== 'up' && e.emote.up !== undefined && this.clips.has(e.emote.up)) this.emoting = { ...e, phase: 'up', fresh: true };
		else this.emoting = null;
	}

	/** The emote being performed, if any. */
	get emote(): Emote | null {
		return this.emoting?.emote ?? null;
	}

	/** Whether the clip playing has reached its end (for those played once). */
	private ended(id: number): boolean {
		const p = this.current;
		return !!p && p.clip.id === id && p.time >= p.clip.duration * 0.999 - 1e-6;
	}

	/** The emote's animation now, moving on from each phase as its clip ends; null once it's over. */
	private chooseEmote(): Choice | null {
		const e = this.emoting!;
		const { emote } = e;
		const once = !(emote.loop || isPose(emote) || e.repeat);
		if (!e.fresh) {
			if (e.phase === 'down' && this.ended(emote.down!)) Object.assign(e, { phase: 'play', fresh: true });
			else if (e.phase === 'up' && this.ended(emote.up!)) this.emoting = null;
			else if (e.phase === 'play' && once && this.ended(emote.play)) this.emoting = null;
		}
		if (!this.emoting) return null;
		const restart = e.fresh;
		e.fresh = false;
		if (e.phase === 'down') return { id: emote.down!, rate: 1, once: true, restart };
		if (e.phase === 'up') return { id: emote.up!, rate: 1, once: true, restart };
		return { id: emote.play, rate: 1, once, restart };
	}

	private speedOf(clip: AnimationClip, fallback: number): number {
		return clip.speed || fallback;
	}

	/** What to play for the walker now, and how fast. */
	private choose(dt: number, w: WalkControls): Choice {
		const { x: forward, y: right } = w.intent;
		const moving = forward !== 0 || right !== 0 || w.kicking;
		const landed = this.wasState === 'air' && w.state !== 'air';
		if (w.state === 'air') this.airTime = w.airTime;
		if (landed && this.airTime > LAND_AFTER && !moving && w.state === 'ground') this.landing = this.find(ANIM.JumpEnd).duration;
		this.landing = moving || w.state !== 'ground' ? 0 : Math.max(0, this.landing - dt);
		this.wasState = w.state;

		// Moving, jumping, falling or swimming ends an emote at once, as in the game.
		if (this.emoting && (moving || w.state !== 'ground')) this.emoting = null;
		if (this.emoting) {
			const emote = this.chooseEmote();
			if (emote) return emote;
		}

		// Fallen off the board: down on the ground.
		if (w.fallenTime > 0) return { id: DEATH, rate: 1.4, once: true };
		// On the board it stands and rolls, stepping down to kick it along; only an ollie jumps.
		if (w.kicking) return { id: ANIM.Walk, rate: 1.4 };
		if (w.skating && w.state !== 'swim' && !(w.state === 'air' && w.jumped)) return { id: ANIM.Stand, rate: 1 };
		if (w.state === 'swim') {
			// Mostly upward: the swimming-up animation. Down (sinking, diving) is Swim, tilted (see swimTilt).
			const up = w.velocity.y;
			const across = Math.hypot(w.velocity.x, w.velocity.z);
			if (up > SWIM_VERTICAL && up >= across) return { id: ANIM.SwimUp, rate: 1 };
			if (up < -SWIM_VERTICAL && -up >= across) return { id: ANIM.Swim, rate: 1 };
			if (!moving) return { id: ANIM.SwimIdle, rate: 1 };
			const id = forward < 0 ? ANIM.SwimBackwards : forward === 0 ? (right < 0 ? ANIM.SwimLeft : ANIM.SwimRight) : ANIM.Swim;
			const reference = forward < 0 ? SWIM_BACK_SPEED : SWIM_SPEED;
			return { id, rate: Math.max(0.5, w.moveSpeed / reference) };
		}
		if (w.state === 'air') {
			if (w.jumped) return { id: w.airTime < this.find(ANIM.JumpStart).duration && this.clips.has(ANIM.JumpStart) ? ANIM.JumpStart : ANIM.Jump, rate: 1 };
			// A short drop (off a step, down a slope) keeps whatever it was doing.
			if (w.airTime < FALL_AFTER && this.current) return { id: this.current.clip.id ?? ANIM.Stand, rate: this.current.rate, once: this.current.once };
			return { id: ANIM.Fall, rate: 1 };
		}
		if (this.landing > 0) return { id: ANIM.JumpEnd, rate: 1 };
		if (moving) {
			if (forward < 0) {
				const clip = this.find(ANIM.Walkbackwards);
				return { id: ANIM.Walkbackwards, rate: w.moveSpeed / this.speedOf(clip, this.speedOf(this.find(ANIM.Walk), WALK_SPEED)) };
			}
			// Strafing runs too, the body turned the way it goes (see bodyTurn).
			const id = w.walkMode ? ANIM.Walk : ANIM.Run;
			return { id, rate: w.moveSpeed / this.speedOf(this.find(id), w.walkMode ? WALK_SPEED : RUN_SPEED) };
		}
		if (w.turning) return { id: w.turning > 0 ? ANIM.ShuffleLeft : ANIM.ShuffleRight, rate: 1 };
		return { id: ANIM.Stand, rate: 1 };
	}

	/** Whether the model has its own clip for an animation (rather than a stand-in). */
	has(id: number): boolean {
		return this.clips.has(id);
	}

	/** The animation playing now. */
	get playing(): number {
		return this.current?.clip.id ?? ANIM.Stand;
	}

	update(dt: number, walker: WalkControls): void {
		const { id, rate, once = ONCE.has(id), restart } = this.choose(dt, walker);
		const clip = this.find(id);
		if (!this.current || this.current.clip !== clip || restart) {
			// Mid-blend, the newest pose so far is what fades out.
			this.previous = this.current && this.fade < 0.5 && this.previous ? this.previous : this.current;
			this.current = { clip, time: 0, rate, once };
			this.fade = this.previous ? 0 : 1;
		}
		this.current.rate = rate;
		this.current.once = once;
		for (const p of [this.current, this.previous]) {
			if (!p) continue;
			const before = p.time;
			p.time += dt * p.rate;
			// Footfalls of the clip blending in (not of the one fading out), round the end of the loop too.
			if (p === this.current && this.onStep && p.clip.steps?.length && !p.once) {
				const end = p.clip.duration;
				const after = p.time;
				if (p.clip.steps.some((t) => (after < end ? t > before && t <= after : t > before || t <= after - end))) this.onStep();
			}
			const end = p.clip.duration;
			if (p.once) p.time = Math.min(p.time, end * 0.999);
			else p.time = THREE.MathUtils.euclideanModulo(p.time, end);
		}
		this.fade = Math.min(1, this.fade + dt / BLEND_TIME);
		if (this.fade >= 1) this.previous = null;
		Animator.pose(this.current, this.uniforms.uPoseA.value);
		if (this.previous) Animator.pose(this.previous, this.uniforms.uPoseB.value);
		// Eased, so the blend starts and ends gently.
		this.uniforms.uPoseMix.value = this.previous ? 1 - THREE.MathUtils.smoothstep(this.fade, 0, 1) : 0;
	}

	/** The two sampled frames a moment in a clip falls between, and how far between, as rows of the bone texture. */
	private static pose(p: Playing, out: THREE.Vector3): void {
		const { row, frames, duration } = p.clip;
		const at = (p.time / duration) * frames;
		const i = Math.min(Math.floor(at), frames - 1);
		const next = i + 1 < frames ? i + 1 : p.once ? i : 0;
		out.set(row + i, row + next, at - Math.floor(at));
	}
}

/** A held torch's flame and smoke are drawn this much of their size and opacity: the game's are a big, bright glow. */
const TORCH_SIZE = 0.5;
const TORCH_ALPHA = 0.5;

/** The skateboard's deck stands this high off the ground at scale 1 (yards): the feet stand on it. */
const BOARD_HEIGHT = 0.12;
/** The board is drawn this many times its built size (a real board's, for a human): a bit bigger, to read at a distance. */
const BOARD_SIZE = 2;
/** The most the rider leans into a turn (radians), and how quickly the lean and the board's tilt follow (per second). */
const MAX_LEAN = THREE.MathUtils.degToRad(30);
const BOARD_EASE = 10;
/** The fire on the board's tail during a takedown's burst: where on the board (built size, yards back from the middle), and its flames' size. */
const FIRE_BACK = 0.42;
const FIRE_SIZE = 0.6;
/** Nitro's fire is this much bigger. */
const NITRO_FIRE = 1.8;

/** The shockwave when the board hits someone (and a mega jump goes off): how long it takes to spread (s), and its colour, hotter for a takedown. */
const SHOCKWAVE_TIME = 0.35;
const SHOCKWAVE_COLOR = 0xbfe4ff;
const SHOCKWAVE_HIT_COLOR = 0xff8a2a;

/**
 * A flat ring in the horizontal plane, from inner out to radius 1, its colour's alpha fading
 * toward both edges, for drawing additively as a glowing band.
 */
function ringGeometry(inner: number, segments: number): THREE.BufferGeometry {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	// Three rings of points: inner edge, middle, outer edge; bright in the middle.
	const radii = [inner, (inner + 1) / 2, 1];
	const edge = [0, 1, 0];
	for (let i = 0; i <= segments; i++) {
		const a = (i / segments) * Math.PI * 2;
		for (let j = 0; j < 3; j++) {
			positions.push(-Math.sin(a) * radii[j], 0, -Math.cos(a) * radii[j]);
			colors.push(1, 1, 1, edge[j]);
		}
	}
	for (let i = 0; i < segments; i++) {
		for (let j = 0; j < 2; j++) {
			const a = i * 3 + j, b = a + 3;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
	geometry.setIndex(indices);
	return geometry;
}

/** A glowing, unlit, see-through-adding material for the shockwave and the charge ring. */
function glowMaterial(color: number): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
}

/** The mega jump's charge: a ring closing in on the board from this far (yards at scale 1), and its colour. */
const CHARGE_REACH = 3;
const CHARGE_COLOR = 0xffe08a;

/** A trick lifts the board this high at its middle (yards at scale 1). */
const TRICK_LIFT = 0.2;
/** How quickly the board turns over to be held upside down, and back (per second). */
const GRAB_EASE = 14;

/** How a trick turns the board (about its middle) and the rider, or both together (about the rider's middle, so high), at a share of the way through it. */
function trickTurn(trick: SkateTrick, at: number, middle: number): { board: THREE.Matrix4; body: THREE.Matrix4; whole?: THREE.Matrix4 } {
	const turn = Math.PI * 2 * at;
	const board = new THREE.Matrix4();
	const body = new THREE.Matrix4();
	switch (trick) {
		case 'Backflip':
			// Rider and board together, nose up and over backwards, round the rider's middle.
			return {
				board,
				body,
				whole: new THREE.Matrix4().makeTranslation(0, middle, 0).multiply(new THREE.Matrix4().makeRotationX(turn)).multiply(new THREE.Matrix4().makeTranslation(0, -middle, 0)),
			};
		case 'Kickflip':
			board.makeRotationZ(turn);
			break;
		case 'Heelflip':
			board.makeRotationZ(-turn);
			break;
		case '360 Shove-it':
			board.makeRotationY(turn);
			break;
		case '360 Flip':
			board.makeRotationY(turn).multiply(new THREE.Matrix4().makeRotationZ(turn));
			break;
		case 'Impossible':
			board.makeRotationX(turn);
			break;
		case 'Body Varial':
			body.makeRotationY(turn);
			board.copy(body);
			break;
	}
	return { board, body };
}

/**
 * A skateboard built from boxes and cylinders, its wheels on the ground at the origin and its
 * nose toward -z (forward, as the world faces at no turn): a deck with kicked-up tails, grip tape
 * on top, two trucks and four wheels.
 */
function buildBoard(): THREE.Group {
	const board = new THREE.Group();
	const wood = new THREE.MeshLambertMaterial({ color: 0xc0783a });
	const grip = new THREE.MeshLambertMaterial({ color: 0x202020 });
	const metal = new THREE.MeshLambertMaterial({ color: 0xa8aeb4 });
	const urethane = new THREE.MeshLambertMaterial({ color: 0xf0e2c0 });
	// Box faces: +x, -x, +y (the grip), -y, +z, -z.
	const deckMaterials = [wood, wood, grip, wood, wood, wood];
	const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, tilt = 0) => {
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(x, y, z);
		mesh.rotation.x = tilt;
		useShadows(mesh, 'near');
		board.add(mesh);
		return mesh;
	};
	const thick = 0.025;
	const width = 0.24;
	const half = 0.34;
	const deckY = BOARD_HEIGHT - thick / 2;
	add(new THREE.BoxGeometry(width, thick, half * 2), deckMaterials, 0, deckY, 0);
	// The nose and tail, hinged at the deck's ends and kicked up.
	const tail = 0.13;
	const kick = 0.35;
	const tailGeometry = new THREE.BoxGeometry(width * 0.95, thick, tail);
	for (const end of [-1, 1]) {
		const z = end * (half + (tail / 2) * Math.cos(kick));
		add(tailGeometry, deckMaterials, 0, deckY + (tail / 2) * Math.sin(kick), z, -end * kick);
	}
	const axle = 0.26;
	const wheel = 0.035;
	const truck = new THREE.BoxGeometry(width * 0.8, 0.03, 0.05);
	const tyre = new THREE.CylinderGeometry(wheel, wheel, 0.035, 12);
	tyre.rotateZ(Math.PI / 2);
	for (const end of [-1, 1]) {
		add(truck, metal, 0, wheel + 0.03, end * axle);
		for (const side of [-1, 1]) add(tyre, urethane, side * width * 0.48, wheel, end * axle);
	}
	board.matrixAutoUpdate = false;
	board.visible = false;
	return board;
}

/** Models built so far, to number them. */
let modelCount = 0;

/** A bone's row-major 3x4 matrix in a frame (row) of the bone data. */
function boneRow(data: Float32Array, bones: number, bone: number, row: number): Float32Array {
	const at = (Math.round(row) * bones + bone) * 12;
	return data.subarray(at, at + 12);
}

/** A flame or smoke emitter on held gear: its bone, its frame with the body at rest, and the inverse of that bone's pose then. */
interface HeldEmitter {
	loaded: LoadedEmitter;
	bone: number;
	frame: THREE.Matrix4;
	rest: THREE.Matrix4;
}

/** The walking character's model, ready to draw. */
interface LoadedModel {
	/** The emitters of held gear (a torch's flame), following their bones. */
	held: HeldEmitter[];
	bones: number;
	boneData: Float32Array;
	/** Tells this model's emitters from another's to the particle system. */
	id: number;
	group: THREE.Group;
	mesh: THREE.Mesh;
	animator: Animator;
	textures: number[];
	boneTexture: THREE.DataTexture;
	/** Height of the model (yards), which sets the walker's size. */
	height: number;
}

/**
 * The walking character as drawn: a race's model dressed as one of its NPC looks (through the
 * same pipeline as the NPCs), animated from what the walker does. Nothing is drawn while it
 * loads; a capsule stands in only if it can't be. Strafing turns the body toward the way it goes, as the game does: a
 * quarter turn sideways, an eighth on the diagonals, and backing away on a diagonal turns it the
 * other way.
 */
export class Character {
	readonly group = new THREE.Group();
	/** The body's turn away from the facing, eased. */
	private bodyTurn = 0;
	/** The body's tilt up (+) or down (-) swimming, eased. */
	private tilt = 0;
	private readonly capsule = new THREE.Group();
	/** The skateboard, under the feet while riding. */
	private readonly board = buildBoard();
	/** The lean into a turn on the board (radians, left +), and the ground's normal the board lies on, both eased. */
	private lean = 0;
	private readonly boardUp = new THREE.Vector3(0, 1, 0);
	private lastFacing = 0;
	/** How far over the board's turned to be held upside down (0 right way up, 1 upside down), eased. */
	private grabFlip = 0;
	/** The fire doodad's flames, once loaded, and where they burn on the board's tail this frame (null when not burning). */
	private fire: LoadedEmitter[] = [];
	private fireFrames: THREE.Matrix4[] | null = null;
	/** The shockwave spreading over the ground where the board hit someone, and how long it's been going (s; past SHOCKWAVE_TIME, done). */
	private readonly wave = new THREE.Mesh(ringGeometry(0.8, 96), glowMaterial(SHOCKWAVE_COLOR));
	private waveTime = Infinity;
	private waveReach = 1;
	private readonly waveAt = new THREE.Vector3();
	/** The mega jump's charge ring, closing in round the feet; how far through the charge it is (0-1; null when not charging). */
	private readonly chargeRing = new THREE.Mesh(ringGeometry(0.75, 96), glowMaterial(CHARGE_COLOR));
	charge: number | null = null;
	private model: LoadedModel | null = null;
	private readonly textures: TextureCache;
	/** The look asked for last, so a slower earlier load doesn't replace it. */
	private wanted = '';
	/** How many looks the race and sex worn have, once loaded. */
	looks = 0;
	/** Called when the character puts a foot down, with its footstep kind (see ModelData.footstep). */
	onStep: ((footstep: number) => void) | null = null;

	constructor(
		private readonly storage: AsyncStorageApi,
		compressed: boolean,
		anisotropy: number,
		private readonly prepare: (object: THREE.Object3D, shadowPass?: boolean) => Promise<void>,
	) {
		this.textures = new TextureCache(storage, compressed, anisotropy);
		const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.2, 6, 16), new THREE.MeshLambertMaterial({ color: 0x4f7fd0 }));
		body.position.y = 1;
		const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 12), new THREE.MeshLambertMaterial({ color: 0xe0c060 }));
		nose.rotation.x = -Math.PI / 2;
		nose.position.set(0, 1.6, -0.45);
		for (const mesh of [body, nose]) {
			useShadows(mesh, 'near');
			this.capsule.add(mesh);
		}
		this.capsule.visible = false;
		void this.loadFire();
		for (const effect of [this.wave, this.chargeRing]) {
			effect.matrixAutoUpdate = false;
			effect.frustumCulled = false;
			effect.visible = false;
			// Drawn after the world, over the water too.
			effect.renderOrder = 10;
		}
		this.group.add(this.capsule, this.wave, this.chargeRing);
		// Build their shaders now, not on the first hit (the effects themselves are hidden till then).
		void this.prepare(new THREE.Group().add(...[this.wave, this.chargeRing].map((m) => new THREE.Mesh(m.geometry, m.material))));
		this.group.add(this.board);
		this.group.visible = false;
	}

	/** Dresses the character as a look, holding a torch if it can; resolves to how many looks its race and sex have, or 0 if it couldn't. */
	async dress(look: CharacterLook, torch: boolean): Promise<number> {
		const key = JSON.stringify([look, torch]);
		this.wanted = key;
		let loaded: CharacterModel | null = null;
		try {
			loaded = await this.storage.loadCharacter(look.race, look.sex, look.hd, look.look, CLIPS, look.outfit, torch);
		} catch (e) {
			console.warn('Character model unavailable:', e);
		}
		if (this.wanted !== key) return this.looks;
		if (!loaded?.model.animation) {
			this.setModel(null);
			return 0;
		}
		const model = await this.build(loaded);
		if (this.wanted !== key) {
			this.disposeModel(model);
			return this.looks;
		}
		this.setModel(model);
		this.looks = loaded.looks;
		return loaded.looks;
	}

	private setModel(model: LoadedModel | null): void {
		if (this.model) {
			this.group.remove(this.model.group);
			this.disposeModel(this.model);
		}
		this.model = model;
		if (model) this.group.add(model.group);
		// Only set to null when the model couldn't be loaded.
		this.capsule.visible = !model;
	}

	/** Geometry, textures, the bone texture of every clip, and materials posed by the animator. */
	private async build({ model: data }: CharacterModel): Promise<LoadedModel> {
		const a = data.animation!;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
		geometry.setAttribute('boneIndex', new THREE.BufferAttribute(a.boneIndex, 4));
		geometry.setAttribute('boneWeight', new THREE.BufferAttribute(a.boneWeight, 4, true));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		const rows = a.data.length / (a.bones * 12);
		// Three RGBA texels per bone (the rows of its 3x4 matrix), one texel row per frame.
		const boneTexture = new THREE.DataTexture(a.data, a.bones * 3, rows, THREE.RGBAFormat, THREE.FloatType);
		boneTexture.magFilter = boneTexture.minFilter = THREE.NearestFilter;
		boneTexture.needsUpdate = true;
		const skin = {
			uBoneTex: { value: boneTexture as THREE.Texture },
			uPoseA: { value: new THREE.Vector3() },
			uPoseB: { value: new THREE.Vector3() },
			uPoseMix: { value: 0 },
		};
		const onBody = (data.emitters ?? []).filter((e) => e.bone !== undefined);
		const ids = [...new Set([...data.batches.map((b) => b.material.texture), ...onBody.map((e) => e.texture)].filter((t) => t))];
		const textures = await this.textures.acquire(ids);
		const batches = [...data.batches].sort((x, y) => x.order - y.order);
		const materials = batches.map((b, i) => {
			geometry.addGroup(b.start, b.count, i);
			return createModelMaterial(b.material, textures.get(b.material.texture) ?? null, false, skin);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		// The bones move it outside the bind pose's bounds.
		mesh.frustumCulled = false;
		mesh.customDepthMaterial = createSkinnedDepthMaterial(skin);
		useShadows(mesh, 'near');
		const group = new THREE.Group();
		group.matrixAutoUpdate = false;
		group.add(mesh);
		const animator = new Animator(a.clips, skin);
		const footstep = data.footstep ?? 0;
		animator.onStep = () => this.onStep?.(footstep);
		await Promise.all([this.prepare(group), this.prepare(new THREE.Mesh(geometry, mesh.customDepthMaterial), true)]);
		// Each rests in the Stand pose, which its frame was placed in: it moves with its bone's change from that.
		const stand = a.clips.find((c) => c.id === ANIM.Stand);
		const held = onBody.flatMap((e) => {
			const texture = textures.get(e.texture);
			if (!texture || !stand) return [];
			const rest = animator.boneMatrix(e.bone!, a.data, a.bones, new THREE.Matrix4(), stand.row);
			return [{ loaded: { def: { ...e, scale: { ...e.scale, values: e.scale.values.map((v) => v * TORCH_SIZE) }, alpha: { ...e.alpha, values: e.alpha.values.map((v) => v * TORCH_ALPHA) } }, texture }, bone: e.bone!, frame: new THREE.Matrix4().fromArray(e.frame), rest: rest.invert() }];
		});
		return { group, mesh, animator, textures: ids, boneTexture, height: data.height, held, bones: a.bones, boneData: a.data, id: ++modelCount };
	}

	private disposeModel(model: LoadedModel): void {
		model.mesh.geometry.dispose();
		for (const m of model.mesh.material as THREE.Material[]) m.dispose();
		(model.mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
		model.boneTexture.dispose();
		this.textures.release(model.textures);
	}

	/** Performs an emote (over and over with repeat); false when the model hasn't it, null while it's still loading. */
	emote(emote: Emote, repeat: boolean): boolean | null {
		return this.model ? this.model.animator.perform(emote, repeat) : null;
	}

	/** Stops the emote being performed, getting up from a pose. */
	stopEmote(): void {
		this.model?.animator.stopEmote();
	}

	/** The emote being performed, if any. */
	get emoting(): Emote | null {
		return this.model?.animator.emote ?? null;
	}

	/** The fire doodad's flames, for the board's tail (shrunk there by their frames). */
	private async loadFire(): Promise<void> {
		try {
			const [data] = await this.storage.loadModels([{ fdid: BOARD_FIRE_MODEL, kind: 'm2' }]);
			const emitters = data?.emitters ?? [];
			const textures = await this.textures.acquire([...new Set(emitters.map((e) => e.texture).filter((t) => t))]);
			this.fire = emitters.flatMap((def) => {
				const texture = textures.get(def.texture);
				return texture ? [{ def, texture }] : [];
			});
		} catch (e) {
			console.warn('Board fire unavailable:', e);
		}
	}

	/** Off the board, it's put away; but fallen off, it lies wheels up where it fell. */
	private showFallenBoard(walker: WalkControls): void {
		this.board.visible = walker.active && walker.fallenTime > 0;
		if (!this.board.visible) return;
		const scale = walker.scale * BOARD_SIZE;
		const middle = BOARD_HEIGHT * 0.5 * scale;
		this.board.matrix
			.makeTranslation(walker.fallSpot)
			.multiply(new THREE.Matrix4().makeRotationY(walker.fallFacing))
			.multiply(new THREE.Matrix4().makeTranslation(0, middle, 0))
			.multiply(new THREE.Matrix4().makeRotationZ(Math.PI))
			.multiply(new THREE.Matrix4().makeTranslation(0, -middle, 0))
			.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
		this.board.matrixWorldNeedsUpdate = true;
	}

	/** The torch's flame and the like, and the board's fire, in the world this frame; none while they aren't drawn. */
	emitterSources(): EmitterSource[] {
		const out: EmitterSource[] = [];
		const model = this.model;
		const frames = this.heldFrames();
		if (model && frames) out.push({ key: `character:${model.id}`, matrix: model.group.matrix, emitters: model.held.map((h) => h.loaded), frames });
		if (this.fireFrames && this.group.visible) out.push({ key: 'board-fire', matrix: this.board.matrix, emitters: this.fire, frames: this.fireFrames });
		return out;
	}

	/** The held emitters' frames in the world now; null while there are none or the character isn't drawn. */
	private heldFrames(): THREE.Matrix4[] | null {
		const model = this.model;
		if (!model?.held.length || !this.group.visible) return null;
		const bone = new THREE.Matrix4();
		return model.held.map((h) => {
			model.animator.boneMatrix(h.bone, model.boneData, model.bones, bone);
			return model.group.matrix.clone().multiply(bone).multiply(h.rest).multiply(h.frame);
		});
	}

	/** Where the torch's flame is in the world, or false when the character holds none in view. */
	torchAt(out: THREE.Vector3): boolean {
		const frame = this.heldFrames()?.[0];
		if (!frame) return false;
		out.setFromMatrixPosition(frame);
		return true;
	}

	/** A hit: a shockwave spreads over the ground from the feet so far, hot if it took anyone down. */
	shockwave(reach: number, hit: boolean, color = hit ? SHOCKWAVE_HIT_COLOR : SHOCKWAVE_COLOR): void {
		this.waveTime = 0;
		this.waveReach = reach;
		this.waveAt.copy(this.lastFeet);
		(this.wave.material as THREE.MeshBasicMaterial).color.set(color);
	}

	/** The mega jump going off: a golden burst from the feet. */
	launch(): void {
		this.shockwave(CHARGE_REACH * 1.5, true, CHARGE_COLOR);
	}

	/** The charge ring closing in round the feet, brighter as it goes. */
	private updateCharge(walker: WalkControls): void {
		const t = this.charge;
		this.chargeRing.visible = t !== null;
		if (t === null) return;
		const radius = CHARGE_REACH * walker.scale * (1 - 0.85 * THREE.MathUtils.smoothstep(t, 0, 1));
		(this.chargeRing.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.7 * t;
		const p = walker.position;
		this.chargeRing.matrix.makeTranslation(p.x, p.y + 0.15 + t * 0.6 * walker.scale, p.z).multiply(new THREE.Matrix4().makeScale(radius, 1, radius));
		this.chargeRing.matrixWorldNeedsUpdate = true;
	}

	/** Where the feet were last drawn. */
	private readonly lastFeet = new THREE.Vector3();

	/** The shockwave spreading out and fading. */
	private updateWave(dt: number): void {
		this.waveTime += dt;
		const t = this.waveTime / SHOCKWAVE_TIME;
		this.wave.visible = t < 1;
		if (t >= 1) return;
		const radius = this.waveReach * (0.2 + 0.8 * (1 - (1 - t) ** 3));
		(this.wave.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t) ** 1.5;
		this.wave.matrix.makeTranslation(this.waveAt.x, this.waveAt.y + 0.15, this.waveAt.z).multiply(new THREE.Matrix4().makeScale(radius, 1, radius));
		this.wave.matrixWorldNeedsUpdate = true;
	}

	/** Follows the walker: its place, size, the way it faces, its animation; hidden when the camera's in its head. */
	update(dt: number, walker: WalkControls): void {
		this.updateWave(dt);
		this.updateCharge(walker);
		this.group.visible = walker.active && !walker.firstPerson;
		if (!walker.active) {
			// Back on foot later, it stands rather than carrying on where it left off.
			this.model?.animator.cancelEmote();
			return;
		}
		const model = this.model;
		walker.scale = model ? THREE.MathUtils.clamp(model.height / WALKER_HEIGHT, 0.5, 1.5) : 1;
		const target = bodyTurn(walker);
		const delta = angleDelta(this.bodyTurn, target);
		this.bodyTurn += Math.sign(delta) * Math.min(Math.abs(delta), BODY_TURN_RATE * dt);
		const yaw = walker.facing + this.bodyTurn;
		const yawRate = dt > 0 ? angleDelta(this.lastFacing, walker.facing) / dt : 0;
		this.lastFacing = walker.facing;
		this.lastFeet.copy(walker.position);
		if (walker.skating && walker.state !== 'swim') {
			this.ride(dt, walker, yawRate, model);
			return;
		}
		this.showFallenBoard(walker);
		this.fireFrames = null;
		this.lean = 0;
		this.grabFlip = 0;
		if (model) {
			model.animator.update(dt, walker);
			const tilt = swimTilt(walker, model.animator);
			this.tilt += (tilt - this.tilt) * (1 - Math.exp(-dt * SWIM_TILT_RATE));
			model.group.matrix.makeTranslation(walker.position).multiply(MODEL_BASIS).multiply(new THREE.Matrix4().makeRotationZ(yaw));
			if (Math.abs(this.tilt) > 1e-3) {
				// About the middle of the body, around its left-right axis (model y): nose down is positive.
				const middle = model.height * 0.5;
				model.group.matrix
					.multiply(new THREE.Matrix4().makeTranslation(0, 0, middle))
					.multiply(new THREE.Matrix4().makeRotationY(-this.tilt))
					.multiply(new THREE.Matrix4().makeTranslation(0, 0, -middle));
			}
			model.group.matrixWorldNeedsUpdate = true;
		} else {
			this.capsule.position.copy(walker.position);
			this.capsule.rotation.y = yaw;
		}
	}

	/**
	 * Riding the skateboard: the board lies on the ground, leaning into turns as the rider does,
	 * and flips under the feet on an ollie; the rider stands on it, turned side-on.
	 */
	private ride(dt: number, walker: WalkControls, yawRate: number, model: LoadedModel | null): void {
		const ease = 1 - Math.exp(-dt * BOARD_EASE);
		const lean = walker.state === 'ground' ? THREE.MathUtils.clamp(Math.atan((walker.boardSpeed * yawRate) / GRAVITY), -MAX_LEAN, MAX_LEAN) : this.lean;
		this.lean += (lean - this.lean) * ease;
		// On a wall the board lies flat against it, its nose pointing up it.
		const up = walker.wall ?? (walker.state === 'ground' ? walker.groundNormal : new THREE.Vector3(0, 1, 0));
		this.boardUp.lerp(up, ease).normalize();
		const scale = walker.scale * BOARD_SIZE;
		const feet = walker.position.clone();
		if (walker.wall) feet.addScaledVector(walker.wall, -walker.radius);
		const base = new THREE.Matrix4()
			.makeTranslation(feet)
			.multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.boardUp)))
			.multiply(new THREE.Matrix4().makeRotationY(walker.facing))
			.multiply(new THREE.Matrix4().makeRotationZ(this.lean));
		// A trick turns the board round its middle, lifted clear of the feet, until it lands or is done.
		const t = walker.state === 'air' && walker.trick ? (walker.airTime - walker.trickStart) / trickTime(walker.trick) : 1;
		const trick = t < 1 ? trickTurn(walker.trick!, THREE.MathUtils.smootherstep(t, 0, 1), BOARD_HEIGHT * scale + walker.height * 0.5) : null;
		if (trick?.whole) base.multiply(trick.whole);
		const middle = BOARD_HEIGHT * 0.5 * scale;
		// Held upside down (E): turned over along its length, quickly.
		this.grabFlip += ((walker.grab ? 1 : 0) - this.grabFlip) * (1 - Math.exp(-dt * GRAB_EASE));
		this.board.matrix
			.copy(base)
			.multiply(new THREE.Matrix4().makeTranslation(0, middle + (trick && !trick.whole ? TRICK_LIFT * scale * Math.sin(Math.PI * t) : 0), 0))
			.multiply(trick?.board ?? new THREE.Matrix4())
			.multiply(new THREE.Matrix4().makeRotationZ(Math.PI * this.grabFlip))
			.multiply(new THREE.Matrix4().makeTranslation(0, -middle, 0))
			.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
		this.board.matrixWorldNeedsUpdate = true;
		this.board.visible = true;
		// A takedown's burst sets the tail alight: the doodad's flames, standing on it as the doodad stands on the ground.
		// Nitro sets it roaring.
		const fire = FIRE_SIZE * (walker.nitroTime > 0 ? NITRO_FIRE : 1);
		this.fireFrames = (walker.burstTime > 0 || walker.nitroTime > 0) && this.fire.length
			? this.fire.map((e) => this.board.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, BOARD_HEIGHT, FIRE_BACK)).multiply(MODEL_BASIS).multiply(new THREE.Matrix4().makeScale(fire, fire, fire)).multiply(new THREE.Matrix4().fromArray(e.def.frame)))
			: null;
		const body = base
			.clone()
			.multiply(new THREE.Matrix4().makeTranslation(0, BOARD_HEIGHT * scale, 0))
			.multiply(trick?.body ?? new THREE.Matrix4())
			.multiply(new THREE.Matrix4().makeRotationY(this.bodyTurn));
		if (model) {
			model.animator.update(dt, walker);
			this.tilt = 0;
			model.group.matrix.copy(body).multiply(MODEL_BASIS);
			model.group.matrixWorldNeedsUpdate = true;
		} else {
			this.capsule.position.setFromMatrixPosition(body);
			this.capsule.rotation.y = walker.facing + this.bodyTurn;
		}
	}
}

/**
 * How far to tilt the swimming body up (+) or down (-), radians: toward the way it's swimming,
 * as the game does diving. Not while the swimming-up animation (already leaning up) plays, nor
 * swimming backwards.
 */
function swimTilt(walker: WalkControls, animator: Animator): number {
	if (walker.state !== 'swim' || walker.intent.x < 0) return 0;
	if (animator.playing === ANIM.SwimUp && animator.has(ANIM.SwimUp)) return 0;
	const up = walker.velocity.y;
	if (Math.abs(up) < SWIM_VERTICAL) return 0;
	const across = Math.hypot(walker.velocity.x, walker.velocity.z);
	return THREE.MathUtils.clamp(Math.atan2(up, across), -MAX_SWIM_TILT, MAX_SWIM_TILT);
}

/** The body's turn from the facing for the way the character moves (see Character). */
export function bodyTurn(walker: WalkControls): number {
	// Side-on on the skateboard, left foot forward.
	// Turned forward for a kick, to step down and push.
	if (walker.skating && walker.state !== 'swim') return walker.kicking ? 0 : -Math.PI / 2;
	const { x: forward, y: right } = walker.intent;
	if (!right || walker.state === 'swim') return 0;
	// Sideways: face that way. Forward diagonals: halfway. Backward diagonals: turned the other way, backing off.
	const side = -right * (Math.PI / 2);
	return forward > 0 ? side / 2 : forward < 0 ? -side / 2 : side;
}
