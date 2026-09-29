import { open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { NotFoundError, type FileSource, type RandomAccessFile } from '../src/casc/source';

class NodeFile implements RandomAccessFile {
	constructor(private readonly handle: FileHandle, readonly size: number) {}

	async read(offset: number, length: number): Promise<Uint8Array> {
		const buf = new Uint8Array(length);
		let done = 0;
		while (done < length) {
			const { bytesRead } = await this.handle.read(buf, done, length - done, offset + done);
			if (bytesRead === 0) break;
			done += bytesRead;
		}
		return buf;
	}
}

/** FileSource over the local file system, for running the reader outside the browser. */
export class NodeSource implements FileSource {
	private readonly files = new Map<string, Promise<RandomAccessFile>>();

	constructor(private readonly root: string) {}

	openFile(path: string[]): Promise<RandomAccessFile> {
		const full = join(this.root, ...path);
		let file = this.files.get(full);
		if (!file) {
			file = (async () => {
				try {
					const handle = await open(full, 'r');
					return new NodeFile(handle, (await handle.stat()).size);
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(path);
					throw e;
				}
			})();
			this.files.set(full, file);
		}
		return file;
	}

	listDir(path: string[]): Promise<string[]> {
		return readdir(join(this.root, ...path));
	}
}
