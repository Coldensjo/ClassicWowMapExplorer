import { RUN_SPEED, type WalkControls } from './walkControls';

/** Yards per second in miles per hour. */
const MPH = 3600 / 1760;

/**
 * The skateboard's dials, in the bottom left: how fast it's going (miles an hour, and as a share
 * of running speed, as the game gives mount speeds), the fastest so far, and the nitro bar, ready
 * once full and draining while it burns. Shown only on the board.
 */
export class SkateMeter {
	private top = 0;
	private readonly root = document.getElementById('skate-meter');
	private readonly speed = document.getElementById('skate-speed');
	private readonly detail = document.getElementById('skate-speed-detail');
	private readonly bar = document.getElementById('nitro-bar');
	private readonly fill = document.getElementById('nitro-fill');
	private readonly label = document.getElementById('nitro-label');
	/** The text shown last, so the page is only written when it changes. */
	private shown = '';

	update(walker: WalkControls): void {
		if (!this.root || !this.speed || !this.detail || !this.bar || !this.fill || !this.label) return;
		const on = walker.active && walker.skating;
		// Rolling, the board's speed (up and down slopes too); in the air or on a wall, the body's.
		const now = walker.state === 'ground' ? Math.abs(walker.boardSpeed) : walker.velocity.length();
		if (on) this.top = Math.max(this.top, now);
		const mph = Math.round(now * MPH);
		const percent = Math.round((now / RUN_SPEED) * 100);
		const fill = Math.round(walker.nitro * 100);
		const state = walker.nitroTime > 0 ? 'active' : walker.nitro >= 1 ? 'ready' : '';
		// Power-ups running, with the seconds they have left.
		const powers = ([['Grip', walker.gripTime], ['Surf', walker.surfTime]] as const).filter(([, t]) => t > 0).map(([name, t]) => `${name} ${Math.ceil(t)}s`).join(' · ');
		const text = `${on}|${mph}|${percent}|${Math.round(this.top * MPH)}|${fill}|${state}|${powers}`;
		if (text === this.shown) return;
		this.shown = text;
		this.root.hidden = !on;
		this.speed.textContent = String(mph);
		this.detail.textContent = `${percent}% run speed · top ${Math.round(this.top * MPH)} mph${powers ? ` · ${powers}` : ''}`;
		this.fill.style.width = `${fill}%`;
		this.bar.className = state;
		this.label.textContent = state === 'active' ? 'Nitro!' : state === 'ready' ? 'Nitro ready · Shift' : 'Nitro';
	}
}
