// Exercises the reader against a real install and writes preview PNGs to out/.
// Usage: npm run probe -- [wowDir] [product] [tileX] [tileY]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CascStorage } from '../src/casc/storage';
import { CHUNK_SIZE } from '../src/formats/adt';
import { shadeHeights } from '../src/explorer/heightColors';
import { KNOWN_MAPS, MapExplorer } from '../src/explorer/maps';
import { NodeSource } from './nodeSource';

const [wowDir = 'C:/Program Files (x86)/World of Warcraft', product = 'wow_classic_beta', tx = '32', ty = '48'] = process.argv.slice(2);
const OUT = 'out';
mkdirSync(OUT, { recursive: true });

function writePng(name: string, width: number, height: number, rgba: Uint8Array): void {
	const raw = join(OUT, `${name}.rgba`);
	writeFileSync(raw, rgba);
	execFileSync('magick', ['-size', `${width}x${height}`, '-depth', '8', `rgba:${raw}`, join(OUT, `${name}.png`)]);
}

const source = new NodeSource(wowDir);
const storage = await CascStorage.open(source, product);
console.log(storage.stats);
const explorer = new MapExplorer(storage);

for (const map of KNOWN_MAPS) {
	const summary = await explorer.loadMap(map.wdt);
	console.log(`\n${map.name}: ${summary.tileCount} tiles, flags 0x${summary.flags.toString(16)}`);
	console.table(summary.availability);

	// Overview mosaic from 32px minimap mips.
	const xs = summary.tiles.map((t) => t.x);
	const ys = summary.tiles.map((t) => t.y);
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	const cell = 32;
	const w = (x1 - x0 + 1) * cell;
	const h = (y1 - y0 + 1) * cell;
	const mosaic = new Uint8Array(w * h * 4);
	const t = performance.now();
	const thumbs = await explorer.minimapThumbnails(map.wdt, summary.tiles.map((t) => [t.x, t.y]), cell);
	for (const { x, y, image } of thumbs) {
		if (!image) continue;
		for (let row = 0; row < image.height && row < cell; row++) {
			const dst = ((y - y0) * cell + row) * w * 4 + (x - x0) * cell * 4;
			mosaic.set(image.rgba.subarray(row * image.width * 4, row * image.width * 4 + Math.min(cell, image.width) * 4), dst);
		}
	}
	console.log(`overview: ${thumbs.filter((t) => t.image).length} minimaps in ${Math.round(performance.now() - t)} ms`);
	writePng(`overview-${map.directory}`, w, h, mosaic);
}

const tile = await explorer.loadTile(KNOWN_MAPS[0].wdt, Number(tx), Number(ty));
console.log(`\nTile ${tx}_${ty}:`, {
	...tile,
	heightGrid: tile.heightGrid && { size: tile.heightGrid.size, min: tile.heightGrid.min, max: tile.heightGrid.max },
	minimap: tile.minimap && `${tile.minimap.width}x${tile.minimap.height}`,
	mapTexture: tile.mapTexture && `${tile.mapTexture.width}x${tile.mapTexture.height} (source ${tile.mapTexture.sourceSize})`,
});
if (tile.heightGrid) {
	const g = tile.heightGrid;
	writePng('tile-heights', g.size, g.size, shadeHeights(g.heights, g.size, CHUNK_SIZE / 8));
}
if (tile.minimap) writePng('tile-minimap', tile.minimap.width, tile.minimap.height, tile.minimap.rgba);
if (tile.mapTexture) writePng('tile-maptexture', tile.mapTexture.width, tile.mapTexture.height, tile.mapTexture.rgba);
