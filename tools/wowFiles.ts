// Serves the World of Warcraft install found on this computer under /__wow/ in the dev server,
// as the portable launcher does, so the page opens it without asking for the folder.
// WOW_DIR=<folder> picks the install; otherwise it's looked up as the launcher does.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const PREFIX = '/__wow/';
const UNINSTALL_KEYS = [
	'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
	'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
const BLIZZARD_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft';
const USUAL_FOLDERS = ['Program Files (x86)\\World of Warcraft', 'Program Files\\World of Warcraft', 'World of Warcraft', 'Games\\World of Warcraft'];

/** The install root at or up to two folders above a path (InstallPath names _classic_\ and the like). */
function installRoot(path: string): string | null {
	let dir = resolve(path);
	for (let up = 0; up < 3; up++) {
		if (existsSync(join(dir, '.build.info')) && existsSync(join(dir, 'Data', 'data'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** A registry value under every subkey of a key whose name contains "World of Warcraft" (or the key itself). */
function registryValues(key: string, value: string): string[] {
	let output: string;
	try {
		output = execFileSync('reg', ['query', key, '/s', '/v', value], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return [];
	}
	const found: string[] = [];
	let current = '';
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith('HKEY_')) current = line;
		const match = line.match(new RegExp(`^\\s+${value}\\s+REG_SZ\\s+(.+)$`));
		if (match && current.includes('World of Warcraft')) found.push(match[1].trim());
	}
	return found;
}

function findWow(): string | null {
	if (process.env.WOW_DIR) return installRoot(process.env.WOW_DIR);
	if (process.platform !== 'win32') return null;
	const candidates = [
		...UNINSTALL_KEYS.flatMap((key) => registryValues(key, 'InstallLocation')),
		...registryValues(BLIZZARD_KEY, 'InstallPath'),
		...'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap((drive) => USUAL_FOLDERS.map((folder) => `${drive}:\\${folder}`)),
	];
	for (const candidate of candidates) {
		const root = installRoot(candidate);
		if (root) return root;
	}
	return null;
}

export function wowFiles(): Plugin {
	return {
		name: 'wow-files',
		apply: 'serve',
		configureServer(server) {
			const root = findWow();
			server.config.logger.info(root ? `  World of Warcraft: ${root}` : '  World of Warcraft not found; choose the folder in the page (or set WOW_DIR).');
			if (!root) return;
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith(PREFIX)) return next();
				const relative = decodeURIComponent(req.url.slice(PREFIX.length).split('?')[0]);
				// Only what the storage reader needs, and nothing outside the install.
				const allowed = relative === '.build.info' || /^data\//i.test(relative);
				if (!allowed || relative.includes('..') || relative.includes('\\')) {
					res.statusCode = 404;
					return res.end();
				}
				const path = join(root, relative);
				if (relative.endsWith('/')) {
					if (!existsSync(path)) {
						res.statusCode = 404;
						return res.end();
					}
					res.setHeader('Content-Type', 'text/plain; charset=utf-8');
					return res.end(readdirSync(path).join('\n'));
				}
				if (!existsSync(path) || !statSync(path).isFile()) {
					res.statusCode = 404;
					return res.end();
				}
				const size = statSync(path).size;
				res.setHeader('Content-Type', 'application/octet-stream');
				res.setHeader('Accept-Ranges', 'bytes');
				res.setHeader('Cache-Control', 'no-cache');
				const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
				let start = 0;
				let end = size - 1;
				if (range) {
					start = Number(range[1]);
					end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
					if (start >= size || start > end) {
						res.statusCode = 416;
						res.setHeader('Content-Range', `bytes */${size}`);
						return res.end();
					}
					res.statusCode = 206;
					res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
				}
				res.setHeader('Content-Length', String(end - start + 1));
				if (req.method === 'HEAD') return res.end();
				createReadStream(path, { start, end }).pipe(res);
			});
		},
	};
}
