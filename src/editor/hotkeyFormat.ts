/**
 * How hotkeys are written in the panels: with Cmd (Mac) or Ctrl (Windows). The editor accepts
 * both keys whatever the format; this only changes what the hotkey lists and tooltips say.
 * Chosen in the scene control panel's menu (src/ui/specs/scene-control-panel.md §3) and
 * remembered in localStorage; until chosen, it follows the platform.
 */

export type HotkeyFormat = 'mac' | 'windows';

const STORAGE_KEY = 'foreverForge.hotkeyFormat';

/** The key name the rows use for the platform's command key; modKey() gives the current name. */
export const MOD_PLACEHOLDER = 'Mod';

let current: HotkeyFormat | null = null;
const listeners = new Set<(format: HotkeyFormat) => void>();

function stored(): HotkeyFormat | null {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return value === 'mac' || value === 'windows' ? value : null;
	} catch {
		return null;
	}
}

export function hotkeyFormat(): HotkeyFormat {
	if (!current) current = stored() ?? (/Mac|iPhone|iPad/i.test(navigator.platform) ? 'mac' : 'windows');
	return current;
}

export function setHotkeyFormat(format: HotkeyFormat): void {
	if (format === hotkeyFormat()) return;
	current = format;
	try {
		localStorage.setItem(STORAGE_KEY, format);
	} catch {
		// Private mode or full storage: the choice just isn't remembered.
	}
	for (const listener of listeners) listener(format);
}

/** Calls `listener` whenever the format changes; returns the unsubscribe. */
export function onHotkeyFormatChange(listener: (format: HotkeyFormat) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The command key as the current format names it. */
export function modKey(): 'Cmd' | 'Ctrl' {
	return hotkeyFormat() === 'mac' ? 'Cmd' : 'Ctrl';
}

/** Writes the command key into a chord, e.g. ["Mod", "Z"] → ["Cmd", "Z"]. */
export function resolveKeys(keys: string[]): string[] {
	return keys.map((key) => (key === MOD_PLACEHOLDER ? modKey() : key));
}
