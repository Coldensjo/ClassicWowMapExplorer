import { compose, fromQuaternion, multiply, scaling, translation, type Mat4 } from '../explorer/mat4';
import { chunks } from './chunks';

const BONE_SIZE = 88;
const SEQUENCE_SIZE = 64;
/** AnimationData IDs. */
const ANIM_STAND = 0;
const ANIM_WALK = 4;

/** AnimationData IDs the walking character plays (see viewer/character.ts). */
export const ANIM = {
	Stand: 0,
	Walk: 4,
	Run: 5,
	ShuffleLeft: 11,
	ShuffleRight: 12,
	Walkbackwards: 13,
	JumpStart: 37,
	Jump: 38,
	JumpEnd: 39,
	Fall: 40,
	SwimIdle: 41,
	Swim: 42,
	SwimLeft: 43,
	SwimRight: 44,
	SwimBackwards: 45,
	/**
	 * Swimming upward: unnamed in AnimationData, but it falls back to Swim and holds the body
	 * tilted up (about 65 degrees, against Swim's 30). Race models have no swimming-down one.
	 */
	SwimUp: 524,
} as const;
/** Sequence flags: its keys are in this file (not a separate .anim), and it stands for another (aliasNext). */
const SEQUENCE_EMBEDDED = 0x20;
const SEQUENCE_ALIAS = 0x40;

/** M2CompQuat: int16 components mapped to [-1, 1]. */
const compQuat = (v: number) => (v < 0 ? v + 32768 : v - 32767) / 32767;

/**
 * A list in a model or skeleton file: its records start at base + offset, and the offsets
 * within them (a bone's keys) count from base too.
 */
interface List {
	view: DataView;
	base: number;
	count: number;
	offset: number;
}

/**
 * A model's bones, sequences, attachment points and events. Most models keep them in the M2;
 * newer ones (the goblins) in a .skel file (SKID), each list in a chunk its offsets count from.
 */
export interface Skeleton {
	bones: List;
	sequences: List;
	attachments: List;
	events: List;
	/** Durations (ms) of the global sequences, for tracks that loop on their own. */
	loops: number[];
	/** A .skel file's own list of sequences kept in .anim files (AFID), in place of the model's. */
	animFiles?: { id: number; sub: number; fdid: number }[];
}

/** The list whose header (count, offset) is at at. */
function list(view: DataView, base: number, at: number): List {
	return { view, base, count: view.getUint32(at, true), offset: view.getUint32(at + 4, true) };
}

const loopDurations = (loops: List) => Array.from({ length: loops.count }, (_, k) => loops.view.getUint32(loops.base + loops.offset + k * 4, true));

/** The skeleton kept in the M2 itself. */
export function m2Skeleton(bytes: Uint8Array, md20: number): Skeleton {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		bones: list(view, md20, md20 + 0x2c),
		sequences: list(view, md20, md20 + 0x1c),
		attachments: list(view, md20, md20 + 0xf0),
		events: list(view, md20, md20 + 0x100),
		loops: loopDurations(list(view, md20, md20 + 0x14)),
	};
}

/**
 * The skeleton kept in a .skel file: bones (SKB1), sequences and global loops (SKS1) and
 * attachment points (SKA1). The model's events stay in the M2. Null without bones.
 */
export function skelSkeleton(skel: Uint8Array, bytes: Uint8Array, md20: number): Skeleton | null {
	const view = new DataView(skel.buffer, skel.byteOffset, skel.byteLength);
	const own = m2Skeleton(bytes, md20);
	const found = new Map<string, { offset: number; size: number }>();
	for (const c of chunks(skel)) found.set(c.id, c);
	const sks = found.get('1SKS')?.offset, skb = found.get('1BKS')?.offset, ska = found.get('1AKS')?.offset;
	if (sks === undefined || skb === undefined) return null;
	const afid = found.get('DIFA');
	return {
		bones: list(view, skb, skb),
		sequences: list(view, sks, sks + 8),
		attachments: ska === undefined ? own.attachments : list(view, ska, ska),
		events: own.events,
		loops: loopDurations(list(view, sks, sks)),
		animFiles: afid && Array.from({ length: Math.floor(afid.size / 8) }, (_, i) => ({
			id: view.getUint16(afid.offset + i * 8, true),
			sub: view.getUint16(afid.offset + i * 8 + 2, true),
			fdid: view.getUint32(afid.offset + i * 8 + 4, true),
		})).filter((a) => a.fdid),
	};
}

/** One of a model's sequences (Stand, Walk): where its bone tracks are, and how long it loops. */
interface StandSequence {
	skeleton: Skeleton;
	/** For a sequence kept in a .anim file of its own: that file, which its keys' offsets point into. */
	anim: DataView | null;
	seq: number;
	duration: number;
	/** Ground speed the sequence was made for (yd/s; 0 for those that don't move). */
	speed: number;
}

/** Where a sequence's record is. */
const sequenceAt = (seqs: List, seq: number) => seqs.base + seqs.offset + seq * SEQUENCE_SIZE;

/**
 * The sequence playing an animation: its index, following aliases to one with keys of its own,
 * and whether those keys are in the model file (rather than a .anim file).
 */
function resolveSequence(seqs: List, animation: number): { seq: number; embedded: boolean } | null {
	const { view } = seqs;
	for (let i = 0; i < seqs.count; i++) {
		const o = sequenceAt(seqs, i);
		if (view.getUint16(o, true) !== animation || view.getUint16(o + 2, true) !== 0) continue;
		// An alias plays another sequence of the model; follow it to one with keys of its own.
		let seq = i;
		for (let hops = 0; hops < 8 && view.getUint32(sequenceAt(seqs, seq) + 12, true) & SEQUENCE_ALIAS; hops++) {
			const next = view.getUint16(sequenceAt(seqs, seq) + 60, true);
			if (next >= seqs.count) break;
			seq = next;
		}
		return { seq, embedded: !!(view.getUint32(sequenceAt(seqs, seq) + 12, true) & SEQUENCE_EMBEDDED) };
	}
	return null;
}

/**
 * Of the animations listed, the sequences whose keys are kept in .anim files (as the HD race
 * models keep their emotes): each sequence's index, AnimationData ID and variation, to find its file by.
 */
export function externalSequences(skeleton: Skeleton, ids: number[]): { seq: number; id: number; sub: number }[] {
	const seqs = skeleton.sequences;
	const out: { seq: number; id: number; sub: number }[] = [];
	for (const id of ids) {
		const found = resolveSequence(seqs, id);
		if (!found || found.embedded || out.some((o) => o.seq === found.seq)) continue;
		const o = sequenceAt(seqs, found.seq);
		out.push({ seq: found.seq, id: seqs.view.getUint16(o, true), sub: seqs.view.getUint16(o + 2, true) });
	}
	return out;
}

/**
 * A .anim file's keys: the whole file, or in the chunked kind its bone keys, AFSB for a .skel
 * skeleton's bones and AFM2 for a model's own.
 */
function animView(file: Uint8Array): DataView {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	// 'AFM2', 'AFSA', 'AFSB'
	if (file.length < 8 || ![0x324d4641, 0x41534641, 0x42534641].includes(view.getUint32(0, true))) return view;
	let fallback: DataView | null = null;
	for (const c of chunks(file)) {
		const keys = new DataView(file.buffer, file.byteOffset + c.offset, Math.min(c.size, file.length - c.offset));
		if (c.id === 'BSFA') return keys;
		if (c.id === '2MFA') fallback = keys;
	}
	return fallback ?? view;
}

function findStand(skeleton: Skeleton, animation = ANIM_STAND, external?: Map<number, Uint8Array>): StandSequence | null {
	if (!skeleton.bones.count) return null;
	const seqs = skeleton.sequences;
	const found = resolveSequence(seqs, animation);
	if (!found) return null;
	const { seq } = found;
	// Keys in a .anim file only when that file was read.
	const file = found.embedded ? null : external?.get(seq);
	if (!found.embedded && !file) return null;
	const s = sequenceAt(seqs, seq);
	return { skeleton, anim: file ? animView(file) : null, seq, duration: seqs.view.getUint32(s + 4, true), speed: seqs.view.getFloat32(s + 8, true) };
}

/**
 * A track's value at time t (ms) in the Stand sequence (or its own global sequence), linearly
 * interpolated between keys. read(view, offset) decodes one value; lerp mixes two. A sequence's
 * keys in a .anim file are read from there; the lists saying where they are stay in the model.
 */
function sampleTrack<T>(s: StandSequence, track: number, t: number, size: number, read: (view: DataView, o: number) => T, lerp: (a: T, b: T, f: number) => T): T | null {
	const { view, base } = s.skeleton.bones;
	const globalSeq = view.getInt16(track + 2, true);
	const index = globalSeq >= 0 ? 0 : s.seq;
	const times = view.getUint32(track + 4, true);
	const values = view.getUint32(track + 12, true);
	if (index >= values || index >= times) return null;
	const timeArr = base + view.getUint32(track + 8, true) + index * 8;
	const valueArr = base + view.getUint32(track + 16, true) + index * 8;
	const count = Math.min(view.getUint32(timeArr, true), view.getUint32(valueArr, true));
	if (!count) return null;
	const external = globalSeq < 0 ? s.anim : null;
	const keys = external ?? view;
	const keysBase = external ? 0 : base;
	const timesAt = keysBase + view.getUint32(timeArr + 4, true);
	const valuesAt = keysBase + view.getUint32(valueArr + 4, true);
	if (external && (timesAt + count * 4 > keys.byteLength || valuesAt + count * size > keys.byteLength)) return null;
	const timeAt = (k: number) => keys.getUint32(timesAt + k * 4, true);
	const valueAt = (k: number) => read(keys, valuesAt + k * size);
	if (count === 1) return valueAt(0);
	if (globalSeq >= 0) {
		const loop = s.skeleton.loops[globalSeq] || timeAt(count - 1) || 1;
		t %= loop;
	}
	if (t <= timeAt(0)) return valueAt(0);
	for (let k = 0; k < count - 1; k++) {
		const t0 = timeAt(k);
		const t1 = timeAt(k + 1);
		if (t < t1) return lerp(valueAt(k), valueAt(k + 1), t1 > t0 ? (t - t0) / (t1 - t0) : 0);
	}
	return valueAt(count - 1);
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
/** Normalised lerp, taking the short way round. */
const nlerp = (a: Quat, b: Quat, f: number): Quat => {
	const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
	const q = a.map((v, i) => v + (b[i] * sign - v) * f) as Quat;
	const len = Math.hypot(...q) || 1;
	return q.map((v) => v / len) as Quat;
};

/** Bone matrices (bind space -> posed model space) at time t (ms) of the Stand sequence. */
function poseAt(s: StandSequence, t: number): Mat4[] {
	const { view, base, offset, count } = s.skeleton.bones;
	const readVec = (v: DataView, o: number): Vec3 => [v.getFloat32(o, true), v.getFloat32(o + 4, true), v.getFloat32(o + 8, true)];
	const readQuat = (v: DataView, o: number): Quat => [0, 2, 4, 6].map((k) => compQuat(v.getInt16(o + k, true))) as Quat;

	const local: Mat4[] = [];
	const parents: number[] = [];
	for (let b = 0; b < count; b++) {
		const o = base + offset + b * BONE_SIZE;
		parents.push(view.getInt16(o + 8, true));
		const pivot = readVec(view, o + 76);
		const tr = sampleTrack(s, o + 16, t, 12, readVec, lerp3);
		const rot = sampleTrack(s, o + 36, t, 8, readQuat, nlerp);
		const sc = sampleTrack(s, o + 56, t, 12, readVec, lerp3);
		const parts: Mat4[] = [translation(...pivot)];
		if (tr) parts.push(translation(...tr));
		if (rot) {
			const len = Math.hypot(...rot) || 1;
			parts.push(fromQuaternion(rot[0] / len, rot[1] / len, rot[2] / len, rot[3] / len));
		}
		if (sc) {
			const m = scaling(1);
			m[0] = sc[0]; m[5] = sc[1]; m[10] = sc[2];
			parts.push(m);
		}
		parts.push(translation(-pivot[0], -pivot[1], -pivot[2]));
		local.push(compose(...parts));
	}

	const global: (Mat4 | null)[] = new Array(count).fill(null);
	const resolve = (b: number, depth = 0): Mat4 => {
		const cached = global[b];
		if (cached) return cached;
		const p = parents[b];
		const m = p >= 0 && p < count && p !== b && depth < 256 ? multiply(resolve(p, depth + 1), local[b]) : local[b];
		global[b] = m;
		return m;
	};
	return local.map((_, b) => resolve(b));
}

/**
 * Bone matrices for the first frame of the model's Stand animation, so models can be drawn
 * standing instead of in their bind pose. Returns null if the model has no embedded Stand.
 */
export function standPose(skeleton: Skeleton, external?: Map<number, Uint8Array>): Mat4[] | null {
	const s = findStand(skeleton, ANIM_STAND, external);
	return s ? poseAt(s, 0) : null;
}

/** Bone matrices sampled over the Stand loop (duration in seconds), or null without a Stand. */
export function standPoses(skeleton: Skeleton): { duration: number; poses: Mat4[][] } | null {
	const s = findStand(skeleton);
	if (!s || s.duration < 50) return null;
	const frames = Math.max(2, Math.min(MAX_FRAMES, Math.round((s.duration / 1000) * SAMPLES_PER_SECOND)));
	return { duration: s.duration / 1000, poses: Array.from({ length: frames }, (_, f) => poseAt(s, (f / frames) * s.duration)) };
}

/** A loop within the sampled frames: its first frame row, frame count and length in seconds. */
export interface AnimationClip {
	row: number;
	frames: number;
	duration: number;
	/** For a list of sequences (sequenceAnimation): its AnimationData ID, and the ground speed it was made for. */
	id?: number;
	speed?: number;
	/** When a foot comes down in the loop (seconds), from the model's footstep events. */
	steps?: number[];
}

const EVENT_SIZE = 36;
/** The M2 event a model marks each footfall with in its walking and running sequences. */
const FOOTSTEP_EVENT = '$FSD';

/**
 * When a foot comes down in a sequence (seconds), from the model's $FSD events: each event has a
 * list of times per sequence. Empty when the model marks none.
 */
function footsteps(s: StandSequence): number[] {
	const { view, base, count, offset } = s.skeleton.events;
	// Those of a sequence in a .anim file are in that file; none of them walk.
	if (s.anim) return [];
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const o = base + offset + i * EVENT_SIZE;
		const id = String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
		if (id !== FOOTSTEP_EVENT) continue;
		// The event's enabled track: interpolation, global sequence, then times per sequence.
		const sequences = view.getUint32(o + 28, true);
		if (s.seq >= sequences) continue;
		const at = base + view.getUint32(o + 32, true) + s.seq * 8;
		const n = view.getUint32(at, true);
		const times = base + view.getUint32(at + 4, true);
		for (let k = 0; k < n; k++) out.push(view.getUint32(times + k * 4, true) / 1000);
	}
	return out.sort((a, b) => a - b);
}

/** Loops sampled for GPU skinning: per frame, per bone, a 3x4 matrix as three rows. */
export interface BoneAnimation {
	bones: number;
	/** Stand, then Walk (the same as Stand when the model has no walk). */
	clips: AnimationClip[];
	/** frames x bones x 12 floats (rows of the 3x4 bone matrix), every clip's frames in turn. */
	data: Float32Array;
}

const SAMPLES_PER_SECOND = 15;
const MAX_FRAMES = 64;

/**
 * Samples the Stand loop (and with walk, the Walk loop) for GPU skinning. Returns null when
 * nothing would move (then the model is drawn in its static first-frame pose instead).
 */
export function standAnimation(skeleton: Skeleton, walk = false, external?: Map<number, Uint8Array>): BoneAnimation | null {
	const stand = findStand(skeleton, ANIM_STAND, external);
	if (!stand || stand.duration < 50) return null;
	const standLoop = sampleLoop(stand);
	const walkSeq = walk ? findStand(skeleton, ANIM_WALK, external) : null;
	const walkLoop = walkSeq && walkSeq.duration >= 50 ? sampleLoop(walkSeq) : null;
	if (!standLoop.moving && !walkLoop) return null;
	const standClip = { row: 0, frames: standLoop.frames, duration: stand.duration / 1000 };
	const bones = skeleton.bones.count;
	if (!walkLoop) return { bones, clips: [standClip, standClip], data: standLoop.data };
	const data = new Float32Array(standLoop.data.length + walkLoop.data.length);
	data.set(standLoop.data);
	data.set(walkLoop.data, standLoop.data.length);
	return { bones, clips: [standClip, { row: standLoop.frames, frames: walkLoop.frames, duration: walkSeq!.duration / 1000, steps: footsteps(walkSeq!) }], data };
}

/** The walking character is seen up close, and its sequences more finely sampled. */
const CHARACTER_SAMPLES_PER_SECOND = 30;
const CHARACTER_MAX_FRAMES = 200;

/**
 * Samples the listed sequences (AnimationData IDs) for GPU skinning, each a clip with its ID and
 * speed, in the order given; those the model lacks are left out. Sequences kept in .anim files
 * are sampled from those given in external (by sequence index; see externalSequences), and left
 * out without. Null when it has none of them.
 */
export function sequenceAnimation(skeleton: Skeleton, ids: number[], external?: Map<number, Uint8Array>): BoneAnimation | null {
	const clips: AnimationClip[] = [];
	const parts: Float32Array[] = [];
	let bones = 0;
	let row = 0;
	for (const id of ids) {
		const s = findStand(skeleton, id, external);
		if (!s || s.duration < 50) continue;
		const loop = sampleLoop(s, CHARACTER_SAMPLES_PER_SECOND, CHARACTER_MAX_FRAMES);
		clips.push({ row, frames: loop.frames, duration: s.duration / 1000, id, speed: s.speed, steps: footsteps(s) });
		parts.push(loop.data);
		bones = skeleton.bones.count;
		row += loop.frames;
	}
	if (!clips.length) return null;
	const data = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		data.set(p, at);
		at += p.length;
	}
	return { bones, clips, data };
}

/** One loop's frames, and whether anything in it moves. */
function sampleLoop(s: StandSequence, rate = SAMPLES_PER_SECOND, maxFrames = MAX_FRAMES): { frames: number; data: Float32Array; moving: boolean } {
	const frames = Math.max(2, Math.min(maxFrames, Math.round((s.duration / 1000) * rate)));
	const boneCount = s.skeleton.bones.count;
	const data = new Float32Array(frames * boneCount * 12);
	let moving = false;
	for (let f = 0; f < frames; f++) {
		const pose = poseAt(s, (f / frames) * s.duration);
		pose.forEach((m, b) => {
			const o = (f * boneCount + b) * 12;
			for (let r = 0; r < 3; r++) {
				data[o + r * 4] = m[r];
				data[o + r * 4 + 1] = m[4 + r];
				data[o + r * 4 + 2] = m[8 + r];
				data[o + r * 4 + 3] = m[12 + r];
			}
		});
		if (f > 0 && !moving) {
			const frame = data.subarray(f * boneCount * 12, (f + 1) * boneCount * 12);
			for (let k = 0; k < frame.length; k++) {
				if (Math.abs(frame[k] - data[k]) > 1e-3) {
					moving = true;
					break;
				}
			}
		}
	}
	return { frames, data, moving };
}
/** Applies bone matrices to one 48-byte M2 vertex, writing position and normal. */
export function skinVertex(view: DataView, o: number, bones: Mat4[], pos: Float32Array, nrm: Float32Array, out: number): void {
	const px = view.getFloat32(o, true), py = view.getFloat32(o + 4, true), pz = view.getFloat32(o + 8, true);
	const nx = view.getFloat32(o + 20, true), ny = view.getFloat32(o + 24, true), nz = view.getFloat32(o + 28, true);
	let x = 0, y = 0, z = 0, a = 0, b = 0, c = 0, total = 0;
	for (let k = 0; k < 4; k++) {
		const w = view.getUint8(o + 12 + k) / 255;
		if (!w) continue;
		const m = bones[view.getUint8(o + 16 + k)];
		if (!m) continue;
		x += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
		y += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
		z += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
		a += w * (m[0] * nx + m[4] * ny + m[8] * nz);
		b += w * (m[1] * nx + m[5] * ny + m[9] * nz);
		c += w * (m[2] * nx + m[6] * ny + m[10] * nz);
		total += w;
	}
	if (total === 0) {
		x = px; y = py; z = pz; a = nx; b = ny; c = nz;
	} else if (total < 0.999) {
		x /= total; y /= total; z /= total;
	}
	const len = Math.hypot(a, b, c) || 1;
	pos[out * 3] = x; pos[out * 3 + 1] = y; pos[out * 3 + 2] = z;
	nrm[out * 3] = a / len; nrm[out * 3 + 1] = b / len; nrm[out * 3 + 2] = c / len;
}

/** M2 attachment point IDs used for gear. */
export const ATTACH_SHIELD = 0;
export const ATTACH_HAND_RIGHT = 1;
export const ATTACH_HAND_LEFT = 2;
export const ATTACH_SHOULDER_RIGHT = 5;
export const ATTACH_SHOULDER_LEFT = 6;
export const ATTACH_HELM = 11;

const ATTACHMENT_SIZE = 40;

/** An attachment point: its bone, and its frame in model space (carried by the bone's pose). */
export interface AttachmentPoint {
	bone: number;
	/** Frame in bind space (for animated models, whose vertices stay in bind space). */
	bind: Mat4;
	/** Frame in the static pose (the bind frame moved by the bone's pose when bones is given). */
	posed: Mat4;
}

/** Attachment points by id. Gear models are drawn in these frames. */
export function attachmentPoints(skeleton: Skeleton, bones: Mat4[] | null): Map<number, AttachmentPoint> {
	const { view, base, count, offset } = skeleton.attachments;
	const points = new Map<number, AttachmentPoint>();
	for (let i = 0; i < count; i++) {
		const o = base + offset + i * ATTACHMENT_SIZE;
		const id = view.getUint32(o, true);
		const bone = view.getUint16(o + 4, true);
		const at = translation(view.getFloat32(o + 8, true), view.getFloat32(o + 12, true), view.getFloat32(o + 16, true));
		const pose = bones?.[bone];
		if (!points.has(id)) points.set(id, { bone, bind: at, posed: pose ? multiply(pose, at) : at });
	}
	return points;
}
