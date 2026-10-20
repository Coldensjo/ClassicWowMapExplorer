/**
 * Terrain textures to start from (spec 3.2): tileset textures sampled from the Forever beta's own
 * zones. New blank scenes pick a base from these, and the paint tool offers them until the Phase 2
 * asset browser lets any tileset texture be picked.
 */
export const BASE_TEXTURES = [
	{ name: 'Grass (Elwynn Forest)', fdid: 187138 },
	{ name: 'Forest floor (Elwynn Forest)', fdid: 187127 },
	{ name: 'Grass (Westfall)', fdid: 188990 },
	{ name: 'Snow (Dun Morogh)', fdid: 188576 },
	{ name: 'Dirt (Durotar)', fdid: 187018 },
	{ name: 'Savanna (the Barrens)', fdid: 186901 },
	{ name: 'Jungle grass (Stranglethorn)', fdid: 188824 },
	{ name: 'Sand (the coast)', fdid: 189020 },
];

/** A texture's label where one is known; the asset browser (spec 7.3) brings real names. */
export function textureName(fdid: number): string {
	return BASE_TEXTURES.find((t) => t.fdid === fdid)?.name ?? `Texture ${fdid}`;
}
