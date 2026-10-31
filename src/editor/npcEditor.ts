import * as THREE from 'three';
import type { ModelData } from '../explorer/objects';
import type { CharacterModelInfo, CustomizationOption, HumanoidPreset } from '../explorer/npcs';
import type { EquipSlot, NpcPreset } from '../scene/types';
import {
	append,
	button,
	confirmDialog,
	el,
	iconButton,
	radioGroup,
	segmentedControl,
	select,
	setRadioOptionDisabled,
	setRadioValue,
	setSegmentedValue,
	setSelectOptions,
	setSelectValue,
	setTextValue,
	swatchPicker,
	textInput,
	type RadioGroupHandle,
	type SegmentedControlHandle,
	type SelectHandle,
	type TextInputHandle,
} from '../ui';
import { createModelMaterial, type SkinUniforms } from '../viewer/modelMaterials';
import { TextureCache } from '../viewer/textureCache';
import { supportsCompressedTextures } from '../viewer/textures';
import type { AsyncStorageApi } from '../worker/protocol';
import { GearBrowser, type GearEntry } from './gearBrowser';
import { listfile } from './listfile';

/** The equipment slots in the design's order (NPC Studio, View=Gear), with their labels. */
const SLOTS: [EquipSlot, string][] = [
	['mainHand', 'Main hand'], ['offHand', 'Off-hand'], ['ranged', 'Ranged'], ['head', 'Head'], ['shoulder', 'Shoulders'], ['back', 'Back'],
	['chest', 'Chest'], ['shirt', 'Shirt'], ['tabard', 'Tabard'], ['wrist', 'Wrists'], ['hands', 'Hands'], ['waist', 'Waist'], ['legs', 'Legs'], ['feet', 'Feet'],
];
/** Results a slot's type-ahead shows at once. */
const MAX_RESULTS = 40;
/** The preview rebuilds this long (ms) after the last change. */
const REBUILD_DELAY = 250;
/** World axes from a model's (x forward, y left, z up), as the portraits renderer uses. */
const MODEL_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
const FOV = 28;
const MARGIN = 1.1;

type StudioTab = 'appearance' | 'gear';

/**
 * The NPC studio (spec 7.9.3; design: NPC Studio `38:15826`, src/ui/specs/npc-studio.md): a
 * modal over the scene that builds an NpcPreset. The left column is a live, rotatable preview
 * playing the idle animation; the right rail holds two tabs, Appearance (name, title, race,
 * gender and the customization options from the modern ChrCustomization tables) and Gear (a
 * field per slot, searched by typing, browsed with pictures, or cleared), with the Browse Piece
 * view taking the rail's place while a slot is browsed. Save to library hands the preset back
 * for the library and the scene; Exit asks first when something changed.
 */
export class NpcEditor {
	private readonly root: HTMLDivElement;
	private readonly frame: HTMLElement;
	private readonly status: HTMLParagraphElement;
	private readonly form: HTMLDivElement;
	private readonly tabs: SegmentedControlHandle;
	private readonly appearancePane: HTMLDivElement;
	private readonly gearPane: HTMLDivElement;
	private readonly nameField: TextInputHandle;
	private readonly titleField: TextInputHandle;
	private readonly raceSelect: SelectHandle;
	private readonly gender: RadioGroupHandle;
	private readonly optionsBox: HTMLDivElement;
	private readonly gearBox: HTMLDivElement;
	private readonly preview: NpcPreview;
	private readonly browser: GearBrowser;
	private readonly resizer: ResizeObserver;
	private readonly cleanups: (() => void)[] = [];

	private draft: NpcPreset | null = null;
	/** The draft as opened (after its defaults were filled), to know whether anything changed. */
	private opened = '';
	private tab: StudioTab = 'appearance';
	private models: CharacterModelInfo[] = [];
	private options: CustomizationOption[] = [];
	private gear: GearEntry[] | null = null;
	private gearLoading: Promise<GearEntry[]> | null = null;
	private rebuildTimer = 0;
	/** Which build of the preview is current, so a slower earlier one doesn't replace it. */
	private buildSerial = 0;
	/** The exit dialog, while it asks. */
	private asking = false;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly hooks: {
			/** The worker handle a preset (or a draft of one) loads under. */
			handleOf: (preset: NpcPreset) => number;
			onSave: (preset: NpcPreset) => void;
			onNotice: (text: string) => void;
			/** The name a new NPC gets when none is typed, e.g. "Custom NPC 3". */
			nextName?: () => string;
		},
	) {
		// The frame: title row, the body (preview beside the rail), the footer.
		const titleId = 'npc-studio-title';
		const close = iconButton({ icon: 'close', label: 'Exit the NPC studio', variant: 'ghost', size: 'xs', onClick: () => void this.requestClose() });
		const header = el('div', { class: 'npc-studio-header' }, el('h2', { class: 'npc-studio-title', id: titleId }, 'NPC studio'), close);
		const canvas = el('canvas', { width: 371, height: 659, title: 'Drag to turn the model' });
		this.status = el('p', { class: 'npc-studio-status', role: 'status' });
		const previewPane = el('div', { class: 'npc-studio-preview' }, canvas, this.status);
		this.preview = new NpcPreview(canvas, storage);
		this.resizer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (width && height) this.preview.resize(width, height);
		});
		this.resizer.observe(previewPane);

		this.browser = new GearBrowser(storage, build, {
			handleOf: (preset) => hooks.handleOf(preset),
			onPick: (slot, display) => {
				if (!this.draft) return;
				this.draft.equipment[slot] = display;
				this.scheduleRebuild();
			},
			onBack: () => this.showForm(),
		});

		// The Appearance tab: name and title, race and gender, then the model's options.
		this.nameField = textInput({ label: 'Default name', placeholder: 'Custom NPC', maxLength: 60, autocomplete: 'off', onInput: (v) => this.draft && (this.draft.name = v) });
		this.titleField = textInput({
			label: 'Default title',
			optional: true,
			hint: 'i.e. <High Chieftain> or <King of Stormwind>',
			maxLength: 60,
			autocomplete: 'off',
			onInput: (v) => {
				if (!this.draft) return;
				if (v.trim()) this.draft.title = v;
				else delete this.draft.title;
			},
		});
		this.raceSelect = select({ label: 'Race', options: [], value: null, placeholder: 'Loading…', onChange: (v) => void this.setRaceSex(Number(v), this.draft?.sex ?? 0) });
		this.gender = radioGroup({
			name: 'npc-studio-sex',
			legend: 'Gender',
			options: [
				{ value: '0', label: 'Male' },
				{ value: '1', label: 'Female' },
			],
			value: '0',
			onChange: (v) => void this.setRaceSex(this.draft?.race ?? 1, Number(v) as 0 | 1),
		});
		this.optionsBox = el('div', { class: 'npc-studio-options' });
		this.appearancePane = el('div', { class: 'npc-studio-pane npc-studio-grid' }, this.nameField.root, this.titleField.root, this.raceSelect.root, this.gender.root, this.optionsBox);

		// The Gear tab: a field per slot.
		this.gearBox = el('div', { class: 'npc-studio-grid' });
		this.gearPane = el('div', { class: 'npc-studio-pane', hidden: true }, this.gearBox);

		this.tabs = segmentedControl({
			name: 'npc-studio-view',
			label: 'Studio view',
			options: [
				{ value: 'appearance', label: 'Appearance' },
				{ value: 'gear', label: 'Gear' },
			],
			value: this.tab,
			onChange: (v) => this.setTab(v === 'gear' ? 'gear' : 'appearance'),
		});
		this.form = el('div', { class: 'npc-studio-form' }, this.tabs.root, el('div', { class: 'npc-studio-panes ds-scroll' }, this.appearancePane, this.gearPane));
		const rail = el('div', { class: 'npc-studio-rail' }, this.form, this.browser.root);
		const body = el('div', { class: 'npc-studio-body' }, previewPane, rail);

		const exit = button({ label: 'Exit', variant: 'outline', size: 'md', onClick: () => void this.requestClose() });
		const save = button({ label: 'Save to library', variant: 'primary', size: 'md', onClick: () => this.save() });
		const footer = el('div', { class: 'npc-studio-footer' }, exit, save);

		this.frame = el('section', { class: 'npc-studio', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, header, body, footer);
		this.root = el('div', { class: 'npc-studio-scrim', id: 'npc-studio', hidden: true }, this.frame);
		// A click on the veil itself, outside the frame, is an Exit.
		this.root.addEventListener('click', (e) => {
			if (e.target === this.root) void this.requestClose();
		});
		document.body.append(this.root);

		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Escape' || !this.isOpen || this.asking) return;
			// A select's open list takes Escape first; a native dialog never lets it get here.
			if (document.querySelector('.ds-menu:not([hidden])')) return;
			e.stopPropagation();
			// Browsing a slot, Esc goes back to the gear tab; from the form, it is an Exit.
			if (this.browser.isOpen) this.showForm();
			else void this.requestClose();
		};
		window.addEventListener('keydown', onKey, true);
		this.cleanups.push(() => window.removeEventListener('keydown', onKey, true));
	}

	get isOpen(): boolean {
		return !this.root.hidden;
	}

	/**
	 * Opens the studio on a preset (a copy is edited), or on a new one, optionally prefilled
	 * from a humanoid display or another preset (Remix, spec 7.9.2).
	 */
	async open(preset: NpcPreset | null, prefill: HumanoidPreset | null = null, name = ''): Promise<void> {
		this.draft = preset ? structuredClone(preset) : { id: crypto.randomUUID(), name, race: prefill?.race ?? 1, sex: prefill?.sex ?? 0, customization: prefill ? { ...prefill.customization } : {}, equipment: prefill ? { ...prefill.equipment } : {} };
		this.opened = '';
		setTextValue(this.nameField.root, this.draft.name);
		this.nameField.input.placeholder = this.hooks.nextName?.() ?? 'Custom NPC';
		setTextValue(this.titleField.root, this.draft.title ?? '');
		this.setTab('appearance');
		this.showForm();
		this.root.hidden = false;
		this.setStatus('Loading the character models…');
		try {
			if (!this.models.length) this.models = await this.storage.characterModels();
		} catch (e) {
			this.hooks.onNotice(`The character models couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		const draft = this.draft;
		if (!draft) return;
		const races = new Map<number, string>();
		for (const m of this.models) races.set(m.race, m.name);
		setSelectOptions(this.raceSelect.root, [...races].map(([id, label]) => ({ value: String(id), label })));
		if (!races.has(draft.race)) draft.race = races.keys().next().value ?? 1;
		// Worn gear is labelled "display N" until the gear list arrives, then by name.
		void this.loadGear().then(() => {
			if (this.draft === draft) this.renderGear();
		});
		await this.setRaceSex(draft.race, draft.sex, true);
		if (this.draft !== draft) return;
		this.opened = snapshot(draft);
		this.preview.start();
		this.nameField.input.focus();
	}

	/** Closes without asking (the caller has decided). */
	close(): void {
		this.root.hidden = true;
		this.draft = null;
		this.opened = '';
		clearTimeout(this.rebuildTimer);
		this.preview.stop();
		this.showForm();
		this.optionsBox.replaceChildren();
		this.gearBox.replaceChildren();
		this.setStatus('');
	}

	/** Exit: closes at once when nothing changed, otherwise asks first (decided 2026-10-30). */
	private async requestClose(): Promise<void> {
		if (!this.isOpen || this.asking) return;
		if (!this.isDirty()) {
			this.close();
			return;
		}
		this.asking = true;
		try {
			const exit = await confirmDialog({
				title: 'Exit NPC studio?',
				message: 'Any changes you’ve made will be lost.',
				cancel: { label: 'Go back' },
				confirm: { label: 'Exit' },
			});
			if (exit) this.close();
		} finally {
			this.asking = false;
		}
	}

	private isDirty(): boolean {
		return this.draft !== null && this.opened !== '' && snapshot(this.draft) !== this.opened;
	}

	private setTab(tab: StudioTab): void {
		this.tab = tab;
		setSegmentedValue(this.tabs.root, tab);
		this.appearancePane.hidden = tab !== 'appearance';
		this.gearPane.hidden = tab !== 'gear';
	}

	/** Opens the Browse Piece view in the rail's place. */
	private async browse(slot: EquipSlot, label: string): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		const all = this.gear ?? (await this.loadGear());
		if (this.draft !== draft || !this.isOpen) return;
		this.form.hidden = true;
		this.browser.open(slot, label, all.filter((g) => g.slot === slot), draft.equipment[slot] ?? 0, { race: draft.race, sex: draft.sex });
	}

	/** Back from the Browse Piece view: the tabs again, the slot fields showing what is worn now. */
	private showForm(): void {
		const browsing = this.browser.isOpen;
		this.browser.close();
		this.form.hidden = false;
		if (browsing && this.draft) this.renderGear();
	}

	private setStatus(text: string): void {
		this.status.textContent = text;
	}

	/** A race or sex change: reloads the options (keeping choices that still apply) and the gear rows. */
	private async setRaceSex(race: number, sex: 0 | 1, keep = false): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		const sexes = this.models.filter((m) => m.race === race).map((m) => m.sex);
		if (sexes.length && !sexes.includes(sex)) sex = sexes[0]; // The other sex, if the race has only one model.
		draft.race = race;
		draft.sex = sex;
		setSelectValue(this.raceSelect.root, String(race));
		setRadioValue(this.gender.root, String(sex));
		for (const s of [0, 1] as const) setRadioOptionDisabled(this.gender.root, String(s), sexes.length > 0 && !sexes.includes(s));
		this.setStatus('Loading the customization…');
		try {
			this.options = await this.storage.customizationOptions(race, sex);
		} catch (e) {
			this.options = [];
			this.hooks.onNotice(`The customization options couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		if (this.draft !== draft) return;
		// Choices that aren't this model's are dropped; the builder takes each option's first instead.
		const valid = new Map(this.options.map((o) => [String(o.id), new Set(o.choices.map((c) => c.id))]));
		for (const [option, choice] of Object.entries(draft.customization)) {
			if (!valid.get(option)?.has(choice)) delete draft.customization[option];
		}
		if (!keep) for (const o of this.options) if (draft.customization[String(o.id)] === undefined) draft.customization[String(o.id)] = o.choices[0].id;
		this.renderOptions();
		this.renderGear();
		this.scheduleRebuild(true);
	}

	/** The customization options, two to a row: colours as swatch pickers, the rest as selects. */
	private renderOptions(): void {
		const draft = this.draft!;
		this.optionsBox.replaceChildren(
			...this.options.map((option) => {
				const current = draft.customization[String(option.id)] ?? option.choices[0].id;
				const pick = (choice: number) => {
					draft.customization[String(option.id)] = choice;
					this.scheduleRebuild();
				};
				// Colour options (skin, hair, eyes) show as swatches; a choice without one (a rare odd one out) is grey.
				const swatches = option.choices.filter((c) => c.swatch !== null).length >= option.choices.length / 2 && option.choices.every((c) => !c.name);
				if (swatches && option.choices.length <= 48) {
					return swatchPicker({
						label: option.name,
						name: `npc-studio-option-${option.id}`,
						options: option.choices.map((choice, i) => ({ value: String(choice.id), color: choice.swatch !== null ? `#${choice.swatch.toString(16).padStart(6, '0')}` : 'var(--color-border)', name: `${option.name} ${i + 1}` })),
						value: String(current),
						onChange: (v) => pick(Number(v)),
					}).root;
				}
				return select({
					label: option.name,
					title: `Option ${option.id}`,
					options: option.choices.map((c, i) => ({ value: String(c.id), label: c.name || `${i + 1}` })),
					value: String(current),
					onChange: (v) => pick(Number(v)),
				}).root;
			}),
		);
	}

	/** The gear list, fetched once with the item listfile for the nameless entries' labels. */
	private loadGear(): Promise<GearEntry[]> {
		this.gearLoading ??= (async () => {
			const [displays, paths] = await Promise.all([
				this.storage.gearDisplays(),
				listfile('item').then((entries) => new Map(entries.map((e) => [e.fdid, e.path])), () => new Map<number, string>()),
			]);
			const entries = displays.map((d): GearEntry => {
				const path = paths.get(d.file) ?? '';
				const stem = path.replace(/\.(blp|m2)$/, '').split('/').pop() ?? '';
				const label = d.name ?? (stem ? stem.replace(/_/g, ' ') : `display ${d.id}`);
				return { ...d, label, search: `${label} ${path} ${d.id}`.toLowerCase() };
			});
			this.gear = entries;
			return entries;
		})().catch((e) => {
			this.gearLoading = null;
			this.hooks.onNotice(`The gear list couldn't be read: ${e instanceof Error ? e.message : e}`);
			return [];
		});
		return this.gearLoading;
	}

	/** A field per slot: type to search, the magnifier to browse with pictures, the reset to wear nothing. */
	private renderGear(): void {
		const draft = this.draft!;
		this.gearBox.replaceChildren(
			...SLOTS.map(([slot, label]) => {
				const results = el('div', { class: 'npc-studio-suggest', role: 'listbox', 'aria-label': `${label} matches`, hidden: true });
				const field = textInput({ label, placeholder: 'None', autocomplete: 'off', spellcheck: false, title: `Type to search the ${label.toLowerCase()} gear` });
				const input = field.input;
				const showWorn = () => {
					const display = draft.equipment[slot];
					input.value = display ? this.gear?.find((g) => g.id === display)?.label ?? `display ${display}` : '';
				};
				showWorn();
				const wear = (display: number | null) => {
					if (display === null) delete draft.equipment[slot];
					else draft.equipment[slot] = display;
					results.hidden = true;
					showWorn();
					this.scheduleRebuild();
				};
				const search = async () => {
					const query = input.value.trim().toLowerCase();
					if (query.length < 2) {
						results.hidden = true;
						return;
					}
					const all = this.gear ?? (await this.loadGear());
					if (document.activeElement !== input) return;
					const tokens = query.split(/\s+/);
					const found = all.filter((g) => g.slot === slot && tokens.every((t) => g.search.includes(t)));
					const shown = found.slice(0, MAX_RESULTS);
					results.replaceChildren();
					append(
						results,
						...shown.map((g) => {
							const option = el('button', { type: 'button', class: 'npc-studio-suggest-option', role: 'option', title: `Item display ${g.id}${g.status !== 'ok' ? ' · not downloaded in your install' : ''}`, 'data-missing': g.status !== 'ok' ? 'true' : undefined }, g.name ? g.name : `${g.label} (${g.id})`);
							option.addEventListener('mousedown', (e) => e.preventDefault());
							option.addEventListener('click', () => wear(g.id));
							return option;
						}),
						!shown.length ? el('div', { class: 'npc-studio-suggest-note' }, 'Nothing matches') : null,
						found.length > shown.length ? el('div', { class: 'npc-studio-suggest-note' }, `${found.length - shown.length} more — type to narrow`) : null,
					);
					results.hidden = false;
				};
				input.addEventListener('input', () => void search());
				input.addEventListener('focus', () => {
					input.select();
					void search();
				});
				input.addEventListener('blur', () => {
					results.hidden = true;
					showWorn();
				});
				const browse = iconButton({ icon: 'search', label: `Browse the ${label.toLowerCase()} gear with pictures`, variant: 'secondary', size: 'sm', onClick: () => void this.browse(slot, label) });
				const clear = iconButton({ icon: 'reset', label: `Wear nothing in the ${label.toLowerCase()} slot`, variant: 'secondary', size: 'sm', onClick: () => wear(null) });
				return el('div', { class: 'npc-studio-slot' }, field.root, el('div', { class: 'npc-studio-slot-actions' }, browse, clear), results);
			}),
		);
	}

	/** Rebuilds the preview a moment after the last change (immediately when now is set). */
	private scheduleRebuild(now = false): void {
		clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => void this.rebuild(), now ? 0 : REBUILD_DELAY);
	}

	private async rebuild(): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		const serial = ++this.buildSerial;
		this.setStatus('Building the model…');
		try {
			const handle = this.hooks.handleOf(draft);
			const [data] = await this.storage.loadModels([{ fdid: handle, kind: 'npcPreset' }]);
			if (serial !== this.buildSerial || this.draft !== draft) return;
			if (!data) {
				this.setStatus('This race and sex have no model in your client');
				await this.preview.show(null);
				return;
			}
			await this.preview.show(data);
			if (serial !== this.buildSerial) return;
			this.setStatus(data.missingGear?.length ? `Gear not in your client, left off: ${data.missingGear.join(', ')}` : '');
		} catch (e) {
			if (serial === this.buildSerial) this.setStatus(`The model couldn't be built: ${e instanceof Error ? e.message : e}`);
		}
	}

	private save(): void {
		const draft = this.draft;
		if (!draft) return;
		draft.name = this.nameField.input.value.trim() || this.hooks.nextName?.() || `${this.models.find((m) => m.race === draft.race)?.name ?? 'Custom'} NPC`;
		const title = this.titleField.input.value.trim();
		if (title) draft.title = title;
		else delete draft.title;
		this.hooks.onSave(structuredClone(draft));
		this.close();
	}

	dispose(): void {
		this.close();
		this.resizer.disconnect();
		this.preview.dispose();
		this.browser.dispose();
		for (const c of this.cleanups) c();
		this.cleanups.length = 0;
		this.root.remove();
	}
}

/** What a draft is, for telling whether it changed. */
function snapshot(preset: NpcPreset): string {
	return JSON.stringify([preset.name, preset.title ?? '', preset.race, preset.sex, preset.customization, preset.equipment]);
}

/**
 * The studio's preview: the built model on a renderer of its own, lit from the front, playing
 * its Stand loop, turned by dragging, framed afresh whenever the pane is resized.
 */
class NpcPreview {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(FOV, 371 / 659, 0.05, 500);
	private readonly textures: TextureCache;
	private readonly clock = new THREE.Clock();
	private frame = 0;
	private yaw = Math.PI + 0.3;
	private shown: { mesh: THREE.Mesh; textures: number[]; boneTexture: THREE.DataTexture | null; skin: SkinUniforms | null; clip: { row: number; frames: number; duration: number } | null; time: number } | null = null;
	/** The shown model's standing height and width, for framing it again after a resize. */
	private extent: { height: number; width: number } | null = null;
	private dragging: { x: number; yaw: number } | null = null;

	constructor(private readonly canvas: HTMLCanvasElement, storage: AsyncStorageApi) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(canvas.width, canvas.height, false);
		this.renderer.setClearColor(0x000000, 0);
		this.textures = new TextureCache(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy());
		this.scene.add(new THREE.AmbientLight(0xffffff, 1.9));
		const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
		key.position.set(-1.5, 2, 3);
		const rim = new THREE.DirectionalLight(0xbfd4ff, 1.2);
		rim.position.set(2, 1.5, -2);
		this.scene.add(key, rim);
		canvas.addEventListener('mousedown', this.onDown);
		window.addEventListener('mousemove', this.onMove);
		window.addEventListener('mouseup', this.onUp);
	}

	private readonly onDown = (e: MouseEvent) => {
		if (e.button !== 0) return;
		this.dragging = { x: e.clientX, yaw: this.yaw };
		e.preventDefault();
	};

	private readonly onMove = (e: MouseEvent) => {
		if (this.dragging) this.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.012;
	};

	private readonly onUp = () => {
		this.dragging = null;
	};

	/** Fits the renderer to the pane (CSS pixels) and frames the model again. */
	resize(width: number, height: number): void {
		this.renderer.setSize(Math.round(width), Math.round(height), false);
		this.camera.aspect = width / height;
		this.frameModel();
		if (!this.frame && this.shown) this.renderer.render(this.scene, this.camera);
	}

	start(): void {
		this.stop();
		this.clock.start();
		const loop = () => {
			this.frame = requestAnimationFrame(loop);
			this.update(Math.min(this.clock.getDelta(), 0.1));
		};
		loop();
	}

	stop(): void {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		void this.show(null);
	}

	/** Replaces the shown model (null clears it). */
	async show(data: ModelData | null): Promise<void> {
		if (this.shown) {
			this.scene.remove(this.shown.mesh);
			this.shown.mesh.geometry.dispose();
			for (const m of this.shown.mesh.material as THREE.Material[]) m.dispose();
			this.shown.boneTexture?.dispose();
			this.textures.release(this.shown.textures);
			this.shown = null;
			this.extent = null;
		}
		if (!data) {
			this.renderer.render(this.scene, this.camera);
			return;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		let boneTexture: THREE.DataTexture | null = null;
		let skin: SkinUniforms | null = null;
		let clip: { row: number; frames: number; duration: number } | null = null;
		const a = data.animation;
		if (a) {
			geometry.setAttribute('boneIndex', new THREE.BufferAttribute(a.boneIndex, 4));
			geometry.setAttribute('boneWeight', new THREE.BufferAttribute(a.boneWeight, 4, true));
			boneTexture = new THREE.DataTexture(a.data, a.bones * 3, a.data.length / (a.bones * 12), THREE.RGBAFormat, THREE.FloatType);
			boneTexture.magFilter = boneTexture.minFilter = THREE.NearestFilter;
			boneTexture.needsUpdate = true;
			clip = a.clips[0];
			skin = { uBoneTex: { value: boneTexture as THREE.Texture }, uPoseA: { value: new THREE.Vector3(clip.row, clip.row, 0) }, uPoseB: { value: new THREE.Vector3(clip.row, clip.row, 0) }, uPoseMix: { value: 0 } };
		}
		const drawn = data.batches.filter((b) => !b.material.collision).sort((x, y) => x.order - y.order);
		const ids = [...new Set(drawn.map((b) => b.material.texture).filter((t) => t))];
		const textures = await this.textures.acquire(ids);
		if (this.shown) {
			// Another model arrived meanwhile.
			this.textures.release(ids);
			geometry.dispose();
			boneTexture?.dispose();
			return;
		}
		const materials = drawn.map((b, i) => {
			geometry.addGroup(b.start, b.count, i);
			return createModelMaterial(b.material, textures.get(b.material.texture) ?? null, false, skin);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = false;
		this.scene.add(mesh);
		this.shown = { mesh, textures: ids, boneTexture, skin, clip, time: 0 };
		// The header's bounding radius overstates most models, so it only ever adds up to the height.
		const height = Math.max(0.5, data.height);
		this.extent = { height, width: Math.min(height, Math.max(0.5, data.radius)) };
		this.frameModel();
	}

	/**
	 * Frames the model standing: back far enough for its height (model z) to fill the view, a
	 * little further for a wide one or a narrow pane.
	 */
	private frameModel(): void {
		const extent = this.extent ?? { height: 2, width: 1 };
		const half = THREE.MathUtils.degToRad(FOV / 2);
		const distance = Math.max((extent.height / 2) * MARGIN / Math.tan(half), (extent.width / 2) * MARGIN / Math.tan(half * this.camera.aspect)) + extent.width * 0.5;
		this.camera.position.set(0, extent.height * 0.5, distance);
		this.camera.lookAt(0, extent.height * 0.5, 0);
		this.camera.updateProjectionMatrix();
	}

	private update(dt: number): void {
		const s = this.shown;
		if (s) {
			s.mesh.matrix.makeRotationY(this.yaw).multiply(MODEL_BASIS);
			s.mesh.matrixWorldNeedsUpdate = true;
			if (s.skin?.uPoseA && s.clip) {
				s.time = (s.time + dt) % s.clip.duration;
				const at = (s.time / s.clip.duration) * s.clip.frames;
				const i = Math.min(Math.floor(at), s.clip.frames - 1);
				const next = i + 1 < s.clip.frames ? i + 1 : 0;
				s.skin.uPoseA.value.set(s.clip.row + i, s.clip.row + next, at - Math.floor(at));
			}
		}
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.stop();
		this.canvas.removeEventListener('mousedown', this.onDown);
		window.removeEventListener('mousemove', this.onMove);
		window.removeEventListener('mouseup', this.onUp);
		this.renderer.dispose();
	}
}
