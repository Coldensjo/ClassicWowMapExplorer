import type * as THREE from 'three';
import type { FootstepSounds } from '../explorer/clientDb';
import type { MusicPlayer } from './music';
import { volume } from './volume';

/** Yards from the camera within which footsteps are heard; they fade out toward it. */
export const FOOTSTEP_RANGE = 30;
/** Volume of a footstep right at the camera, at full setting. */
const STEP_VOLUME = 0.45;
/** At most this many footsteps sound at once (a crowd walking by), the rest skipped. */
const MAX_PLAYING = 8;
/** The ground sound group used where a kind of creature has nothing for the ground it's on: dirt. */
const FALLBACK_GROUP = 1;

/**
 * Footsteps, as the game plays them: the sound kit for the kind of creature (FootstepTerrainLookup)
 * and the ground under the foot (dirt, grass, stone, wood, snow...), or a splash in shallow water;
 * quieter with distance from the camera. Off along with the music (M); on the Effects volume.
 */
export class Footsteps {
	private playing = 0;

	constructor(
		private readonly music: MusicPlayer,
		private readonly sounds: FootstepSounds,
	) {}

	/** The ground sound group of a building material's TerrainType (0 when unknown). */
	groupOf(terrainType: number): number {
		return this.sounds.groups[terrainType] ?? 0;
	}

	/**
	 * A foot coming down at a point: kind is the creature's footstep kind, group the ground's sound
	 * group, splash for shallow water; heard from the camera at listener.
	 */
	step(at: THREE.Vector3, listener: THREE.Vector3, kind: number, group: number, splash: boolean, loudness = 1): void {
		if (!kind || !this.music.enabled || this.playing >= MAX_PLAYING) return;
		const distance = at.distanceTo(listener);
		if (distance >= FOOTSTEP_RANGE) return;
		const kit = this.sounds.kits[`${kind}:${group}`] ?? this.sounds.kits[`${kind}:${FALLBACK_GROUP}`];
		if (!kit) return;
		const files = splash && kit[1].length ? kit[1] : kit[0];
		const file = files[Math.floor(Math.random() * files.length)];
		const level = STEP_VOLUME * loudness * (1 - distance / FOOTSTEP_RANGE) ** 2 * volume('effects');
		if (!file || level < 0.005) return;
		void this.play(file, level);
	}

	private async play(file: number, level: number): Promise<void> {
		this.playing++;
		try {
			const url = await this.music.soundUrl(file, true);
			const audio = new Audio(url);
			audio.volume = Math.min(1, level);
			await new Promise<void>((resolve) => {
				audio.addEventListener('ended', () => resolve(), { once: true });
				audio.addEventListener('error', () => resolve(), { once: true });
				audio.play().catch(() => resolve());
			});
		} catch {
			// Unreadable: no step.
		} finally {
			this.playing--;
		}
	}
}
