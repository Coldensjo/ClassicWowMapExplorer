import * as THREE from 'three';
import { TILE_SIZE } from '../formats/adt';
import { KNOWN_MAPS } from '../explorer/maps';
import type { FarTile } from '../explorer/world';
import type { AsyncStorageApi } from '../worker/protocol';
import type { AreaInfo } from '../explorer/lighting';
import type { WmoArea } from '../explorer/music';
import type { SpawnInfo } from '../explorer/spawns';
import { FlyControls } from './flyControls';
import { DAY, Lighting, Sky, sunDirection } from './lighting';
import { MusicPlayer, type MusicTarget } from './music';
import { Nameplates, type Plate, type Side } from './nameplates';
import { ObjectManager } from './objects';
import { perf } from './perf';
import { TerrainManager, type ContinentPlacement } from './terrain';
import { liquidMaterials, liquidTime } from './terrainMaterials';
import { supportsCompressedTextures } from './textures';

/** Tiles of open sea between Kalimdor and the Eastern Kingdoms in the shared world. */
const CONTINENT_GAP = 6;
/** WoW world coordinates are measured from the centre of the 64x64 tile grid. */
const MAP_ORIGIN = 32 * TILE_SIZE;
const SKY = new THREE.Color(0x9ec4e4);
/** Yards the camera keeps from building surfaces: well past its 0.5 yd near plane, so looking down never clips through a floor. */
const CAMERA_RADIUS = 1.5;
/** Half-minutes the T key moves the time of day (15 minutes). */
const TIME_STEP = 30;
/** Yards; NPC names show within this distance, like the game's name plates. */
const NAMEPLATE_RANGE = 45;
/** Yards; clicks further than this don't select anything. */
const PICK_DISTANCE = 400;
const TORCH_COLOR = 0xffa650;
/** Yards; the light fades to nothing at this distance. */
const TORCH_RANGE = 45;
/** Candela-like units: about full daylight brightness at 10 yards. */
const TORCH_INTENSITY = 220;
/**
 * Inverse-square falloff blows out surfaces right next to the camera, so the torch's falloff is
 * held flat within about 7.5 yards (a floor on distance squared). It's the only point light here,
 * so three.js's shared attenuation function is patched directly.
 */
const TORCH_NEAR_SQUARED = 58;
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
	'max( pow( lightDistance, decayExponent ), 0.01 )',
	`max( pow( lightDistance, decayExponent ), ${TORCH_NEAR_SQUARED.toFixed(1)} )`,
);

export interface HudInfo {
	location: string;
	coordinates: string;
	altitude: number;
	height: number;
	speed: number;
	fps: number;
	near: string;
	textures: string;
	objects: string;
	/** Game time of day, e.g. 14:30. */
	time: string;
	/** Side that NPC name colours are shown for. */
	side: string;
	/** Top-level zone and the subzone under the camera, when known. */
	zone: string | null;
	subzone: string | null;
	music: string;
}

export class Viewer {
	readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly controls: FlyControls;
	private terrain!: TerrainManager;
	private objects!: ObjectManager;
	private readonly fog = new THREE.Fog(SKY, 1000, 8000);
	private continents: ContinentPlacement[] = [];
	private frames = 0;
	private fps = 0;
	private lastFpsTime = performance.now();
	private lastLodUpdate = 0;
	private readonly sun = new THREE.DirectionalLight(0xfff2dd);
	private readonly ambient = new THREE.HemisphereLight(0x8899aa, 0x8899aa);
	private readonly sky = new Sky();
	private lighting: Lighting | null = null;
	private readonly areas = new Map<number, AreaInfo>();
	/** Half-minutes added to the local clock (T / Shift+T, N resets). */
	private timeOffset = 0;
	private lastLightUpdate = 0;
	/** Warm light carried with the camera, like holding a torch (L toggles it). */
	private readonly torch = new THREE.PointLight(TORCH_COLOR, 0, TORCH_RANGE, 2);
	private torchOn = true;
	/** Whose eyes name colours are seen through (F toggles). */
	private side: Side = 'alliance';
	private readonly nameplates: Nameplates | null;
	/** Zone music (M toggles). */
	private music: MusicPlayer | null = null;
	private musicTarget: MusicTarget = { set: 0, intro: 0 };
	private lastMusicCheck = 0;
	/** WMOAreaTable rows by room, looked up in the worker as rooms are entered. */
	private readonly rooms = new Map<string, WmoArea | null | 'pending'>();
	/** The room the camera was last found in, if any. */
	private room: WmoArea | null = null;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly storage: AsyncStorageApi,
		private readonly onHud: (info: HudInfo) => void,
		private readonly onSelect: (info: SpawnInfo) => void = () => {},
		plateContainer: HTMLElement | null = null,
	) {
		this.nameplates = plateContainer ? new Nameplates(plateContainer) : null;
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 400000);
		this.controls = new FlyControls(this.camera, canvas);

		this.scene.background = SKY;
		this.scene.fog = this.fog;
		// Intensity pi: three's Lambert divides by pi, so the result is the game's
		// texture * (ambient + direct * N.L).
		this.sun.intensity = Math.PI;
		this.ambient.intensity = Math.PI;
		this.sun.position.set(-0.6, 1, 0.45);
		this.scene.add(this.sun, this.ambient, this.sky.mesh);
		// Held low and to the right, so nearby surfaces get some shading rather than flat front light.
		this.torch.position.set(0.8, -0.6, -0.4);
		this.camera.add(this.torch);
		this.scene.add(this.camera);

		window.addEventListener('resize', () => this.resize());
		window.addEventListener('keydown', (e) => this.onKey(e));
		canvas.addEventListener('click', (e) => this.onClick(e));
		canvas.addEventListener('mousemove', (e) => this.onHover(e));
		this.resize();
	}

	private readonly raycaster = new THREE.Raycaster();
	private lastHover = 0;

	/** Spawn under the mouse, or under the centre crosshair while the mouse is captured. */
	private pickAt(e: MouseEvent): SpawnInfo | null {
		if (!this.objects) return null;
		const ndc = this.controls.locked
			? new THREE.Vector2(0, 0)
			: new THREE.Vector2((e.offsetX / this.canvas.clientWidth) * 2 - 1, -(e.offsetY / this.canvas.clientHeight) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
		this.raycaster.far = PICK_DISTANCE;
		return this.objects.pick(this.raycaster)?.info ?? null;
	}

	/** Clicking a creature or object opens its info (releasing the mouse); elsewhere captures the mouse. */
	private onClick(e: MouseEvent): void {
		const hit = this.pickAt(e);
		if (hit) {
			if (this.controls.locked) document.exitPointerLock();
			this.onSelect(hit);
		} else {
			this.controls.lock();
		}
	}

	private onHover(e: MouseEvent): void {
		if (this.controls.locked || performance.now() - this.lastHover < 80) return;
		this.lastHover = performance.now();
		this.canvas.style.cursor = this.pickAt(e) ? 'pointer' : '';
	}

	/**
	 * Adds or removes the torch. Off removes the light rather than dimming it, so shaders skip
	 * it entirely; three.js recompiles them for the new light count, which measured as no hitch.
	 */
	private setTorch(on: boolean): void {
		this.torchOn = on;
		if (on) this.camera.add(this.torch);
		else this.camera.remove(this.torch);
	}

	get usesCompressedTextures(): boolean {
		return supportsCompressedTextures(this.renderer);
	}

	/** Loads the low-detail world, places the camera and starts streaming textures. */
	async load(onStatus: (text: string) => void): Promise<void> {
		const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
		// Compiles shaders in the background (KHR_parallel_shader_compile) before objects are shown.
		const prepare = (object: THREE.Object3D) => this.renderer.compileAsync(object, this.camera, this.scene).then(() => undefined);
		this.objects = new ObjectManager(this.storage, this.usesCompressedTextures, anisotropy, prepare);
		// Buildings (and the caves and mines built as buildings) are solid.
		this.controls.collide = (from, move) => {
			// Most of the time there's no building anywhere near; skip the ray casts then.
			if (!this.objects.nearBuilding(from, move.length() + CAMERA_RADIUS)) return move;
			const allowed = this.objects.sweep(from, move, CAMERA_RADIUS);
			return allowed.add(this.objects.pushOut(from.clone().add(allowed), CAMERA_RADIUS));
		};
		this.terrain = new TerrainManager(this.storage, this.usesCompressedTextures, anisotropy, this.objects, prepare);
		// Walking creatures follow the ground.
		this.objects.groundAt = (x, z) => this.terrain.heightAt(x, z);
		this.scene.add(this.terrain.group, this.objects.group);

		const loaded: { map: (typeof KNOWN_MAPS)[number]; tiles: FarTile[] }[] = [];
		for (const map of KNOWN_MAPS) {
			onStatus(`Reading ${map.name} heightmap`);
			loaded.push({ map, tiles: await this.storage.loadFarTiles(map.wdt, map.wdl) });
		}
		this.continents = layoutContinents(loaded);
		loaded.forEach(({ tiles }, i) => this.terrain.addContinent(this.continents[i], tiles));
		this.addOcean();

		onStatus('Reading lighting and zone names');
		try {
			const [lighting, areas] = await Promise.all([
				this.storage.loadLighting(this.continents.map((c) => c.mapId)),
				this.storage.loadAreas(),
			]);
			this.lighting = new Lighting(lighting);
			for (const a of areas) this.areas.set(a.id, a);
		} catch (e) {
			console.warn('Lighting unavailable, using defaults:', e);
		}
		// Music starts once its tables are read; the world needn't wait for it.
		this.storage.loadMusic().then(
			(data) => (this.music = new MusicPlayer(this.storage, data)),
			(e) => console.warn('Music unavailable:', e),
		);

		// ?time=HH:MM starts at that time of day.
		const time = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('time') ?? '');
		if (time) this.timeOffset = (Number(time[1]) * 60 + Number(time[2])) * 2 - this.timeOfDay();

		const view = this.viewFromHash();
		if (view) this.controls.set(view.position, view.yaw, view.pitch);
		else this.goToStart();
		window.addEventListener('pagehide', () => this.writeHash(performance.now(), true));
		window.addEventListener('hashchange', () => {
			const next = this.viewFromHash();
			if (next && location.hash !== this.lastHash) this.controls.flyTo(next.position, next.yaw, next.pitch, 2);
		});
		void this.terrain.loadFarTextures(this.camera.position);
	}

	/**
	 * The URL hash holds the camera as #continent/tileX/tileY/heightAboveGround/yaw/pitch
	 * (tiles fractional, angles in degrees), so views can be bookmarked and shared.
	 */
	private viewFromHash(): { position: THREE.Vector3; yaw: number; pitch: number } | null {
		const parts = location.hash.slice(1).split('/').map(Number);
		if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
		const [c, tx, ty, alt = 150, yaw = 0, pitch = -17] = parts;
		const continent = this.continents[c];
		if (!continent) return null;
		const x = (tx + continent.offsetX) * TILE_SIZE;
		const z = (ty + continent.offsetY) * TILE_SIZE;
		const ground = Math.max(0, this.terrain.heightAt(x, z));
		return { position: new THREE.Vector3(x, ground + alt, z), yaw: THREE.MathUtils.degToRad(yaw), pitch: THREE.MathUtils.degToRad(pitch) };
	}

	private lastHash = '';
	private pendingHash = '';
	private pendingHashSince = 0;

	private currentHash(): string | null {
		const pos = this.camera.position;
		const at = this.terrain.locate(pos.x, pos.z);
		if (!at) return null;
		const c = this.continents.indexOf(at.continent);
		const deg = (r: number) => THREE.MathUtils.radToDeg(r).toFixed(0);
		const yaw = ((this.controls.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
		return `#${c}/${(pos.x / TILE_SIZE - at.continent.offsetX).toFixed(3)}/${(pos.z / TILE_SIZE - at.continent.offsetY).toFixed(3)}/${this.controls.altitude.toFixed(0)}/${deg(yaw)}/${deg(this.controls.pitch)}`;
	}

	/**
	 * Updates the URL once the view has been still for a second. history.replaceState is slow
	 * in Chromium (tens to hundreds of ms per call), so it must never run while flying.
	 */
	private writeHash(now: number, force = false): void {
		const hash = this.currentHash();
		if (!hash || hash === this.lastHash) return;
		if (hash !== this.pendingHash) {
			this.pendingHash = hash;
			this.pendingHashSince = now;
			if (!force) return;
		}
		if (!force && now - this.pendingHashSince < 1000) return;
		this.lastHash = hash;
		history.replaceState(null, '', hash);
	}

	/** Sea-level plane reaching well past the horizon, so no edge shows even from the overview. */
	private addOcean(): void {
		const center = this.terrain.bounds().getCenter(new THREE.Vector2());
		const ocean = new THREE.Mesh(
			new THREE.PlaneGeometry(600000, 600000),
			liquidMaterials.ocean,
		);
		ocean.rotation.x = -Math.PI / 2;
		ocean.position.set(center.x, 0, center.y);
		this.scene.add(ocean);
	}

	/** Above Northshire Abbey, looking north. */
	goToStart(): void {
		this.controls.set(this.startPosition(), 0, -0.3);
	}

	/** Straight down over the whole world. */
	overview(): void {
		const bounds = this.terrain.bounds();
		const size = bounds.getSize(new THREE.Vector2());
		const center = bounds.getCenter(new THREE.Vector2());
		const fov = THREE.MathUtils.degToRad(this.camera.fov);
		const fitHeight = size.y / 2 / Math.tan(fov / 2);
		const fitWidth = size.x / 2 / Math.tan(fov / 2) / this.camera.aspect;
		this.controls.flyTo(new THREE.Vector3(center.x, Math.max(fitHeight, fitWidth) * 1.05, center.y), 0, -Math.PI / 2 + 0.001, 2.5);
	}

	/** An angled view over one continent. */
	goToContinent(index: number): void {
		const c = this.continents[index];
		if (!c) return;
		const { center, extent } = this.terrain.focus(c);
		// Back off to the south and look north at about 50 degrees down.
		const pitch = -0.9;
		const distance = extent * 0.75;
		const target = new THREE.Vector3(center.x, 0, center.y);
		const position = target.clone().add(new THREE.Vector3(0, -Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance));
		this.controls.flyTo(position, 0, pitch, 2.5);
	}

	private onKey(e: KeyboardEvent): void {
		if (e.target instanceof HTMLInputElement || !this.terrain) return;
		if (e.code === 'KeyO') this.overview();
		else if (e.code === 'KeyR') this.controls.flyTo(this.startPosition(), 0, -0.3, 2.5);
		else if (e.code.startsWith('Digit')) this.goToContinent(Number(e.code.slice(5)) - 1);
		// Letters rather than [ ] \, which need AltGr on many layouts. Holding T keeps going.
		else if (e.code === 'KeyT') this.timeOffset += e.shiftKey ? -TIME_STEP : TIME_STEP;
		else if (e.code === 'KeyN') this.timeOffset = 0;
		else if (e.code === 'KeyL') this.setTorch(!this.torchOn);
		else if (e.code === 'KeyF') this.side = this.side === 'alliance' ? 'horde' : 'alliance';
		else if (e.code === 'KeyM' && this.music) this.music.enabled = !this.music.enabled;
	}

	private startPosition(): THREE.Vector3 {
		const ek = this.continents[0];
		const x = (32.5 + ek.offsetX) * TILE_SIZE;
		const z = (48.95 + ek.offsetY) * TILE_SIZE;
		return new THREE.Vector3(x, this.terrain.heightAt(x, z) + 140, z);
	}

	private plates: Plate[] = [];
	private lastPlateScan = 0;

	/** Rescans nearby NPCs a few times a second; re-projects their names every frame. */
	private updateNameplates(now: number): void {
		if (!this.nameplates) return;
		if (now - this.lastPlateScan > 150) {
			this.lastPlateScan = now;
			this.objects.nameplates(this.camera.position, NAMEPLATE_RANGE, this.plates);
			// Like the game, only name NPCs you could actually see. Underground (caves, mines) the
			// terrain surface is overhead, so only buildings count.
			const cam = this.camera.position;
			const underground = cam.y < this.terrain.surfaceAt(cam.x, cam.z) - 0.5;
			for (const p of this.plates) {
				p.visible = (underground || !this.terrainBlocks(this.camera.position, p.position)) && !this.objects.blocksSight(this.camera.position, p.position);
			}
		}
		// Distances change as the camera moves, even when the list doesn't.
		for (const p of this.plates) p.distance = p.position.distanceTo(this.camera.position);
		this.nameplates.update(this.plates, this.camera, this.canvas.clientWidth, this.canvas.clientHeight, this.side, NAMEPLATE_RANGE);
	}

	/** Whether the ground rises above the straight line between two points (sampled every 1.5 yd). */
	private terrainBlocks(from: THREE.Vector3, to: THREE.Vector3): boolean {
		const steps = Math.ceil(from.distanceTo(to) / 1.5);
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			const x = from.x + (to.x - from.x) * t;
			const y = from.y + (to.y - from.y) * t;
			const z = from.z + (to.z - from.z) * t;
			if (y < this.terrain.heightAt(x, z) - 0.2) return true;
		}
		return false;
	}

	private resize(): void {
		const w = this.canvas.clientWidth || window.innerWidth;
		const h = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	start(): void {
		let last = performance.now();
		const frame = (now: number) => {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			this.tick(dt, now);
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	}

	private tick(dt: number, now: number): void {
		this.controls.update(dt, (x, z) => this.terrain.heightAt(x, z), (x, z) => this.terrain.surfaceAt(x, z));
		liquidTime.value = now / 1000;
		const pos = this.camera.position;

		if (now - this.lastLightUpdate > 100) {
			this.lastLightUpdate = now;
			this.updateLighting();
		}
		this.sky.mesh.position.copy(pos);
		// A few out-of-phase sines give the flame's flicker.
		const s = now / 1000;
		this.torch.intensity = TORCH_INTENSITY * (1 + 0.06 * Math.sin(s * 11.3) + 0.04 * Math.sin(s * 23.7 + 1.3) + 0.03 * Math.sin(s * 5.1 + 0.4));

		if (now - this.lastLodUpdate > 200) {
			this.lastLodUpdate = now;
			perf.time('lod.update', () => this.terrain.update(pos));
		}
		perf.time('objects.update', () => this.objects.update(now, pos));
		perf.time('render', () => this.renderer.render(this.scene, this.camera));
		perf.time('nameplates', () => this.updateNameplates(now));
		if (this.music) {
			if (now - this.lastMusicCheck > 250) {
				this.lastMusicCheck = now;
				this.musicTarget = this.musicHere();
			}
			this.music.update(dt, now, this.musicTarget, sunDirection(this.timeOfDay()).y < 0);
		}
		perf.record('drawCalls', this.renderer.info.render.calls);
		perf.record('triangles', this.renderer.info.render.triangles);

		this.frames++;
		if (now - this.lastFpsTime > 500) {
			this.fps = (this.frames * 1000) / (now - this.lastFpsTime);
			this.frames = 0;
			this.lastFpsTime = now;
			this.onHud(this.hudInfo());
			this.writeHash(now);
		}
	}

	/** Game time in half-minutes: the local clock, shifted with [ and ]. */
	private timeOfDay(): number {
		const d = new Date();
		const t = (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) * 2 + this.timeOffset;
		return ((Math.round(t) % DAY) + DAY) % DAY;
	}

	/** Position in WoW world coordinates (x north, y west) and the continent's map ID. */
	private wowPosition(): { mapId: number; x: number; y: number } | null {
		const pos = this.camera.position;
		const at = this.terrain.locate(pos.x, pos.z);
		if (!at) return null;
		return {
			mapId: at.continent.mapId,
			x: MAP_ORIGIN - (pos.z / TILE_SIZE - at.continent.offsetY) * TILE_SIZE,
			y: MAP_ORIGIN - (pos.x / TILE_SIZE - at.continent.offsetX) * TILE_SIZE,
		};
	}

	/** Sun, ambient, sky and fog from the game's light zones for the current place and time. */
	private updateLighting(): void {
		const t = this.timeOfDay();
		const sunDir = sunDirection(t);
		const where = this.wowPosition();
		const state = this.lighting && where ? this.lighting.sample(where.mapId, where.x, where.y, t) : null;
		const alt = this.controls.altitude;
		let fogNear = 1200;
		let fogFar = 9000;
		if (state) {
			const c = state.colors;
			// Lit by the sun by day and by the (opposite) moon at night; the colours already say how bright.
			const lightDir = sunDir.y > 0.08 ? sunDir : new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.35, sunDir.z).normalize();
			this.sun.position.copy(lightDir);
			this.sun.color.copy(c.direct);
			this.ambient.color.copy(c.ambient);
			this.ambient.groundColor.copy(c.ambient).multiplyScalar(0.8);
			this.sky.update(state, sunDir, this.camera.position);
			this.fog.color.copy(c.skyFog);
			(this.scene.background as THREE.Color).copy(c.skyFog);
			if (state.fogEnd > 0) {
				fogFar = state.fogEnd;
				fogNear = state.fogEnd * THREE.MathUtils.clamp(state.fogScaler, 0, 0.9);
			}
		}
		// Clear from high up so the overview shows everything.
		this.fog.near = Math.max(fogNear, 1200 + alt * 2);
		this.fog.far = Math.max(fogFar, 9000 + alt * 14);
	}

	/**
	 * The indoor room around the camera (inns, Ironforge, Undercity), from WMOAreaTable. Rows are
	 * fetched from the worker on first entry; until then the previous answer stands.
	 */
	private updateRoom(): void {
		const at = this.objects.roomAt(this.camera.position);
		if (!at) {
			this.room = null;
			return;
		}
		const key = `${at.wmoId}:${at.nameSet}:${at.groupId}`;
		const known = this.rooms.get(key);
		if (known === 'pending') return;
		if (known !== undefined) {
			this.room = known;
			return;
		}
		this.rooms.set(key, 'pending');
		this.storage.wmoArea(at.wmoId, at.nameSet, at.groupId).then(
			(row) => this.rooms.set(key, row),
			() => this.rooms.set(key, null),
		);
	}

	/** The AreaTable ID for the camera: the room's area indoors, else the terrain's. */
	private areaHere(): number | null {
		const pos = this.camera.position;
		return this.room?.area || this.terrain.areaAt(pos.x, pos.z);
	}

	/** The music for where the camera is: the room's, else the area's or its parent zone's. */
	private musicHere(): MusicTarget {
		this.updateRoom();
		const music = this.music!.data;
		let id = this.areaHere();
		const intro = this.room?.intro || (id ? music.areas[id]?.intro ?? 0 : 0);
		let set = this.room?.music ?? 0;
		for (let i = 0; i < 8 && !set && id; i++) {
			set = music.areas[id]?.music ?? 0;
			id = this.areas.get(id)?.parent ?? 0;
		}
		return { set, intro };
	}

	/** Zone and subzone names for the AreaTable ID under the camera; indoors, the room's name. */
	private zoneNames(): { zone: string | null; subzone: string | null } {
		const id = this.areaHere();
		let area = id ? this.areas.get(id) : undefined;
		if (!area) return { zone: null, subzone: null };
		const subzone = this.room?.name ?? area.name;
		for (let i = 0; i < 8 && area.parent && this.areas.has(area.parent); i++) area = this.areas.get(area.parent)!;
		return { zone: area.name, subzone: subzone !== area.name ? subzone : null };
	}

	private hudInfo(): HudInfo {
		const pos = this.camera.position;
		const at = this.terrain.locate(pos.x, pos.z);
		const stats = this.terrain.stats();
		const [texLoaded, texTotal] = this.terrain.farTextureProgress;
		let location = 'Open sea';
		let coordinates = '–';
		if (at) {
			// Local tile coordinates -> WoW world coordinates (x north, y west).
			const lx = pos.x / TILE_SIZE - at.continent.offsetX;
			const ly = pos.z / TILE_SIZE - at.continent.offsetY;
			const wowX = MAP_ORIGIN - ly * TILE_SIZE;
			const wowY = MAP_ORIGIN - lx * TILE_SIZE;
			location = `${at.continent.name} · tile ${at.tileX}_${at.tileY}`;

			coordinates = `${wowX.toFixed(0)}, ${wowY.toFixed(0)}, ${pos.y.toFixed(0)}`;
		}
		return {
			location,
			coordinates,
			altitude: this.controls.altitude,
			height: pos.y,
			speed: this.controls.speed,
			fps: this.fps,
			near: `${stats.nearTiles} detailed${stats.nearLoading ? `, ${stats.nearLoading} loading` : ''} · ${stats.layerTextures} layer textures`,
			objects: (() => { const o = this.objects.stats(); return `${o.drawn.toLocaleString()} of ${o.instances.toLocaleString()} drawn · ${o.models} models${o.loading ? `, ${o.loading} loading` : ''}`; })(),
			textures: texLoaded < texTotal ? `${texLoaded} / ${texTotal}` : `${texTotal}`,
			time: (() => { const t = this.timeOfDay(); return `${String(Math.floor(t / 120)).padStart(2, '0')}:${String(Math.floor(t / 2) % 60).padStart(2, '0')}`; })(),
			...this.zoneNames(),
			side: this.side === 'alliance' ? 'Alliance' : 'Horde',
			music: this.music?.status ?? 'unavailable',
		};
	}
}

/** Places Kalimdor west of the Eastern Kingdoms, vertically centred, with open sea between. */
function layoutContinents(loaded: { map: (typeof KNOWN_MAPS)[number]; tiles: FarTile[] }[]): ContinentPlacement[] {
	const extent = (tiles: FarTile[]) => {
		const land = tiles.filter((t) => t.hasAdt);
		const xs = land.map((t) => t.x);
		const ys = land.map((t) => t.y);
		return { minX: Math.min(...xs), maxX: Math.max(...xs), midY: (Math.min(...ys) + Math.max(...ys)) / 2 };
	};
	const placements: ContinentPlacement[] = [];
	let anchor: ReturnType<typeof extent> | null = null;
	for (const { map, tiles } of loaded) {
		const e = extent(tiles);
		if (!anchor) {
			placements.push({ name: map.name, mapId: map.mapId, wdt: map.wdt, offsetX: 0, offsetY: 0 });
			anchor = e;
			continue;
		}
		// WDL tiles extend past the land; keep the whole WDL grid clear of the previous continent.
		const wdlMaxX = Math.max(...tiles.map((t) => t.x));
		const anchorWdlMin = Math.min(...loaded[0].tiles.map((t) => t.x));
		const offsetX = Math.min(anchor.minX - CONTINENT_GAP - e.maxX - 1, anchorWdlMin - wdlMaxX - 1);
		placements.push({ name: map.name, mapId: map.mapId, wdt: map.wdt, offsetX, offsetY: Math.round(anchor.midY - e.midY) });
	}
	return placements;
}
