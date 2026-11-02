export interface Image {
	width: number;
	height: number;
	rgba: Uint8Array;
}

const ENCODING_PALETTE = 1;
const ENCODING_DXT = 2;
const ENCODING_ARGB = 3;
const FORMAT_DXT3 = 1;
const FORMAT_DXT5 = 7;
const HEADER_SIZE = 20 + 16 * 4 * 2;

export interface BlpInfo {
	width: number;
	height: number;
	encoding: number;
	alphaDepth: number;
	format: number;
	mipCount: number;
}

export function blpInfo(bytes: Uint8Array): BlpInfo {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, false) !== 0x424c5032) throw new Error('Not a BLP2 texture');
	let mipCount = 0;
	while (mipCount < 16 && view.getUint32(20 + mipCount * 4, true) !== 0) mipCount++;
	return {
		encoding: bytes[8],
		alphaDepth: bytes[9],
		format: bytes[10],
		width: view.getUint32(12, true),
		height: view.getUint32(16, true),
		mipCount,
	};
}

/**
 * Decodes one mip level to RGBA. With maxSize, picks the largest mip no bigger than
 * maxSize on its longest side, so thumbnails skip decoding the full image.
 */
export function decodeBlp(bytes: Uint8Array, maxSize = Infinity): Image {
	const info = blpInfo(bytes);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let level = 0;
	while (level < info.mipCount - 1 && Math.max(info.width, info.height) >> level > maxSize) level++;

	const width = Math.max(1, info.width >> level);
	const height = Math.max(1, info.height >> level);
	const offset = view.getUint32(20 + level * 4, true);
	const size = view.getUint32(84 + level * 4, true);
	const data = bytes.subarray(offset, offset + size);

	switch (info.encoding) {
		case ENCODING_DXT:
			if (info.alphaDepth > 1 && info.format === FORMAT_DXT5) return decodeDxt(data, width, height, 5);
			if (info.alphaDepth > 1 && info.format === FORMAT_DXT3) return decodeDxt(data, width, height, 3);
			return decodeDxt(data, width, height, 1);
		case ENCODING_PALETTE:
			return decodePalette(bytes.subarray(HEADER_SIZE, HEADER_SIZE + 1024), data, width, height, info.alphaDepth);
		case ENCODING_ARGB: {
			const rgba = new Uint8Array(width * height * 4);
			for (let i = 0; i < width * height; i++) {
				rgba[i * 4] = data[i * 4 + 2];
				rgba[i * 4 + 1] = data[i * 4 + 1];
				rgba[i * 4 + 2] = data[i * 4];
				rgba[i * 4 + 3] = data[i * 4 + 3];
			}
			return { width, height, rgba };
		}
		default:
			throw new Error(`Unsupported BLP encoding ${info.encoding}`);
	}
}

function decodePalette(palette: Uint8Array, data: Uint8Array, width: number, height: number, alphaDepth: number): Image {
	const n = width * height;
	const rgba = new Uint8Array(n * 4);
	for (let i = 0; i < n; i++) {
		const p = data[i] * 4;
		rgba[i * 4] = palette[p + 2];
		rgba[i * 4 + 1] = palette[p + 1];
		rgba[i * 4 + 2] = palette[p];
		let alpha = 255;
		if (alphaDepth === 8) alpha = data[n + i];
		else if (alphaDepth === 4) alpha = ((data[n + (i >> 1)] >> ((i & 1) * 4)) & 0xf) * 17;
		else if (alphaDepth === 1) alpha = (data[n + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0;
		rgba[i * 4 + 3] = alpha;
	}
	return { width, height, rgba };
}

/** 5- and 6-bit colour channels widened to 8 bits, as a byte store truncates them. */
const EXPAND5 = Uint8Array.from({ length: 32 }, (_, v) => (v * 255) / 31);
const EXPAND6 = Uint8Array.from({ length: 64 }, (_, v) => (v * 255) / 63);
/** 8-bit channels narrowed to 5 and 6 bits, rounded. */
const NARROW5 = Uint8Array.from({ length: 256 }, (_, v) => Math.round((v * 31) / 255));
const NARROW6 = Uint8Array.from({ length: 256 }, (_, v) => Math.round((v * 63) / 255));
/** Whether a Uint32Array holds a texel's bytes R, G, B, A from its low byte up, so a texel can be written in one store. */
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

/**
 * DXT1, 3 and 5 blocks to RGBA. Each block's four colours (and DXT5's eight alphas) are worked
 * out once, as bytes, then its texels are copied from them.
 */
function decodeDxt(data: Uint8Array, width: number, height: number, type: 1 | 3 | 5): Image {
	const rgba = new Uint8Array(width * height * 4);
	const blockSize = type === 1 ? 8 : 16;
	const bw = Math.max(1, Math.ceil(width / 4));
	const bh = Math.max(1, Math.ceil(height / 4));
	// Four RGBA colours; packed is the same bytes as one 32-bit word each.
	const colors = new Uint8Array(16);
	const packed = new Uint32Array(colors.buffer);
	const alphas = new Uint8Array(16);
	const alphaLevels = new Uint8Array(8);
	const out32 = LITTLE_ENDIAN ? new Uint32Array(rgba.buffer) : null;

	for (let by = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++) {
			const b = (by * bw + bx) * blockSize;
			if (b + blockSize > data.length) continue;
			const colorOff = type === 1 ? b : b + 8;

			const c0 = data[colorOff] | (data[colorOff + 1] << 8);
			const c1 = data[colorOff + 2] | (data[colorOff + 3] << 8);
			const r0 = EXPAND5[c0 >> 11], g0 = EXPAND6[(c0 >> 5) & 0x3f], b0 = EXPAND5[c0 & 0x1f];
			const r1 = EXPAND5[c1 >> 11], g1 = EXPAND6[(c1 >> 5) & 0x3f], b1 = EXPAND5[c1 & 0x1f];
			colors[0] = r0;
			colors[1] = g0;
			colors[2] = b0;
			colors[3] = 255;
			colors[4] = r1;
			colors[5] = g1;
			colors[6] = b1;
			colors[7] = 255;
			if (c0 > c1 || type !== 1) {
				colors[8] = (2 * r0 + r1) / 3;
				colors[9] = (2 * g0 + g1) / 3;
				colors[10] = (2 * b0 + b1) / 3;
				colors[12] = (r0 + 2 * r1) / 3;
				colors[13] = (g0 + 2 * g1) / 3;
				colors[14] = (b0 + 2 * b1) / 3;
				colors[11] = colors[15] = 255;
			} else {
				colors[8] = (r0 + r1) / 2;
				colors[9] = (g0 + g1) / 2;
				colors[10] = (b0 + b1) / 2;
				colors[12] = colors[13] = colors[14] = 0;
				colors[11] = 255;
				colors[15] = 0;
			}

			if (type === 3) {
				for (let i = 0; i < 16; i++) alphas[i] = ((data[b + (i >> 1)] >> ((i & 1) * 4)) & 0xf) * 17;
			} else if (type === 5) {
				const a0 = data[b];
				const a1 = data[b + 1];
				alphaLevels[0] = a0;
				alphaLevels[1] = a1;
				if (a0 > a1) {
					for (let idx = 2; idx < 8; idx++) alphaLevels[idx] = ((8 - idx) * a0 + (idx - 1) * a1) / 7;
				} else {
					for (let idx = 2; idx < 6; idx++) alphaLevels[idx] = ((6 - idx) * a0 + (idx - 1) * a1) / 5;
					alphaLevels[6] = 0;
					alphaLevels[7] = 255;
				}
				// 16 3-bit indices packed into 6 bytes: the first eight in the low three, the rest in the high three.
				const low = data[b + 2] | (data[b + 3] << 8) | (data[b + 4] << 16);
				const high = data[b + 5] | (data[b + 6] << 8) | (data[b + 7] << 16);
				for (let i = 0; i < 8; i++) {
					alphas[i] = alphaLevels[(low >> (3 * i)) & 7];
					alphas[i + 8] = alphaLevels[(high >> (3 * i)) & 7];
				}
			}

			const indices = data[colorOff + 4] | (data[colorOff + 5] << 8) | (data[colorOff + 6] << 16) | (data[colorOff + 7] << 24);
			const rows = Math.min(4, height - by * 4);
			const cols = Math.min(4, width - bx * 4);
			for (let py = 0; py < rows; py++) {
				let t = (by * 4 + py) * width + bx * 4;
				for (let px = 0; px < cols; px++, t++) {
					const i = py * 4 + px;
					const ci = (indices >>> (i * 2)) & 3;
					if (out32) {
						out32[t] = type === 1 ? packed[ci] : (packed[ci] & 0xffffff) | (alphas[i] << 24);
					} else {
						const o = t * 4;
						rgba[o] = colors[ci * 4];
						rgba[o + 1] = colors[ci * 4 + 1];
						rgba[o + 2] = colors[ci * 4 + 2];
						rgba[o + 3] = type === 1 ? colors[ci * 4 + 3] : alphas[i];
					}
				}
			}
		}
	}
	return { width, height, rgba };
}

export type TextureFormat = 'dxt1' | 'dxt3' | 'dxt5' | 'rgba';

export interface TextureData {
	format: TextureFormat;
	width: number;
	height: number;
	/** Largest first. Compressed formats carry the file's own chain down to 1x1. */
	mips: { width: number; height: number; data: Uint8Array }[];
}

/**
 * Texture data ready for GPU upload. DXT textures keep their block data and mip chain
 * (starting at the largest level no bigger than maxSize) unless compressed is false,
 * in which case one level is decoded to RGBA.
 */
export function blpTexture(bytes: Uint8Array, maxSize = Infinity, compressed = true): TextureData {
	const info = blpInfo(bytes);
	if (!compressed || info.encoding !== ENCODING_DXT) {
		const image = decodeBlp(bytes, maxSize);
		return { format: 'rgba', width: image.width, height: image.height, mips: [{ width: image.width, height: image.height, data: image.rgba }] };
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let level = 0;
	while (level < info.mipCount - 1 && Math.max(info.width, info.height) >> level > maxSize) level++;
	const format: TextureFormat = info.alphaDepth > 1 && info.format === FORMAT_DXT5 ? 'dxt5'
		: info.alphaDepth > 1 && info.format === FORMAT_DXT3 ? 'dxt3' : 'dxt1';
	const blockBytes = format === 'dxt1' ? 8 : 16;
	const mips: TextureData['mips'] = [];
	for (let l = level; l < info.mipCount; l++) {
		const offset = view.getUint32(20 + l * 4, true);
		const size = view.getUint32(84 + l * 4, true);
		const width = Math.max(1, info.width >> l);
		const height = Math.max(1, info.height >> l);
		const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes;
		// slice() so each level owns its buffer and can be transferred. Tiny mips of non-square
		// textures are sometimes stored a block short; repeat the data to the size WebGL expects.
		let data = bytes.slice(offset, offset + Math.min(size, expected));
		if (data.length < expected && data.length > 0) {
			const padded = new Uint8Array(expected);
			for (let o = 0; o < expected; o += data.length) padded.set(data.subarray(0, Math.min(data.length, expected - o)), o);
			data = padded;
		}
		mips.push({ width, height, data });
	}
	return { format, width: mips[0].width, height: mips[0].height, mips };
}

/**
 * A picture as a square texture of the given size with a full mip chain down to 1x1, each level
 * a box-filtered half of the one before; DXT1 when compressed (opaque: colour only), else RGBA.
 * For pictures stored without mips (Classic's minimaps), which shimmer when drawn small.
 */
export function mipmapped(image: Image, size: number, compressed: boolean): TextureData {
	let level = resize(image, size);
	const mips: TextureData['mips'] = [];
	for (;;) {
		mips.push({ width: level.width, height: level.height, data: compressed ? encodeDxt1(level) : level.rgba });
		if (level.width === 1 && level.height === 1) break;
		level = resize(level, Math.max(1, level.width >> 1));
	}
	return { format: compressed ? 'dxt1' : 'rgba', width: size, height: size, mips };
}

/** Scaled to size x size, each texel the average of the source texels it covers. */
function resize(image: Image, size: number): Image {
	if (image.width === size * 2 && image.height === size * 2) return halve(image, size);
	const rgba = new Uint8Array(size * size * 4);
	const src = image.rgba;
	const sx = image.width / size;
	const sy = image.height / size;
	// The source columns each texel covers, the same for every row.
	const xs0 = new Int32Array(size);
	const xs1 = new Int32Array(size);
	for (let x = 0; x < size; x++) {
		xs0[x] = Math.floor(x * sx);
		xs1[x] = Math.max(xs0[x] + 1, Math.floor((x + 1) * sx));
	}
	for (let y = 0; y < size; y++) {
		const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
		for (let x = 0; x < size; x++) {
			const x0 = xs0[x], x1 = xs1[x];
			let r = 0, g = 0, b = 0, a = 0;
			for (let v = y0; v < y1; v++) {
				for (let i = (v * image.width + x0) * 4, end = (v * image.width + x1) * 4; i < end; i += 4) {
					r += src[i];
					g += src[i + 1];
					b += src[i + 2];
					a += src[i + 3];
				}
			}
			const n = (y1 - y0) * (x1 - x0);
			const o = (y * size + x) * 4;
			rgba[o] = Math.round(r / n);
			rgba[o + 1] = Math.round(g / n);
			rgba[o + 2] = Math.round(b / n);
			rgba[o + 3] = Math.round(a / n);
		}
	}
	return { width: size, height: size, rgba };
}

/** resize to exactly half (each mip level, and Classic's 256 px minimaps to 128): 2x2 averages, rounded half up as Math.round does. */
function halve(image: Image, size: number): Image {
	const rgba = new Uint8Array(size * size * 4);
	const src = image.rgba;
	const stride = image.width * 4;
	let o = 0;
	for (let y = 0; y < size; y++) {
		let top = y * 2 * stride;
		for (let x = 0; x < size; x++, top += 8, o += 4) {
			const bottom = top + stride;
			rgba[o] = (src[top] + src[top + 4] + src[bottom] + src[bottom + 4] + 2) >> 2;
			rgba[o + 1] = (src[top + 1] + src[top + 5] + src[bottom + 1] + src[bottom + 5] + 2) >> 2;
			rgba[o + 2] = (src[top + 2] + src[top + 6] + src[bottom + 2] + src[bottom + 6] + 2) >> 2;
			rgba[o + 3] = (src[top + 3] + src[top + 7] + src[bottom + 3] + src[bottom + 7] + 2) >> 2;
		}
	}
	return { width: size, height: size, rgba };
}

/**
 * DXT1 blocks for an opaque picture: each 4x4 block's two end colours are the corners of its
 * colours' box, each texel the nearest of the four colours between them.
 */
function encodeDxt1(image: Image): Uint8Array {
	const { width, height, rgba } = image;
	const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
	const out = new Uint8Array(bw * bh * 8);
	// Where each of a block's 16 texels is in rgba.
	const at = new Int32Array(16);
	for (let by = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++) {
			if (bx * 4 + 3 < width && by * 4 + 3 < height) {
				const first = (by * 4 * width + bx * 4) * 4;
				for (let i = 0; i < 16; i++) at[i] = first + ((i >> 2) * width + (i & 3)) * 4;
			} else {
				// A level smaller than a block repeats its edge.
				for (let i = 0; i < 16; i++) at[i] = (Math.min(by * 4 + (i >> 2), height - 1) * width + Math.min(bx * 4 + (i & 3), width - 1)) * 4;
			}
			let minR = 255, minG = 255, minB = 255, maxR = 0, maxG = 0, maxB = 0;
			for (let i = 0; i < 16; i++) {
				const p = at[i];
				const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
				if (r < minR) minR = r;
				if (g < minG) minG = g;
				if (b < minB) minB = b;
				if (r > maxR) maxR = r;
				if (g > maxG) maxG = g;
				if (b > maxB) maxB = b;
			}
			const high = to565(maxR, maxG, maxB), low = to565(minR, minG, minB);
			const c0 = high < low ? low : high, c1 = high < low ? high : low;
			const o = (by * bw + bx) * 8;
			out[o] = c0;
			out[o + 1] = c0 >> 8;
			out[o + 2] = c1;
			out[o + 3] = c1 >> 8;
			// Equal ends would mean the three-colour mode; every texel is that colour anyway.
			if (c0 === c1) continue;
			// The four colours, as decoders widen and blend them (a byte store truncates).
			const r0 = EXPAND5[c0 >> 11], g0 = EXPAND6[(c0 >> 5) & 0x3f], b0 = EXPAND5[c0 & 0x1f];
			const r1 = EXPAND5[c1 >> 11], g1 = EXPAND6[(c1 >> 5) & 0x3f], b1 = EXPAND5[c1 & 0x1f];
			const r2 = ((2 * r0 + r1) / 3) | 0, g2 = ((2 * g0 + g1) / 3) | 0, b2 = ((2 * b0 + b1) / 3) | 0;
			const r3 = ((r0 + 2 * r1) / 3) | 0, g3 = ((g0 + 2 * g1) / 3) | 0, b3 = ((b0 + 2 * b1) / 3) | 0;
			let indices = 0;
			for (let i = 0; i < 16; i++) {
				const p = at[i];
				const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
				// The nearest colour, the first of any that are as near.
				let best = 0;
				let bestDistance = (r - r0) * (r - r0) + (g - g0) * (g - g0) + (b - b0) * (b - b0);
				const d1 = (r - r1) * (r - r1) + (g - g1) * (g - g1) + (b - b1) * (b - b1);
				if (d1 < bestDistance) {
					best = 1;
					bestDistance = d1;
				}
				const d2 = (r - r2) * (r - r2) + (g - g2) * (g - g2) + (b - b2) * (b - b2);
				if (d2 < bestDistance) {
					best = 2;
					bestDistance = d2;
				}
				const d3 = (r - r3) * (r - r3) + (g - g3) * (g - g3) + (b - b3) * (b - b3);
				if (d3 < bestDistance) best = 3;
				indices |= best << (i * 2);
			}
			out[o + 4] = indices;
			out[o + 5] = indices >> 8;
			out[o + 6] = indices >> 16;
			out[o + 7] = indices >>> 24;
		}
	}
	return out;
}

function to565(r: number, g: number, b: number): number {
	return (NARROW5[r] << 11) | (NARROW6[g] << 5) | NARROW5[b];
}
