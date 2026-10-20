import type { AsyncStorageApi } from '../worker/protocol';
import { textureName } from './baseTextures';
import type { HoleMode, WaterMode } from './cells';
import type { PaintMode } from './paint';
import type { SceneEditor } from './sceneEditor';
import type { Falloff, SculptMode } from './sculpt';
import { ModelBrowser } from './modelBrowser';
import { TextureBrowser } from './textureBrowser';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tools on the rail (spec 8): the ones Phase 2 hasn't delivered yet are disabled. */
const TOOLS: { id: string; key: string; ready: boolean }[] = [
	{ id: 'sculpt', key: 'Digit1', ready: true },
	{ id: 'paint', key: 'Digit2', ready: true },
	{ id: 'holes', key: 'Digit3', ready: true },
	{ id: 'water', key: 'Digit4', ready: true },
	{ id: 'place', key: 'Digit5', ready: true },
	{ id: 'npcs', key: 'Digit6', ready: false },
];

const HOLE_HINTS: Record<HoleMode, string> = {
	cut: 'Hold the left button to cut cells out of the ground, for caves and stairwells.',
	fill: 'Hold the left button to close holes back up.',
};

const WATER_HINTS: Record<WaterMode, string> = {
	add: 'Hold the left button to lay water cells at the surface height.',
	remove: 'Hold the left button to dry cells out.',
	flood: 'Click a hollow: everything connected below the surface height fills, like a lake.',
};

const PAINT_HINTS: Record<PaintMode, string> = {
	paint: 'Hold the left button to paint the texture into the ground.',
	erase: 'Hold the left button to wash paint away, back to the base texture.',
	fill: 'Click a chunk to fill it with the texture at the set opacity.',
	base: 'Click a chunk to swap its base texture, keeping the paint on top.',
};

const PLACE_HINTS: Record<'place' | 'select', string> = {
	place: 'Pick an asset, then click the ground to drop it. Shift stays in place mode for scattering.',
	select: 'Click an object to select it; Shift+click adds. Del deletes, Ctrl+D duplicates.',
};

const SCULPT_HINTS: Record<SculptMode, string> = {
	raise: 'Hold the left button to raise the ground.',
	lower: 'Hold the left button to lower the ground.',
	smooth: 'Hold the left button to soften bumps and edges.',
	flatten: 'Drags the ground toward the height you first touch, or a typed height.',
	noise: 'Hold the left button to roughen the ground with fractal noise.',
	ramp: 'Click the ramp’s two ends; the ground slopes straight between them.',
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
		this.wireClutter();
		this.wireUndo();
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

	private setTool(id: string): void {
		if (!TOOLS.find((t) => t.id === id)?.ready) return;
		this.editor.tool = id as SceneEditor['tool'];
		for (const tool of TOOLS) $(`tool-${tool.id}`).classList.toggle('active', tool.id === id);
		$('sculpt-props').hidden = id !== 'sculpt';
		$('paint-props').hidden = id !== 'paint';
		$('holes-props').hidden = id !== 'holes';
		$('water-props').hidden = id !== 'water';
		$('place-props').hidden = id !== 'place';
		if (id === 'place' && !this.models) {
			this.models = new ModelBrowser(this.storage, this.editor.model.meta.client.build, (asset) => {
				this.editor.objects.place.asset = asset;
				this.syncPlace();
			}, (text) => this.editor.onNotice(text));
		}
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
		const selected = objects.selectedObjects();
		$('place-selection').hidden = selected.length === 0;
		for (const mode of ['translate', 'rotate', 'scale'] as const) {
			$(`gizmo-${mode}`).classList.toggle('active', objects.gizmoMode === mode);
		}
		if (!selected.length) return;
		// The WMO set choices show for a single selected building (spec 7.8).
		const wmo = selected.length === 1 && selected[0].kind === 'wmo' ? selected[0] : null;
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
		const lock = $<HTMLInputElement>('sel-lock');
		lock.checked = selected.every((o) => o.locked);
		lock.indeterminate = !lock.checked && selected.some((o) => o.locked);
		const groups = new Set(selected.map((o) => o.group ?? ''));
		const group = $<HTMLInputElement>('sel-group');
		if (document.activeElement !== group) group.value = groups.size === 1 ? [...groups][0] : '';
		group.placeholder = groups.size > 1 ? 'mixed' : 'none';
		$('sel-count').textContent = `${selected.length} selected · ${this.editor.objects.count} in the scene`;
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
			if (this.editor.walking) return;
			const tool = TOOLS.find((t) => t.key === e.code);
			if (tool?.ready) {
				this.setTool(tool.id);
				return;
			}
			if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
				// [ and ] size the active tool's brush; with Shift, its strength (spec 8).
				const up = e.code === 'BracketRight';
				const tool = this.editor.tool;
				const brush = tool === 'paint' ? this.editor.paint : tool === 'holes' ? this.editor.holes : tool === 'water' ? this.editor.water : this.editor.brush;
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
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.length = 0;
		this.show(false);
	}
}
