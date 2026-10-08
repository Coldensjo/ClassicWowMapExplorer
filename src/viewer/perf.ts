import type * as THREE from 'three';

interface Section {
	total: number;
	max: number;
	count: number;
}

/** One thing that happened, for the debug log. */
interface LogEntry {
	/** ms since the page opened. */
	t: number;
	/** What it's about: load, storage, tile, model, shader, gl, input, frame... */
	cat: string;
	msg: string;
}

/** A frame that took long enough to see as a freeze. */
interface Hitch {
	/** ms since the page opened. */
	at: number;
	/** ms since the frame before began. */
	ms: number;
	/**
	 * The longest the page's main thread went without running a timer during it (ms). Near ms,
	 * the page itself was busy (its scripts, or waiting on the GPU process for an answer); near
	 * 0, the page was free and it was the browser's GPU process or compositor that was stuck.
	 */
	blocked: number;
	/** Shaders three built in it: each one is a stall. */
	shadersBuilt: number;
	/** The frame before's timed sections over 2 ms, longest first. */
	sections: Record<string, number>;
	/** WebGL calls in it, over 1 ms in all: total ms and how many calls. */
	gl: Record<string, [number, number]>;
	/** Counts in it: bytes and textures sent to the GPU, and so on. */
	counts: Record<string, number>;
	/** The longest an input event (mouse, keys) waited before the page got it (ms). */
	inputDelay: number;
	/** JS heap in MB at the frame before and at this one, where the browser tells: a drop is garbage collection. */
	heap: [number, number] | null;
	/** What the browser says the main thread was doing, where it can (Long Animation Frames). */
	scripts: string[];
	/** What was logged during it. */
	events: string[];
}

/** ms between frames that counts as a hitch. */
const HITCH_MS = 50;
/** Hitches this long are written to the console as they happen. */
const WARN_MS = 100;
const MAX_HITCHES = 300;
/** Entries of the debug log kept from the start (loading and the first minutes, never dropped), then the latest ones. */
const LOG_HEAD = 20000;
const LOG_TAIL = 20000;
/** A single WebGL call this long goes in the log, with where it was made from. */
const SLOW_GL_MS = 8;
/** How often the main-thread monitor's timer runs (ms). */
const TICK_MS = 10;
const VERBOSE_KEY = 'mapExplorer.debug';

/**
 * WebGL calls that can wait on the GPU process (queries that need an answer, uploads that copy
 * data, a full command buffer) or that show what's being sent. Draws are counted, not logged.
 */
const GL_CALLS = [
	'getProgramParameter', 'getProgramInfoLog', 'getShaderParameter', 'getShaderInfoLog', 'getUniformLocation', 'getActiveUniform',
	'getAttribLocation', 'getUniformBlockIndex', 'getError', 'getParameter', 'getSyncParameter', 'clientWaitSync', 'readPixels', 'finish',
	'compileShader', 'linkProgram', 'useProgram', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'texStorage3D',
	'compressedTexImage2D', 'compressedTexSubImage2D', 'compressedTexImage3D', 'compressedTexSubImage3D', 'generateMipmap', 'bufferData', 'bufferSubData',
] as const;
/** Draw calls, wrapped keeping their argument count (some WebGL calls pick an overload by it). */
const GL_DRAWS: Record<string, number> = { drawArrays: 3, drawElements: 4, drawArraysInstanced: 4, drawElementsInstanced: 5 };
/** Names of the getProgramParameter / getShaderParameter queries, for the log. */
const GL_PARAMS: Record<number, string> = {
	0x8b81: 'COMPILE_STATUS', 0x8b82: 'LINK_STATUS', 0x8b83: 'VALIDATE_STATUS', 0x8b86: 'ACTIVE_UNIFORMS', 0x8b89: 'ACTIVE_ATTRIBUTES',
	0x8a36: 'ACTIVE_UNIFORM_BLOCKS', 0x91b1: 'COMPLETION_STATUS', 0x8b4f: 'SHADER_TYPE', 0x8b80: 'DELETE_STATUS',
};

/**
 * Cheap timing of named main-thread sections and a debug log of what the app is doing, exposed
 * as window.mapExplorerPerf so frame hitches can be traced from the console or a test harness:
 * mapExplorerPerf.hitches() lists the recent ones, mapExplorerPerf.log() what happened, and
 * mapExplorerPerf.save() (F9 in the viewer) saves it all to a file. Hitches of 100 ms or more
 * are written to the console as they happen; mapExplorerPerf.verbose = true (or ?debug in the
 * address) writes every log entry too.
 */
class Perf {
	readonly sections = new Map<string, Section>();
	private readonly frame = new Map<string, number>();
	private readonly hitchList: Hitch[] = [];
	private lastFrame = 0;
	private lastShaders = 0;
	/** Long Animation Frame scripts not yet given to a hitch. */
	private scripts: { end: number; text: string }[] = [];
	/** The debug log's first entries, kept, and its latest. */
	private readonly head: LogEntry[] = [];
	private readonly tail: LogEntry[] = [];
	private verboseOn = false;
	/** The main-thread monitor: when its timer last ran, and its longest wait since the frame before. */
	private lastTick = performance.now();
	private longestTick = 0;
	/** Whether the page was hidden at some point since the frame before (no frames then, not a hitch). */
	private wasHidden = document.hidden;
	private readonly glFrame = new Map<string, [number, number]>();
	private readonly counts = new Map<string, number>();
	private inputDelay = 0;
	private lastHeap = 0;
	private programs: { name: string; cacheKey: string }[] | null = null;
	private readonly seenPrograms = new WeakSet<object>();
	private programCount = 0;
	private gpu = '';

	constructor() {
		try {
			this.verboseOn = localStorage.getItem(VERBOSE_KEY) === '1' || new URLSearchParams(location.search).has('debug');
		} catch {
			// Storage blocked: quiet unless switched on for this page.
		}
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as unknown as { startTime: number; duration: number; blockingDuration?: number; scripts?: { duration: number; invoker: string; sourceFunctionName: string; sourceURL: string; sourceCharPosition: number }[] }[]) {
					const texts: string[] = [];
					for (const s of entry.scripts ?? []) {
						if (s.duration < 10) continue;
						const where = s.sourceURL ? ` ${s.sourceURL.replace(/^.*\//, '')}:${s.sourceCharPosition}` : '';
						const text = `${Math.round(s.duration)} ms ${s.invoker} ${s.sourceFunctionName || '(anonymous)'}${where}`;
						this.scripts.push({ end: entry.startTime + entry.duration, text });
						texts.push(text);
					}
					if (entry.duration >= HITCH_MS) this.log('frame', `long animation frame ${Math.round(entry.duration)} ms, blocking ${Math.round(entry.blockingDuration ?? 0)} ms${texts.length ? `: ${texts.join('; ')}` : ''}`);
				}
				if (this.scripts.length > 200) this.scripts.splice(0, this.scripts.length - 200);
			}).observe({ type: 'long-animation-frame', buffered: true });
		} catch {
			// Not in this browser: hitches go without script details.
		}
		setInterval(() => {
			const now = performance.now();
			this.longestTick = Math.max(this.longestTick, now - this.lastTick);
			this.lastTick = now;
			this.checkPrograms();
		}, TICK_MS);
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.wasHidden = true;
			this.log('page', document.hidden ? 'hidden' : 'shown');
		});
		const onInput = (e: Event) => {
			this.inputDelay = Math.max(this.inputDelay, performance.now() - e.timeStamp);
		};
		for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, onInput, { capture: true, passive: true });
		window.addEventListener('error', (e) => this.log('error', `${e.message} (${(e.filename ?? '').replace(/^.*\//, '')}:${e.lineno})`));
		window.addEventListener('unhandledrejection', (e) => this.log('error', `unhandled: ${(e.reason as Error)?.message ?? String(e.reason)}`));
	}

	/** Whether every log entry is written to the console as well (kept for next time). */
	get verbose(): boolean {
		return this.verboseOn;
	}

	set verbose(on: boolean) {
		this.verboseOn = on;
		try {
			if (on) localStorage.setItem(VERBOSE_KEY, '1');
			else localStorage.removeItem(VERBOSE_KEY);
		} catch {
			// Only for this page, then.
		}
	}

	/** Adds a line to the debug log. */
	log(cat: string, msg: string): void {
		const entry = { t: Math.round(performance.now()), cat, msg };
		if (this.head.length < LOG_HEAD) this.head.push(entry);
		else {
			this.tail.push(entry);
			if (this.tail.length > LOG_TAIL + 1000) this.tail.splice(0, this.tail.length - LOG_TAIL);
		}
		if (this.verboseOn) console.debug(`[MapExplorer] ${(entry.t / 1000).toFixed(2)} s ${cat}: ${msg}`);
	}

	/** Adds to one of the counts a hitch reports (bytes uploaded, say), for the frame under way. */
	count(name: string, n: number): void {
		this.counts.set(name, (this.counts.get(name) ?? 0) + n);
	}

	/**
	 * Watches the renderer: times its WebGL calls (logging the slow ones, with where they were
	 * made from) and logs each shader program it builds.
	 */
	watch(renderer: THREE.WebGLRenderer): void {
		this.programs = renderer.info.programs as unknown as { name: string; cacheKey: string }[] | null;
		const gl = renderer.getContext() as unknown as Record<string, unknown>;
		try {
			const info = (gl.getExtension as (name: string) => { UNMASKED_RENDERER_WEBGL: number } | null).call(gl, 'WEBGL_debug_renderer_info');
			this.gpu = info ? String((gl.getParameter as (p: number) => unknown).call(gl, info.UNMASKED_RENDERER_WEBGL)) : '';
		} catch {
			// Not told.
		}
		this.log('gpu', this.gpu || 'unknown');
		for (const name of GL_CALLS) {
			const fn = gl[name] as ((...args: unknown[]) => unknown) | undefined;
			if (typeof fn !== 'function') continue;
			gl[name] = (...args: unknown[]) => {
				const start = performance.now();
				try {
					return fn.apply(gl, args);
				} finally {
					this.glCall(name, performance.now() - start, args);
				}
			};
		}
		// Thousands a frame: no argument arrays, no try.
		for (const [name, arity] of Object.entries(GL_DRAWS)) {
			const fn = gl[name] as ((...args: unknown[]) => unknown) | undefined;
			if (typeof fn !== 'function') continue;
			const time = (start: number) => this.glCall(name, performance.now() - start, null);
			gl[name] = arity === 3
				? (a: unknown, b: unknown, c: unknown) => { const s = performance.now(); fn.call(gl, a, b, c); time(s); }
				: arity === 4
					? (a: unknown, b: unknown, c: unknown, d: unknown) => { const s = performance.now(); fn.call(gl, a, b, c, d); time(s); }
					: (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown) => { const s = performance.now(); fn.call(gl, a, b, c, d, e); time(s); };
		}
	}

	private glCall(name: string, ms: number, args: unknown[] | null): void {
		const total = this.glFrame.get(name);
		if (total) {
			total[0] += ms;
			total[1]++;
		} else {
			this.glFrame.set(name, [ms, 1]);
		}
		if (ms < SLOW_GL_MS) return;
		let detail = '';
		if (args && (name === 'getProgramParameter' || name === 'getShaderParameter')) detail = GL_PARAMS[args[1] as number] ?? String(args[1]);
		else if (args) detail = args.filter((a) => typeof a === 'number').slice(0, 6).join(', ');
		this.log('gl', `${name}(${detail}) took ${ms.toFixed(1)} ms, from ${callSite()}`);
	}

	/** Logs shader programs three has built since the last look. */
	private checkPrograms(): void {
		const programs = this.programs;
		if (!programs || programs.length === this.programCount) return;
		this.programCount = programs.length;
		for (const p of programs) {
			if (this.seenPrograms.has(p)) continue;
			this.seenPrograms.add(p);
			this.log('shader', `built program ${describeProgram(p)} (${programs.length} in all)`);
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

	/**
	 * Call as each frame begins, with how many shaders three has (renderer.info.programs): a long
	 * wait since the frame before began is a hitch, and what was recorded since is what was in it.
	 */
	frameStart(now: number, shaders: number): void {
		this.checkPrograms();
		const ms = this.lastFrame ? now - this.lastFrame : 0;
		const heapNow = heapMB();
		// A hidden page draws no frames: not a hitch.
		if (ms > HITCH_MS && !this.wasHidden && !document.hidden) {
			const sections = Object.fromEntries([...this.frame].filter(([, t]) => t > 2).sort((a, b) => b[1] - a[1]).map(([name, t]) => [name, +t.toFixed(1)]));
			// The browser reports a long frame a little after it; scripts from around this one.
			const scripts = this.scripts.filter((s) => s.end > this.lastFrame - 100).map((s) => s.text);
			const blocked = Math.max(0, Math.round(Math.max(this.longestTick, performance.now() - this.lastTick) - TICK_MS));
			const gl = Object.fromEntries([...this.glFrame].filter(([, [t]]) => t > 1).sort((a, b) => b[1][0] - a[1][0]).map(([name, [t, n]]) => [name, [+t.toFixed(1), n] as [number, number]]));
			const events = this.entries().filter((e) => e.t >= this.lastFrame - 20 && e.cat !== 'frame').map((e) => `${(e.t / 1000).toFixed(2)} s ${e.cat}: ${e.msg}`);
			const hitch: Hitch = {
				at: Math.round(now),
				ms: Math.round(ms),
				blocked,
				shadersBuilt: Math.max(0, shaders - this.lastShaders),
				sections,
				gl,
				counts: Object.fromEntries(this.counts),
				inputDelay: Math.round(this.inputDelay),
				heap: heapNow && this.lastHeap ? [this.lastHeap, heapNow] : null,
				scripts,
				events,
			};
			this.hitchList.push(hitch);
			if (this.hitchList.length > MAX_HITCHES) this.hitchList.shift();
			this.log('hitch', summarize(hitch));
			if (ms >= WARN_MS) console.warn(`[MapExplorer] ${summarize(hitch)}`, hitch);
		}
		this.lastFrame = now;
		this.lastShaders = shaders;
		this.lastHeap = heapNow;
		this.frame.clear();
		this.glFrame.clear();
		this.counts.clear();
		this.inputDelay = 0;
		this.longestTick = 0;
		this.wasHidden = document.hidden;
	}

	/** The recent hitches, oldest first. */
	hitches(): Hitch[] {
		return [...this.hitchList];
	}

	private entries(): LogEntry[] {
		if (!this.tail.length) return this.head;
		const from = Math.max(0, this.tail.length - LOG_TAIL);
		return from ? this.head.concat(this.tail.slice(from)) : this.head.concat(this.tail);
	}

	/** The debug log as lines, oldest first; only those in cat if given. */
	logLines(cat?: string): string[] {
		return this.entries().filter((e) => !cat || e.cat === cat).map((e) => `${(e.t / 1000).toFixed(2)} s ${e.cat}: ${e.msg}`);
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

	/** Everything recorded, with what it ran on and the saved settings: for a bug report. */
	snapshot(): Record<string, unknown> {
		const settings: Record<string, string> = {};
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)!;
				if (key.startsWith('mapExplorer.')) settings[key] = localStorage.getItem(key)!.slice(0, 2000);
			}
		} catch {
			// Not readable.
		}
		const nav = navigator as Navigator & { deviceMemory?: number };
		return {
			savedAt: new Date().toISOString(),
			uptimeSeconds: Math.round(performance.now() / 1000),
			page: location.origin + location.pathname,
			userAgent: navigator.userAgent,
			gpu: this.gpu,
			screen: { width: screen.width, height: screen.height, window: [innerWidth, innerHeight], devicePixelRatio },
			cpus: navigator.hardwareConcurrency,
			memoryGB: nav.deviceMemory ?? null,
			heapMB: heapMB() || null,
			settings,
			hitches: this.hitchList,
			sections: this.report(),
			log: this.logLines(),
		};
	}

	/** Saves snapshot() as a JSON file (to the browser's downloads). */
	save(): void {
		const blob = new Blob([JSON.stringify(this.snapshot(), null, '\t')], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `mapexplorer-debug-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10000);
		this.log('debug', `saved ${a.download}`);
	}
}

/** One line for a hitch: how long, whose fault it looks like, and the biggest costs in it. */
function summarize(h: Hitch): string {
	const who = h.blocked >= h.ms * 0.6
		? `page busy ${h.blocked} ms`
		: h.blocked < h.ms * 0.3
			? `page free (only ${h.blocked} ms busy): the GPU process or browser held it up`
			: `page busy ${h.blocked} ms of it`;
	const parts = [`${h.ms} ms freeze at ${(h.at / 1000).toFixed(1)} s, ${who}`];
	const gl = Object.entries(h.gl).slice(0, 3).map(([name, [t, n]]) => `${name} ${t} ms ×${n}`);
	if (gl.length) parts.push(`WebGL ${gl.join(', ')}`);
	const sections = Object.entries(h.sections).slice(0, 3).map(([name, t]) => `${name} ${t} ms`);
	if (sections.length) parts.push(sections.join(', '));
	if (h.shadersBuilt) parts.push(`${h.shadersBuilt} shader${h.shadersBuilt > 1 ? 's' : ''} built`);
	const uploaded = h.counts['upload.bytes'];
	if (uploaded) parts.push(`${(uploaded / 1048576).toFixed(1)} MB uploaded`);
	if (h.heap && h.heap[1] < h.heap[0] - 20) parts.push(`heap ${h.heap[0]} → ${h.heap[1]} MB (garbage collected)`);
	if (h.inputDelay > HITCH_MS) parts.push(`input waited ${h.inputDelay} ms`);
	if (h.scripts.length) parts.push(`scripts: ${h.scripts.slice(0, 2).join('; ')}`);
	return parts.join('; ');
}

/** A program's kind (three's shader, defines) and the end of its cache key, which names its patches. */
function describeProgram(p: { name: string; cacheKey: string }): string {
	const parts = p.cacheKey.split(',');
	const precision = parts.findIndex((s) => s === 'highp' || s === 'mediump' || s === 'lowp');
	const head = parts.slice(0, precision < 0 ? 2 : precision).filter(Boolean).join(' ');
	const tail = p.cacheKey.replace(/\s+/g, ' ').slice(-48);
	return `${p.name ? `${p.name} ` : ''}[${head}] …${tail}`;
}

/**
 * Where a WebGL call came from: the first few frames of the stack past this, glCall and the
 * wrapper (counted, not matched by name: a build renames them), without the server's address.
 */
function callSite(): string {
	const lines = (new Error().stack ?? '').split('\n').slice(4, 8);
	return lines.map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=[0-9a-f]+/, '')).join(' < ') || 'unknown';
}

function heapMB(): number {
	const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
	return memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0;
}

export const perf = new Perf();
(globalThis as unknown as { mapExplorerPerf: Perf }).mapExplorerPerf = perf;
