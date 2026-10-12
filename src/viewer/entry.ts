import { productLabel } from './gameVersion';
import type { HeldInput, SessionRequest, ViewerSession } from './session';
import { sessionHost } from './session';

// A browsing context owns the renderer's module-level materials, audio, listeners and worker.
// Each product has its own cached context. Only the visible one runs animation frames.
// Failed loads are removed together with their worker and outstanding work.
if (sessionHost()) {
	void import('./main');
} else {
	const banner = document.createElement('div');
	banner.id = 'game-switch-status';
	banner.hidden = true;
	banner.setAttribute('role', 'status');
	banner.setAttribute('aria-live', 'polite');
	const message = document.createElement('span');
	const cancel = document.createElement('button');
	cancel.textContent = 'Cancel switch';
	banner.append(message, cancel);
	document.body.replaceChildren(banner);

	type Page = { frame: HTMLIFrameElement; session?: ViewerSession; request?: SessionRequest };
	let active: Page;
	let pending: Page | undefined;
	let timer = 0;
	const cached = new Map<string, Page>();
	let switchStarted = 0;
	const held: HeldInput = { keys: [], buttons: 0 };
	let capture: { child: Window; element: HTMLElement } | undefined;
	const captured = () => !!capture && capture.element.ownerDocument.pointerLockElement === capture.element;
	const ownsCapture = (page: Page) => captured() && capture!.child === page.frame.contentWindow;
	function track(event: KeyboardEvent | MouseEvent): void {
		if (event.type === 'keydown' && !held.keys.includes((event as KeyboardEvent).code)) held.keys.push((event as KeyboardEvent).code);
		if (event.type === 'keyup') held.keys = held.keys.filter(key => key !== (event as KeyboardEvent).code);
		if (event.type === 'mousedown' || event.type === 'mouseup') held.buttons = (event as MouseEvent).buttons;
	}
	// Releases can arrive at the loading banner. Captured viewer input is routed through input().
	for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'click', 'contextmenu']) {
		window.addEventListener(type, event => {
			track(event as KeyboardEvent | MouseEvent);
			if (captured()) {
				event.preventDefault();
				if (!pending) active.session?.event(event);
			}
		}, { passive: false });
	}
	function clearUnfocusedInput(): void {
		setTimeout(() => {
			if (!document.hasFocus()) {
				held.keys = []; held.buttons = 0;
				active.session?.event(new Event('blur'));
			}
		}, 0);
	}
	window.addEventListener('blur', clearUnfocusedInput);


	function createPage(request?: SessionRequest): Page {
		const frame = document.createElement('iframe');
		frame.className = 'game-viewer';
		frame.title = request ? productLabel(request.product) + ' Map Explorer' : 'Map Explorer';
		frame.allow = 'autoplay; fullscreen';
		frame.style.visibility = request ? 'hidden' : 'visible';
		frame.style.zIndex = request ? '0' : '1';
		frame.inert = !!request;
		const url = new URL(location.href);
		url.searchParams.set('viewer', '1');
		frame.src = url.href;
		const page = { frame, request };
		document.body.prepend(frame);
		return page;
	}
	function rollback(reason: string): void {
		if (!pending) return;
		const abandoned = pending;
		pending = undefined;
		clearTimeout(timer);
		abandoned.frame.remove();
		if (abandoned.session) cached.delete(abandoned.session.product);
		active.frame.inert = false;
		active.session?.activate(held);
		active.session?.event(new Event('pointerlockchange'));
		if (!captured()) active.frame.contentWindow?.focus();
		message.textContent = reason + ' Your current scene has been kept.';
		cancel.hidden = true;
		cancel.textContent = 'Cancel switch';
		banner.hidden = false;
	}
	cancel.addEventListener('click', () => rollback('Switch cancelled.'));
	window.mapExplorerHost = {
		input(child, event) {
			if (child !== active.frame.contentWindow && !(captured() && child === capture!.child)) return false;
			track(event);
			if (pending) return false;
			if (child === active.frame.contentWindow) return true;
			// The original canvas can retain native capture under the new viewer.
			active.session?.event(event);
			return false;
		},
		async lock(child, element, raw) {
			if (child !== active.frame.contentWindow || pending || captured()) return;
			if (element.ownerDocument.defaultView !== child) throw new Error('The capture canvas must belong to the requesting viewer.');
			capture = { child, element };
			try { await element.requestPointerLock(raw ? { unadjustedMovement: true } : undefined); }
			catch (error) {
				if (capture?.element === element && !captured()) capture = undefined;
				if (import.meta.env.DEV) console.warn('[MapExplorer] Pointer capture refused: ' + String(error));
				throw error;
			}
		},
		unlock(child) {
			if (child === active.frame.contentWindow && !pending && captured()) capture!.element.ownerDocument.exitPointerLock();
		},
		locked: child => child === active.frame.contentWindow && captured(),
		captureChanged(child, type) {
			if (child !== active.frame.contentWindow && child !== capture?.child) return false;
			if (import.meta.env.DEV) console.info('[MapExplorer] Pointer capture: ' + (captured() ? 'locked' : 'released') + ' (' + type + ')');
			if (!captured()) {
				for (const page of cached.values()) { page.frame.style.visibility = 'hidden'; page.frame.inert = true; }
				if (!pending) active.frame.contentWindow?.focus();
			}
			if (child === active.frame.contentWindow && !pending) return true;
			if (!pending) active.session?.event(new Event(type));
			return false;
		},
		focused: () => document.hasFocus(),
		blur(child) { if (child === active.frame.contentWindow) clearUnfocusedInput(); },
		request: (child) => pending?.frame.contentWindow === child ? pending.request : undefined,
		ready(child, session) {
			if (pending?.frame.contentWindow === child) {
				const previous = active;
				active = pending;
				pending = undefined;
				clearTimeout(timer);
				active.session = session;
				active.frame.id = 'active-viewer';
				previous.frame.removeAttribute('id');
				previous.frame.style.visibility = ownsCapture(previous) ? 'visible' : 'hidden';
				previous.frame.style.zIndex = '0';
				cached.delete(session.product);
				cached.set(previous.session!.product, previous);
				while (cached.size > 2) {
					const [product, page] = [...cached.entries()].find(([, page]) => !ownsCapture(page))!;
					page.frame.remove();
					cached.delete(product);
				}
				active.frame.inert = false;
				active.frame.style.visibility = 'visible';
				active.frame.style.zIndex = '1';
				banner.hidden = true;
				session.activate(held);
				session.event(new Event('pointerlockchange'));
				if (!captured()) active.frame.contentWindow?.focus();
				if (import.meta.env.DEV) console.info('[MapExplorer] Switch state after: ' + JSON.stringify({ camera: session.snapshot().camera, walking: session.snapshot().walking, input: held }));
				console.info('[MapExplorer] Switched to ' + productLabel(session.product) + ' in ' + Math.round(performance.now() - switchStarted) + ' ms');
			} else if (active.frame.contentWindow === child) {
				active.session = session;
				session.activate(held);
			}
		},
		failed(child, reason) {
			if (pending?.frame.contentWindow === child) rollback(reason);
		},
		progress(child, text) {
			if (pending?.frame.contentWindow === child) message.textContent = 'Loading ' + productLabel(pending.request?.product ?? pending.session!.product) + ': ' + text;
		},
		switchProduct(child, product) {
			if (pending || child !== active.frame.contentWindow || !active.session || product === active.session.product) return;
			if (!active.session.products.some((p) => p.product === product)) {
				message.textContent = productLabel(product) + ' is not installed in this World of Warcraft folder.';
				cancel.hidden = true;
				banner.hidden = false;
				return;
			}
			switchStarted = performance.now();
			const snapshot = active.session.snapshot();
			if (import.meta.env.DEV) console.info('[MapExplorer] Switch state before: ' + JSON.stringify({ camera: snapshot.camera, walking: snapshot.walking, input: held }));
			active.session.pause();
			active.frame.inert = !ownsCapture(active);
			message.textContent = 'Loading ' + productLabel(product) + '...';
			cancel.hidden = false;
			banner.hidden = false;
			const reused = cached.get(product);
			if (reused?.session) {
				pending = reused;
				void reused.session.prepare(snapshot).then(() => {
					if (pending === reused) window.mapExplorerHost!.ready(reused.frame.contentWindow!, reused.session!);
				}, (error: unknown) => {
					if (pending === reused) rollback(error instanceof Error ? error.message : String(error));
				});
			} else {
				pending = createPage({ source: active.session.source, product, snapshot });
			}
			// A stuck worker or failed module load must leave a way back to the original scene.
			timer = window.setTimeout(() => rollback('The selected game took too long to load.'), 180000);
			if (!captured()) cancel.focus();
		},
		hash(child, hash) {
			if (child === active.frame.contentWindow && !pending) history.replaceState(null, '', hash);
		},
	};
	window.addEventListener('hashchange', () => {
		if (!pending && active.frame.contentWindow) active.frame.contentWindow.location.hash = location.hash;
	});
	active = createPage();
	active.frame.id = 'active-viewer';
}
