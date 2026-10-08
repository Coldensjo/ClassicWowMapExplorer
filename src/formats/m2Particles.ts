import { multiply, translation, type Mat4 } from '../explorer/mat4';
import { m2Skeleton, standPose, standPoses, type Skeleton } from './m2Pose';

const EMITTER_SIZE = 0x1ec;
const TRACK_SIZE = 20;

/** Emitter flags. */
const RANDOM_TEXTURE_CELL = 0x10000;
const MULTI_TEXTURE = 0x10000000;

export const EMITTER_PLANE = 1;
export const EMITTER_SPHERE = 2;

/** A value over a particle's life: keys at 0-1 of the lifespan, each `stride` numbers wide. */
export interface LifeKeys {
	times: number[];
	values: number[];
}

/** One M2 particle emitter with its animated values reduced to steady ones (the Stand loop's average). */
export interface ParticleEmitter {
	/** Emitter frame in model space: the bone's resting pose, moved to the emitter's position. */
	frame: Mat4;
	/**
	 * The frame over the Stand loop, when the emitter's bone moves (instance portals spin theirs
	 * to sweep a ring of particles into a swirl); frames[0] is frame.
	 */
	motion?: { duration: number; frames: Mat4[] };
	texture: number;
	blend: number;
	type: number;
	flags: number;
	rows: number;
	cols: number;
	speed: number;
	speedVary: number;
	verticalRange: number;
	horizontalRange: number;
	gravity: number;
	life: number;
	lifeVary: number;
	/** Particles per second. */
	rate: number;
	areaLength: number;
	areaWidth: number;
	zSource: number;
	drag: number;
	spin: number;
	spinVary: number;
	baseSpin: number;
	baseSpinVary: number;
	scaleVary: number;
	/** RGB 0-1. */
	color: LifeKeys;
	alpha: LifeKeys;
	/** Half the particle's width, in yards. */
	scale: LifeKeys;
	/** Flipbook cell over life; empty for a fixed (or random) cell. */
	cell: LifeKeys;
	randomCell: boolean;
}

/**
 * Reads a model's particle emitters (fire, smoke, sparks). Track values come from the Stand
 * sequence or a global loop; animated ones are averaged, which keeps flickers as a steady rate.
 */
export function parseParticleEmitters(bytes: Uint8Array, md20: number, textureFdids: number[], skeleton: Skeleton = m2Skeleton(bytes, md20)): ParticleEmitter[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u32 = (o: number) => view.getUint32(md20 + o, true);
	const count = u32(0x128);
	if (!count) return [];
	const offset = u32(0x12c);
	const loop = standPoses(skeleton);
	const bones = loop?.poses[0] ?? standPose(skeleton);

	// The Stand sequence's index, for picking each track's keys.
	let stand = 0;
	const seqCount = u32(0x1c);
	for (let i = 0; i < seqCount; i++) {
		const o = md20 + u32(0x20) + i * 64;
		if (view.getUint16(o, true) === 0 && view.getUint16(o + 2, true) === 0) {
			stand = i;
			break;
		}
	}

	/** Average of a track's keys (in its Stand or global keys), or fallback when it has none. */
	const trackAverage = (track: number, size: number, read: (o: number) => number, fallback: number): number => {
		const globalSeq = view.getInt16(track + 2, true);
		const index = globalSeq >= 0 ? 0 : stand;
		const lists = view.getUint32(track + 12, true);
		if (index >= lists) return fallback;
		const list = md20 + view.getUint32(track + 16, true) + index * 8;
		const n = view.getUint32(list, true);
		if (!n) return fallback;
		const base = md20 + view.getUint32(list + 4, true);
		let sum = 0;
		for (let k = 0; k < n; k++) sum += read(base + k * size);
		return sum / n;
	};
	const f32 = (o: number) => view.getFloat32(o, true);

	/** An FBlock: uint16 times (0-32767 over the life) and values of `stride` components. */
	const lifeKeys = (o: number, stride: number, size: number, read: (o: number) => number, divide = 1): LifeKeys => {
		const tc = view.getUint32(o, true), to = view.getUint32(o + 4, true);
		const vc = view.getUint32(o + 8, true), vo = view.getUint32(o + 12, true);
		const n = Math.min(vc, 16);
		const times: number[] = [];
		const values: number[] = [];
		for (let k = 0; k < n; k++) {
			times.push(tc === vc ? view.getInt16(md20 + to + k * 2, true) / 32767 : n > 1 ? k / (n - 1) : 0);
			for (let c = 0; c < stride; c++) values.push(read(md20 + vo + k * size + c * (size / stride)) / divide);
		}
		return { times, values };
	};

	const out: ParticleEmitter[] = [];
	for (let i = 0; i < count; i++) {
		const o = md20 + offset + i * EMITTER_SIZE;
		const flags = view.getUint32(o + 4, true);
		// Emitters switched off in Stand never show.
		if (trackAverage(o + 0x1c8, 1, (a) => view.getUint8(a), 1) < 0.5) continue;
		const rawTexture = view.getUint16(o + 0x16, true);
		const texture = textureFdids[flags & MULTI_TEXTURE ? rawTexture & 0x1f : rawTexture] ?? 0;
		const rate = trackAverage(o + 0xb0, 4, f32, 0);
		if (!texture || rate <= 0) continue;
		const bone = view.getUint16(o + 0x14, true);
		const position = translation(f32(o + 8), f32(o + 12), f32(o + 16));
		const pose = bones?.[bone];
		const frames = loop && pose ? loop.poses.map((p) => multiply(p[bone], position)) : [];
		const moves = frames.some((m) => m.some((v, k) => Math.abs(v - frames[0][k]) > 1e-3));
		const track = (at: number, fallback = 0) => trackAverage(o + 0x34 + at * TRACK_SIZE, 4, f32, fallback);
		out.push({
			frame: pose ? multiply(pose, position) : position,
			motion: moves ? { duration: loop!.duration, frames } : undefined,
			texture,
			blend: view.getUint8(o + 0x28),
			type: view.getUint8(o + 0x29),
			flags,
			rows: Math.max(1, view.getUint16(o + 0x30, true)),
			cols: Math.max(1, view.getUint16(o + 0x32, true)),
			speed: track(0),
			speedVary: track(1),
			verticalRange: track(2),
			horizontalRange: track(3),
			gravity: track(4),
			life: Math.max(0.05, track(5, 1)),
			lifeVary: f32(o + 0xac),
			rate,
			areaLength: trackAverage(o + 0xc8, 4, f32, 0),
			areaWidth: trackAverage(o + 0xdc, 4, f32, 0),
			zSource: trackAverage(o + 0xf0, 4, f32, 0),
			color: lifeKeys(o + 0x104, 3, 12, f32, 255),
			alpha: lifeKeys(o + 0x114, 1, 2, (a) => view.getInt16(a, true), 32767),
			scale: lifeKeys(o + 0x124, 1, 8, f32),
			scaleVary: f32(o + 0x134),
			cell: lifeKeys(o + 0x13c, 1, 2, (a) => view.getUint16(a, true)),
			randomCell: !!(flags & RANDOM_TEXTURE_CELL),
			drag: f32(o + 0x174),
			baseSpin: f32(o + 0x178),
			baseSpinVary: f32(o + 0x17c),
			spin: f32(o + 0x180),
			spinVary: f32(o + 0x184),
		});
	}
	return out;
}
