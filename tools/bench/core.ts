// The storage worker's work against a real install: opening the storage, what the viewer asks
// for while the world loads, and what it streams in while flying over a busy area. Shared by
// the Node runner (node.ts) and the one that runs it in a Chrome worker (serve.ts, worker.ts).
import type { FileSource } from '../../src/casc/source';
import { CascStorage } from '../../src/casc/storage';
import { MapExplorer, type KnownMap } from '../../src/explorer/maps';
import { WorldLoader } from '../../src/explorer/world';
import type { ObjectKind } from '../../src/explorer/objects';

export interface BenchOptions {
	source: FileSource;
	product: string;
	runs: number;
	/** Phases to time (or digest); all when null. Earlier phases always run, since later ones need what they find. */
	only: Set<string> | null;
	/** Hash every phase's results instead of timing them, to check a change leaves them as they were. */
	digest: boolean;
	log: (line: string) => void;
}

export interface BenchResult {
	/** Per phase, the milliseconds of each run. */
	times: Record<string, number[]>;
	/** Per phase, a hash of its results (digest mode). */
	digests: Record<string, string>;
}

function block(wdt: number, x0: number, y0: number, n: number) {
	const out: { wdt: number; x: number; y: number }[] = [];
	for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) out.push({ wdt, x, y });
	return out;
}

/** A continent of the install by its Map.db2 ID (0 the Eastern Kingdoms, 1 Kalimdor). */
const continent = (c: { continents: KnownMap[] }, mapId: number) => c.continents.find((m) => m.mapId === mapId)!;

/** Elwynn Forest, Stormwind and Goldshire; Durotar and Orgrimmar. Busy, like most flying is. */
const near = (c: { continents: KnownMap[] }) => [...block(continent(c, 0).wdt, 30, 46, 5), ...block(continent(c, 1).wdt, 39, 28, 3)];

interface Context {
	world: WorldLoader;
	explorer: MapExplorer;
	/** The continents of the install, drawn as one world. */
	continents: KnownMap[];
	/** Carried between phases: what the near tiles and their objects need. */
	textures: number[];
	models: { fdid: number; kind: ObjectKind; variant?: string }[];
}

type Phase = { name: string; run: (c: Context) => Promise<unknown> };

export const PHASES: Phase[] = [
	{
		name: 'startup',
		// What Viewer.load asks for before the first view, in its order.
		run: async ({ world, continents }) => {
			const far = [];
			for (const map of continents) far.push(await world.loadFarTiles(map.wdt, map.wdl));
			const maps = await world.listMaps();
			const instances = await Promise.all(maps.filter((m) => m.id > 1).map((m) => world.loadInstance(m.id)));
			const [lighting, areas, looks] = await Promise.all([world.loadLighting(maps.map((m) => m.id)), world.loadAreas(), world.loadLiquidLooks()]);
			return { far, maps, instances, lighting, areas, looks };
		},
	},
	{
		name: 'farTextures',
		// Every continent tile's low-detail texture, in batches of 32 as TerrainManager asks.
		run: async ({ world, explorer, continents }) => {
			const out = [];
			for (const map of continents) {
				const tiles = (await explorer.loadMap(map.wdt)).tiles.map((t) => [t.x, t.y] as [number, number]);
				for (let i = 0; i < tiles.length; i += 32) out.push(await world.loadTileTextures(map.wdt, tiles.slice(i, i + 32), 128, true));
			}
			return out;
		},
	},
	{
		name: 'minimap',
		// The minimap's 32 px thumbnails over a block of tiles round the camera.
		run: async (c) => {
			const azeroth = continent(c, 0);
			const coords = block(azeroth.wdt, 26, 42, 13).map((t) => [t.x, t.y] as [number, number]);
			const out = [];
			for (let i = 0; i < coords.length; i += 32) out.push(await c.explorer.minimapThumbnails(azeroth.wdt, coords.slice(i, i + 32), 32));
			return out;
		},
	},
	{
		name: 'nearTiles',
		// Full-detail ground, three tiles in flight at a time as TerrainManager streams them.
		run: async (c) => {
			const out: Awaited<ReturnType<WorldLoader['loadNearTile']>>[] = [];
			const queue = near(c);
			await Promise.all(Array.from({ length: 3 }, async () => {
				for (let t = queue.shift(); t; t = queue.shift()) out.push(await c.world.loadNearTile(t.wdt, t.x, t.y, true));
			}));
			out.sort((a, b) => a.x - b.x || a.y - b.y);
			c.textures = [...new Set(out.flatMap((t) => t.terrain?.textures ?? []))].sort((a, b) => a - b);
			return out;
		},
	},
	{
		name: 'terrainTextures',
		run: async ({ world, textures }) => {
			const out = [];
			for (let i = 0; i < textures.length; i += 16) out.push(await world.loadTextures(textures.slice(i, i + 16), true));
			return out;
		},
	},
	{
		name: 'tileObjects',
		// Four tiles at a time, as the storage client throttles them.
		run: async (c) => {
			const out: { key: string; placements: Awaited<ReturnType<WorldLoader['loadTileObjects']>> }[] = [];
			const queue = near(c);
			await Promise.all(Array.from({ length: 4 }, async () => {
				for (let t = queue.shift(); t; t = queue.shift()) out.push({ key: `${t.wdt}_${t.x}_${t.y}`, placements: await c.world.loadTileObjects(t.wdt, t.x, t.y) });
			}));
			out.sort((a, b) => a.key.localeCompare(b.key));
			const seen = new Set<string>();
			c.models = [];
			for (const { placements } of out) {
				for (const p of placements) {
					const key = `${p.kind}:${p.fdid}:${p.variant ?? ''}`;
					if (seen.has(key)) continue;
					seen.add(key);
					c.models.push({ fdid: p.fdid, kind: p.kind, variant: p.variant });
				}
			}
			return out;
		},
	},
	{
		name: 'models',
		// Batches of 8, four batches in flight, as ObjectManager asks for them.
		run: async ({ world, models }) => {
			const batches: (typeof models)[] = [];
			for (let i = 0; i < models.length; i += 8) batches.push(models.slice(i, i + 8));
			const out: unknown[] = new Array(batches.length);
			let next = 0;
			await Promise.all(Array.from({ length: 4 }, async () => {
				for (let b = next++; b < batches.length; b = next++) out[b] = await world.loadModels(batches[b]);
			}));
			return out;
		},
	},
];

/** FNV-1a over every number, string and typed array in a value, keys in order. */
export function digest(value: unknown): string {
	let h = 0x811c9dc5;
	const mix = (byte: number) => {
		h ^= byte;
		h = Math.imul(h, 0x01000193);
	};
	const f64 = new Float64Array(1);
	const f64b = new Uint8Array(f64.buffer);
	const walk = (v: unknown, depth: number): void => {
		if (depth > 40) return;
		if (v === null || v === undefined) return mix(v === null ? 1 : 2);
		if (typeof v === 'number') {
			f64[0] = v;
			for (const b of f64b) mix(b);
			return;
		}
		if (typeof v === 'string') {
			for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i) & 0xff);
			return mix(0);
		}
		if (typeof v === 'boolean') return mix(v ? 3 : 4);
		if (v instanceof ArrayBuffer) return walk(new Uint8Array(v), depth);
		if (ArrayBuffer.isView(v)) {
			const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
			mix(bytes.length & 0xff);
			for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
			return;
		}
		if (typeof v === 'function') return;
		if (v instanceof Map) return walk([...v.entries()], depth + 1);
		if (v instanceof Set) return walk([...v], depth + 1);
		if (Array.isArray(v)) {
			mix(0x5b);
			for (const x of v) walk(x, depth + 1);
			return mix(0x5d);
		}
		for (const k of Object.keys(v as object)) {
			walk(k, depth + 1);
			walk((v as Record<string, unknown>)[k], depth + 1);
		}
	};
	walk(value, 0);
	return (h >>> 0).toString(16).padStart(8, '0');
}

export async function runBench(options: BenchOptions): Promise<BenchResult> {
	const times: Record<string, number[]> = {};
	const digests: Record<string, string> = {};
	const record = (name: string, ms: number) => (times[name] ??= []).push(ms);
	const runs = options.digest ? 1 : options.runs;
	for (let run = 0; run < runs; run++) {
		let t = performance.now();
		const storage = await CascStorage.open(options.source, options.product);
		if (!options.only || options.only.has('open')) record('open', performance.now() - t);
		const explorer = new MapExplorer(storage);
		const world = new WorldLoader(explorer);
		const context: Context = { explorer, world, continents: await world.knownMaps(), textures: [], models: [] };
		for (const phase of PHASES) {
			const wanted = !options.only || options.only.has(phase.name);
			t = performance.now();
			const result = await phase.run(context);
			const ms = performance.now() - t;
			if (wanted) record(phase.name, ms);
			if (options.digest && wanted) digests[phase.name] = digest(result);
		}
		options.log(`run ${run + 1}/${runs}`);
	}
	return { times, digests };
}

/** Median (of the runs after the first, which warms the JIT and file handles), min, max and first run per phase. */
export function summarize(times: Record<string, number[]>): string {
	const rows = Object.entries(times).map(([name, ms]) => {
		const sorted = [...ms].sort((a, b) => a - b);
		const warm = ms.length > 2 ? ms.slice(1).sort((a, b) => a - b) : sorted;
		return { name, median: warm[warm.length >> 1], min: sorted[0], max: sorted[sorted.length - 1], first: ms[0] };
	});
	const total = rows.reduce((n, r) => n + r.median, 0);
	const line = (cells: (string | number)[]) => cells.map((c, i) => (typeof c === 'number' ? Math.round(c).toString() : c)[i ? 'padStart' : 'padEnd'](i ? 8 : 16)).join(' ');
	return [
		line(['phase', 'median', 'min', 'max', 'first']),
		...rows.map((r) => line([r.name, r.median, r.min, r.max, r.first])),
		line(['total (medians)', total, '', '', '']),
	].join('\n');
}
