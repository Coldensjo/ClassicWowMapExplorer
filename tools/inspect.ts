// Dumps chunk layouts of files by ID, to explore formats.
// Usage: npx tsx tools/inspect.ts <fdid> [<fdid>...]   (ranges allowed: 775960-775980)
import { CascStorage } from '../src/casc/storage';
import { chunks } from '../src/formats/chunks';
import { describeError } from '../src/explorer/maps';
import { NodeSource } from './nodeSource';

const storage = await CascStorage.open(new NodeSource('C:/Program Files (x86)/World of Warcraft'), 'wow_classic_beta');
const ids = process.argv.slice(2).flatMap((arg) => {
	const [a, b] = arg.split('-').map(Number);
	return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
});

for (const fdid of ids) {
	const status = storage.status(fdid);
	if (status !== 'ok') {
		console.log(fdid, status);
		continue;
	}
	try {
		const { data, encryptedKeys } = await storage.readFileWithStatus(fdid, true);
		const magic = new TextDecoder().decode(data.subarray(0, 4));
		const list: string[] = [];
		if (/^[A-Z0-9]{4}$/.test(magic) && data.length > 8) {
			for (const c of chunks(data)) {
				if (list.length > 40) break;
				list.push(`${c.id}:${c.size}`);
			}
		}
		console.log(fdid, data.length, JSON.stringify(magic), encryptedKeys.length ? `encrypted chunks: ${encryptedKeys}` : '', list.join(' '));
	} catch (e) {
		console.log(fdid, describeError(e));
	}
}
