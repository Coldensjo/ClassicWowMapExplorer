interface Section {
	total: number;
	max: number;
	count: number;
}

/** A frame that took long enough to see as a freeze. */
interface Hitch {
	/** ms since the page opened. */
	at: number;
	/** ms since the frame before. */
	ms: number;
	/** Shaders three built during the frame: each one is a stall. */
	shadersBuilt: number;
	/** The frame's timed sections over 2 ms, longest first. */
	sections: Record<string, number>;
	/** What the browser says the main thread was doing, where it can (Long Animation Frames). */
	scripts: string[];
}

/** ms between frames that counts as a hitch. */
const HITCH_MS = 50;
const MAX_HITCHES = 100;

/**
 * Cheap timing of named main-thread sections, exposed as window.mapExplorerPerf so
 * frame hitches can be traced from the console or a test harness: mapExplorerPerf.hitches()
 * lists the recent ones.
 */
class Perf {
	readonly sections = new Map<string, Section>();
	private readonly frame = new Map<string, number>();
	private readonly hitchList: Hitch[] = [];
	private lastFrame = 0;
	private lastShaders = 0;
	/** Long Animation Frame scripts not yet given to a hitch. */
	private scripts: { end: number; text: string }[] = [];

	constructor() {
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as unknown as { startTime: number; duration: number; scripts?: { duration: number; invoker: string; sourceFunctionName: string; sourceURL: string; sourceCharPosition: number }[] }[]) {
					for (const s of entry.scripts ?? []) {
						if (s.duration < 10) continue;
						const where = s.sourceURL ? ` ${s.sourceURL.replace(/^.*\//, '')}:${s.sourceCharPosition}` : '';
						this.scripts.push({ end: entry.startTime + entry.duration, text: `${Math.round(s.duration)} ms ${s.invoker} ${s.sourceFunctionName || '(anonymous)'}${where}` });
					}
				}
				if (this.scripts.length > 200) this.scripts.splice(0, this.scripts.length - 200);
			}).observe({ type: 'long-animation-frame', buffered: false });
		} catch {
			// Not in this browser: hitches go without script details.
		}
	}

	record(name: string, ms: number): void {
		const s = this.sections.get(name) ?? { total: 0, max: 0, count: 0 };
		s.total += ms;
		s.max = Math.max(s.max, ms);
		s.count++;
		this.sections.set(name, s);
	}

	time<T>(name: string, fn: () => T): T {
		const start = performance.now();
		try {
			return fn();
		} finally {
			const ms = performance.now() - start;
			this.record(name, ms);
			this.frame.set(name, (this.frame.get(name) ?? 0) + ms);
		}
	}

	/** Call at the end of each frame, with how many shaders three has (renderer.info.programs). */
	endFrame(now: number, shaders: number): void {
		const ms = this.lastFrame ? now - this.lastFrame : 0;
		// Much longer is the tab hidden, not a hitch.
		if (ms > HITCH_MS && ms < 5000) {
			const sections = Object.fromEntries([...this.frame].filter(([, t]) => t > 2).sort((a, b) => b[1] - a[1]).map(([name, t]) => [name, +t.toFixed(1)]));
			// The browser reports a long frame a little after it; scripts from around this one.
			const scripts = this.scripts.filter((s) => s.end > this.lastFrame - 100).map((s) => s.text);
			this.hitchList.push({ at: Math.round(now), ms: Math.round(ms), shadersBuilt: Math.max(0, shaders - this.lastShaders), sections, scripts });
			if (this.hitchList.length > MAX_HITCHES) this.hitchList.shift();
		}
		this.lastFrame = now;
		this.lastShaders = shaders;
		this.frame.clear();
	}

	/** The recent hitches, oldest first. */
	hitches(): Hitch[] {
		return [...this.hitchList];
	}

	report(): Record<string, { avg: number; max: number; count: number }> {
		const out: Record<string, { avg: number; max: number; count: number }> = {};
		for (const [name, s] of this.sections) out[name] = { avg: +(s.total / s.count).toFixed(2), max: +s.max.toFixed(2), count: s.count };
		return out;
	}

	reset(): void {
		this.sections.clear();
		this.hitchList.length = 0;
	}
}

export const perf = new Perf();
(globalThis as unknown as { mapExplorerPerf: Perf }).mapExplorerPerf = perf;
