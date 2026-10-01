import type { AsyncStorageApi, Request, Response, StorageApi } from './protocol';

/** Main-thread proxy for the storage worker. */
export function createStorageClient(onProgress: (message: string) => void): AsyncStorageApi {
	const worker = new Worker(new URL('./storage.worker.ts', import.meta.url), { type: 'module' });
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	let nextId = 1;

	worker.onmessage = (event: MessageEvent<Response>) => {
		const msg = event.data;
		if ('progress' in msg) {
			onProgress(msg.progress);
			return;
		}
		const call = pending.get(msg.id);
		if (!call) return;
		pending.delete(msg.id);
		if ('error' in msg) call.reject(new Error(msg.error));
		else call.resolve(msg.result);
	};

	const call = (method: keyof StorageApi, args: unknown[]) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, method, args } satisfies Request);
		});

	// Sent first; the worker handles messages in order.
	void call('setPageUrl', [location.href]);
	return new Proxy({} as AsyncStorageApi, {
		get: (_, method: string) => (...args: unknown[]) => call(method as keyof StorageApi, args),
	});
}
