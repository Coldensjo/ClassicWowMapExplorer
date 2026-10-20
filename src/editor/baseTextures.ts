/**
 * Terrain textures to start from (spec 3.2): tileset textures sampled from the Forever beta's own
 * zones. New blank scenes pick a base from these, and the paint tool offers them until the Phase 2
 * asset browser lets any tileset texture be picked.
 */
export const BASE_TEXTURES = [
	{ name: 'Grass (Elwynn Forest)', fdid: 187126 }, // tileset/elwynn/elwynngrassbase
	{ name: 'Dirt (Elwynn Forest)', fdid: 187113 }, // tileset/elwynn/elwynndirtbase
	{ name: 'Grass (Westfall)', fdid: 188991 }, // tileset/westwood/westfallgrassbase
	{ name: 'Snow (Dun Morogh)', fdid: 188575 }, // tileset/ironforge/ironforgesnow03ripple
	{ name: 'Dirt (Durotar)', fdid: 187017 }, // tileset/durotar/durotardirt
	{ name: 'Savanna (the Barrens)', fdid: 186899 }, // tileset/barrens/barrensbasedirt
	{ name: 'Jungle grass (Stranglethorn)', fdid: 188821 }, // tileset/stranglethorn/stranglethorngrass
	{ name: 'Sand (the coast)', fdid: 189003 }, // tileset/westwood/westfallsandbase
];

/** A texture's label where one is known; the asset browser (spec 7.3) brings real names. */
export function textureName(fdid: number): string {
	return BASE_TEXTURES.find((t) => t.fdid === fdid)?.name ?? `Texture ${fdid}`;
}
