// Builds public/spawns/models.json: the map models (M2 props and WMO buildings) the install has,
// named and sorted into palette categories by their paths in the community listfile.
// Usage: npm run models -- [wowDir] [product]
// Needs .cache/listfile.csv (https://github.com/wowdev/wow-listfile).
import { readFileSync, writeFileSync } from 'node:fs';
import { CascStorage } from '../src/casc/storage';
import { NodeSource } from './nodeSource';

const [wowDir = 'C:/Program Files (x86)/World of Warcraft', product = 'wow_classic_beta'] = process.argv.slice(2);
const LISTFILE = '.cache/listfile.csv';
const OUT = 'public/spawns/models.json';

/**
 * Palette groups, tried in order against a model's path (lower case): the first that matches
 * wins. Each belongs to a category (the palette's tabs).
 */
const GROUPS: [category: string, group: string, test: RegExp][] = [
	['effects', 'Effects', /\/(fx|particles?|particleemitters|spells?)\/|_fx_|fx_|glow|lightshaft|light_?beam|lightray|godray|smoke|steam|portal|aura|emitter/],
	['props', 'Holidays', /christmas|xmas|winterveil|valentine|lunarnewyear|summerfest|midsummer|carnival|halloween|hallow|brewfest|easter|noblegarden|darkmoon|tugofwar|pilgrim|dayofthedead/],
	['nature', 'Herbs and ore', /tradeskillnodes|\/(herbs?|ore|mining)\//],
	['nature', 'Ground cover', /\/detail\/|groundcover|grasstuft/],
	['nature', 'Trees', /(?<!s)trees?\b|(?<!s)tree[_\d]|(?<!s)tree(?=s?\/)|palm|pine|oak|willow|canopy|sapling/],
	['nature', 'Mushrooms', /mushroom|shroom|fungus|toadstool/],
	['nature', 'Crystals', /crystal/],
	['nature', 'Water and coral', /coral|seaweed|kelp|waterfall|lilypad|anemone|seashell|shell_|starfish/],
	['nature', 'Logs and stumps', /\blogs?\b|log[_\d]|stump|branch|driftwood|deadwood|fallentree|roots/],
	['nature', 'Rocks', /rock|boulder|cliff|crag|pebble|stalag|geyser|lavarock|volcanic/],
	['nature', 'Bushes and plants', /bush|shrub|plant|flower|fern|vine|weed|grass|reed|ivy|hedge|cactus|lily|leaf|leaves|thorn|bramble|bamboo|cattail|clover|wheat|corn|pumpkinpatch|crop/],
	['props', 'Lights and fire', /lamp|lantern|torch|brazier|candle|chandelier|campfire|bonfire|firepit|fireplace|sconce|streetlight|light\d|lights?\//],
	['props', 'Containers', /barrel|crate|\bbox|box[_\d]|chest|sack|basket|keg|bucket|\bjar|jar[_\d]|\bpot\b|pot[_\d]|urn|vase|bottle|cask|trunk|coffer/],
	['props', 'Furniture', /chair|table|\bbed|bed[_\d]|bench|stool|shelf|shelves|bookcase|cabinet|desk|dresser|wardrobe|throne|counter|rug|carpet|curtain|pillow|cushion|furniture/],
	['props', 'Food and kitchen', /food|bread|meat|\bfish|cheese|fruit|apple|pumpkin|cauldron|kitchen|plate|\bmug|tankard|\bcup|bowl|oven|stove|ham\b|sausage|pie\b/],
	['props', 'Signs and banners', /sign|banner|flag|tapestry|poster|plaque|standard|pennant|heraldry/],
	['props', 'Remains and graves', /bone|skull|skeleton|corpse|carcass|ribcage|grave|tomb|coffin|headstone|gravestone|crypt|mumm(y|ies)|hanging(body|head)|hearse/],
	['props', 'Books and papers', /\bbooks?|book[_\d]|scroll|paper|letter|\bmaps?\b|parchment|tome/],
	['props', 'Weapons and armour', /weapon|sword|\baxe|shield|armou?r|\bbows?\b|spear|cannon|catapult|ballista|siege|arrow|helm/],
	['props', 'Tools and crafting', /anvil|forge|\btools?\b|hammer|\bsaw\b|workbench|loom|spinningwheel|grinder|bellows|smith|mill|press|shovel|pickaxe|\bcoal|metalbar|ingot|tailoring/],
	['props', 'Camps and tents', /tent|\bhut\b|camp|tepee|teepee|bedroll|yurt|lean-?to/],
	['props', 'Statues', /statue|monument|totem|idol|gargoyle|obelisk|bust\b/],
	['props', 'Vehicles and ships', /cart|wagon|boat|ship|zeppelin|carriage|wheelbarrow|gyrocopter|tram|canoe|raft/],
	['props', 'Ruins and rubble', /ruin|rubble|debris|wreck|collapsed|battlement|excavation|broken/],
	['props', 'Decorations', /painting|artwork|clothing|cloth|shirt|kite|\btoys?\b|toy[_\d]|wreath|drape|mask|trophy|ornament|garland|bead|chime/],
	['props', 'Fences, walls and doors', /fence|wall|gate|rail|palisade|barricade|door|pillar|column|\barch|bridge|stair|ramp|post\b|plank|scaffold|ladder|dock|pier/],
	['props', 'Machines', /machine|\bgears?\b|engine|pipe|cog|mechan|gnomish|goblin.*(device|contraption)/],
];

/** Building regions: world/wmo/<region>/..., with a readable name; the first five are vanilla's. */
const REGIONS: Record<string, string> = {
	azeroth: 'Eastern Kingdoms', kalimdor: 'Kalimdor', lorderon: 'Lordaeron', khazmodan: 'Khaz Modan', dungeon: 'Dungeons',
	pvp: 'Battlegrounds', transports: 'Transports', outland: 'Outland', northrend: 'Northrend', cataclysm: 'Cataclysm',
	pandaria: 'Pandaria', draenor: 'Draenor', brokenisles: 'Broken Isles', kultiras: 'Kul Tiras', zuldazar: 'Zuldazar',
};
const CLASSIC_REGIONS = new Set(['azeroth', 'kalimdor', 'lorderon', 'khazmodan', 'dungeon', 'pvp', 'transports']);
/** Paths of vanilla's models (later races and expansions excepted, as far as their folders say). */
const CLASSIC = /^world\/(generic|azeroth|kalimdor|khazmodan|lordaeron|lorderon|skillactivated|nodxt|critter|environment|kalimdor)\//;
const LATER = /pandaren|draenei|bloodelf|worgen|mogu|mantid|arakkoa|ironhorde|nightborne?|vrykul|legion|titan|zandalari|kultiras|drust|vulpera|mechagnome|lightforged|eredar|argus|saberon|ogre_?mage|tuskarr|naga_?(?!.*classic)|draenor|northrend|outland|cataclysm/;

const storage = await CascStorage.open(new NodeSource(wowDir), product);
const dirs: string[] = [];
const dirIndex = new Map<string, number>();
const groups: { category: string; name: string }[] = [];
const groupIndex = new Map<string, number>();
const models: [number, number, string, number, number][] = [];

for (const line of readFileSync(LISTFILE, 'utf8').split('\n')) {
	const [id, rawPath] = line.trim().split(';');
	const path = rawPath?.toLowerCase();
	// Whole models only: not a WMO's group files or level-of-detail copies.
	if (!path || !/^world\/.*\.(m2|wmo)$/.test(path) || /_\d{3}\.wmo$|_lod\d/.test(path)) continue;
	const fdid = Number(id);
	if (storage.status(fdid) !== 'ok') continue;
	const slash = path.lastIndexOf('/');
	const dir = path.slice(6, slash); // without world/
	const file = rawPath.slice(slash + 1, rawPath.lastIndexOf('.'));
	let category: string;
	let group: string;
	let classic: boolean;
	if (path.endsWith('.wmo')) {
		const region = path.split('/')[2];
		category = 'buildings';
		group = REGIONS[region] ?? 'Other buildings';
		classic = CLASSIC_REGIONS.has(region) && !LATER.test(path);
	} else {
		const match = GROUPS.find(([, , test]) => test.test(path));
		[category, group] = match ? [match[0], match[1]] : ['props', 'Other'];
		classic = CLASSIC.test(path) && !LATER.test(path);
	}
	const gKey = `${category}:${group}`;
	if (!groupIndex.has(gKey)) {
		groupIndex.set(gKey, groups.length);
		groups.push({ category, name: group });
	}
	if (!dirIndex.has(dir)) {
		dirIndex.set(dir, dirs.length);
		dirs.push(dir);
	}
	models.push([fdid, dirIndex.get(dir)!, file, groupIndex.get(gKey)!, classic ? 1 : 0]);
}

writeFileSync(OUT, JSON.stringify({ source: 'Paths from the community listfile (wowdev/wow-listfile)', groups, dirs, models }));
const byCategory = new Map<string, number>();
for (const m of models) {
	const c = groups[m[3]].category;
	byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
}
console.log(OUT, models.length, 'models,', models.filter((m) => m[4]).length, 'classic;', Object.fromEntries(byCategory));
for (const g of groups) console.log(`  ${g.category} / ${g.name}: ${models.filter((m) => groups[m[3]] === g).length} (${models.filter((m) => groups[m[3]] === g && m[4]).length} classic)`);
process.exit(0);
