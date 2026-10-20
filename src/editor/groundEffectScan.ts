import { kvGet, kvSet } from '../scene/db';
import type { AsyncStorageApi } from '../worker/protocol';

/**
 * The ground effect scan (spec 7.7.2): the client stores which clutter grows on a texture per
 * ADT layer, not per texture, so the tool reads every map's _tex0 files once and learns, for each
 * texture, the effect it usually carries. The scan runs in the background from first run, can be
 * paused, resumes where it left off, and its table is cached in IndexedDB keyed by build. Partial
 * results already feed newly painted layers.
 */

/** Tiles scanned per worker call, so the worker stays free for the editor in between. */
const TILES_PER_CALL = 48;
/** The cached scan state is written out every this many maps. */
const SAVE_EVERY = 5;

interface ScanState {
	/** WDT FDIDs of the maps already scanned whole. */
	done: number[];
	/** texture FDID -> effect ID -> times seen. */
	counts: Record<string, Record<string, number>>;
	complete: boolean;
}

export class GroundEffectScan {
	/** Texture FDID -> the effect most of its layers carry (never 0 entries). */
	private readonly table = new Map<number, number>();
	private state: ScanState = { done: [], counts: {}, complete: false };
	private running = false;
	private pauseAsked = false;
	/** Shown in the status bar; empty once done. */
	onStatus: (text: string, paused: boolean) => void = () => {};

	constructor(
		private readonly storage: AsyncStorageApi,
		private readonly build: string,
	) {}

	private get key(): string {
		return `groundEffects:${this.build}`;
	}

	/** Loads the cached state and keeps scanning in the background unless it is already done. */
	async start(): Promise<void> {
		const cached = await kvGet<ScanState>(this.key).catch(() => undefined);
		if (cached?.counts) this.state = cached;
		this.rebuildTable();
		if (!this.state.complete) void this.run();
	}

	/** The effect a texture usually carries, or 0 for none (spec 7.7.2); fed to new paint layers. */
	effectFor(fdid: number): number {
		return this.table.get(fdid) ?? 0;
	}

	get complete(): boolean {
		return this.state.complete;
	}

	get paused(): boolean {
		return this.pauseAsked;
	}

	/** Pauses after the batch in flight, or picks the scan back up. */
	setPaused(paused: boolean): void {
		this.pauseAsked = paused;
		if (!paused && !this.running && !this.state.complete) void this.run();
		else this.status('');
	}

	private async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const maps = await this.storage.scanMaps();
			const remaining = maps.filter((m) => !this.state.done.includes(m.wdt));
			let doneCount = maps.length - remaining.length;
			for (const map of remaining) {
				if (this.pauseAsked) return;
				this.status(`Ground effects: scanning ${map.name} (${doneCount}/${maps.length} maps)`);
				let offset: number | null = 0;
				while (offset !== null) {
					if (this.pauseAsked) return;
					const slice = await this.storage.scanMapGroundEffects(map.wdt, offset, TILES_PER_CALL);
					for (const [fdid, effect, n] of slice.pairs) {
						const counts = (this.state.counts[fdid] ??= {});
						counts[effect] = (counts[effect] ?? 0) + n;
					}
					offset = slice.next;
				}
				this.state.done.push(map.wdt);
				doneCount++;
				this.rebuildTable();
				if (doneCount % SAVE_EVERY === 0) await this.save();
			}
			this.state.complete = true;
			await this.save();
			this.status('');
		} catch (e) {
			this.status(`Ground effect scan stalled: ${e instanceof Error ? e.message : e}`);
		} finally {
			this.running = false;
		}
	}

	private save(): Promise<unknown> {
		return kvSet(this.key, this.state).catch(() => {});
	}

	/** For each texture, the most common effect wins; 0 (no effect) can win too. */
	private rebuildTable(): void {
		this.table.clear();
		for (const [fdid, counts] of Object.entries(this.state.counts)) {
			let best = 0;
			let bestCount = -1;
			for (const [effect, n] of Object.entries(counts)) {
				if (n > bestCount) {
					bestCount = n;
					best = Number(effect);
				}
			}
			if (best) this.table.set(Number(fdid), best);
		}
	}

	private status(text: string): void {
		this.onStatus(this.state.complete ? '' : this.pauseAsked ? 'Ground effect scan paused' : text, this.pauseAsked);
	}
}

let scan: GroundEffectScan | null = null;

/** The one scan for the opened build, started on first run (spec 3.1). */
export function groundEffectScan(storage: AsyncStorageApi, build: string): GroundEffectScan {
	if (!scan) {
		scan = new GroundEffectScan(storage, build);
		void scan.start();
	}
	return scan;
}
