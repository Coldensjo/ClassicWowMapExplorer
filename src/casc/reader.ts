const textDecoder = new TextDecoder();

/** Sequential little-endian reader over a byte array, with big-endian helpers for CASC tables. */
export class Reader {
	readonly bytes: Uint8Array;
	readonly view: DataView;
	pos: number;

	constructor(bytes: Uint8Array, pos = 0) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.pos = pos;
	}

	get length(): number {
		return this.bytes.length;
	}

	get remaining(): number {
		return this.bytes.length - this.pos;
	}

	seek(pos: number): void {
		this.pos = pos;
	}

	skip(n: number): void {
		this.pos += n;
	}

	u8(): number {
		return this.bytes[this.pos++];
	}

	u16(): number {
		const v = this.view.getUint16(this.pos, true);
		this.pos += 2;
		return v;
	}

	u16be(): number {
		const v = this.view.getUint16(this.pos, false);
		this.pos += 2;
		return v;
	}

	u24be(): number {
		const b = this.bytes;
		const v = (b[this.pos] << 16) | (b[this.pos + 1] << 8) | b[this.pos + 2];
		this.pos += 3;
		return v;
	}

	u32(): number {
		const v = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return v;
	}

	u32be(): number {
		const v = this.view.getUint32(this.pos, false);
		this.pos += 4;
		return v;
	}

	i32(): number {
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}

	u40be(): number {
		const hi = this.u8();
		return hi * 0x100000000 + this.u32be();
	}

	f32(): number {
		const v = this.view.getFloat32(this.pos, true);
		this.pos += 4;
		return v;
	}

	/** Returns a view (not a copy) of the next n bytes. */
	take(n: number): Uint8Array {
		const v = this.bytes.subarray(this.pos, this.pos + n);
		this.pos += n;
		return v;
	}

	string(n: number): string {
		return textDecoder.decode(this.take(n));
	}
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
	return s;
}

export function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length >> 1);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
	return out;
}

export function compareBytes(a: Uint8Array, aOff: number, b: Uint8Array, bOff: number, len: number): number {
	for (let i = 0; i < len; i++) {
		const d = a[aOff + i] - b[bOff + i];
		if (d !== 0) return d;
	}
	return 0;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
	if (parts.length === 1) return parts[0];
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

export function decodeText(bytes: Uint8Array): string {
	return textDecoder.decode(bytes);
}
