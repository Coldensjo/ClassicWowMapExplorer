/**
 * The landing page (src/ui/specs/landing-page.md): fills the static markup in index.html with
 * the design system's art, icons and feature cards, and remembers that a folder was once linked
 * so the next visit can say the connection was lost. main.ts drives the folder card (choosing,
 * loading, errors) and scenesUi.ts the scene library under it.
 */
import { art, el, icon, type IconName } from '../ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Set once a folder has opened; the browser can't keep the folder itself across visits. */
const LINKED_KEY = 'foreverForge.folderLinked';

interface Feature {
	icon: IconName;
	title: string;
	text: string;
	/** The last card spans the row, as drawn. */
	wide?: boolean;
}

/** The "What is ForeverForge?" cards, in the drawn order. */
const FEATURES: Feature[] = [
	{ icon: 'plus', title: 'Create scenes', text: 'From scratch or copy existing maps from Azeroth as a baseline.' },
	{ icon: 'paint', title: 'Sculpt and paint', text: 'Form the terrain in whatever way you’d like.' },
	{ icon: 'sun', title: 'Set the mood', text: 'Control the time of day and weather.' },
	{ icon: 'container', title: 'Build the world', text: 'Add objects and buildings into your scene.' },
	{ icon: 'npc', title: 'Populate', text: 'Fill your scene with NPCs, whether existing or totally custom.' },
	{ icon: 'play', title: 'Explore', text: 'Walk through your scene, simulating an in-game experience.' },
	{ icon: 'download', title: 'Share', text: 'Export your scene and share the file with others so they can experience what you’ve built.', wide: true },
];

function featureCard(feature: Feature): HTMLElement {
	return el(
		'article',
		{ class: 'landing-feature', 'data-wide': feature.wide ? '' : undefined },
		el('div', { class: 'landing-feature-icon' }, icon(feature.icon, { size: 'lg' })),
		el('h3', {}, feature.title),
		el('p', {}, feature.text),
	);
}

/** Puts the logo, the landscape, the icons and the feature cards into the page's markup. Once. */
export function wireLanding(): void {
	$('landing-logo').append(art('logo', { label: 'ForeverForge' }));
	$('landing-landscape').append(art('landscape'));
	for (const slot of document.querySelectorAll<HTMLElement>('#landing [data-icon-slot]')) {
		slot.replaceWith(icon(slot.dataset.iconSlot as IconName, { size: 'lg' }));
	}
	$('landing-features').append(...FEATURES.map(featureCard));
}

/** Remembers that a World of Warcraft folder opened here, for the next visit's banner. */
export function rememberFolderLinked(): void {
	try {
		localStorage.setItem(LINKED_KEY, new Date().toISOString());
	} catch {
		// Storage blocked: the next visit starts fresh, which is still true.
	}
}

/** Whether a folder opened here on an earlier visit. */
export function folderWasLinked(): boolean {
	try {
		return localStorage.getItem(LINKED_KEY) !== null;
	} catch {
		return false;
	}
}

/** Shows or hides the lost-connection banner at the top of the folder card. */
export function showFolderLost(show: boolean): void {
	$('connect-lost').hidden = !show;
}
