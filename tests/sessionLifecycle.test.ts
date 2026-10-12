import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { runInNewContext } from 'node:vm';
import { gameShortcutIndex } from '../src/viewer/gameVersion';
import { WalkControls, type WalkWorld } from '../src/viewer/walkControls';
import { FlyControls } from '../src/viewer/flyControls';

const names = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Audio'] as const;
const cursorClasses = new Set<string>();
const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
class Element extends EventTarget { isContentEditable = false; requestPointerLock() { return Promise.resolve(); } }
class AudioStub extends EventTarget {
	volume = 1;
	muted = false;
	ended = false;
	loop = false;
	pause() {}
	removeAttribute() {}
}
beforeAll(() => {
	Object.assign(globalThis, {
		window: new EventTarget(), document: Object.assign(new EventTarget(), {documentElement: {classList: {add: (name: string) => cursorClasses.add(name), remove: (name: string) => cursorClasses.delete(name)}}}),
		HTMLElement: Element, HTMLInputElement: class extends Element {},
		HTMLSelectElement: class extends Element {}, HTMLTextAreaElement: class extends Element {},
		Audio: AudioStub,
	});
});
afterAll(() => names.forEach((name, i) => {
	if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!);
	else Reflect.deleteProperty(globalThis, name);
}));

describe('cached viewer lifecycle', () => {
	test('walking destination waits for local floors and WMO doodads, not distant tiles or NPCs', async () => {
		const { ObjectManager } = await import('../src/viewer/objects');
		type ModelData = import('../src/explorer/objects').ModelData;
		type Placement = import('../src/explorer/objects').Placement;
		const deferred = <T>() => {
			let resolve!: (value: T) => void;
			const promise = new Promise<T>(done => { resolve = done; });
			return { promise, resolve };
		};
		const local = deferred<Placement[]>();
		const distant = deferred<Placement[]>();
		const building = deferred<(ModelData | null)[]>();
		const doodad = deferred<(ModelData | null)[]>();
		const matrix = new Float32Array(new THREE.Matrix4().toArray());
		const placement = (kind: Placement['kind'], fdid: number): Placement => ({kind, fdid, uid: fdid, matrix, doodadSet: 0});
		const requests: number[][] = [];
		const objects = new ObjectManager({
			loadTileObjects: (_wdt: number, x: number) => x === 0 ? local.promise : x === 1 ? Promise.resolve([placement('creature', 40)]) : distant.promise,
			loadModels: (batch: {fdid: number}[]) => {
				requests.push(batch.map(m => m.fdid));
				return batch.some(m => m.fdid === 10) ? building.promise : doodad.promise;
			},
		} as unknown as import('../src/worker/protocol').AsyncStorageApi, false, 1, async () => {});
		const settle = () => new Promise(resolve => setTimeout(resolve, 0));
		const update = () => objects.update(performance.now(), new THREE.Vector3());
		objects.setTileLevel('1:0_0', 1, 0, 0, new THREE.Vector3(), 'all');
		objects.setTileLevel('1:8_8', 1, 8, 8, new THREE.Vector3(), 'wmo');
		expect(objects.collisionReady('1:0_0')).toBe(false);
		local.resolve([placement('wmo', 10), placement('creature', 20)]);
		await settle();
		expect(objects.collisionReady('1:0_0')).toBe(false);
		update();
		const model: ModelData = {
			fdid: 10,
			positions: new Float32Array([0,0,0, 1,0,0, 0,0,1]), normals: new Float32Array(9), uvs: new Float32Array(6),
			indices: new Uint32Array([0,1,2]), baked: null, radius: 1, height: 1,
			batches: [{start: 0, count: 3, order: 0, material: {texture: 0, blend: 0, twoSided: false, unlit: false, unfogged: false, opacity: 1}}],
			doodadSets: [{name: 'floor props', doodads: [{fdid: 30, matrix}]}],
		};
		building.resolve([model, null]);
		await settle();
		update();
		expect(requests).toEqual([[10,20], [30]]);
		expect(objects.collisionReady('1:0_0')).toBe(false); // Building ready, interior prop still loading.
		doodad.resolve([{...model, doodadSets: undefined}]);
		await settle();
		update();
		expect(objects.pending).toBeGreaterThan(0); // Distant tile has not even returned placements.
		expect(objects.collisionReady('1:0_0')).toBe(true);
		// Queued NPCs are not potential floors, even in the destination tile.
		objects.setTileLevel('1:1_0', 1, 1, 0, new THREE.Vector3(), 'all');
		await settle();
		expect(objects.collisionReady('1:1_0')).toBe(true);
		// A tile which has not requested full object detail cannot yet prove its floor is ready.
		objects.setTileLevel('1:0_0', 1, 0, 0, new THREE.Vector3(), 'wmo');
		expect(objects.collisionReady('1:0_0')).toBe(false);
		objects.setTileLevel('1:0_0', 1, 0, 0, new THREE.Vector3(), 'all');
		expect(objects.collisionReady('1:0_0')).toBe(true);
	});

	test('game shortcut ignores repeats, modifiers and editable fields', () => {
		const key = (overrides: Partial<KeyboardEvent> = {}) => ({ code: 'Digit2', repeat: false, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: null, ...overrides } as KeyboardEvent);
		expect(gameShortcutIndex(key())).toBe(1);
		expect(gameShortcutIndex(key({ctrlKey: false}))).toBeNull();
		for (const flag of ['repeat', 'metaKey', 'altKey', 'shiftKey']) {
			expect(gameShortcutIndex(key({[flag]: true}))).toBeNull();
		}
		for (const target of [new HTMLInputElement(), new HTMLTextAreaElement(), new HTMLSelectElement(), Object.assign(new HTMLElement(), {isContentEditable: true})]) {
			expect(gameShortcutIndex(key({target}))).toBeNull();
		}
		expect(gameShortcutIndex(key({code: 'BracketLeft'}))).toBeNull();
		expect(gameShortcutIndex(key({code: 'Digit1'}))).toBe(0);
		expect(gameShortcutIndex(key({code: 'Digit0'}))).toBe(9);
		expect(gameShortcutIndex(key({code: 'F8'}))).toBeNull();
	});

	test('walking hides cursor during right-button capture and left drag, then restores it on release or blur', () => {
		const element = new Element();
		const walk = new WalkControls(new THREE.PerspectiveCamera(), element as unknown as HTMLElement);
		const mouse = (type: string, button: number, buttons: number, movementX = 0) => Object.assign(new Event(type), {button, buttons, movementX, movementY: 0});
		walk.start();
		element.dispatchEvent(mouse('mousedown', 2, 2));
		expect(cursorClasses.has('turning-camera')).toBe(true);
		window.dispatchEvent(mouse('mouseup', 2, 0));
		expect(cursorClasses.has('turning-camera')).toBe(false);
		element.dispatchEvent(mouse('mousedown', 0, 1));
		expect(cursorClasses.has('turning-camera')).toBe(false);
		document.dispatchEvent(mouse('mousemove', 0, 1, 20));
		expect(cursorClasses.has('turning-camera')).toBe(true);
		window.dispatchEvent(new Event('blur'));
		expect(cursorClasses.has('turning-camera')).toBe(false);
		walk.stop();
	});

	test('refused pointer capture leaves walking mouse movement usable and retries only on another press', async () => {
		const element = new Element();
		let requests = 0;
		element.requestPointerLock = () => { requests++; return Promise.reject(new Error('capture unavailable')); };
		const walk = new WalkControls(new THREE.PerspectiveCamera(), element as unknown as HTMLElement);
		const mouse = (type: string, button: number, buttons: number, movementX = 0) => Object.assign(new Event(type), {button, buttons, movementX, movementY: 0});
		walk.start();
		element.dispatchEvent(mouse('mousedown', 2, 2));
		await Promise.resolve();
		const facing = walk.facing;
		for (let i = 0; i < 5; i++) document.dispatchEvent(mouse('mousemove', 2, 2, 20));
		expect(walk.facing).not.toBe(facing);
		expect(requests).toBe(1);
		window.dispatchEvent(mouse('mouseup', 2, 0));
		expect(cursorClasses.has('turning-camera')).toBe(false);
		element.dispatchEvent(mouse('mousedown', 2, 2));
		expect(requests).toBe(2);
		await Promise.resolve();
		walk.stop();
	});

	test('restored camera stays exact across frames despite changed terrain and walls', () => {
		const camera = new THREE.PerspectiveCamera();
		const controls = new FlyControls(camera, new Element() as unknown as HTMLElement);
		const position = new THREE.Vector3(12.123456789, 1, 34.987654321);
		controls.collide = () => new THREE.Vector3(99, 99, 99);
		controls.set(position, 0.987654321, -0.123456789, true);
		const quaternion = camera.quaternion.clone();
		for (let i = 0; i < 120; i++) controls.update(1 / 60, () => 1, () => 1);
		expect(camera.position.toArray()).toEqual(position.toArray());
		expect(camera.quaternion.toArray()).toEqual(quaternion.toArray());
		controls.flyTo(new THREE.Vector3(30, 50, 60), 0, 0, 1);
		controls.update(1, () => 0);
		expect(camera.position.toArray()).toEqual([30, 50, 60]);
	});
	test('walking takeover cannot clear the incoming exact-position hold', () => {
		const camera = new THREE.PerspectiveCamera();
		const controls = new FlyControls(camera, new Element() as unknown as HTMLElement);
		controls.onTakeOver = () => { controls.onTakeOver = null; controls.set(new THREE.Vector3(), 0, 0); };
		controls.set(new THREE.Vector3(2, 1, 3), 0.2, -0.3, true);
		controls.update(0.1, () => 1, () => 1);
		expect(camera.position.toArray()).toEqual([2, 1, 3]);
	});
	test('raw pointer capture rejection from the host realm falls back to normal capture', async () => {
		const parent = window.parent;
		const requests: boolean[] = [];
		Object.assign(window, {parent: {mapExplorerHost: {
			locked: () => false,
			lock: (_child: Window, _element: HTMLElement, raw: boolean) => {
				requests.push(raw);
				return raw ? runInNewContext('Promise.reject(new Error("raw input unavailable"))') : Promise.resolve();
			},
		}}});
		try {
			new FlyControls(new THREE.PerspectiveCamera(), new Element() as unknown as HTMLElement).lock();
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(requests).toEqual([true, false]);
		} finally { Object.assign(window, {parent}); }
	});

	test('held flight input continues immediately after a camera transfer and stops on release', () => {
		const camera = new THREE.PerspectiveCamera();
		const controls = new FlyControls(camera, new Element() as unknown as HTMLElement);
		controls.smartSpeed = false;
		controls.set(new THREE.Vector3(0, 100, 0), 0, 0, true);
		controls.enabled = false;
		controls.enabled = true;
		controls.resumeInput({keys: ['KeyW', 'ShiftLeft'], buttons: 0});
		controls.update(0.1, () => 0);
		expect(camera.position.z).toBeLessThan(0);
		const stopped = camera.position.clone();
		controls.resumeInput({keys: [], buttons: 0});
		controls.update(0.1, () => 0);
		expect(camera.position.toArray()).toEqual(stopped.toArray());
	});

	const walking = (height: number) => {
		const camera = new THREE.PerspectiveCamera();
		const walk = new WalkControls(camera, new Element() as unknown as HTMLElement);
		walk.world = { terrain: () => height, surface: () => height, ready: () => true,
			nearBuilding: () => false, cast: () => null, sweep: (_from, move) => move,
			pushOut: () => new THREE.Vector3(), liquid: () => null } satisfies WalkWorld;
		return { walk, camera };
	};

	test('walking preserves feet, facing, orbit, zoom and slow walk across repeated flips', () => {
		const {walk} = walking(10);
		walk.place(new THREE.Vector3(12, 10, 34), 0.3, -0.4);
		const snapshot = { ...walk.captureState(), orbit: 0.8, zoom: 5, zoomTarget: 6, distance: 4, walkMode: true };
		for (let i = 0; i < 5; i++) {
			expect(walk.restore(new THREE.Vector3(12, 10, 34), snapshot)).toBe(true);
			expect(walk.position.toArray()).toEqual([12, 10, 34]);
			expect(walk.captureState()).toEqual(snapshot);
		}
		walk.resumeInput({keys: ['KeyW'], buttons: 0});
		walk.update(0.1);
		expect(walk.position.distanceTo(new THREE.Vector3(12, 10, 34))).toBeCloseTo(0.25);
		const stopped = walk.position.clone();
		walk.resumeInput({keys: [], buttons: 0});
		walk.update(0.1);
		expect(walk.position.toArray()).toEqual(stopped.toArray());
	});

	test('held mouse buttons continue walking and release stops it', () => {
		const {walk} = walking(10);
		const snapshot = {...walk.captureState(), dragging: true, dragged: 10};
		expect(walk.restore(new THREE.Vector3(0, 10, 0), snapshot)).toBe(true);
		walk.resumeInput({keys: [], buttons: 3});
		walk.update(0.1);
		expect(walk.position.z).toBeCloseTo(-0.7);
		walk.resumeInput({keys: [], buttons: 0});
		walk.update(0.1);
		expect(walk.position.z).toBeCloseTo(-0.7);
		expect(walk.captureState().dragging).toBe(false);
	});

	test('existing floor wins over a roof, otherwise downward cast finds the raised floor', () => {
		const {walk} = walking(-Infinity);
		walk.world!.surface = () => 0;
		const tops: number[] = [];
		walk.world!.nearBuilding = () => true;
		walk.world!.cast = (from, direction, far) => {
			if (direction.y !== -1) return null;
			tops.push(from.y);
			const y = from.y > 30 ? 30 : 10;
			return from.y - y <= far ? {distance: from.y - y, normal: new THREE.Vector3(0, 1, 0), ground: 1} : null;
		};
		expect(walk.restore(new THREE.Vector3(12, 10, 34), walk.captureState())).toBe(true);
		expect(walk.position.y).toBe(10);
		expect(tops).toEqual([11]);
		tops.length = 0;
		expect(walk.restore(new THREE.Vector3(12, 20, 34), walk.captureState())).toBe(true);
		expect(walk.position.y).toBe(30);
		expect(tops).toEqual([21, 70]);
	});

	test('missing, steep and deep sea floors reject walking without moving the camera', () => {
		for (const kind of ['missing', 'steep', 'sea']) {
			const {walk, camera} = walking(kind === 'missing' ? -Infinity : 10);
			if (kind === 'steep') walk.world!.surface = x => x * 10;
			if (kind === 'sea') walk.world!.liquid = () => ({surface: 30, sea: true});
			const before = camera.position.toArray();
			expect(walk.restore(new THREE.Vector3(12, 10, 34), walk.captureState())).toBe(false);
			expect(walk.active).toBe(false);
			expect(camera.position.toArray()).toEqual(before);
		}
	});

	test('session suspension immediately mutes fallback audio and late sounds, without changing volume', async () => {
		const {newAudio, setAudioActive, setLevel, stopAudio} = await import('../src/viewer/audioOut');
		const audio = newAudio('test');
		setLevel(audio, 0.6);
		setAudioActive(false);
		expect(audio.muted).toBe(true);
		expect(audio.volume).toBe(0.6);
		const late = newAudio('late');
		setLevel(late, 0.8);
		expect(late.muted).toBe(true);
		setAudioActive(true);
		expect(audio.muted).toBe(false);
		expect(late.muted).toBe(false);
		expect(audio.volume).toBe(0.6);
		stopAudio(audio);
		stopAudio(late);
	});
});
