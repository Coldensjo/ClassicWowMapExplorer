import type { SpawnInfo } from '../explorer/spawns';

/**
 * What riding into a game object does on the board: herbs give a burst of speed, ore veins a
 * wall grip (up any wall for a while), meeting stones a mega jump, chests double points for a
 * while, and fishing spots let the board surf the water.
 */
export type Pickup = 'boost' | 'grip' | 'jump' | 'double' | 'surf';

/** The herbs of Classic, which the game files with chests (they're looted like them). */
const HERBS = /^(Peacebloom|Silverleaf|Earthroot|Mageroyal|Briarthorn|Stranglekelp|Bruiseweed|Wild Steelbloom|Grave Moss|Kingsblood|Liferoot|Fadeleaf|Goldthorn|Khadgar's Whisker|Wintersbite|Firebloom|Purple Lotus|Arthas' Tears|Sungrass|Blindweed|Ghost Mushroom|Gromsblood|Golden Sansam|Dreamfoil|Mountain Silversage|Plaguebloom|Icecap|Black Lotus|Bloodthistle)$/;
/** Ore veins and deposits, filed with chests too. */
const ORE = /\b(Vein|Deposit)$/;
/** Chests and their kin, to tell them from the other things filed as chests (quest objects, crates of this and that). */
const CHESTS = /\b(Chest|Strongbox|Coffer|Footlocker|Trunk|Lockbox|Cache)\b/;

/** What a game object does when ridden into, or null for nothing. */
export function pickupOf(info: SpawnInfo): Pickup | null {
	switch (info.kind) {
		case 'Meeting stone':
			return 'jump';
		case 'Fishing hole':
			return 'surf';
		case 'Chest':
			return HERBS.test(info.name) ? 'boost' : ORE.test(info.name) ? 'grip' : CHESTS.test(info.name) ? 'double' : null;
		default:
			return null;
	}
}
