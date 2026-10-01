import { rotationZ } from './mat4';
import type { Placement } from './objects';
import { spawnFile, spawnMatrix, tileOf } from './spawns';

/** The swirls the game places at dungeon doors: blue for dungeons, green for raids. */
const PORTAL = 197007;
const RAID_PORTAL = 197008;
const RAIDS = new Set([249, 309, 409, 469, 509, 531, 533]);

/**
 * Teleport triggers (IDs in public/spawns/triggers.json) at dungeon and raid doors whose map
 * files have no portal placed: Shadowfang Keep, the Deadmines exits, Sunken Temple, Scholomance,
 * Dire Maul's wing doors, the way into Onyxia's Lair and Zul'Gurub. Every other door has
 * one of its own (Onyxia's way out is a wide sphere in the cave with no door to fill).
 */
const BARE_DOORS = [119, 121, 145, 194, 446, 2567, 2848, 3183, 3184, 3186, 3187, 3189, 3928, 3930];

/** Radius (model units) of the portal's swirl of particles, around this height above its base. */
const SWIRL_RADIUS = 4.17;
const SWIRL_HEIGHT = 2.74;

/** A return trigger's arrival point counts as this door's when this close (yards). */
const PAIR_DISTANCE = 40;

/** id, name, map, x, y, z, radius, box length, width, height, orientation, target map, x, y, z, orientation. */
type TriggerRow = [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** Placed portals for the doors in BARE_DOORS, by map and tile, from the trigger table. */
export class PortalSource {
	private constructor(private readonly byTile: Map<string, Placement[]>) {}

	static async load(): Promise<PortalSource> {
		const byTile = new Map<string, Placement[]>();
		try {
			const response = await fetch(spawnFile('triggers.json'));
			if (response.ok) {
				const rows = ((await response.json()) as { triggers: TriggerRow[] }).triggers;
				for (const row of rows) {
					if (!BARE_DOORS.includes(row[0])) continue;
					const [id, , map, x, y, z, radius, length, width, , boxTurn, target] = row;
					// Where the way back in (or out) lands you next to this door: you arrive on the
					// ground facing away from it, which gives the portal's height and facing.
					let arrival: TriggerRow | null = null;
					let best = PAIR_DISTANCE;
					for (const other of rows) {
						if (other[11] !== map || other[2] !== target) continue;
						const d = Math.hypot(other[12] - x, other[13] - y);
						if (d < best) {
							best = d;
							arrival = other;
						}
					}
					const ground = arrival ? Math.min(arrival[14], z) : z - 1;
					const facing = arrival ? arrival[15] : boxTurn;
					const size = radius || Math.max(length, width) / 2;
					const scale = Math.min(2.2, Math.max(1.2, size / SWIRL_RADIUS));
					const dungeon = map === 0 || map === 1 ? target : map;
					const { tx, ty } = tileOf(x, y);
					const key = `${map}:${tx}_${ty}`;
					const list = byTile.get(key) ?? [];
					list.push({
						kind: 'm2',
						// Clear of the map files' unique IDs, which stay well below this.
						uid: 0xfe000000 + id,
						fdid: RAIDS.has(dungeon) ? RAID_PORTAL : PORTAL,
						matrix: spawnMatrix(x, y, Math.max(ground, z - SWIRL_HEIGHT * scale), rotationZ((facing * 180) / Math.PI), scale),
						doodadSet: 0,
					});
					byTile.set(key, list);
				}
			}
		} catch (e) {
			console.warn('Area triggers unavailable; no added portals', e);
		}
		return new PortalSource(byTile);
	}

	/** Copies, since the transfer to the main thread empties the matrices. */
	placements(mapId: number, x: number, y: number): Placement[] {
		return (this.byTile.get(`${mapId}:${x}_${y}`) ?? []).map((p) => ({ ...p, matrix: p.matrix.slice() }));
	}
}
