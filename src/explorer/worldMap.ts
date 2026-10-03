import type { CascStorage } from '../casc/storage';
import { DB2_FILES, loadTable } from './clientDb';

/** Client tables for the world map's art (unnamed in the root). */
const UI_MAP_ART = 1957202;
const UI_MAP_ART_STYLE_LAYER = 1957208;
const UI_MAP_ART_TILE = 1957210;
const UI_MAP_X_MAP_ART = 1957217;
const WORLD_MAP_OVERLAY = 1134579;
const WORLD_MAP_OVERLAY_TILE = 1957212;

/** UiMap fields: 0 name, 2 parent map, 5 type (1 world, 2 continent, 3 zone). */
const UI_MAP_NAME = 0;
const UI_MAP_PARENT = 2;
const UI_MAP_TYPE = 5;
/** UiMapAssignment fields: 0 UI min [u, v], 1 UI max, 2 region [min x, y, z, max x, y, z], 4 UiMap, 6 map, 7 area. */
const ASSIGN_UI_MIN = 0;
const ASSIGN_UI_MAX = 1;
const ASSIGN_REGION = 2;
const ASSIGN_UI_MAP = 4;
const ASSIGN_MAP = 6;
const ASSIGN_AREA = 7;
/** UiMapArt field 2: its style; UiMapArtStyleLayer (child of the style): 0 layer, 1/2 layer size, 3/4 tile size. */
const ART_STYLE = 2;
/** UiMapArtTile and WorldMapOverlayTile (children of their art / overlay): 0 row, 1 column, 2 layer, 3 file. */
const TILE_ROW = 0;
const TILE_COL = 1;
const TILE_LAYER = 2;
const TILE_FILE = 3;
/** WorldMapOverlay (child of its art): 2/3 size, 4/5 offset, 12 the areas that reveal it [4]. */
const OVERLAY_WIDTH = 2;
const OVERLAY_HEIGHT = 3;
const OVERLAY_X = 4;
const OVERLAY_Y = 5;
const OVERLAY_AREAS = 12;
/** Overlay pieces are cut into tiles this big. */
const OVERLAY_TILE = 256;

export interface MapTile {
	row: number;
	col: number;
	fdid: number;
}

/** A piece of a zone's map that's filled in once one of its areas has been explored. */
export interface MapOverlay {
	areas: number[];
	x: number;
	y: number;
	width: number;
	height: number;
	tiles: MapTile[];
	tileSize: number;
}

/** Where a stretch of a map's world lies on its picture: WoW x/y in region maps to u/v (0-1) in ui. */
export interface MapAssignment {
	mapId: number;
	area: number;
	/** WoW coordinates: [min x, min y], [max x, max y]. */
	min: [number, number];
	max: [number, number];
	uiMin: [number, number];
	uiMax: [number, number];
}

export interface WorldMapInfo {
	id: number;
	name: string;
	parent: number;
	/** 1 world, 2 continent, 3 zone. */
	type: number;
	width: number;
	height: number;
	tileWidth: number;
	tileHeight: number;
	tiles: MapTile[];
	overlays: MapOverlay[];
	assignments: MapAssignment[];
}

/**
 * The world map's continents and zones (UiMap) on the continents: their pictures (UiMapArt
 * tiles, the bottom layer), the pieces revealed by exploring (WorldMapOverlay) and where the
 * world lies on them (UiMapAssignment).
 */
export async function loadWorldMaps(storage: CascStorage, mapIds: number[]): Promise<WorldMapInfo[]> {
	const [uiMaps, assignments, xArt, arts, styles, artTiles, overlays, overlayTiles] = await Promise.all([
		loadTable(storage, DB2_FILES.UiMap),
		loadTable(storage, DB2_FILES.UiMapAssignment),
		loadTable(storage, UI_MAP_X_MAP_ART),
		loadTable(storage, UI_MAP_ART),
		loadTable(storage, UI_MAP_ART_STYLE_LAYER),
		loadTable(storage, UI_MAP_ART_TILE),
		loadTable(storage, WORLD_MAP_OVERLAY),
		loadTable(storage, WORLD_MAP_OVERLAY_TILE),
	]);
	const wanted = new Set(mapIds);
	const byMap = new Map<number, MapAssignment[]>();
	for (const id of assignments.ids()) {
		const mapId = assignments.getInt(id, ASSIGN_MAP) ?? -1;
		if (!wanted.has(mapId)) continue;
		const uiMap = assignments.getInt(id, ASSIGN_UI_MAP) ?? 0;
		const f = (field: number, i: number) => assignments.getFloat(id, field, i) ?? 0;
		const list = byMap.get(uiMap) ?? [];
		list.push({
			mapId,
			area: assignments.getInt(id, ASSIGN_AREA) ?? 0,
			min: [f(ASSIGN_REGION, 0), f(ASSIGN_REGION, 1)],
			max: [f(ASSIGN_REGION, 3), f(ASSIGN_REGION, 4)],
			uiMin: [f(ASSIGN_UI_MIN, 0), f(ASSIGN_UI_MIN, 1)],
			uiMax: [f(ASSIGN_UI_MAX, 0), f(ASSIGN_UI_MAX, 1)],
		});
		byMap.set(uiMap, list);
	}
	// Children of each art, style and overlay, by their parent ID.
	const group = (table: typeof artTiles) => {
		const out = new Map<number, number[]>();
		for (const id of table.ids()) {
			const parent = table.getParent(id);
			if (parent === null) continue;
			const list = out.get(parent) ?? [];
			list.push(id);
			out.set(parent, list);
		}
		return out;
	};
	const artOf = new Map<number, number>();
	for (const id of xArt.ids()) {
		const uiMap = xArt.getParent(id);
		if (uiMap !== null && !artOf.has(uiMap)) artOf.set(uiMap, xArt.getInt(id, 1) ?? 0);
	}
	const styleLayers = group(styles);
	const tilesOfArt = group(artTiles);
	const overlaysOfArt = group(overlays);
	const tilesOfOverlay = group(overlayTiles);
	const tilesOf = (table: typeof artTiles, ids: number[] | undefined): MapTile[] => (ids ?? [])
		.filter((t) => (table.getInt(t, TILE_LAYER) ?? 0) === 0)
		.map((t) => ({ row: table.getInt(t, TILE_ROW) ?? 0, col: table.getInt(t, TILE_COL) ?? 0, fdid: table.getInt(t, TILE_FILE) ?? 0 }))
		.filter((t) => t.fdid && storage.status(t.fdid) === 'ok');

	const out: WorldMapInfo[] = [];
	for (const [id, list] of byMap) {
		const name = uiMaps.getString(id, UI_MAP_NAME);
		const type = uiMaps.getInt(id, UI_MAP_TYPE) ?? 0;
		const art = artOf.get(id);
		if (!name || !art || type < 1 || type > 3) continue;
		const style = arts.getInt(art, ART_STYLE) ?? 0;
		const layer = (styleLayers.get(style) ?? []).find((l) => (styles.getInt(l, 0) ?? 0) === 0);
		if (layer === undefined) continue;
		const tiles = tilesOf(artTiles, tilesOfArt.get(art));
		if (!tiles.length) continue;
		out.push({
			id,
			name,
			parent: uiMaps.getInt(id, UI_MAP_PARENT) ?? 0,
			type,
			width: styles.getInt(layer, 1) ?? 1002,
			height: styles.getInt(layer, 2) ?? 668,
			tileWidth: styles.getInt(layer, 3) ?? 256,
			tileHeight: styles.getInt(layer, 4) ?? 256,
			tiles,
			overlays: (overlaysOfArt.get(art) ?? []).map((o) => ({
				areas: [0, 1, 2, 3].map((i) => overlays.getInt(o, OVERLAY_AREAS, i) ?? 0).filter((a) => a),
				x: overlays.getInt(o, OVERLAY_X) ?? 0,
				y: overlays.getInt(o, OVERLAY_Y) ?? 0,
				width: overlays.getInt(o, OVERLAY_WIDTH) ?? 0,
				height: overlays.getInt(o, OVERLAY_HEIGHT) ?? 0,
				tiles: tilesOf(overlayTiles, tilesOfOverlay.get(o)),
				tileSize: OVERLAY_TILE,
			})).filter((o) => o.tiles.length && o.areas.length),
			assignments: list,
		});
	}
	return out;
}
