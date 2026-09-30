/** Volume settings (0-1) the Sound panel sets and every sound reads, remembered between visits. */
export type VolumeChannel = 'master' | 'music' | 'ambience' | 'effects';

const STORAGE_KEY = 'mapExplorer.volume';

const levels: Record<VolumeChannel, number> = { master: 1, music: 1, ambience: 1, effects: 1 };

try {
	const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<VolumeChannel, unknown>>;
	for (const channel of Object.keys(levels) as VolumeChannel[]) {
		const value = saved[channel];
		if (typeof value === 'number' && value >= 0 && value <= 1) levels[channel] = value;
	}
} catch {
	// Storage blocked or unreadable: everything at full.
}

/** The channel's own setting, as the panel shows it. */
export function volumeSetting(channel: VolumeChannel): number {
	return levels[channel];
}

/** How loud a channel plays: its setting scaled by the master volume. */
export function volume(channel: Exclude<VolumeChannel, 'master'>): number {
	return levels[channel] * levels.master;
}

export function setVolume(channel: VolumeChannel, value: number): void {
	levels[channel] = Math.min(1, Math.max(0, value));
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
	} catch {
		// Not remembered; it still applies for this visit.
	}
}
