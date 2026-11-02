// Runs the storage benchmark (core.ts) under Node, reading the install from disk. Bundled first,
// since Node doesn't resolve the source's extensionless imports (see bench in package.json):
//   bun run bench -- [runs] [phase,phase...] [--digest] [--wow <dir>] [--product <id>]
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setPageUrl } from '../../src/explorer/spawns';
import { NodeSource } from '../nodeSource';
import { runBench, summarize } from './core';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	if (i < 0) return null;
	return args.splice(i, 2)[1];
};
const digestMode = args.includes('--digest');
if (digestMode) args.splice(args.indexOf('--digest'), 1);
const wowDir = flag('--wow') ?? 'C:/Program Files (x86)/World of Warcraft';
const product = flag('--product') ?? 'wow_classic_era';

// The spawn files are fetched beside the page; serve file:// URLs from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	if (!url.startsWith('file:')) return realFetch(input, init);
	try {
		return new Response(await readFile(fileURLToPath(url)));
	} catch {
		return new Response(null, { status: 404 });
	}
}) as typeof fetch;
setPageUrl(pathToFileURL(`${process.cwd()}/public/`).href);

const result = await runBench({
	source: new NodeSource(wowDir),
	product,
	runs: Number(args[0] ?? 5),
	only: args[1] ? new Set(args[1].split(',')) : null,
	digest: digestMode,
	log: (line) => process.stderr.write(`${line}\n`),
});
if (digestMode) {
	for (const [phase, hash] of Object.entries(result.digests)) console.log(`${phase.padEnd(16)} ${hash}`);
} else {
	console.log(summarize(result.times));
	console.log(JSON.stringify(result.times));
}
