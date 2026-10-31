/**
 * The art: the logo and the illustrations, one .svg per file, exported from the Figma file
 * "Dungeon Builder". See DESIGN_SYSTEM.md §6.4.
 *
 * Like the icons, the files are inlined at build time, parsed once and cloned per use. Their
 * drawings carry no colour of their own: the light parts are `currentColor` and the accent parts
 * carry the `ds-art-accent` / `ds-art-accent-line` classes that art.css colours from tokens.
 */
import landscape from './landscape.svg?raw';
import logo from './logo.svg?raw';

const sources = { landscape, logo };

/** A piece of art's name: its file name without `.svg`. */
export type ArtName = keyof typeof sources;

export interface ArtOptions {
	/** Accessible name. Without one the drawing is decorative and hidden from assistive tech. */
	label?: string;
}

const parsed = new Map<ArtName, SVGSVGElement>();

function template(name: ArtName): SVGSVGElement {
	let svg = parsed.get(name);
	if (!svg) {
		// The sources are this folder's own files, inlined at build time: never user input.
		const doc = new DOMParser().parseFromString(sources[name], 'image/svg+xml');
		svg = doc.documentElement as unknown as SVGSVGElement;
		parsed.set(name, svg);
	}
	return svg;
}

/** Makes a drawing: `<svg class="ds-art" data-art=name>`, sized by its container's width. */
export function art(name: ArtName, options: ArtOptions = {}): SVGSVGElement {
	const svg = document.importNode(template(name), true);
	svg.classList.add('ds-art');
	svg.dataset.art = name;
	if (options.label) {
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', options.label);
	} else {
		svg.setAttribute('aria-hidden', 'true');
	}
	svg.setAttribute('focusable', 'false');
	return svg;
}
