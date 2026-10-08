import type { MusicPlayer } from './music';
import { newAudio, setLevel, stopAudio } from './audioOut';
import { volume } from './volume';

/**
 * Volume of the underwater loop and of the sounds for going under and coming up, at full
 * setting in the Sound panel.
 */
const LOOP_VOLUME = 0.55;
const SPLASH_VOLUME = 0.2;
/** Seconds to fade the loop in or out. */
const FADE = 0.35;
/** The walking character's splashes, at full setting. */
const WATER_SPLASH_VOLUME = 0.5;
/**
 * The game's own splashes for a character (sound/character/footsteps): going into water
 * (enterwatersplash, by size), and coming out of it, the splashing footsteps (watersplash, five each).
 */
const WATER_SPLASHES = {
	small: { enter: [540231], exit: [540262, 540249, 540253, 540256, 540259] },
	medium: { enter: [540233], exit: [540252, 540251, 540254, 540261, 540250] },
};

/** An underwater ambience's files (SoundAmbience): the loop, and one-offs on going under and coming up. */
export interface UnderwaterSounds {
	loop: number[];
	enter: number[];
	exit: number[];
}

const pick = (files: number[]) => files[Math.floor(Math.random() * files.length)] ?? 0;

/**
 * The game's underwater sound: its ambience loop while submerged, a sound on going under and on
 * coming up, and the music muffled meanwhile, all following the camera; and the walking
 * character's splashes into and out of water. Off along with the music (M).
 */
export class UnderwaterAudio {
	private under = false;
	private submerged = false;
	private loop: HTMLAudioElement | null = null;
	private level = 0;
	private token = 0;

	constructor(private readonly music: MusicPlayer) {}

	/**
	 * Call every frame with whether the camera is under water, whether the going-under and
	 * coming-up sounds should play for it (not while walking: the character splashes instead), and
	 * that place's sounds.
	 */
	update(dt: number, under: boolean, sounds: UnderwaterSounds | null, submerged = under): void {
		const on = under && this.music.enabled;
		if (on !== this.under) {
			this.under = on;
			this.music.muffled = on;
			if (on && sounds) void this.startLoop(pick(sounds.loop));
			else this.token++;
		}
		if (submerged !== this.submerged) {
			this.submerged = submerged;
			if (sounds && this.music.enabled) void this.once(pick(submerged ? sounds.enter : sounds.exit));
		}
		if (!this.loop) return;
		this.level = on ? Math.min(1, this.level + dt / FADE) : Math.max(0, this.level - dt / FADE);
		setLevel(this.loop, this.level * LOOP_VOLUME * volume('ambience'));
		if (!on && this.level === 0) {
			stopAudio(this.loop);
			this.loop = null;
		}
	}

	/** The walking character going into water or coming out of it; small ones (gnomes) splash less. */
	splash(into: boolean, small: boolean): void {
		if (!this.music.enabled) return;
		const set = WATER_SPLASHES[small ? 'small' : 'medium'];
		void this.once(pick(into ? set.enter : set.exit), WATER_SPLASH_VOLUME);
	}

	private async startLoop(file: number): Promise<void> {
		if (!file) return;
		const token = ++this.token;
		const url = await this.music.soundUrl(file, true).catch(() => null);
		// Surfaced again while it loaded, or already looping.
		if (!url || token !== this.token || !this.under) return;
		if (this.loop) return;
		const audio = newAudio(url);
		audio.loop = true;
		this.loop = audio;
		void audio.play().catch(() => {});
	}

	private async once(file: number, level = SPLASH_VOLUME): Promise<void> {
		if (!file) return;
		const url = await this.music.soundUrl(file, true).catch(() => null);
		if (!url) return;
		const audio = newAudio(url);
		setLevel(audio, level * volume('effects'));
		void audio.play().catch(() => {});
	}
}
