import { dbOp, PRESET_STORE } from './db';
import type { NpcPreset } from './types';
import { validPresets } from './wscene';

/** A .wnpc file: one preset as JSON (spec 7.11). */
const WNPC_FORMAT = 'wnpc';

/**
 * The local NPC preset library (spec 7.11): custom NPC presets kept in IndexedDB, apart from
 * scenes, which new scenes draw from; a scene embeds a copy of every preset it uses (spec 6.6).
 */
export class PresetLibrary {
	/** Every preset, by name. */
	async list(): Promise<NpcPreset[]> {
		const all = await dbOp<NpcPreset[]>(PRESET_STORE, 'readonly', (store) => store.getAll() as IDBRequest<NpcPreset[]>);
		return all.sort((a, b) => a.name.localeCompare(b.name));
	}

	async get(id: string): Promise<NpcPreset | null> {
		return (await dbOp<NpcPreset | undefined>(PRESET_STORE, 'readonly', (store) => store.get(id) as IDBRequest<NpcPreset | undefined>)) ?? null;
	}

	/** Stores a preset, replacing one with the same id. */
	async save(preset: NpcPreset): Promise<void> {
		await dbOp(PRESET_STORE, 'readwrite', (store) => store.put(structuredClone(preset)));
	}

	async delete(id: string): Promise<void> {
		await dbOp(PRESET_STORE, 'readwrite', (store) => store.delete(id));
	}

	/** A preset as .wnpc JSON bytes. */
	static export(preset: NpcPreset): Uint8Array {
		return new TextEncoder().encode(JSON.stringify({ format: WNPC_FORMAT, version: 1, preset }, null, '\t'));
	}

	/** Validates .wnpc bytes and stores the preset under a fresh id, so an import never overwrites one. */
	async import(bytes: Uint8Array): Promise<NpcPreset> {
		let parsed: { format?: string; version?: number; preset?: NpcPreset };
		try {
			parsed = JSON.parse(new TextDecoder().decode(bytes));
		} catch (e) {
			throw new Error(`Not a .wnpc file: ${e instanceof Error ? e.message : e}`);
		}
		if (parsed?.format !== WNPC_FORMAT || !parsed.preset) throw new Error('Not a .wnpc file: no preset in it');
		if (!Number.isInteger(parsed.version) || parsed.version! > 1) throw new Error('This preset was made with a newer version of the builder');
		const [preset] = validPresets([parsed.preset]);
		const fresh = { ...preset, id: crypto.randomUUID() };
		await this.save(fresh);
		return fresh;
	}
}
