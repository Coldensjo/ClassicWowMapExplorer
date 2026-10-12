import type { ProductInfo } from '../casc/config';
import type { SourceInit } from '../worker/protocol';
import type { CameraView } from './gameVersion';
import type { FlyMotion } from './flyControls';
import type { WalkSnapshot } from './walkControls';
import type { CharacterLook } from './character';
import type { ViewSettings } from './viewer';

export interface HeldInput { keys: string[]; buttons: number }
export interface WalkingSnapshot { feet: CameraView; motion: WalkSnapshot; look: CharacterLook }
export interface SessionSnapshot {
	fly: FlyMotion;
	walking: WalkingSnapshot | null;
	camera: CameraView;
	settings: ViewSettings;
	time: number;
	sound: boolean | null;
}
export interface SessionRequest {
	source: SourceInit;
	product: string;
	snapshot: SessionSnapshot;
}
export interface ViewerSession {
	source: SourceInit;
	product: string;
	products: ProductInfo[];
	snapshot(): SessionSnapshot;
	pause(): void;
	prepare(snapshot: SessionSnapshot): Promise<void>;
	activate(input?: HeldInput): void;
	event(event: Event): void;
}
export interface SessionHost {
	input(child: Window, event: KeyboardEvent | MouseEvent): boolean;
	lock(child: Window, element: HTMLElement, raw: boolean): Promise<void> | void;
	unlock(child: Window): void;
	captureChanged(child: Window, type: string): boolean;
	locked(child: Window): boolean;
	focused(): boolean;
	blur(child: Window): void;
	request(child: Window): SessionRequest | undefined;
	ready(child: Window, session: ViewerSession): void;
	failed(child: Window, reason: string): void;
	progress(child: Window, message: string): void;
	switchProduct(child: Window, product: string): void;
	hash(child: Window, hash: string): void;
}

declare global {
	interface Window { mapExplorerHost?: SessionHost }
}

/** Only our own same-origin host is trusted to coordinate the sibling viewer pages. */
export function sessionHost(): SessionHost | undefined {
	try { return window.parent === window ? undefined : window.parent.mapExplorerHost; }
	catch { return undefined; }
}


/** Native capture stays in its viewer document; the host routes it to the active scene. */
export function pointerLocked(element?: HTMLElement): boolean {
	const host = sessionHost();
	return host ? host.locked(window) : !!document.pointerLockElement && (!element || document.pointerLockElement === element);
}
export function lockPointer(element: HTMLElement, raw = false): Promise<void> | void {
	const host = sessionHost();
	return host ? host.lock(window, element, raw) : element.requestPointerLock(raw ? { unadjustedMovement: true } : undefined);
}
export function unlockPointer(): void {
	const host = sessionHost();
	if (host) host.unlock(window);
	else document.exitPointerLock();
}
