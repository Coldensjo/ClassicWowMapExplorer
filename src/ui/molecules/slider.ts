/**
 * Slider factory. Spec: specs/slider.md; styles in field.css and slider.css.
 *
 * A native range input (so keys, pointer and touch come free) with a caption above and an
 * editable value field beside it. Dragging updates the field live; typing a value commits on
 * Enter or blur, clamped to the range and rounded to the step. The molecule keeps no model
 * state: it reports through onInput and onChange and callers move it with setSliderValue().
 *
 * With `stops` the slider is discrete (slider.md §11): the thumb snaps to a fixed set of
 * values, each marked by a tick on the rail. The range input then runs over the stop indexes
 * and the molecule translates to and from the stop values. Stops may carry labels, drawn under
 * the ticks; the value field then shows the current stop's label and is read-only.
 */
import { el, snap } from '../dom';
import { fieldBox, fieldShell, type FieldSize } from './field';

/** A discrete stop: its value, with an optional label shown under its tick and in the field. */
export type SliderStop = number | { value: number; label?: string };

export interface SliderOptions {
	/** Caption above; also the accessible name. */
	label?: string;
	/** Required when `label` is omitted. */
	ariaLabel?: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	/**
	 * Discrete stops instead of a continuous range: a count of evenly spaced stops between
	 * `min` and `max`, or the stops themselves. `step` is ignored; `value` snaps to the nearest.
	 */
	stops?: number | SliderStop[];
	/** Unit shown after the value, e.g. "%" or "yd"; also read out with the value. */
	suffix?: string;
	/**
	 * Shows the value as text instead of a number, e.g. a time of day as "12:00"; the value
	 * field is then read-only (the range alone moves it) and the text is read out with it.
	 */
	format?: (value: number) => string;
	/** Show the editable value field; default true. */
	showInput?: boolean;
	/** `md` (default) is the 40px row with the tall thumb; `sm` the 30px row with a square one. */
	size?: FieldSize;
	disabled?: boolean;
	/** Tooltip on the range, e.g. a shortcut hint. */
	title?: string;
	id?: string;
	/** While dragging or typing. */
	onInput?: (value: number) => void;
	/** On release or commit. */
	onChange?: (value: number) => void;
}

export interface SliderHandle {
	root: HTMLDivElement;
	range: HTMLInputElement;
	/** The value field, when shown. */
	input: HTMLInputElement | null;
}

interface Stop {
	value: number;
	label?: string;
}

interface Scale {
	/** The stops, in value order; empty for a continuous slider. */
	stops: Stop[];
	/** What the range input holds for a value: the value itself, or the stop's index. */
	toRange(value: number): number;
	/** The value the range input's number means. */
	fromRange(raw: number): number;
	/** The nearest legal value. */
	snap(value: number): number;
	/** The stop at a value, when discrete. */
	stopAt(value: number): Stop | undefined;
}

function makeStops(spec: number | SliderStop[], min: number, max: number): Stop[] {
	let list: Stop[];
	if (typeof spec === 'number') {
		const count = Math.max(2, Math.round(spec));
		list = Array.from({ length: count }, (_, i) => ({ value: min + ((max - min) * i) / (count - 1) }));
	} else {
		list = spec.map((s) => (typeof s === 'number' ? { value: s } : { value: s.value, label: s.label }));
	}
	return list.sort((a, b) => a.value - b.value);
}

function makeScale(options: SliderOptions, min: number, max: number, step: number): Scale {
	if (options.stops === undefined) {
		return {
			stops: [],
			toRange: (v) => v,
			fromRange: (r) => r,
			snap: (v) => snap(v, min, max, step),
			stopAt: () => undefined,
		};
	}
	const stops = makeStops(options.stops, min, max);
	const nearest = (v: number) => stops.reduce((best, s, i) => (Math.abs(s.value - v) < Math.abs(stops[best].value - v) ? i : best), 0);
	return {
		stops,
		toRange: (v) => nearest(v),
		fromRange: (r) => stops[Math.min(stops.length - 1, Math.max(0, Math.round(r)))].value,
		snap: (v) => stops[nearest(v)].value,
		stopAt: (v) => stops[nearest(v)],
	};
}

/** Makes a slider: `<div class="ds-field ds-slider">`. */
export function slider(options: SliderOptions): SliderHandle {
	const min = options.min ?? 0;
	const max = options.max ?? 100;
	const step = options.step ?? 1;
	const scale = makeScale(options, min, max, step);
	const discrete = scale.stops.length > 0;
	// A labelled or formatted value is shown as read-only text; a plain one is an editable number.
	const labelled = scale.stops.some((s) => s.label !== undefined) || options.format !== undefined;
	const name = options.label ?? options.ariaLabel ?? '';

	const range = el('input', {
		class: 'ds-slider-range',
		type: 'range',
		id: options.id,
		min: discrete ? 0 : min,
		max: discrete ? scale.stops.length - 1 : max,
		step: discrete ? 1 : step,
		disabled: options.disabled,
		title: options.title,
		'aria-label': options.label ? undefined : options.ariaLabel,
	});
	let value = scale.snap(options.value);
	range.value = String(scale.toRange(value));

	const track = el('div', { class: 'ds-slider-track' }, range);
	if (discrete) {
		const ticks = el('div', { class: 'ds-slider-stops', 'aria-hidden': 'true' });
		const labels = labelled ? el('div', { class: 'ds-slider-stop-labels', 'aria-hidden': 'true' }) : null;
		scale.stops.forEach((stop, i) => {
			const at = `${i / (scale.stops.length - 1)}`;
			const tick = el('span', { class: 'ds-slider-stop' });
			tick.style.setProperty('--stop', at);
			ticks.append(tick);
			if (labels) {
				const text = el('span', { class: 'ds-slider-stop-label' }, stop.label ?? '');
				text.style.setProperty('--stop', at);
				labels.append(text);
			}
		});
		track.prepend(ticks);
		if (labels) track.append(labels);
	}

	const display = (v: number): string => {
		if (options.format) return options.format(v);
		const stop = scale.stopAt(v);
		return stop?.label ?? String(v);
	};

	let input: HTMLInputElement | null = null;
	const row = el('div', { class: 'ds-slider-row' }, track);
	if (options.showInput ?? true) {
		input = el('input', {
			class: 'ds-field-control',
			type: labelled ? 'text' : 'number',
			inputmode: labelled ? undefined : 'decimal',
			min: labelled ? undefined : min,
			max: labelled ? undefined : max,
			step: labelled || discrete ? undefined : step,
			readonly: labelled,
			tabindex: labelled ? -1 : undefined,
			disabled: options.disabled,
			'aria-label': `${name} value`.trim(),
		});
		input.value = display(value);
		const box = fieldBox(
			input,
			input,
			options.suffix && !labelled ? el('span', { class: 'ds-field-suffix', 'aria-hidden': 'true' }, options.suffix) : null,
		);
		box.classList.add('ds-slider-input');
		row.append(box);
	}

	const shell = fieldShell({ label: options.label, controlId: options.id }, row);
	range.id = shell.controlId;
	shell.root.classList.add('ds-slider');
	if (options.size === 'sm') shell.root.dataset.size = 'sm';
	if (discrete) shell.root.dataset.stops = '';

	const describe = () => {
		const stop = scale.stopAt(value);
		range.setAttribute('aria-valuetext', options.format?.(value) ?? stop?.label ?? (options.suffix ? `${value} ${options.suffix}` : String(value)));
	};
	describe();

	/** Moves to `next` (snapped); `commit` reports through onInput and onChange, `silent` through neither. */
	const apply = (next: number, mode: 'commit' | 'silent') => {
		next = scale.snap(next);
		const changed = next !== value;
		value = next;
		range.value = String(scale.toRange(value));
		if (input) input.value = display(value);
		describe();
		if (changed && mode === 'commit') {
			options.onInput?.(value);
			options.onChange?.(value);
		}
	};

	range.addEventListener('input', () => {
		value = scale.fromRange(Number(range.value));
		if (input) input.value = display(value);
		describe();
		options.onInput?.(value);
	});
	range.addEventListener('change', () => options.onChange?.(value));

	if (input && !labelled) {
		const field = input;
		const commit = () => {
			const typed = Number(field.value);
			if (field.value.trim() === '' || Number.isNaN(typed)) {
				field.value = display(value);
				return;
			}
			apply(typed, 'commit');
		};
		field.addEventListener('input', () => {
			const typed = Number(field.value);
			if (field.value.trim() !== '' && !Number.isNaN(typed)) options.onInput?.(scale.snap(typed));
		});
		field.addEventListener('change', commit);
		field.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
			} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
				if (!discrete && !event.shiftKey) return; // native stepping
				event.preventDefault();
				const direction = event.key === 'ArrowUp' ? 1 : -1;
				if (discrete) {
					apply(scale.fromRange(scale.toRange(value) + direction), 'commit');
				} else {
					apply(Number(field.value || value) + direction * step * 10, 'commit');
				}
			}
		});
	}

	handles.set(shell.root, (v) => apply(v, 'silent'));
	return { root: shell.root, range, input };
}

const handles = new WeakMap<HTMLElement, (value: number) => void>();

/** Moves the slider (and its field) to `value`, snapped to the step or nearest stop, without firing onInput or onChange. */
export function setSliderValue(root: HTMLElement, value: number): void {
	handles.get(root)?.(value);
}
