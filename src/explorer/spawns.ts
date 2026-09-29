import type { CascStorage } from '../casc/storage';
import { TILE_SIZE } from '../formats/adt';
import { loadTable } from './clientDb';
import { compose, fromQuaternion, identity, rotationZ, scaling, translation, type Mat4 } from './mat4';
import type { M2Options, Placement } from './objects';

const MAP_ORIGIN = 32 * TILE_SIZE;

/** Shown when a spawn is clicked. */
export interface SpawnInfo {
	type: 'npc' | 'object';
	guid: number;
	/** creature_template / gameobject_template entry: the ID Wowhead uses. */
	entry: number;
	name: string;
	subname?: string;
	level?: string;
	/** Creature type or game object type, as a label. */
	kind?: string;
	rank?: string;
	/** Readable objects: their pages of text. */
	pages?: string[];
	/** NPCs: how they react to Alliance and Horde players (name plate colour). */
	reaction?: { alliance: Reaction; horde: Reaction };
}

export type Reaction = 'hostile' | 'neutral' | 'friendly';

/** public/spawns/map<id>.json, written by tools/buildSpawns.ts. */
interface SpawnFile {
	pages: Record<number, string[]>;
	creatures: {
		/** entry -> [name, subname, levelMin, levelMax, type, rank, npcFlags, displayIds, scales, factionTemplate] */
		templates: Record<number, [string, string, number, number, number, number, number, number[], number[], number]>;
		/** [guid, entry, x, y, z, orientation] in world coordinates */
		spawns: [number, number, number, number, number, number][];
	};
	objects: {
		/** entry -> [name, type, displayId, size, data0] */
		templates: Record<number, [string, number, number, number, number]>;
		/** [guid, entry, x, y, z, orientation, rotation quaternion x, y, z, w] */
		spawns: [number, number, number, number, number, number, number, number, number, number][];
	};
}

const CREATURE_TYPES = ['', 'Beast', 'Dragonkin', 'Demon', 'Elemental', 'Giant', 'Undead', 'Humanoid', 'Critter', 'Mechanical', 'Not specified', 'Totem'];
const RANKS = ['', 'Elite', 'Rare Elite', 'Boss', 'Rare'];
const OBJECT_TYPES: Record<number, string> = {
	0: 'Door', 1: 'Button', 2: 'Quest giver', 3: 'Chest', 5: 'Object', 6: 'Trap', 7: 'Chair', 8: 'Spell focus',
	9: 'Text', 10: 'Interactive', 11: 'Transport', 13: 'Camera', 15: 'Transport', 17: 'Fishing node', 18: 'Summoning ritual',
	19: 'Mailbox', 20: 'Auction house', 22: 'Spellcaster', 23: 'Meeting stone', 24: 'Flag stand', 25: 'Fishing hole', 26: 'Flag drop',
};

/**
 * World -> continent space (x east, y up, z south): x = origin - worldY, y = worldZ, z = origin - worldX.
 * Models use WoW's own axes (x forward, y left, z up), so a world rotation is conjugated into this basis.
 */
const WORLD_BASIS: Mat4 = (() => {
	const m = identity();
	// Columns: world x (north) -> -z, world y (west) -> -x, world z (up) -> +y.
	m[0] = 0; m[1] = 0; m[2] = -1;
	m[4] = -1; m[5] = 0; m[6] = 0;
	m[8] = 0; m[9] = 1; m[10] = 0;
	return m;
})();

function spawnMatrix(x: number, y: number, z: number, rotation: Mat4, scale: number): Mat4 {
	return compose(translation(MAP_ORIGIN - y, z, MAP_ORIGIN - x), WORLD_BASIS, rotation, scaling(scale));
}

export type ReactionLookup = (factionTemplate: number) => { alliance: Reaction; horde: Reaction };

const tileOf = (x: number, y: number) => ({ tx: Math.floor(32 - y / TILE_SIZE), ty: Math.floor(32 - x / TILE_SIZE) });

/**
 * Creature and game object spawns from the VMaNGOS world database, served as extra placements
 * per ADT tile, plus the client tables that turn display IDs into models.
 */
export class SpawnSource {
	private readonly byTile = new Map<string, Placement[]>();

	private constructor(private readonly file: SpawnFile) {}

	static async load(mapId: number): Promise<SpawnSource | null> {
		try {
			const response = await fetch(`/spawns/map${mapId}.json`);
			if (!response.ok) return null;
			return new SpawnSource(await response.json());
		} catch {
			return null;
		}
	}

	/** Placements for one tile, built on first use. kind 'creature' and 'object' carry display IDs. */
	placements(x: number, y: number, scaleOf: (displayId: number) => number, reactionOf: ReactionLookup): Placement[] {
		if (this.byTile.size === 0) this.index(scaleOf, reactionOf);
		return this.byTile.get(`${x}_${y}`) ?? [];
	}

	private index(scaleOf: (displayId: number) => number, reactionOf: ReactionLookup): void {
		const add = (x: number, y: number, p: Placement) => {
			const { tx, ty } = tileOf(x, y);
			const key = `${tx}_${ty}`;
			const list = this.byTile.get(key) ?? [];
			list.push(p);
			this.byTile.set(key, list);
		};
		const { creatures, objects, pages } = this.file;
		for (const [guid, entry, x, y, z, o] of creatures.spawns) {
			const t = creatures.templates[entry];
			if (!t) continue;
			const [name, subname, levelMin, levelMax, type, rank, , displays, scales, faction] = t;
			if (!displays.length) continue;
			// Templates with several looks pick one per spawn; keep it stable per guid.
			const pick = guid % displays.length;
			const displayId = displays[pick];
			const scale = (scales[pick] || 1) * scaleOf(displayId);
			add(x, y, {
				kind: 'creature',
				uid: guid,
				fdid: displayId,
				matrix: spawnMatrix(x, y, z, rotationZ((o * 180) / Math.PI), scale),
				doodadSet: 0,
				spawn: {
					type: 'npc', guid, entry, name,
					subname: subname || undefined,
					level: levelMin === levelMax ? `${levelMin}` : `${levelMin}-${levelMax}`,
					kind: CREATURE_TYPES[type] || undefined,
					rank: RANKS[rank] || undefined,
					reaction: reactionOf(faction),
				},
			});
		}
		for (const [guid, entry, x, y, z, o, qx, qy, qz, qw] of objects.spawns) {
			const t = objects.templates[entry];
			if (!t) continue;
			const [name, type, displayId, size, data0] = t;
			if (!displayId) continue;
			const rotation = qx || qy || qz || qw ? fromQuaternion(qx, qy, qz, qw) : rotationZ((o * 180) / Math.PI);
			add(x, y, {
				kind: 'object',
				uid: guid,
				fdid: displayId,
				matrix: spawnMatrix(x, y, z, rotation, size || 1),
				doodadSet: 0,
				spawn: {
					type: 'object', guid, entry, name,
					kind: OBJECT_TYPES[type],
					pages: type === 9 && data0 ? pages[data0] : undefined,
				},
			});
		}
	}
}

/** Resolves creature and game object display IDs to model files, textures and scale. */
export class DisplayResolver {
	private tables: Promise<{
		creatureDisplay: Awaited<ReturnType<typeof loadTable>>;
		creatureModel: Awaited<ReturnType<typeof loadTable>>;
		displayExtra: Awaited<ReturnType<typeof loadTable>>;
		objectDisplay: Awaited<ReturnType<typeof loadTable>>;
		factions: Awaited<ReturnType<typeof loadTable>>;
		materials: Map<number, number>;
	}> | null = null;

	constructor(private readonly storage: CascStorage) {}

	private load() {
		this.tables ??= (async () => {
			const [creatureDisplay, creatureModel, displayExtra, objectDisplay, textureFiles, factions] = await Promise.all([
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfo),
				loadTable(this.storage, DISPLAY_FILES.CreatureModelData),
				loadTable(this.storage, DISPLAY_FILES.CreatureDisplayInfoExtra),
				loadTable(this.storage, DISPLAY_FILES.GameObjectDisplayInfo),
				loadTable(this.storage, DISPLAY_FILES.TextureFileData),
				loadTable(this.storage, DISPLAY_FILES.FactionTemplate),
			]);
			// Material resources ID -> texture file (TextureFileData: ID is the file, field 2 the material).
			const materials = new Map<number, number>();
			for (const fdid of textureFiles.ids()) {
				const material = textureFiles.getInt(fdid, 2);
				if (material && !materials.has(material)) materials.set(material, fdid);
			}
			return { creatureDisplay, creatureModel, displayExtra, objectDisplay, factions, materials };
		})();
		return this.tables;
	}

	/** Model scale from CreatureDisplayInfo, needed before the model itself loads. */
	async scaleLookup(): Promise<(displayId: number) => number> {
		const { creatureDisplay } = await this.load();
		return (id) => creatureDisplay.getFloat(id, 4) || 1;
	}

	/**
	 * How a faction template reacts to each side, from FactionTemplate (field 2 FactionGroup,
	 * 3 FriendGroup, 4 EnemyGroup; group bits 1 player, 2 Alliance, 4 Horde, 8 monster).
	 */
	async reactionLookup(): Promise<ReactionLookup> {
		const { factions } = await this.load();
		const toSide = (group: number, friend: number, enemy: number, side: number): Reaction =>
			enemy & (side | FACTION_PLAYER) ? 'hostile' : (friend | group) & side ? 'friendly' : 'neutral';
		return (id) => {
			const group = factions.getInt(id, 2) ?? 0;
			const friend = factions.getInt(id, 3) ?? 0;
			const enemy = factions.getInt(id, 4) ?? 0;
			return { alliance: toSide(group, friend, enemy, FACTION_ALLIANCE), horde: toSide(group, friend, enemy, FACTION_HORDE) };
		};
	}

	async creature(displayId: number): Promise<{ fdid: number; options: M2Options } | null> {
		const { creatureDisplay, creatureModel, displayExtra, materials } = await this.load();
		const modelId = creatureDisplay.getInt(displayId, 1);
		const fdid = modelId ? creatureModel.getInt(modelId, 2) : null;
		if (!fdid) return null;
		const extra = creatureDisplay.getInt(displayId, 7) ?? 0;
		if (extra && displayExtra.has(extra)) {
			// Humanoid NPCs: a character model with the outfit baked into one texture. Prefer the
			// original (SD) race model with its SD bake; fall back to the HD model the table names.
			const race = displayExtra.getInt(extra, 1) ?? 0;
			const sex = displayExtra.getInt(extra, 2) ?? 0;
			const sd = SD_CHARACTER_MODELS[race]?.[sex];
			const sdBake = materials.get(displayExtra.getInt(extra, 5) ?? 0);
			if (sd && sdBake && this.storage.status(sd) === 'ok') {
				return { fdid: sd, options: { textures: { 1: sdBake }, defaultGeosets: true, stand: true } };
			}
			const bake = materials.get(displayExtra.getInt(extra, 6) ?? 0) ?? sdBake ?? 0;
			return { fdid, options: { textures: { 1: bake }, defaultGeosets: true, stand: true } };
		}
		const skins = [0, 1, 2].map((k) => creatureDisplay.getInt(displayId, 27, k) ?? 0);
		return { fdid, options: { textures: { 11: skins[0], 12: skins[1], 13: skins[2] }, defaultGeosets: true, stand: true } };
	}

	async object(displayId: number): Promise<number | null> {
		const { objectDisplay } = await this.load();
		return objectDisplay.getInt(displayId, 1) || null;
	}
}

/**
 * Original (pre-HD) character models by ChrRaces ID, [male, female] (file IDs from the community
 * listfile: character/<race>/<sex>/<race><sex>.m2). The display tables point at the HD models.
 */
const SD_CHARACTER_MODELS: Record<number, [number, number]> = {
	1: [119940, 119563], // human
	2: [121287, 121087], // orc
	3: [118355, 118135], // dwarf
	4: [120791, 120590], // night elf
	5: [121768, 121608], // undead
	6: [122055, 121961], // tauren
	7: [119159, 119063], // gnome
	8: [122560, 122414], // troll
	9: [119376, 119369], // goblin
	10: [117170, 116921], // blood elf
	11: [117721, 117437], // draenei
	12: [118653, 118652], // fel orc
	14: [117412, 117400], // broken
	15: [121942, 121941], // skeleton
	18: [118798, 118798], // forest troll
};

/** Client tables for display lookups (file IDs from the community listfile). */
export const DISPLAY_FILES = {
	CreatureDisplayInfo: 1108759,
	CreatureDisplayInfoExtra: 1264997,
	CreatureModelData: 1365368,
	GameObjectDisplayInfo: 1266277,
	TextureFileData: 982459,
	FactionTemplate: 1361579,
} as const;

const FACTION_PLAYER = 1;
const FACTION_ALLIANCE = 2;
const FACTION_HORDE = 4;

