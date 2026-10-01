import { useEffect, useMemo, useState } from 'preact/hooks';
import { matchScore, searchKey } from '../../app/search';
import { creatureIcon, type IconName } from '../../ui/wowSkin';
import type { Stamp } from '../viewport';
import { Icon, Panel } from './common';
import type { EditorContext } from './context';

type Tab = 'npc' | 'object' | 'recent';

interface Row extends Stamp {
	/** What it is: <Subname> · level, or the object's type. */
	sub: string;
	key: string;
	/** NPCs: Beast, Humanoid...; for the icon. */
	kind?: string;
	/** 0 for proper names; 1 for those starting oddly ("Plucky"); 2 for placeholders ([NOT USED], [PH]). */
	rank: number;
}

/** Templates nobody would place on purpose sort last. */
function rankOf(name: string): number {
	if (/^\[|\bUNUSED\b|\bNOT USED\b|\bDEPRECATED\b|\bTEST\b|\bzzOLD/i.test(name)) return 2;
	return /^[A-Za-z]/.test(name) ? 0 : 1;
}

/** Results shown at most. */
const LIMIT = 120;
const RECENT_KEY = 'mapExplorer.recentStamps';
const RECENT_LIMIT = 40;

function readRecent(): Row[] {
	try {
		return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Row[];
	} catch {
		return [];
	}
}

function saveRecent(rows: Row[]): void {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(rows.slice(0, RECENT_LIMIT)));
	} catch {
		// Not remembered.
	}
}

/** An icon for a template: a head for NPCs; for objects one that suits their type. */
function iconOf(row: Row): IconName {
	if (row.type === 'npc') return creatureIcon(row.kind);
	if (/^(Text|Quest giver)/.test(row.sub)) return 'note';
	return 'object';
}

let templates: Promise<Record<'npc' | 'object', Row[]>> | null = null;

/**
 * The palette: every creature and game object template, by name or ID, plus the ones placed
 * lately. Choosing one starts placing it: a copy follows the mouse, and each click puts one down.
 */
export function Palette({ ctx }: { ctx: EditorContext }) {
	const [tab, setTab] = useState<Tab>('npc');
	const [query, setQuery] = useState('');
	const [rows, setRows] = useState<Record<'npc' | 'object', Row[]> | null>(null);
	const [recent, setRecent] = useState<Row[]>(readRecent);
	const stamp = ctx.viewport.stamp.value;

	useEffect(() => {
		templates ??= ctx.storage.listTemplates().then((t) => {
			const keyed = (type: 'npc' | 'object', list: (readonly [number, string, string, string?])[]): Row[] => list
				.map(([entry, name, sub, kind]) => ({ type, entry, name, sub, kind, key: searchKey(name), rank: rankOf(name) }))
				.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
			return { npc: keyed('npc', t.npcs), object: keyed('object', t.objects) };
		});
		void templates.then(setRows, () => setRows({ npc: [], object: [] }));
	}, []);

	const found = useMemo(() => {
		const list = tab === 'recent' ? recent : rows?.[tab] ?? [];
		const q = searchKey(query.trim());
		if (!q) return { shown: list.slice(0, LIMIT), total: list.length };
		const id = Number(q);
		if (Number.isInteger(id) && id > 0) {
			const hits = list.filter((r) => r.entry === id);
			return { shown: hits, total: hits.length };
		}
		const hits = list.map((r) => ({ r, score: matchScore(r.key, q) })).filter((m) => m.score >= 0)
			.sort((a, b) => (a.r.rank ?? 0) - (b.r.rank ?? 0) || a.score - b.score || a.r.name.length - b.r.name.length);
		return { shown: hits.slice(0, LIMIT).map((m) => m.r), total: hits.length };
	}, [tab, query, rows, recent]);

	const choose = async (row: Row) => {
		const next = [row, ...recent.filter((r) => r.type !== row.type || r.entry !== row.entry)].slice(0, RECENT_LIMIT);
		setRecent(next);
		saveRecent(next);
		(document.activeElement as HTMLElement | null)?.blur();
		if (!(await ctx.viewport.startPlacing({ type: row.type, entry: row.entry, name: row.name }))) ctx.notify('Point at the ground on a map to place it there');
	};

	const tabs: [Tab, string][] = [['npc', 'NPCs'], ['object', 'Objects'], ['recent', 'Recent']];
	return (
		<Panel title="Palette" class="ed-palette">
			<div class="ed-tabs" role="tablist">
				{tabs.map(([t, label]) => (
					<button role="tab" aria-selected={tab === t} class={`ed-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label}</button>
				))}
			</div>
			<input
				class="wow-input ed-search"
				type="search"
				placeholder="Find by name or ID…"
				value={query}
				spellcheck={false}
				onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && found.shown[0]) void choose(found.shown[0]);
					if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
				}}
			/>
			<ul class="ed-list">
				{!rows && tab !== 'recent' && <li class="ed-empty wow-muted">Reading the list…</li>}
				{rows && !found.shown.length && (
					<li class="ed-empty wow-muted">{tab === 'recent' ? 'What you place shows up here.' : 'Nothing by that name.'}</li>
				)}
				{found.shown.map((r) => (
					<li
						key={`${r.type}:${r.entry}`}
						class={`wow-row ed-row ${stamp?.type === r.type && stamp.entry === r.entry ? 'chosen' : ''}`}
						onClick={() => void choose(r)}
						title={`${r.name} (${r.type === 'npc' ? 'NPC' : 'object'} ${r.entry})`}
					>
						<Icon name={iconOf(r)} size={28} />
						<span class="ed-row-text">
							<span class="ed-row-name">{r.name}</span>
							<span class="ed-row-sub wow-muted">{r.sub} · {r.entry}</span>
						</span>
					</li>
				))}
				{found.total > found.shown.length && <li class="ed-empty wow-muted">{found.total - found.shown.length} more: narrow the search</li>}
			</ul>
		</Panel>
	);
}
