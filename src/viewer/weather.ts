import * as THREE from 'three';
import type { MusicPlayer } from './music';
import { volume } from './volume';

/** What the weather setting asks for: the zone's own (as the server rolls it), the zone's own without rain or snow, none, or one kind. */
export type WeatherSetting = 'auto' | 'dry' | 'off' | 'rain' | 'snow' | 'sandstorm';
export type WeatherKind = 'rain' | 'snow' | 'sandstorm';

/** How the weather changes the light: applied by the viewer to the sun, ambient light and fog. */
export interface WeatherLook {
	/** 0-1: how much of the sun is lost to cloud. */
	darken: number;
	/** The fog's colour is pulled this far (0-1) towards fogColor. */
	fogMix: number;
	fogColor: THREE.Color;
	/** The view closes in to this many yards at most (Infinity: no change), and the height fog thickens by this factor. */
	fogFar: number;
	fogDensity: number;
}

/** The game's weather loops (sound/ambience/weather), light, medium and heavy. */
const SOUNDS: Record<WeatherKind, [number, number, number]> = {
	rain: [538983, 538981, 538982],
	snow: [538985, 538989, 538984],
	sandstorm: [538988, 538987, 538986],
};
/** textures/weather/snowflake01.blp */
export const SNOWFLAKE_TEXTURE = 186228;
const LOOP_VOLUME = 0.5;
/** Seconds for weather to come and go. */
const TRANSITION = 6;
/** How often the server rolls each zone's weather again (ms). */
const ROLL_PERIOD = 10 * 60 * 1000;
/** Yards: particles fill a box this wide and high around the camera. */
const BOX = 60;
const BOX_HEIGHT = 40;
const RAIN_DROPS = 9000;
const SNOW_FLAKES = 16000;
const SAND_GRAINS = 20000;

const KIND_NAMES: Record<WeatherKind, string> = { rain: 'rain', snow: 'snow', sandstorm: 'sandstorm' };

/** A small deterministic random number (0-1) from two integers. */
function hash(a: number, b: number): number {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	return (h >>> 0) / 4294967296;
}

/** Spring, summer, fall, winter: 0-3, by the month as on the realms. */
function season(date: Date): number {
	return Math.floor(((date.getMonth() + 10) % 12) / 3);
}

// Particles keep their place in the world while the box wraps round the camera, so moving
// through them looks right; they fade out towards the box's sides.
const VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uVelocity;
uniform float uStreak;
uniform float uSize;
uniform float uSway;
attribute vec4 seed;
varying float vFade;
void main() {
	vec3 size = vec3(${BOX.toFixed(1)}, ${BOX_HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
	vec3 p = seed.xyz * size + uVelocity * (uTime * (0.8 + 0.4 * seed.w));
	p += vec3(sin(uTime * 1.3 + seed.w * 40.0), 0.0, cos(uTime * 1.1 + seed.w * 31.0)) * uSway;
	p = mod(p - uCenter + size * 0.5, size) + uCenter - size * 0.5;
	// Lines: the second end of each streak trails behind along the velocity.
	p -= normalize(uVelocity) * uStreak * position.x;
	vec4 view = modelViewMatrix * vec4(p, 1.0);
	gl_Position = projectionMatrix * view;
	gl_PointSize = uSize * 300.0 / max(-view.z, 0.5);
	vec3 d = p - uCenter;
	vFade = (1.0 - smoothstep(0.55, 1.0, length(d.xz) / (size.x * 0.5))) * (1.0 - smoothstep(0.6, 1.0, abs(d.y) / (size.y * 0.5)));
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uMap;
uniform float uPoints;
uniform float uHasMap;
varying float vFade;
void main() {
	float a = uOpacity * vFade;
	if (uPoints > 0.5) {
		vec2 c = gl_PointCoord - 0.5;
		// The flake's shape is in its alpha or (on black) its brightness, whichever it uses.
		vec4 t = texture2D(uMap, gl_PointCoord);
		a *= uHasMap > 0.5 ? min(t.a, max(t.r, max(t.g, t.b))) : 1.0 - smoothstep(0.2, 0.5, length(c));
	}
	if (a < 0.01) discard;
	gl_FragColor = vec4(uColor, a);
}
`;

interface Layer {
	object: THREE.Points | THREE.LineSegments;
	material: THREE.ShaderMaterial;
	count: number;
}

function layer(count: number, lines: boolean, uniforms: Record<string, THREE.IUniform>): Layer {
	const verts = lines ? count * 2 : count;
	const seeds = new Float32Array(verts * 4);
	const ends = new Float32Array(verts * 3);
	for (let i = 0; i < count; i++) {
		const s = [Math.random(), Math.random(), Math.random(), Math.random()];
		if (lines) {
			seeds.set(s, i * 8);
			seeds.set(s, i * 8 + 4);
			ends[(i * 2 + 1) * 3] = 1;
		} else {
			seeds.set(s, i * 4);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(ends, 3));
	geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
	const material = new THREE.ShaderMaterial({
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		uniforms: {
			uTime: { value: 0 },
			uCenter: { value: new THREE.Vector3() },
			uVelocity: { value: new THREE.Vector3(0, -1, 0) },
			uStreak: { value: 0 },
			uSize: { value: 0.1 },
			uSway: { value: 0 },
			uColor: { value: new THREE.Color(1, 1, 1) },
			uOpacity: { value: 0.5 },
			uMap: { value: null },
			uPoints: { value: lines ? 0 : 1 },
			uHasMap: { value: 0 },
			...uniforms,
		},
		transparent: true,
		depthWrite: false,
	});
	const object = lines ? new THREE.LineSegments(geometry, material) : new THREE.Points(geometry, material);
	// Always round the camera; three can't tell where the shader puts them.
	object.frustumCulled = false;
	object.renderOrder = 20;
	object.visible = false;
	return { object, material, count };
}

/**
 * Rain, snow and sandstorms as the game has them: each zone's chances per season (VMaNGOS
 * game_weather), rolled again every ten minutes as the server does, or one kind chosen in the
 * View menu. Drawn as particles round the camera, with the game's weather sounds and a
 * darker, closer sky. Not indoors or under water.
 */
export class Weather {
	readonly group = new THREE.Group();
	setting: WeatherSetting = 'auto';
	private readonly rain = layer(RAIN_DROPS, true, {
		uVelocity: { value: new THREE.Vector3(1.5, -24, 0.8) },
		uStreak: { value: 1.1 },
		uColor: { value: new THREE.Color(0.75, 0.8, 0.88) },
		uOpacity: { value: 0.32 },
	});
	private readonly snow = layer(SNOW_FLAKES, false, {
		uVelocity: { value: new THREE.Vector3(0.6, -2.2, 0.3) },
		uSize: { value: 0.4 },
		uSway: { value: 0.6 },
		uOpacity: { value: 1 },
	});
	private readonly sand = layer(SAND_GRAINS, false, {
		uVelocity: { value: new THREE.Vector3(16, -1.2, 6) },
		uSize: { value: 0.3 },
		uSway: { value: 1.5 },
		uColor: { value: new THREE.Color(0.5, 0.36, 0.2) },
		uOpacity: { value: 0.45 },
	});
	/** The weather now, eased between what's wanted: which kind and how strong (0-1). */
	private kind: WeatherKind | null = null;
	private strength = 0;
	private wanted: { kind: WeatherKind | null; intensity: number } = { kind: null, intensity: 0 };
	private zoneName = '';
	private chance = '';
	private loop: { audio: HTMLAudioElement; file: number } | null = null;
	private loopLevel = 0;
	private loading = 0;
	private music: MusicPlayer | null = null;
	private readonly look: WeatherLook = { darken: 0, fogMix: 0, fogColor: new THREE.Color(), fogFar: Infinity, fogDensity: 1 };

	constructor() {
		this.group.name = 'weather';
		this.group.add(this.rain.object, this.snow.object, this.sand.object);
	}

	/** The snowflake texture, once read. */
	setSnowflake(texture: THREE.Texture): void {
		this.snow.material.uniforms.uMap.value = texture;
		this.snow.material.uniforms.uHasMap.value = 1;
	}

	/** Weather sounds play along with the music (M). */
	setMusic(music: MusicPlayer): void {
		this.music = music;
	}

	/** The weather for a zone now: rolled from its chances for the season, the same for everyone in each ten minutes. */
	private roll(zone: number, chances: number[] | null): { kind: WeatherKind | null; intensity: number } {
		if (!chances) return { kind: null, intensity: 0 };
		const now = Date.now();
		const s = season(new Date(now)) * 3;
		const [rain, snow, storm] = chances.slice(s, s + 3);
		const slot = Math.floor(now / ROLL_PERIOD);
		const r = hash(zone, slot) * 100;
		const intensity = 0.3 + 0.7 * hash(zone + 7777, slot);
		const names = ['spring', 'summer', 'fall', 'winter'];
		const parts = [rain && `${rain}% rain`, snow && `${snow}% snow`, storm && `${storm}% sandstorm`].filter(Boolean);
		this.chance = parts.length ? `${names[s / 3]}: ${parts.join(', ')}` : '';
		if (r < rain) return { kind: 'rain', intensity };
		if (r < rain + snow) return { kind: 'snow', intensity };
		// The server's storms in these zones are always sandstorms.
		if (r < rain + snow + storm) return { kind: 'sandstorm', intensity };
		return { kind: null, intensity: 0 };
	}

	/**
	 * Call every frame. zone and chances: the zone under the camera and its weather (null over
	 * the sea or off the continents); open: outdoors and above water.
	 */
	update(dt: number, camera: THREE.Camera, zone: { id: number; name: string } | null, chances: number[] | null, open: boolean): void {
		const s = this.setting;
		if (s === 'auto' || s === 'dry') {
			this.wanted = zone ? this.roll(zone.id, chances) : { kind: null, intensity: 0 };
			// Rain and snow turned off: those rolls come out clear, sandstorms still blow.
			if (s === 'dry' && this.wanted.kind !== 'sandstorm') this.wanted = { kind: null, intensity: 0 };
		} else if (s === 'off') this.wanted = { kind: null, intensity: 0 };
		else this.wanted = { kind: s, intensity: 0.85 };
		if (s !== 'auto' && s !== 'dry') this.chance = '';
		this.zoneName = zone?.name ?? '';

		// Fade out the old kind before the new one comes in.
		const target = this.wanted.kind === this.kind ? this.wanted.intensity : 0;
		const step = dt / TRANSITION;
		this.strength = target > this.strength ? Math.min(target, this.strength + step) : Math.max(target, this.strength - step);
		if (this.strength === 0 && this.kind !== this.wanted.kind) this.kind = this.wanted.kind;

		const time = performance.now() / 1000;
		const shown = open ? this.strength : 0;
		for (const [kind, l] of [['rain', this.rain], ['snow', this.snow], ['sandstorm', this.sand]] as const) {
			const on = this.kind === kind && shown > 0.01;
			l.object.visible = on;
			if (!on) continue;
			l.material.uniforms.uTime.value = time;
			l.material.uniforms.uCenter.value.copy(camera.position);
			const verts = l.object instanceof THREE.LineSegments ? 2 : 1;
			l.object.geometry.setDrawRange(0, Math.round(l.count * shown) * verts);
		}
		this.updateLook();
		this.updateSound(dt, open);
	}

	/** How the light changes for the weather now. */
	get lightLook(): WeatherLook | null {
		return this.kind && this.strength > 0.01 ? this.look : null;
	}

	private updateLook(): void {
		const k = this.strength;
		const l = this.look;
		switch (this.kind) {
			case 'rain':
				l.darken = 0.6 * k;
				l.fogMix = 0.9 * k;
				l.fogColor.setRGB(0.2, 0.22, 0.25);
				l.fogFar = THREE.MathUtils.lerp(3000, 600, k);
				l.fogDensity = 1 + 3 * k;
				break;
			case 'snow':
				l.darken = 0.4 * k;
				l.fogMix = 0.9 * k;
				l.fogColor.setRGB(0.55, 0.58, 0.63);
				l.fogFar = THREE.MathUtils.lerp(3000, 450, k);
				l.fogDensity = 1 + 4 * k;
				break;
			case 'sandstorm':
				l.darken = 0.35 * k;
				l.fogMix = 0.95 * k;
				l.fogColor.setRGB(0.5, 0.36, 0.2);
				l.fogFar = THREE.MathUtils.lerp(2500, 160, k);
				l.fogDensity = 1 + 8 * k;
				break;
			default:
				l.darken = 0;
				l.fogMix = 0;
				l.fogFar = Infinity;
				l.fogDensity = 1;
		}
	}

	private updateSound(dt: number, open: boolean): void {
		const music = this.music;
		const on = !!music?.enabled && !!this.kind && this.strength > 0.01;
		const file = this.kind ? SOUNDS[this.kind][this.wanted.intensity < 0.45 ? 0 : this.wanted.intensity < 0.75 ? 1 : 2] : 0;
		if (on && (!this.loop || this.loop.file !== file) && this.loading !== file) void this.startLoop(file);
		if (!this.loop) return;
		const target = on ? this.strength * (open ? 1 : 0.35) : 0;
		this.loopLevel += (target - this.loopLevel) * Math.min(1, dt * 2);
		this.loop.audio.volume = THREE.MathUtils.clamp(this.loopLevel * LOOP_VOLUME * volume('ambience'), 0, 1);
		if (!on && this.loopLevel < 0.005) {
			this.loop.audio.pause();
			this.loop = null;
		}
	}

	private async startLoop(file: number): Promise<void> {
		if (!this.music) return;
		this.loading = file;
		const url = await this.music.soundUrl(file, true).catch(() => null);
		if (this.loading !== file) return;
		this.loading = 0;
		if (!url) return;
		this.loop?.audio.pause();
		const audio = new Audio(url);
		audio.loop = true;
		audio.volume = 0;
		this.loop = { audio, file };
		this.loopLevel = 0;
		void audio.play().catch(() => {});
	}

	/** The weather now, for the panel. */
	get status(): string {
		if (this.setting === 'off') return '';
		const now = this.kind && this.strength > 0.01
			? `${this.wanted.intensity < 0.45 ? 'Light' : this.wanted.intensity < 0.75 ? 'Medium' : 'Heavy'} ${KIND_NAMES[this.kind]}`
			: 'Clear';
		if (this.setting !== 'auto' && this.setting !== 'dry') return now;
		return [now, this.zoneName && this.chance ? `${this.zoneName}, ${this.chance}` : this.zoneName ? `${this.zoneName}: always clear` : ''].filter(Boolean).join(' · ');
	}
}
