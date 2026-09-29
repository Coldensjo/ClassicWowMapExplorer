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
