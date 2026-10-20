import type { CascStorage } from '../casc/storage';
import type { Db2 } from '../formats/db2';
import { DB2_FILES, loadTable } from './clientDb';

/** A room of a building (WMOAreaTable.db2): its own name, and the area it belongs to. */
export interface WmoArea {
	name: string | null;
	area: number;
}

const WMO_ID = 2;
const WMO_NAME_SET = 3;
const WMO_GROUP = 4;
const WMO_AREA = 13;

/** WMOAreaTable rows by building, name set and group, read once. */
export class WmoAreas {
	private wmoRows: Promise<{ table: Db2; rows: Map<string, number> }> | null = null;

	constructor(private readonly storage: CascStorage) {}

	/**
	 * The room of a building: its own row, with the building's default row (group -1) filling in
	 * what the room leaves unset. Null when the building has neither.
	 */
	async wmoArea(wmoId: number, nameSet: number, groupId: number): Promise<WmoArea | null> {
		this.wmoRows ??= loadTable(this.storage, DB2_FILES.WMOAreaTable).then((table) => ({ table, rows: indexWmoRows(table) }));
		const { table, rows } = await this.wmoRows;
		const read = (row: number | undefined): WmoArea | null => row === undefined ? null : {
			name: table.getString(row, 0) || null,
			area: table.getInt(row, WMO_AREA) ?? 0,
		};
		const room = read(rows.get(`${wmoId}:${nameSet}:${groupId}`));
		const building = read(rows.get(`${wmoId}:${nameSet}:-1`));
		if (!room) return building;
		if (!building) return room;
		return { name: room.name ?? building.name, area: room.area || building.area };
	}
}

function indexWmoRows(table: Db2): Map<string, number> {
	const rows = new Map<string, number>();
	for (const id of table.ids()) rows.set(`${table.getInt(id, WMO_ID)}:${table.getInt(id, WMO_NAME_SET)}:${table.getInt(id, WMO_GROUP)}`, id);
	return rows;
}
