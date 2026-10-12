import { expect, test } from 'bun:test';
import type { SessionSnapshot, ViewerSession } from '../src/viewer/session';

test('real switch host commits, caches, rejects repeats, and rolls back failed or canceled loads', async () => {
	const names = ['window', 'document', 'location', 'history'] as const;
	const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	const children: NodeStub[] = [];
	let focused = 0;
	const focusOrder: string[] = [];
	let pageFocused = true;
	class NodeStub extends EventTarget {
		id = '';
		textContent = '';
		hidden = false;
		inert = false;
		style: Record<string, string> = {};
		attributes: Record<string, string> = {};
		nodes: NodeStub[] = [];
		contentWindow = { focus: () => { focused++; focusOrder.push('child'); }, location: {hash: ''} } as unknown as Window;
		constructor(readonly tag: string) { super(); }
		setAttribute(k: string, v: string) { this.attributes[k] = v; }
		removeAttribute(k: string) { if (k === 'id') this.id = ''; delete this.attributes[k]; }
		append(...nodes: NodeStub[]) { this.nodes.push(...nodes); }
		prepend(node: NodeStub) { children.unshift(node); }
		replaceChildren(...nodes: NodeStub[]) { children.splice(0, children.length, ...nodes); }
		remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); }
		focus() { focused++; }
	}
	const fakeWindow = Object.assign(new EventTarget(), {parent: null as unknown, setTimeout: () => 1, focus: () => { focused++; focusOrder.push('host'); }});
	fakeWindow.parent = fakeWindow;
	Object.assign(globalThis, {
		window: fakeWindow,
		document: Object.assign(new EventTarget(), {createElement: (tag: string) => new NodeStub(tag), body: new NodeStub('body'), hasFocus: () => pageFocused}),
		location: {href: 'http://localhost:5173/', hash: ''},
		history: {replaceState() {}},
	});
	try {
		await import('../src/viewer/entry');
		const host = window.mapExplorerHost!;
		const frames = () => children.filter(node => node.tag === 'iframe');
		const active = () => frames().find(node => node.id === 'active-viewer')!;
		const snapshot = {
			camera: {mapId: 0, position: [10.123, 200.456, 30.789], yaw: 0.12345, pitch: -0.98765},
			settings: {}, time: 500, sound: true, fly: {lookYaw: 0, lookPitch: 0, zoomVelocity: 0}, walking: null,
		} as SessionSnapshot;
		let pauses = 0, activations = 0, prepares = 0;
		let resumed: string[] = [];
		const delivered: string[] = [];
		const session = (product: string): ViewerSession => ({
			source: {kind: 'http', base: 'http://localhost:5173/__wow/'},
			product,
			products: ['wow_classic', 'wow_classic_beta', 'wow_classic_era', 'wow'].map(p => ({product:p,version:'test',branch:'',active:true,buildKey:'',cdnKey:''})),
			snapshot: () => structuredClone(snapshot),
			pause: () => { pauses++; },
			activate: input => { activations++; resumed = [...(input?.keys ?? [])]; },
			event: event => { delivered.push(event.type); },
			prepare: async state => { prepares++; expect(state.camera).toEqual(snapshot.camera); },
		});
		const forever = session('wow_classic_beta');
		const first = active();
		host.ready(first.contentWindow, forever);
		expect(activations).toBe(1);
		host.switchProduct(first.contentWindow, 'wow_classic_beta');
		expect(frames()).toHaveLength(1);
		host.switchProduct(first.contentWindow, 'missing');
		expect(frames()).toHaveLength(1);
		expect(children.find(n=>n.id==='game-switch-status')!.nodes[0].textContent).toContain('not installed');
		host.switchProduct(first.contentWindow, 'wow_classic');
		const loading = frames().find(f => f !== first)!;
		expect(host.request(loading.contentWindow)?.snapshot.camera).toEqual(snapshot.camera);
		host.switchProduct(first.contentWindow, 'wow_classic');
		expect(frames()).toHaveLength(2);
		host.failed(loading.contentWindow, 'Unreadable game files.');
		expect(frames()).toHaveLength(1);
		expect(active()).toBe(first);
		expect(first.inert).toBe(false);

		// A late ready from an abandoned page cannot replace the active scene.
		host.ready(loading.contentWindow, session('wow_classic'));
		expect(active()).toBe(first);
		host.input(first.contentWindow, {type: 'keydown', code: 'KeyW'} as KeyboardEvent);
		host.input(first.contentWindow, {type: 'keydown', code: 'ShiftLeft'} as KeyboardEvent);
		host.switchProduct(first.contentWindow, 'wow_classic');
		// A release while loading must not become a stuck boost in the new viewer.
		host.input(first.contentWindow, {type: 'keyup', code: 'ShiftLeft'} as KeyboardEvent);
		const classicPage = frames().find(f => f !== first)!;
		const classic = session('wow_classic');
		host.ready(classicPage.contentWindow, classic);
		expect(active()).toBe(classicPage);
		expect(resumed).toEqual(['KeyW']);
		expect(first.style.visibility).toBe('hidden');
		expect(frames()).toHaveLength(2);
		host.switchProduct(classicPage.contentWindow, 'wow_classic_beta');
		await Promise.resolve();
		expect(active()).toBe(first);
		expect(prepares).toBe(1);
		expect(resumed).toEqual(['KeyW']);
		host.input(first.contentWindow, {type: 'keyup', code: 'KeyW'} as KeyboardEvent);
		expect(frames()).toHaveLength(2);

		// Failed cached preparation preserves the scene and discards the damaged cache.
		classic.prepare = async () => { throw new Error('Location unavailable'); };
		host.switchProduct(first.contentWindow, 'wow_classic');
		await Promise.resolve();
		expect(active()).toBe(first);
		expect(frames()).toHaveLength(1);
		expect(children.find(n=>n.id==='game-switch-status')!.nodes[0].textContent).toContain('current scene has been kept');
		expect(resumed).toEqual([]);

		host.switchProduct(first.contentWindow, 'wow_classic');
		const cancelled = frames().find(f => f !== first)!;
		children.find(n=>n.id==='game-switch-status')!.nodes[1].dispatchEvent(new Event('click'));
		host.ready(cancelled.contentWindow, classic);
		expect(active()).toBe(first);
		expect(frames()).toHaveLength(1);
		// Capture is requested on the native viewer canvas, without shifting document focus.
		const doc = { defaultView: first.contentWindow, pointerLockElement: null as unknown,
			exitPointerLock: () => { doc.pointerLockElement = null; host.captureChanged(first.contentWindow, 'pointerlockchange'); } };
		const canvas = {ownerDocument: doc, requestPointerLock: async () => { doc.pointerLockElement = canvas; }} as unknown as HTMLElement;
		const focusBefore = focused;
		await host.lock(first.contentWindow, canvas, false);
		expect(focused).toBe(focusBefore);
		expect(host.locked(first.contentWindow)).toBe(true);
		expect(host.captureChanged(first.contentWindow, 'pointerlockchange')).toBe(true);
		host.unlock(cancelled.contentWindow);
		expect(host.locked(first.contentWindow)).toBe(true);
		expect(host.input(first.contentWindow, {type:'mousemove',movementX:12} as MouseEvent)).toBe(true);
		host.input(first.contentWindow, {type:'keydown',code:'KeyW'} as KeyboardEvent);
		host.switchProduct(first.contentWindow, 'wow_classic');
		expect(host.input(first.contentWindow, {type:'keyup',code:'KeyW'} as KeyboardEvent)).toBe(false);
		host.unlock(first.contentWindow);
		expect(host.locked(first.contentWindow)).toBe(true); // The swap cannot release capture.
		children.find(n=>n.id==='game-switch-status')!.nodes[1].dispatchEvent(new Event('click'));
		expect(resumed).toEqual([]);
		expect(host.locked(first.contentWindow)).toBe(true);
		host.unlock(first.contentWindow);
		expect(host.locked(first.contentWindow)).toBe(false);
		host.input(first.contentWindow, {type: 'keydown', code: 'KeyW'} as KeyboardEvent);
		pageFocused = false;
		host.blur(first.contentWindow);
		await new Promise(resolve => setTimeout(resolve, 0));
		pageFocused = true;
		host.switchProduct(first.contentWindow, 'wow_classic');
		children.find(n=>n.id==='game-switch-status')!.nodes[1].dispatchEvent(new Event('click'));
		expect(resumed).toEqual([]); // Releasing W while outside the browser cannot resurrect it.
		expect(pauses).toBe(7);
		expect(focused).toBeGreaterThan(0);

		// Preserve the original native capture across switches, forwarding once to the new scene.
		await host.lock(first.contentWindow, canvas, false);
		host.switchProduct(first.contentWindow, 'wow_classic_era');
		const eraPage = frames().find(f => f !== first)!;
		host.ready(eraPage.contentWindow, session('wow_classic_era'));
		expect(first.style.visibility).toBe('visible'); // Behind the new frame; hiding it can drop capture.
		expect(first.style.zIndex).toBe('0');
		expect(eraPage.style.zIndex).toBe('1');
		expect(host.locked(eraPage.contentWindow)).toBe(true);
		const count = delivered.length;
		expect(host.input(first.contentWindow, {type:'mousemove',movementX:20} as MouseEvent)).toBe(false);
		expect(delivered.slice(count)).toEqual(['mousemove']);
		expect(host.input(cancelled.contentWindow, {type:'mousemove'} as MouseEvent)).toBe(false);
		expect(delivered.length).toBe(count + 1);
		host.switchProduct(eraPage.contentWindow, 'wow');
		const retailPage = frames().find(f => f !== first && f !== eraPage)!;
		host.ready(retailPage.contentWindow, session('wow'));
		expect(frames()).toHaveLength(3);
		// A fourth game evicts the oldest inactive scene that does not own capture.
		host.switchProduct(retailPage.contentWindow, 'wow_classic');
		const mopPage = frames().find(f => ![first, eraPage, retailPage].includes(f))!;
		host.ready(mopPage.contentWindow, session('wow_classic'));
		expect(frames()).toHaveLength(3);
		expect(frames()).not.toContain(eraPage);
		expect(frames()).toContain(first);
		expect(host.locked(mopPage.contentWindow)).toBe(true);
		host.switchProduct(mopPage.contentWindow, 'wow_classic_beta');
		await Promise.resolve();
		expect(active()).toBe(first);
		host.switchProduct(first.contentWindow, 'wow');
		await Promise.resolve();
		expect(active()).toBe(retailPage);
		host.unlock(retailPage.contentWindow);
		expect(host.locked(retailPage.contentWindow)).toBe(false);
		expect(first.style.visibility).toBe('hidden');
		expect(first.inert).toBe(true);
	} finally {
		names.forEach((name, i) => {
			if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
});
