import { compose, fromQuaternion, multiply, scaling, translation, type Mat4 } from '../explorer/mat4';

const BONE_SIZE = 88;
const SEQUENCE_SIZE = 64;
/** AnimationData ID of "Stand". */
const ANIM_STAND = 0;

/** M2CompQuat: int16 components mapped to [-1, 1]. */
const compQuat = (v: number) => (v < 0 ? v + 32768 : v - 32767) / 32767;

/**
 * Bone matrices for the first frame of the model's Stand animation, so creatures can be drawn
 * standing instead of in their bind pose. Returns null if the model has no embedded Stand.
 * md20 is the offset of the MD20 header; track offsets are relative to it.
 */
export function standPose(bytes: Uint8Array, md20: number): Mat4[] | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const u32 = (o: number) => view.getUint32(md20 + o, true);
	const seqCount = u32(0x1c);
	const seqOffset = u32(0x20);
	const boneCount = u32(0x2c);
	const boneOffset = u32(0x30);
	if (!boneCount) return null;

	let seq = -1;
	for (let i = 0; i < seqCount; i++) {
		const o = md20 + seqOffset + i * SEQUENCE_SIZE;
		// Flag 0x20: the sequence's keys are in this file rather than a separate .anim.
		if (view.getUint16(o, true) === ANIM_STAND && view.getUint16(o + 2, true) === 0 && view.getUint32(o + 12, true) & 0x20) {
			seq = i;
			break;
		}
	}
	if (seq < 0) return null;

	/** First key of a track for the Stand sequence (or its global sequence), as a byte offset. */
	const firstKey = (track: number): number | null => {
		const globalSeq = view.getInt16(track + 2, true);
		const arrays = view.getUint32(track + 12, true);
		const arraysOffset = view.getUint32(track + 16, true);
		const index = globalSeq >= 0 ? 0 : seq;
		if (index >= arrays) return null;
		const inner = md20 + arraysOffset + index * 8;
		const count = view.getUint32(inner, true);
		return count ? md20 + view.getUint32(inner + 4, true) : null;
	};

	const local: Mat4[] = [];
	const parents: number[] = [];
	for (let b = 0; b < boneCount; b++) {
		const o = md20 + boneOffset + b * BONE_SIZE;
		parents.push(view.getInt16(o + 8, true));
		const f = (at: number) => view.getFloat32(at, true);
		const pivot: [number, number, number] = [f(o + 76), f(o + 80), f(o + 84)];
		const t = firstKey(o + 16);
		const r = firstKey(o + 36);
		const s = firstKey(o + 56);
		const parts: Mat4[] = [translation(...pivot)];
		if (t !== null) parts.push(translation(f(t), f(t + 4), f(t + 8)));
		if (r !== null) {
			const q = [0, 2, 4, 6].map((k) => compQuat(view.getInt16(r + k, true)));
			const len = Math.hypot(...q) || 1;
			parts.push(fromQuaternion(q[0] / len, q[1] / len, q[2] / len, q[3] / len));
		}
		if (s !== null) {
			const m = scaling(1);
			m[0] = f(s); m[5] = f(s + 4); m[10] = f(s + 8);
			parts.push(m);
		}
		parts.push(translation(-pivot[0], -pivot[1], -pivot[2]));
		local.push(compose(...parts));
	}

	const global: (Mat4 | null)[] = new Array(boneCount).fill(null);
	const resolve = (b: number, depth = 0): Mat4 => {
		const cached = global[b];
		if (cached) return cached;
		const p = parents[b];
		const m = p >= 0 && p < boneCount && p !== b && depth < 256 ? multiply(resolve(p, depth + 1), local[b]) : local[b];
		global[b] = m;
		return m;
	};
	return local.map((_, b) => resolve(b));
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
export function attachmentPoints(bytes: Uint8Array, md20: number, bones: Mat4[] | null): Map<number, AttachmentPoint> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(md20 + 0xf0, true);
	const offset = view.getUint32(md20 + 0xf4, true);
	const points = new Map<number, AttachmentPoint>();
	for (let i = 0; i < count; i++) {
		const o = md20 + offset + i * ATTACHMENT_SIZE;
		const id = view.getUint32(o, true);
		const bone = view.getUint16(o + 4, true);
		const at = translation(view.getFloat32(o + 8, true), view.getFloat32(o + 12, true), view.getFloat32(o + 16, true));
		const pose = bones?.[bone];
		if (!points.has(id)) points.set(id, { bone, bind: at, posed: pose ? multiply(pose, at) : at });
	}
	return points;
}
