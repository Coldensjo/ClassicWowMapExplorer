import type { AsyncStorageApi } from '../worker/protocol';
import { textureName } from './baseTextures';
import type { HoleMode, WaterMode } from './cells';
import type { PaintMode } from './paint';
import type { RevertChannel } from './revert';
import type { SceneEditor } from './sceneEditor';
import type { Falloff, SculptMode } from './sculpt';
import { ModelBrowser } from './modelBrowser';
import { TextureBrowser } from './textureBrowser';
import { NpcBrowser, presetThumbKey } from './npcBrowser';
import { NpcEditor } from './npcEditor';
import type { NpcAsset } from './npcs';
import { PresetLibrary } from '../scene/presetLibrary';
import { SCENE_WEATHERS, type NpcPreset } from '../scene/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tools on the rail (spec 8), with their number keys. */
const TOOLS: { id: string; key: string; ready: boolean }[] = [
	{ id: 'sculpt', key: 'Digit1', ready: true },
	{ id: 'paint', key: 'Digit2', ready: true },
	{ id: 'holes', key: 'Digit3', ready: true },
	{ id: 'water', key: 'Digit4', ready: true },
	{ id: 'place', key: 'Digit5', ready: true },
	{ id: 'npcs', key: 'Digit6', ready: true },
	{ id: 'revert', key: 'Digit7', ready: true },
];

const NPC_HINTS: Record<'place' | 'select', string> = {
	place: 'Pick a creature or custom NPC, then click the ground to place it facing you. It snaps to the ground.',
	select: 'Click an NPC or object to select it; Shift+click adds, Shift+drag box-selects. W/E/R move, turn and scale; Del deletes.',
};

const HOLE_HINTS: Record<HoleMode, string> = {
	cut: 'Hold Shift and the left button to cut cells out of the ground, for caves and stairwells.',
	fill: 'Hold Shift and the left button to close holes back up.',
};

const WATER_HINTS: Record<WaterMode, string> = {
	add: 'Hold Shift and the left button to lay water cells at the surface height.',
	remove: 'Hold Shift and the left button to dry cells out.',
	flood: 'Shift+click a hollow: everything connected below the surface height fills, like a lake.',
};

const PAINT_HINTS: Record<PaintMode, string> = {
	paint: 'Hold Shift and the left button to paint the texture into the ground.',
	erase: 'Hold Shift and the left button to wash paint away, back to the base texture.',
	fill: 'Shift+click a chunk to fill it with the texture at the set opacity.',
	base: 'Shift+click a chunk to swap its base texture, keeping the paint on top.',
};

const PLACE_HINTS: Record<'place' | 'select', string> = {
	place: 'Pick an asset, then click the ground to drop it; click an object to select it.',
	select: 'Click an object to select it; Shift+click adds, Shift+drag box-selects. Del deletes, Ctrl+D duplicates.',
};

const SCULPT_HINTS: Record<SculptMode, string> = {
	raise: 'Shift + left button raises the ground; Cmd + left button lowers it.',
	lower: 'Cmd + left button lowers the ground; Shift + left button raises it.',
	smooth: 'Hold Shift and the left button to soften bumps and edges.',
	flatten: 'Shift + left button drags the ground toward the height you first touch, or a typed height.',
	noise: 'Hold Shift and the left button to roughen the ground with fractal noise.',
	ramp: 'Shift+click the ramp’s two ends; the ground slopes straight between them.',
};

/**
 * The editing panels around the viewport (spec 8): the tool rail on the left, the properties
 * panel on the right, the status bar along the bottom, and Undo/Redo in the top bar. One is made
 * per open scene and disposed with it.
 */
export class EditorPanels {
	private readonly cleanups: (() => void)[] = [];

	private readonly textures: TextureBrowser;
	/** Made when the Place tool first opens, so its listfile parts aren't fetched before then. */
	private models: ModelBrowser | null = null;
	/** Made when the NPCs tool first opens (spec 7.9). */
	private npcBrowser: NpcBrowser | null = null;
	private npcEditor: NpcEditor | null = null;
	private readonly presets = new PresetLibrary();

	constructor(
		private readonly editor: SceneEditor,
		private readonly storage: AsyncStorageApi,
	) {
		this.show(true);
		this.wireRail();
		this.wireSculpt();
		this.wirePaint();
		this.wireHoles();
		this.wireWater();
		this.wirePlace();
		this.wireNpcs();
		this.wireRevert();
		this.wireClutter();
		this.wireEnvironment();
		this.wireUndo();
		this.wirePlay();
		this.wireKeys();
		this.wireStatus();
		this.textures = new TextureBrowser(storage, editor.paint.fdid, (fdid) => {
			editor.paint.fdid = fdid;
			this.syncPaint();
		}, (text) => editor.onNotice(text));
		this.syncSculpt();
		this.syncPaint();
		this.syncHoles();
		this.syncWater();
	}

	private show(on: boolean): void {
		$('tool-rail').hidden = !on;
		$('tool-panel').hidden = !on;
		$('status-bar').hidden = !on;
		$('editor-undo').hidden = !on;
		$('editor-redo').hidden = !on;
		$('editor-play').hidden = !on;
		if (!on) this.syncPlay(false);
	}

	// ---- Edit / Play (spec 7.10) ----

	/** The top bar's Edit/Play button: the one toggle, in the same place in both modes (spec 8). */
	private wirePlay(): void {
		this.listen($('editor-play'), 'click', () => {
			this.editor.setPlaying(!this.editor.playing);
			$('editor-play').blur();
		});
		this.editor.onPlayChange = (playing) => this.syncPlay(playing);
		this.cleanups.push(() => {
			this.editor.onPlayChange = () => {};
		});
		this.syncPlay(this.editor.playing);
	}

	/** Playing hides the tool rail and properties panel (by a body class, so the button stays put). */
	private syncPlay(playing: boolean): void {
		const button = $<HTMLButtonElement>('editor-play');
		button.textContent = playing ? 'Edit' : 'Play';
		button.title = playing ? 'Back to editing, with the camera where the player stands' : 'Walk the scene as your character (spec 7.10); the same button comes back to editing';
		document.body.classList.toggle('playing', playing);
		$('editor-hint-edit').hidden = playing;
		$('editor-hint-play').hidden = !playing;
	}

	private listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
	private listen(target: HTMLElement, type: string, fn: (e: Event) => void): void;
	private listen(target: Window | HTMLElement, type: string, fn: (e: never) => void): void {
		target.addEventListener(type, fn as EventListener);
		this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
	}

	// ---- The tool rail ----

	private wireRail(): void {
		for (const tool of TOOLS) {
			const button = $(`tool-${tool.id}`);
			if (!tool.ready) continue;
			this.listen(button, 'click', () => this.setTool(tool.id));
		}
		this.setTool(this.editor.tool);
	}

	/** Revert to base only applies to copied scenes (spec 7.11). */
	private get copied(): boolean {
		return this.editor.model.baseData !== null;
	}

	private setTool(id: string): void {
		if (!TOOLS.find((t) => t.id === id)?.ready) return;
		if (id === 'revert' && !this.copied) return;
		this.editor.tool = id as SceneEditor['tool'];
		for (const tool of TOOLS) $(`tool-${tool.id}`).classList.toggle('active', tool.id === id);
		$('sculpt-props').hidden = id !== 'sculpt';
		$('paint-props').hidden = id !== 'paint';
		$('holes-props').hidden = id !== 'holes';
		$('water-props').hidden = id !== 'water';
		$('place-props').hidden = id !== 'place';
		$('npcs-props').hidden = id !== 'npcs';
		$('revert-props').hidden = id !== 'revert';
		if (id === 'place' && !this.models) {
			this.models = new ModelBrowser(this.storage, this.editor.model.meta.client.build, (asset) => {
				this.editor.objects.place.asset = asset;
				this.syncPlace();
			}, (text) => this.editor.onNotice(text));
		}
		if (id === 'npcs' && !this.npcBrowser) this.makeNpcBrowser();
		this.syncSelection();
	}

	// ---- Sculpt properties ----

	private wireSculpt(): void {
		const brush = this.editor.brush;
		for (const mode of Object.keys(SCULPT_HINTS) as SculptMode[]) {
			this.listen($(`sculpt-${mode}`), 'click', () => {
				brush.mode = mode;
				this.syncSculpt();
			});
		}
		this.listen($('brush-radius'), 'input', () => {
			brush.radius = Number($<HTMLInputElement>('brush-radius').value);
			this.syncSculpt();
		});
		this.listen($('brush-strength'), 'input', () => {
			brush.strength = Number($<HTMLInputElement>('brush-strength').value);
			this.syncSculpt();
		});
		this.listen($('brush-falloff'), 'change', () => {
			brush.falloff = $<HTMLSelectElement>('brush-falloff').value as Falloff;
		});
		this.listen($('flatten-to'), 'input', () => {
			const raw = $<HTMLInputElement>('flatten-to').value.trim();
			brush.flattenTo = raw === '' ? null : Number(raw);
		});
	}

	/** Brings the sculpt controls in line with the brush (also after [ ] and shortcut changes). */
	private syncSculpt(): void {
		const brush = this.editor.brush;
		for (const mode of Object.keys(SCULPT_HINTS) as SculptMode[]) {
			$(`sculpt-${mode}`).classList.toggle('active', brush.mode === mode);
		}
		$<HTMLInputElement>('brush-radius').value = String(brush.radius);
		$('brush-radius-out').textContent = `${brush.radius} yd`;
		$<HTMLInputElement>('brush-strength').value = String(brush.strength);
		$('brush-strength-out').textContent = brush.strength.toFixed(2);
		$<HTMLSelectElement>('brush-falloff').value = brush.falloff;
		$('flatten-row').hidden = brush.mode !== 'flatten';
		$('tool-hint').textContent = SCULPT_HINTS[brush.mode];
	}

	// ---- Paint properties (spec 7.5) ----

	private wirePaint(): void {
		const paint = this.editor.paint;
		for (const mode of Object.keys(PAINT_HINTS) as PaintMode[]) {
			this.listen($(`paint-${mode}`), 'click', () => {
				paint.mode = mode;
				this.syncPaint();
			});
		}
		this.listen($('paint-radius'), 'input', () => {
			paint.radius = Number($<HTMLInputElement>('paint-radius').value);
			this.syncPaint();
		});
		this.listen($('paint-strength'), 'input', () => {
			paint.strength = Number($<HTMLInputElement>('paint-strength').value);
			this.syncPaint();
		});
		this.listen($('paint-opacity'), 'input', () => {
			paint.opacity = Number($<HTMLInputElement>('paint-opacity').value);
			this.syncPaint();
		});
		this.listen($('paint-policy'), 'change', () => {
			paint.policy = $<HTMLSelectElement>('paint-policy').value as typeof paint.policy;
		});
	}

	private syncPaint(): void {
		const paint = this.editor.paint;
		for (const mode of Object.keys(PAINT_HINTS) as PaintMode[]) {
			$(`paint-${mode}`).classList.toggle('active', paint.mode === mode);
		}
		$('texture-picked').textContent = `Painting with ${(this.textures as TextureBrowser | undefined)?.labelOf(paint.fdid) ?? textureName(paint.fdid)}`;
		$<HTMLInputElement>('paint-radius').value = String(paint.radius);
		$('paint-radius-out').textContent = `${paint.radius} yd`;
		$<HTMLInputElement>('paint-strength').value = String(paint.strength);
		$('paint-strength-out').textContent = paint.strength.toFixed(2);
		$<HTMLInputElement>('paint-opacity').value = String(paint.opacity);
		$('paint-opacity-out').textContent = `${Math.round(paint.opacity * 100)}%`;
		$<HTMLSelectElement>('paint-policy').value = paint.policy;
		$('paint-hint').textContent = PAINT_HINTS[paint.mode];
	}

	// ---- Holes and water (spec 7.6) ----

	private wireHoles(): void {
		const holes = this.editor.holes;
		for (const mode of Object.keys(HOLE_HINTS) as HoleMode[]) {
			this.listen($(`holes-${mode}`), 'click', () => {
				holes.mode = mode;
				this.syncHoles();
			});
		}
		this.listen($('holes-radius'), 'input', () => {
			holes.radius = Number($<HTMLInputElement>('holes-radius').value);
			this.syncHoles();
		});
	}

	private syncHoles(): void {
		const holes = this.editor.holes;
		for (const mode of Object.keys(HOLE_HINTS) as HoleMode[]) {
			$(`holes-${mode}`).classList.toggle('active', holes.mode === mode);
		}
		$<HTMLInputElement>('holes-radius').value = String(holes.radius);
		$('holes-radius-out').textContent = `${holes.radius} yd`;
		$('holes-hint').textContent = HOLE_HINTS[holes.mode];
	}

	private wireWater(): void {
		const water = this.editor.water;
		for (const mode of Object.keys(WATER_HINTS) as WaterMode[]) {
			this.listen($(`water-${mode}`), 'click', () => {
				water.mode = mode;
				this.syncWater();
			});
		}
		this.listen($('water-kind'), 'change', () => {
			water.kind = Number($<HTMLSelectElement>('water-kind').value);
		});
		this.listen($('water-height'), 'input', () => {
			const raw = $<HTMLInputElement>('water-height').value.trim();
			water.height = raw === '' ? null : Number(raw);
		});
		this.listen($('water-radius'), 'input', () => {
			water.radius = Number($<HTMLInputElement>('water-radius').value);
			this.syncWater();
		});
	}

	private syncWater(): void {
		const water = this.editor.water;
		for (const mode of Object.keys(WATER_HINTS) as WaterMode[]) {
			$(`water-${mode}`).classList.toggle('active', water.mode === mode);
		}
		$<HTMLSelectElement>('water-kind').value = String(water.kind);
		$<HTMLInputElement>('water-radius').value = String(water.radius);
		$('water-radius-out').textContent = `${water.radius} yd`;
		$('water-hint').textContent = WATER_HINTS[water.mode];
	}

	// ---- Object placement (spec 7.8) ----

	private wirePlace(): void {
		const place = this.editor.objects.place;
		for (const mode of ['place', 'select'] as const) {
			this.listen($(`place-${mode}`), 'click', () => {
				place.mode = mode;
				this.syncPlace();
			});
		}
		this.listen($('place-align'), 'change', () => {
			place.alignToSlope = $<HTMLInputElement>('place-align').checked;
		});
		this.listen($('place-random-yaw'), 'change', () => {
			place.randomYaw = $<HTMLInputElement>('place-random-yaw').checked;
		});
		this.listen($('place-scale-min'), 'input', () => {
			place.scaleMin = Number($<HTMLInputElement>('place-scale-min').value) || 1;
		});
		this.listen($('place-scale-max'), 'input', () => {
			place.scaleMax = Number($<HTMLInputElement>('place-scale-max').value) || 1;
		});
		this.listen($('place-snap'), 'change', () => {
			place.gridSnap = Number($<HTMLSelectElement>('place-snap').value);
		});
		this.listen($('place-angle-snap'), 'change', () => {
			place.angleSnap = $<HTMLInputElement>('place-angle-snap').checked;
		});
		const objects = this.editor.objects;
		for (const mode of ['translate', 'rotate', 'scale'] as const) {
			this.listen($(`gizmo-${mode}`), 'click', () => objects.setGizmoMode(mode));
		}
		this.listen($('sel-drop'), 'click', () => objects.dropToGround());
		this.listen($('sel-duplicate'), 'click', () => objects.duplicateSelection());
		this.listen($('sel-delete'), 'click', () => objects.deleteSelection());
		this.listen($('sel-doodadset'), 'change', () => objects.setDoodadSet(Number($<HTMLSelectElement>('sel-doodadset').value)));
		this.listen($('sel-nameset'), 'change', () => objects.setNameSet(Math.max(0, Math.round(Number($<HTMLInputElement>('sel-nameset').value) || 0))));
		this.listen($('sel-lock'), 'change', () => objects.setLocked($<HTMLInputElement>('sel-lock').checked));
		this.listen($('sel-group'), 'change', () => objects.setGroup($<HTMLInputElement>('sel-group').value));
		objects.onSelectionChange = () => this.syncSelection();
		this.cleanups.push(() => {
			objects.onSelectionChange = () => {};
		});
		this.syncPlace();
		this.syncSelection();
	}

	/** Brings the selection block in line with what's selected and the gizmo mode. */
	private syncSelection(): void {
		const objects = this.editor.objects;
		const entities = objects.selectedEntities();
		const selected = objects.selectedObjects();
		const npcs = objects.selectedNpcs();
		const objectTool = this.editor.tool === 'place' || this.editor.tool === 'npcs';
		$('selection-props').hidden = entities.length === 0 || !objectTool;
		const deleted = objects.deletedBaseCount;
		$('place-restore').hidden = deleted === 0;
		$('place-restore').textContent = `Restore ${deleted} deleted copied object${deleted === 1 ? '' : 's'}`;
		for (const mode of ['translate', 'rotate', 'scale'] as const) {
			$(`gizmo-${mode}`).classList.toggle('active', objects.gizmoMode === mode);
		}
		if (!entities.length) return;
		// NPC properties (spec 7.9.1) show while any NPC is selected; the fields follow the last one.
		$('sel-npc').hidden = npcs.length === 0;
		if (npcs.length) {
			const npc = npcs[npcs.length - 1];
			const active = document.activeElement;
			if (active !== $('sel-npc-name')) $<HTMLInputElement>('sel-npc-name').value = npcs.every((n) => n.name === npc.name) ? npc.name ?? '' : '';
			if (active !== $('sel-npc-subname')) $<HTMLInputElement>('sel-npc-subname').value = npcs.every((n) => n.subName === npc.subName) ? npc.subName ?? '' : '';
			if (active !== $('sel-npc-facing')) $<HTMLInputElement>('sel-npc-facing').value = String(Math.round(((npc.facing % 360) + 360) % 360));
			if (active !== $('sel-npc-scale')) $<HTMLInputElement>('sel-npc-scale').value = String(Math.round(npc.scale * 100) / 100);
			const picked = objects.npcPlace.asset;
			$<HTMLButtonElement>('sel-npc-appearance').disabled = !picked;
			$('sel-npc-appearance').title = picked ? `Give the selected NPC${npcs.length === 1 ? '' : 's'} the look picked in the NPCs tab: ${picked.label}` : 'Pick a creature or custom NPC in the NPCs tab first';
			$('sel-npc-look').textContent = this.npcBrowser?.describe(npc.appearance) ?? (npc.appearance.kind === 'creature' ? `Creature display ${npc.appearance.displayId}` : 'Custom NPC');
		}
		// The WMO set choices show for a single selected building (spec 7.8).
		const wmo = selected.length === 1 && !npcs.length && selected[0].kind === 'wmo' ? selected[0] : null;
		$('sel-doodadset-row').hidden = !wmo;
		$('sel-nameset-row').hidden = !wmo;
		if (wmo) {
			const sets = objects.doodadSets(wmo);
			const select = $<HTMLSelectElement>('sel-doodadset');
			select.replaceChildren(
				...(sets?.map((name, i) => new Option(`${i} · ${name || 'unnamed'}${i === 0 ? ' (always shown)' : ''}`, String(i))) ?? [new Option('Loading…', String(wmo.doodadSet ?? 0))]),
			);
			select.value = String(wmo.doodadSet ?? 0);
			select.disabled = !sets;
			$<HTMLInputElement>('sel-nameset').value = String(wmo.nameSet ?? 0);
		}
		$('sel-revert').hidden = objects.revertableCount === 0;
		const items = entities.map((e) => (e.kind === 'npc' ? e.n : e.o));
		const lock = $<HTMLInputElement>('sel-lock');
		lock.checked = items.every((o) => o.locked);
		lock.indeterminate = !lock.checked && items.some((o) => o.locked);
		const groups = new Set(items.map((o) => o.group ?? ''));
		const group = $<HTMLInputElement>('sel-group');
		if (document.activeElement !== group) group.value = groups.size === 1 ? [...groups][0] : '';
		group.placeholder = groups.size > 1 ? 'mixed' : 'none';
		const parts: string[] = [];
		if (selected.length) parts.push(`${selected.length} object${selected.length === 1 ? '' : 's'}`);
		if (npcs.length) parts.push(`${npcs.length} NPC${npcs.length === 1 ? '' : 's'}`);
		$('sel-count').textContent = `${parts.join(' and ')} selected · ${objects.count} objects and ${objects.npcCount} NPCs in the scene`;
	}

	// ---- NPCs (spec 7.9) ----

	private wireNpcs(): void {
		const settings = this.editor.objects.npcPlace;
		for (const mode of ['place', 'select'] as const) {
			this.listen($(`npcs-${mode}`), 'click', () => {
				settings.mode = mode;
				this.syncNpcs();
			});
		}
		const objects = this.editor.objects;
		const names = () => objects.setNpcName($<HTMLInputElement>('sel-npc-name').value, $<HTMLInputElement>('sel-npc-subname').value);
		this.listen($('sel-npc-name'), 'change', names);
		this.listen($('sel-npc-subname'), 'change', names);
		this.listen($('sel-npc-facing'), 'change', () => objects.setNpcFacing(Number($<HTMLInputElement>('sel-npc-facing').value) || 0));
		this.listen($('sel-npc-scale'), 'change', () => objects.setNpcScale(Number($<HTMLInputElement>('sel-npc-scale').value) || 1));
		this.listen($('sel-npc-appearance'), 'click', () => {
			const picked = objects.npcPlace.asset;
			if (picked) objects.setNpcAppearance(picked.appearance, picked.label);
		});
		// The play-mode avatar (spec 7.10): the picked appearance, or the default.
		this.listen($('npc-player-set'), 'click', () => {
			const picked = settings.asset;
			if (picked) this.editor.setPlayer(picked.appearance);
		});
		this.listen($('npc-player-reset'), 'click', () => this.editor.setPlayer(null));
		this.editor.onPlayerChange = () => this.syncNpcs();
		this.cleanups.push(() => {
			this.editor.onPlayerChange = () => {};
		});
		this.syncNpcs();
	}

	private syncNpcs(): void {
		const settings = this.editor.objects.npcPlace;
		$('npcs-place').classList.toggle('active', settings.mode === 'place');
		$('npcs-select').classList.toggle('active', settings.mode === 'select');
		$('npc-picked').textContent = settings.asset ? `Placing ${settings.asset.label}` : 'Nothing picked yet';
		$('npcs-hint').textContent = NPC_HINTS[settings.mode];
		const player = this.editor.model.meta.player;
		$('npc-player').textContent = `Playing as ${player ? this.npcBrowser?.describe(player) ?? (player.kind === 'creature' ? `creature display ${player.displayId}` : 'a custom NPC') : 'the default avatar (a human)'}`;
		$<HTMLButtonElement>('npc-player-set').disabled = !settings.asset;
		$<HTMLButtonElement>('npc-player-reset').disabled = !player;
		this.syncSelection();
	}

	/** Arms an appearance for placing; a custom one is embedded in the scene first (spec 6.6). */
	private pickNpc(asset: NpcAsset | null, presets: NpcPreset[]): void {
		if (asset?.appearance.kind === 'custom') {
			const preset = presets.find((p) => p.id === (asset.appearance as { presetId: string }).presetId);
			if (preset) this.editor.model.setPreset(preset);
		}
		this.editor.objects.npcPlace.asset = asset;
		this.syncNpcs();
	}

	private makeNpcBrowser(): void {
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
			this.npcBrowser?.setPresets([...library, ...embedded]);
		};
		const browser = new NpcBrowser(this.storage, editor.model.meta.client.build, (asset) => this.pickNpc(asset, [...library, ...editor.model.npcPresets]), (text) => editor.onNotice(text), {
			handleOf: (preset) => editor.objects.npcs.handle(preset),
			onNew: () => void this.openNpcEditor(null),
			onEdit: (preset) => void this.openNpcEditor(preset),
			onDelete: (preset) => {
				if (!confirm(`Delete "${preset.name}" from your NPC library? Scenes that use it keep their own copy.`)) return;
				void this.presets.delete(preset.id).then(refreshPresets, (e) => editor.onNotice(`Deleting failed: ${e instanceof Error ? e.message : e}`));
			},
			onExport: (preset) => download(`${preset.name || 'npc'}.wnpc`, PresetLibrary.export(preset), 'application/json'),
			onImport: (file) => {
				void file.arrayBuffer().then((bytes) => this.presets.import(new Uint8Array(bytes))).then(refreshPresets, (e) => editor.onNotice(e instanceof Error ? e.message : String(e)));
			},
			onCustomize: (displayId) => {
				void this.storage.humanoidPreset(displayId).then((prefill) => {
					if (!prefill) {
						editor.onNotice('That display has no character race and sex to customize');
						return;
					}
					return this.openNpcEditor(null, prefill, `${browser.describe({ kind: 'creature', displayId }).split(' (')[0]} (custom)`);
				}, (e) => editor.onNotice(`Customize as new failed: ${e instanceof Error ? e.message : e}`));
			},
		});
		this.npcBrowser = browser;
		void refreshPresets();
		this.npcEditor = new NpcEditor(this.storage, editor.model.meta.client.build, {
			handleOf: (preset) => editor.objects.npcs.handle(preset),
			onNotice: (text) => editor.onNotice(text),
			onSave: (preset) => {
				void this.presets.save(preset).catch((e) => editor.onNotice(`Saving the preset failed: ${e instanceof Error ? e.message : e}. It is still embedded in this scene.`));
				browser.forgetThumb(presetThumbKey(preset));
				// NPCs wearing an edited preset change with it (spec 6.6: the scene keeps its own copy).
				if (editor.model.preset(preset.id)) {
					editor.model.setPreset(preset);
					editor.objects.refreshPreset(preset.id);
				}
				void refreshPresets().then(() => {
					browser.showCustom();
					this.pickNpc({ appearance: { kind: 'custom', presetId: preset.id }, label: preset.name }, [preset, ...library]);
				});
			},
		});
	}

	private async openNpcEditor(preset: NpcPreset | null, prefill: Parameters<NpcEditor['open']>[1] = null, name = ''): Promise<void> {
		await this.npcEditor?.open(preset, prefill, name);
	}

	private syncPlace(): void {
		const place = this.editor.objects.place;
		$('place-place').classList.toggle('active', place.mode === 'place');
		$('place-select').classList.toggle('active', place.mode === 'select');
		$<HTMLInputElement>('place-align').checked = place.alignToSlope;
		$<HTMLInputElement>('place-random-yaw').checked = place.randomYaw;
		$<HTMLInputElement>('place-scale-min').value = String(place.scaleMin);
		$<HTMLInputElement>('place-scale-max').value = String(place.scaleMax);
		$<HTMLSelectElement>('place-snap').value = String(place.gridSnap);
		$('model-picked').textContent = place.asset ? `Placing ${place.asset.label}` : 'Nothing picked yet';
		$('place-hint').textContent = PLACE_HINTS[place.mode];
	}

	// ---- Revert to base (spec 7.11) ----

	private wireRevert(): void {
		$('tool-revert').hidden = !this.copied;
		this.cleanups.push(() => ($('tool-revert').hidden = true));
		const revert = this.editor.revert;
		for (const channel of Object.keys(revert.channels) as RevertChannel[]) {
			const box = $<HTMLInputElement>(`revert-${channel}`);
			box.checked = revert.channels[channel];
			this.listen(box, 'change', () => {
				revert.channels[channel] = box.checked;
			});
		}
		this.listen($('revert-radius'), 'input', () => {
			revert.radius = Number($<HTMLInputElement>('revert-radius').value);
			this.syncRevert();
		});
		this.listen($('sel-revert'), 'click', () => this.editor.objects.revertSelectionToBase());
		this.listen($('place-restore'), 'click', () => this.editor.objects.restoreDeleted());
		this.syncRevert();
	}

	private syncRevert(): void {
		const revert = this.editor.revert;
		$<HTMLInputElement>('revert-radius').value = String(revert.radius);
		$('revert-radius-out').textContent = `${revert.radius} yd`;
	}

	// ---- Ground clutter (spec 7.7) ----

	private wireClutter(): void {
		const settings = this.editor.clutterSettings;
		const sync = () => {
			$<HTMLInputElement>('clutter-on').checked = settings.enabled;
			$<HTMLInputElement>('clutter-density').value = String(settings.density);
			$('clutter-density-out').textContent = `${Math.round(settings.density * 100)}%`;
		};
		this.listen($('clutter-on'), 'change', () => {
			settings.enabled = $<HTMLInputElement>('clutter-on').checked;
			this.editor.refreshClutter();
			sync();
		});
		this.listen($('clutter-density'), 'input', () => {
			settings.density = Number($<HTMLInputElement>('clutter-density').value);
			this.editor.refreshClutter();
			sync();
		});
		this.listen($('clutter-apply'), 'click', () => {
			const changed = this.editor.applyGroundEffects();
			this.editor.onNotice(changed ? `Ground effects applied to ${changed} chunk${changed === 1 ? '' : 's'}` : 'Every painted layer already has its ground effect');
		});
		sync();
	}

	// ---- The environment (spec 6.1): time of day, weather, fog and shadows ----

	private wireEnvironment(): void {
		const time = $<HTMLInputElement>('env-time');
		const fog = $<HTMLInputElement>('env-fog');
		const weather = $<HTMLSelectElement>('env-weather');
		// Shadows are how the scene is viewed, not part of it: no command, and kept across scenes.
		const shadows = $<HTMLInputElement>('env-shadows');
		shadows.checked = this.editor.shadows;
		this.listen(shadows, 'change', () => (this.editor.shadows = shadows.checked));
		const sync = () => {
			const env = this.editor.environment;
			// The slider is in minutes, on quarter hours; the scene keeps half-minutes.
			const minutes = Math.round(env.timeOfDay / 30) * 15;
			time.value = String(minutes % 1440);
			$('env-time-out').textContent = clock(env.timeOfDay / 2);
			fog.checked = env.fogOn !== false;
			weather.value = env.weather ?? '';
		};
		this.listen(fog, 'change', () => this.editor.setEnvironment({ fogOn: fog.checked }, fog.checked ? 'Turn fog on' : 'Turn fog off'));
		this.listen(weather, 'change', () => {
			const kind = SCENE_WEATHERS.find((k) => k === weather.value);
			this.editor.setEnvironment({ weather: kind }, kind ? `Set weather: ${kind}` : 'Clear the weather');
		});
		// Dragging previews each value; letting go records the whole drag as one command.
		let timeBefore: typeof this.editor.environment | null = null;
		this.listen(time, 'input', () => {
			timeBefore ??= { ...this.editor.environment };
			this.editor.previewEnvironment({ timeOfDay: Number(time.value) * 2 });
		});
		this.listen(time, 'change', () => {
			const from = timeBefore ?? { ...this.editor.environment };
			timeBefore = null;
			this.editor.setEnvironment({ timeOfDay: Number(time.value) * 2 }, 'Set time of day', from);
		});
		this.editor.onEnvironmentChange = sync;
		this.cleanups.push(() => {
			this.editor.onEnvironmentChange = () => {};
		});
		sync();
	}

	// ---- Undo and redo ----

	private wireUndo(): void {
		const commands = this.editor.commands;
		this.listen($('editor-undo'), 'click', () => this.editor.undo());
		this.listen($('editor-redo'), 'click', () => this.editor.redo());
		const refresh = () => {
			const undoButton = $<HTMLButtonElement>('editor-undo');
			const redoButton = $<HTMLButtonElement>('editor-redo');
			undoButton.disabled = !commands.canUndo;
			redoButton.disabled = !commands.canRedo;
			undoButton.title = commands.undoLabel ? `Undo: ${commands.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)';
			redoButton.title = commands.redoLabel ? `Redo: ${commands.redoLabel.toLowerCase()} (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)';
		};
		commands.onChange = refresh;
		this.cleanups.push(() => {
			commands.onChange = () => {};
		});
		refresh();
	}

	// ---- Keyboard shortcuts (spec 8) ----

	private wireKeys(): void {
		this.listen(window, 'keydown', (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
			if (this.editor.playing) return;
			const tool = TOOLS.find((t) => t.key === e.code);
			if (tool?.ready) {
				this.setTool(tool.id);
				return;
			}
			if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
				// [ and ] size the active tool's brush; with Shift, its strength (spec 8).
				const up = e.code === 'BracketRight';
				const tool = this.editor.tool;
				const brush = tool === 'paint' ? this.editor.paint : tool === 'holes' ? this.editor.holes : tool === 'water' ? this.editor.water : tool === 'revert' ? this.editor.revert : this.editor.brush;
				if (e.shiftKey) {
					if ('strength' in brush) brush.strength = Math.min(1, Math.max(0, Math.round((brush.strength + (up ? 0.05 : -0.05)) * 100) / 100));
				} else {
					const max = tool === 'holes' || tool === 'water' ? 30 : 100;
					const step = Math.max(1, Math.round(brush.radius * 0.15));
					brush.radius = Math.min(max, Math.max(1, brush.radius + (up ? step : -step)));
				}
				this.syncSculpt();
				this.syncPaint();
				this.syncHoles();
				this.syncWater();
				this.syncRevert();
			}
		});
	}

	// ---- The status bar ----

	private wireStatus(): void {
		const cursor = $('status-cursor');
		const height = $('status-height');
		const layers = $('status-layers');
		const fps = $('status-fps');
		this.editor.onStatus = (s) => {
			cursor.textContent = s.cursor ? `${s.cursor.x.toFixed(1)}, ${s.cursor.z.toFixed(1)}` : '—';
			height.textContent = s.cursor ? `${s.cursor.height.toFixed(1)} yd` : '';
			layers.textContent = s.layers !== null ? `${s.layers}/4 layers` : '';
			fps.textContent = `${s.fps} FPS`;
		};
		this.cleanups.push(() => {
			this.editor.onStatus = () => {};
		});
	}

	dispose(): void {
		this.textures.dispose();
		this.models?.dispose();
		this.models = null;
		this.npcEditor?.dispose();
		this.npcEditor = null;
		this.npcBrowser?.dispose();
		this.npcBrowser = null;
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.length = 0;
		this.show(false);
	}
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
