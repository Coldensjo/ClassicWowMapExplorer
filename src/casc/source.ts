/** A file that supports reading arbitrary byte ranges without loading it whole. */
export interface RandomAccessFile {
	readonly size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * Read-only access to a World of Warcraft install directory. Paths are relative to the
 * install root (the folder holding .build.info) and given as segments, e.g. ['Data', 'data', 'data.000'].
 */
export interface FileSource {
	openFile(path: string[]): Promise<RandomAccessFile>;
	listDir(path: string[]): Promise<string[]>;
}

export class NotFoundError extends Error {
	constructor(path: string[]) {
		super(`File not found: ${path.join('/')}`);
		this.name = 'NotFoundError';
	}
}

export class BlobFile implements RandomAccessFile {
	constructor(private readonly blob: Blob) {}

	get size(): number {
		return this.blob.size;
	}

	async read(offset: number, length: number): Promise<Uint8Array> {
		return new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer());
	}
}

/** Source backed by the File System Access API (Chromium browsers). */
export class DirectoryHandleSource implements FileSource {
	private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
	private readonly files = new Map<string, Promise<RandomAccessFile>>();

	constructor(private readonly root: FileSystemDirectoryHandle) {}

	private dir(path: string[]): Promise<FileSystemDirectoryHandle> {
		if (path.length === 0) return Promise.resolve(this.root);
		const key = path.join('/').toLowerCase();
		let dir = this.dirs.get(key);
		if (!dir) {
			dir = this.dir(path.slice(0, -1)).then((parent) => parent.getDirectoryHandle(path[path.length - 1]));
			dir.catch(() => this.dirs.delete(key));
			this.dirs.set(key, dir);
		}
		return dir;
	}

	openFile(path: string[]): Promise<RandomAccessFile> {
		const key = path.join('/').toLowerCase();
		let file = this.files.get(key);
		if (!file) {
			file = (async () => {
				try {
					const dir = await this.dir(path.slice(0, -1));
					const handle = await dir.getFileHandle(path[path.length - 1]);
					return new BlobFile(await handle.getFile());
				} catch (e) {
					if (e instanceof DOMException && e.name === 'NotFoundError') throw new NotFoundError(path);
					throw e;
				}
			})();
			file.catch(() => this.files.delete(key));
			this.files.set(key, file);
		}
		return file;
	}

	async listDir(path: string[]): Promise<string[]> {
		const dir = await this.dir(path);
		const names: string[] = [];
		for await (const name of dir.keys()) names.push(name);
		return names;
	}
}

/** Source backed by files from an <input webkitdirectory> pick (works in every browser). */
export class FileListSource implements FileSource {
	private readonly files = new Map<string, File>();

	/** Paths are relative to the install root, using '/' separators. */
	constructor(entries: { path: string; file: File }[]) {
		for (const { path, file } of entries) this.files.set(path.toLowerCase(), file);
	}

	async openFile(path: string[]): Promise<RandomAccessFile> {
		const file = this.files.get(path.join('/').toLowerCase());
		if (!file) throw new NotFoundError(path);
		return new BlobFile(file);
	}

	async listDir(path: string[]): Promise<string[]> {
		const prefix = path.length ? path.join('/').toLowerCase() + '/' : '';
		const names = new Set<string>();
		for (const [key, file] of this.files) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			const slash = rest.indexOf('/');
			// Keys are lower-cased for lookup; report the real file name when it is a direct child.
			names.add(slash < 0 ? file.name : rest.slice(0, slash));
		}
		return [...names];
	}
}
