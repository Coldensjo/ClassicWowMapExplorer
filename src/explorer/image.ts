import type { Image } from '../formats/blp';

/** Box-filter downscale by an integer factor so the result is at most size pixels wide. */
export function downscale(image: Image, size: number): Image {
	const factor = Math.max(1, Math.floor(image.width / size));
	if (factor === 1) return image;
	const width = Math.floor(image.width / factor);
	const height = Math.floor(image.height / factor);
	const rgba = new Uint8Array(width * height * 4);
	const area = factor * factor;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < factor; sy++) {
				let s = ((y * factor + sy) * image.width + x * factor) * 4;
				for (let sx = 0; sx < factor; sx++, s += 4) {
					r += image.rgba[s];
					g += image.rgba[s + 1];
					b += image.rgba[s + 2];
					a += image.rgba[s + 3];
				}
			}
			const o = (y * width + x) * 4;
			rgba[o] = r / area;
			rgba[o + 1] = g / area;
			rgba[o + 2] = b / area;
			rgba[o + 3] = a / area;
		}
	}
	return { width, height, rgba };
}
