import * as THREE from 'three';
import { CHUNK_SIZE, TILE_SIZE } from '../formats/adt';
import type { Side } from './nameplates';
import { GRID, worldFromWow, type AreaInfo, type RegionData } from './regionData';
import type { ContinentPlacement } from './terrain';
import { behindCamera } from './screen';

/**
 * What the ground is tinted by: the graveyard dying there sends you to, whose territory it is,
 * how its creatures' levels compare to yours, its subzones (with their exploration XP), or the
 * fishing skill its waters are rated at.
 */
export type TintMode = 'graveyards' | 'territory' | 'levels' | 'subzones' | 'fishing';

interface Graveyard {
	name: string;
	mapId: number;
	/** Where it is in the world. */
	position: THREE.Vector3;
	/** Its colour, unlike its neighbours' for either side (see colourGraph). */
	color: THREE.Color;
	css: string;
}

/** game_graveyard_zone faction IDs. */
const FACTION: Record<Side, number> = { alliance: 469, horde: 67 };
/** Graveyards a zone can send to, at most (the most any zone has for one side is 8). */
const PER_ZONE = 8;
/** Width of the data texture: a row of graveyard positions, one of their colours, then three texels per area. */
const DATA_WIDTH = 128;
/** Yards; spirit healers and area names show within this distance. */
const RANGE = 3000;
const AREA_RANGE = 2200;
const LABELLED = 6;
const AREA_LABELS = 30;
/** Yards above the ground from which only zones are named, not their subzones. */
const ZONES_ONLY_ALTITUDE = 1200;
/** Yards above the point to put a marker. */
const LIFT = 3;
/** Colours handed out so that neighbours never share one (graveyards, subzones). */
const PALETTE = [0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0x469990, 0x9a6324, 0xdcbeff];
/** area_template.flags */
const FLAG_ARENA = 0x80;
/** The game's own colours: territory as the PvP status names it, creature levels as their names are coloured. */
const TERRITORY = { friendly: 0x19ff19, hostile: 0xff2020, contested: 0xffd200, arena: 0xff8000 };
const CON = { grey: 0x9d9d9d, green: 0x40c040, yellow: 0xffff00, orange: 0xff8040, red: 0xff2020 };
/** Fishing skill from easiest to hardest water, and its colours. */
const FISHING_STOPS: [number, number][] = [[-70, 0x40c040], [55, 0xd0e040], [130, 0xffb020], [205, 0xff5020], [330, 0xb040ff]];

/** Lines a key in the panel: a colour and what it means. */
export type TintKey = [string, string][];

const emptyGrid = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedIntegerFormat, THREE.UnsignedShortType);
emptyGrid.internalFormat = 'R16UI';
emptyGrid.needsUpdate = true;
const emptyData = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
emptyData.needsUpdate = true;

/** Shared by every terrain material (see applyRegions). */
const regionUniforms = {
	/** 0 off, 1 graveyards, 2 a colour per area. */
	uRegionMode: { value: 0 },
	/** Area index per map chunk: each continent's 1024 rows, one under the other. */
	uRegionGrid: { value: emptyGrid as THREE.Texture },
	/** See DATA_WIDTH. Per area: its colour (alpha: which areas are drawn alike, 0 untinted), then its graveyards. */
	uRegionData: { value: emptyData as THREE.Texture },
	/** Per continent: world x and z of its chunk grid's corner, and 1 if it has one. */
	uRegionGrids: { value: [new THREE.Vector4(), new THREE.Vector4()] },
};

// Graveyards: the nearest of the zone's for the side shown, in 3D as the server measures, with a
// dark line where two meet. Areas: each its colour, lined where it meets ground drawn otherwise.
const REGION_GLSL = /* glsl */ `
uniform int uRegionMode;
uniform highp usampler2D uRegionGrid;
uniform highp sampler2D uRegionData;
uniform vec4 uRegionGrids[2];
vec4 regionData(int i) {
	return texelFetch(uRegionData, ivec2(i % ${DATA_WIDTH}, i / ${DATA_WIDTH}), 0);
}
int regionAreaAt(ivec2 cell, int m) {
	if (cell.x < 0 || cell.y < 0 || cell.x >= ${GRID} || cell.y >= ${GRID}) return 0;
	return int(texelFetch(uRegionGrid, ivec2(cell.x, cell.y + m * ${GRID}), 0).r);
}
int regionBase(int area) {
	return ${DATA_WIDTH * 2} + (area - 1) * 3;
}
vec3 regionTint(vec3 color, vec3 world) {
	int area = 0, m = 0;
	vec2 c = vec2(0.0);
	for (int k = 0; k < 2; k++) {
		if (uRegionGrids[k].w < 0.5) continue;
		c = (world.xz - uRegionGrids[k].xy) / ${CHUNK_SIZE.toFixed(6)};
		// The continents' grids overlap (their seas do), so only a chunk with an area counts.
		area = regionAreaAt(ivec2(floor(c)), k);
		m = k;
		if (area > 0) break;
	}
	if (area == 0) return color;
	float light = dot(color, vec3(0.299, 0.587, 0.114));
	int base = regionBase(area);
	if (uRegionMode == 1) {
		float best = 1e9, second = 1e9;
		vec3 hue = vec3(0.0);
		for (int j = 0; j < ${PER_ZONE}; j++) {
			int g = int(regionData(base + 1 + j / 4)[j % 4] + 0.5);
			if (g == 0) break;
			vec4 p = regionData(g - 1);
			float d = distance(world, p.xyz);
			if (d < best) {
				second = best;
				best = d;
				hue = regionData(${DATA_WIDTH} + g - 1).rgb;
			} else if (d < second) {
				second = d;
			}
		}
		if (best > 1e8) return color;
		vec3 tinted = mix(color, hue * (0.35 + 0.9 * light), 0.6);
		// Where the two nearest are equally far: the line between their grounds.
		float gap = second - best;
		tinted *= 1.0 - 0.75 * (1.0 - smoothstep(0.0, max(fwidth(gap) * 1.5, 0.3), gap));
		// A bright ring around the graveyard itself.
		return mix(tinted, hue, (1.0 - smoothstep(0.0, max(fwidth(best) * 1.5, 0.5), abs(best - 12.0))) * 0.8);
	}
	vec4 own = regionData(base);
	if (own.a == 0.0) return color;
	vec3 tinted = mix(color, own.rgb * (0.35 + 0.9 * light), 0.6);
	// A dark line along chunk edges where the neighbour is drawn otherwise.
	ivec2 cell = ivec2(floor(c));
	vec2 f = (c - floor(c)) * ${CHUNK_SIZE.toFixed(6)};
	float width = max(fwidth(world.x) * 1.5, 0.4);
	float line = 0.0;
	ivec2 dirs[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));
	float edges[4] = float[4](f.x, ${CHUNK_SIZE.toFixed(6)} - f.x, f.y, ${CHUNK_SIZE.toFixed(6)} - f.y);
	for (int k = 0; k < 4; k++) {
		if (edges[k] > width) continue;
		int n = regionAreaAt(cell + dirs[k], m);
		float group = n > 0 ? regionData(regionBase(n)).a : 0.0;
		if (group != own.a) line = max(line, 1.0 - edges[k] / width);
	}
	return tinted * (1.0 - 0.7 * line);
}
`;

/** Lets a terrain material show the region tint. vWorldXZ/vWorldY come from the terrain shader. */
export function applyRegions(shader: THREE.WebGLProgramParametersWithUniforms): void {
	Object.assign(shader.uniforms, regionUniforms);
	shader.fragmentShader = shader.fragmentShader
		.replace('#include <common>', `#include <common>\n${REGION_GLSL}`)
		.replace('#include <opaque_fragment>', 'if (uRegionMode > 0) outgoingLight = regionTint(outgoingLight, vec3(vWorldXZ.x, vWorldY, vWorldXZ.y));\n#include <opaque_fragment>');
}

/** The highest level whose creatures show grey (give no XP) to a player of this level, as in 1.12. */
function greyLevel(level: number): number {
	if (level <= 5) return 0;
	if (level <= 39) return level - 5 - Math.floor(level / 10);
	if (level <= 59) return level - 1 - Math.floor(level / 5);
	return level - 9;
}

/** The colour a creature's name has for a player: how hard it is. */
function conColor(mob: number, player: number): number {
	const diff = mob - player;
	if (diff >= 5) return CON.red;
	if (diff >= 3) return CON.orange;
	if (diff >= -2) return CON.yellow;
	return mob > greyLevel(player) ? CON.green : CON.grey;
}

function fishingColor(skill: number): number {
	const stops = FISHING_STOPS;
	if (skill <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		if (skill > stops[i][0]) continue;
		const t = (skill - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
		return new THREE.Color(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), t).getHex();
	}
	return stops[stops.length - 1][1];
}

/**
 * Colours for a graph's nodes such that no two touching ones share one where it can be helped:
 * most neighbours first, each taking the least used colour its coloured neighbours don't have.
 */
function colourGraph(touching: Set<number>[]): number[] {
	const n = touching.length;
	const colours = new Array<number>(n).fill(-1);
	const uses = new Array<number>(PALETTE.length).fill(0);
	const order = [...Array(n).keys()].sort((a, b) => touching[b].size - touching[a].size);
	for (const g of order) {
		const taken = new Set([...touching[g]].map((t) => colours[t]));
		let pick = -1;
		for (let k = 0; k < PALETTE.length; k++) if (!taken.has(k) && (pick < 0 || uses[k] < uses[pick])) pick = k;
		if (pick < 0) pick = uses.indexOf(Math.min(...uses));
		colours[g] = pick;
		uses[pick]++;
	}
	return colours.map((k) => PALETTE[k]);
}

/** Which grid cells touch which (right and down neighbours), by an owner per cell (-1 none). */
function touchingOwners(owner: Int32Array, n: number, touching = Array.from({ length: n }, () => new Set<number>())): Set<number>[] {
	for (let i = 0; i < owner.length; i++) {
		const a = owner[i];
		if (a < 0) continue;
		for (const j of [i + 1, i + GRID]) {
			if (j >= owner.length || (j === i + 1 && j % GRID === 0)) continue;
			const b = owner[j];
			if (b < 0 || b === a) continue;
			touching[a].add(b);
			touching[b].add(a);
		}
	}
	return touching;
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * The ground tinted by region: the graveyard dying there sends you to (as the server picks it:
 * the graveyards linked to the zone you die in that take your side, the nearest of those),
 * territory, creature levels, subzones or fishing skill. Markers name the spirit healers or the
 * areas, and the panel says what applies to the spot under the camera.
 */
export class RegionOverlay {
	private data: RegionData | null = null;
	private graveyards: Graveyard[] = [];
	/** Area ID -> its index in the shader's tables (from 1), and the reverse. */
	private areaIndex = new Map<number, number>();
	private indexed: AreaInfo[] = [];
	/** Zone ID -> the graveyards (indices) linked to it, with the faction each is for. */
	private zoneLinks = new Map<number, [number, number][]>();
	/** Subzone colours, unlike their neighbours'. */
	private subzoneColors = new Map<number, number>();
	private continents: ContinentPlacement[] = [];
	private mode: TintMode | null = null;
	private side: Side = 'alliance';
	private level = 20;
	private readonly pool: HTMLDivElement[] = [];
	private readonly projected = new THREE.Vector3();
	/** The graveyard for the ground under the camera and how far it is, or the area there. */
	private here: { graveyard: number; distance: number } | 'none' | null = null;
	private hereArea: AreaInfo | null = null;
	private lastCheck = 0;
	/** Area label positions, once worked out (heights come from the terrain as it loads). */
	private readonly labelSpots = new Map<number, THREE.Vector3>();

	constructor(private readonly container: HTMLElement, private readonly groundAt: (x: number, z: number) => number) {}

	/** The region data and where the continents sit in the world, once both are known. */
	setData(data: RegionData, continents: ContinentPlacement[]): void {
		this.data = data;
		this.continents = continents.filter((c) => !c.instance).slice(0, 2);
		this.build();
	}

	setMode(mode: TintMode | null): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.fillData();
	}

	setSide(side: Side): void {
		if (side === this.side) return;
		this.side = side;
		this.fillData();
	}

	/** The player level creature levels are coloured for. */
	setLevel(level: number): void {
		if (level === this.level) return;
		this.level = level;
		if (this.mode === 'levels') this.fillData();
	}

	/** What the colours mean, for the panel. */
	get key(): TintKey {
		switch (this.mode) {
			case 'territory': return [[css(TERRITORY.friendly), 'Friendly'], [css(TERRITORY.hostile), 'Hostile'], [css(TERRITORY.contested), 'Contested'], [css(TERRITORY.arena), 'Free-for-all']];
			case 'levels': return [[css(CON.grey), 'No XP'], [css(CON.green), 'Easy'], [css(CON.yellow), 'Even'], [css(CON.orange), 'Hard'], [css(CON.red), 'Deadly']];
			case 'fishing': return FISHING_STOPS.map(([skill, color]) => [css(color), String(Math.max(1, skill))]);
			default: return [];
		}
	}

	/** What applies to the spot under the camera, for the panel. */
	get status(): string {
		if (!this.mode) return '';
		if (!this.data) return 'Region data not loaded';
		const area = this.hereArea;
		const sideName = this.side === 'alliance' ? 'Alliance' : 'Horde';
		if (this.mode === 'graveyards') {
			if (this.here === 'none') return `Dying here (${sideName}): no graveyard for this zone`;
			if (!this.here) return '';
			return `Dying here, the ${sideName} respawns at ${this.graveyards[this.here.graveyard].name} (${Math.round(this.here.distance).toLocaleString()} yd)`;
		}
		if (!area) return '';
		const where = area.zone !== area.id ? `${area.name}, ${this.data.areas.get(area.zone)?.name ?? ''}` : area.name;
		switch (this.mode) {
			case 'territory': {
				const kind = this.territory(area);
				const label = { friendly: 'Friendly territory', hostile: 'Hostile territory', contested: 'Contested territory', arena: 'Free-for-all PvP' }[kind];
				return `${label} for the ${sideName}: ${where}`;
			}
			case 'levels':
				return area.mobs ? `Creatures in ${where}: level ${area.mobs[0] === area.mobs[1] ? area.mobs[0] : `${area.mobs[0]}–${area.mobs[1]}`}` : `No creature levels for ${where}`;
			case 'subzones':
				return area.xp ? `${where}: discovering it gives ${area.xp} XP at level ${area.level}` : `${where}: no exploration XP`;
			case 'fishing': {
				if (area.fishing === null) return `No fishing rating for ${where}`;
				// The catch chance is your skill - the zone's + 5 (%): nothing gets away from 95 over.
				const from = Math.max(1, area.fishing - 4);
				const sure = area.fishing + 95;
				return `Fishing in ${where} (rated ${area.fishing}): catches from skill ${from}, ${sure <= 1 ? 'never gets away' : `never gets away from ${sure}`}`;
			}
		}
		return '';
	}

	private territory(area: AreaInfo): keyof typeof TERRITORY {
		if (area.flags & FLAG_ARENA) return 'arena';
		if (area.side === 'contested') return 'contested';
		return area.side === this.side ? 'friendly' : 'hostile';
	}

	private build(): void {
		const data = this.data;
		if (!data || !this.continents.length) return;
		const placements = new Map(this.continents.map((c) => [c.mapId, c]));
		const index = new Map<number, number>();
		this.graveyards = [];
		for (const g of data.graveyards) {
			const placement = placements.get(g.map);
			if (!placement) continue;
			index.set(g.id, this.graveyards.length);
			this.graveyards.push({ name: g.name, mapId: g.map, position: worldFromWow(placement, g.x, g.y, g.z), color: new THREE.Color(), css: '' });
		}
		this.zoneLinks.clear();
		this.areaIndex.clear();
		this.indexed = [];
		for (const area of data.areas.values()) {
			this.areaIndex.set(area.id, this.indexed.length + 1);
			this.indexed.push(area);
			const links = data.graveyardLinks(area.zone).filter(([id]) => index.has(id)).map(([id, faction]) => [index.get(id)!, faction] as [number, number]);
			if (links.length) this.zoneLinks.set(area.zone, links);
		}

		// Both continents' grids in one texture, area IDs swapped for their indices.
		const pixels = new Uint16Array(GRID * GRID * 2);
		this.continents.forEach((c, m) => {
			const grid = data.grids.get(c.mapId);
			regionUniforms.uRegionGrids.value[m].set(c.offsetX * TILE_SIZE, c.offsetY * TILE_SIZE, 0, grid ? 1 : 0);
			if (!grid) return;
			for (let i = 0; i < grid.length; i++) if (grid[i]) pixels[m * GRID * GRID + i] = this.areaIndex.get(grid[i]) ?? 0;
		});
		const texture = new THREE.DataTexture(pixels, GRID, GRID * 2, THREE.RedIntegerFormat, THREE.UnsignedShortType);
		texture.internalFormat = 'R16UI';
		texture.needsUpdate = true;
		regionUniforms.uRegionGrid.value.dispose();
		regionUniforms.uRegionGrid.value = texture;
		this.colourGraveyards();
		this.colourSubzones();
		this.labelSpots.clear();
		this.fillData();
	}

	/** The colour and how-alike group of an area in the mode shown (group 0: untinted). */
	private areaLook(area: AreaInfo): [number, number] {
		switch (this.mode) {
			case 'territory': {
				const kind = this.territory(area);
				return [TERRITORY[kind], Object.keys(TERRITORY).indexOf(kind) + 1];
			}
			case 'levels': {
				if (!area.mobs) return [0, 0];
				const color = conColor(Math.round((area.mobs[0] + area.mobs[1]) / 2), this.level);
				return [color, Object.values(CON).indexOf(color) + 1];
			}
			case 'subzones':
				return [this.subzoneColors.get(area.id) ?? 0xffffff, this.areaIndex.get(area.id)!];
			case 'fishing':
				return area.fishing === null ? [0, 0] : [fishingColor(area.fishing), area.fishing + 1000];
			default:
				return [0, 0];
		}
	}

	/** Graveyard positions and colours, then each area's colour and (for the side shown) graveyards. */
	private fillData(): void {
		regionUniforms.uRegionMode.value = !this.mode || !this.data ? 0 : this.mode === 'graveyards' ? 1 : 2;
		this.lastCheck = 0;
		this.here = null;
		if (!this.data || !this.indexed.length) return;
		const rows = Math.ceil((DATA_WIDTH * 2 + (this.indexed.length + 1) * 3) / DATA_WIDTH);
		const data = new Float32Array(DATA_WIDTH * rows * 4);
		this.graveyards.forEach((g, i) => {
			data.set([g.position.x, g.position.y, g.position.z, 0], i * 4);
			// Three keeps colours linear, as the shader works.
			data.set([g.color.r, g.color.g, g.color.b, 1], (DATA_WIDTH + i) * 4);
		});
		const color = new THREE.Color();
		this.indexed.forEach((area, i) => {
			const base = (DATA_WIDTH * 2 + i * 3) * 4;
			const [hex, group] = this.areaLook(area);
			color.setHex(hex);
			data.set([color.r, color.g, color.b, group], base);
			this.candidates(area.zone).slice(0, PER_ZONE).forEach((g, j) => (data[base + 4 + j] = g + 1));
		});
		const texture = new THREE.DataTexture(data, DATA_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
		texture.needsUpdate = true;
		regionUniforms.uRegionData.value.dispose();
		regionUniforms.uRegionData.value = texture;
	}

	/**
	 * Gives every graveyard a colour none of its neighbours have: which graveyard each chunk sends
	 * you to, measured from its middle, and which of those touch. Neighbours for either side, so
	 * the colours stay put when the side changes.
	 */
	private colourGraveyards(): void {
		const n = this.graveyards.length;
		let touching = Array.from({ length: n }, () => new Set<number>());
		for (const side of ['alliance', 'horde'] as const) for (const c of this.continents) {
			const grid = this.data!.grids.get(c.mapId);
			if (!grid) continue;
			const choices = new Map<number, number[]>();
			const owner = new Int32Array(GRID * GRID).fill(-1);
			for (let i = 0; i < grid.length; i++) {
				const zone = grid[i] ? this.data!.areas.get(grid[i])?.zone : undefined;
				if (!zone) continue;
				let list = choices.get(zone);
				if (!list) choices.set(zone, (list = this.candidates(zone, side)));
				if (list.length < 2) {
					owner[i] = list.length ? list[0] : -1;
					continue;
				}
				const x = (i % GRID + 0.5) * CHUNK_SIZE + c.offsetX * TILE_SIZE;
				const z = (Math.floor(i / GRID) + 0.5) * CHUNK_SIZE + c.offsetY * TILE_SIZE;
				let best = Infinity;
				for (const g of list) {
					const p = this.graveyards[g].position;
					const d = (p.x - x) ** 2 + (p.z - z) ** 2;
					if (d < best) {
						best = d;
						owner[i] = g;
					}
				}
			}
			touching = touchingOwners(owner, n, touching);
		}
		colourGraph(touching).forEach((hex, g) => {
			this.graveyards[g].color.setHex(hex);
			this.graveyards[g].css = css(hex);
		});
	}

	/** Each subzone a colour none of the subzones it touches have. */
	private colourSubzones(): void {
		const n = this.indexed.length;
		let touching = Array.from({ length: n }, () => new Set<number>());
		for (const c of this.continents) {
			const grid = this.data!.grids.get(c.mapId);
			if (!grid) continue;
			const owner = new Int32Array(GRID * GRID).fill(-1);
			for (let i = 0; i < grid.length; i++) if (grid[i]) owner[i] = (this.areaIndex.get(grid[i]) ?? 0) - 1;
			touching = touchingOwners(owner, n, touching);
		}
		this.subzoneColors.clear();
		colourGraph(touching).forEach((hex, i) => this.subzoneColors.set(this.indexed[i].id, hex));
	}

	/** The graveyards a zone sends a side to. */
	private candidates(zone: number, side = this.side): number[] {
		const faction = FACTION[side];
		return (this.zoneLinks.get(zone) ?? []).filter(([, f]) => f === 0 || f === faction).map(([g]) => g);
	}

	/** The graveyard dying at a world position sends you to, or 'none' if its zone has none. */
	private graveyardAt(p: THREE.Vector3, area: AreaInfo): number | 'none' {
		let best: number | 'none' = 'none';
		let bestDistance = Infinity;
		for (const g of this.candidates(area.zone)) {
			const d = this.graveyards[g].position.distanceTo(p);
			if (d < bestDistance) {
				bestDistance = d;
				best = g;
			}
		}
		return best;
	}

	/** Moves the markers; ground is the height under the camera (for where you'd die). */
	update(now: number, camera: THREE.PerspectiveCamera, placement: ContinentPlacement | null, ground: number, width: number, height: number): void {
		if (!this.mode || !this.data || !placement || placement.instance) {
			this.here = null;
			this.hereArea = null;
			this.hideFrom(0);
			return;
		}
		const cam = camera.position;
		if (now - this.lastCheck > 250) {
			this.lastCheck = now;
			const spot = new THREE.Vector3(cam.x, Number.isFinite(ground) ? ground : cam.y, cam.z);
			this.hereArea = this.data.areaAt(placement, cam.x, cam.z);
			if (this.mode === 'graveyards' && this.hereArea) {
				const g = this.graveyardAt(spot, this.hereArea);
				this.here = g === 'none' ? 'none' : { graveyard: g, distance: this.graveyards[g].position.distanceTo(spot) };
			} else {
				this.here = null;
			}
		}
		const shown = this.mode === 'graveyards' ? this.showGraveyards(camera, placement, width, height) : this.showAreas(camera, placement, width, height);
		this.hideFrom(shown);
	}

	private showGraveyards(camera: THREE.PerspectiveCamera, placement: ContinentPlacement, width: number, height: number): number {
		const cam = camera.position;
		const current = this.here && this.here !== 'none' ? this.here.graveyard : -1;
		const near = this.graveyards
			.map((g, i) => ({ g, i, distance: g.position.distanceTo(cam) }))
			.filter(({ g, i, distance }) => g.mapId === placement.mapId && (distance < RANGE || i === current))
			.sort((a, b) => Number(b.i === current) - Number(a.i === current) || a.distance - b.distance);
		let shown = 0;
		for (const { g, i, distance } of near) {
			const labelled = shown < LABELLED || i === current;
			const placed = this.place(shown, g.position, camera, width, height, labelled ? g.name : '', labelled ? `${distance.toFixed(0)} yd` : '', g.css, 'graveyard', i === current ? 1 : 1 - 0.5 * Math.min(1, distance / RANGE));
			if (!placed) continue;
			placed.classList.toggle('current', i === current);
			shown++;
		}
		return shown;
	}

	private showAreas(camera: THREE.PerspectiveCamera, placement: ContinentPlacement, width: number, height: number): number {
		const cam = camera.position;
		// From high up, only whole zones are named, as far as can be seen.
		const ground = this.groundAt(cam.x, cam.z);
		const high = cam.y - (Number.isFinite(ground) ? ground : 0) > ZONES_ONLY_ALTITUDE;
		const range = high ? Math.max(AREA_RANGE, (cam.y - Math.max(ground, 0)) * 1.6) : AREA_RANGE;
		const near: { area: AreaInfo; spot: THREE.Vector3; distance: number }[] = [];
		for (const area of this.indexed) {
			if (area.map !== placement.mapId || area.chunks < 3 || (high && area.zone !== area.id)) continue;
			const spot = this.labelSpot(area, placement);
			const distance = Math.hypot(spot.x - cam.x, spot.z - cam.z);
			if (distance < range) near.push({ area, spot, distance });
		}
		near.sort((a, b) => a.distance - b.distance);
		let shown = 0;
		for (const { area, spot, distance } of near) {
			if (shown >= AREA_LABELS) break;
			const [hex, group] = this.areaLook(area);
			if (!group) continue;
			const detail = this.areaDetail(area);
			if (this.place(shown, spot, camera, width, height, area.name, detail, css(hex), 'region', 1 - 0.5 * Math.min(1, distance / range))) shown++;
		}
		return shown;
	}

	/** The few words beside an area's name in the mode shown. */
	private areaDetail(area: AreaInfo): string {
		switch (this.mode) {
			case 'territory': return { friendly: 'Friendly', hostile: 'Hostile', contested: 'Contested', arena: 'Free-for-all' }[this.territory(area)];
			case 'levels': return area.mobs ? (area.mobs[0] === area.mobs[1] ? `${area.mobs[0]}` : `${area.mobs[0]}–${area.mobs[1]}`) : '';
			case 'subzones': return area.xp ? `${area.xp} XP` : '';
			case 'fishing': return area.fishing !== null ? `Skill ${Math.max(1, area.fishing - 4)}+` : '';
			default: return '';
		}
	}

	/** Where an area's name goes: on the ground once the terrain there is known. */
	private labelSpot(area: AreaInfo, placement: ContinentPlacement): THREE.Vector3 {
		let spot = this.labelSpots.get(area.id);
		if (!spot) {
			spot = worldFromWow(placement, area.x, area.y, -Infinity);
			this.labelSpots.set(area.id, spot);
		}
		if (!Number.isFinite(spot.y)) {
			const y = this.groundAt(spot.x, spot.z);
			spot.y = Number.isFinite(y) ? y : -Infinity;
		}
		return spot;
	}

	/** Puts marker i on a point; null if it's off screen (or nowhere yet). */
	private place(i: number, at: THREE.Vector3, camera: THREE.PerspectiveCamera, width: number, height: number, name: string, detail: string, color: string, kind: string, opacity: number): HTMLDivElement | null {
		if (!Number.isFinite(at.y)) return null;
		this.projected.copy(at).setY(at.y + LIFT).project(camera);
		if (behindCamera(this.projected, camera) || Math.abs(this.projected.x) > 1.05 || Math.abs(this.projected.y) > 1.05) return null;
		const el = this.element(i);
		const [nameEl, detailEl] = el.children as unknown as [HTMLElement, HTMLElement];
		if (nameEl.textContent !== name) nameEl.textContent = name;
		if (detailEl.textContent !== detail) detailEl.textContent = detail;
		el.className = `beacon ${kind}`;
		el.style.setProperty('--beacon', color);
		const x = (this.projected.x * 0.5 + 0.5) * width;
		const y = (-this.projected.y * 0.5 + 0.5) * height;
		el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
		el.style.opacity = String(opacity);
		el.hidden = false;
		return el;
	}

	private element(i: number): HTMLDivElement {
		let el = this.pool[i];
		if (!el) {
			el = document.createElement('div');
			const name = document.createElement('span');
			name.className = 'beacon-name';
			const distance = document.createElement('span');
			distance.className = 'beacon-distance';
			el.append(name, distance);
			this.container.prepend(el);
			this.pool[i] = el;
		}
		return el;
	}

	private hideFrom(i: number): void {
		for (; i < this.pool.length; i++) if (!this.pool[i].hidden) this.pool[i].hidden = true;
	}
}
