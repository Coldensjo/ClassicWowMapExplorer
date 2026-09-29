// Hypsometric ramp: stops are [height in yards, r, g, b].
const STOPS: [number, number, number, number][] = [
	[-200, 20, 40, 90],
	[0, 60, 110, 160],
	[1, 70, 110, 60],
	[80, 120, 150, 80],
	[200, 170, 160, 110],
	[400, 140, 110, 90],
	[700, 230, 230, 235],
];

/** Colours a height grid with a fixed ramp plus simple hillshading, returning RGBA. */
export function shadeHeights(heights: Float32Array, size: number, cellSize: number): Uint8Array {
	const rgba = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const h = heights[i];
			let s = 0;
			while (s < STOPS.length - 2 && h > STOPS[s + 1][0]) s++;
			const [h0, r0, g0, b0] = STOPS[s];
			const [h1, r1, g1, b1] = STOPS[s + 1];
			const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));

			// Light from the north-west.
			const dx = heights[y * size + Math.min(size - 1, x + 1)] - heights[y * size + Math.max(0, x - 1)];
			const dy = heights[Math.min(size - 1, y + 1) * size + x] - heights[Math.max(0, y - 1) * size + x];
			const shade = Math.min(1.3, Math.max(0.45, 1 - (dx + dy) / (cellSize * 4)));

			rgba[i * 4] = Math.min(255, (r0 + (r1 - r0) * t) * shade);
			rgba[i * 4 + 1] = Math.min(255, (g0 + (g1 - g0) * t) * shade);
			rgba[i * 4 + 2] = Math.min(255, (b0 + (b1 - b0) * t) * shade);
			rgba[i * 4 + 3] = 255;
		}
	}
	return rgba;
}
