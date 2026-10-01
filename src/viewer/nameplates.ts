import * as THREE from 'three';
import type { Reaction, SpawnInfo } from '../explorer/spawns';

export type Side = 'alliance' | 'horde';

export interface Plate {
	info: SpawnInfo;
	position: THREE.Vector3;
	distance: number;
	/** In line of sight from the camera (not behind terrain or a building). */
	visible?: boolean;
}

const MAX_PLATES = 60;
/**
 * As in the game, names have a size in the world (yards of font size), so they shrink with
 * distance like everything else and are large up close; within these pixel sizes, so far
 * ones stay legible and near ones don't fill the screen.
 */
const NAME_HEIGHT = 0.32;
const NAME_MIN_PX = 7;
const NAME_MAX_PX = 72;

/**
 * Names above NPCs' heads, like the game's: coloured by how they react to the chosen side
 * (red hostile, yellow neutral, green friendly), with their title below.
 */
export class Nameplates {
	private readonly pool: HTMLDivElement[] = [];
	private readonly projected = new THREE.Vector3();

	constructor(private readonly container: HTMLElement) {}

	private element(i: number): HTMLDivElement {
		let el = this.pool[i];
		if (!el) {
			el = document.createElement('div');
			el.className = 'plate';
			el.append(document.createElement('div'), document.createElement('div'));
			(el.children[1] as HTMLElement).className = 'plate-sub';
			this.container.append(el);
			this.pool[i] = el;
		}
		return el;
	}

	/** Positions labels for the given plates; call every frame. */
	update(plates: Plate[], camera: THREE.Camera, width: number, height: number, side: Side, range: number): void {
		// Nearest first, so the closest names win when there are many.
		plates.sort((a, b) => a.distance - b.distance);
		// Pixels a yard spans one yard from the camera: half the view's height over tan(half the field of view).
		const pixelsPerYard = (camera.projectionMatrix.elements[5] * height) / 2;
		let shown = 0;
		for (const plate of plates) {
			if (shown >= MAX_PLATES) break;
			if (plate.visible === false) continue;
			this.projected.copy(plate.position).project(camera);
			// Behind the camera or off screen.
			if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.1 || Math.abs(this.projected.y) > 1.1) continue;
			const el = this.element(shown++);
			const reaction: Reaction = plate.info.reaction?.[side] ?? 'neutral';
			const [name, sub] = el.children as unknown as [HTMLElement, HTMLElement];
			if (name.textContent !== plate.info.name) name.textContent = plate.info.name;
			const subText = plate.info.subname ? `<${plate.info.subname}>` : '';
			if (sub.textContent !== subText) sub.textContent = subText;
			el.dataset.reaction = reaction;
			const x = (this.projected.x * 0.5 + 0.5) * width;
			const y = (-this.projected.y * 0.5 + 0.5) * height;
			el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
			// The font size itself rather than a scale, so the text stays sharp; in half pixels, so it rarely changes.
			const px = Math.min(NAME_MAX_PX, Math.max(NAME_MIN_PX, (NAME_HEIGHT * pixelsPerYard) / Math.max(plate.distance, 0.1)));
			const size = `${Math.round(px * 2) / 2}px`;
			if (el.style.fontSize !== size) el.style.fontSize = size;
			// Fade out towards the edge of the range.
			el.style.opacity = String(Math.min(1, (1 - plate.distance / range) * 4));
			el.hidden = false;
		}
		for (let i = shown; i < this.pool.length; i++) this.pool[i].hidden = true;
	}

	clear(): void {
		for (const el of this.pool) el.hidden = true;
	}
}
