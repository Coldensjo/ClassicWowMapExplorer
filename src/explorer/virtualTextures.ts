import type { Image } from '../formats/blp';

/**
 * Pictures made in the worker rather than read from the install: the custom NPCs' composited
 * skins (spec 7.9.3). Each is handed out under a file ID from a range no real file uses, so the
 * renderer's texture cache loads it like any other texture (WorldLoader.loadTextures), and kept
 * by the look it was built for, so the same preset composites once. Never stored in a scene.
 */
const VIRTUAL_BASE = 0x7f000000;
/** Composites kept; the oldest unused goes when one more is made. */
const LIMIT = 32;

export class VirtualTextures {
	private readonly byKey = new Map<string, number>();
	private readonly images = new Map<number, Image>();
	private next = VIRTUAL_BASE;

	/** Whether a file ID names a composite rather than a game file. */
	static isVirtual(fdid: number): boolean {
		return fdid >= VIRTUAL_BASE;
	}

	/** The ID for a picture, made under the key once; a key already registered returns its ID. */
	register(key: string, make: () => Image): number {
		const have = this.byKey.get(key);
		if (have !== undefined) {
			// Freshen its place in the least-recently-used order.
			const image = this.images.get(have)!;
			this.images.delete(have);
			this.images.set(have, image);
			return have;
		}
		const fdid = this.next++;
		this.images.set(fdid, make());
		this.byKey.set(key, fdid);
		if (this.images.size > LIMIT) {
			const oldest = this.images.keys().next().value!;
			this.images.delete(oldest);
			for (const [k, v] of this.byKey) if (v === oldest) this.byKey.delete(k);
		}
		return fdid;
	}

	get(fdid: number): Image | null {
		return this.images.get(fdid) ?? null;
	}
}
