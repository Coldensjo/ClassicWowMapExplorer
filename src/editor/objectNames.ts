import { listfile } from './listfile';

/**
 * Names for placed objects, for the Attributes module's heading: a placed object keeps only its
 * file id, so the name is looked up in the listfile the Object browser lists it from and written
 * the same way (the last two parts of the path, "trees / elwynntree01"). The lists load on
 * first use; until then the id stands in, and `onLoaded` says when to ask again.
 */
export class ObjectNames {
	private readonly names = new Map<string, string>();
	private readonly loading = new Set<'m2' | 'wmo'>();

	constructor(private readonly onLoaded: () => void) {}

	nameOf(kind: 'm2' | 'wmo', fdid: number): string {
		const name = this.names.get(`${kind}:${fdid}`);
		if (name) return name;
		this.load(kind);
		return `${kind === 'wmo' ? 'Building' : 'Doodad'} ${fdid}`;
	}

	private load(kind: 'm2' | 'wmo'): void {
		if (this.loading.has(kind)) return;
		this.loading.add(kind);
		listfile(kind === 'wmo' ? 'wmo' : 'doodad')
			.then((entries) => {
				for (const e of entries) this.names.set(`${kind}:${e.fdid}`, e.path.replace(/\.(m2|wmo)$/, '').split('/').slice(-2).join(' / '));
				this.onLoaded();
			})
			.catch(() => this.loading.delete(kind));
	}
}
