import type { AsyncStorageApi } from '../worker/protocol';
import { textureName } from './baseTextures';
import type { PaintMode } from './paint';
import type { SceneEditor } from './sceneEditor';
import type { Falloff, SculptMode } from './sculpt';
import { TextureBrowser } from './textureBrowser';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tools on the rail (spec 8): the ones Phase 2 hasn't delivered yet are disabled. */
const TOOLS: { id: string; key: string; ready: boolean }[] = [
	{ id: 'sculpt', key: 'Digit1', ready: true },
	{ id: 'paint', key: 'Digit2', ready: true },
	{ id: 'holes', key: 'Digit3', ready: false },
	{ id: 'water', key: 'Digit4', ready: false },
	{ id: 'place', key: 'Digit5', ready: false },
	{ id: 'npcs', key: 'Digit6', ready: false },
];

const PAINT_HINTS: Record<PaintMode, string> = {
	paint: 'Hold the left button to paint the texture into the ground.',
	erase: 'Hold the left button to wash paint away, back to the base texture.',
	fill: 'Click a chunk to fill it with the texture at the set opacity.',
	base: 'Click a chunk to swap its base texture, keeping the paint on top.',
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

	constructor(
		private readonly editor: SceneEditor,
		storage: AsyncStorageApi,
	) {
		this.show(true);
		this.wireRail();
		this.wireSculpt();
		this.wirePaint();
		this.wireUndo();
		this.wireKeys();
		this.wireStatus();
		this.textures = new TextureBrowser(storage, editor.paint.fdid, (fdid) => {
			editor.paint.fdid = fdid;
			this.syncPaint();
		}, (text) => editor.onNotice(text));
		this.syncSculpt();
		this.syncPaint();
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
				const brush = this.editor.tool === 'paint' ? this.editor.paint : this.editor.brush;
				const up = e.code === 'BracketRight';
				if (e.shiftKey) {
					brush.strength = Math.min(1, Math.max(0, Math.round((brush.strength + (up ? 0.05 : -0.05)) * 100) / 100));
				} else {
					const step = Math.max(1, Math.round(brush.radius * 0.15));
					brush.radius = Math.min(100, Math.max(1, brush.radius + (up ? step : -step)));
				}
				this.syncSculpt();
				this.syncPaint();
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
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.length = 0;
		this.show(false);
	}
}
