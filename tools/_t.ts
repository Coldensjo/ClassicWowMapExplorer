import { CascStorage } from '../src/casc/storage';
import { Db2 } from '../src/formats/db2';
import { NodeSource } from './nodeSource';

const s = await CascStorage.open(new NodeSource('C:/Program Files (x86)/World of Warcraft'), 'wow_classic_beta');
const load = async (fdid: number) => new Db2((await s.readFileWithStatus(fdid, true)).data);
const row = (db: Db2, id: number) => Array.from({ length: db.fieldCount }, (_, f) => {
	const n = db.arrayLength(f);
	const vals = Array.from({ length: n }, (_, k) => { const v = db.getInt(id, f, k); const str = v && v > 0 && v < 5e6 ? db.getString(id, f, k) : null; return str && /^[\x20-\x7e]{2,40}$/.test(str) ? JSON.stringify(str) : v; });
	return `${f}=${vals.join('/')}`;
}).join(' ');
const tables = {
	option: await load(3692043), cOption: await load(3384247), choice: await load(3450554), element: await load(3512765),
	geoset: await load(3456171), material: await load(3459652), chrModel: await load(3384313), sections: await load(1365366),
};
for (const [k, db] of Object.entries(tables)) console.log(k, db.size, 'rows', db.fieldCount, 'fields');
// CreatureDisplayInfoOption rows for extra 634.
const opt = tables.option;
const mine = opt.ids().filter((id) => Array.from({ length: opt.fieldCount }, (_, f) => opt.getInt(id, f)).includes(634));
console.log('\nCreatureDisplayInfoOption for 634:');
for (const id of mine) console.log(' ', id, row(opt, id));
const firstOpt = mine[0];
if (firstOpt) {
	for (let f = 0; f < opt.fieldCount; f++) {
		const v = opt.getInt(firstOpt, f)!;
		if (tables.cOption.has(v)) console.log('  field', f, '-> ChrCustomizationOption', v, row(tables.cOption, v));
		if (tables.choice.has(v)) console.log('  field', f, '-> ChrCustomizationChoice', v, row(tables.choice, v));
	}
}
console.log('\nsample element:', row(tables.element, tables.element.ids()[0]));
console.log('sample geoset:', row(tables.geoset, tables.geoset.ids()[0]));
console.log('sample material:', row(tables.material, tables.material.ids()[0]));
console.log('sample chrModel:', row(tables.chrModel, tables.chrModel.ids()[0]));
console.log('sample charSections:', tables.sections.ids().slice(0, 2).map((id) => row(tables.sections, id)).join('\n  '));
