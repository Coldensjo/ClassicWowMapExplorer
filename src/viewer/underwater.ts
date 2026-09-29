import type { MusicPlayer } from './music';

/** Volume of the underwater loop and of the sounds for going under and coming up. */
const LOOP_VOLUME = 0.55;
const SPLASH_VOLUME = 0.4;
/** Seconds to fade the loop in or out. */
const FADE = 0.35;

/** An underwater ambience's files (SoundAmbience): the loop, and one-offs on going under and coming up. */
export interface UnderwaterSounds {
	loop: number[];
	enter: number[];
	exit: number[];
}

const pick = (files: number[]) => files[Math.floor(Math.random() * files.length)] ?? 0;

/**
 * The game's underwater sound: its ambience loop while submerged, a sound on going under and on
 * coming up, and the music muffled meanwhile. Off along with the music (M).
 */
export class UnderwaterAudio {
	private under = false;
	private loop: HTMLAudioElement | null = null;
	private level = 0;
	private token = 0;

	constructor(private readonly music: MusicPlayer) {}

	/** Call every frame with whether the camera is under water, and that place's sounds. */
	update(dt: number, under: boolean, sounds: UnderwaterSounds | null): void {
		const on = under && this.music.enabled;
		if (on !== this.under) {
			this.under = on;
			this.music.muffled = on;
			if (sounds && this.music.enabled) void this.once(pick(on ? sounds.enter : sounds.exit));
			if (on && sounds) void this.startLoop(pick(sounds.loop));
			else this.token++;
		}
		if (!this.loop) return;
		this.level = on ? Math.min(1, this.level + dt / FADE) : Math.max(0, this.level - dt / FADE);
		this.loop.volume = this.level * LOOP_VOLUME;
		if (!on && this.level === 0) {
			this.loop.pause();
			this.loop = null;
		}
	}

	private async startLoop(file: number): Promise<void> {
		if (!file) return;
		const token = ++this.token;
		const url = await this.music.soundUrl(file, true).catch(() => null);
		// Surfaced again while it loaded, or already looping.
		if (!url || token !== this.token || !this.under) return;
		if (this.loop) return;
		const audio = new Audio(url);
		audio.loop = true;
		audio.volume = 0;
		this.loop = audio;
		void audio.play().catch(() => {});
	}

	private async once(file: number): Promise<void> {
		if (!file) return;
		const url = await this.music.soundUrl(file, true).catch(() => null);
		if (!url) return;
		const audio = new Audio(url);
		audio.volume = SPLASH_VOLUME;
		void audio.play().catch(() => {});
	}
}
