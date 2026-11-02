// The storage benchmark (core.ts) in a browser worker, reading the install over HTTP the way the
// app's storage worker does under the portable launcher. Started by serve.ts.
import { HttpSource } from '../../src/casc/source';
import { setPageUrl } from '../../src/explorer/spawns';
import { runBench } from './core';

onmessage = async (event: MessageEvent<{ page: string; product: string; runs: number; only: string | null; digest: boolean }>) => {
	const { page, product, runs, only, digest } = event.data;
	setPageUrl(page);
	try {
		const result = await runBench({
			source: new HttpSource(new URL('__wow/', page).href),
			product,
			runs,
			only: only ? new Set(only.split(',')) : null,
			digest,
			log: (line) => postMessage({ log: line }),
		});
		postMessage({ result });
	} catch (e) {
		postMessage({ error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
	}
};
