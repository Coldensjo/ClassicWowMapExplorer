// Writes a grayscale mosaic of a map's WDL heights to out/wdl.png, for checking orientation.
// Usage: npx tsx tools/wdlPreview.ts [wdlFdid]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CascStorage } from '../src/casc/storage';
import { parseWdl } from '../src/formats/wdl';
import { NodeSource } from './nodeSource';

const wdlFdid = Number(process.argv[2] ?? 775970);
const storage = await CascStorage.open(new NodeSource('C:/Program Files (x86)/World of Warcraft'), 'wow_classic_beta');
const tiles = parseWdl(await storage.readFile(wdlFdid));
const xs = tiles.map((t) => t.x);
const ys = tiles.map((t) => t.y);
const x0 = Math.min(...xs);
const y0 = Math.min(...ys);
const w = (Math.max(...xs) - x0 + 1) * 16;
const h = (Math.max(...ys) - y0 + 1) * 16;
console.log(`${tiles.length} tiles, origin ${x0}_${y0}, ${w}x${h}`);

const img = new Uint8Array(w * h);
for (const t of tiles) {
	for (let r = 0; r < 16; r++) {
		for (let c = 0; c < 16; c++) {
			const v = t.outer[r * 17 + c];
			img[((t.y - y0) * 16 + r) * w + (t.x - x0) * 16 + c] = v <= 0 ? 0 : Math.min(255, 40 + v / 3);
		}
	}
}
mkdirSync('out', { recursive: true });
writeFileSync('out/wdl.gray', img);
execFileSync('magick', ['-size', `${w}x${h}`, '-depth', '8', 'gray:out/wdl.gray', 'out/wdl.png']);
