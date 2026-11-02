// Runs the built app in headless Chrome (on the real GPU), flies a fixed route over busy country
// and measures the page's main thread: time until the world shows, frame times and long
// animation frames while flying, and a CPU profile of the page.
//   bun tools/bench/app.ts <dist> [--compare <dist>] [--rounds n] [--route start|tour|dash] [--count-gl] [--inspect <expr>] [--profile <dir>] [--wow <dir>] [--chrome <exe>]
// Build a dist with `vite build --outDir <dir>`. With --compare, runs of the two alternate, each in
// a fresh browser context, after one warm-up run of each that isn't counted.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	if (i < 0) return null;
	return args.splice(i, 2)[1];
};
const wowDir = flag('--wow') ?? 'C:/Program Files (x86)/World of Warcraft';
const chrome = flag('--chrome') ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const compare = flag('--compare');
const rounds = Number(flag('--rounds') ?? 3);
const profileDir = flag('--profile');
/** An expression evaluated in the page at the end of each run, its value printed (for looking into the scene). */
const inspect = flag('--inspect');
/** Count WebGL calls (program switches, draws, uniform uploads) per frame while flying; slows the frames it counts. */
const countGl = args.includes('--count-gl');
if (countGl) args.splice(args.indexOf('--count-gl'), 1);
const dists: Record<string, string> = { new: resolve(args[0] ?? 'dist') };
if (compare) dists.base = resolve(compare);

/** Elwynn Forest by Goldshire, then on to Stormwind, Westfall, Duskwood, Redridge and back. */
const START = '#0/32.5/48.9/150/0/-17';
const ROUTES: Record<string, { hashes: string[]; leg: number }> = {
	// No flight: for timing the start alone.
	start: { hashes: [], leg: 0 },
	tour: { hashes: ['#0/31.4/48.0/120/300/-15', '#0/30.6/50.6/150/200/-17', '#0/32.6/52.6/150/180/-17', '#0/35.6/50.6/150/90/-17', '#0/33.4/49.2/150/0/-17'], leg: 7000 },
	// Long hops faster than the ground can stream in, so a backlog builds; settle is how long it takes to clear.
	dash: {
		hashes: ['#0/30.0/52.0/200/200/-17', '#0/31.0/56.0/200/180/-17', '#0/32.5/59.5/200/180/-17', '#0/36.0/56.0/200/90/-17', '#0/37.0/51.0/200/0/-17',
			'#0/35.5/46.5/200/0/-17', '#0/34.0/42.5/200/0/-17', '#0/31.5/39.5/200/300/-17', '#0/28.5/42.0/200/240/-17', '#0/30.0/46.0/200/180/-17'],
		leg: 2600,
	},
};
const route = ROUTES[flag('--route') ?? 'tour'];

const server = Bun.serve({
	port: 0,
	hostname: '127.0.0.1',
	async fetch(request) {
		const url = new URL(request.url);
		const [, variant, ...rest] = decodeURIComponent(url.pathname).split('/');
		const root = dists[variant];
		if (!root) return new Response(null, { status: 404 });
		const path = rest.join('/') || 'index.html';
		if (path.startsWith('__wow/')) return serveWow(request, path.slice('__wow/'.length));
		const file = Bun.file(join(root, path));
		return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
	},
});

function serveWow(request: Request, path: string): Response {
	const local = join(wowDir, path);
	if (path.endsWith('/') || path === '') {
		try {
			return new Response(readdirSync(local).join('\n'));
		} catch {
			return new Response(null, { status: 404 });
		}
	}
	let size: number;
	try {
		size = statSync(local).size;
	} catch {
		return new Response(null, { status: 404 });
	}
	const file = Bun.file(local);
	const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') ?? '');
	if (!range) return new Response(file, { headers: { 'Content-Length': String(size) } });
	const start = Number(range[1]);
	const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
	return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}` } });
}

const DEBUG_PORT = 9334;
const userData = mkdtempSync(join(tmpdir(), 'bench-app-'));
const browser = spawn(chrome, [
	'--headless=new', `--user-data-dir=${userData}`, '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080',
	'--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
], { stdio: 'ignore' });

/** A DevTools protocol connection to the browser, with flattened sessions for pages. */
class Cdp {
	private nextId = 1;
	private readonly waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			const call = message.id ? this.waiting.get(message.id) : null;
			if (!call) return;
			this.waiting.delete(message.id);
			if (message.error) call.reject(new Error(`${message.error.message}`));
			else call.resolve(message.result);
		});
	}

	static async connect(): Promise<Cdp> {
		for (let tries = 0; ; tries++) {
			try {
				const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json());
				// Profiles are large; the default message limit would drop them.
				const socket = new WebSocket(webSocketDebuggerUrl);
				await new Promise((r, j) => {
					socket.addEventListener('open', r, { once: true });
					socket.addEventListener('error', j, { once: true });
				});
				return new Cdp(socket);
			} catch (e) {
				if (tries > 50) throw e;
				await new Promise((r) => setTimeout(r, 200));
			}
		}
	}

	send(method: string, params: object = {}, sessionId?: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.waiting.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	async evaluate(sessionId: string, expression: string): Promise<any> {
		const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
		if (exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
		return result.value;
	}

	close(): void {
		this.socket.close();
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunResult {
	startup: number;
	frames: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	over50: number;
	over100: number;
	blocking: number;
	busy: number;
	/** After the last leg, ms until the storage worker had nothing left to do (as the app's log says). */
	settle: number;
	/** Storage calls answered from the first frame recorded to the settle. */
	calls: number;
	/** Median and 90th percentile ms from asking to answer (queue in the worker included), from the app's log. */
	nearMed: number;
	nearP90: number;
	modelMed: number;
	modelP90: number;
	farTexMed: number;
}

/** Counts WebGL calls by kind, from the page's first script on. */
const GL_COUNTER = `(() => {
	const counts = (globalThis.__gl = { useProgram: 0, draws: 0, uniforms: 0, bindTexture: 0, bindVertexArray: 0 });
	for (const proto of [WebGL2RenderingContext.prototype]) {
		const wrap = (name, key) => {
			const original = proto[name];
			proto[name] = function (...args) { counts[key]++; return original.apply(this, args); };
		};
		wrap('useProgram', 'useProgram');
		wrap('bindTexture', 'bindTexture');
		wrap('bindVertexArray', 'bindVertexArray');
		for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) wrap(name, 'draws');
		for (const name of Object.getOwnPropertyNames(proto).filter((n) => /^uniform(Matrix)?[1-4]/.test(n))) wrap(name, 'uniforms');
	}
})()`;

/** Records frame intervals and long animation frames' blocking time from when it's run. */
const RECORDER = `(() => {
	const w = window;
	w.__frames = [];
	w.__recordStart = performance.now();
	w.__blocking = 0;
	let last = performance.now();
	const tick = (now) => { w.__frames.push(now - last); last = now; if (!w.__stop) requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
	new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__blocking += e.blockingDuration || 0; }).observe({ type: 'long-animation-frame' });
})()`;

async function run(cdp: Cdp, variant: string, profileTo: string | null): Promise<RunResult> {
	const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
	const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
	try {
		await cdp.send('Page.enable', {}, sessionId);
		await cdp.send('Runtime.enable', {}, sessionId);
		await cdp.send('Profiler.enable', {}, sessionId);
		await cdp.send('Profiler.setSamplingInterval', { interval: 500 }, sessionId);
		if (countGl) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GL_COUNTER }, sessionId);
		const start = Date.now();
		await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/${variant}/index.html${START}` }, sessionId);
		let startup = 0;
		for (;;) {
			await sleep(100);
			const shown = await cdp.evaluate(sessionId, `!!globalThis.mapExplorerPerf && mapExplorerPerf.logLines('load').some((l) => l.includes('world shown'))`).catch(() => false);
			if (shown) {
				startup = Date.now() - start;
				break;
			}
			if (Date.now() - start > Number(process.env.SHOW_TIMEOUT ?? 180000)) {
				const state = await cdp.evaluate(sessionId, `JSON.stringify({ href: location.href, html: document.documentElement.outerHTML.slice(0, 300), text: String(document.body && document.body.innerText).slice(0, 400), log: globalThis.mapExplorerPerf ? mapExplorerPerf.logLines().slice(-25) : null })`).catch((e) => String(e));
				throw new Error(`The world never showed: ${state}`);
			}
		}
		await sleep(2000);
		await cdp.send('Profiler.start', {}, sessionId);
		await cdp.evaluate(sessionId, RECORDER);
		if (countGl) await cdp.evaluate(sessionId, `Object.keys(__gl).forEach((k) => (__gl[k] = 0))`);
		for (const hash of route.hashes) {
			await cdp.evaluate(sessionId, `location.hash = ${JSON.stringify(hash)}`);
			await sleep(route.leg);
		}
		const { frames, blocking } = await cdp.evaluate(sessionId, `(() => { window.__stop = true; return { frames: window.__frames, blocking: window.__blocking }; })()`);
		if (countGl) {
			const gl = await cdp.evaluate(sessionId, '__gl');
			console.error(`${variant} GL calls per frame: ${Object.entries(gl).map(([k, v]) => `${k} ${((v as number) / frames.length).toFixed(0)}`).join(', ')}`);
		}
		if (inspect) console.error(`${variant}: ${JSON.stringify(await cdp.evaluate(sessionId, inspect))}`);
		const { profile } = await cdp.send('Profiler.stop', {}, sessionId);
		// Settled: the last storage call answered left none waiting, and none has come since for a while.
		const routeEnd = Date.now();
		let settle = 0;
		let lastLine = '';
		let lastChange = routeEnd;
		for (;;) {
			const line: string = await cdp.evaluate(sessionId, `mapExplorerPerf.logLines('storage').at(-1) ?? ''`);
			if (line !== lastLine) {
				lastLine = line;
				lastChange = Date.now();
			}
			if (/, 0 still waiting$/.test(line) && Date.now() - lastChange >= 1500) {
				settle = lastChange - routeEnd;
				break;
			}
			if (Date.now() - routeEnd > 120000) throw new Error(`Storage never settled: ${line}`);
			await sleep(50);
		}
		const lines: string[] = await cdp.evaluate(sessionId, `mapExplorerPerf.logLines('storage')`);
		const calls = (await cdp.evaluate(sessionId, `mapExplorerPerf.logLines('storage').filter((l) => parseFloat(l) * 1000 >= window.__recordStart).length`)) as number;
		const latency = (method: string) => lines.flatMap((l) => {
			const m = new RegExp(String.raw`storage: ${method}\(.*?\) (\d+) ms`).exec(l);
			return m ? [Number(m[1])] : [];
		}).sort((a, b) => a - b);
		const q = (v: number[], f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : NaN);
		const near = latency('loadNearTile');
		const models = latency('loadModels');
		const farTex = latency('loadTileTextures');
		if (profileTo) writeFileSync(profileTo, JSON.stringify(profile));
		const sorted = [...(frames as number[])].sort((a, b) => a - b);
		const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
		return {
			startup,
			frames: sorted.length,
			p50: at(0.5),
			p95: at(0.95),
			p99: at(0.99),
			max: sorted[sorted.length - 1],
			over50: sorted.filter((f) => f > 50).length,
			over100: sorted.filter((f) => f > 100).length,
			blocking,
			busy: busyTime(profile),
			settle: Math.max(0, settle),
			calls,
			nearMed: q(near, 0.5),
			nearP90: q(near, 0.9),
			modelMed: q(models, 0.5),
			modelP90: q(models, 0.9),
			farTexMed: q(farTex, 0.5),
		};
	} finally {
		await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
		await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
	}
}

/** Milliseconds the profile spent running anything (not idle). */
function busyTime(profile: { nodes: { id: number; callFrame: { functionName: string } }[]; samples: number[]; timeDeltas: number[] }): number {
	const idle = new Set(profile.nodes.filter((n) => n.callFrame.functionName === '(idle)').map((n) => n.id));
	let busy = 0;
	profile.samples.forEach((id, i) => {
		if (!idle.has(id)) busy += profile.timeDeltas[i] ?? 0;
	});
	return busy / 1000;
}

const cdp = await Cdp.connect();
if (profileDir) mkdirSync(profileDir, { recursive: true });
const results: Record<string, RunResult[]> = Object.fromEntries(Object.keys(dists).map((k) => [k, []]));
try {
	const order = Object.keys(dists);
	// One uncounted run each first: the GPU's shader cache and the disk cache fill on the first.
	for (const variant of order) {
		console.error(`warm-up ${variant}`);
		await run(cdp, variant, null);
	}
	for (let round = 0; round < rounds; round++) {
		for (const variant of round % 2 ? [...order].reverse() : order) {
			const result = await run(cdp, variant, profileDir ? join(profileDir, `${variant}-${round}.cpuprofile`) : null);
			results[variant].push(result);
			console.error(`round ${round + 1} ${variant}: ${JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`);
		}
	}
} finally {
	cdp.close();
	browser.kill();
	server.stop(true);
	await sleep(500);
	try {
		rmSync(userData, { recursive: true, force: true });
	} catch {
		// Chrome may still hold it for a moment.
	}
}

const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const keys = Object.keys(results.new[0]) as (keyof RunResult)[];
const header = ['metric', ...Object.keys(results), ...(compare ? ['change'] : [])];
const rows = keys.map((k) => {
	const cells = Object.keys(results).map((v) => median(results[v].map((r) => r[k])));
	const change = compare ? [`${(((cells[0] - cells[1]) / (cells[1] || 1)) * 100).toFixed(1)}%`] : [];
	return [k, ...cells.map((c) => c.toFixed(1)), ...change];
});
console.log([header, ...rows].map((r) => r.map((c, i) => (i ? c.padStart(10) : c.padEnd(10))).join('')).join('\n'));
console.log(JSON.stringify(results));
