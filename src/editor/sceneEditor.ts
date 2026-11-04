import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { CHUNK_SIZE, CHUNKS_PER_TILE, TILE_CELLS, TILE_SIZE } from '../formats/adt';
import { ALPHA_ATLAS_SIZE, buildSplatTerrain, type ChunkVertexLayout, type SplatGeometry } from '../explorer/splatMesh';
import { sameWater, type SceneModel, type SceneTile } from '../scene/sceneModel';
import type { AsyncStorageApi } from '../worker/protocol';
import { FlyControls } from '../viewer/flyControls';
import { WalkControls } from '../viewer/walkControls';
import { Character } from '../viewer/character';
import type { ChunkLayer, NpcAppearance, PlacedNpc, Scene } from '../scene/types';
import { Nameplates, NAMEPLATE_RANGE, type Plate } from './nameplates';
import { createAlphaTexture, createSplatMaterial, seaMask } from '../viewer/terrainMaterials';
import { TextureCache } from '../viewer/textureCache';
import { createTexture, supportsClipControl, supportsCompressedTextures } from '../viewer/textures';
import { DAY, Lighting, Sky, sunDirection } from '../viewer/lighting';
import { PostPass, type FogSettings } from '../viewer/post';
import { installShadowGroups, setShadowLight, shadowStandIns, useShadows } from '../viewer/shadows';
import { TerrainShadowPass } from '../viewer/terrainShadow';
import { SNOWFLAKE_TEXTURE, Weather } from '../viewer/weather';
import { CommandStack } from './commands';
import { HoleStroke, WaterStroke, type HoleSettings, type WaterSettings } from './cells';
import { PaintStroke, type PaintSettings } from './paint';
import { SculptStroke, type BrushSettings } from './sculpt';
import { SceneObjects } from './objects';
import { RevertStroke, type RevertSettings } from './revert';
import { ALPHA_SIZE } from '../formats/adtTex';
import { liquidKind, type LiquidInstance, type LiquidKind } from '../formats/mh2o';
import { buildLiquidMeshes } from '../explorer/liquidMesh';
import { liquidMaterial, liquidTime, releaseLiquidMaterial, setLiquidLooks } from '../viewer/terrainMaterials';
import { GroundDistancePass } from '../viewer/groundDistance';
import { ClutterManager } from '../viewer/clutter';
import type { ClutterEffect, ClutterSource } from '../explorer/groundEffects';

const SKY = new THREE.Color(0x9ec4e4);
/** The plain daylight scenes had before the light tables: used until they're read, and when they can't be. */
const PLAIN_SUN = new THREE.Color(0xfff2dd);
const PLAIN_AMBIENT = new THREE.Color(0x8899aa);
/** Camera distance limits for small scenes. */
const NEAR = 0.5;
const FAR = 40000;
/** Below this height of the sun the moon lights the scene instead (as the explorer). */
const SUN_TO_MOON = 0.08;
/** Yards the sun's shadows reach from the camera on the ground, and how much further per yard of altitude (as the explorer). */
const SHADOW_RANGE = 300;
const SHADOW_RANGE_PER_ALTITUDE = 2;
const SHADOW_RANGE_MAX = 1200;
/** How much of the sun shade takes away: some stays, as light from the sky and the ground would fill it in. */
const SHADOW_INTENSITY = 0.8;
/** Where the shadows setting is kept: a view setting across scenes, never part of a scene. */
const SHADOWS_KEY = 'wdb.shadows';
/** Height fog: thickness per yard at the lowest ground around (times the preset's), and how fast it thins with height. */
const FOG_DENSITY = 0.0008;
const FOG_FALLOFF = 1 / 40;
/** How strongly the sun lights the fog. */
const FOG_SUNLIGHT = 2;
/** The fog lies at the lowest ground within this many yards of the camera, sampled on a grid this many to a side. */
const FOG_BASE_REACH = 600;
const FOG_BASE_SAMPLES = 9;
/** Distance fog when the preset sets none. */
const FOG_NEAR_DEFAULT = 1200;
const FOG_FAR_DEFAULT = 9000;
/** Thumbnails for the scene library (and later galleries), spec 6.2. */
const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 288;
/** Pixels a plain left press may move and still count as a click (the Paint tool's chunk sample). */
const CLICK_THRESHOLD = 4;
/** How far the cursor ray is marched looking for ground (yards). */
const CURSOR_REACH = 6000;
/** Outer lattice spacing in yards. */
const CELL = CHUNK_SIZE / 8;
/** Leaving play mode, the editor camera goes to the player's eyes: this share of its height above the feet. */
const PLAYER_EYE = 0.9;
/** How far above a point to look for a building's liquid surface (yards). */
const LIQUID_PROBE = 200;
/** The avatar when scene.player is null (spec 7.10): a human male (ChrRaces 1), in its first NPC look. */
const DEFAULT_PLAYER = { race: 1, sex: 0 };
/** Scenes with more tiles than a 3x3 stream their terrain meshes around the camera (Phase 4). */
const STREAM_ABOVE_TILES = 9;
/** Tiles closer than this (yards, from the camera to the tile's square) are built... */
const STREAM_IN = 1.25 * TILE_SIZE;
/** ...and those farther than this are dropped, so a tile at the edge doesn't flicker. */
const STREAM_OUT = 1.75 * TILE_SIZE;
/** How often the wanted set is recomputed (ms), and how many tiles may build at once. */
const STREAM_INTERVAL = 250;
const STREAM_BUILDS = 2;

interface TileMesh {
	group: THREE.Group;
	geometry: THREE.BufferGeometry;
	materials: THREE.Material[];
	alpha: THREE.DataTexture;
	textures: number[];
	/** Shared-lattice heights and normals, kept for in-place height updates. */
	outer: Float32Array;
	inner: Float32Array;
	latticeNormals: Float32Array;
	skirtDepth: number;
	/** Chunk vertex ranges by chunk index. */
	layout: ChunkVertexLayout[];
	/** The tile's water surfaces (spec 7.6), rebuilt whole when its water changes. */
	water: THREE.Mesh[];
}

/** The tools on the rail (spec 8). */
/** The editor's tools: the bottom controls' modes (Environment has no brush; Objects is `place`) plus Revert to base for copied scenes. */
export type Tool = 'environment' | 'sculpt' | 'paint' | 'holes' | 'water' | 'place' | 'npcs' | 'revert';

/** A terrain chunk the user clicked, for the paint panel's chunk sampling (spec 7.5). */
export interface PickedChunk {
	tileIndex: number;
	chunkId: number;
	/** The chunk's layers; layer 0 is the base. */
	layers: ChunkLayer[];
}

/** What the status bar shows each frame. */
export interface EditorStatus {
	cursor: { x: number; z: number; height: number } | null;
	/** Texture layers of the chunk under the cursor. */
	layers: number | null;
	fps: number;
}

function toBufferGeometry(g: SplatGeometry): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
	geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
	geometry.setAttribute('chunkIndex', new THREE.BufferAttribute(g.chunks, 1));
	geometry.setAttribute('skirt', new THREE.BufferAttribute(g.skirt, 1));
	geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();
	return geometry;
}

/** A ring of line segments, laid on the terrain as the brush cursor. */
function makeRing(segments: number): THREE.LineLoop {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3));
	const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
	const ring = new THREE.LineLoop(geometry, material);
	ring.renderOrder = 999;
	ring.frustumCulled = false;
	ring.visible = false;
	return ring;
}

/**
 * The editor viewport (spec 4): renders a SceneModel's tiles with the explorer's splat terrain,
 * rebuilding only what changed: heights update meshes in place, alpha updates the atlas texture,
 * and only structural changes (layers, holes, water) rebuild a tile. The left mouse button uses
 * the active tool, the right looks around, and the top bar's Play button walks the scene (spec 7.10).
 */
export class SceneEditor {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	/** The tile meshes alone, for the water depth pre-pass. */
	private readonly terrain = new THREE.Group();
	/** Water reads the ground's distance per pixel for its depth colours (see GroundDistancePass). */
	private readonly groundPass: GroundDistancePass;
	/** Whether any chunk has water, so the pre-pass only runs when it earns its cost. */
	private hasWater = false;
	private readonly camera: THREE.PerspectiveCamera;
	private readonly controls: FlyControls;
	private readonly walker: WalkControls;
	/** The player avatar (spec 7.10), drawn while playing. */
	private readonly character: Character;
	/** What the avatar was last dressed as, so a replay with the same choice doesn't reload it. */
	private playerKey = '';
	/** Called when scene.player changes (a command, undo or redo), for the NPCs tab. */
	onPlayerChange: () => void = () => {};
	/** NPC names over their heads while playing (spec 7.10). */
	private readonly nameplates = new Nameplates();
	/** The targeted NPC's id (spec 7.10), its selection circle, and whether a left press began on the view while playing. */
	private target: string | null = null;
	private readonly targetRing: THREE.Mesh;
	private pressedPlaying = false;
	private readonly textures: TextureCache;
	private readonly tileMeshes = new Map<number, TileMesh>();
	private readonly clock = new THREE.Clock();
	private frame = 0;
	private disposed = false;
	/** The scene's light (spec 6.1): the preset's sun, sky and fog at its time of day, drawn through the explorer's post pass. */
	private readonly post: PostPass;
	private readonly sun = new SunLight(PLAIN_SUN, Math.PI);
	/**
	 * The sun's shadows, as the explorer draws them: two cascades fitted to the view, redrawn
	 * every other frame, and mountains' shadows past their reach. Off stops drawing the maps and
	 * fades the shadows out, but the sun still casts them as far as three is concerned: whether a
	 * light casts shadows is part of every shader, and changing it would build them all again.
	 */
	private readonly terrainShadow: TerrainShadowPass;
	private shadowsOn = readShadowsSetting();
	/** 0-1: shadows fade out as the light passes from the sun to the moon at dusk and back at dawn. */
	private shadowStrength = 1;
	private shadowFrame = 0;
	/** Whether the shadow maps have been drawn yet: drawn once even with shadows off, since the shaders read them. */
	private shadowMapsDrawn = false;
	/** Height of the camera over the ground, which the shadows' reach grows with. */
	private altitude = 0;
	private readonly ambient = new THREE.HemisphereLight(PLAIN_AMBIENT, PLAIN_AMBIENT, Math.PI);
	private readonly sky = new Sky();
	private readonly fog = new THREE.Fog(SKY, FOG_NEAR_DEFAULT, FOG_FAR_DEFAULT);
	private lighting: Lighting | null = null;
	private readonly fogLook: FogSettings = {
		color: new THREE.Color(),
		sunColor: new THREE.Color(),
		sunDir: new THREE.Vector3(0, 1, 0),
		density: FOG_DENSITY,
		falloff: FOG_FALLOFF,
		base: 0,
		sunlight: FOG_SUNLIGHT,
	};
	/** World height the fog is thickest at, eased towards the lowest ground around. */
	private fogBase: number | null = null;
	/** Whether the camera is under the scene's water, where the sky and fog don't show. */
	private underwater = false;
	/** Rain, snow or a sandstorm round the camera (spec 6.1), outdoors and above water. */
	private readonly weather = new Weather();
	private lastRoomCheck = 0;
	private indoors = false;
	/** Called when the environment changes (a command, undo or redo), for the panel. */
	onEnvironmentChange: () => void = () => {};
	/** Something the user should know, shown by the editor bar. */
	onNotice: (text: string) => void = () => {};
	/** Status bar data, sent every frame. */
	onStatus: (status: EditorStatus) => void = () => {};
	/**
	 * When set, a plain left click (no modifier, no drag) with a brush tool reports the chunk under
	 * the cursor instead of doing nothing; null when the click missed the ground.
	 */
	onChunkClick: ((chunk: PickedChunk | null) => void) | null = null;

	/** The editor core (spec 7.11): every change goes through a command. */
	readonly commands = new CommandStack();
	/** Which tool the left mouse button drives. */
	private activeTool: Tool = 'sculpt';
	/** The placed doodads, buildings and NPCs (spec 7.8, 7.9). */
	readonly objects: SceneObjects;
	/** Whether the NPC load summary (spec 7.11) has been shown for this scene. */
	private npcsReported = false;
	private lastNpcCheck = 0;

	get tool(): Tool {
		return this.activeTool;
	}

	set tool(tool: Tool) {
		this.activeTool = tool;
		this.objects?.setActive(tool === 'place' || tool === 'npcs');
	}

	/** The tools whose clicks go to the placed objects and NPCs rather than a brush. */
	private get objectTool(): boolean {
		return this.tool === 'place' || this.tool === 'npcs';
	}
	/** The hole brush (spec 7.6), edited by the properties panel. */
	readonly holes: HoleSettings = { radius: 4, mode: 'cut' };
	/** The water brush (spec 7.6), edited by the properties panel. */
	readonly water: WaterSettings = { radius: 8, mode: 'add', kind: 1, height: null };
	/** The Revert to base brush (spec 7.11, copied scenes), edited by the properties panel. */
	readonly revert: RevertSettings = { radius: 15, channels: { heights: true, vertexShade: true, paint: true, holes: true, water: true } };
	/** The sculpt brush, edited by the properties panel. */
	readonly brush: BrushSettings = { radius: 15, strength: 0.5, falloff: 'smooth', mode: 'raise', flattenTo: null };
	/** The paint brush (spec 7.5), edited by the properties panel. */
	readonly paint: PaintSettings;
	/** The ground effect a texture usually carries, wired to the scan table (spec 7.7.2). */
	effectFor: (fdid: number) => number = () => 0;
	/** Ground clutter (spec 7.7): on/off and a density multiplier, edited by the panel. */
	readonly clutterSettings = { enabled: true, density: 1 };
	private readonly clutter: ClutterManager;
	/** What each effect scatters, fetched from the worker once and kept. */
	private readonly effectCache = new Map<number, ClutterEffect | null>();
	private fetchingEffects = false;
	/** Tiles whose clutter cells need recomputing (heights, paint, holes or water changed). */
	private readonly clutterDirty = new Set<number>();

	/** Where the mouse last was, in normalized device coordinates. */
	private readonly mouse = new THREE.Vector2(NaN, NaN);
	private readonly raycaster = new THREE.Raycaster();
	/** The ground under the mouse this frame. */
	private cursor: { x: number; z: number; height: number } | null = null;
	private stroke: SculptStroke | PaintStroke | HoleStroke | WaterStroke | RevertStroke | null = null;
	/** Build number per tile, so a stale structural rebuild never replaces a newer one. */
	private readonly buildSerial = new Map<number, number>();
	/** Chunks flashed red because they could not take another texture (spec 7.5). */
	private readonly flags: { ring: THREE.LineLoop; until: number }[] = [];
	/** Tiles the open stroke touched, for refreshing bounds when it ends. */
	private readonly strokeTiles = new Set<number>();
	/** The ramp's first clicked point, waiting for the second. */
	private rampStart: { x: number; z: number; h: number } | null = null;
	/** A plain left press with a terrain tool: a chunk click if let go where it went down. */
	private press: { x: number; y: number } | null = null;
	private readonly ring = makeRing(64);
	private readonly rampRing = makeRing(32);
	/** Frames since the FPS readout last updated. */
	private fpsFrames = 0;
	private fpsTime = 0;
	private fps = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly storage: AsyncStorageApi,
		readonly model: SceneModel,
	) {
		this.paint = { fdid: model.textures[0], radius: 15, strength: 0.7, opacity: 1, mode: 'paint', policy: 'replace', swapFrom: 0, swapTo: 0 };
		// Depth as the explorer draws it, which the post pass's fog reads back: a reversed float
		// depth buffer where the GPU has it, else a logarithmic one. Antialiased in the pass's target.
		const reversed = supportsClipControl();
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, reversedDepthBuffer: reversed, logarithmicDepthBuffer: !reversed });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.post = new PostPass(this.renderer, storage);
		this.terrainShadow = new TerrainShadowPass(this.renderer);
		this.textures = new TextureCache(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy());
		this.camera = new THREE.PerspectiveCamera(60, 1, NEAR, FAR);
		this.controls = new FlyControls(this.camera, canvas);
		this.walker = new WalkControls(this.camera, canvas);
		this.controls.onTakeOver = () => this.setPlaying(false);
		// Editing views from a fixed distance: the wheel doesn't zoom.
		this.controls.zoomable = false;
		this.walker.world = {
			terrain: (x, z) => this.model.heightAt(x, z) ?? -Infinity,
			surface: (x, z) => this.model.surfaceAt(x, z) ?? -Infinity,
			ready: () => true,
			// Placed buildings and solid doodads block and carry the walker (Phase 3), and NPCs'
			// capsules block it (spec 7.9.1); the manager is read through `this.objects`, which the
			// constructor makes a few lines below.
			nearBuilding: (at, margin) => this.objects.manager.nearBuilding(at, margin) || this.objects.npcs.near(at, margin),
			cast: (from, direction, far) => this.objects.manager.castBuildings(from, direction, far),
			sweep: (from, move, radius) => this.objects.npcs.sweep(from, this.objects.manager.sweep(from, move, radius, true), radius),
			pushOut: (at, radius) => this.objects.manager.pushOut(at, radius, true).add(this.objects.npcs.pushOut(at, radius)),
			liquid: (at) => this.liquidOver(at),
		};

		this.scene.background = SKY.clone();
		this.scene.fog = this.fog;
		// The scene's lighting (spec 6.1): its light preset's colours at its time of day, once the
		// light tables are read (see updateLighting); plain daylight until then.
		this.sun.position.set(-0.6, 1, 0.45);
		// Two cascades fitted to the view out to the shadow range, softened by filtering, redrawn
		// every other frame (see render): each map is used with its own matrices, so a map a frame
		// old still lines up; only moving things' shadows lag a frame.
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.shadowMap.autoUpdate = false;
		installShadowGroups(this.scene);
		setShadowLight(this.sun);
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		this.sun.shadow.camera.near = 1;
		this.sun.shadow.camera.far = SHADOW_RANGE;
		// Towards the light: down a normal depth buffer, up a reversed one (three's filtered shadows don't flip it themselves).
		this.sun.shadow.bias = this.renderer.capabilities.reversedDepthBuffer ? 0.0003 : -0.0003;
		this.sun.shadow.normalBias = 0.15;
		this.sun.shadow.radius = 2;
		this.setShadows(this.shadowsOn);
		this.sky.mesh.visible = false;
		this.scene.add(this.sun, this.ambient, this.sky.mesh, this.weather.group, this.terrain, this.ring, this.rampRing);
		this.groundPass = new GroundDistancePass(this.renderer);
		this.clutter = new ClutterManager(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy(), this.prepare);
		this.scene.add(this.clutter.group);
		this.objects = new SceneObjects(
			this.scene,
			this.camera,
			canvas,
			model,
			this.commands,
			storage,
			supportsCompressedTextures(this.renderer),
			this.renderer.capabilities.getMaxAnisotropy(),
			this.prepare,
			(x, z) => this.model.surfaceAt(x, z),
		);
		this.objects.onNotice = (text) => this.onNotice(text);
		this.character = new Character(storage, supportsCompressedTextures(this.renderer), this.renderer.capabilities.getMaxAnisotropy(), this.prepare);
		this.scene.add(this.character.group, this.nameplates.group);
		this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd100, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
		this.targetRing.rotation.x = -Math.PI / 2;
		this.targetRing.renderOrder = 5;
		this.targetRing.visible = false;
		this.scene.add(this.targetRing);
		this.objects.visibleAt = (x, z) => {
			if (!this.streaming) return true;
			const tx = Math.floor(x / TILE_SIZE);
			const ty = Math.floor(z / TILE_SIZE);
			// Objects off the scene's edge go with the nearest tile.
			const cx = Math.max(0, Math.min(this.model.tilesX - 1, tx));
			const cy = Math.max(0, Math.min(this.model.tilesY - 1, ty));
			return this.tileMeshes.has(cy * this.model.tilesX + cx);
		};
		// The explorer's sea mask tints terrain below sea level; a scene has no sea.
		seaMask.uSeaBounds.value.set(1e9, 1e9, 1, 1);

		// Right button held: look around. Left button: select, box-select or place with the Place
		// and NPCs tools; Shift / Cmd + left runs the terrain tools (Shift raises, Cmd lowers).
		canvas.addEventListener('mousedown', this.onMouseDown);
		canvas.addEventListener('mousemove', this.onMouseMove);
		canvas.addEventListener('mouseleave', this.onMouseLeave);
		canvas.addEventListener('contextmenu', this.onContextMenu);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('resize', this.onResize);
		this.onResize();

		// Start over the spawn point, looking north across the scene.
		const [sx, , sz] = model.meta.spawn.position;
		const span = Math.max(model.tilesX, model.tilesY) * TILE_SIZE;
		this.controls.set(new THREE.Vector3(sx, span * 0.35, sz + span * 0.4), 0, -0.6);
	}

	/**
	 * Builds an object's shaders ahead of its first draw, for the post pass's target they draw
	 * into, along with those the shadow pass will draw it with (see shadowStandIns), so a new
	 * kind of model doesn't stop the frame to compile them. shadowPass: the object's own
	 * materials are depth materials for the shadow maps.
	 */
	private readonly prepare = async (object: THREE.Object3D, shadowPass = false): Promise<void> => {
		if (shadowPass) {
			await this.post.compileAsync(this.renderer, object, this.camera, this.scene, true);
			return;
		}
		await Promise.all([
			this.post.compileAsync(this.renderer, object, this.camera, this.scene),
			...shadowStandIns(object).map((o) => this.post.compileAsync(this.renderer, o, this.camera, this.scene, true)),
		]);
	};

	/** Whether the sun casts shadows: a view setting kept across scenes, not part of the scene. */
	get shadows(): boolean {
		return this.shadowsOn;
	}

	set shadows(on: boolean) {
		this.setShadows(on);
		try {
			localStorage.setItem(SHADOWS_KEY, on ? '1' : '0');
		} catch {
			// No storage: the setting lasts the session.
		}
	}

	private setShadows(on: boolean): void {
		this.shadowsOn = on;
		// The sun shafts in the fog are traced through the shadow maps.
		this.post.setShadowLight(on ? this.sun : null);
		this.sun.shadow.intensity = on ? SHADOW_INTENSITY * this.shadowStrength : 0;
	}

	/** Loads the texture palette and builds every tile; the scene is in view when this resolves. */
	async load(): Promise<void> {
		// Water colours come from LiquidType.db2; the materials update when they arrive.
		void this.storage.loadLiquidLooks().then(setLiquidLooks).catch(() => {});
		void this.loadLighting();
		this.storage.loadTextures([SNOWFLAKE_TEXTURE], supportsCompressedTextures(this.renderer)).then(
			([flake]) => {
				if (flake?.texture && !this.disposed) this.weather.setSnowflake(createTexture(flake.texture, 1));
			},
			(e) => console.warn('Snowflake texture unavailable:', e),
		);
		// Large scenes build the tiles around the camera now and stream the rest as it moves.
		const first = this.streaming ? this.wantedTiles(STREAM_IN) : this.model.tiles.map((_, i) => i);
		await Promise.all([...first.map((index) => this.buildTile(this.model.tiles[index])), this.terrainShadow.warm(this.renderer)]);
		this.objects.load();
		this.render();
	}

	/** Buildings' liquid surfaces in view, gathered per query. */
	private readonly liquidMeshes: THREE.Object3D[] = [];
	private readonly liquidRay = new THREE.Raycaster();

	/**
	 * The liquid surface over a point, for swimming (spec 7.10): the scene's water there (edited
	 * or copied), or a placed building's pool or canal. Of a building's surfaces, the lowest one
	 * above the point, or the highest below it (so a jump out of the water still knows it).
	 */
	private liquidOver(at: THREE.Vector3): { surface: number; sea: boolean } | null {
		let surface = this.model.waterAt(at.x, at.z);
		const meshes = this.liquidMeshes;
		meshes.length = 0;
		this.objects.manager.liquidMeshes(meshes);
		if (meshes.length) {
			this.liquidRay.set(new THREE.Vector3(at.x, at.y + LIQUID_PROBE, at.z), new THREE.Vector3(0, -1, 0));
			this.liquidRay.far = LIQUID_PROBE * 2;
			let above: number | null = null;
			let below: number | null = null;
			for (const hit of this.liquidRay.intersectObjects(meshes, false)) {
				const y = hit.point.y;
				if (y >= at.y) above = above === null ? y : Math.min(above, y);
				else below = below === null ? y : Math.max(below, y);
			}
			const found = above ?? below;
			if (found !== null && (surface === null || (found >= at.y && (surface < at.y || found < surface)) || (found < at.y && surface < at.y && found > surface))) surface = found;
		}
		return surface === null ? null : { surface, sea: false };
	}

	/** Whether this scene streams its terrain meshes (more than 3x3 tiles). */
	get streaming(): boolean {
		return this.model.tilesX * this.model.tilesY > STREAM_ABOVE_TILES;
	}

	/** Tile meshes being built now, by streaming. */
	private readonly streamBuilding = new Set<number>();
	private lastStream = 0;

	/** Tile indices within reach of the camera (yards to the tile's square), nearest first. */
	private wantedTiles(reach: number): number[] {
		const { x, z } = this.camera.position;
		const out: { index: number; d: number }[] = [];
		this.model.tiles.forEach((tile, index) => {
			const nx = Math.max(tile.x * TILE_SIZE, Math.min(x, (tile.x + 1) * TILE_SIZE));
			const nz = Math.max(tile.y * TILE_SIZE, Math.min(z, (tile.y + 1) * TILE_SIZE));
			const d = Math.hypot(nx - x, nz - z);
			if (d <= reach) out.push({ index, d });
		});
		return out.sort((a, b) => a.d - b.d).map((t) => t.index);
	}

	/** Builds the nearest missing tiles and drops far ones (Phase 4 tile streaming). */
	private stream(now: number): void {
		if (!this.streaming || now - this.lastStream < STREAM_INTERVAL) return;
		this.lastStream = now;
		const keep = new Set(this.wantedTiles(STREAM_OUT));
		for (const index of [...this.tileMeshes.keys()]) {
			if (keep.has(index)) continue;
			// A newer build serial cancels any build of it still in flight.
			this.buildSerial.set(index, (this.buildSerial.get(index) ?? 0) + 1);
			this.dropTile(index);
		}
		for (const index of this.wantedTiles(STREAM_IN)) {
			if (this.streamBuilding.size >= STREAM_BUILDS) break;
			if (this.tileMeshes.has(index) || this.streamBuilding.has(index)) continue;
			this.streamBuilding.add(index);
			void this.buildTile(this.model.tiles[index]).finally(() => this.streamBuilding.delete(index));
		}
		this.objects.syncVisibility();
	}

	/** Whether a tile's mesh should exist: always for small scenes, near the camera when streaming. */
	private tileWanted(index: number): boolean {
		return !this.streaming || this.tileMeshes.has(index) || this.streamBuilding.has(index);
	}

	private async buildTile(tile: SceneTile): Promise<void> {
		const index = tile.y * this.model.tilesX + tile.x;
		const serial = (this.buildSerial.get(index) ?? 0) + 1;
		this.buildSerial.set(index, serial);
		const { root, tex } = this.model.tileRenderData(tile);
		const terrain = buildSplatTerrain(root, tex);
		const textures = await this.textures.acquire(terrain.textures);
		if (this.disposed || this.buildSerial.get(index) !== serial) {
			this.textures.release(terrain.textures);
			return;
		}
		this.dropTile(index);
		const alpha = createAlphaTexture(terrain.alpha, ALPHA_ATLAS_SIZE);
		const geometry = toBufferGeometry(terrain.geometry);
		const materials = terrain.groups.map((g, i) => {
			geometry.addGroup(g.start, g.count, i);
			return createSplatMaterial(alpha, g.layers, textures);
		});
		const mesh = new THREE.Mesh(geometry, materials);
		mesh.matrixAutoUpdate = false;
		useShadows(mesh);
		const group = new THREE.Group();
		group.add(mesh);
		group.position.set(tile.x * TILE_SIZE, 0, tile.y * TILE_SIZE);
		this.terrain.add(group);
		group.updateMatrixWorld(true);
		const layout: ChunkVertexLayout[] = [];
		for (const l of terrain.layout) layout[l.id] = l;
		this.tileMeshes.set(index, {
			group,
			geometry,
			materials,
			alpha,
			textures: terrain.textures,
			outer: terrain.heights,
			inner: terrain.inner,
			latticeNormals: terrain.latticeNormals,
			skirtDepth: terrain.skirtDepth,
			layout,
			water: [],
		});
		this.buildTileWater(index);
	}

	/** Rebuilds a tile's water surfaces from its chunks' settings (spec 7.6). */
	private buildTileWater(index: number): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		for (const mesh of tm.water) {
			tm.group.remove(mesh);
			mesh.geometry.dispose();
			releaseLiquidMaterial(mesh.material as THREE.Material);
		}
		tm.water = [];
		const liquids: LiquidInstance[] = [];
		const baseTile = this.model.baseData?.tiles[index];
		this.model.tiles[index].chunks.forEach((chunk, id) => {
			// A copied chunk whose water still equals its base renders the source liquid as the
			// client does, non-flat surfaces and partial coverage included (spec 6.5).
			if (baseTile && sameWater(chunk.water, baseTile.chunks[id].water)) {
				if (chunk.water) {
					for (const liquid of baseTile.liquids) if (liquid.chunk === id) liquids.push(liquid);
				}
				return;
			}
			const water = chunk.water;
			if (!water) return;
			const exists = new Uint8Array(64);
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) exists[row * 8 + col] = water.coverage[row] & (1 << col) ? 1 : 0;
			}
			liquids.push({ chunk: id, type: water.kind, minHeight: water.height, maxHeight: water.height, x: 0, y: 0, width: 8, height: 8, exists, heights: null });
		});
		// Ocean would be skipped as the explorer's one sea plane; here it is just another surface.
		const kindOf = (type: number): LiquidKind => {
			const kind = liquidKind(type);
			return kind === 'ocean' ? 'water' : kind;
		};
		for (const built of buildLiquidMeshes(liquids, kindOf)) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
			const normals = new Float32Array(built.positions.length);
			for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
			geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
			geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
			geometry.computeBoundingSphere();
			const mesh = new THREE.Mesh(geometry, liquidMaterial(built.kind, built.type));
			mesh.renderOrder = 1;
			mesh.matrixAutoUpdate = false;
			useShadows(mesh, 'receive');
			tm.group.add(mesh);
			mesh.updateMatrixWorld(true);
			tm.water.push(mesh);
		}
		this.hasWater = [...this.tileMeshes.values()].some((t) => t.water.length > 0);
		this.clutterDirty.add(index);
	}

	private dropTile(index: number): void {
		const mesh = this.tileMeshes.get(index);
		if (!mesh) return;
		this.tileMeshes.delete(index);
		this.clutter.removeTile(String(index));
		this.terrain.remove(mesh.group);
		mesh.geometry.dispose();
		for (const m of mesh.materials) m.dispose();
		mesh.alpha.dispose();
		for (const w of mesh.water) {
			w.geometry.dispose();
			releaseLiquidMaterial(w.material as THREE.Material);
		}
		this.textures.release(mesh.textures);
	}

	/**
	 * Updates a tile's mesh in place after some chunks' heights changed: copies the heights into
	 * the shared lattice, recomputes normals around the change (dirty chunks plus a margin, spec
	 * 7.4) and writes the affected vertices back, so a brush stroke never rebuilds geometry.
	 */
	private updateTileHeights(index: number, chunkIds: Set<number>): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const tile = this.model.tiles[index];
		const n = TILE_CELLS;
		const w = n + 1;

		let cx0 = CHUNKS_PER_TILE;
		let cx1 = -1;
		let cy0 = CHUNKS_PER_TILE;
		let cy1 = -1;
		for (const id of chunkIds) {
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			cx0 = Math.min(cx0, cx);
			cx1 = Math.max(cx1, cx);
			cy0 = Math.min(cy0, cy);
			cy1 = Math.max(cy1, cy);
			const heights = tile.chunks[id].heights;
			for (let row = 0; row < 9; row++) {
				for (let col = 0; col < 9; col++) tm.outer[(cy * 8 + row) * w + cx * 8 + col] = heights[row * 17 + col];
			}
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) tm.inner[(cy * 8 + row) * n + cx * 8 + col] = heights[row * 17 + 9 + col];
			}
		}
		if (cx1 < 0) return;

		// Cells whose geometry changed, expanded a cell each way: their vertices' normals change.
		const sx0 = Math.max(0, cx0 * 8 - 1);
		const sx1 = Math.min(n - 1, cx1 * 8 + 8);
		const sz0 = Math.max(0, cy0 * 8 - 1);
		const sz1 = Math.min(n - 1, cy1 * 8 + 8);
		this.recomputeNormals(tm, sx0, sx1, sz0, sz1);

		// Write positions and normals back for every chunk overlapping the recomputed vertices.
		const positions = tm.geometry.getAttribute('position') as THREE.BufferAttribute;
		const normals = tm.geometry.getAttribute('normal') as THREE.BufferAttribute;
		const pos = positions.array as Float32Array;
		const nor = normals.array as Float32Array;
		const outerCount = w * w;
		for (let cy = Math.floor(sz0 / 8); cy <= Math.floor(sz1 / 8); cy++) {
			for (let cx = Math.floor(sx0 / 8); cx <= Math.floor(sx1 / 8); cx++) {
				const layout = tm.layout[cy * CHUNKS_PER_TILE + cx];
				if (!layout) continue;
				for (let row = 0; row < 9; row++) {
					for (let col = 0; col < 9; col++) {
						const v = layout.base + row * 9 + col;
						const g = (cy * 8 + row) * w + cx * 8 + col;
						pos[v * 3 + 1] = tm.outer[g];
						nor[v * 3] = tm.latticeNormals[g * 3];
						nor[v * 3 + 1] = tm.latticeNormals[g * 3 + 1];
						nor[v * 3 + 2] = tm.latticeNormals[g * 3 + 2];
					}
				}
				for (let row = 0; row < 8; row++) {
					for (let col = 0; col < 8; col++) {
						const v = layout.base + 81 + row * 8 + col;
						const g = (cy * 8 + row) * n + cx * 8 + col;
						pos[v * 3 + 1] = tm.inner[g];
						const o = (outerCount + g) * 3;
						nor[v * 3] = tm.latticeNormals[o];
						nor[v * 3 + 1] = tm.latticeNormals[o + 1];
						nor[v * 3 + 2] = tm.latticeNormals[o + 2];
					}
				}
				for (const s of layout.skirts) {
					const g = s.gz * w + s.gx;
					pos[s.vertex * 3 + 1] = tm.outer[g] - tm.skirtDepth;
					nor[s.vertex * 3] = tm.latticeNormals[g * 3];
					nor[s.vertex * 3 + 1] = tm.latticeNormals[g * 3 + 1];
					nor[s.vertex * 3 + 2] = tm.latticeNormals[g * 3 + 2];
				}
			}
		}
		positions.needsUpdate = true;
		normals.needsUpdate = true;
	}

	/**
	 * Recomputes a tile's clutter cells (spec 7.7.1): like the client, each terrain cell takes its
	 * clutter from the texture layer that covers most of it, skipping holes and cells under water.
	 * Effects the worker hasn't described yet are fetched once, and the tile revisited.
	 */
	private rebuildClutter(index: number): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const key = String(index);
		const tile = this.model.tiles[index];
		const originX = tile.x * TILE_SIZE;
		const originZ = tile.y * TILE_SIZE;
		if (!this.clutterSettings.enabled || this.clutterSettings.density <= 0) {
			this.clutter.addTile(key, originX, originZ, null);
			return;
		}
		// Which effects the tile needs; ask the worker about any not yet described.
		const missing = new Set<number>();
		for (const chunk of tile.chunks) {
			for (const layer of chunk.layers) {
				if (layer.effectId && !this.effectCache.has(layer.effectId)) missing.add(layer.effectId);
			}
		}
		if (missing.size) {
			this.clutterDirty.add(index);
			if (!this.fetchingEffects) {
				this.fetchingEffects = true;
				const ids = [...missing];
				this.storage.clutterEffects(ids)
					.then((effects) => ids.forEach((id, i) => this.effectCache.set(id, effects[i])))
					.catch(() => ids.forEach((id) => this.effectCache.set(id, null)))
					.finally(() => {
						this.fetchingEffects = false;
					});
			}
			return;
		}

		const n = TILE_CELLS;
		const texels = ALPHA_SIZE * ALPHA_SIZE;
		const cells = new Uint8Array(n * n);
		const effects: ClutterEffect[] = [];
		const indexOf = new Map<number, number>();
		tile.chunks.forEach((chunk, id) => {
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			for (let row = 0; row < 8; row++) {
				for (let col = 0; col < 8; col++) {
					if (chunk.holes[row] & (1 << col)) continue;
					const gx = cx * 8 + col;
					const gz = cy * 8 + row;
					// Nothing grows under water.
					if (chunk.water && chunk.water.coverage[row] & (1 << col) && chunk.water.height > tm.inner[gz * n + gx]) continue;
					// The layer covering most of the cell, by its alpha over the cell's texels.
					let dominant = 0;
					if (chunk.layers.length > 1 && chunk.alpha) {
						let others = 0;
						let best = -1;
						let bestSum = 0;
						for (let l = 1; l < chunk.layers.length; l++) {
							let sum = 0;
							for (let ty = row * 8; ty < row * 8 + 8; ty++) {
								for (let tx = col * 8; tx < col * 8 + 8; tx++) sum += chunk.alpha[(l - 1) * texels + ty * ALPHA_SIZE + tx];
							}
							others += sum;
							if (sum > bestSum) {
								bestSum = sum;
								best = l;
							}
						}
						if (best > 0 && bestSum > 64 * 255 - others) dominant = best;
					}
					const effectId = chunk.layers[dominant]?.effectId ?? 0;
					if (!effectId) continue;
					const effect = this.effectCache.get(effectId);
					if (!effect) continue;
					let effectIndex = indexOf.get(effectId);
					if (effectIndex === undefined) {
						if (effects.length >= 255) continue;
						const density = Math.round(effect.density * this.clutterSettings.density);
						if (!density) continue;
						effectIndex = effects.length;
						effects.push({ density, doodads: effect.doodads });
						indexOf.set(effectId, effectIndex);
					}
					cells[gz * n + gx] = effectIndex + 1;
				}
			}
		});
		const source: ClutterSource | null = effects.length ? { effects, cells, outer: tm.outer, inner: tm.inner } : null;
		this.clutter.addTile(key, originX, originZ, source);
	}

	/** Clutter settings changed: regenerate every tile's clutter. */
	refreshClutter(): void {
		this.clutter.enabled = this.clutterSettings.enabled;
		for (const index of this.tileMeshes.keys()) this.clutterDirty.add(index);
	}

	/**
	 * Gives layers painted before the scan finished their texture's usual effect (spec 7.7.2), as
	 * one undoable command; returns how many chunks changed. Run when the scan completes and when
	 * Show clutter is switched on, so no layer stays bare for want of a button.
	 */
	applyGroundEffects(): number {
		const model = this.model;
		const changes: { tileIndex: number; chunkId: number; before: { layers: typeof model.tiles[0]['chunks'][0]['layers']; alpha: Uint8Array | null }; after: { layers: typeof model.tiles[0]['chunks'][0]['layers']; alpha: Uint8Array | null } }[] = [];
		let bytes = 0;
		model.tiles.forEach((tile, tileIndex) => {
			tile.chunks.forEach((chunk, chunkId) => {
				const missing = chunk.layers.filter((l) => l.effectId === undefined && this.effectFor(model.textures[l.texture]));
				if (!missing.length) return;
				const snapshot = () => ({ layers: chunk.layers.map((l) => ({ ...l })), alpha: chunk.alpha ? chunk.alpha.slice() : null });
				const before = snapshot();
				for (const layer of missing) layer.effectId = this.effectFor(model.textures[layer.texture]);
				changes.push({ tileIndex, chunkId, before, after: snapshot() });
				bytes += (chunk.alpha?.length ?? 0) * 2 + 256;
				model.markDirty(tile);
			});
		});
		if (changes.length) {
			this.commands.push({
				label: 'Apply ground effects',
				bytes,
				undo: () => {
					for (const c of changes) model.restorePaint(c.tileIndex, c.chunkId, c.before.layers, c.before.alpha);
				},
				redo: () => {
					for (const c of changes) model.restorePaint(c.tileIndex, c.chunkId, c.after.layers, c.after.alpha);
				},
			});
		}
		return changes.length;
	}

	/**
	 * Rewrites changed chunks' alpha maps into the tile's atlas texture (spec 7.5): layer 1-3
	 * alpha goes to the R, G and B channels of the chunk's 64x64 atlas region.
	 */
	private updateTileAlpha(index: number, chunkIds: Set<number>): void {
		const tm = this.tileMeshes.get(index);
		if (!tm) return;
		const tile = this.model.tiles[index];
		const data = tm.alpha.image.data as Uint8Array;
		const texels = ALPHA_SIZE * ALPHA_SIZE;
		for (const id of chunkIds) {
			const chunk = tile.chunks[id];
			const cx = id % CHUNKS_PER_TILE;
			const cy = Math.floor(id / CHUNKS_PER_TILE);
			for (let layer = 0; layer < 3; layer++) {
				const map = chunk.alpha && layer < chunk.layers.length - 1 ? chunk.alpha.subarray(layer * texels, (layer + 1) * texels) : null;
				for (let y = 0; y < ALPHA_SIZE; y++) {
					const row = ((cy * ALPHA_SIZE + y) * ALPHA_ATLAS_SIZE + cx * ALPHA_SIZE) * 4 + layer;
					for (let x = 0; x < ALPHA_SIZE; x++) data[row + x * 4] = map ? map[y * ALPHA_SIZE + x] : 0;
				}
			}
		}
		tm.alpha.needsUpdate = true;
	}

	/** Flashes a red ring over chunks that could not take the texture (spec 7.5). */
	private flashBlocked(stroke: PaintStroke): void {
		while (stroke.blocked.length) {
			const { x, z } = stroke.blocked.pop()!;
			const ring = makeRing(4);
			(ring.material as THREE.LineBasicMaterial).color.set(0xe04040);
			const positions = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
			const corners = [[x + 0.5, z + 0.5], [x + CHUNK_SIZE - 0.5, z + 0.5], [x + CHUNK_SIZE - 0.5, z + CHUNK_SIZE - 0.5], [x + 0.5, z + CHUNK_SIZE - 0.5]];
			corners.forEach(([px, pz], i) => positions.setXYZ(i, px, (this.model.surfaceAt(px, pz) ?? 0) + 0.3, pz));
			positions.needsUpdate = true;
			ring.visible = true;
			this.scene.add(ring);
			this.flags.push({ ring, until: performance.now() + 1200 });
			this.onNotice('That chunk already has 4 textures');
		}
	}

	/**
	 * Recomputes area-weighted lattice normals for the vertices of cells [sx0..sx1]x[sz0..sz1],
	 * accumulating over those cells plus a one-cell ring, exactly as the full build does.
	 */
	private recomputeNormals(tm: TileMesh, sx0: number, sx1: number, sz0: number, sz1: number): void {
		const n = TILE_CELLS;
		const w = n + 1;
		const outerCount = w * w;
		const normals = tm.latticeNormals;
		const inZeroOuter = (gx: number, gz: number) => gx >= sx0 && gx <= sx1 + 1 && gz >= sz0 && gz <= sz1 + 1;
		const inZeroInner = (gx: number, gz: number) => gx >= sx0 && gx <= sx1 && gz >= sz0 && gz <= sz1;
		for (let gz = sz0; gz <= sz1 + 1; gz++) {
			for (let gx = sx0; gx <= sx1 + 1; gx++) normals.fill(0, (gz * w + gx) * 3, (gz * w + gx) * 3 + 3);
		}
		for (let gz = sz0; gz <= sz1; gz++) {
			for (let gx = sx0; gx <= sx1; gx++) normals.fill(0, (outerCount + gz * n + gx) * 3, (outerCount + gz * n + gx) * 3 + 3);
		}

		const ax0 = Math.max(0, sx0 - 1);
		const ax1 = Math.min(n - 1, sx1 + 1);
		const az0 = Math.max(0, sz0 - 1);
		const az1 = Math.min(n - 1, sz1 + 1);
		const add = (index: number, x: number, y: number, z: number) => {
			normals[index * 3] += x;
			normals[index * 3 + 1] += y;
			normals[index * 3 + 2] += z;
		};
		for (let gz = az0; gz <= az1; gz++) {
			for (let gx = ax0; gx <= ax1; gx++) {
				// The cell's four fan triangles, wound as the mesh builds them.
				const x0 = gx * CELL;
				const z0 = gz * CELL;
				const h00 = tm.outer[gz * w + gx];
				const h10 = tm.outer[gz * w + gx + 1];
				const h01 = tm.outer[(gz + 1) * w + gx];
				const h11 = tm.outer[(gz + 1) * w + gx + 1];
				const hc = tm.inner[gz * n + gx];
				const corners: [number, number, number, number, number, boolean][] = [
					[x0, h00, z0, gz * w + gx, 0, inZeroOuter(gx, gz)],
					[x0 + CELL, h10, z0, gz * w + gx + 1, 0, inZeroOuter(gx + 1, gz)],
					[x0 + CELL, h11, z0 + CELL, (gz + 1) * w + gx + 1, 0, inZeroOuter(gx + 1, gz + 1)],
					[x0, h01, z0 + CELL, (gz + 1) * w + gx, 0, inZeroOuter(gx, gz + 1)],
				];
				const centre: [number, number, number] = [x0 + CELL / 2, hc, z0 + CELL / 2];
				const centreIndex = outerCount + gz * n + gx;
				const centreIn = inZeroInner(gx, gz);
				// Triangles (tl, c, tr), (tr, c, br), (br, c, bl), (bl, c, tl).
				const order = [0, 1, 1, 2, 2, 3, 3, 0];
				for (let t = 0; t < 4; t++) {
					const a = corners[order[t * 2]];
					const b = corners[order[t * 2 + 1]];
					const abx = centre[0] - a[0], aby = centre[1] - a[1], abz = centre[2] - a[2];
					const acx = b[0] - a[0], acy = b[1] - a[1], acz = b[2] - a[2];
					const nx = aby * acz - abz * acy;
					const ny = abz * acx - abx * acz;
					const nz = abx * acy - aby * acx;
					if (a[5]) add(a[3], nx, ny, nz);
					if (b[5]) add(b[3], nx, ny, nz);
					if (centreIn) add(centreIndex, nx, ny, nz);
				}
			}
		}

		const normalize = (index: number) => {
			const o = index * 3;
			const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
			normals[o] /= len;
			normals[o + 1] /= len;
			normals[o + 2] /= len;
		};
		for (let gz = sz0; gz <= sz1 + 1; gz++) for (let gx = sx0; gx <= sx1 + 1; gx++) normalize(gz * w + gx);
		for (let gz = sz0; gz <= sz1; gz++) for (let gx = sx0; gx <= sx1; gx++) normalize(outerCount + gz * n + gx);
	}

	/** Whether the scene is being played (spec 7.10) rather than edited. */
	get playing(): boolean {
		return this.walker.active;
	}

	/** Called whenever play mode starts or ends, for the top bar's Edit/Play button. */
	onPlayChange: (playing: boolean) => void = () => {};

	/** Alt+Z while playing (spec 7.10): the interface is hidden, nameplates with it. */
	private uiHidden = false;

	/** Hides or shows the interface while playing: body.ui-hidden hides the panels, and the nameplates go with them. */
	setUiHidden(hidden: boolean): void {
		this.uiHidden = hidden;
		document.body.classList.toggle('ui-hidden', hidden);
	}

	/**
	 * Play mode (spec 7.10): drops the player to the ground under the camera and walks; off, the
	 * editor camera is put at the player's position, looking its way. Returns false when there is
	 * no ground under the camera to start on.
	 */
	setPlaying(on: boolean): boolean {
		if (on === this.walker.active) return true;
		if (!on) {
			this.setTarget(null);
			this.setUiHidden(false);
			this.walker.stop();
			this.controls.enabled = true;
			const eye = this.walker.position.clone();
			eye.y += this.walker.height * PLAYER_EYE;
			this.controls.set(eye, this.walker.yaw, this.walker.pitch);
			this.onPlayChange(false);
			return true;
		}
		this.endStroke();
		const cam = this.camera.position;
		const floor = this.walker.floorAt(cam.x, cam.z, cam.y, cam.y - 5000);
		if (!floor) {
			this.onNotice('There’s no ground under the camera to stand on');
			return false;
		}
		this.controls.enabled = false;
		this.walker.dropFrom(cam, this.controls.yaw);
		this.walker.start();
		void this.dressPlayer();
		this.onPlayChange(true);
		return true;
	}

	/** Targets an NPC (spec 7.10): the selection circle at its feet and the target frame with its name; null clears. */
	setTarget(id: string | null): void {
		this.target = id && this.model.npc(id) ? id : null;
		const npc = this.target ? this.model.npc(this.target) : null;
		const frame = document.getElementById('target-frame');
		if (frame) {
			frame.hidden = !npc;
			if (npc) {
				frame.querySelector('#target-name')!.textContent = npc.name?.trim() || 'Unnamed NPC';
				frame.querySelector('#target-sub')!.textContent = npc.subName?.trim() ? `<${npc.subName.trim()}>` : '';
			}
		}
		this.targetRing.visible = !!npc;
	}

	/** A left click on the view while playing: targets the NPC under the mouse, or clears the target on nothing. */
	private targetClick(): void {
		if (Number.isNaN(this.mouse.x)) return;
		this.raycaster.setFromCamera(this.mouse, this.camera);
		const npc = this.objects.pickNpc(this.raycaster);
		this.setTarget(npc?.id ?? null);
	}

	/** Names over NPCs within range of the player, and the selection circle under the target; each frame while playing. */
	private updatePlay(): void {
		const playing = this.walker.active;
		this.nameplates.group.visible = playing && !this.uiHidden;
		if (!playing) return;
		if (this.target && !this.model.npc(this.target)) this.setTarget(null);
		const plates: Plate[] = [];
		const feet = this.walker.position;
		for (const n of this.uiHidden ? [] : this.model.npcs) {
			const name = n.name?.trim();
			if (!name || !this.objects.npcs.isSpawned(n.id)) continue;
			const distance = Math.hypot(n.position[0] - feet.x, n.position[2] - feet.z);
			if (distance > NAMEPLATE_RANGE) continue;
			const capsule = this.objects.npcs.capsule(n);
			plates.push({ id: n.id, name, sub: n.subName?.trim() ?? '', position: new THREE.Vector3(n.position[0], capsule.top + 0.25, n.position[2]), distance: this.camera.position.distanceTo(new THREE.Vector3(n.position[0], capsule.top, n.position[2])) });
		}
		this.nameplates.update(plates, this.camera, this.canvas.clientHeight || window.innerHeight, this.renderer.getPixelRatio());
		const target: PlacedNpc | null = this.target ? this.model.npc(this.target) : null;
		if (target) {
			const capsule = this.objects.npcs.capsule(target);
			this.targetRing.position.set(target.position[0], target.position[1] + 0.08, target.position[2]);
			this.targetRing.scale.setScalar(capsule.radius + 0.25);
		}
	}

	// ---- The environment (spec 6.1): light preset, time of day, weather and fog ----

	/** The light zones of every map the client has, for the scene's light preset (any Light.db2 zone). */
	private async loadLighting(): Promise<void> {
		try {
			const mapIds = new Set<number>([0]);
			if (this.model.meta.base) mapIds.add(this.model.meta.base.mapId);
			for (const m of await this.storage.listMaps().catch(() => [])) mapIds.add(m.id);
			const data = await this.storage.loadLighting([...mapIds]);
			if (!this.disposed) this.lighting = new Lighting(data);
		} catch (e) {
			console.warn('Lighting unavailable, the scene keeps its plain daylight:', e);
		}
	}

	/** The scene's environment as it stands. */
	get environment(): Readonly<Scene['environment']> {
		return this.model.meta.environment;
	}

	/**
	 * Changes the environment as one undoable command. A slider previews its values live through
	 * previewEnvironment first and commits once with `from`, the environment before the drag, so
	 * the drag undoes in one step.
	 */
	setEnvironment(patch: Partial<Scene['environment']>, label: string, from?: Scene['environment']): void {
		const before = from ?? this.model.meta.environment;
		const after = tidyEnvironment({ ...this.model.meta.environment, ...patch });
		if (JSON.stringify(before) === JSON.stringify(after)) {
			if (from) this.apply(before);
			return;
		}
		this.apply(after);
		this.commands.push({ label, bytes: 64, undo: () => this.apply(before), redo: () => this.apply(after) });
	}

	/** Shows a change without recording it; setEnvironment with `from` records the whole drag afterwards. */
	previewEnvironment(patch: Partial<Scene['environment']>): void {
		this.apply(tidyEnvironment({ ...this.model.meta.environment, ...patch }));
	}

	private apply(environment: Scene['environment']): void {
		this.model.setEnvironment(environment);
		this.onEnvironmentChange();
	}

	/** The lowest ground on a grid around a point, for the fog to lie at; the point's own height where there's none. */
	private lowestGroundAround(p: THREE.Vector3): number {
		let lowest = Infinity;
		const half = (FOG_BASE_SAMPLES - 1) / 2;
		for (let i = 0; i < FOG_BASE_SAMPLES; i++) {
			for (let j = 0; j < FOG_BASE_SAMPLES; j++) {
				const h = this.model.heightAt(p.x + ((i - half) / half) * FOG_BASE_REACH, p.z + ((j - half) / half) * FOG_BASE_REACH);
				if (h !== null && h < lowest) lowest = h;
			}
		}
		return lowest < Infinity ? lowest : p.y;
	}

	/** Sun, ambient, sky and fog from the scene's light preset at its time of day. */
	private updateLighting(): void {
		const env = this.model.meta.environment;
		const t = THREE.MathUtils.euclideanModulo(env.timeOfDay, DAY);
		const sunDir = sunDirection(t);
		// Lit by the sun by day and by the (opposite) moon at night; the colours already say how bright.
		const bySun = sunDir.y > SUN_TO_MOON;
		const lightDir = bySun ? sunDir : new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.35, sunDir.z).normalize();
		this.sun.position.copy(lightDir);
		// Shadows fade to nothing either side of the switch, so they don't jump round.
		this.shadowStrength = bySun ? THREE.MathUtils.smoothstep(sunDir.y, SUN_TO_MOON, SUN_TO_MOON + 0.12) : THREE.MathUtils.smoothstep(-sunDir.y, -SUN_TO_MOON, 0.1);
		this.sun.shadow.intensity = this.shadowsOn ? SHADOW_INTENSITY * this.shadowStrength : 0;
		this.sun.shadow.camera.far = Math.min(SHADOW_RANGE + this.altitude * SHADOW_RANGE_PER_ALTITUDE, SHADOW_RANGE_MAX);
		const state = this.lighting?.sampleZone(env.lightPreset, t) ?? null;
		const background = this.scene.background as THREE.Color;
		let fogNear = FOG_NEAR_DEFAULT;
		let fogFar = FOG_FAR_DEFAULT;
		if (state) {
			const c = state.colors;
			this.sun.color.copy(c.direct);
			this.ambient.color.copy(c.ambient);
			this.ambient.groundColor.copy(c.ambient).multiplyScalar(0.8);
			this.sky.update(state, sunDir, this.camera.position);
			this.post.grading.set(state.grading);
			const fog = this.fogLook;
			fog.color.copy(c.skyFog);
			fog.sunColor.copy(c.direct).multiplyScalar(this.shadowStrength);
			fog.sunDir.copy(lightDir);
			fog.density = FOG_DENSITY * state.fogDensity;
			this.fog.color.copy(c.skyFog);
			background.copy(c.skyFog);
			if (state.fogEnd > 0) {
				fogFar = state.fogEnd;
				fogNear = state.fogEnd * THREE.MathUtils.clamp(state.fogScaler, 0, 0.9);
			}
		} else {
			this.sun.color.copy(PLAIN_SUN);
			this.ambient.color.copy(PLAIN_AMBIENT);
			this.ambient.groundColor.copy(PLAIN_AMBIENT);
			this.fog.color.copy(SKY);
			background.copy(SKY);
		}
		this.fog.near = fogNear;
		this.fog.far = fogFar;
		this.applyWeatherLight(state?.colors.skyFog ?? null);
		// Fog off: the distance fog pushed out past everything drawn (near and far apart, as smoothstep needs).
		const fogOn = env.fogOn !== false;
		if (!fogOn) {
			this.fog.near = FAR * 2;
			this.fog.far = FAR * 3;
		}

		// Under the scene's water the sky and fog don't show; the fog lies at the lowest ground around.
		const pos = this.camera.position;
		const liquid = this.liquidOver(pos);
		this.underwater = liquid !== null && liquid.surface > pos.y;
		this.sky.mesh.visible = state !== null && !this.underwater;
		const base = this.lowestGroundAround(pos);
		this.fogBase = this.fogBase === null ? base : this.fogBase + (base - this.fogBase) * 0.15;
		this.fogLook.base = this.fogBase;
		this.post.setFog(state && fogOn && !this.underwater ? this.fogLook : null);
	}

	/**
	 * Rain, snow and sandstorms dim the sun, cloud the sky over and bring the fog in, its colour
	 * as bright as the sky's fog would be (so a rainy night stays dark). Without the light tables
	 * the plain daylight's own sky colour stands in.
	 */
	private applyWeatherLight(skyFog: THREE.Color | null): void {
		const look = this.weather.lightLook;
		if (!look) return;
		const sky = skyFog ?? SKY;
		const brightness = THREE.MathUtils.clamp((sky.r * 0.3 + sky.g * 0.59 + sky.b * 0.11) * 2.5, 0.06, 1);
		const color = look.fogColor.clone().multiplyScalar(brightness);
		this.sun.color.multiplyScalar(1 - look.darken);
		this.ambient.color.multiplyScalar(1 - look.darken * 0.4);
		this.sky.overcast(color, look.fogMix);
		const fog = this.fogLook;
		fog.color.lerp(color, look.fogMix);
		fog.sunColor.multiplyScalar(1 - look.darken);
		fog.density *= look.fogDensity;
		this.fog.color.lerp(color, look.fogMix);
		(this.scene.background as THREE.Color).lerp(color, look.fogMix);
		// From high above the view stays open, so the whole scene can still be seen through the weather.
		const pos = this.camera.position;
		const altitude = Math.max(0, pos.y - (this.model.surfaceAt(pos.x, pos.z) ?? pos.y));
		this.fog.far = Math.min(this.fog.far, look.fogFar + altitude * 4);
		this.fog.near = Math.min(this.fog.near, this.fog.far * 0.15);
	}

	/** The scene's weather, drawn round the camera outdoors (not in a placed building's rooms) and above water. */
	private updateWeather(dt: number, now: number): void {
		this.weather.setting = this.model.meta.environment.weather ?? 'off';
		const pos = this.camera.position;
		if (now - this.lastRoomCheck > 250) {
			this.lastRoomCheck = now;
			this.indoors = !!this.objects.manager.roomAt(pos);
		}
		this.weather.update(dt, this.camera, null, null, !this.underwater && !this.indoors);
	}

	/** Changes who the user plays as (spec 7.10), as one undoable command; the avatar changes at once if playing. */
	setPlayer(appearance: NpcAppearance | null): void {
		const before = this.model.meta.player;
		const after = appearance;
		if (JSON.stringify(before) === JSON.stringify(after)) return;
		const apply = (to: NpcAppearance | null) => {
			this.model.setPlayer(to);
			this.onPlayerChange();
			if (this.walker.active) void this.dressPlayer();
		};
		apply(after);
		this.commands.push({ label: 'Change player avatar', bytes: 64, undo: () => apply(before), redo: () => apply(after) });
	}

	/**
	 * Dresses the avatar as scene.player: a creature display or an embedded preset through the
	 * NPC pipeline, or a human when null (or when the preset is gone from the scene).
	 */
	private async dressPlayer(): Promise<void> {
		const player = this.model.meta.player;
		const preset = player?.kind === 'custom' ? this.model.preset(player.presetId) : null;
		const key = JSON.stringify([player, preset]);
		if (key === this.playerKey) return;
		this.playerKey = key;
		const stuck = await this.character.dressFrom(key, async (clips) => {
			if (player?.kind === 'creature') return this.storage.loadPlayerModel({ kind: 'creature', displayId: player.displayId }, clips);
			if (preset) return this.storage.loadPlayerModel({ kind: 'npcPreset', handle: this.objects.npcs.handle(preset) }, clips);
			const human = await this.storage.loadCharacter(DEFAULT_PLAYER.race, DEFAULT_PLAYER.sex, true, 0, clips, null, false);
			return human?.model ?? null;
		});
		if (!stuck || this.disposed) return;
		if (!this.character.dressed) this.onNotice(player ? 'The player\u2019s model isn\u2019t in your client; a capsule stands in' : 'The default avatar couldn\u2019t be loaded; a capsule stands in');
		else if (player?.kind === 'custom' && !preset) this.onNotice('The player\u2019s custom NPC isn\u2019t in this scene any more; playing as the default avatar');
	}

	undo(): void {
		this.endStroke();
		this.commands.undo();
	}

	redo(): void {
		this.endStroke();
		this.commands.redo();
	}

	start(): void {
		this.clock.start();
		const loop = () => {
			if (this.disposed) return;
			this.frame = requestAnimationFrame(loop);
			this.update(Math.min(this.clock.getDelta(), 0.1));
			this.render();
		};
		loop();
	}

	private update(dt: number): void {
		this.updateCursor();
		if (this.stroke && this.cursor) {
			this.stroke.apply(this.cursor.x, this.cursor.z, dt);
			if (this.stroke instanceof PaintStroke) this.flashBlocked(this.stroke);
		}
		for (const [index, chunks] of this.model.dirtyHeights) {
			this.model.dirtyHeights.delete(index);
			this.strokeTiles.add(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue;
			this.updateTileHeights(index, chunks);
		}
		// Culling bounds refresh once the edit is over (stroke end, ramp, undo, redo).
		if (!this.stroke && this.strokeTiles.size) this.refreshBounds();
		for (const [index, chunks] of this.model.dirtyAlpha) {
			this.model.dirtyAlpha.delete(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue;
			this.updateTileAlpha(index, chunks);
		}
		for (const index of this.model.dirtyWater) {
			this.model.dirtyWater.delete(index);
			this.clutterDirty.add(index);
			if (this.model.dirtyTiles.has(index)) continue; // The rebuild brings the water too.
			this.buildTileWater(index);
		}
		liquidTime.value += dt;
		// Clutter regenerates once the edit is over, not per stroke frame (spec 7.7.1).
		if (!this.stroke && this.clutterDirty.size) {
			for (const index of [...this.clutterDirty]) {
				this.clutterDirty.delete(index);
				this.rebuildClutter(index);
			}
		}
		const ground = this.model.surfaceAt(this.camera.position.x, this.camera.position.z);
		this.altitude = Math.max(0, this.camera.position.y - Math.max(ground ?? 0, 0));
		this.clutter.update(performance.now(), this.camera.position, ground ?? -Infinity);
		// The gizmo and boxes hide while walking or looking around, like the other overlays.
		this.objects.setActive(this.objectTool && !this.walker.active && !this.controls.locked);
		this.objects.update(performance.now(), this.camera.position);
		const now = performance.now();
		// Once every placed NPC's model has loaded or failed, say what the client lacks (spec 7.11).
		if (!this.npcsReported && this.model.npcs.length && now - this.lastNpcCheck > 1000) {
			this.lastNpcCheck = now;
			const report = this.objects.npcs.loadReport();
			if (report) {
				this.npcsReported = true;
				const parts: string[] = [];
				if (report.missing) parts.push(`${report.missing} NPC${report.missing === 1 ? ' isn\u2019t' : 's aren\u2019t'} in your client (${this.model.meta.client.build}) and ${report.missing === 1 ? 'stands' : 'stand'} as a placeholder`);
				if (report.gear.length) parts.push(`gear left off custom NPCs: ${report.gear.slice(0, 4).join(', ')}${report.gear.length > 4 ? ` and ${report.gear.length - 4} more` : ''}`);
				if (parts.length) this.onNotice(parts.join('; '));
			}
		}
		for (let i = this.flags.length - 1; i >= 0; i--) {
			if (now < this.flags[i].until) continue;
			const [flag] = this.flags.splice(i, 1);
			this.scene.remove(flag.ring);
			flag.ring.geometry.dispose();
			(flag.ring.material as THREE.Material).dispose();
		}
		for (const index of this.model.dirtyTiles) {
			this.model.dirtyTiles.delete(index);
			// A streamed-out tile picks the change up from the model when it streams back in.
			if (this.tileWanted(index)) void this.buildTile(this.model.tiles[index]);
		}
		this.stream(now);
		if (this.walker.active) this.walker.update(dt);
		else this.controls.update(dt, (x, z) => this.model.heightAt(x, z) ?? -Infinity, (x, z) => this.model.surfaceAt(x, z) ?? -Infinity);
		this.character.update(dt, this.walker);
		this.updatePlay();
		this.updateWeather(dt, now);
		this.updateLighting();
		this.updateRings();
		this.updateStatus(dt);
	}

	/** The ground under the mouse, by marching the pick ray against the height field. */
	private updateCursor(): void {
		this.cursor = null;
		if (this.walker.active || this.controls.locked || Number.isNaN(this.mouse.x)) return;
		this.raycaster.setFromCamera(this.mouse, this.camera);
		const o = this.raycaster.ray.origin;
		const d = this.raycaster.ray.direction;
		let prevT = 0;
		let prevF: number | null = null;
		for (let t = 0; t < CURSOR_REACH; t += Math.max(0.5, t * 0.02)) {
			const x = o.x + d.x * t;
			const z = o.z + d.z * t;
			const s = this.model.surfaceAt(x, z);
			if (s === null) {
				prevF = null;
				continue;
			}
			const f = o.y + d.y * t - s;
			if (f <= 0) {
				if (prevF === null) return; // Started underground or entered from outside.
				// Bisect between the last point above and this one below.
				let lo = prevT;
				let hi = t;
				for (let i = 0; i < 24; i++) {
					const mid = (lo + hi) / 2;
					const mx = o.x + d.x * mid;
					const mz = o.z + d.z * mid;
					const ms = this.model.surfaceAt(mx, mz);
					if (ms === null || o.y + d.y * mid - ms > 0) lo = mid;
					else hi = mid;
				}
				const hx = o.x + d.x * hi;
				const hz = o.z + d.z * hi;
				const height = this.model.surfaceAt(hx, hz);
				if (height !== null) this.cursor = { x: hx, z: hz, height };
				return;
			}
			prevT = t;
			prevF = f;
		}
	}

	/** Lays the brush ring (and the ramp's anchor ring) on the terrain. */
	private updateRings(): void {
		if (this.tool !== 'sculpt' || this.brush.mode !== 'ramp') this.rampStart = null;
		const show = this.cursor !== null && !this.walker.active && !this.controls.locked && !this.objectTool && this.tool !== 'environment';
		this.ring.visible = show;
		const radius =
			this.tool === 'paint' ? (this.paint.mode === 'paint' || this.paint.mode === 'erase' ? this.paint.radius : 2)
			: this.tool === 'holes' ? this.holes.radius
			: this.tool === 'water' ? (this.water.mode === 'flood' ? 2 : this.water.radius)
			: this.tool === 'revert' ? this.revert.radius
			: this.brush.radius;
		if (show && this.cursor) this.layRing(this.ring, this.cursor.x, this.cursor.z, radius, this.cursor.height);
		this.rampRing.visible = this.rampStart !== null;
		if (this.rampStart) this.layRing(this.rampRing, this.rampStart.x, this.rampStart.z, Math.min(this.brush.radius, 3), this.rampStart.h);
	}

	private layRing(ring: THREE.LineLoop, x: number, z: number, radius: number, fallback: number): void {
		const positions = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
		const count = positions.count;
		for (let i = 0; i < count; i++) {
			const a = (i / count) * Math.PI * 2;
			const px = x + Math.cos(a) * radius;
			const pz = z + Math.sin(a) * radius;
			positions.setXYZ(i, px, (this.model.surfaceAt(px, pz) ?? fallback) + 0.15, pz);
		}
		positions.needsUpdate = true;
	}

	private updateStatus(dt: number): void {
		this.fpsFrames++;
		this.fpsTime += dt;
		if (this.fpsTime >= 0.5) {
			this.fps = Math.round(this.fpsFrames / this.fpsTime);
			this.fpsFrames = 0;
			this.fpsTime = 0;
		}
		this.onStatus({ cursor: this.cursor, layers: this.chunkUnderCursor()?.layers.length ?? null, fps: this.fps });
	}

	/** The chunk under the ground cursor, or null off the terrain. */
	chunkUnderCursor(): PickedChunk | null {
		if (!this.cursor) return null;
		const tile = this.model.tileAt(this.cursor.x, this.cursor.z);
		if (!tile) return null;
		const cx = Math.min(Math.floor((this.cursor.x - tile.x * TILE_SIZE) / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const cy = Math.min(Math.floor((this.cursor.z - tile.y * TILE_SIZE) / CHUNK_SIZE), CHUNKS_PER_TILE - 1);
		const chunkId = cy * CHUNKS_PER_TILE + cx;
		return { tileIndex: tile.y * this.model.tilesX + tile.x, chunkId, layers: tile.chunks[chunkId].layers };
	}

	private render(): void {
		if (this.hasWater) this.groundPass.render(this.renderer, this.terrain, this.camera);
		// Mountains' shadows past the shadow maps' reach, then the maps themselves every other frame.
		this.terrainShadow.update(this.renderer, this.terrain, this.camera.position, this.altitude, this.sun.position, this.sun.shadow.camera.far, this.shadowsOn ? this.shadowStrength : 0, performance.now());
		this.renderer.shadowMap.needsUpdate = (this.shadowsOn || !this.shadowMapsDrawn) && (this.shadowFrame++ & 1) === 0;
		if (this.renderer.shadowMap.needsUpdate) this.shadowMapsDrawn = true;
		this.post.render(this.renderer, this.scene, this.camera);
	}

	/**
	 * Starts the active terrain tool at the cursor (Shift or Cmd + left button). `lower` is the
	 * Cmd variant: it turns Raise/Lower down, fills holes instead of cutting them, and dries water
	 * instead of laying it, as the tool panel's hotkeys list them.
	 */
	private beginStroke(lower: boolean): void {
		if (this.walker.active || this.controls.locked || this.objectTool) return;
		if (!this.cursor) return;
		if (this.tool === 'revert') {
			if (!this.model.baseData) return;
			this.stroke = new RevertStroke(this.model, this.revert);
			return;
		}
		if (this.tool === 'paint') {
			if (this.paint.mode === 'swap') {
				// Swap texture needs both slots of the Texture swap window (texture-swap.md §2.3); the
				// brush's own texture does not matter here.
				const { swapFrom, swapTo } = this.paint;
				if (!swapFrom && !swapTo) this.onNotice('Choose the existing and replacement textures in the Texture swap window first');
				else if (!swapFrom) this.onNotice('Choose the existing texture in the Texture swap window first');
				else if (!swapTo) this.onNotice('Choose the replacement texture in the Texture swap window first');
				else if (swapFrom === swapTo) this.onNotice('The existing and replacement textures are the same');
				if (!swapFrom || !swapTo || swapFrom === swapTo) return;
			} else if (this.paint.fdid === 0 && this.paint.mode !== 'erase') {
				// No texture is selected in the Texture browser: only erasing makes sense (spec 7.5).
				this.onNotice('Pick a texture in the Texture browser to paint with');
				return;
			}
			this.stroke = new PaintStroke(this.model, this.paint, this.effectFor);
			return;
		}
		if (this.tool === 'holes') {
			this.holes.mode = lower ? 'fill' : 'cut';
			this.stroke = new HoleStroke(this.model, this.holes);
			return;
		}
		if (this.tool === 'water') {
			if (this.water.mode !== 'flood') this.water.mode = lower ? 'remove' : 'add';
			const stroke = new WaterStroke(this.model, this.water, this.cursor.height);
			if (this.water.mode === 'flood') {
				// Flood fills once per click, like the ramp.
				const filled = stroke.applyFlood(this.cursor.x, this.cursor.z);
				const command = stroke.finish();
				if (command) this.commands.push(command);
				else if (!filled) this.onNotice('Flood fill needs ground below the surface height; raise the height or click a hollow');
				return;
			}
			this.stroke = stroke;
			return;
		}
		if (this.tool !== 'sculpt') return;
		if (this.brush.mode === 'ramp') {
			if (!this.rampStart) {
				this.rampStart = { x: this.cursor.x, z: this.cursor.z, h: this.cursor.height };
				return;
			}
			const stroke = new SculptStroke(this.model, this.brush, this.cursor.height);
			stroke.applyRamp(this.rampStart, { x: this.cursor.x, z: this.cursor.z, h: this.cursor.height });
			const command = stroke.finish();
			if (command) this.commands.push(command);
			this.rampStart = null;
			return;
		}
		const raiseLower = this.brush.mode === 'raise' || this.brush.mode === 'lower';
		this.stroke = new SculptStroke(this.model, this.brush, this.cursor.height, raiseLower ? (lower ? 'lower' : 'raise') : null);
	}

	/** Ends the open stroke, committing it as one undoable command. */
	private endStroke(): void {
		if (!this.stroke) return;
		const swap = this.stroke instanceof PaintStroke && this.paint.mode === 'swap';
		const command = this.stroke.finish();
		this.stroke = null;
		if (command) this.commands.push(command);
		else if (swap) this.onNotice("That chunk doesn't use the existing texture");
	}

	/** Recomputes culling bounds of the tiles an edit touched (cheap once per edit). */
	private refreshBounds(): void {
		for (const index of this.strokeTiles) {
			const tm = this.tileMeshes.get(index);
			if (!tm) continue;
			tm.geometry.computeBoundingSphere();
			tm.geometry.computeBoundingBox();
		}
		this.strokeTiles.clear();
	}

	/** A 512x288 WebP render for the scene library (spec 6.2), from the current view. */
	async thumbnail(): Promise<Uint8Array | null> {
		const target = new THREE.WebGLRenderTarget(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		const aspect = this.camera.aspect;
		this.camera.aspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;
		this.camera.updateProjectionMatrix();
		const ringWas = this.ring.visible;
		this.ring.visible = false;
		this.rampRing.visible = false;
		if (this.hasWater) this.groundPass.render(this.renderer, this.terrain, this.camera);
		this.renderer.setRenderTarget(target);
		this.renderer.render(this.scene, this.camera);
		this.ring.visible = ringWas;
		const pixels = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4);
		await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, pixels);
		this.renderer.setRenderTarget(null);
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();
		target.dispose();
		// GL reads rows bottom-up.
		const flipped = new Uint8ClampedArray(pixels.length);
		const row = THUMBNAIL_WIDTH * 4;
		for (let y = 0; y < THUMBNAIL_HEIGHT; y++) flipped.set(pixels.subarray(y * row, (y + 1) * row), (THUMBNAIL_HEIGHT - 1 - y) * row);
		const drawn = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		drawn.getContext('2d')!.putImageData(new ImageData(flipped, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), 0, 0);
		try {
			const blob = await drawn.convertToBlob({ type: 'image/webp', quality: 0.85 });
			return new Uint8Array(await blob.arrayBuffer());
		} catch {
			return null;
		}
	}

	private readonly onMouseDown = (e: MouseEvent): void => {
		if (this.walker.active) {
			this.pressedPlaying = e.button === 0;
			return;
		}
		// The right button held looks around, with the mouse captured until it is let go.
		if (e.button === 2) {
			this.endStroke();
			this.press = null;
			this.controls.lock();
			return;
		}
		if (e.button !== 0 || this.controls.locked) return;
		if (this.objectTool) {
			// A press on the gizmo belongs to it; otherwise it selects, starts a box or places.
			if (Number.isNaN(this.mouse.x) || this.objects.gizmoBusy) return;
			this.raycaster.setFromCamera(this.mouse, this.camera);
			this.objects.press(this.raycaster, this.cursor, e, this.tool === 'npcs');
			return;
		}
		if (e.shiftKey || e.metaKey || e.ctrlKey) {
			this.beginStroke(e.metaKey || e.ctrlKey);
			return;
		}
		this.press = { x: e.clientX, y: e.clientY };
	};

	private readonly onMouseUp = (e: MouseEvent): void => {
		if (e.button === 0 && this.pressedPlaying) {
			this.pressedPlaying = false;
			// A press that turned the camera isn't a click (see WalkControls.wasDrag).
			if (this.walker.active && !this.walker.wasDrag) this.targetClick();
		}
		if (e.button === 2) {
			if (this.controls.locked) document.exitPointerLock();
			return;
		}
		if (e.button !== 0) return;
		const press = this.press;
		this.press = null;
		if (press && !this.objectTool && !this.walker.active && this.onChunkClick) this.onChunkClick(this.chunkUnderCursor());
		this.endStroke();
	};

	private readonly onMouseMove = (e: MouseEvent): void => {
		const rect = this.canvas.getBoundingClientRect();
		this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		// A press that moves on is no click.
		if (this.press && Math.abs(e.clientX - this.press.x) + Math.abs(e.clientY - this.press.y) > CLICK_THRESHOLD) this.press = null;
	};

	private readonly onMouseLeave = (): void => {
		this.mouse.set(NaN, NaN);
	};

	private readonly onContextMenu = (e: Event): void => {
		e.preventDefault();
	};

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		if (this.disposed) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		// Alt+Z (Option+Z) while playing hides and shows the interface, as in the game.
		if (e.altKey) {
			if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && this.walker.active && !e.repeat) {
				e.preventDefault();
				this.setUiHidden(!this.uiHidden);
			}
			return;
		}
		if (this.walker.active && e.code === 'Escape') return this.setTarget(null);
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
			e.preventDefault();
			if (e.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
			e.preventDefault();
			this.redo();
			return;
		}
		// The Place and NPCs tools' editing keys (spec 8): copy/paste/duplicate, gizmo modes, delete.
		if (this.objectTool && !this.walker.active && !this.controls.locked) {
			if (e.ctrlKey || e.metaKey) {
				if (e.code === 'KeyC') this.objects.copySelection();
				else if (e.code === 'KeyV') this.objects.paste();
				else if (e.code === 'KeyD') this.objects.duplicateSelection();
				else return;
				e.preventDefault();
				return;
			}
			// Space steps through the gizmos (Move, Rotate, Scale); with Shift it drops the selection to the ground.
			if (e.code === 'Space') {
				e.preventDefault();
				if (e.shiftKey) this.objects.dropToGround();
				else if (!e.repeat) this.objects.cycleGizmoMode();
				return;
			}
			if (e.code === 'KeyW') return this.objects.setGizmoMode('translate');
			if (e.code === 'KeyE') return this.objects.setGizmoMode('rotate');
			if (e.code === 'KeyR') return this.objects.setGizmoMode('scale');
			if (e.code === 'Delete' || e.code === 'Backspace') return this.objects.deleteSelection();
			if (e.code === 'Escape') return this.objects.clearSelection();
		}
	};

	private readonly onResize = (): void => {
		const width = this.canvas.clientWidth || window.innerWidth;
		const height = this.canvas.clientHeight || window.innerHeight;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	};

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.endStroke();
		this.walker.stop();
		this.controls.enabled = false;
		this.canvas.removeEventListener('mousedown', this.onMouseDown);
		this.canvas.removeEventListener('mousemove', this.onMouseMove);
		this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
		this.canvas.removeEventListener('contextmenu', this.onContextMenu);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('resize', this.onResize);
		for (const index of [...this.tileMeshes.keys()]) this.dropTile(index);
		this.setTarget(null);
		this.nameplates.disposeAll();
		this.targetRing.geometry.dispose();
		(this.targetRing.material as THREE.Material).dispose();
		this.objects.dispose();
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.rampRing.geometry.dispose();
		(this.rampRing.material as THREE.Material).dispose();
		this.sky.mesh.geometry.dispose();
		(this.sky.mesh.material as THREE.Material).dispose();
		this.weather.group.traverse((o) => {
			if (o instanceof THREE.Points || o instanceof THREE.LineSegments) {
				o.geometry.dispose();
				(o.material as THREE.Material).dispose();
			}
		});
		this.sun.dispose();
		this.renderer.dispose();
	}
}

/** The saved shadows setting; on until turned off. */
function readShadowsSetting(): boolean {
	try {
		return localStorage.getItem(SHADOWS_KEY) !== '0';
	} catch {
		return true;
	}
}

/** An environment with its defaults left out, so files stay small and equal settings compare equal. */
function tidyEnvironment(e: Scene['environment']): Scene['environment'] {
	const out: Scene['environment'] = { lightPreset: e.lightPreset, timeOfDay: THREE.MathUtils.euclideanModulo(Math.round(e.timeOfDay), DAY) };
	if (e.fog) out.fog = e.fog;
	if (e.fogOn === false) out.fogOn = false;
	if (e.weather) out.weather = e.weather;
	return out;
}
