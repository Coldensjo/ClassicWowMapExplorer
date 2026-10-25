import * as THREE from 'three';

/** An NPC's name to float over its head this frame. */
export interface Plate {
	id: string;
	name: string;
	/** The title, shown as "<Title>" under the name; empty for none. */
	sub: string;
	/** Where the name's bottom goes: just over the head. */
	position: THREE.Vector3;
	distance: number;
}

/** Yards; names further from the player than this aren't shown (spec 7.10). */
export const NAMEPLATE_RANGE = 40;
/**
 * As in the game, names have a size in the world (yards of font size), so they shrink with
 * distance like everything else and are large up close; within these pixel sizes, so far ones
 * stay legible and near ones don't fill the screen.
 */
const NAME_HEIGHT = 0.32;
const NAME_MIN_PX = 9;
const NAME_MAX_PX = 56;
/**
 * A name is drawn into its picture at a font size from these steps (in device pixels, a quarter
 * octave apart) just above the size it's shown at, so it's only redrawn when it crosses one.
 */
const STEPS_PER_OCTAVE = 4;
const PICTURE_MIN_PX = 12;
const PICTURE_MAX_PX = 160;
/** The game's own font when the install has given it (uiAssets.ts), else the page's. */
const FONT_FAMILY = `'Friz Quadrata', 'Trebuchet MS', system-ui, sans-serif`;
/** UnitSelectionColor for a neutral unit: yellow. NPCs here have no faction (spec 7.10). */
const COLOR = '#ffff00';
/** Milliseconds out of the list after which a name's picture is let go. */
const DISPOSE_AFTER = 5000;

/** One NPC's name: its picture, the sprite it's drawn on, and the size it was painted at. */
interface Label {
	sprite: THREE.Sprite;
	canvas: HTMLCanvasElement;
	texture: THREE.CanvasTexture | null;
	/** What the picture shows: text, font size and the fonts there were to draw it with. */
	key: string;
	/** Font size the picture was drawn at, and the margin around the text for its shadow, in its pixels. */
	fontPx: number;
	pad: number;
	seen: number;
}

/**
 * Names above NPCs' heads in play mode (spec 7.10), after the explorer's: the name with the
 * title under it, in the game's font with a faint shadow, sized in yards so they shrink with
 * distance within a legible range. Drawn as sprites in the scene, so a model (or the ground)
 * in front of a name covers it.
 */
export class Nameplates {
	readonly group = new THREE.Group();
	private readonly labels = new Map<string, Label>();

	private label(id: string, now: number): Label {
		let label = this.labels.get(id);
		if (!label) {
			const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true, sizeAttenuation: true });
			const sprite = new THREE.Sprite(material);
			// The anchor is the picture's bottom centre: it sits on the head.
			sprite.center.set(0.5, 0);
			sprite.renderOrder = 20;
			this.group.add(sprite);
			label = { sprite, canvas: document.createElement('canvas'), texture: null, key: '', fontPx: 0, pad: 0, seen: now };
			this.labels.set(id, label);
		}
		return label;
	}

	/** Draws the name (and title) into the label's picture at the given font size, if it isn't already. */
	private paint(label: Label, name: string, sub: string, fontPx: number): void {
		// The game's font may arrive after the first names were drawn; they're drawn again in it.
		const key = `${name}\n${sub}\n${fontPx}\n${document.fonts.size}`;
		if (label.key === key) return;
		label.key = key;
		const lines = sub ? [name, sub] : [name];
		const ctx = label.canvas.getContext('2d')!;
		const font = `400 ${fontPx}px ${FONT_FAMILY}`;
		ctx.font = font;
		const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
		const lineHeight = fontPx * 1.05;
		const pad = Math.ceil(fontPx * 0.15) + 1;
		label.canvas.width = Math.ceil(width) + pad * 2;
		label.canvas.height = Math.ceil(lineHeight * lines.length) + pad * 2;
		// Resizing the canvas reset its state.
		ctx.font = font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = COLOR;
		ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
		ctx.shadowOffsetX = ctx.shadowOffsetY = fontPx * 0.04;
		ctx.shadowBlur = fontPx * 0.08;
		lines.forEach((line, i) => ctx.fillText(line, label.canvas.width / 2, pad + lineHeight * (i + 0.5)));
		label.fontPx = fontPx;
		label.pad = pad;
		// A new texture each time: three can't change the size of one it has uploaded.
		label.texture?.dispose();
		const texture = (label.texture = new THREE.CanvasTexture(label.canvas));
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.anisotropy = 1;
		label.sprite.material.map = texture;
		label.sprite.material.needsUpdate = true;
	}

	private dispose(id: string, label: Label): void {
		this.group.remove(label.sprite);
		label.sprite.material.dispose();
		label.texture?.dispose();
		this.labels.delete(id);
	}

	/** Places and sizes the names for the plates given; call every frame before rendering. */
	update(plates: Plate[], camera: THREE.PerspectiveCamera, viewHeightPx: number, pixelRatio: number): void {
		const now = performance.now();
		for (const label of this.labels.values()) label.sprite.visible = false;
		for (const [id, label] of this.labels) if (now - label.seen > DISPOSE_AFTER) this.dispose(id, label);
		// Pixels a yard spans one yard from the camera: half the view's height over tan(half the field of view).
		const pixelsPerYard = (camera.projectionMatrix.elements[5] * viewHeightPx) / 2;
		for (const plate of plates) {
			const label = this.label(plate.id, now);
			label.seen = now;
			const distance = Math.max(plate.distance, 0.1);
			const px = Math.min(NAME_MAX_PX, Math.max(NAME_MIN_PX, (NAME_HEIGHT * pixelsPerYard) / distance));
			const devicePx = px * pixelRatio;
			const fontPx = Math.min(PICTURE_MAX_PX, Math.max(PICTURE_MIN_PX, Math.round(2 ** (Math.ceil(Math.log2(devicePx) * STEPS_PER_OCTAVE) / STEPS_PER_OCTAVE))));
			this.paint(label, plate.name, plate.sub ? `<${plate.sub}>` : '', fontPx);
			// The picture's height in yards at this distance, so it shows px tall on screen.
			const height = (label.canvas.height / label.fontPx) * (px / pixelsPerYard) * distance;
			label.sprite.scale.set(height * (label.canvas.width / label.canvas.height), height, 1);
			label.sprite.position.copy(plate.position);
			label.sprite.visible = true;
		}
	}

	disposeAll(): void {
		for (const [id, label] of [...this.labels]) this.dispose(id, label);
	}
}
