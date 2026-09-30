import * as THREE from 'three';

interface Label {
	position: THREE.Vector3;
	/** Yards from the centre to the map's edge: over the map itself, its name goes. */
	radius: number;
	element: HTMLDivElement;
}

/** Yards; names further than this aren't shown. */
const RANGE = 30000;

/**
 * Names floating over the maps laid out in the sea (dungeons, raids, battlegrounds...), so they
 * can be found and flown to from afar: many show nothing until you're close, and none have a
 * zone name of their own out there.
 */
export class MapLabels {
	private readonly labels: Label[] = [];
	private readonly projected = new THREE.Vector3();
	/** Off while the camera is somewhere enclosed (a cave, a building), where names would show through walls. */
	visible = true;

	constructor(private readonly container: HTMLElement) {}

	add(name: string, kind: string, position: THREE.Vector3, radius: number): void {
		const element = document.createElement('div');
		element.className = 'map-label';
		const title = document.createElement('div');
		title.textContent = name;
		const sub = document.createElement('div');
		sub.className = 'map-label-kind';
		sub.textContent = kind;
		element.append(title, sub);
		element.hidden = true;
		// Under the name plates and markers, which are nearer.
		this.container.prepend(element);
		this.labels.push({ position, radius, element });
	}

	/** Positions the names; call every frame. */
	update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
		for (const label of this.labels) {
			const distance = label.position.distanceTo(camera.position);
			const el = label.element;
			this.projected.copy(label.position).project(camera);
			const show = this.visible && distance > label.radius && distance < RANGE && this.projected.z < 1 && Math.abs(this.projected.x) < 1.1 && Math.abs(this.projected.y) < 1.1;
			if (!show) {
				if (!el.hidden) el.hidden = true;
				continue;
			}
			const x = (this.projected.x * 0.5 + 0.5) * width;
			const y = (-this.projected.y * 0.5 + 0.5) * height;
			el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
			// Fading in as you leave the map, and out towards the edge of the range.
			el.style.opacity = String(Math.min(1, (distance - label.radius) / 300, (1 - distance / RANGE) * 4).toFixed(2));
			el.hidden = false;
		}
	}
}
