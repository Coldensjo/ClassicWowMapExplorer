import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { DB2_FILES, loadTable } from './clientDb';

export interface FlightNode {
	id: number;
	name: string;
	map: number;
	x: number;
	y: number;
	z: number;
	alliance: boolean;
	horde: boolean;
}

/** An unbroken stretch of a route, on one map: [x, y, z, ...] in WoW coordinates. */
export interface FlightLeg {
	map: number;
	points: number[];
}

/**
 * A direct route between two flight masters. It is one leg unless it jumps, to another map or past
 * a teleport node (as from Zul'Aman, on Outland, to Light's Hope Chapel, on the Eastern Kingdoms),
 * where the next leg starts.
 */
export interface FlightPath {
	id: number;
	from: number;
	to: number;
	cost: number;
	legs: FlightLeg[];
}

/** The flight network: the flight masters players can use, and the routes between them. */
export interface FlightData {
	nodes: FlightNode[];
	paths: FlightPath[];
}

// Fields of the tables as Forever numbers them (see db2Layouts.ts).
const NODE_NAME = 0;
const NODE_POS = 1;
const NODE_MAP = 5;
/** The bit of the node in the character's known-nodes mask. */
const NODE_BIT = 7;
/** 1 Alliance, 2 Horde. */
const NODE_FLAGS = 8;
const PATH_FROM = 1;
const PATH_TO = 2;
const PATH_COST = 3;
const POINT_LOC = 0;
const POINT_PATH = 2;
const POINT_INDEX = 3;
const POINT_MAP = 4;
/** The route jumps from this node to the next. */
const POINT_FLAGS = 5;
const POINT_DELAY = 6;
const POINT_TELEPORT = 1;

/** Nodes of the client's tables that aren't flight masters in use: old, removed or never opened. */
const UNUSED_NODE = /^zzOLD|Riverglades|Hyjal|Tidegear/i;

export const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

type Table = Pick<Db2, 'ids' | 'getInt' | 'getFloat' | 'getString'>;

/** A node of a TaxiPath (TaxiPathNode): where it is, which map, and what the route does there. */
export interface PathNode {
	/** Its place along the path. */
	i: number;
	x: number;
	y: number;
	z: number;
	map: number;
	flags: number;
	/** Seconds a transport waits here, if its flags say so. */
	delay: number;
}

/** The nodes of each TaxiPath, by the path's ID, in the table's order. */
export function readPathNodes(pointsTable: Table): Map<number, PathNode[]> {
	const points = new Map<number, PathNode[]>();
	for (const id of pointsTable.ids()) {
		const path = pointsTable.getInt(id, POINT_PATH)!;
		const list = points.get(path) ?? [];
		list.push({
			i: pointsTable.getInt(id, POINT_INDEX)!,
			x: pointsTable.getFloat(id, POINT_LOC, 0)!,
			y: pointsTable.getFloat(id, POINT_LOC, 1)!,
			z: pointsTable.getFloat(id, POINT_LOC, 2)!,
			map: pointsTable.getInt(id, POINT_MAP) ?? 0,
			flags: pointsTable.getInt(id, POINT_FLAGS) ?? 0,
			delay: pointsTable.getInt(id, POINT_DELAY) ?? 0,
		});
		points.set(path, list);
	}
	return points;
}

/**
 * The flight network from TaxiNodes, TaxiPath and TaxiPathNode, on the given continents. Flight
 * masters players can use are on a continent, have a side and a bit in the character's known-nodes
 * mask; the rest are transports, quest flights and tests.
 */
export function buildFlights(nodesTable: Table, pathsTable: Table, pointsTable: Table, continents: Set<number>): FlightData {
	const nodes = nodesTable.ids().flatMap((id): FlightNode[] => {
		const map = nodesTable.getInt(id, NODE_MAP) ?? -1;
		const flags = nodesTable.getInt(id, NODE_FLAGS) ?? 0;
		const name = nodesTable.getString(id, NODE_NAME) ?? '';
		if (!continents.has(map) || !(flags & 3) || !nodesTable.getInt(id, NODE_BIT) || UNUSED_NODE.test(name)) return [];
		const [x, y, z] = [0, 1, 2].map((i) => round(nodesTable.getFloat(id, NODE_POS, i)!));
		return [{ id, name, map, x, y, z, alliance: !!(flags & 1), horde: !!(flags & 2) }];
	});
	const nodeIds = new Set(nodes.map((n) => n.id));
	const points = readPathNodes(pointsTable);
	const paths = pathsTable.ids().flatMap((id): FlightPath[] => {
		const from = pathsTable.getInt(id, PATH_FROM)!;
		const to = pathsTable.getInt(id, PATH_TO)!;
		const list = points.get(id);
		if (!nodeIds.has(from) || !nodeIds.has(to) || !list || list.length < 2) return [];
		list.sort((a, b) => a.i - b.i);
		// A leg per unbroken stretch: it ends where the map changes and after a teleport node.
		const legs: FlightLeg[] = [];
		list.forEach((p, k) => {
			const prev = list[k - 1];
			if (!prev || prev.map !== p.map || prev.flags & POINT_TELEPORT) legs.push({ map: p.map, points: [] });
			legs.at(-1)!.points.push(round(p.x, 1), round(p.y, 1), round(p.z, 1));
		});
		// A lone node can't be flown along.
		const flown = legs.filter((leg) => leg.points.length >= 6);
		return flown.length ? [{ id, from, to, cost: pathsTable.getInt(id, PATH_COST) ?? 0, legs: flown }] : [];
	});
	return { nodes, paths };
}

/** The flight network of an install, on the given continents. */
export async function loadFlights(storage: CascStorage, continents: number[]): Promise<FlightData> {
	const [nodes, paths, points] = await Promise.all([
		loadTable(storage, DB2_FILES.TaxiNodes),
		loadTable(storage, DB2_FILES.TaxiPath),
		loadTable(storage, DB2_FILES.TaxiPathNode),
	]);
	return buildFlights(nodes, paths, points, new Set(continents));
}
