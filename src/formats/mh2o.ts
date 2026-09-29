export interface LiquidInstance {
	/** MCNK index, y * 16 + x. */
	chunk: number;
	/** LiquidType.db2 ID. */
	type: number;
	minHeight: number;
	maxHeight: number;
	/** Covered cell rectangle within the chunk's 8x8 grid. */
	x: number;
	y: number;
	width: number;
	height: number;
	/** Per-cell flag (width x height), or null when every cell has liquid. */
	exists: Uint8Array | null;
	/** (width+1) x (height+1) surface heights, or null for a flat surface at minHeight. */
	heights: Float32Array | null;
}

export type LiquidKind = 'water' | 'ocean' | 'magma' | 'slime';

/** LiquidType IDs 1-20 cycle water, ocean, magma, slime (plain, slow, fast, WMO, ...). */
export function liquidKind(type: number): LiquidKind {
	if (type < 1 || type > 20) return 'water';
	return (['water', 'ocean', 'magma', 'slime'] as const)[(type - 1) % 4];
}

/** Parses the MH2O chunk (liquids for all 256 map chunks); offsets are relative to its data. */
export function parseMh2o(bytes: Uint8Array, offset: number): LiquidInstance[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const liquids: LiquidInstance[] = [];
	for (let chunk = 0; chunk < 256; chunk++) {
		const header = offset + chunk * 12;
		const instancesOffset = view.getUint32(header, true);
		const layerCount = view.getUint32(header + 4, true);
		if (!instancesOffset || !layerCount) continue;
		for (let l = 0; l < layerCount; l++) {
			const o = offset + instancesOffset + l * 24;
			const type = view.getUint16(o, true);
			const lvfOrObject = view.getUint16(o + 2, true);
			const minHeight = view.getFloat32(o + 4, true);
			const maxHeight = view.getFloat32(o + 8, true);
			const x = bytes[o + 12];
			const y = bytes[o + 13];
			const width = bytes[o + 14];
			const height = bytes[o + 15];
			const existsOffset = view.getUint32(o + 16, true);
			const vertexOffset = view.getUint32(o + 20, true);

			let exists: Uint8Array | null = null;
			if (existsOffset) {
				exists = new Uint8Array(width * height);
				for (let i = 0; i < exists.length; i++) exists[i] = (bytes[offset + existsOffset + (i >> 3)] >> (i & 7)) & 1;
			}

			// Vertex formats 0, 1 and 3 start with heights; 2 is depth only. Values of 42 and up
			// name a LiquidObject instead, whose format we can't look up, so infer from the range.
			const lvf = lvfOrObject < 42 ? lvfOrObject : minHeight !== maxHeight ? 0 : 2;
			let heights: Float32Array | null = null;
			if (vertexOffset && lvf !== 2) {
				const count = (width + 1) * (height + 1);
				heights = new Float32Array(count);
				for (let i = 0; i < count; i++) heights[i] = view.getFloat32(offset + vertexOffset + i * 4, true);
			}
			liquids.push({ chunk, type, minHeight, maxHeight, x, y, width, height, exists, heights });
		}
	}
	return liquids;
}
