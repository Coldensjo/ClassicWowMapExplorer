/** How often (ms) a held arrow button scrolls again, after the first wait. */
const REPEAT_DELAY = 350;
const REPEAT_EVERY = 60;

/**
 * A scroll bar in the game's look for an element that scrolls up and down: an arrow button at
 * each end and a knob between them that slides along (a fixed size, as the game's is), drawn
 * with the install's own pictures when it has them (see uiAssets.ts). The element's own bar is
 * hidden (the .game-scrolled class). The arrows scroll a step, the track a page, and the knob
 * drags.
 */
export class GameScrollbar {
	readonly element = document.createElement('div');
	private readonly up = document.createElement('button');
	private readonly down = document.createElement('button');
	private readonly track = document.createElement('div');
	private readonly knob = document.createElement('div');
	private frame = 0;

	/** step: how far (px) an arrow scrolls; a row of what's listed, say. */
	constructor(private readonly scroller: HTMLElement, public step: () => number = () => 40) {
		this.element.className = 'game-scrollbar';
		this.up.className = 'plain game-scroll-up';
		this.down.className = 'plain game-scroll-down';
		this.up.setAttribute('aria-label', 'Scroll up');
		this.down.setAttribute('aria-label', 'Scroll down');
		this.up.tabIndex = this.down.tabIndex = -1;
		this.track.className = 'game-scroll-track';
		this.knob.className = 'game-scroll-knob';
		this.track.append(this.knob);
		this.element.append(this.up, this.track, this.down);
		scroller.classList.add('game-scrolled');

		this.hold(this.up, () => this.scrollBy(-this.step()));
		this.hold(this.down, () => this.scrollBy(this.step()));
		this.hold(this.track, (e) => {
			// Paging toward where the track was pressed, until the knob gets there.
			const knob = this.knob.getBoundingClientRect();
			if (e.clientY < knob.top) this.scrollBy(-this.scroller.clientHeight * 0.9);
			else if (e.clientY > knob.bottom) this.scrollBy(this.scroller.clientHeight * 0.9);
		});
		this.knob.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.knob.setPointerCapture(e.pointerId);
			const startY = e.clientY;
			const startTop = this.scroller.scrollTop;
			const move = (m: PointerEvent) => {
				const room = this.track.clientHeight - this.knob.offsetHeight;
				const range = this.scroller.scrollHeight - this.scroller.clientHeight;
				if (room > 0) this.scroller.scrollTop = startTop + ((m.clientY - startY) / room) * range;
			};
			const end = () => {
				this.knob.removeEventListener('pointermove', move);
				this.knob.removeEventListener('pointerup', end);
				this.knob.removeEventListener('pointercancel', end);
				this.knob.classList.remove('dragging');
			};
			this.knob.classList.add('dragging');
			this.knob.addEventListener('pointermove', move);
			this.knob.addEventListener('pointerup', end);
			this.knob.addEventListener('pointercancel', end);
		});
		// The wheel over the bar scrolls the list too.
		this.element.addEventListener('wheel', (e) => {
			if (e.ctrlKey) return;
			e.preventDefault();
			this.scrollBy(e.deltaY * (e.deltaMode === 1 ? this.step() : 1));
		}, { passive: false });
		scroller.addEventListener('scroll', () => this.update(), { passive: true });
		new ResizeObserver(() => this.update()).observe(scroller);
	}

	/** Places the knob for where the element is scrolled; call when its content changes size. */
	update(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const { scrollTop, scrollHeight, clientHeight } = this.scroller;
			const range = scrollHeight - clientHeight;
			const scrolls = range > 1;
			this.element.classList.toggle('idle', !scrolls);
			this.up.disabled = !scrolls || scrollTop <= 0;
			this.down.disabled = !scrolls || scrollTop >= range - 1;
			const room = this.track.clientHeight - this.knob.offsetHeight;
			this.knob.style.transform = `translateY(${scrolls ? Math.round((scrollTop / range) * room) : 0}px)`;
		});
	}

	private scrollBy(dy: number): void {
		this.scroller.scrollTop += dy;
	}

	/** Runs an action on press, and again and again while held. */
	private hold(target: HTMLElement, action: (e: PointerEvent) => void): void {
		target.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || (target as HTMLButtonElement).disabled) return;
			e.preventDefault();
			let last = e;
			action(e);
			let timer = window.setTimeout(function again() {
				action(last);
				timer = window.setTimeout(again, REPEAT_EVERY);
			}, REPEAT_DELAY);
			const track = (m: PointerEvent) => (last = m);
			const stop = () => {
				clearTimeout(timer);
				window.removeEventListener('pointermove', track);
				window.removeEventListener('pointerup', stop);
				window.removeEventListener('pointercancel', stop);
			};
			window.addEventListener('pointermove', track);
			window.addEventListener('pointerup', stop);
			window.addEventListener('pointercancel', stop);
		});
	}
}
