import type { CascStorage } from '../casc/storage';
import { DB2_FILES, loadTable } from './clientDb';
import { readPathNodes, round, type PathNode } from './flights';

/**
 * An unbroken stretch of a transport's route, on one map: [x, y, z, wait in seconds, ...] in WoW
 * coordinates. The route jumps between legs, and from the last back to the first.
 */
export interface TransportLeg {
	map: number;
	points: number[];
}

/** What the client's tables say of a boat or zeppelin: how it's drawn and the way it goes. */
export interface TransportRoute {
	/** The WMO it's drawn with. */
	model: number;
	legs: TransportLeg[];
}

/** TaxiPathNode.flags: the transport jumps from this node to the next (out at sea, or between maps). */
const NODE_TELEPORT = 1;
/** TaxiPathNode.flags: the transport waits at this node (for its delay, in seconds). */
const NODE_STOP = 2;
/** GameObjectDisplayInfo's file ID, as Forever numbers its fields. */
const DISPLAY_FILE = 1;

/**
 * The route of a transport from the nodes of its TaxiPath: a leg per unbroken stretch. It jumps where
 * the map changes, and after a teleport node (the first node's flag marks where the loop jumps back
 * to), and then starts over.
 */
export function transportLegs(nodes: PathNode[]): TransportLeg[] {
	const list = [...nodes].sort((a, b) => a.i - b.i);
	const legs: TransportLeg[] = [];
	list.forEach((p, i) => {
		const prev = list[i - 1];
		if (!prev || prev.map !== p.map || (i > 1 && prev.flags & NODE_TELEPORT)) legs.push({ map: p.map, points: [] });
		legs.at(-1)!.points.push(round(p.x, 1), round(p.y, 1), round(p.z, 1), p.flags & NODE_STOP ? p.delay : 0);
	});
	// A route that never jumps goes round and round. Unless it already ends on its own start (the
	// Feathermoon ferry's repeats its first nodes), it's closed the same way: its first three nodes
	// again, without their waits, so it sails on from the second-last into the second.
	const only = legs.length === 1 ? legs[0].points : null;
	if (only && only.length >= 16 && (only[4] !== only.at(-8) || only[5] !== only.at(-7))) {
		for (let i = 0; i < 12; i += 4) only.push(only[i], only[i + 1], only[i + 2], 0);
	}
	return legs;
}

/** The routes and models of transports, given each one's display and TaxiPath; null for one whose path has no nodes. */
export async function loadTransportRoutes(storage: CascStorage, transports: { displayId: number; path: number }[]): Promise<(TransportRoute | null)[]> {
	const [pointsTable, displays] = await Promise.all([loadTable(storage, DB2_FILES.TaxiPathNode), loadTable(storage, DB2_FILES.GameObjectDisplayInfo)]);
	const points = readPathNodes(pointsTable);
	return transports.map((t) => {
		const nodes = points.get(t.path);
		const model = displays.getInt(t.displayId, DISPLAY_FILE);
		return nodes?.length && model ? { model, legs: transportLegs(nodes) } : null;
	});
}
