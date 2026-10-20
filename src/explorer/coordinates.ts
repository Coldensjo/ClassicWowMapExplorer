import { TILE_SIZE } from '../formats/adt';
import { compose, identity, scaling, translation, type Mat4 } from './mat4';

/** WoW world coordinates are measured from the centre of the 64x64 tile grid. */
export const MAP_ORIGIN = 32 * TILE_SIZE;

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

/** A model placed at WoW world coordinates (x north, y west, z up), turned by a rotation about its own axes. */
export function worldMatrix(x: number, y: number, z: number, rotation: Mat4, scale: number): Mat4 {
	return compose(translation(MAP_ORIGIN - y, z, MAP_ORIGIN - x), WORLD_BASIS, rotation, scaling(scale));
}

/** The ADT tile WoW world coordinates fall on. */
export const tileOf = (x: number, y: number) => ({ tx: Math.floor(32 - y / TILE_SIZE), ty: Math.floor(32 - x / TILE_SIZE) });
