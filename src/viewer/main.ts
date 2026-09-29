import { filesToSource, hasDirectoryPicker, pickDirectory } from '../app/folderPicker';
import { createStorageClient } from '../worker/client';
import type { SourceInit } from '../worker/protocol';
import type { SpawnInfo } from '../explorer/spawns';
import { Viewer, type HudInfo } from './viewer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');

const storage = createStorageClient((message) => setStatus(`${message}…`));

function setStatus(text: string, isError = false): void {
	status.textContent = text;
	status.className = isError ? 'bad' : 'muted';
}

async function useSource(init: SourceInit): Promise<void> {
	setStatus('Reading .build.info');
	try {
		const products = (await storage.setSource(init)).filter((p) => p.product.startsWith('wow'));
		const select = $<HTMLSelectElement>('product');
		select.replaceChildren(...products.map((p) => new Option(`${p.product} ${p.version}`, p.product)));
		// Prefer a classic build: the continent file IDs are the classic ones.
		const preferred = products.find((p) => p.product === 'wow_classic_beta') ?? products.find((p) => p.product.startsWith('wow_classic'));
		if (preferred) select.value = preferred.product;
		$('product-step').hidden = products.length === 0;
		setStatus(products.length ? 'Choose a game version and press Explore.' : 'No WoW products found in .build.info', !products.length);
	} catch (e) {
		setStatus(`${(e as Error).message}. Pick the World of Warcraft folder itself (the one containing .build.info).`, true);
	}
}

$('pick').addEventListener('click', () => $<HTMLInputElement>('pick-input').click());
$<HTMLInputElement>('pick-input').addEventListener('change', async (event) => {
	const files = (event.target as HTMLInputElement).files ?? [];
	setStatus(`Selected ${files.length.toLocaleString()} files`);
	await useSource(filesToSource(files));
});

if (!hasDirectoryPicker) $('pick-direct').hidden = true;
$('pick-direct').addEventListener('click', async () => {
	try {
		const init = await pickDirectory();
		if (init) await useSource(init);
	} catch (e) {
		setStatus((e as Error).message, true);
	}
});

$('explore').addEventListener('click', async () => {
	const button = $<HTMLButtonElement>('explore');
	button.disabled = true;
	try {
		await storage.open($<HTMLSelectElement>('product').value);
		const viewer = new Viewer($('view'), storage, showHud, showInfo, $('nameplates'));
		await viewer.load((text) => setStatus(`${text}…`));
		$('start').hidden = true;
		$('hud').hidden = $('help').hidden = false;
		viewer.start();
	} catch (e) {
		setStatus(`Could not start: ${(e as Error).message}`, true);
		button.disabled = false;
	}
});

// --- Clicked creature or object ---

document.addEventListener('pointerlockchange', () => {
	$('crosshair').hidden = !document.pointerLockElement;
});
$('info-close').addEventListener('click', () => ($('info').hidden = true));
window.addEventListener('keydown', (e) => {
	if (e.code === 'Escape') $('info').hidden = true;
});

/** Book text uses $B for line breaks and $N for the reader's name. */
function pageText(text: string): string {
	return text.replace(/\$[Bb]/g, '\n').replace(/\$[Nn]/g, 'traveler').replace(/\$[Cc]/g, 'adventurer');
}

function showInfo(info: SpawnInfo): void {
	const isNpc = info.type === 'npc';
	$('info-kind').textContent = [isNpc ? 'NPC' : 'Object', info.kind, info.rank].filter(Boolean).join(' · ');
	$('info-name').textContent = info.name;
	$('info-sub').textContent = info.subname ? `<${info.subname}>` : '';
	const facts: [string, string][] = [];
	if (info.level) facts.push(['Level', info.level]);
	facts.push([isNpc ? 'NPC ID' : 'Object ID', String(info.entry)], ['Spawn', String(info.guid)]);
	$('info-facts').replaceChildren(...facts.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));

	const pages = $('info-pages');
	pages.replaceChildren();
	(info.pages ?? []).forEach((text, i) => {
		if (i > 0) pages.append(document.createElement('hr'));
		pages.append(pageText(text));
	});

	// Wowhead uses the same creature/object template IDs; its tooltip script decorates these links.
	const path = `${isNpc ? 'npc' : 'object'}=${info.entry}`;
	const links = [
		['Wowhead Forever', `https://www.wowhead.com/forever/${path}`],
		['Wowhead Classic', `https://www.wowhead.com/classic/${path}`],
	].map(([label, href]) => {
		const a = document.createElement('a');
		a.href = href;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = label;
		return a;
	});
	$('info-links').replaceChildren(...links);
	$('info').hidden = false;
	(window as unknown as { $WowheadPower?: { refreshLinks?: () => void } }).$WowheadPower?.refreshLinks?.();
}

let shownZone: string | null = null;
let shownSubzone: string | null = null;

/** Shows the zone banner when entering a new zone, or just the subzone within the same zone. */
function announceZone(zone: string | null, subzone: string | null): void {
	if (!zone || (zone === shownZone && subzone === shownSubzone)) return;
	const newZone = zone !== shownZone;
	shownZone = zone;
	shownSubzone = subzone;
	if (!newZone && !subzone) return;
	$('zone-name').textContent = newZone ? zone : subzone ?? '';
	$('subzone-name').textContent = newZone ? subzone ?? '' : '';
	const banner = $('zone-banner');
	banner.classList.remove('show');
	void banner.offsetWidth; // restart the animation
	banner.classList.add('show');
}

function showHud(info: HudInfo): void {
	announceZone(info.zone, info.subzone);
	$('hud-location').textContent = info.zone ? [info.zone, info.subzone].filter(Boolean).join(' · ') : info.location;
	$('hud-coords').textContent = info.zone ? `${info.location} · ${info.coordinates}` : info.coordinates;
	const rows: [string, string][] = [
		['Time', info.time],
		['Names for', info.side],
		['Altitude', `${info.altitude.toFixed(0)} yd above ground`],
		['Speed', `${info.speed.toFixed(0)} yd/s`],
		['Detail', info.near],
		['Objects', info.objects],
		['Textures', info.textures],
		['FPS', info.fps.toFixed(0)],
	];
	$('hud-stats').replaceChildren(...rows.flatMap(([k, v]) => {
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = v;
		return [dt, dd];
	}));
}
