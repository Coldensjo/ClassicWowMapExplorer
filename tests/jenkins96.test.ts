import { expect, test } from 'bun:test';
import { hashPath, hashlittle2 } from '../src/casc/jenkins96';

const bytes = (s: string) => new TextEncoder().encode(s);

// Reference values from Bob Jenkins' lookup3.c self test (driver5), with both seeds 0.
test('hashlittle2 of nothing is the bare seed', () => {
	expect(hashlittle2(new Uint8Array(0))).toEqual({ hi: 0xdeadbeef, lo: 0xdeadbeef });
});

test('hashlittle2 matches the lookup3 reference vector', () => {
	expect(hashlittle2(bytes('Four score and seven years ago'))).toEqual({ hi: 0x17770551, lo: 0xce7226e6 });
});

test('hashlittle2 covers lengths either side of the 12-byte block boundary', () => {
	const seen = new Set<string>();
	for (let n = 0; n <= 40; n++) {
		const h = hashlittle2(new Uint8Array(n).fill(0x61));
		seen.add(`${h.hi}:${h.lo}`);
	}
	expect(seen.size).toBe(41);
});

test('hashPath ignores case and slash direction', () => {
	const ref = hashPath('WORLD\\MAPS\\AZEROTH\\AZEROTH.WDT');
	expect(hashPath('world/maps/azeroth/azeroth.wdt')).toEqual(ref);
	expect(hashPath('World\\Maps\\Azeroth\\Azeroth.wdt')).toEqual(ref);
	expect(hashPath('world/maps/azeroth/kalimdor.wdt')).not.toEqual(ref);
});
