import type { MusicPlayer } from './music';
import { newAudio, setLevel, stopAudio } from './audioOut';
import { volume } from './volume';

/** Volume of the background loop at full setting in the Sound panel. */
const VOLUME = 0.8;
/** Seconds to cross-fade between places, or between day and night. */
const FADE = 3;
/** Seconds to fade on going under water or coming up. */
const DUCK = 0.35;
/** How long (ms) a new loop must stay wanted before switching, so skimming a border doesn't. */
const SETTLE = 1000;
/** Height above the ground (yards) where the loop starts to fade, and where it's gone. */
const FADE_FROM = 150;
const FADE_TO = 600;

/** An ambience's background loops (SoundAmbience): one for the day, one for the night. */
export interface BackgroundSounds {
	day: number[];
	night: number[];
}

interface Voice {
	audio: HTMLAudioElement;
	file: number;
	/** 1 while playing, 0 while fading out. */
	target: number;
	level: number;
}

/**
 * The game's background sound for a place: its ambience loop (birds, wind, wildlife, city
 * bustle) for day or night, cross-faded between places, fading away high above the ground and
 * silent under water. Off along with the music (M).
 */
export class BackgroundAudio {
	private readonly voices: Voice[] = [];
	/** The file wanted now, and since when (ms). */
	private wanted = 0;
	private wantedSince = 0;
	/** The file playing or loading, 0 for none. */
	private applied = 0;
	private token = 0;
	/** Altitude and water, smoothed. */
	private gain = 0;

	constructor(private readonly music: MusicPlayer) {
		// Loops the browser refused before any user gesture start on the first one.
		const unblock = () => {
			for (const v of this.voices) if (v.audio.paused && v.target > 0) void v.audio.play().catch(() => {});
		};
		window.addEventListener('pointerdown', unblock);
		window.addEventListener('keydown', unblock);
	}

	/** What plays now, for the HUD and debugging. */
	get playing(): number {
		return this.applied;
	}

	/**
	 * Call every frame with this place's loops (null for none), whether it's night, the camera's
	 * height above the ground and whether it's under water.
	 */
	update(dt: number, now: number, sounds: BackgroundSounds | null, night: boolean, height: number, under: boolean): void {
		const file = this.music.enabled && sounds ? this.choose(sounds, night) : 0;
		if (file !== this.wanted) {
			this.wanted = file;
			this.wantedSince = now;
		}
		// The first loop starts at once, and turning off stops at once; changes wait to settle.
		if (this.wanted !== this.applied && (!this.applied || !this.wanted || now - this.wantedSince > SETTLE)) this.apply(this.wanted);

		const altitude = 1 - smoothstep(FADE_FROM, FADE_TO, height);
		const target = under ? 0 : altitude;
		this.gain = target > this.gain ? Math.min(target, this.gain + dt / DUCK) : Math.max(target, this.gain - dt / DUCK);
		for (let i = this.voices.length - 1; i >= 0; i--) {
			const v = this.voices[i];
			v.level = v.target > v.level ? Math.min(v.target, v.level + dt / FADE) : Math.max(v.target, v.level - dt / FADE);
			setLevel(v.audio, v.level * this.gain * VOLUME * volume('ambience'));
			if (v.target === 0 && v.level === 0) {
				stopAudio(v.audio);
				this.voices.splice(i, 1);
			}
		}
	}

	/** The loop for the time of day; the one already playing when it's among them. */
	private choose(sounds: BackgroundSounds, night: boolean): number {
		const list = (night ? sounds.night : sounds.day).length ? (night ? sounds.night : sounds.day) : night ? sounds.day : sounds.night;
		if (list.includes(this.wanted)) return this.wanted;
		return list[Math.floor(Math.random() * list.length)] ?? 0;
	}

	private apply(file: number): void {
		this.applied = file;
		const token = ++this.token;
		for (const v of this.voices) if (v.file !== file) v.target = 0;
		if (!file) return;
		// Back to a loop still fading out: fade it in again.
		const fading = this.voices.find((v) => v.file === file);
		if (fading) {
			fading.target = 1;
			return;
		}
		void this.music.soundUrl(file, true).then((url) => {
			if (token !== this.token) return;
			const audio = newAudio(url);
			audio.loop = true;
			this.voices.push({ audio, file, target: 1, level: 0 });
			void audio.play().catch(() => {});
		}, (e) => console.warn(`Ambience ${file}:`, e));
	}
}

function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}
