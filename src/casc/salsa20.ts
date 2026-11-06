/**
 * Salsa20/20 with a 128-bit key ("expand 16-byte k"), as BLTE's encrypted chunks use it. Encrypting
 * and decrypting are the same: data XORed with the key stream for the 8-byte nonce.
 */
export function salsa20(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
	if (key.length !== 16 || nonce.length !== 8) throw new Error('Salsa20 takes a 16-byte key and an 8-byte nonce');
	const k = new DataView(key.buffer, key.byteOffset, 16);
	const n = new DataView(nonce.buffer, nonce.byteOffset, 8);
	const k0 = k.getUint32(0, true), k1 = k.getUint32(4, true), k2 = k.getUint32(8, true), k3 = k.getUint32(12, true);
	const state = new Uint32Array([
		0x61707865, k0, k1, k2,
		k3, 0x3120646e, n.getUint32(0, true), n.getUint32(4, true),
		0, 0, 0x79622d36, k0,
		k1, k2, k3, 0x6b206574,
	]);
	const x = new Uint32Array(16);
	const stream = new Uint8Array(64);
	const words = new DataView(stream.buffer);
	const out = new Uint8Array(data.length);
	for (let block = 0, at = 0; at < data.length; block++, at += 64) {
		state[8] = block >>> 0;
		state[9] = Math.floor(block / 0x100000000);
		x.set(state);
		for (let round = 0; round < 10; round++) {
			quarter(x, 0, 4, 8, 12);
			quarter(x, 5, 9, 13, 1);
			quarter(x, 10, 14, 2, 6);
			quarter(x, 15, 3, 7, 11);
			quarter(x, 0, 1, 2, 3);
			quarter(x, 5, 6, 7, 4);
			quarter(x, 10, 11, 8, 9);
			quarter(x, 15, 12, 13, 14);
		}
		for (let i = 0; i < 16; i++) words.setUint32(i * 4, (x[i] + state[i]) >>> 0, true);
		const end = Math.min(64, data.length - at);
		for (let i = 0; i < end; i++) out[at + i] = data[at + i] ^ stream[i];
	}
	return out;
}

function quarter(x: Uint32Array, a: number, b: number, c: number, d: number): void {
	x[b] ^= rotl(x[a] + x[d], 7);
	x[c] ^= rotl(x[b] + x[a], 9);
	x[d] ^= rotl(x[c] + x[b], 13);
	x[a] ^= rotl(x[d] + x[c], 18);
}

function rotl(v: number, n: number): number {
	return (v << n) | (v >>> (32 - n));
}
