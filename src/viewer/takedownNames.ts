import type { SpawnInfo } from '../explorer/spawns';

/**
 * Named takedowns, as Burnout names its crashes: who or what went down picks the name. A rule
 * matches a creature by its name, its subname (what it does: Innkeeper, Flight Master) or its
 * type; each has a few names to pick from at random, and what to call several of them at once.
 */
interface Rule {
	/** Matched against the creature's name. */
	name?: RegExp;
	/** Matched against its subname. */
	subname?: RegExp;
	/** Its creature type (Beast, Undead...). */
	kind?: string;
	names: string[];
	/** Three or more at once. */
	pileUp?: string;
}

/** Famous faces first, then trades, then peoples and beasts by name, then creature types: the first that matches names it. */
const RULES: Rule[] = [
	// Famous faces.
	{ name: /^Hogger$/, names: ['Hogtied!', 'Hogger Wash', 'Hog Wild'] },
	{ name: /^King Anduin Wrynn$|^Thrall$|^Lady Sylvanas Windrunner$|^Cairne Bloodhoof$|^King Magni Bronzebeard$|^Tyrande Whisperwind$|^Vol'jin$|^High Tinker Mekkatorque$/, names: ['Regicide!', 'Leader Board', 'Coup de Grâce', 'Long Live the King'] },
	{ name: /^Highlord Bolvar Fordragon$/, names: ['Highlord Lowered', 'Bolvar Bowled'] },
	{ name: /^Lady Katrana Prestor$/, names: ['Dragon in Disguise!', 'Prestor Pressed'] },
	{ name: /^Edwin VanCleef$|^Mr\. Smite$|^Captain Greenskin$/, names: ['Deadmine Delivery', 'Defias Defeated'] },
	{ name: /^Mankrik$/, names: ['Found His Wife Instead'] },
	{ name: /^Marshal Dughan$|^Marshal McBride$/, names: ['Marshal Law', 'Martial Law'] },
	{ name: /^Gamon$/, names: ['Gamon Again!', 'Poor Gamon'] },
	{ name: /^Leeroy|Jenkins/, names: ['At Least I Have Chicken'] },
	{ name: /^Stitches$/, names: ['Unstitched'] },
	{ name: /^Princess$/, names: ['Pork Princess Pounded'] },
	{ name: /Ragnaros|Onyxia|Nefarian|Kel'Thuzad|C'Thun|Hakkar/, names: ['World First!', 'Raid Boss Rodeo', 'Loot Council Approved'] },

	// Trades: what they do, from their subname.
	{ subname: /Innkeeper/, names: ['Last Call', 'Hearthstone Bound', 'Rested Bonus'], pileUp: 'Bar Fight' },
	{ subname: /Flight Master|Wind Rider Master|Gryphon Master|Hippogryph Master|Bat Handler/, names: ['Grounded', 'Flight Cancelled', 'Taxi Crash'] },
	{ subname: /Banker/, names: ['Bank Run', 'Overdraft', 'Insufficient Funds'], pileUp: 'Bank Heist' },
	{ subname: /Auctioneer/, names: ['Going Once, Going Twice...', 'Sold!', 'Buyout'], pileUp: 'Auction House Crash' },
	{ subname: /Stable Master/, names: ['Unstable', 'Barn Burner'] },
	{ subname: /Trainer/, names: ['Lesson Learned', 'Class Dismissed', 'Respec'] },
	{ subname: /Guild Master|Tabard/, names: ['Guild Disbanded', '/gquit'] },
	{ subname: /Battlemaster/, names: ['Queue Popped', 'Deserter'] },
	{ subname: /Spirit Healer/, names: ['Back to the Graveyard', 'Resurrection Sickness'] },
	{ subname: /Vendor|Merchant|Supplies|Goods|Supplier|Weapons|Armor|Armorer|Tailor|Leather|Mail|Plate|Cloth|Food|Drink|Fish|Meat|Baker|Fruit|Mushroom|Reagent|Poison|Bowyer|Gunsmith|Trade|Blacksmith|Smith|Alchemist|Herbalist|Enchanting|Engineer|Cook|Bandages|General Goods|Shield/, names: ['Clearance Sale', 'Price Crash', 'No Refunds', 'Vendor Trash'], pileUp: 'Market Crash' },

	// Peoples, beasts and monsters, by name.
	{ name: /Guard|Grunt|Watcher|Sentinel|Bluffwatcher|Deathguard|Mountaineer|Guardian|Protector|Defender|Peacekeeper|Militia/, names: ['Above the Law', 'Guard Crush', 'Resisting Arrest', 'Police Brutality'], pileUp: 'Riot!' },
	{ name: /Murloc|Mrgl|Mudsnout|Tidehunter|Flesheater|Coastrunner/, names: ['Mrrglglglgl!', 'Fish Fry', 'Fish Out of Water'], pileUp: 'Murloc Massacre' },
	{ name: /Kobold/, names: ['You No Take Candle!', 'Lights Out', 'Snuffed Out'], pileUp: 'Candle Clearance' },
	{ name: /Defias/, names: ['Red Bandana Rumble', 'Brotherhood Busted', 'Westfall Wipe'], pileUp: 'Gang War' },
	{ name: /Gnoll|Riverpaw|Mosshide|Redridge|Blackrock Gnoll/, names: ['Gnoll Bowling', 'Hyena Hiccup'], pileUp: 'Gnoll Pack Pile-Up' },
	{ name: /Gnome|Gnomish|Tinker/, names: ['Gnome Punt', 'Field Goal!', 'Short Drop'], pileUp: 'Gnome Toss Tournament' },
	{ name: /Goblin|Venture Co/, names: ['Time Is Money, Friend', 'Bankrupt', 'Hostile Takeover'], pileUp: 'Market Correction' },
	{ name: /Peasant|Peon|Laborer|Worker|Farmhand/, names: ['Work Complete!', 'Zug Zug, Down', 'Union Busted'], pileUp: 'Labour Dispute' },
	{ name: /Troll|Darkspear|Witherbark|Mossflayer|Skullsplitter|Bloodscalp|Sandfury|Shadowpine|Vilebranch/, names: ['Troll Toll', 'Stay Away From Da Voodoo'], pileUp: 'Troll Pile' },
	{ name: /Ogre|Mo'grosh|Boulderfist|Gordunni|Dunemaul/, names: ['Ogre and Out', 'Me Not That Smart', 'Two Heads, No Brain'], pileUp: 'Ogre Avalanche' },
	{ name: /Harpy|Windfury|Bloodfeather|Witchwing|Screecher/, names: ['Feather Duster', 'Plucked'], pileUp: 'Pillow Fight' },
	{ name: /Centaur|Kolkar|Galak|Magram|Gelkis/, names: ['Hoofed It', 'Off Your High Horse'], pileUp: 'Stampede' },
	{ name: /Naga|Slitherblade|Spitelash/, names: ['Scale Tipping', 'Tail Spin'], pileUp: 'Naga Knot' },
	{ name: /Satyr/, names: ['Horned In', 'Hoof It'], pileUp: 'Satyr Satire' },
	{ name: /Furbolg|Timbermaw|Deadwood|Foulweald|Thistlefur/, names: ['Furball', 'Bear-ly Standing'], pileUp: 'Fur Flies' },
	{ name: /Quilboar|Razormane|Bristleback|Razorfen/, names: ['Quill Kill', 'Hogtied'], pileUp: 'Pig Pile' },
	{ name: /Trogg|Stonesplinter|Rockjaw/, names: ['Trogg Toss', 'Rock Bottom'], pileUp: 'Trogg Rockslide' },
	{ name: /Scarlet|Crusader|Crimson/, names: ['Crusade Over', 'Zealot Zapped', 'Scarlet Fever'], pileUp: 'Crusade Collapse' },
	{ name: /Cultist|Cult of|Twilight|Shadowforge|Dark Iron/, names: ['Cult Classic', 'Ritual Interrupted'], pileUp: 'Mass Exodus' },
	{ name: /Pirate|Bloodsail|Buccaneer|Swashbuckler|Sea Dog/, names: ['Walk the Plank', 'Keelhauled', 'Yarrr!'], pileUp: 'Mutiny' },
	{ name: /Skeleton|Skeletal|Bone/, names: ['Bone Breaker', 'Rattled', 'Funny Bone'], pileUp: 'Boneyard' },
	{ name: /Ghoul|Zombie|Rotting|Plague|Rot Hide|Scourge/, names: ['Double Tap', 'Back to the Grave', 'Rot Stop'], pileUp: 'Zombie Apocalypse' },
	{ name: /Ghost|Spirit|Spectral|Phantom|Banshee|Wraith|Apparition/, names: ['Ghost Busted', 'Exorcised', 'Boo!'], pileUp: 'Ghost Town' },
	{ name: /Spider|Recluse|Widow|Tarantula|Webwood|Venom Web/, names: ['Squashed', 'Itsy Bitsy', 'Web Exit'], pileUp: 'Nest Wrecked' },
	{ name: /Wolf|Worg|Coyote|Jackal|Hyena|Dire Mottled/, names: ['Big Bad Wolf Down', 'Howl No More', 'Muzzled'], pileUp: 'Pack Wipe' },
	{ name: /Boar|Swine|Pig|Hog/, names: ['Pork Chop!', 'Bacon!', 'Boar-ed to Death'], pileUp: 'Pig Pile' },
	{ name: /Bear|Grizzl/, names: ['Bear Hug', 'Grin and Bear It', 'Hibernation'], pileUp: 'Bear Market' },
	{ name: /Raptor|Thrasher|Ravasaur/, names: ['Clever Girl', 'Extinct Again'], pileUp: 'Jurassic Pile-Up' },
	{ name: /Cat|Panther|Tiger|Lion|Cougar|Lynx|Prowler|Shadowmaw|Nightsaber|Saber/, names: ['Nine Lives Down', 'Cat Nap', 'Hairball'], pileUp: 'Cat Fight' },
	{ name: /Crocolisk|Basilisk|Lizard|Scorpid|Crab|Turtle|Makrura|Clacker/, names: ['Shell Shock', 'Scale Model', 'Cracked'], pileUp: 'Reptile House' },
	{ name: /Bat|Vulture|Owl|Hawk|Buzzard|Carrion Bird|Condor|Wind Serpent|Parrot|Strider/, names: ['Grounded', 'Bird Strike', 'Feathers Everywhere'], pileUp: 'Flock Off' },
	{ name: /Gorilla|Ape|Silverback/, names: ['Bananas!', 'Going Ape'], pileUp: 'Barrel of Monkeys' },
	{ name: /Chicken|Hen|Rooster|Chick/, names: ['Chicken Dinner!', 'Bawk Bawk'], pileUp: 'Coop d’État' },
	{ name: /Cow|Sheep|Deer|Stag|Rabbit|Hare|Squirrel|Prairie Dog|Frog|Toad|Fawn|Ram|Goat|Kodo|Gazelle|Elk|Moose|Dog/, names: ['Oh Deer', 'Bunny Bowling', 'Wildlife Hazard', 'Animal Cruelty?!'], pileUp: 'Petting Zoo Panic' },
	{ name: /Rat|Roach|Snake|Maggot|Beetle|Larva|Worm|Adder|Scarab/, names: ['Pest Control', 'Squish', 'Exterminated'], pileUp: 'Infestation Cleared' },
	{ name: /Golem|Construct|Shredder|Harvest Golem|Bot|Mech/, names: ['Scrap Metal', 'Factory Reset'], pileUp: 'Scrapyard' },
	{ name: /Dragon|Drake|Whelp|Wyrm|Dragonkin/, names: ['Dragon Slayer', 'Whelp, That Happened'], pileUp: 'Many Whelps! Handle It!' },

	// Creature types, for the rest.
	{ kind: 'Beast', names: ['Roadkill', 'Animal Control', 'Wild Ride'], pileUp: 'Stampede' },
	{ kind: 'Critter', names: ['Pest Control', 'Speed Bump', 'Squish'], pileUp: 'Critter Carnage' },
	{ kind: 'Undead', names: ['Back to the Grave', 'Dead Again', 'Rest in Pieces'], pileUp: 'Mass Grave' },
	{ kind: 'Demon', names: ['Exorcism', 'Banished', 'Return to Sender'], pileUp: 'Hell Breaks Loose' },
	{ kind: 'Elemental', names: ['Grounded Out', 'Elemental Shift', 'Earthquake'], pileUp: 'Natural Disaster' },
	{ kind: 'Dragonkin', names: ['Dragon Slayer', 'Scales Tipped'], pileUp: 'Dragon Pile' },
	{ kind: 'Giant', names: ['The Bigger They Are...', 'Giant Slayer', 'Timber!'], pileUp: 'Landslide' },
	{ kind: 'Mechanical', names: ['Scrap Metal', 'Factory Reset', 'Blue Screen'], pileUp: 'Scrapyard' },
	{ kind: 'Totem', names: ['Totem Toppler', 'Drop Totem'], pileUp: 'Totem Bowling' },
	{ kind: 'Humanoid', names: ['Clothesline', 'Shunt', 'Slam', 'Knockout', 'Pile Driver', 'Smackdown', 'Wipeout'], pileUp: 'Crowd Surfer' },
];

/** For anything nothing else names. */
const FALLBACK: Rule = { names: ['Takedown', 'Slam', 'Shunt', 'Knockout'], pileUp: 'Pile-Up' };

/** Better creatures are worth more: points multipliers by rank. */
const RANK_POINTS: Record<string, number> = { 'Elite': 2, 'Rare': 2, 'Rare Elite': 3, 'Boss': 5 };

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function ruleFor(info: SpawnInfo | null): Rule {
	if (!info) return FALLBACK;
	return RULES.find((r) => (r.name ? r.name.test(info.name) : true) && (r.subname ? !!info.subname && r.subname.test(info.subname) : true) && (r.kind ? r.kind === info.kind : true) && (r.name || r.subname || r.kind)) ?? FALLBACK;
}

/** A takedown named: its parts (one for each kind of victim, the rarest-ranked first), and what its points are multiplied by. */
export interface NamedTakedown {
	names: string[];
	points: number;
}

/**
 * Names a takedown from those it knocked down, for a side (alliance or horde): each kind of
 * victim gives a name (several of one kind at once, its pile-up); taking down a boss, rare or
 * elite adds to the name and the points; and the side's own friends make it friendly fire.
 */
export function nameTakedown(victims: (SpawnInfo | null)[], side: 'alliance' | 'horde'): NamedTakedown {
	const groups = new Map<Rule, (SpawnInfo | null)[]>();
	for (const v of victims) {
		const rule = ruleFor(v);
		groups.set(rule, [...(groups.get(rule) ?? []), v]);
	}
	const best = (list: (SpawnInfo | null)[]) => Math.max(1, ...list.map((v) => RANK_POINTS[v?.rank ?? ''] ?? 1));
	const names = [...groups].sort((a, b) => best(b[1]) - best(a[1])).map(([rule, list]) => (list.length >= 3 && rule.pileUp ? rule.pileUp : pick(rule.names)));
	const ranks = new Set(victims.map((v) => v?.rank));
	if (ranks.has('Boss')) names.unshift('Boss Down!');
	else if (ranks.has('Rare') || ranks.has('Rare Elite')) names.unshift('Rare Find!');
	else if (ranks.has('Elite')) names.unshift('Elite');
	if (victims.some((v) => v?.reaction?.[side] === 'friendly')) names.push('Friendly Fire!');
	const points = victims.reduce((sum, v) => sum + (RANK_POINTS[v?.rank ?? ''] ?? 1), 0) / Math.max(1, victims.length);
	return { names, points };
}
