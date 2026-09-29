import type { SourceInit } from '../worker/protocol';

/** Chromium's directory picker; it refuses folders under Program Files ("contains system files"). */
export const hasDirectoryPicker = 'showDirectoryPicker' in window;

export async function pickDirectory(): Promise<SourceInit | null> {
	try {
		const handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> })
			.showDirectoryPicker({ id: 'wow', mode: 'read' });
		return { kind: 'handle', handle };
	} catch (e) {
		if ((e as DOMException).name === 'AbortError') return null;
		throw e;
	}
}

/**
 * Converts an <input webkitdirectory> selection into a source, keeping only the files the
 * storage reader needs. Paths become relative to the picked folder.
 */
export function filesToSource(files: FileList | File[]): SourceInit {
	const entries = [...files]
		.map((file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file }))
		.filter(({ path }) => path === '.build.info' || /^data\/(config|data)\//i.test(path));
	return { kind: 'files', files: entries };
}

/** A dropped folder's entries in a directory, all of them (readEntries returns them in batches). */
function readDir(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
	return new Promise((resolve, reject) => {
		const reader = dir.createReader();
		const all: FileSystemEntry[] = [];
		const next = () => reader.readEntries((batch) => {
			if (!batch.length) return resolve(all);
			all.push(...batch);
			next();
		}, reject);
		next();
	});
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/**
 * A folder dropped on the page, as a source: only the files the storage reader needs
 * (.build.info, Data/config and Data/data), so even a large install is quick to list.
 */
export async function droppedFolderToSource(root: FileSystemDirectoryEntry): Promise<SourceInit> {
	const files: { path: string; file: File }[] = [];
	const walk = async (dir: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
		for (const entry of await readDir(dir)) {
			const path = `${prefix}${entry.name}`;
			if (entry.isFile) files.push({ path, file: await fileOf(entry as FileSystemFileEntry) });
			else await walk(entry as FileSystemDirectoryEntry, `${path}/`);
		}
	};
	const top = await readDir(root);
	const buildInfo = top.find((e) => e.isFile && e.name === '.build.info');
	if (buildInfo) files.push({ path: '.build.info', file: await fileOf(buildInfo as FileSystemFileEntry) });
	const data = top.find((e) => e.isDirectory && e.name.toLowerCase() === 'data');
	if (data) {
		for (const entry of await readDir(data as FileSystemDirectoryEntry)) {
			if (entry.isDirectory && /^(config|data)$/i.test(entry.name)) await walk(entry as FileSystemDirectoryEntry, `Data/${entry.name}/`);
		}
	}
	return { kind: 'files', files };
}
