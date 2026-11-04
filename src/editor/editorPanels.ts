import type { AsyncStorageApi } from '../worker/protocol';
import type { PaintMode } from './paint';
import type { RevertChannel } from './revert';
import type { SceneEditor, Tool } from './sceneEditor';
import type { Falloff, SculptMode } from './sculpt';
import type { Entity } from './objects';
import { ModelBrowser } from './modelBrowser';
import { ObjectNames } from './objectNames';
import { TextureBrowser } from './textureBrowser';
import { NpcLibrary, presetThumbKey } from './npcLibrary';
import { NpcEditor } from './npcEditor';
import type { NpcAsset } from './npcs';
import { PresetLibrary } from '../scene/presetLibrary';
import { NPC_POSES, SCENE_WEATHERS, type NpcPose, type NpcPreset, type PlacedNpc, type PlacedObject } from '../scene/types';
import { animationName } from '../formats/animationNames';
import { POSE_LABELS, poseSequences } from '../scene/npcPoses';
import { SideControls, dockModule, dockNote, dockRow, dockSelectionName, setModuleEmpty, type DockModule } from './sideControls';
import type { SceneControls } from './sceneControls';
import { MOD_PLACEHOLDER, onHotkeyFormatChange, resolveKeys } from './hotkeyFormat';
import {
	attachTooltip,
	button,
	confirmDialog,
	fieldShell,
	hotkeyList,
	type HotkeyListHandle,
	type HotkeyRow,
	el,
	type ModeId,
	toggleSwitch,
	radioGroup,
	type RadioGroupHandle,
	select,
	type SelectHandle,
	type SelectOption,
	setChecked,
	setDisabled,
	setHotkeyRows,
	setRadioValue,
	setSelectOptions,
	setSelectValue,
	setSliderValue,
	setStepperValue,
	setTextValue,
	slider,
	stepper,
	textInput,
} from '../ui';

/** The mode bar's chips and the editor tools they drive; Revert to base (copied scenes) has no chip. */
const TOOL_OF: Record<ModeId, Tool> = { environment: 'environment', sculpt: 'sculpt', paint: 'paint', water: 'water', holes: 'holes', objects: 'place', npcs: 'npcs' };

function modeOf(tool: Tool): ModeId | null {
	if (tool === 'place') return 'objects';
	if (tool === 'revert') return null;
	return tool;
}

/** The command key in a row, written as Cmd or Ctrl by the hotkey format when the list is made (hotkeyFormat.ts). */
const MOD = MOD_PLACEHOLDER;

const SHIFT_CLICK = (label: string): HotkeyRow => ({ label, keys: ['Shift'], tail: 'click' });
const MOD_CLICK = (label: string): HotkeyRow => ({ label, keys: [MOD], tail: 'click' });
const SIZE_KEYS: HotkeyRow[] = [
	{ label: '+ size', keys: [']'] },
	{ label: '- size', keys: ['['] },
];
const STRENGTH_KEYS: HotkeyRow[] = [
	{ label: '+ strength', keys: ['Shift', ']'] },
	{ label: '- strength', keys: ['Shift', '['] },
];
const OPACITY_KEYS: HotkeyRow[] = [
	{ label: '+ opacity', keys: [MOD, ']'] },
	{ label: '- opacity', keys: [MOD, '['] },
];
const HEIGHT_KEYS: HotkeyRow[] = [
	{ label: '+ height', keys: ['Shift', ']'] },
	{ label: '- height', keys: ['Shift', '['] },
];
/** The Objects and NPCs tools' editing keys (spec 8), as sceneEditor.ts binds them. */
const OBJECT_KEYS: HotkeyRow[] = [
	{ label: 'Next gizmo', keys: ['Space'] },
	{ label: 'Move gizmo', keys: ['W'] },
	{ label: 'Rotate gizmo', keys: ['E'] },
	{ label: 'Scale gizmo', keys: ['R'] },
	{ label: 'Add to selection', keys: ['Shift'], tail: 'click' },
	{ label: 'Box select', keys: [], tail: 'drag' },
	{ label: 'Drop to ground', keys: ['Shift', 'Space'] },
	{ label: 'Duplicate', keys: [MOD, 'D'] },
	{ label: 'Delete', keys: ['Del'] },
];

const SCULPT_KEYS: Record<SculptMode, HotkeyRow[]> = {
	raise: [SHIFT_CLICK('Raise'), MOD_CLICK('Lower')],
	lower: [SHIFT_CLICK('Raise'), MOD_CLICK('Lower')],
	smooth: [SHIFT_CLICK('Smooth')],
	flatten: [SHIFT_CLICK('Flatten')],
	noise: [SHIFT_CLICK('Add noise')],
	ramp: [SHIFT_CLICK('Set each end')],
};

const PAINT_KEYS: Record<PaintMode, HotkeyRow[]> = {
	paint: [SHIFT_CLICK('Paint')],
	erase: [SHIFT_CLICK('Erase')],
	fill: [SHIFT_CLICK('Fill')],
	base: [SHIFT_CLICK('Set base')],
	swap: [SHIFT_CLICK('Swap')],
};

/** The chip's radio option in the water Tool module: the brush (add or remove) or the flood fill. */
type WaterTool = 'brush' | 'flood';

/** What one tool puts in the panel: its title, its description line, its modules, and how to bring them in line with the model. */
interface ToolContent {
	title: string;
	description(): string | null;
	modules: HTMLElement[];
	sync(): void;
}

/**
 * The editing panels around the viewport (spec 8): the side panel controls (the mode column
 * beside the tool panel; design "Side Panel Controls", src/ui/specs/side-panel-controls.md),
 * and the play and undo state of the scene control panel (sceneControls.ts). Each tool's
 * modules are built once from the design system's molecules when the tool is first opened, and
 * brought in line with the editor's settings whenever they change elsewhere (shortcuts, undo, a
 * selection). One is made per open scene and disposed with it.
 */
export class EditorPanels {
	private readonly cleanups: (() => void)[] = [];
	private readonly dock: SideControls;
	/** Whether the editing panels are shown at all (not while the scene is closing). */
	private shown = false;
	private readonly contents = new Map<Tool, ToolContent>();

	private readonly textures: TextureBrowser;
	/** Whether the next plain click on the ground samples a chunk's textures (spec 7.5). */
	private sampling = false;
	/** Made when the Objects tool first opens, so its listfile parts aren't fetched before then. */
	private models: ModelBrowser | null = null;
	/** Names for the Attributes heading; a list arriving re-syncs the panel. */
	private readonly objectNames = new ObjectNames(() => this.syncActive());
	/** Made when the NPCs tool first opens (spec 7.9). */
	private npcLibrary: NpcLibrary | null = null;
	private npcEditor: NpcEditor | null = null;
	/** The sequences each NPC model can idle in (spec 7.9.1), by model, asked for once. */
	private readonly idleLists = new Map<string, Promise<number[]>>();
	/** Which fill of the idle select is current, so a slower earlier one doesn't replace it. */
	private idleSerial = 0;
	private readonly presets = new PresetLibrary();
	/** Every hotkey list in the modules with its rows, so a change of hotkey format rewrites them. */
	private readonly hotkeyLists = new Map<HTMLElement, HotkeyRow[]>();

	constructor(
		private readonly editor: SceneEditor,
		private readonly storage: AsyncStorageApi,
		private readonly controls: SceneControls,
	) {
		// The texture browser window first: setTool() below shows it when the Paint tool is active.
		this.textures = new TextureBrowser(storage, editor.paint.fdid, (fdid) => {
			editor.paint.fdid = fdid;
			this.syncActive();
		}, (text) => editor.onNotice(text), (on) => this.setSampling(on));
		this.dock = new SideControls({
			mode: modeOf(editor.tool),
			onMode: (mode) => this.setTool(TOOL_OF[mode]),
			shortcutsEnabled: () => !this.editor.playing,
		});
		document.body.append(this.dock.root);
		this.show(true);
		this.wireSelection();
		this.wireUndo();
		this.wirePlay();
		this.wireKeys();
		this.cleanups.push(onHotkeyFormatChange(() => this.refreshHotkeys()));
		this.setTool(editor.tool);
	}

	private show(on: boolean): void {
		this.shown = on;
		this.dock.show(on);
		this.syncWindows();
		if (!on) this.syncPlay(false);
	}

	// ---- Edit / Play (spec 7.10) ----

	/** The scene control panel's Play/Edit button is the one toggle, in the same place in both modes (spec 8). */
	private wirePlay(): void {
		this.editor.onPlayChange = (playing) => this.syncPlay(playing);
		this.cleanups.push(() => {
			this.editor.onPlayChange = () => {};
		});
		this.syncPlay(this.editor.playing);
	}

	/** Playing hides the side panel (by a body class, so the button stays put). */
	private syncPlay(playing: boolean): void {
		this.controls.setPlaying(playing);
		document.body.classList.toggle('playing', playing);
		this.syncWindows();
	}

	private listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
	private listen(target: HTMLElement, type: string, fn: (e: Event) => void): void;
	private listen(target: Window | HTMLElement, type: string, fn: (e: never) => void): void {
		target.addEventListener(type, fn as EventListener);
		this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
	}

	// ---- Tools ----

	/** Revert to base only applies to copied scenes (spec 7.11). */
	private get copied(): boolean {
		return this.editor.model.baseData !== null;
	}

	private setTool(tool: Tool): void {
		if (tool === 'revert' && !this.copied) return;
		this.editor.tool = tool;
		if (tool !== 'paint' && this.sampling) this.setSampling(false);
		if (tool === 'place' && !this.models) {
			this.models = new ModelBrowser(this.storage, this.editor.model.meta.client.build, (asset) => {
				this.editor.objects.place.asset = asset;
				this.syncActive();
			}, (text) => this.editor.onNotice(text));
		}
		if (tool === 'npcs' && !this.npcLibrary) this.makeNpcLibrary();
		this.dock.setMode(modeOf(tool));
		const content = this.content(tool);
		this.dock.setContent({ title: content.title, description: content.description(), modules: content.modules });
		content.sync();
		this.syncWindows();
	}

	/** The active tool's modules, built on first use. */
	private content(tool: Tool): ToolContent {
		let content = this.contents.get(tool);
		if (!content) {
			content = this.build(tool);
			this.contents.set(tool, content);
		}
		return content;
	}

	private build(tool: Tool): ToolContent {
		switch (tool) {
			case 'environment':
				return this.buildEnvironment();
			case 'sculpt':
				return this.buildSculpt();
			case 'paint':
				return this.buildPaint();
			case 'holes':
				return this.buildHoles();
			case 'water':
				return this.buildWater();
			case 'place':
				return this.buildObjects();
			case 'npcs':
				return this.buildNpcs();
			case 'revert':
				return this.buildRevert();
		}
	}

	/** Brings the open tool's modules and description in line with the model. */
	private syncActive(): void {
		const content = this.contents.get(this.editor.tool);
		if (!content) return;
		content.sync();
		this.dock.setDescription(content.description());
	}

	/**
	 * The browser windows (spec 7.3, 7.9) show only while editing with their tool: the Texture
	 * browser with Paint, the Object browser with Objects, the NPC library with NPCs.
	 */
	private syncWindows(): void {
		const editing = !this.editor.playing && this.shown;
		this.textures.setVisible(this.editor.tool === 'paint' && editing);
		this.models?.setVisible(this.editor.tool === 'place' && editing);
		this.npcLibrary?.setVisible(this.editor.tool === 'npcs' && editing);
	}

	// ---- Shared module builders ----

	/** A hotkey list whose command key follows the hotkey format, now and when it changes. */
	private keys(options: { heading?: string; rows: HotkeyRow[] }): HotkeyListHandle {
		const handle = hotkeyList({ heading: options.heading, rows: resolveRows(options.rows) });
		this.hotkeyLists.set(handle.root, options.rows);
		return handle;
	}

	/** Swaps a hotkey list's rows (when the selected mode changes), keeping them in the format. */
	private setKeys(root: HTMLElement, rows: HotkeyRow[]): void {
		this.hotkeyLists.set(root, rows);
		setHotkeyRows(root, resolveRows(rows));
	}

	private refreshHotkeys(): void {
		for (const [root, rows] of this.hotkeyLists) setHotkeyRows(root, resolveRows(rows));
	}

	/** A brush size module: the radius slider in yards and the [ ] hotkeys. */
	private sizeModule(max: number, get: () => number, set: (radius: number) => void): { module: DockModule; sync(): void } {
		const size = slider({ ariaLabel: 'Brush size', value: get(), min: 1, max, step: 1, suffix: 'yd', onInput: set });
		const module = dockModule({ title: 'Size', children: [size.root, this.keys({ heading: 'Hotkeys', rows: SIZE_KEYS }).root] });
		return { module, sync: () => setSliderValue(size.root, get()) };
	}

	/** A 0 to 1 setting shown as a percentage, with its hotkeys. */
	private percentModule(title: string, keys: HotkeyRow[], get: () => number, set: (value: number) => void): { module: DockModule; sync(): void } {
		const range = slider({ ariaLabel: title, value: Math.round(get() * 100), min: 0, max: 100, step: 5, suffix: '%', onInput: (v) => set(v / 100) });
		const module = dockModule({ title, children: [range.root, this.keys({ heading: 'Hotkeys', rows: keys }).root] });
		return { module, sync: () => setSliderValue(range.root, Math.round(get() * 100)) };
	}

	/** Attaches the complex tooltips to the info buttons of a radio group's options. */
	private infoTips(group: RadioGroupHandle, tips: Record<string, string>): void {
		for (const row of group.root.querySelectorAll<HTMLElement>('.ds-radio-row')) {
			const text = tips[row.dataset.value ?? ''];
			const anchor = row.querySelector<HTMLElement>('.ds-icon-button');
			if (text && anchor) attachTooltip(anchor, { variant: 'complex', text, placement: 'left' });
		}
	}

	/** Moves `nested` under the checked option's row, so its hotkeys and settings sit beneath it. */
	private nestUnder(group: RadioGroupHandle, value: string, nested: HTMLElement): void {
		const row = group.root.querySelector<HTMLElement>(`.ds-radio-row[data-value="${value}"]`);
		if (row && row.nextElementSibling !== nested) row.after(nested);
	}

	/** The terms a help tooltip explains, as a definition list. */
	private terms(entries: [string, string][]): HTMLElement {
		return el('dl', { class: 'dock-tip-terms' }, ...entries.flatMap(([term, text]) => [el('dt', {}, term), el('dd', {}, text)]));
	}

	// ---- Environment (spec 6.1, 7.7): weather, fog and shadows, ground clutter, time of day ----

	private buildEnvironment(): ToolContent {
		const editor = this.editor;
		const weather = radioGroup({
			name: 'env-weather',
			legend: 'Weather effects',
			legendHidden: true,
			options: [{ value: '', label: 'Clear' }, ...SCENE_WEATHERS.map((kind) => ({ value: kind, label: kind[0].toUpperCase() + kind.slice(1) }))],
			value: editor.environment.weather ?? '',
			onChange: (value) => {
				const kind = SCENE_WEATHERS.find((k) => k === value);
				editor.setEnvironment({ weather: kind }, kind ? `Set weather: ${kind}` : 'Clear the weather');
			},
		});
		const fog = toggleSwitch({
			label: 'Fog',
			checked: editor.environment.fogOn !== false,
			title: "The preset's distance fog and the fog lying in the valleys; off, the whole scene shows clear",
			onChange: (on) => editor.setEnvironment({ fogOn: on }, on ? 'Turn fog on' : 'Turn fog off'),
		});
		// Shadows are how the scene is viewed, not part of it: no command, and kept across scenes.
		const shadows = toggleSwitch({
			label: 'Shadows',
			checked: editor.shadows,
			title: "The sun's shadows, cast by the ground, buildings, doodads and NPCs and moving with the time of day; a view setting kept across scenes, not saved with the scene",
			onChange: (on) => (editor.shadows = on),
		});
		const weatherModule = dockModule({ title: 'Weather effects', children: [weather.root, fog.root, shadows.root] });

		const settings = editor.clutterSettings;
		// Switching clutter on also gives layers painted before the ground effect scan finished
		// the effect their texture usually carries (spec 7.7.2), so they grow clutter too.
		const clutterOn = toggleSwitch({
			label: 'Show clutter',
			checked: settings.enabled,
			onChange: (on) => {
				settings.enabled = on;
				if (on) editor.applyGroundEffects();
				editor.refreshClutter();
			},
		});
		const density = slider({
			label: 'Clutter density',
			value: Math.round(settings.density * 100),
			min: 0,
			max: 200,
			step: 10,
			suffix: '%',
			onInput: (v) => {
				settings.density = v / 100;
				editor.refreshClutter();
			},
		});
		const clutterModule = dockModule({
			title: 'Ground clutter',
			help: { text: 'Small shrubs or weeds that populate dynamically based on the textures you paint.' },
			children: [clutterOn.root, density.root],
		});

		// The slider is in minutes, on quarter hours; the scene keeps half-minutes. Dragging
		// previews each value; letting go records the whole drag as one command.
		let timeBefore: typeof editor.environment | null = null;
		const minutes = () => (Math.round(editor.environment.timeOfDay / 30) * 15) % 1440;
		const time = slider({
			ariaLabel: 'Time of day',
			value: minutes(),
			min: 0,
			max: 1425,
			step: 15,
			format: clock,
			title: "The scene's time of day: the sun, sky and fog follow it, as the game's light for the scene's zone has them",
			onInput: (m) => {
				timeBefore ??= { ...editor.environment };
				editor.previewEnvironment({ timeOfDay: m * 2 });
			},
			onChange: (m) => {
				const from = timeBefore ?? { ...editor.environment };
				timeBefore = null;
				editor.setEnvironment({ timeOfDay: m * 2 }, 'Set time of day', from);
			},
		});
		const timeModule = dockModule({ title: 'Time of day', children: [time.root] });

		const sync = () => {
			const env = editor.environment;
			setRadioValue(weather.root, env.weather ?? '');
			setChecked(fog.root, env.fogOn !== false);
			setChecked(shadows.root, editor.shadows);
			setChecked(clutterOn.root, settings.enabled);
			setSliderValue(density.root, Math.round(settings.density * 100));
			setSliderValue(time.root, minutes());
		};
		editor.onEnvironmentChange = sync;
		this.cleanups.push(() => {
			editor.onEnvironmentChange = () => {};
		});
		return { title: 'Environment', description: () => null, modules: [weatherModule.root, clutterModule.root, timeModule.root], sync };
	}

	// ---- Sculpt (spec 7.4) ----

	private buildSculpt(): ToolContent {
		const brush = this.editor.brush;
		const setting = radioGroup({
			name: 'sculpt-mode',
			legend: 'Sculpt setting',
			legendHidden: true,
			options: [
				{ value: 'raise', label: 'Raise/lower' },
				{ value: 'smooth', label: 'Smooth' },
				{ value: 'flatten', label: 'Flatten' },
				{ value: 'noise', label: 'Noise', info: { label: 'About noise', onClick: () => {} } },
				{ value: 'ramp', label: 'Ramp', info: { label: 'About ramps', onClick: () => {} } },
			],
			value: brush.mode === 'lower' ? 'raise' : brush.mode,
			onChange: (value) => {
				brush.mode = value as SculptMode;
				sync();
			},
		});
		this.infoTips(setting, {
			noise: 'Roughen up terrain surface with randomized fractal noise.',
			ramp: 'Ideal for sculpting an angled surface into terrain. To use, click a starting point then an ending point to create a smooth ramp between them.',
		});
		const keys = this.keys({ heading: 'Hotkeys', rows: SCULPT_KEYS[brush.mode] });
		const flatten = stepper({
			id: 'sculpt-flatten-to',
			label: 'Flatten to',
			value: brush.flattenTo,
			step: 1,
			placeholder: 'first touch',
			title: 'A height in yards; empty flattens toward the height you first touch',
			onChange: (v) => (brush.flattenTo = v),
		});
		const flattenField = fieldShell({ label: 'Flatten to (yd)', controlId: 'sculpt-flatten-to' }, flatten.root).root;
		const nested = el('div', { class: 'dock-nested' }, keys.root, flattenField);
		const settingModule = dockModule({ title: 'Sculpt setting', children: [setting.root] });

		const size = this.sizeModule(100, () => brush.radius, (r) => (brush.radius = r));
		const strength = this.percentModule('Strength', STRENGTH_KEYS, () => brush.strength, (v) => (brush.strength = v));

		const falloff = radioGroup({
			name: 'sculpt-falloff',
			legend: 'Falloff',
			legendHidden: true,
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'smooth', label: 'Smooth' },
				{ value: 'flat', label: 'Flat' },
			],
			value: brush.falloff,
			onChange: (value) => (brush.falloff = value as Falloff),
		});
		const falloffModule = dockModule({
			title: 'Falloff',
			help: {
				text: 'Determines how terrain is moved at the outer edges of your brush.',
				content: this.terms([
					['Linear', 'Fades evenly from full strength at the centre to nothing at the edge.'],
					['Smooth', 'Full strength near the centre, easing off toward the edge; usually what you want.'],
					['Flat', 'Full strength across the whole brush, with a hard edge.'],
				]),
			},
			children: [falloff.root],
		});

		const sync = () => {
			const mode = brush.mode === 'lower' ? 'raise' : brush.mode;
			setRadioValue(setting.root, mode);
			this.nestUnder(setting, mode, nested);
			this.setKeys(keys.root, SCULPT_KEYS[brush.mode]);
			flattenField.hidden = brush.mode !== 'flatten';
			setStepperValue(flatten.root, brush.flattenTo);
			size.sync();
			strength.sync();
			setRadioValue(falloff.root, brush.falloff);
		};
		return { title: 'Sculpt terrain', description: () => null, modules: [settingModule.root, size.module.root, strength.module.root, falloffModule.root], sync };
	}

	// ---- Paint (spec 7.5) ----

	private buildPaint(): ToolContent {
		const paint = this.editor.paint;
		const tool = radioGroup({
			name: 'paint-mode',
			legend: 'Tool',
			legendHidden: true,
			options: [
				{ value: 'paint', label: 'Brush' },
				{ value: 'erase', label: 'Eraser' },
				{ value: 'fill', label: 'Fill chunk' },
				{ value: 'base', label: 'Set chunk base', info: { label: 'About setting the chunk base', onClick: () => {} } },
			],
			value: paint.mode,
			onChange: (value) => {
				paint.mode = value as PaintMode;
				this.syncActive();
			},
		});
		this.infoTips(tool, { base: "Set a chunk's base texture that you paint on top of. The eraser won't affect a chunk's base texture." });
		const keys = this.keys({ heading: 'Hotkeys', rows: PAINT_KEYS[paint.mode] });
		const nested = el('div', { class: 'dock-nested' }, keys.root);
		const toolModule = dockModule({ title: 'Tool', children: [tool.root] });

		const size = this.sizeModule(100, () => paint.radius, (r) => (paint.radius = r));
		const strength = this.percentModule('Strength', STRENGTH_KEYS, () => paint.strength, (v) => (paint.strength = v));
		const opacity = this.percentModule('Opacity', OPACITY_KEYS, () => paint.opacity, (v) => (paint.opacity = v));

		const policy = radioGroup({
			name: 'paint-policy',
			legend: 'Full chunk',
			legendHidden: true,
			options: [
				{ value: 'replace', label: 'Replace weakest' },
				{ value: 'block', label: 'Block' },
			],
			value: paint.policy,
			onChange: (value) => (paint.policy = value as typeof paint.policy),
		});
		const policyModule = dockModule({
			title: 'Full chunk',
			help: {
				text: 'Determines what happens if you try and paint a new texture when a chunk is full.',
				content: this.terms([
					['Replace weakest', 'Whichever texture is least prominent will be replaced.'],
					['Block', "The new texture won't be applied until one of the existing textures is removed."],
				]),
			},
			children: [policy.root],
		});

		this.cleanups.push(() => {
			this.editor.onChunkClick = null;
		});
		const sync = () => {
			setRadioValue(tool.root, paint.mode);
			this.nestUnder(tool, paint.mode, nested);
			this.setKeys(keys.root, PAINT_KEYS[paint.mode]);
			size.sync();
			strength.sync();
			opacity.sync();
			setRadioValue(policy.root, paint.policy);
		};
		const description = () =>
			this.sampling
				? 'Click a chunk to list the textures it uses in the Texture browser; click one there to paint with it. Esc cancels.'
				: paint.fdid === 0 && paint.mode !== 'erase'
					? 'Pick a texture in the Texture browser to paint with.'
					: 'Paint up to four textures per chunk.';
		return { title: 'Paint terrain', description, modules: [toolModule.root, size.module.root, strength.module.root, opacity.module.root, policyModule.root], sync };
	}

	/**
	 * Sample chunk (spec 7.5): armed, the next plain click on the ground lists that chunk's
	 * textures in the Texture browser and disarms; Escape or the window's Cancel disarms too.
	 */
	private setSampling(on: boolean): void {
		if (on === this.sampling) return;
		this.sampling = on;
		this.textures.setSampling(on);
		this.editor.onChunkClick = on
			? (chunk) => {
					const fdids = chunk ? chunk.layers.map((l) => this.editor.model.textures[l.texture]).filter((fdid): fdid is number => fdid !== undefined) : [];
					this.setSampling(false);
					this.textures.showSample(fdids);
				}
			: null;
		this.syncActive();
	}

	// ---- Holes and water (spec 7.6) ----

	private buildHoles(): ToolContent {
		const holes = this.editor.holes;
		const keysModule = dockModule({ title: 'Hotkeys', children: [this.keys({ rows: [SHIFT_CLICK('Cut hole'), MOD_CLICK('Fill hole')] }).root] });
		const size = this.sizeModule(30, () => holes.radius, (r) => (holes.radius = r));
		return {
			title: 'Cut holes',
			description: () => 'Cut a hole in terrain to allow passage into structures like cave networks.',
			modules: [keysModule.root, size.module.root],
			sync: () => size.sync(),
		};
	}

	private buildWater(): ToolContent {
		const water = this.editor.water;
		const toolOf = (): WaterTool => (water.mode === 'flood' ? 'flood' : 'brush');
		const keysFor = (tool: WaterTool): HotkeyRow[] => (tool === 'flood' ? [SHIFT_CLICK('Flood a hollow')] : [SHIFT_CLICK('Add water'), MOD_CLICK('Remove water')]);
		const tool = radioGroup({
			name: 'water-tool',
			legend: 'Tool',
			legendHidden: true,
			options: [
				{ value: 'brush', label: 'Brush' },
				{ value: 'flood', label: 'Flood fill', info: { label: 'About flood fill', onClick: () => {} } },
			],
			value: toolOf(),
			onChange: (value) => {
				water.mode = value === 'flood' ? 'flood' : 'add';
				sync();
			},
		});
		this.infoTips(tool, { flood: 'Click a hollow: everything connected below the surface height fills, like a lake.' });
		const keys = this.keys({ heading: 'Hotkeys', rows: keysFor(toolOf()) });
		const nested = el('div', { class: 'dock-nested' }, keys.root);
		const toolModule = dockModule({ title: 'Tool', children: [tool.root] });

		const kind = radioGroup({
			name: 'water-kind',
			legend: 'Type',
			legendHidden: true,
			options: [
				{ value: '1', label: 'Water' },
				{ value: '2', label: 'Ocean' },
				{ value: '3', label: 'Magma (warning: ugly)' },
				{ value: '4', label: 'Slime (broken)', disabled: true },
			],
			value: String(water.kind),
			onChange: (value) => (water.kind = Number(value)),
		});
		const kindModule = dockModule({ title: 'Type', children: [kind.root] });

		const size = this.sizeModule(30, () => water.radius, (r) => (water.radius = r));

		const height = stepper({
			label: 'Surface height',
			value: water.height,
			step: 0.5,
			placeholder: 'auto',
			title: 'Surface height in yards; empty puts it a little above the ground you click',
			onChange: (v) => (water.height = v),
		});
		const heightModule = dockModule({
			title: 'Height',
			children: [dockNote('(empty = just above the clicked ground)'), el('div', { class: 'dock-row', 'data-align': 'center' }, height.root), this.keys({ heading: 'Hotkeys', rows: HEIGHT_KEYS }).root],
		});

		const sync = () => {
			const current = toolOf();
			setRadioValue(tool.root, current);
			this.nestUnder(tool, current, nested);
			this.setKeys(keys.root, keysFor(current));
			setRadioValue(kind.root, String(water.kind));
			size.sync();
			setStepperValue(height.root, water.height);
		};
		return { title: 'Water', description: () => 'Note: Water is a little buggy.', modules: [toolModule.root, kindModule.root, size.module.root, heightModule.root], sync };
	}

	// ---- Objects and NPCs (spec 7.8, 7.9): the selection's transform and attributes ----

	private wireSelection(): void {
		const objects = this.editor.objects;
		objects.onSelectionChange = () => this.syncActive();
		// One placement per pick: the browser lets go of the asset once it is in the scene.
		objects.onPlaced = () => {
			this.models?.clearPick();
			this.npcLibrary?.clearPick();
		};
		this.cleanups.push(() => {
			objects.onSelectionChange = () => {};
			objects.onPlaced = () => {};
		});
	}

	/** A number field that commits a transform edit to every selected entity (locked ones stay). */
	private transformField(label: string, suffix: string | undefined, commit: (value: number) => void): { root: HTMLElement; input: HTMLInputElement } {
		const field = textInput({
			label,
			type: 'number',
			suffix,
			onChange: (text) => {
				const value = Number(text);
				if (text.trim() === '' || Number.isNaN(value)) {
					this.syncActive();
					return;
				}
				commit(value);
			},
		});
		return field;
	}

	/**
	 * The Transform module: position, rotation (an object's yaw, an NPC's facing) and scale of
	 * everything selected, "Mixed" where they differ, dimmed with a note while nothing is.
	 */
	private buildTransform(): { module: DockModule; sync(entities: Entity[]): void } {
		const objects = this.editor.objects;
		const axis = (name: string, index: number) =>
			this.transformField(name, undefined, (v) => objects.editSelection(`Move along ${name}`, (after) => (after.position[index] = v)));
		const x = axis('X', 0);
		const y = axis('Y', 1);
		const z = axis('Z', 2);
		const rotation = this.transformField('Rotation', 'degrees', (v) => objects.editSelection('Rotate', (after) => (after.rotation[1] = v)));
		const scale = this.transformField('Scale', undefined, (v) =>
			objects.editSelection('Scale', (after, e) => {
				if (e.kind === 'object' && e.o.kind === 'wmo') return;
				after.scale = Math.max(0.05, v);
			}),
		);
		const note = dockNote("Buildings can't be scaled.");
		const module = dockModule({
			title: 'Transform',
			emptyText: 'Make a selection to edit transform properties.',
			children: [dockRow(x.root, y.root, z.root), rotation.root, scale.root, note],
		});
		const fields = [x, y, z, rotation, scale];

		const show = (field: { input: HTMLInputElement }, values: number[]) => {
			if (document.activeElement === field.input) return;
			const first = values[0];
			const same = values.every((v) => Math.abs(v - first) < 1e-6);
			field.input.value = same && values.length ? String(Math.round(first * 100) / 100) : '';
			field.input.placeholder = values.length && !same ? 'Mixed' : '';
		};
		const sync = (entities: Entity[]) => {
			setModuleEmpty(module, entities.length === 0);
			if (!entities.length) {
				for (const field of fields) {
					field.input.value = '';
					field.input.placeholder = '';
				}
				note.hidden = true;
				return;
			}
			const positions = entities.map((e) => (e.kind === 'npc' ? e.n.position : e.o.position));
			show(x, positions.map((p) => p[0]));
			show(y, positions.map((p) => p[1]));
			show(z, positions.map((p) => p[2]));
			show(rotation, entities.map((e) => (e.kind === 'npc' ? ((e.n.facing % 360) + 360) % 360 : e.o.rotation[1])));
			const scalable = entities.filter((e) => !(e.kind === 'object' && e.o.kind === 'wmo'));
			show(scale, scalable.map((e) => (e.kind === 'npc' ? e.n.scale : e.o.scale)));
			scale.input.disabled = scalable.length === 0;
			note.hidden = scalable.length === entities.length;
		};
		return { module, sync };
	}

	/**
	 * The rows every Attributes module ends with: locked and the selection count. (The Group
	 * field is out until grouping gets a place of its own in the UI; groups already in a scene
	 * still select together.)
	 */
	private commonAttributes(): { rows: HTMLElement[]; sync(entities: Entity[]): void } {
		const objects = this.editor.objects;
		const locked = toggleSwitch({ label: 'Locked', title: 'Locked objects and NPCs are skipped by moves, edits and Delete', onChange: (on) => objects.setLocked(on) });
		const count = dockNote('');
		const sync = (entities: Entity[]) => {
			const items = entities.map((e) => (e.kind === 'npc' ? e.n : e.o));
			setChecked(locked.root, items.length > 0 && items.every((o) => o.locked));
			const selected = objects.selectedObjects().length;
			const npcs = objects.selectedNpcs().length;
			const parts: string[] = [];
			if (selected) parts.push(`${selected} object${selected === 1 ? '' : 's'}`);
			if (npcs) parts.push(`${npcs} NPC${npcs === 1 ? '' : 's'}`);
			count.textContent = `${parts.join(' and ') || 'Nothing'} selected · ${objects.count} objects and ${objects.npcCount} NPCs in the scene`;
		};
		return { rows: [locked.root, count], sync };
	}

	/**
	 * The heading over an Attributes module: what is selected, by name. One thing, or several of
	 * the same thing, shows its name (an NPC's, or its creature; an object's file); different
	 * things show "Multiple selections".
	 */
	private selectionName(entities: Entity[]): string {
		const names = new Set(
			entities.map((e) => {
				if (e.kind === 'object') return this.objectNames.nameOf(e.o.kind, e.o.fdid);
				const npc = e.n;
				return npc.name?.trim() || this.npcLibrary?.describe(npc.appearance) || (npc.appearance.kind === 'creature' ? `Creature display ${npc.appearance.displayId}` : 'Custom NPC');
			}),
		);
		return names.size === 1 ? [...names][0] : names.size > 1 ? 'Multiple selections' : '';
	}

	private buildObjects(): ToolContent {
		const objects = this.editor.objects;
		const place = objects.place;
		const keysModule = dockModule({ title: 'Hotkeys', children: [this.keys({ rows: OBJECT_KEYS }).root] });
		const transform = this.buildTransform();

		// Attributes: a building's doodad and name sets (spec 7.8), then the common rows.
		const doodadSet = select({
			label: 'Doodad set',
			options: [],
			value: null,
			placeholder: 'Buildings only',
			title: "Which of the building's doodad sets shows inside, besides set 0",
			onChange: (value) => objects.setDoodadSet(Number(value)),
		});
		const nameSet = stepper({
			id: 'sel-nameset',
			label: 'Name set',
			value: 0,
			min: 0,
			step: 1,
			title: "Which name set the building's rooms use",
			onChange: (v) => objects.setNameSet(Math.max(0, Math.round(v ?? 0))),
		});
		const nameSetField = fieldShell({ label: 'Name set', controlId: 'sel-nameset' }, el('div', { class: 'dock-row' }, nameSet.root)).root;
		const common = this.commonAttributes();
		const revert = button({ label: 'Revert to base', title: 'Put the selected copied objects back where the source map has them', onClick: () => objects.revertSelectionToBase() });
		const restore = button({ title: 'Bring back the copied objects you deleted', label: 'Restore deleted copied objects', onClick: () => objects.restoreDeleted() });
		const heading = dockSelectionName();
		const attributes = dockModule({
			title: 'Attributes',
			emptyText: 'Make a selection to edit attributes.',
			children: [heading, doodadSet.root, nameSetField, ...common.rows, revert, restore],
		});

		// Placement settings (spec 7.8), for the next asset dropped from the Object browser.
		const randomYaw = toggleSwitch({ label: 'Random rotation', checked: place.randomYaw, title: 'Placed doodads face a random way', onChange: (on) => (place.randomYaw = on) });
		const angleSnap = toggleSwitch({ label: '15° angle snap', checked: place.angleSnap, title: 'Snaps the rotate gizmo to 15° steps', onChange: (on) => (place.angleSnap = on) });
		const scaleMin = stepper({ id: 'place-scale-min', label: 'Smallest scale', value: place.scaleMin, min: 0.05, max: 10, step: 0.05, onChange: (v) => (place.scaleMin = v ?? 1) });
		const scaleMax = stepper({ id: 'place-scale-max', label: 'Largest scale', value: place.scaleMax, min: 0.05, max: 10, step: 0.05, onChange: (v) => (place.scaleMax = v ?? 1) });
		const scaleField = fieldShell({ label: 'Scale range', controlId: 'place-scale-min' }, dockRow(scaleMin.root, scaleMax.root)).root;
		scaleField.title = 'Placed doodads pick a random size between these';
		const snap = select({
			label: 'Grid snap',
			options: [
				{ value: '0', label: 'Off' },
				{ value: '0.5', label: '0.5 yd' },
				{ value: '1', label: '1 yd' },
				{ value: '5', label: '5 yd' },
			],
			value: String(place.gridSnap),
			title: 'Snaps placement and the move gizmo to a grid',
			onChange: (value) => (place.gridSnap = Number(value)),
		});
		const placement = dockModule({ title: 'Placement', children: [randomYaw.root, angleSnap.root, scaleField, snap.root] });

		const sync = () => {
			const entities = objects.selectedEntities();
			transform.sync(entities);
			setModuleEmpty(attributes, entities.length === 0);
			heading.textContent = this.selectionName(entities);
			// The WMO set choices show for a single selected building (spec 7.8).
			const selected = objects.selectedObjects();
			const wmo = entities.length === 1 && selected.length === 1 && selected[0].kind === 'wmo' ? selected[0] : null;
			this.syncDoodadSet(doodadSet, wmo);
			nameSetField.hidden = !wmo;
			if (wmo) setStepperValue(nameSet.root, wmo.nameSet ?? 0);
			common.sync(entities);
			revert.hidden = objects.revertableCount === 0;
			const deleted = objects.deletedBaseCount;
			restore.hidden = deleted === 0;
			restore.querySelector('.ds-button-label')!.textContent = `Restore ${deleted} deleted copied object${deleted === 1 ? '' : 's'}`;
			setChecked(randomYaw.root, place.randomYaw);
			setChecked(angleSnap.root, place.angleSnap);
			setStepperValue(scaleMin.root, place.scaleMin);
			setStepperValue(scaleMax.root, place.scaleMax);
			setSelectValue(snap.root, String(place.gridSnap));
		};
		return { title: 'Objects', description: () => null, modules: [keysModule.root, transform.module.root, attributes.root, placement.root], sync };
	}

	/** Fills the doodad set select for one building, or disables it. */
	private syncDoodadSet(field: SelectHandle, wmo: PlacedObject | null): void {
		const sets = wmo ? this.editor.objects.doodadSets(wmo) : null;
		const options: SelectOption[] = sets
			? sets.map((name, i) => ({ value: String(i), label: `${i} · ${name || 'unnamed'}${i === 0 ? ' (always shown)' : ''}` }))
			: wmo
				? [{ value: '', label: 'Loading…' }]
				: [];
		setSelectOptions(field.root, options);
		setSelectValue(field.root, wmo ? (sets ? String(wmo.doodadSet ?? 0) : '') : null);
		const enabled = wmo !== null && sets !== null;
		field.trigger.disabled = !enabled;
		field.root.toggleAttribute('aria-disabled', !enabled);
	}

	private buildNpcs(): ToolContent {
		const editor = this.editor;
		const objects = editor.objects;
		const settings = objects.npcPlace;
		const keysModule = dockModule({ title: 'Hotkeys', children: [this.keys({ rows: OBJECT_KEYS }).root] });
		const transform = this.buildTransform();

		// Attributes (spec 7.9.1): name, title, pose, idle, the look, then the common rows. (Changing
		// the look to the library's pick comes back with a place of its own in a later phase.)
		const names = () => objects.setNpcName(name.input.value, title.input.value);
		const name = textInput({ label: 'Name', placeholder: 'unnamed', title: 'Shown on the nameplate in play mode', onChange: names });
		const title = textInput({ label: 'Title', placeholder: 'e.g. <Innkeeper>', onChange: names });
		const pose = select({
			label: 'Pose',
			options: [],
			value: null,
			title: 'How the NPC holds itself; idle animations apply while standing',
			onChange: (value) => {
				if (value === '-1') return;
				objects.setNpcPose((value || null) as NpcPose | null, value ? POSE_LABELS[value as NpcPose] : 'Standing');
			},
		});
		const idle = select({
			label: 'Idle animation',
			options: [],
			value: null,
			title: 'The animation the NPC loops while standing about, from those its model has',
			onChange: (value) => {
				const id = Number(value) || 0;
				objects.setNpcIdle(id, id ? animationName(id) : 'Stand');
			},
		});
		const look = dockNote('');
		const common = this.commonAttributes();
		const heading = dockSelectionName();
		const attributes = dockModule({
			title: 'Attributes',
			emptyText: 'Make a selection to edit attributes.',
			children: [heading, name.root, title.root, pose.root, idle.root, look, ...common.rows],
		});

		// The play-mode avatar (spec 7.10): the picked appearance, or the default.
		const picked = dockNote('');
		const playing = dockNote('');
		const playAs = button({ label: 'Play as the picked one', title: 'Play the scene as the picked creature or custom NPC (spec 7.10)', onClick: () => settings.asset && editor.setPlayer(settings.asset.appearance) });
		const playDefault = button({ label: 'Default avatar', title: 'Back to the default avatar, a human', onClick: () => editor.setPlayer(null) });
		const avatar = dockModule({ title: 'Player avatar', children: [picked, playing, playAs, playDefault] });
		editor.onPlayerChange = () => this.syncActive();
		this.cleanups.push(() => {
			editor.onPlayerChange = () => {};
		});

		const sync = () => {
			const entities = objects.selectedEntities();
			transform.sync(entities);
			// NPC attributes show while any NPC is selected; the fields follow the last one.
			const npcs = objects.selectedNpcs();
			setModuleEmpty(attributes, npcs.length === 0);
			heading.textContent = this.selectionName(npcs.map((n): Entity => ({ kind: 'npc', n })));
			const npc = npcs[npcs.length - 1];
			if (npc) {
				const active = document.activeElement;
				if (active !== name.input) setTextValue(name.root, npcs.every((n) => n.name === npc.name) ? (npc.name ?? '') : '');
				if (active !== title.input) setTextValue(title.root, npcs.every((n) => n.subName === npc.subName) ? (npc.subName ?? '') : '');
				this.syncNpcIdle(pose, idle, npcs);
				look.textContent = this.npcLibrary?.describe(npc.appearance) ?? (npc.appearance.kind === 'creature' ? `Creature display ${npc.appearance.displayId}` : 'Custom NPC');
			}
			common.sync(npcs.map((n): Entity => ({ kind: 'npc', n })));
			picked.textContent = settings.asset ? `Placing ${settings.asset.label}: click the ground to place it facing you.` : 'Nothing picked yet: pick an NPC in the NPC library.';
			const player = editor.model.meta.player;
			playing.textContent = `Playing as ${player ? (this.npcLibrary?.describe(player) ?? (player.kind === 'creature' ? `creature display ${player.displayId}` : 'a custom NPC')) : 'the default avatar (a human)'}`;
			setDisabled(playAs, !settings.asset);
			setDisabled(playDefault, !player);
		};
		return { title: 'NPCs', description: () => null, modules: [keysModule.root, transform.module.root, attributes.root, avatar.root], sync };
	}

	/**
	 * The pose and idle selects (spec 7.9.1). Pose: standing, or a held pose, with those the
	 * model has no sequence for marked. Idle: the sequences the selected NPCs' model has, by
	 * name, Stand first, with the chosen one selected; disabled while the NPCs hold a pose, since
	 * the idle applies only standing. Both are offered only while every selected NPC shares one
	 * model, since each model has sequences of its own.
	 */
	private syncNpcIdle(poseField: SelectHandle, idleField: SelectHandle, npcs: PlacedNpc[]): void {
		const layer = this.editor.objects.npcs;
		const npc = npcs[npcs.length - 1];
		// '' standing, '-1' varies.
		const pose = npcs.every((n) => (n.pose ?? '') === (npc.pose ?? '')) ? (npc.pose ?? '') : '-1';
		const poseOptions = (has: (ids: number[]) => boolean): SelectOption[] => [
			{ value: '', label: 'Standing' },
			...NPC_POSES.map((p) => {
				const missing = !has(poseSequences(p));
				return { value: p, label: missing ? `${POSE_LABELS[p]} (not in this model, stands instead)` : POSE_LABELS[p], disabled: missing && pose !== p };
			}),
			...(pose === '-1' ? [{ value: '-1', label: 'Varies' }] : []),
		];
		const fill = (field: SelectHandle, options: SelectOption[], value: string, enabled: boolean) => {
			setSelectOptions(field.root, options);
			setSelectValue(field.root, value);
			field.trigger.disabled = !enabled;
			field.root.toggleAttribute('aria-disabled', !enabled);
		};
		const model = layer.modelOf(npc.appearance);
		const key = model ? `${model.kind}:${model.fdid}` : null;
		const shared = model !== null && npcs.every((n) => {
			const m = layer.modelOf(n.appearance);
			return m !== null && m.kind === model.kind && m.fdid === model.fdid;
		});
		// -1: the selection idles in more than one way.
		const idle = npcs.every((n) => (n.idle ?? 0) === (npc.idle ?? 0)) ? (npc.idle ?? 0) : -1;
		const serial = ++this.idleSerial;
		if (!shared || !model) {
			fill(idleField, [{ value: '', label: key ? 'Varies by model' : 'Model not in this scene' }], '', false);
			fill(poseField, poseOptions(() => true), pose, false);
			return;
		}
		let list = this.idleLists.get(key!);
		if (!list) {
			list = this.storage.npcSequences(model.kind, model.fdid).catch((e) => {
				this.idleLists.delete(key!);
				this.editor.onNotice(`The model's animations couldn't be read: ${e instanceof Error ? e.message : e}`);
				return [];
			});
			this.idleLists.set(key!, list);
		}
		fill(idleField, [{ value: String(idle), label: 'Loading…' }], String(idle), false);
		fill(poseField, poseOptions(() => true), pose, false);
		void list.then((ids) => {
			if (serial !== this.idleSerial) return;
			fill(poseField, poseOptions((sequences) => sequences.some((s) => ids.includes(Math.abs(s)))), pose, true);
			const named = ids.filter((id) => id !== 0).map((id) => ({ id, name: animationName(id) })).sort((a, b) => a.name.localeCompare(b.name));
			const options: SelectOption[] = [{ value: '0', label: 'Stand (default)' }, ...named.map((n) => ({ value: String(n.id), label: n.name }))];
			// A chosen sequence this model turns out to lack (the look was changed since) still shows, so it can be seen and reset.
			if (idle > 0 && !ids.includes(idle)) options.push({ value: String(idle), label: `${animationName(idle)} (not in this model, stands instead)` });
			if (idle < 0) options.unshift({ value: '-1', label: 'Varies' });
			// Posed NPCs keep their idle for when they stand again, but can't change it meanwhile.
			fill(idleField, options, String(idle), pose === '');
		});
	}

	/** Arms an appearance for placing; a custom one is embedded in the scene first (spec 6.6). */
	private pickNpc(asset: NpcAsset | null, presets: NpcPreset[]): void {
		if (asset?.appearance.kind === 'custom') {
			const preset = presets.find((p) => p.id === (asset.appearance as { presetId: string }).presetId);
			if (preset) this.editor.model.setPreset(preset);
		}
		this.editor.objects.npcPlace.asset = asset;
		this.syncActive();
	}

	private makeNpcLibrary(): void {
		const editor = this.editor;
		let library: NpcPreset[] = [];
		const refreshPresets = async () => {
			try {
				library = await this.presets.list();
			} catch (e) {
				editor.onNotice(`The NPC preset library can't be read: ${e instanceof Error ? e.message : e}`);
			}
			// Presets embedded in this scene but gone from the library stay offered, so the scene's NPCs can still be re-dressed.
			const embedded = editor.model.npcPresets.filter((p) => !library.some((l) => l.id === p.id));
			this.npcLibrary?.setPresets([...library, ...embedded]);
		};
		const browser = new NpcLibrary(this.storage, editor.model.meta.client.build, (asset) => this.pickNpc(asset, [...library, ...editor.model.npcPresets]), (text) => editor.onNotice(text), {
			handleOf: (preset) => editor.objects.npcs.handle(preset),
			onNew: () => void this.openNpcEditor(null),
			onEdit: (preset) => void this.openNpcEditor(preset),
			// Remix: a new NPC that starts as this one (the studio gives it a fresh id).
			onRemixPreset: (preset) => void this.openNpcEditor(null, { race: preset.race, sex: preset.sex, customization: { ...preset.customization }, equipment: { ...preset.equipment } }, `${preset.name || 'Custom NPC'} (remix)`),
			// Flow 2.3.4 draws no confirmation; the dialog's destructive shape asks (npc-library.md §5).
			onDelete: (preset) => {
				void confirmDialog({
					title: `Delete "${preset.name || 'Custom NPC'}"?`,
					message: 'Scenes that use it keep their own copy.',
					cancel: { label: 'Keep it' },
					confirm: { label: 'Delete', destructive: true },
				}).then((yes) => {
					if (yes) return this.presets.delete(preset.id).then(refreshPresets, (e) => editor.onNotice(`Deleting failed: ${e instanceof Error ? e.message : e}`));
				});
			},
			onExport: (preset) => download(`${preset.name || 'npc'}.wnpc`, PresetLibrary.export(preset), 'application/json'),
			onImport: (file) => {
				void file.arrayBuffer().then((bytes) => this.presets.import(new Uint8Array(bytes))).then(refreshPresets, (e) => editor.onNotice(e instanceof Error ? e.message : String(e)));
			},
			onRemixDisplay: (displayId) => {
				void this.storage.humanoidPreset(displayId).then((prefill) => {
					if (!prefill) {
						editor.onNotice('That display has no character race and sex to remix');
						return;
					}
					return this.openNpcEditor(null, prefill, `${browser.describe({ kind: 'creature', displayId }).split(' (')[0]} (custom)`);
				}, (e) => editor.onNotice(`Remix failed: ${e instanceof Error ? e.message : e}`));
			},
		});
		this.npcLibrary = browser;
		void refreshPresets();
		this.npcEditor = new NpcEditor(this.storage, editor.model.meta.client.build, {
			handleOf: (preset) => editor.objects.npcs.handle(preset),
			onNotice: (text) => editor.onNotice(text),
			// The name placeholder counts the library: "Custom NPC 3" when two exist (npc-studio.md §2).
			nextName: () => `Custom NPC ${library.length + 1}`,
			onSave: (preset) => {
				void this.presets.save(preset).catch((e) => editor.onNotice(`Saving the preset failed: ${e instanceof Error ? e.message : e}. It is still embedded in this scene.`));
				browser.forgetThumb(presetThumbKey(preset));
				// NPCs wearing an edited preset change with it (spec 6.6: the scene keeps its own copy).
				if (editor.model.preset(preset.id)) {
					editor.model.setPreset(preset);
					editor.objects.refreshPreset(preset.id);
				}
				void refreshPresets().then(() => {
					browser.showLocal();
					this.pickNpc({ appearance: { kind: 'custom', presetId: preset.id }, label: preset.name }, [preset, ...library]);
				});
			},
		});
	}

	private async openNpcEditor(preset: NpcPreset | null, prefill: Parameters<NpcEditor['open']>[1] = null, name = ''): Promise<void> {
		await this.npcEditor?.open(preset, prefill, name);
	}

	// ---- Revert to base (spec 7.11), copied scenes only: key 8, no chip ----

	private buildRevert(): ToolContent {
		const revert = this.editor.revert;
		const labels: Record<RevertChannel, string> = { heights: 'Heights', vertexShade: 'Vertex shading', paint: 'Textures', holes: 'Holes', water: 'Water' };
		const switches = (Object.keys(revert.channels) as RevertChannel[]).map((channel) =>
			toggleSwitch({ label: labels[channel], checked: revert.channels[channel], onChange: (on) => (revert.channels[channel] = on) }),
		);
		const channels = dockModule({ title: 'What goes back', children: switches.map((s) => s.root) });
		const keysModule = dockModule({ title: 'Hotkeys', children: [this.keys({ rows: [SHIFT_CLICK('Revert')] }).root] });
		const size = this.sizeModule(100, () => revert.radius, (r) => (revert.radius = r));
		return {
			title: 'Revert to base',
			description: () => 'Revert to base puts the chunks the brush passes over back the way the source map has them. Keys 1 to 7 go back to the other tools.',
			modules: [channels.root, keysModule.root, size.module.root],
			sync: () => {
				(Object.keys(revert.channels) as RevertChannel[]).forEach((channel, i) => setChecked(switches[i].root, revert.channels[channel]));
				size.sync();
			},
		};
	}

	// ---- Undo and redo ----

	/** The scene control panel's Undo and Redo follow the command history. */
	private wireUndo(): void {
		const commands = this.editor.commands;
		const refresh = () => {
			this.controls.setUndo(commands.canUndo ? (commands.undoLabel ?? '') : null);
			this.controls.setRedo(commands.canRedo ? (commands.redoLabel ?? '') : null);
		};
		commands.onChange = refresh;
		this.cleanups.push(() => {
			commands.onChange = () => {};
		});
		refresh();
	}

	// ---- Keyboard shortcuts (spec 8) ----

	/**
	 * The mode bar binds 1 to 7 itself. Here: 8 for Revert to base (copied scenes), Escape to
	 * stop sampling, and the brackets: [ ] size the active brush; with Shift its strength (or
	 * the water's surface height); with Cmd the paint opacity, as the hotkey lists say.
	 */
	private wireKeys(): void {
		this.listen(window, 'keydown', (e: KeyboardEvent) => {
			if (e.altKey) return;
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
			if (this.editor.playing) return;
			const bracket = e.code === 'BracketLeft' || e.code === 'BracketRight';
			const up = e.code === 'BracketRight';
			if (e.ctrlKey || e.metaKey) {
				if (bracket && this.editor.tool === 'paint') {
					e.preventDefault();
					const paint = this.editor.paint;
					paint.opacity = Math.min(1, Math.max(0, Math.round((paint.opacity + (up ? 0.05 : -0.05)) * 100) / 100));
					this.syncActive();
				}
				return;
			}
			if (e.code === 'Escape' && this.sampling) {
				this.setSampling(false);
				return;
			}
			if (e.code === 'Digit8' && this.copied) {
				this.setTool('revert');
				return;
			}
			if (!bracket) return;
			const tool = this.editor.tool;
			if (tool === 'environment' || tool === 'place' || tool === 'npcs') return;
			const brush = tool === 'paint' ? this.editor.paint : tool === 'holes' ? this.editor.holes : tool === 'water' ? this.editor.water : tool === 'revert' ? this.editor.revert : this.editor.brush;
			if (e.shiftKey) {
				if ('strength' in brush) brush.strength = Math.min(1, Math.max(0, Math.round((brush.strength + (up ? 0.05 : -0.05)) * 100) / 100));
				else if (tool === 'water') this.editor.water.height = Math.round(((this.editor.water.height ?? 0) + (up ? 0.5 : -0.5)) * 2) / 2;
			} else {
				const max = tool === 'holes' || tool === 'water' ? 30 : 100;
				const step = Math.max(1, Math.round(brush.radius * 0.15));
				brush.radius = Math.min(max, Math.max(1, brush.radius + (up ? step : -step)));
			}
			this.syncActive();
		});
	}

	dispose(): void {
		this.textures.dispose();
		this.models?.dispose();
		this.models = null;
		this.npcEditor?.dispose();
		this.npcEditor = null;
		this.npcLibrary?.dispose();
		this.npcLibrary = null;
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.length = 0;
		this.show(false);
		this.dock.dispose();
	}
}

/** The rows with their command key written as the hotkey format says. */
function resolveRows(rows: HotkeyRow[]): HotkeyRow[] {
	return rows.map((row) => ({ ...row, keys: resolveKeys(row.keys) }));
}

/** A time of day in minutes as HH:MM. */
function clock(minutes: number): string {
	const m = Math.floor(minutes) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function download(name: string, bytes: Uint8Array, type: string): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
