interface Section {
	total: number;
	max: number;
	count: number;
}

/**
 * Cheap timing of named main-thread sections, exposed as window.mapExplorerPerf so
 * frame hitches can be traced from the console or a test harness.
 */
class Perf {
	readonly sections = new Map<string, Section>();

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
			this.record(name, performance.now() - start);
		}
	}

	report(): Record<string, { avg: number; max: number; count: number }> {
		const out: Record<string, { avg: number; max: number; count: number }> = {};
		for (const [name, s] of this.sections) out[name] = { avg: +(s.total / s.count).toFixed(2), max: +s.max.toFixed(2), count: s.count };
		return out;
	}

	reset(): void {
		this.sections.clear();
	}
}

export const perf = new Perf();
(globalThis as unknown as { mapExplorerPerf: Perf }).mapExplorerPerf = perf;
