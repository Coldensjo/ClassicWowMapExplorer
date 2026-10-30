/**
 * The icon set: one 24×24 line drawing per .svg in this folder, exported from the Figma file
 * "Dungeon Builder". See DESIGN_SYSTEM.md §6.
 *
 * The files are inlined at build time (Vite's ?raw), parsed once on first use, and cloned for
 * each icon, so an icon is a real <svg> that takes its colour from `currentColor` and its size
 * and line width from icon.css. Add an icon by dropping its normalised file here and adding
 * one import and one entry to `sources`.
 */
import alert from './alert.svg?raw';
import checkmark from './checkmark.svg?raw';
import close from './close.svg?raw';
import container from './container.svg?raw';
import down from './down.svg?raw';
import download from './download.svg?raw';
import dragToExpand from './drag-to-expand.svg?raw';
import eyedropped from './eyedropped.svg?raw';
import grid from './grid.svg?raw';
import help from './help.svg?raw';
import hole from './hole.svg?raw';
import info from './info.svg?raw';
import left from './left.svg?raw';
import list from './list.svg?raw';
import logOut from './log-out.svg?raw';
import menu from './menu.svg?raw';
import minus from './minus.svg?raw';
import more from './more.svg?raw';
import npc from './npc.svg?raw';
import paint from './paint.svg?raw';
import play from './play.svg?raw';
import plus from './plus.svg?raw';
import reset from './reset.svg?raw';
import right from './right.svg?raw';
import save from './save.svg?raw';
import scene from './scene.svg?raw';
import sculpt from './sculpt.svg?raw';
import search from './search.svg?raw';
import sun from './sun.svg?raw';
import up from './up.svg?raw';
import water from './water.svg?raw';

const sources = {
	alert,
	checkmark,
	close,
	container,
	down,
	download,
	'drag-to-expand': dragToExpand,
	eyedropped,
	grid,
	help,
	hole,
	info,
	left,
	list,
	'log-out': logOut,
	menu,
	minus,
	more,
	npc,
	paint,
	play,
	plus,
	reset,
	right,
	save,
	scene,
	sculpt,
	search,
	sun,
	up,
	water,
};

/** An icon's name: its file name without `.svg`. */
export type IconName = keyof typeof sources;

/** Every icon name, in file order, for galleries and checks. */
export const iconNames = Object.keys(sources) as IconName[];

export type IconSize = 'sm' | 'md' | 'lg';

export interface IconOptions {
	/** `sm` 16px, `md` 20px (default), `lg` 24px; see --icon-size-* in tokens/layout.css. */
	size?: IconSize;
	/** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
	label?: string;
}

const parsed = new Map<IconName, SVGSVGElement>();

function template(name: IconName): SVGSVGElement {
	let svg = parsed.get(name);
	if (!svg) {
		// The sources are this folder's own files, inlined at build time: never user input.
		const doc = new DOMParser().parseFromString(sources[name], 'image/svg+xml');
		svg = doc.documentElement as unknown as SVGSVGElement;
		parsed.set(name, svg);
	}
	return svg;
}

/** Makes an icon element: `<svg class="ds-icon" data-icon=name>`, coloured by currentColor. */
export function icon(name: IconName, options: IconOptions = {}): SVGSVGElement {
	const svg = document.importNode(template(name), true);
	svg.classList.add('ds-icon');
	svg.dataset.icon = name;
	if (options.size) svg.dataset.size = options.size;
	if (options.label) {
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', options.label);
	} else {
		svg.setAttribute('aria-hidden', 'true');
	}
	svg.setAttribute('focusable', 'false');
	return svg;
}
