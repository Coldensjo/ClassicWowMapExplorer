import * as THREE from 'three';
import type { ModelData } from '../explorer/objects';
import type { CharacterModelInfo, CustomizationOption, HumanoidPreset } from '../explorer/npcs';
import type { EquipSlot, NpcPreset } from '../scene/types';
import { createModelMaterial, type SkinUniforms } from '../viewer/modelMaterials';
import { TextureCache } from '../viewer/textureCache';
import { supportsCompressedTextures } from '../viewer/textures';
import type { AsyncStorageApi } from '../worker/protocol';
import { GearBrowser, type GearEntry } from './gearBrowser';
import { listfile } from './listfile';

/** The equipment slots in the editor's order, with their labels. */
const SLOTS: [EquipSlot, string][] = [
	['head', 'Head'], ['shoulder', 'Shoulders'], ['back', 'Back'], ['chest', 'Chest'], ['shirt', 'Shirt'], ['tabard', 'Tabard'],
	['wrist', 'Wrists'], ['hands', 'Hands'], ['waist', 'Waist'], ['legs', 'Legs'], ['feet', 'Feet'],
	['mainHand', 'Main hand'], ['offHand', 'Off hand'], ['ranged', 'Ranged'],
];
/** Results a slot's search shows at once. */
const MAX_RESULTS = 40;
/** The preview rebuilds this long (ms) after the last change. */
const REBUILD_DELAY = 250;
/** World axes from a model's (x forward, y left, z up), as the portraits renderer uses. */
const MODEL_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
const FOV = 28;
const MARGIN = 1.1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The custom NPC editor (spec 7.9.3): a modal that builds an NpcPreset from a playable race and
 * sex, its customization options (from the modern ChrCustomization tables) and gear searched per
 * slot (named where the client names it, else by path, see Q8) or browsed with pictures, with a
 * live, rotatable preview playing the idle animation. Saving hands the preset back for the
 * library and the scene.
 */
export class NpcEditor {
	private draft: NpcPreset | null = null;
	private models: CharacterModelInfo[] = [];
	private options: CustomizationOption[] = [];
	private gear: GearEntry[] | null = null;
	private gearLoading: Promise<GearEntry[]> | null = null;
	private rebuildTimer = 0;
	private readonly cleanups: (() => void)[] = [];
	private readonly preview: NpcPreview;
	private readonly browser: GearBrowser;
	/** Which build of the preview is current, so a slower earlier one doesn't replace it. */
	private buildSerial = 0;

	constructor(
		private readonly storage: AsyncStorageApi,
		build: string,
		private readonly hooks: {
			/** The worker handle a preset (or a draft of one) loads under. */
			handleOf: (preset: NpcPreset) => number;
			onSave: (preset: NpcPreset) => void;
			onNotice: (text: string) => void;
		},
	) {
		this.preview = new NpcPreview($<HTMLCanvasElement>('npc-editor-preview'), storage);
		this.browser = new GearBrowser(storage, build, {
			handleOf: (preset) => hooks.handleOf(preset),
			onPick: (slot, display) => {
				if (!this.draft) return;
				this.draft.equipment[slot] = display;
				this.scheduleRebuild();
			},
			onBack: () => this.showForm(),
		});
		const listen = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
			el.addEventListener(type, fn as EventListener);
			this.cleanups.push(() => el.removeEventListener(type, fn as EventListener));
		};
		listen($('npc-editor-close'), 'click', () => this.close());
		listen($('npc-editor-cancel'), 'click', () => this.close());
		listen($('npc-editor-save'), 'click', () => this.save());
		listen($('npc-editor-name'), 'input', () => {
			if (this.draft) this.draft.name = $<HTMLInputElement>('npc-editor-name').value;
		});
		listen($('npc-editor-race'), 'change', () => void this.setRaceSex(Number($<HTMLSelectElement>('npc-editor-race').value), this.draft?.sex ?? 0));
		listen($('npc-editor-sex'), 'change', () => void this.setRaceSex(this.draft?.race ?? 1, Number($<HTMLSelectElement>('npc-editor-sex').value) as 0 | 1));
		const onKey = (e: KeyboardEvent) => {
			if (e.code === 'Escape' && !$('npc-editor').hidden) {
				e.stopPropagation();
				// Browsing a slot, Esc goes back to the form; from the form, it closes the editor.
				if (this.browser.isOpen) this.showForm();
				else this.close();
			}
		};
		window.addEventListener('keydown', onKey, true);
		this.cleanups.push(() => window.removeEventListener('keydown', onKey, true));
	}

	get isOpen(): boolean {
		return !$('npc-editor').hidden;
	}

	/**
	 * Opens the editor on a preset (a copy is edited), or on a new one, optionally prefilled from
	 * a humanoid display ("Customize as new", spec 7.9.2).
	 */
	async open(preset: NpcPreset | null, prefill: HumanoidPreset | null = null, name = ''): Promise<void> {
		this.draft = preset ? structuredClone(preset) : { id: crypto.randomUUID(), name, race: prefill?.race ?? 1, sex: prefill?.sex ?? 0, customization: prefill ? { ...prefill.customization } : {}, equipment: prefill ? { ...prefill.equipment } : {} };
		$('npc-editor-title').textContent = preset ? 'Edit custom NPC' : 'New custom NPC';
		$<HTMLInputElement>('npc-editor-name').value = this.draft.name;
		$('npc-editor').hidden = false;
		this.setStatus('Loading the character models…');
		try {
			if (!this.models.length) this.models = await this.storage.characterModels();
		} catch (e) {
			this.hooks.onNotice(`The character models couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		if (!this.draft) return;
		const race = $<HTMLSelectElement>('npc-editor-race');
		const races = new Map<number, string>();
		for (const m of this.models) races.set(m.race, m.name);
		race.replaceChildren(...[...races].map(([id, label]) => new Option(label, String(id))));
		if (!races.has(this.draft.race)) this.draft.race = races.keys().next().value ?? 1;
		race.value = String(this.draft.race);
		$<HTMLSelectElement>('npc-editor-sex').value = String(this.draft.sex);
		const draft = this.draft;
		// Worn gear is labelled "display N" until the gear list arrives, then by name.
		void this.loadGear().then(() => {
			if (this.draft === draft) this.renderGear();
		});
		await this.setRaceSex(this.draft.race, this.draft.sex, true);
		this.preview.start();
	}

	close(): void {
		$('npc-editor').hidden = true;
		this.draft = null;
		clearTimeout(this.rebuildTimer);
		this.preview.stop();
		this.showForm();
		$('npc-editor-options').replaceChildren();
		$('npc-editor-gear').replaceChildren();
	}

	/** Opens the slot browser in place of the form (spec 7.9.3). */
	private async browse(slot: EquipSlot, label: string): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		const all = this.gear ?? (await this.loadGear());
		if (this.draft !== draft || !this.isOpen) return;
		$('npc-editor-form').hidden = true;
		this.browser.open(slot, label, all.filter((g) => g.slot === slot), draft.equipment[slot] ?? 0, { race: draft.race, sex: draft.sex });
	}

	/** Back from the slot browser: the form again, its slot rows showing what is worn now. */
	private showForm(): void {
		const browsing = this.browser.isOpen;
		this.browser.close();
		$('npc-editor-form').hidden = false;
		if (browsing && this.draft) this.renderGear();
	}

	private setStatus(text: string): void {
		$('npc-editor-status').textContent = text;
	}

	/** A race or sex change: reloads the options (keeping choices that still apply) and the gear rows. */
	private async setRaceSex(race: number, sex: 0 | 1, keep = false): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		if (!this.models.some((m) => m.race === race && m.sex === sex)) {
			// The other sex, if the race has only one model.
			const other = this.models.find((m) => m.race === race);
			if (!other) return;
			sex = other.sex;
		}
		draft.race = race;
		draft.sex = sex;
		$<HTMLSelectElement>('npc-editor-sex').value = String(sex);
		this.setStatus('Loading the customization…');
		try {
			this.options = await this.storage.customizationOptions(race, sex);
		} catch (e) {
			this.options = [];
			this.hooks.onNotice(`The customization options couldn't be read: ${e instanceof Error ? e.message : e}`);
		}
		if (this.draft !== draft) return;
		// Choices that aren't this model's are dropped; the builder takes each option's first instead.
		const valid = new Map(this.options.map((o) => [String(o.id), new Set(o.choices.map((c) => c.id))]));
		for (const [option, choice] of Object.entries(draft.customization)) {
			if (!valid.get(option)?.has(choice)) delete draft.customization[option];
		}
		if (!keep) for (const o of this.options) if (draft.customization[String(o.id)] === undefined) draft.customization[String(o.id)] = o.choices[0].id;
		this.renderOptions();
		this.renderGear();
		this.scheduleRebuild(true);
	}

	private renderOptions(): void {
		const draft = this.draft!;
		const box = $('npc-editor-options');
		box.replaceChildren(
			...this.options.map((option) => {
				const row = document.createElement('div');
				row.className = 'npc-option';
				const label = document.createElement('span');
				label.textContent = option.name;
				label.title = `Option ${option.id}`;
				row.append(label);
				const current = draft.customization[String(option.id)] ?? option.choices[0].id;
				// Colour options (skin, hair, eyes) show as swatches; a choice without one (a rare odd one out) is a plain button.
				const swatches = option.choices.filter((c) => c.swatch !== null).length >= option.choices.length / 2 && option.choices.every((c) => !c.name);
				if (swatches && option.choices.length <= 48) {
					const strip = document.createElement('div');
					strip.className = 'npc-swatches';
					option.choices.forEach((choice, i) => {
						const b = document.createElement('button');
						b.style.background = choice.swatch !== null ? `#${choice.swatch.toString(16).padStart(6, '0')}` : '#777';
						b.title = `${option.name} ${i + 1} (choice ${choice.id})`;
						b.classList.toggle('active', choice.id === current);
						b.addEventListener('click', () => {
							draft.customization[String(option.id)] = choice.id;
							for (const other of strip.children) other.classList.toggle('active', other === b);
							this.scheduleRebuild();
						});
						strip.append(b);
					});
					row.append(strip);
				} else {
					const select = document.createElement('select');
					select.replaceChildren(...option.choices.map((c, i) => new Option(c.name || `${i + 1}`, String(c.id))));
					select.value = String(current);
					select.addEventListener('change', () => {
						draft.customization[String(option.id)] = Number(select.value);
						this.scheduleRebuild();
					});
					row.append(select);
				}
				return row;
			}),
		);
	}

	/** The gear list, fetched once with the item listfile for the nameless entries' labels. */
	private loadGear(): Promise<GearEntry[]> {
		this.gearLoading ??= (async () => {
			const [displays, paths] = await Promise.all([
				this.storage.gearDisplays(),
				listfile('item').then((entries) => new Map(entries.map((e) => [e.fdid, e.path])), () => new Map<number, string>()),
			]);
			const entries = displays.map((d): GearEntry => {
				const path = paths.get(d.file) ?? '';
				const stem = path.replace(/\.(blp|m2)$/, '').split('/').pop() ?? '';
				const label = d.name ?? (stem ? stem.replace(/_/g, ' ') : `display ${d.id}`);
				return { ...d, label, search: `${label} ${path} ${d.id}`.toLowerCase() };
			});
			this.gear = entries;
			return entries;
		})().catch((e) => {
			this.gearLoading = null;
			this.hooks.onNotice(`The gear list couldn't be read: ${e instanceof Error ? e.message : e}`);
			return [];
		});
		return this.gearLoading;
	}

	private renderGear(): void {
		const draft = this.draft!;
		const box = $('npc-editor-gear');
		box.replaceChildren(
			...SLOTS.map(([slot, label]) => {
				const row = document.createElement('div');
				row.className = 'npc-slot';
				const name = document.createElement('span');
				name.textContent = label;
				const input = document.createElement('input');
				input.type = 'search';
				input.autocomplete = 'off';
				input.spellcheck = false;
				input.placeholder = 'none';
				input.setAttribute('aria-label', `${label} gear`);
				const browse = document.createElement('button');
				browse.className = 'npc-slot-browse';
				browse.type = 'button';
				browse.textContent = '▦';
				browse.title = `Browse all ${label.toLowerCase()} gear with pictures`;
				browse.setAttribute('aria-label', `Browse ${label.toLowerCase()} gear`);
				const clear = document.createElement('button');
				clear.className = 'npc-slot-clear';
				clear.textContent = '×';
				clear.title = `Wear nothing in the ${label.toLowerCase()} slot`;
				const results = document.createElement('div');
				results.className = 'npc-slot-results';
				results.hidden = true;
				const showWorn = () => {
					const display = draft.equipment[slot];
					input.value = display ? this.gear?.find((g) => g.id === display)?.label ?? `display ${display}` : '';
					input.classList.toggle('greyed', !display);
				};
				showWorn();
				const search = async () => {
					const query = input.value.trim().toLowerCase();
					if (query.length < 2) {
						results.hidden = true;
						return;
					}
					const all = this.gear ?? (await this.loadGear());
					const tokens = query.split(/\s+/);
					const found = all.filter((g) => g.slot === slot && tokens.every((t) => g.search.includes(t)));
					const shown = found.slice(0, MAX_RESULTS);
					results.replaceChildren(
						...shown.map((g) => {
							const b = document.createElement('button');
							b.textContent = g.name ? g.name : `${g.label} (${g.id})`;
							b.title = `Item display ${g.id}${g.status !== 'ok' ? ' · not downloaded in your install' : ''}`;
							if (g.status !== 'ok') b.classList.add('greyed');
							b.addEventListener('mousedown', (e) => e.preventDefault());
							b.addEventListener('click', () => {
								draft.equipment[slot] = g.id;
								results.hidden = true;
								showWorn();
								this.scheduleRebuild();
							});
							return b;
						}),
					);
					if (!shown.length) {
						const none = document.createElement('div');
						none.className = 'muted small';
						none.textContent = 'Nothing matches';
						results.append(none);
					} else if (found.length > shown.length) {
						const more = document.createElement('div');
						more.className = 'muted small';
						more.textContent = `${found.length - shown.length} more — type to narrow`;
						results.append(more);
					}
					results.hidden = false;
				};
				input.addEventListener('input', () => void search());
				input.addEventListener('focus', () => {
					input.select();
					void search();
				});
				input.addEventListener('blur', () => {
					results.hidden = true;
					showWorn();
				});
				clear.addEventListener('click', () => {
					delete draft.equipment[slot];
					showWorn();
					this.scheduleRebuild();
				});
				browse.addEventListener('click', () => void this.browse(slot, label));
				row.append(name, input, browse, clear, results);
				return row;
			}),
		);
	}

	/** Rebuilds the preview a moment after the last change (immediately when now is set). */
	private scheduleRebuild(now = false): void {
		clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => void this.rebuild(), now ? 0 : REBUILD_DELAY);
	}

	private async rebuild(): Promise<void> {
		const draft = this.draft;
		if (!draft) return;
		const serial = ++this.buildSerial;
		this.setStatus('Building the model…');
		try {
			const handle = this.hooks.handleOf(draft);
			const [data] = await this.storage.loadModels([{ fdid: handle, kind: 'npcPreset' }]);
			if (serial !== this.buildSerial || this.draft !== draft) return;
			if (!data) {
				this.setStatus('This race and sex have no model in your client');
				await this.preview.show(null);
				return;
			}
			await this.preview.show(data);
			if (serial !== this.buildSerial) return;
			this.setStatus(data.missingGear?.length ? `Gear not in your client, left off: ${data.missingGear.join(', ')}` : '');
		} catch (e) {
			if (serial === this.buildSerial) this.setStatus(`The model couldn't be built: ${e instanceof Error ? e.message : e}`);
		}
	}

	private save(): void {
		const draft = this.draft;
		if (!draft) return;
		draft.name = $<HTMLInputElement>('npc-editor-name').value.trim() || `${this.models.find((m) => m.race === draft.race)?.name ?? 'Custom'} NPC`;
		this.hooks.onSave(structuredClone(draft));
		this.close();
	}

	dispose(): void {
		this.close();
		this.preview.dispose();
		this.browser.dispose();
		for (const c of this.cleanups) c();
		this.cleanups.length = 0;
	}
}

/**
 * The editor's preview: the built model on a renderer of its own, lit from the front, playing
 * its Stand loop, turned by dragging.
 */
class NpcPreview {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(FOV, 3 / 4, 0.05, 500);
	private readonly textures: TextureCache;
	private readonly clock = new THREE.Clock();
	private frame = 0;
	private yaw = Math.PI + 0.3;
	private shown: { mesh: THREE.Mesh; textures: number[]; boneTexture: THREE.DataTexture | null; skin: SkinUniforms | null; clip: { row: number; frames: number; duration: number } | null; time: number } | null = null;
	private dragging: { x: number; yaw: number } | null = null;

	constructor(private readonly canvas: HTMLCanvasElement, storage: AsyncStorageApi) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(canvas.width, canvas.height, false);
		this.renderer.setClearColor(0x000000, 0);
		this.textures = new TextureCache(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy());
		this.scene.add(new THREE.AmbientLight(0xffffff, 1.9));
		const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
		key.position.set(-1.5, 2, 3);
		const rim = new THREE.DirectionalLight(0xbfd4ff, 1.2);
		rim.position.set(2, 1.5, -2);
		this.scene.add(key, rim);
		canvas.addEventListener('mousedown', this.onDown);
		window.addEventListener('mousemove', this.onMove);
		window.addEventListener('mouseup', this.onUp);
	}

	private readonly onDown = (e: MouseEvent) => {
		if (e.button !== 0) return;
		this.dragging = { x: e.clientX, yaw: this.yaw };
		e.preventDefault();
	};

	private readonly onMove = (e: MouseEvent) => {
		if (this.dragging) this.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.012;
	};

	private readonly onUp = () => {
		this.dragging = null;
	};

	start(): void {
		this.stop();
		this.clock.start();
		const loop = () => {
			this.frame = requestAnimationFrame(loop);
			this.update(Math.min(this.clock.getDelta(), 0.1));
		};
		loop();
	}

	stop(): void {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		void this.show(null);
	}

	/** Replaces the shown model (null clears it). */
	async show(data: ModelData | null): Promise<void> {
		if (this.shown) {
			this.scene.remove(this.shown.mesh);
			this.shown.mesh.geometry.dispose();
			for (const m of this.shown.mesh.material as THREE.Material[]) m.dispose();
			this.shown.boneTexture?.dispose();
			this.textures.release(this.shown.textures);
			this.shown = null;
		}
		if (!data) return;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		let boneTexture: THREE.DataTexture | null = null;
		let skin: SkinUniforms | null = null;
		let clip: { row: number; frames: number; duration: number } | null = null;
		const a = data.animation;
		if (a) {
			geometry.setAttribute('boneIndex', new THREE.BufferAttribute(a.boneIndex, 4));
			geometry.setAttribute('boneWeight', new THREE.BufferAttribute(a.boneWeight, 4, true));
			boneTexture = new THREE.DataTexture(a.data, a.bones * 3, a.data.length / (a.bones * 12), THREE.RGBAFormat, THREE.FloatType);
			boneTexture.magFilter = boneTexture.minFilter = THREE.NearestFilter;
			boneTexture.needsUpdate = true;
			clip = a.clips[0];
			skin = { uBoneTex: { value: boneTexture as THREE.Texture }, uPoseA: { value: new THREE.Vector3(clip.row, clip.row, 0) }, uPoseB: { value: new THREE.Vector3(clip.row, clip.row, 0) }, uPoseMix: { value: 0 } };
		}
		const drawn = data.batches.filter((b) => !b.material.collision).sort((x, y) => x.order - y.order);
		const ids = [...new Set(drawn.map((b) => b.material.texture).filter((t) => t))];
		const textures = await this.textures.acquire(ids);
		if (this.shown) {
			// Another model arrived meanwhile.
			this.textures.release(ids);
			geometry.dispose();
			boneTexture?.dispose();
			return;
		}
		const materials = drawn.map((b, i) => {
			geometry.addGroup(b.start, b.count, i);
			return createModelMaterial(b.material, textures.get(b.material.texture) ?? null, false, skin);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = false;
		this.scene.add(mesh);
		this.shown = { mesh, textures: ids, boneTexture, skin, clip, time: 0 };
		// Frame the model standing: back far enough for its height (model z) to fill the view, a
		// little further for a wide one. The header's bounding radius overstates most models, so it
		// only ever adds up to the height.
		const height = Math.max(0.5, data.height);
		const width = Math.min(height, Math.max(0.5, data.radius));
		const half = THREE.MathUtils.degToRad(FOV / 2);
		const distance = Math.max((height / 2) * MARGIN / Math.tan(half), (width / 2) * MARGIN / Math.tan(half * this.camera.aspect)) + width * 0.5;
		this.camera.position.set(0, height * 0.5, distance);
		this.camera.lookAt(0, height * 0.5, 0);
		this.camera.updateProjectionMatrix();
	}

	private update(dt: number): void {
		const s = this.shown;
		if (s) {
			s.mesh.matrix.makeRotationY(this.yaw).multiply(MODEL_BASIS);
			s.mesh.matrixWorldNeedsUpdate = true;
			if (s.skin?.uPoseA && s.clip) {
				s.time = (s.time + dt) % s.clip.duration;
				const at = (s.time / s.clip.duration) * s.clip.frames;
				const i = Math.min(Math.floor(at), s.clip.frames - 1);
				const next = i + 1 < s.clip.frames ? i + 1 : 0;
				s.skin.uPoseA.value.set(s.clip.row + i, s.clip.row + next, at - Math.floor(at));
			}
		}
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.stop();
		this.canvas.removeEventListener('mousedown', this.onDown);
		window.removeEventListener('mousemove', this.onMove);
		window.removeEventListener('mouseup', this.onUp);
		this.renderer.dispose();
	}
}
