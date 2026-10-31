/**
 * Size grid factory. Spec: specs/size-grid.md; styles in size-grid.css.
 *
 * A grid of tile cells on which a rectangle of up to `max` × `max` cells is picked: click a
 * cell for 1×1, drag (or Shift+click a second cell) to span more. Cells that are `locked`
 * (an existing scene's tiles) are always inside the pick and can't be dropped; the grid is
 * then wide enough to grow on every side, and while dragging, cells the pick can't reach are
 * dimmed. The caption under the cells reads the size. The molecule owns no model: it reports
 * the rectangle through onChange and setSizeGridValue() moves it.
 */
import { el, uid } from '../dom';

/** A rectangle of cells, both corners inclusive, in grid coordinates (0 at the top left). */
export interface GridRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface SizeGridOptions {
	/** The most cells the pick may span each way. */
	max: number;
	/** Cells that stay in every pick, as a size; the grid centres them with room to grow all round. */
	locked?: { tilesX: number; tilesY: number } | null;
	/** The starting pick; default the locked cells, or the centre cell. */
	value?: GridRect;
	/** The accessible name of the grid; default "Scene size". */
	ariaLabel?: string;
	disabled?: boolean;
	id?: string;
	onChange?: (value: GridRect) => void;
}

export interface SizeGridHandle {
	root: HTMLDivElement;
	/** Where the locked cells sit in the grid, or null. */
	locked: GridRect | null;
	columns: number;
	rows: number;
	value(): GridRect;
}

const rectOf = (ax: number, ay: number, bx: number, by: number): GridRect => ({
	x0: Math.min(ax, bx),
	y0: Math.min(ay, by),
	x1: Math.max(ax, bx),
	y1: Math.max(ay, by),
});

const union = (a: GridRect, b: GridRect | null): GridRect => (b ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : a);

const same = (a: GridRect, b: GridRect) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;

const inside = (r: GridRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Makes a size grid: `<div class="ds-size-grid">` of cell buttons over a caption. */
export function sizeGrid(options: SizeGridOptions): SizeGridHandle {
	const max = Math.max(1, Math.floor(options.max));
	// With locked cells the grid is the locked size plus room for `max - size` cells on each side.
	const lockedSize = options.locked ?? null;
	const columns = lockedSize ? lockedSize.tilesX + 2 * (max - lockedSize.tilesX) : max;
	const rows = lockedSize ? lockedSize.tilesY + 2 * (max - lockedSize.tilesY) : max;
	const locked: GridRect | null = lockedSize
		? { x0: max - lockedSize.tilesX, y0: max - lockedSize.tilesY, x1: max - 1, y1: max - 1 }
		: null;
	const centre = Math.floor((max - 1) / 2);
	let value: GridRect = options.value ?? locked ?? rectOf(centre, centre, centre, centre);
	let anchor: [number, number] = [value.x0, value.y0];
	let reach: GridRect | null = null;

	const captionId = uid('size-grid-caption');
	const caption = el('p', { class: 'ds-size-grid-caption', id: captionId });
	const cells: HTMLButtonElement[] = [];
	const grid = el('div', { class: 'ds-size-grid-cells', role: 'group', 'aria-label': options.ariaLabel ?? 'Scene size', 'aria-describedby': captionId, id: options.id });
	grid.style.setProperty('--size-grid-columns', String(columns));
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < columns; x++) {
			const cell = el('button', {
				class: 'ds-size-grid-cell',
				type: 'button',
				'aria-label': `Tile ${x + 1}, ${y + 1}`,
				'data-x': x,
				'data-y': y,
				disabled: options.disabled,
			});
			if (locked && inside(locked, x, y)) {
				cell.dataset.locked = 'true';
				cell.setAttribute('aria-disabled', 'true');
			}
			cells.push(cell);
			grid.append(cell);
		}
	}
	const root = el('div', { class: 'ds-size-grid' }, grid, caption);

	/** The cells a pick anchored at (ax, ay) can reach without passing `max` with the locked cells. */
	const reachFrom = (ax: number, ay: number): GridRect => {
		const base = union(rectOf(ax, ay, ax, ay), locked);
		return {
			x0: Math.max(0, base.x1 - max + 1),
			y0: Math.max(0, base.y1 - max + 1),
			x1: Math.min(columns - 1, base.x0 + max - 1),
			y1: Math.min(rows - 1, base.y0 + max - 1),
		};
	};

	const render = (): void => {
		for (const cell of cells) {
			const x = Number(cell.dataset.x);
			const y = Number(cell.dataset.y);
			const on = inside(value, x, y);
			cell.setAttribute('aria-pressed', String(on));
			if (reach && !inside(reach, x, y)) cell.dataset.unreachable = 'true';
			else delete cell.dataset.unreachable;
			cell.tabIndex = x === value.x0 && y === value.y0 ? 0 : -1;
		}
		caption.textContent = `${value.x1 - value.x0 + 1} x ${value.y1 - value.y0 + 1}`;
	};

	/** The pick from the anchor to (tx, ty), held within reach, with the locked cells. */
	const apply = (tx: number, ty: number, notify = true): void => {
		const [ax, ay] = anchor;
		const r = reachFrom(ax, ay);
		const cx = Math.max(r.x0, Math.min(r.x1, tx));
		const cy = Math.max(r.y0, Math.min(r.y1, ty));
		const next = union(rectOf(ax, ay, cx, cy), locked);
		const changed = !same(next, value);
		value = next;
		render();
		if (changed && notify) options.onChange?.(value);
	};

	const cellOf = (target: EventTarget | null): [number, number] | null => {
		const cell = target instanceof Element ? target.closest<HTMLButtonElement>('.ds-size-grid-cell') : null;
		if (!cell || !grid.contains(cell)) return null;
		return [Number(cell.dataset.x), Number(cell.dataset.y)];
	};

	const cellAt = (clientX: number, clientY: number): [number, number] | null => {
		// The cell under the pointer, or the nearest when the pointer is in a gap or outside.
		const rect = grid.getBoundingClientRect();
		const cellWidth = rect.width / columns;
		const cellHeight = rect.height / rows;
		const x = Math.max(0, Math.min(columns - 1, Math.floor((clientX - rect.left) / cellWidth)));
		const y = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / cellHeight)));
		return [x, y];
	};

	let dragging = false;
	grid.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || options.disabled) return;
		const cell = cellOf(event.target);
		if (!cell) return;
		event.preventDefault();
		if (!event.shiftKey) anchor = cell;
		dragging = true;
		reach = reachFrom(anchor[0], anchor[1]);
		grid.setPointerCapture(event.pointerId);
		apply(cell[0], cell[1]);
		cells[anchor[1] * columns + anchor[0]].focus({ preventScroll: true });
	});
	grid.addEventListener('pointermove', (event) => {
		if (!dragging) return;
		const cell = cellAt(event.clientX, event.clientY);
		if (cell) apply(cell[0], cell[1]);
	});
	const stop = (): void => {
		if (!dragging) return;
		dragging = false;
		reach = null;
		render();
	};
	grid.addEventListener('pointerup', stop);
	grid.addEventListener('pointercancel', stop);
	grid.addEventListener('lostpointercapture', stop);

	// Keyboard: a click from Enter or Space picks that cell (Shift extends from the anchor);
	// arrows move focus between cells.
	grid.addEventListener('click', (event) => {
		if (event.detail !== 0 || options.disabled) return;
		const cell = cellOf(event.target);
		if (!cell) return;
		if (!event.shiftKey) anchor = cell;
		apply(cell[0], cell[1]);
	});
	grid.addEventListener('keydown', (event) => {
		const cell = cellOf(event.target);
		if (!cell) return;
		const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		const delta = step[event.key];
		if (!delta) return;
		event.preventDefault();
		const x = Math.max(0, Math.min(columns - 1, cell[0] + delta[0]));
		const y = Math.max(0, Math.min(rows - 1, cell[1] + delta[1]));
		cells[y * columns + x].focus();
	});

	render();
	return { root, locked, columns, rows, value: () => ({ ...value }) };
}

/** Moves the grid's pick to `rect` (held within the grid) without firing onChange. */
export function setSizeGridValue(root: HTMLElement, rect: GridRect): void {
	const grid = root.querySelector<HTMLElement>('.ds-size-grid-cells');
	const caption = root.querySelector<HTMLElement>('.ds-size-grid-caption');
	if (!grid || !caption) return;
	for (const cell of grid.querySelectorAll<HTMLButtonElement>('.ds-size-grid-cell')) {
		const x = Number(cell.dataset.x);
		const y = Number(cell.dataset.y);
		cell.setAttribute('aria-pressed', String(inside(rect, x, y)));
		cell.tabIndex = x === rect.x0 && y === rect.y0 ? 0 : -1;
	}
	caption.textContent = `${rect.x1 - rect.x0 + 1} x ${rect.y1 - rect.y0 + 1}`;
}
