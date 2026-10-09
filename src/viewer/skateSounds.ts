import { audioContext, newAudio, setLevel } from './audioOut';
import type { MusicPlayer } from './music';
import { volume } from './volume';
import type { WalkControls } from './walkControls';

/** Loudness at full setting: the wheels' rumble and whirr, a wall ride's scrape, and the pops, clacks and thuds. */
const ROLL_VOLUME = 0.35;
const WHIRR_VOLUME = 0.06;
const SCRAPE_VOLUME = 0.25;
const ROAR_VOLUME = 0.35;
const SPRAY_VOLUME = 0.3;
const HIT_VOLUME = 0.6;
/** The wheels roll at full sound from this speed (yd/s). */
const FULL_ROLL = 12;
/** Wheels clack over this many cracks a second per yd/s. */
const CRACKS_PER_YARD = 0.3;
/** The fire mage's Heating Up (mage_hotstreak1-3, from the community listfile; in Classic too), played for a takedown's burst. */
const HEAT_UP_SOUNDS = [569646, 569232, 569672];
const HEAT_UP_VOLUME = 0.8;
/** Death cries of those taken down: how loud, at most how many at once, and how far apart they start (s). */
const DEATH_VOLUME = 0.7;
const MAX_DEATHS = 6;
const DEATH_STAGGER = 0.06;
/** How quickly the loops follow the speed (s). */
const SMOOTH = 0.05;

/** The loops playing all the time the board is in use: a noise source through a filter and a gain each. */
interface Loop {
	filter: BiquadFilterNode;
	gain: GainNode;
}

/**
 * The skateboard's sounds, made up from filtered noise and swept tones rather than read from the
 * game, which has none: the wheels rumbling and whirring with the speed and clacking over cracks,
 * a scrape riding a wall, and the pop of an ollie, the clack of getting on and off or hitting a
 * wall, a scuff for each kick, a whoosh for each trick and a thud on landing. Off along with the
 * music (M); on the Effects volume.
 */
export class SkateSounds {
	private noise: AudioBuffer | null = null;
	private roll: Loop | null = null;
	private whirr: Loop | null = null;
	private scrape: Loop | null = null;
	private roar: Loop | null = null;
	private spray: Loop | null = null;
	/** What the walker was doing last frame, to hear what changed. */
	private was = { on: false, state: '', wall: false, kicking: false, nitro: false, trick: '', grab: false, fallen: false };

	constructor(private readonly music: MusicPlayer) {}

	/** Call every frame with the walker: the loops follow it, and what it has started doing sounds. */
	update(dt: number, walker: WalkControls): void {
		const context = audioContext();
		const on = walker.active && walker.skating && this.music.enabled;
		const now = { on, state: walker.state, wall: walker.wall !== null, kicking: walker.kickTime > 0, nitro: walker.nitroTime > 0, trick: walker.trick ?? '', grab: walker.grab, fallen: walker.fallenTime > 0 };
		const was = this.was;
		this.was = now;
		if (!context || context.state !== 'running') return;
		// Falling off the board: the body hitting the ground, and the board clattering away.
		if (now.fallen && !was.fallen && this.music.enabled) {
			const hit = HIT_VOLUME * volume('effects');
			this.land(context, hit);
			this.clack(context, hit * 0.8);
			this.burst(context, 'lowpass', 900, 0.8, 0.002, 0.25, hit * 0.6);
		}
		if (on && !this.roll) this.startLoops(context);
		if (!this.roll) return;
		const level = on ? volume('effects') : 0;
		const speed = Math.abs(walker.boardSpeed);
		const rolling = on && walker.state === 'ground' && !walker.onWater && speed > 0.2 ? Math.min(1, speed / FULL_ROLL) : 0;
		// Surfing: water hissing past instead of wheels.
		const spraying = on && walker.onWater ? Math.min(1, speed / FULL_ROLL) : 0;
		const t = context.currentTime;
		this.roll.gain.gain.setTargetAtTime(ROLL_VOLUME * level * Math.sqrt(rolling), t, SMOOTH);
		this.roll.filter.frequency.setTargetAtTime(150 + speed * 25, t, SMOOTH);
		this.whirr!.gain.gain.setTargetAtTime(WHIRR_VOLUME * level * rolling * rolling, t, SMOOTH);
		this.whirr!.filter.frequency.setTargetAtTime(1200 + speed * 60, t, SMOOTH);
		const scraping = on && now.wall ? Math.min(1, 0.4 + Math.abs(walker.velocity.y) / 10) : 0;
		this.scrape!.gain.gain.setTargetAtTime(SCRAPE_VOLUME * level * scraping, t, SMOOTH);
		// Nitro: a flame roaring, rising with the speed.
		const roaring = on && now.nitro ? 1 : 0;
		this.roar!.gain.gain.setTargetAtTime(ROAR_VOLUME * level * roaring, t, roaring ? SMOOTH : 0.3);
		this.roar!.filter.frequency.setTargetAtTime(300 + speed * 20, t, SMOOTH);
		this.spray!.gain.gain.setTargetAtTime(SPRAY_VOLUME * level * spraying, t, SMOOTH);
		this.spray!.filter.frequency.setTargetAtTime(700 + speed * 40, t, SMOOTH);
		if (!on && !was.on) return;

		const hit = HIT_VOLUME * volume('effects');
		if (on !== was.on) this.clack(context, hit * 0.7);
		if (!on) return;
		if (rolling && Math.random() < speed * CRACKS_PER_YARD * dt) this.burst(context, 'bandpass', 900 + Math.random() * 600, 4, 0.002, 0.03, hit * 0.25 * rolling);
		if (now.state === 'air' && was.state === 'ground' && walker.jumped) this.pop(context, hit);
		if (now.wall && !was.wall) this.clack(context, hit);
		if (now.state === 'ground' && was.state === 'air') {
			// Harder the faster it came down (the climb it lands with), and off a wall as from a drop.
			const impact = was.wall ? 0.7 : Math.min(1, 0.15 + Math.max(0, -walker.climb) / 12);
			this.land(context, hit * impact);
		}
		if (now.kicking && !was.kicking) this.burst(context, 'bandpass', 450, 1.5, 0.02, 0.14, hit * 0.4);
		if (now.trick && now.trick !== was.trick) this.whoosh(context, hit * 0.35);
		if (now.grab && !was.grab) this.whoosh(context, hit * 0.4);
		if (now.nitro && !was.nitro) {
			// Lit: a deep boom and a rush of air.
			this.thump(context, 70, 25, 0.6, hit);
			this.whoosh(context, hit * 0.8);
		}
	}

	/**
	 * Those taken down cry out as they die in the game: one of each one's death sounds, a moment
	 * apart, the same kind of creature not twice (a crowd of murlocs is one gurgle, not ten).
	 */
	deaths(sounds: number[][]): void {
		if (!this.music.enabled) return;
		const kinds = new Set<string>();
		let n = 0;
		for (const files of sounds) {
			if (!files.length || n >= MAX_DEATHS) continue;
			const kind = files.join(',');
			if (kinds.has(kind)) continue;
			kinds.add(kind);
			this.playFile(files[Math.floor(Math.random() * files.length)], DEATH_VOLUME, n++ * DEATH_STAGGER);
		}
	}

	/** One of the game's sound files, after delay (s). */
	private playFile(file: number, loudness: number, delay = 0): void {
		this.music.soundUrl(file, true).then((url) => {
			const audio = newAudio(url);
			setLevel(audio, loudness * volume('effects'));
			setTimeout(() => void audio.play().catch(() => {}), delay * 1000);
		}, (e) => console.warn(`Sound ${file} unavailable:`, e));
	}

	/** A takedown's burst of speed catching fire: the fire mage's Heating Up, one of its three at random. */
	heatUp(): void {
		if (!this.music.enabled) return;
		this.playFile(HEAT_UP_SOUNDS[Math.floor(Math.random() * HEAT_UP_SOUNDS.length)], HEAT_UP_VOLUME);
	}

	/** The mega jump charging over so long (s): a whine rising to a scream, over a swelling rush. */
	charge(time: number): void {
		const context = audioContext();
		if (!context || context.state !== 'running' || !this.music.enabled) return;
		const level = HIT_VOLUME * volume('effects');
		const t = context.currentTime;
		const tone = context.createOscillator();
		tone.type = 'sawtooth';
		tone.frequency.setValueAtTime(180, t);
		tone.frequency.exponentialRampToValueAtTime(1400, t + time);
		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(600, t);
		filter.frequency.exponentialRampToValueAtTime(4000, t + time);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(level * 0.25, t + time);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + time + 0.08);
		tone.connect(filter).connect(gain).connect(context.destination);
		tone.start(t);
		tone.stop(t + time + 0.1);
		this.whoosh(context, level * 0.4);
	}

	/** Something ridden into gave something: a bright two-note chime, and a splash for surfing. */
	pickup(splash: boolean): void {
		const context = audioContext();
		if (!context || context.state !== 'running' || !this.music.enabled) return;
		const level = HIT_VOLUME * volume('effects') * 0.35;
		const t = context.currentTime;
		for (const [frequency, at] of [[880, 0], [1320, 0.09]]) {
			const tone = context.createOscillator();
			tone.frequency.value = frequency;
			const gain = context.createGain();
			gain.gain.setValueAtTime(0.0001, t + at);
			gain.gain.exponentialRampToValueAtTime(level, t + at + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
			tone.connect(gain).connect(context.destination);
			tone.start(t + at);
			tone.stop(t + at + 0.4);
		}
		if (splash) this.burst(context, 'lowpass', 1200, 0.7, 0.01, 0.5, level * 2);
		else this.whoosh(context, level * 1.5);
	}

	/** Time Attack: a short beep for each count, a high long one to start, and a horn at time up. */
	cue(cue: 'count' | 'go' | 'end'): void {
		const context = audioContext();
		if (!context || context.state !== 'running' || !this.music.enabled) return;
		const level = HIT_VOLUME * volume('effects') * 0.3;
		const t = context.currentTime;
		const tones: [number, number, OscillatorType][] = cue === 'count' ? [[660, 0.15, 'square']] : cue === 'go' ? [[1320, 0.45, 'square']] : [[440, 0.9, 'sawtooth'], [554, 0.9, 'sawtooth']];
		for (const [frequency, length, type] of tones) {
			const tone = context.createOscillator();
			tone.type = type;
			tone.frequency.value = frequency;
			const filter = context.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 2400;
			const gain = context.createGain();
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
			gain.gain.setValueAtTime(level, t + length * 0.8);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
			tone.connect(filter).connect(gain).connect(context.destination);
			tone.start(t);
			tone.stop(t + length + 0.05);
		}
	}

	/** The mega jump going off: a deep boom, the pop, and a rush of air. */
	megaJump(): void {
		const context = audioContext();
		if (!context || context.state !== 'running' || !this.music.enabled) return;
		const level = HIT_VOLUME * volume('effects');
		this.thump(context, 90, 28, 0.7, level * 1.2);
		this.pop(context, level);
		this.whoosh(context, level * 0.8);
	}

	/** A takedown: a crunch for each one hit, close together, over a heavy knock; more for more. */
	crash(count: number): void {
		const context = audioContext();
		if (!context || context.state !== 'running' || !this.music.enabled) return;
		const level = HIT_VOLUME * volume('effects');
		this.thump(context, 90, 30, 0.4, level * Math.min(1.4, 0.8 + count * 0.1));
		for (let i = 0; i < Math.min(count, 8); i++) {
			const delay = i * 0.07 + Math.random() * 0.03;
			this.burst(context, 'lowpass', 900 + Math.random() * 500, 0.8, 0.002, 0.18, level * 0.8, delay);
			this.thump(context, 160 + Math.random() * 60, 50, 0.15, level * 0.6, delay);
		}
	}

	private startLoops(context: AudioContext): void {
		// Two seconds of white noise, looped, feeds every sound.
		const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
		const samples = noise.getChannelData(0);
		for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
		this.noise = noise;
		const loop = (type: BiquadFilterType, frequency: number, q: number): Loop => {
			const source = context.createBufferSource();
			source.buffer = noise;
			source.loop = true;
			// Each from a different place in the noise, so they don't sound alike.
			const filter = context.createBiquadFilter();
			filter.type = type;
			filter.frequency.value = frequency;
			filter.Q.value = q;
			const gain = context.createGain();
			gain.gain.value = 0;
			source.connect(filter).connect(gain).connect(context.destination);
			source.start(0, Math.random() * 2);
			return { filter, gain };
		};
		this.roll = loop('lowpass', 300, 0.7);
		this.whirr = loop('bandpass', 1500, 2);
		this.scrape = loop('bandpass', 2600, 3);
		this.roar = loop('lowpass', 500, 1.5);
		this.spray = loop('bandpass', 1000, 0.6);
	}

	/** A burst of filtered noise: rising over attack, dying away over decay (s), after delay (s). */
	private burst(context: AudioContext, type: BiquadFilterType, frequency: number, q: number, attack: number, decay: number, level: number, delay = 0): void {
		if (!this.noise || level < 0.003) return;
		const t = context.currentTime + delay;
		const source = context.createBufferSource();
		source.buffer = this.noise;
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = frequency;
		filter.Q.value = q;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(level, t + attack);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
		source.connect(filter).connect(gain).connect(context.destination);
		source.start(t, Math.random() * 1.5);
		source.stop(t + attack + decay + 0.05);
	}

	/** A low knock: a tone sweeping down from one pitch to another as it dies away, after delay (s). */
	private thump(context: AudioContext, from: number, to: number, decay: number, level: number, delay = 0): void {
		if (level < 0.003) return;
		const t = context.currentTime + delay;
		const tone = context.createOscillator();
		tone.frequency.setValueAtTime(from, t);
		tone.frequency.exponentialRampToValueAtTime(to, t + decay);
		const gain = context.createGain();
		gain.gain.setValueAtTime(level, t);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
		tone.connect(gain).connect(context.destination);
		tone.start(t);
		tone.stop(t + decay + 0.05);
	}

	/** The tail snapping on the ground: a sharp crack over a knock. */
	private pop(context: AudioContext, level: number): void {
		this.burst(context, 'highpass', 1800, 0.7, 0.001, 0.05, level * 0.8);
		this.thump(context, 180, 60, 0.09, level * 0.7);
	}

	/** Wood on something hard. */
	private clack(context: AudioContext, level: number): void {
		this.burst(context, 'bandpass', 1100, 2, 0.001, 0.06, level * 0.7);
		this.thump(context, 260, 120, 0.06, level * 0.4);
	}

	/** All four wheels coming down: a heavy thud and the deck's clack. */
	private land(context: AudioContext, level: number): void {
		this.thump(context, 110, 40, 0.18, level);
		this.burst(context, 'bandpass', 800, 1.5, 0.001, 0.08, level * 0.6);
	}

	/** The board spinning through the air. */
	private whoosh(context: AudioContext, level: number): void {
		if (!this.noise) return;
		const t = context.currentTime;
		const source = context.createBufferSource();
		source.buffer = this.noise;
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.Q.value = 3;
		filter.frequency.setValueAtTime(500, t);
		filter.frequency.exponentialRampToValueAtTime(2200, t + 0.25);
		filter.frequency.exponentialRampToValueAtTime(700, t + 0.5);
		const gain = context.createGain();
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(level, t + 0.2);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
		source.connect(filter).connect(gain).connect(context.destination);
		source.start(t, Math.random() * 1.4);
		source.stop(t + 0.55);
	}
}
