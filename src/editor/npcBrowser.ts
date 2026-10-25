import type { CreatureDisplaySummary } from '../explorer/npcs';
import type { NpcAppearance, NpcPreset } from '../scene/types';
import type { AsyncStorageApi } from '../worker/protocol';
import { listfile, listfileDate, refreshListfile } from './listfile';
import { ModelThumbs } from './modelThumbs';
import { creatureDisplays, type NpcAsset } from './npcs';

/** A model and its skin variants, as the Creatures section lists them (spec 7.9.2). */
interface CreatureModel {
	fdid: number;
	/** The listfile path, lower case, or "" when the listfile lacks the model. */
	path: string;
	/** "murloc / murloc" for creature/murloc/murloc.m2; "model 125576" without a listfile. */
	label: string;
	variants: CreatureDisplaySummary[];
}

/** Model groups put in the panel at once; search narrows the rest. */
const MAX_MODELS = 60;
/** Thumbnails rendered at most once per session beyond the IndexedDB cache. */
const sessionThumbs = new Map<string, string | null>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How a preset's thumbnail is cached: by its look, since its worker handle changes with every edit. */
export function presetThumbKey(preset: NpcPreset): string {
	let h = 2166136261;
	for (const c of JSON.stringify([preset.race, preset.sex, preset.customization, preset.equipment])) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return `preset:${(h >>> 0).toString(16)}`;
}

/**
 * The NPCs tab of the asset browser (spec 7.9.1): Creatures (every CreatureDisplayInfo entry
 * whose model is in the client, grouped by model with each skin variant as a thumbnail, labelled
 * by model path, spec 7.9.2) and Custom (the user's presets, spec 7.9.3). Clicking an entry arms
 * it as what the NPCs tool places.
 */
export class NpcBrowser {
	private readonly thumbs: ModelThumbs;
	private models: CreatureModel[] = [];
	private readonly displays = new Map<number, CreatureDisplaySummary>();
	private readonly observer: IntersectionObserver;
	private readonly pending = new Map<Element, { kind: 'creature' | 'npcPreset'; fdid: number; key: string }>();
	private selected: NpcAsset | null = null;
	private presets: NpcPreset[] = [];
	private disposed = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly onPick: (asset: NpcAsset | null) => void,
		private readonly onNotice: (text: string) => void,
		private readonly hooks: {
			/** The worker handle a preset is loaded under (defines it there first). */
			handleOf: (preset: NpcPreset) => number;
			onNew: () => void;
			onEdit: (preset: NpcPreset) => void;
			onDelete: (preset: NpcPreset) => void;
			onExport: (preset: NpcPreset) => void;
			onImport: (file: File) => void;
			onCustomize: (displayId: number) => void;
		},
	) {
		this.thumbs = new ModelThumbs(storage, build);
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const item = this.pending.get(e.target);
				if (item) void this.drawThumb(e.target as HTMLElement, item);
				this.observer.unobserve(e.target);
				this.pending.delete(e.target);
			}
		}, { root: $('tool-panel') });
		this.wire();
		this.setTab('creatures');
		void this.loadCreatures(false);
	}

	private wire(): void {
		$('npc-tab-creatures').onclick = () => this.setTab('creatures');
		$('npc-tab-custom').onclick = () => this.setTab('custom');
		$('npc-search').oninput = () => this.renderCreatures();
		$('npc-refresh').onclick = () => void this.loadCreatures(true);
		$('npc-new').onclick = () => this.hooks.onNew();
		$('npc-import').onclick = () => $<HTMLInputElement>('npc-import-input').click();
		$('npc-import-input').onchange = (e) => {
			const input = e.target as HTMLInputElement;
			const file = input.files?.[0];
			input.value = '';
			if (file) this.hooks.onImport(file);
		};
		$('npc-customize').onclick = () => {
			if (this.selected?.appearance.kind === 'creature') this.hooks.onCustomize(this.selected.appearance.displayId);
		};
	}

	private setTab(tab: 'creatures' | 'custom'): void {
		$('npc-tab-creatures').classList.toggle('active', tab === 'creatures');
		$('npc-tab-custom').classList.toggle('active', tab === 'custom');
		$('npc-creatures').hidden = tab !== 'creatures';
		$('npc-custom').hidden = tab !== 'custom';
	}

	/** The picked appearance, or null. */
	get picked(): NpcAsset | null {
		return this.selected;
	}

	/** Whether a display is a pre-baked humanoid, which Customize as new can open. */
	isHumanoid(displayId: number): boolean {
		return this.displays.get(displayId)?.humanoid ?? false;
	}

	/** A short description of an appearance for the properties panel. */
	describe(appearance: NpcAppearance): string {
		if (appearance.kind === 'custom') return `Custom: ${this.presets.find((p) => p.id === appearance.presetId)?.name ?? 'a preset of this scene'}`;
		const d = this.displays.get(appearance.displayId);
		const model = d && this.models.find((m) => m.fdid === d.model);
		if (!model) return `Creature display ${appearance.displayId}`;
		return `${model.label} · variant ${model.variants.indexOf(d) + 1} (display ${appearance.displayId})`;
	}

	private async loadCreatures(refresh: boolean): Promise<void> {
		const counter = $('npc-count');
		counter.textContent = 'Loading the creature list…';
		let list: CreatureDisplaySummary[] = [];
		try {
			list = await creatureDisplays(this.storage);
		} catch (e) {
			this.onNotice(`The creature list couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		if (this.disposed) return;
		let paths = new Map<number, string>();
		try {
			const entries = await (refresh ? refreshListfile((t) => (counter.textContent = t), 'creature') : listfile('creature', (t) => (counter.textContent = t)));
			paths = new Map(entries.map((e) => [e.fdid, e.path]));
		} catch (e) {
			this.onNotice(`The listfile couldn't be loaded: ${e instanceof Error ? e.message : e}. Creatures are listed by model number.`);
		}
		if (this.disposed) return;
		const byModel = new Map<number, CreatureModel>();
		for (const d of list) {
			this.displays.set(d.id, d);
			let model = byModel.get(d.model);
			if (!model) {
				const path = paths.get(d.model) ?? '';
				const parts = path.replace(/\.m2$/, '').split('/');
				model = { fdid: d.model, path, label: path ? parts.slice(-2).join(' / ') : `model ${d.model}`, variants: [] };
				byModel.set(d.model, model);
			}
			model.variants.push(d);
		}
		this.models = [...byModel.values()].sort((a, b) => a.label.localeCompare(b.label));
		for (const m of this.models) m.variants.sort((a, b) => a.id - b.id);
		const date = await listfileDate('creature');
		$('npc-refresh').title = date ? `Fetch the listfile afresh (this one is from ${new Date(date).toLocaleDateString()})` : 'Fetch the listfile afresh';
		this.renderCreatures();
	}

	/** Fills the grid with the model groups that match the search, up to the cap. */
	private renderCreatures(): void {
		const grid = $('npc-grid');
		for (const [element] of this.pending) this.observer.unobserve(element);
		this.pending.clear();
		const tokens = $<HTMLInputElement>('npc-search').value.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = this.models.filter((m) => tokens.every((t) => m.path.includes(t) || m.label.includes(t) || m.variants.some((v) => String(v.id) === t)));
		const shown = matches.slice(0, MAX_MODELS);
		grid.replaceChildren(...shown.map((m) => this.makeModel(m)));
		const displays = matches.reduce((n, m) => n + m.variants.length, 0);
		$('npc-count').textContent = matches.length > shown.length ? `Showing ${shown.length} of ${matches.length} models — search to narrow` : `${matches.length} models, ${displays} displays`;
	}

	private makeModel(model: CreatureModel): HTMLElement {
		const box = document.createElement('div');
		box.className = 'npc-model';
		const name = document.createElement('div');
		name.className = 'npc-model-name';
		name.textContent = model.label;
		name.title = model.path || `Model file ${model.fdid}`;
		const variants = document.createElement('div');
		variants.className = 'npc-variants';
		model.variants.forEach((d, i) => {
			const element = document.createElement('button');
			element.className = 'texture-item';
			const img = document.createElement('img');
			img.width = 48;
			img.height = 48;
			img.alt = '';
			const caption = document.createElement('span');
			caption.textContent = `variant ${i + 1}`;
			element.append(img, caption);
			element.title = `${model.label} · variant ${i + 1} (display ${d.id})${d.humanoid ? '\nHumanoid: can be customized as a new NPC' : ''}${d.status === 'not-local' ? '\nNot downloaded in your install yet' : ''}`;
			if (d.status !== 'ok') {
				element.classList.add('greyed');
				element.disabled = true;
			} else {
				element.addEventListener('click', () => {
					this.selected = { appearance: { kind: 'creature', displayId: d.id }, label: `${model.label} ${i + 1}` };
					this.onPick(this.selected);
					this.syncSelection();
				});
			}
			if (this.selected?.appearance.kind === 'creature' && this.selected.appearance.displayId === d.id) element.classList.add('active');
			if (d.status === 'ok') this.queueThumb(element, 'creature', d.id, `creature:${d.id}`);
			variants.append(element);
		});
		box.append(name, variants);
		return box;
	}

	private queueThumb(element: HTMLElement, kind: 'creature' | 'npcPreset', fdid: number, key: string): void {
		const cached = sessionThumbs.get(key);
		const img = element.querySelector('img');
		if (cached && img) img.src = cached;
		else if (cached === undefined) {
			this.pending.set(element, { kind, fdid, key });
			this.observer.observe(element);
		}
	}

	private async drawThumb(element: HTMLElement, item: { kind: 'creature' | 'npcPreset'; fdid: number; key: string }): Promise<void> {
		if (sessionThumbs.has(item.key)) return;
		sessionThumbs.set(item.key, null);
		try {
			const bytes = await this.thumbs.thumbnail(item.kind, item.fdid, item.key);
			if (!bytes || this.disposed) return;
			const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
			sessionThumbs.set(item.key, url);
			const img = element.querySelector('img');
			if (img && element.isConnected) img.src = url;
		} catch {
			// Thumbnails are decoration; the names still work.
		}
	}

	private syncSelection(): void {
		const picked = this.selected;
		for (const element of $('npc-grid').querySelectorAll('button.texture-item')) {
			const match = picked?.appearance.kind === 'creature' && element.getAttribute('title')?.includes(`(display ${picked.appearance.displayId})`);
			element.classList.toggle('active', !!match);
		}
		for (const row of $('npc-presets').children) {
			row.classList.toggle('active', picked?.appearance.kind === 'custom' && (row as HTMLElement).dataset.id === picked.appearance.presetId);
		}
		$('npc-customize').hidden = !(picked?.appearance.kind === 'creature' && this.isHumanoid(picked.appearance.displayId));
	}

	// ---- Custom presets (spec 7.9.3) ----

	/** Shows the preset library's contents; called whenever it changes. */
	setPresets(presets: NpcPreset[]): void {
		this.presets = presets;
		const list = $('npc-presets');
		for (const row of list.children) {
			const pending = [...this.pending.keys()].filter((e) => row.contains(e));
			for (const e of pending) {
				this.observer.unobserve(e);
				this.pending.delete(e);
			}
		}
		list.replaceChildren(...presets.map((p) => this.makePresetRow(p)));
		$('npc-presets-empty').hidden = presets.length > 0;
		if (this.selected?.appearance.kind === 'custom' && !presets.some((p) => p.id === (this.selected!.appearance as { presetId: string }).presetId)) {
			this.selected = null;
			this.onPick(null);
		}
		this.syncSelection();
	}

	private makePresetRow(preset: NpcPreset): HTMLElement {
		const row = document.createElement('div');
		row.className = 'npc-preset-row';
		row.dataset.id = preset.id;
		row.title = `${preset.name}\nClick to pick it for placing`;
		const img = document.createElement('img');
		img.alt = '';
		const name = document.createElement('span');
		name.className = 'npc-preset-name';
		name.textContent = preset.name || 'Unnamed NPC';
		const actions = document.createElement('span');
		actions.className = 'npc-preset-actions';
		const action = (label: string, title: string, fn: () => void) => {
			const b = document.createElement('button');
			b.textContent = label;
			b.title = title;
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				fn();
			});
			return b;
		};
		actions.append(
			action('Edit', 'Change this NPC in the editor', () => this.hooks.onEdit(preset)),
			action('↓', 'Export as a .wnpc file', () => this.hooks.onExport(preset)),
			action('×', 'Delete this preset from your library', () => this.hooks.onDelete(preset)),
		);
		row.append(img, name, actions);
		row.addEventListener('click', () => {
			this.selected = { appearance: { kind: 'custom', presetId: preset.id }, label: preset.name || 'custom NPC' };
			this.onPick(this.selected);
			this.syncSelection();
		});
		if (this.selected?.appearance.kind === 'custom' && this.selected.appearance.presetId === preset.id) row.classList.add('active');
		this.queueThumb(row, 'npcPreset', this.hooks.handleOf(preset), presetThumbKey(preset));
		return row;
	}

	/** Drops a preset's cached thumbnail after an edit, so the list shows the new look. */
	forgetThumb(key: string): void {
		const url = sessionThumbs.get(key);
		if (url) URL.revokeObjectURL(url);
		sessionThumbs.delete(key);
	}

	/** Shows the Custom section (after making a new preset). */
	showCustom(): void {
		this.setTab('custom');
	}

	dispose(): void {
		this.disposed = true;
		this.observer.disconnect();
		this.pending.clear();
		this.thumbs.dispose();
		$('npc-grid').replaceChildren();
		$('npc-presets').replaceChildren();
		for (const id of ['npc-tab-creatures', 'npc-tab-custom', 'npc-refresh', 'npc-new', 'npc-import', 'npc-customize']) $(id).onclick = null;
		$('npc-search').oninput = null;
		$('npc-import-input').onchange = null;
	}
}
