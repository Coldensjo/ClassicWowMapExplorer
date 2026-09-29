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

function rgb565(c: number, out: Uint8Array, o: number): void {
	out[o] = ((c >> 11) & 0x1f) * 255 / 31;
	out[o + 1] = ((c >> 5) & 0x3f) * 255 / 63;
	out[o + 2] = (c & 0x1f) * 255 / 31;
	out[o + 3] = 255;
}

function decodeDxt(data: Uint8Array, width: number, height: number, type: 1 | 3 | 5): Image {
	const rgba = new Uint8Array(width * height * 4);
	const blockSize = type === 1 ? 8 : 16;
	const bw = Math.max(1, Math.ceil(width / 4));
	const bh = Math.max(1, Math.ceil(height / 4));
	const colors = new Uint8Array(16);
	const alphas = new Uint8Array(16);

	for (let by = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++) {
			const b = (by * bw + bx) * blockSize;
			if (b + blockSize > data.length) continue;
			const colorOff = type === 1 ? b : b + 8;

			const c0 = data[colorOff] | (data[colorOff + 1] << 8);
			const c1 = data[colorOff + 2] | (data[colorOff + 3] << 8);
			rgb565(c0, colors, 0);
			rgb565(c1, colors, 4);
			if (c0 > c1 || type !== 1) {
				for (let k = 0; k < 3; k++) {
					colors[8 + k] = (2 * colors[k] + colors[4 + k]) / 3;
					colors[12 + k] = (colors[k] + 2 * colors[4 + k]) / 3;
				}
				colors[11] = colors[15] = 255;
			} else {
				for (let k = 0; k < 3; k++) {
					colors[8 + k] = (colors[k] + colors[4 + k]) / 2;
					colors[12 + k] = 0;
				}
				colors[11] = 255;
				colors[15] = 0;
			}

			if (type === 3) {
				for (let i = 0; i < 16; i++) alphas[i] = ((data[b + (i >> 1)] >> ((i & 1) * 4)) & 0xf) * 17;
			} else if (type === 5) {
				const a0 = data[b];
				const a1 = data[b + 1];
				// 16 3-bit indices packed into 6 bytes.
				let bits = 0;
				for (let i = 0; i < 6; i++) bits += data[b + 2 + i] * 2 ** (8 * i);
				for (let i = 0; i < 16; i++) {
					const idx = Math.floor(bits / 2 ** (3 * i)) & 7;
					let a: number;
					if (idx === 0) a = a0;
					else if (idx === 1) a = a1;
					else if (a0 > a1) a = ((8 - idx) * a0 + (idx - 1) * a1) / 7;
					else if (idx === 6) a = 0;
					else if (idx === 7) a = 255;
					else a = ((6 - idx) * a0 + (idx - 1) * a1) / 5;
					alphas[i] = a;
				}
			}

			const indices = data[colorOff + 4] | (data[colorOff + 5] << 8) | (data[colorOff + 6] << 16) | (data[colorOff + 7] << 24);
			for (let py = 0; py < 4; py++) {
				const y = by * 4 + py;
				if (y >= height) break;
				for (let px = 0; px < 4; px++) {
					const x = bx * 4 + px;
					if (x >= width) break;
					const i = py * 4 + px;
					const ci = ((indices >>> (i * 2)) & 3) * 4;
					const o = (y * width + x) * 4;
					rgba[o] = colors[ci];
					rgba[o + 1] = colors[ci + 1];
					rgba[o + 2] = colors[ci + 2];
					rgba[o + 3] = type === 1 ? colors[ci + 3] : alphas[i];
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
