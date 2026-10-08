import type { AsyncStorageApi, Request, Response, StorageApi } from './protocol';
import { perf } from '../viewer/perf';

/** Main-thread proxy for the storage worker. */
/** onChanged: called once if the game is updated while the storage is open (see Response). */
export function createStorageClient(onProgress: (message: string) => void, onChanged: () => void = () => {}): AsyncStorageApi {
	const worker = new Worker(new URL('./storage.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string; args: string; start: number }>();
	let nextId = 1;

	worker.onmessage = (event: MessageEvent<Response>) => {
		const msg = event.data;
		if ('progress' in msg) {
			onProgress(msg.progress);
			return;
		}
		if ('changed' in msg) {
			perf.log('storage', 'the game was updated while open');
			onChanged();
			return;
		}
		const call = pending.get(msg.id);
		if (!call) return;
		pending.delete(msg.id);
		const ms = performance.now() - call.start;
		if ('error' in msg) {
			perf.log('storage', `${call.method}(${call.args}) failed after ${ms.toFixed(0)} ms: ${msg.error}`);
			call.reject(new Error(msg.error));
		} else {
			// The time includes the wait in the worker's queue. A big result is copied in on the page's
			// own thread before this runs, which shows in the long animation frames.
			perf.log('storage', `${call.method}(${call.args}) ${ms.toFixed(0)} ms, ${(byteSize(msg.result) / 1048576).toFixed(2)} MB, ${pending.size} still waiting`);
			call.resolve(msg.result);
		}
	};

	const call = (method: keyof StorageApi, args: unknown[]) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject, method, args: describeArgs(args), start: performance.now() });
			worker.postMessage({ id, method, args } satisfies Request);
		});

	// Sent first; the worker handles messages in order.
	void call('setPageUrl', [location.href]);
	return new Proxy({} as AsyncStorageApi, {
		get: (_, method: string) => (...args: unknown[]) => call(method as keyof StorageApi, args),
	});
}

/** A storage call's arguments, short: numbers and short strings as they are, lists by length. */
function describeArgs(args: unknown[]): string {
	return args.map((a) => {
		if (typeof a === 'number' || typeof a === 'boolean') return String(a);
		if (typeof a === 'string') return a.length > 40 ? `${a.slice(0, 40)}…` : a;
		if (Array.isArray(a)) return `[${a.length}]`;
		return a === null || a === undefined ? String(a) : '{…}';
	}).join(', ');
}

/** Roughly how many bytes of typed arrays a result holds (looking a few levels in). */
function byteSize(value: unknown, depth = 0): number {
	if (ArrayBuffer.isView(value)) return value.byteLength;
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (depth > 4 || value === null || typeof value !== 'object') return 0;
	let n = 0;
	for (const v of Array.isArray(value) ? value : Object.values(value)) n += byteSize(v, depth + 1);
	return n;
}
