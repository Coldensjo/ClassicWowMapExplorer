/**
 * Bob Jenkins' lookup3 hashlittle2, as used by the root file to hash file paths.
 * Paths are normalised to upper case with backslashes before hashing.
 */
export function hashPath(path: string): { hi: number; lo: number } {
	return hashlittle2(new TextEncoder().encode(path.toUpperCase().replace(/\//g, '\\')));
}

export function hashlittle2(k: Uint8Array): { hi: number; lo: number } {
	let length = k.length;
	let a = (0xdeadbeef + length) | 0;
	let b = a;
	let c = a;
	let o = 0;

	const rot = (x: number, n: number) => (x << n) | (x >>> (32 - n));
	const word = (i: number) => k[i] | (k[i + 1] << 8) | (k[i + 2] << 16) | (k[i + 3] << 24);

	while (length > 12) {
		a = (a + word(o)) | 0;
		b = (b + word(o + 4)) | 0;
		c = (c + word(o + 8)) | 0;
		a = (a - c) | 0; a ^= rot(c, 4); c = (c + b) | 0;
		b = (b - a) | 0; b ^= rot(a, 6); a = (a + c) | 0;
		c = (c - b) | 0; c ^= rot(b, 8); b = (b + a) | 0;
		a = (a - c) | 0; a ^= rot(c, 16); c = (c + b) | 0;
		b = (b - a) | 0; b ^= rot(a, 19); a = (a + c) | 0;
		c = (c - b) | 0; c ^= rot(b, 4); b = (b + a) | 0;
		length -= 12;
		o += 12;
	}

	if (length === 0) return { hi: c >>> 0, lo: b >>> 0 };

	// Tail: up to 12 remaining bytes, zero-padded.
	const tail = new Uint8Array(12);
	tail.set(k.subarray(o, o + length));
	const t = (i: number) => tail[i] | (tail[i + 1] << 8) | (tail[i + 2] << 16) | (tail[i + 3] << 24);
	a = (a + t(0)) | 0;
	b = (b + t(4)) | 0;
	c = (c + t(8)) | 0;

	c ^= b; c = (c - rot(b, 14)) | 0;
	a ^= c; a = (a - rot(c, 11)) | 0;
	b ^= a; b = (b - rot(a, 25)) | 0;
	c ^= b; c = (c - rot(b, 16)) | 0;
	a ^= c; a = (a - rot(c, 4)) | 0;
	b ^= a; b = (b - rot(a, 14)) | 0;
	c ^= b; c = (c - rot(b, 24)) | 0;
	return { hi: c >>> 0, lo: b >>> 0 };
}
