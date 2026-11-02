// Runs the storage benchmark (core.ts) in a worker in headless Chrome, which reads the install
// over HTTP from this server, as the app does under the portable launcher.
//   bun tools/bench/serve.ts [runs] [phase,phase...] [--digest] [--compare <dir>] [--profile <file>]
//                            [--wow <dir>] [--product <id>] [--chrome <exe>]
// --compare <dir>: <dir> holds another copy of src/ (e.g. `git archive HEAD src | tar -x -C <dir>`).
//   Rounds of the two alternate, each in a fresh worker that runs the phases twice and keeps the
//   second (warm) run, so drift on the machine falls on both alike; runs is then the round count.
// --profile saves a CPU profile of the worker (.cpuprofile, for Chrome's DevTools).
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { summarize, type BenchResult } from './core';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	if (i < 0) return null;
	return args.splice(i, 2)[1];
};
const digest = args.includes('--digest');
if (digest) args.splice(args.indexOf('--digest'), 1);
const wowDir = flag('--wow') ?? 'C:/Program Files (x86)/World of Warcraft';
const product = flag('--product') ?? 'wow_classic_era';
const chrome = flag('--chrome') ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileFile = flag('--profile');
const compareDir = flag('--compare');
const runs = Number(args[0] ?? 5);
const only = args[1] ?? null;

async function bundle(dir: string): Promise<string> {
	const built = await Bun.build({ entrypoints: [join(dir, 'worker.ts')], target: 'browser', format: 'esm', minify: false });
	if (!built.success) throw new Error(built.logs.join('\n'));
	return built.outputs[0].text();
}

const workers: Record<string, string> = { new: await bundle(import.meta.dir) };
if (compareDir) {
	// The same benchmark, built against the other copy of src/.
	const benchCopy = join(resolve(compareDir), 'tools', 'bench');
	mkdirSync(benchCopy, { recursive: true });
	for (const name of ['core.ts', 'worker.ts']) copyFileSync(join(import.meta.dir, name), join(benchCopy, name));
	workers.base = await bundle(benchCopy);
}

const settings = { product, runs, only, digest, compare: Boolean(compareDir) };
const PAGE = `<!doctype html><script type="module">
const settings = ${JSON.stringify(settings)};
const post = (path, body) => fetch(path, { method: 'POST', body: JSON.stringify(body) });
const runWorker = (name, runs) => new Promise((resolve) => {
	const worker = new Worker('/worker-' + name + '.js', { type: 'module' });
	worker.onmessage = (e) => {
		if (e.data.log) return post('/log', { log: name + ': ' + e.data.log });
		// Kept while profiling: the profile is read from it once it's done.
		if (settings.compare) worker.terminate();
		resolve(e.data);
	};
	worker.onerror = (e) => resolve({ error: e.message });
	worker.postMessage({ page: location.href, product: settings.product, runs, only: settings.only, digest: settings.digest });
});
if (!settings.compare) {
	post('/done', await runWorker('new', settings.runs));
} else {
	const times = { base: {}, new: {} };
	for (let round = 0; round < settings.runs; round++) {
		for (const name of round % 2 ? ['new', 'base'] : ['base', 'new']) {
			const { result, error } = await runWorker(name, 2);
			if (error) { post('/done', { error }); throw new Error(error); }
			for (const [phase, ms] of Object.entries(result.times)) (times[name][phase] ??= []).push(ms[ms.length - 1]);
		}
		post('/log', { log: 'round ' + (round + 1) + '/' + settings.runs });
	}
	post('/done', { compared: times });
}
</script>`;

type Done = { result?: BenchResult; error?: string; compared?: Record<'base' | 'new', Record<string, number[]>> };
let finish: (value: Done) => void;
const done = new Promise<Done>((resolve) => (finish = resolve));

const server = Bun.serve({
	port: 0,
	hostname: '127.0.0.1',
	async fetch(request) {
		const url = new URL(request.url);
		const path = decodeURIComponent(url.pathname);
		if (path === '/' || path === '/bench.html') return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } });
		const worker = /^\/worker-(\w+)\.js$/.exec(path);
		if (worker && workers[worker[1]]) return new Response(workers[worker[1]], { headers: { 'Content-Type': 'text/javascript' } });
		if (path === '/log') {
			console.error((await request.json()).log);
			return new Response('');
		}
		if (path === '/done') {
			finish(await request.json());
			return new Response('');
		}
		if (path.startsWith('/spawns/')) {
			const file = Bun.file(join('public', path));
			return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
		}
		if (path.startsWith('/__wow/')) {
			const local = join(wowDir, path.slice('/__wow/'.length));
			if (path.endsWith('/')) {
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
			const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') ?? '');
			if (!range) return new Response(file, { headers: { 'Content-Length': String(size) } });
			const start = Number(range[1]);
			const end = Math.min(Number(range[2]), size - 1);
			return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}` } });
		}
		return new Response(null, { status: 404 });
	},
});

const profile = mkdtempSync(join(tmpdir(), 'bench-chrome-'));
const pageUrl = `http://127.0.0.1:${server.port}/bench.html`;
const DEBUG_PORT = 9333;
const browser = spawn(chrome, [
	'--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
	...(profileFile ? [`--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'] : [pageUrl]),
], { stdio: 'ignore' });
const stopProfile = profileFile ? await profileWorker(pageUrl) : null;
const { result, error, compared } = await done;
if (stopProfile) {
	writeFileSync(profileFile!, JSON.stringify(await stopProfile()));
	console.error(`profile saved to ${profileFile}`);
}
browser.kill();
server.stop(true);
await new Promise((r) => setTimeout(r, 500));
try {
	rmSync(profile, { recursive: true, force: true });
} catch {
	// Chrome may still hold it for a moment.
}
if (error) {
	console.error(error);
	process.exit(1);
}
if (compared) {
	console.log(compareTable(compared.base, compared.new));
	console.log(JSON.stringify(compared));
} else if (digest) {
	for (const [phase, hash] of Object.entries(result!.digests)) console.log(`${phase.padEnd(16)} ${hash}`);
} else {
	console.log(summarize(result!.times));
	console.log(JSON.stringify(result!.times));
}

/** Per phase: each side's median, the change, and in how many rounds the new code was the faster. */
function compareTable(base: Record<string, number[]>, next: Record<string, number[]>): string {
	const median = (v: number[]) => {
		const s = [...v].sort((a, b) => a - b);
		return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
	};
	const rows: string[][] = [['phase', 'base', 'new', 'change', 'new faster']];
	let totalBase = 0;
	let totalNew = 0;
	const roundTotals = { base: [] as number[], new: [] as number[] };
	for (const phase of Object.keys(base)) {
		const b = median(base[phase]);
		const n = median(next[phase]);
		totalBase += b;
		totalNew += n;
		base[phase].forEach((ms, i) => {
			roundTotals.base[i] = (roundTotals.base[i] ?? 0) + ms;
			roundTotals.new[i] = (roundTotals.new[i] ?? 0) + next[phase][i];
		});
		const wins = base[phase].filter((ms, i) => next[phase][i] < ms).length;
		rows.push([phase, b.toFixed(0), n.toFixed(0), `${(((n - b) / b) * 100).toFixed(1)}%`, `${wins}/${base[phase].length}`]);
	}
	const wins = roundTotals.base.filter((ms, i) => roundTotals.new[i] < ms).length;
	rows.push(['total', totalBase.toFixed(0), totalNew.toFixed(0), `${(((totalNew - totalBase) / totalBase) * 100).toFixed(1)}%`, `${wins}/${roundTotals.base.length}`]);
	return rows.map((r) => r.map((c, i) => (i ? c.padStart(11) : c.padEnd(16))).join('')).join('\n');
}

/**
 * Opens the page with the DevTools protocol attached, so the benchmark's worker is held at its
 * start until the profiler runs in it. Returns a function that stops the profiler and gives the profile.
 */
async function profileWorker(url: string): Promise<() => Promise<unknown>> {
	let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
	for (let tries = 0; !targets.some((t) => t.type === 'page'); tries++) {
		if (tries > 50) throw new Error('Chrome did not open its debugging port');
		await new Promise((r) => setTimeout(r, 200));
		targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json(), () => []);
	}
	const socket = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
	await new Promise((r) => socket.addEventListener('open', r, { once: true }));
	let nextId = 1;
	const waiting = new Map<number, (result: any) => void>();
	const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve) => {
		const id = nextId++;
		waiting.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params, sessionId }));
	});
	let workerSession: string | null = null;
	socket.addEventListener('message', async (event) => {
		const message = JSON.parse(String(event.data));
		if (message.id) waiting.get(message.id)?.(message.result);
		if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'worker') {
			const session = message.params.sessionId;
			workerSession = session;
			await send('Profiler.enable', {}, session);
			await send('Profiler.setSamplingInterval', { interval: 500 }, session);
			await send('Profiler.start', {}, session);
			await send('Runtime.runIfWaitingForDebugger', {}, session);
		}
	});
	await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
	await send('Page.navigate', { url });
	return async () => {
		const { profile } = await send('Profiler.stop', {}, workerSession!);
		socket.close();
		return profile;
	};
}
