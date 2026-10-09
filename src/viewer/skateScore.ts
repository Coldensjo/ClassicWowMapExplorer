import { TRICK_TIME, type SkateTrick, type WalkControls } from './walkControls';

/** What each trick is worth. */
const TRICK_POINTS: Record<SkateTrick, number> = {
	'Kickflip': 100,
	'Heelflip': 100,
	'360 Shove-it': 150,
	'Body Varial': 200,
	'Impossible': 250,
	'360 Flip': 300,
};
/** Air: points a second in the air, counted once longer than the least (s). */
const AIR_POINTS = 100;
const AIR_LEAST = 0.6;
/** A wall ride: points for getting on it, and for each yard climbed. */
const WALL_POINTS = 200;
const WALL_PER_YARD = 50;
/** A takedown: points for one; n at once are worth n(n+1)/2 times as much, so a crowd pays off. */
const TAKEDOWN_POINTS = 250;
/** A mega jump. */
const MEGA_JUMP_POINTS = 300;
/** The same move again in one combo is worth this share of the last time. */
const REPEAT_SHARE = 0.5;
/** Rolling this long on the ground with nothing new banks the combo (s). */
const COMBO_WINDOW = 2;
/** How long a landed or bailed combo's line stays up (s). */
const RESULT_TIME = 2.5;
const BEST_KEY = 'mapExplorer.skateBest';

interface Move {
	name: string;
	points: number;
}

/**
 * Points for skating, as Tony Hawk's games count them: tricks, air time, wall rides and
 * takedowns build a combo, whose points are multiplied by how many moves it has (the same move
 * again is worth less each time). The combo banks into the score after rolling a moment with
 * nothing new; landing before a trick has come round is a bail, and the combo is lost. The best
 * combo is remembered between visits.
 */
export class SkateScore {
	private score = 0;
	private best = 0;
	private combo: Move[] = [];
	/** Seconds on the ground since the last move, while a combo runs. */
	private idle = 0;
	/** What the walker was doing last frame, to see what's changed. */
	private was = { skating: false, state: '', airTime: 0, wall: false, trick: '' as string, trickStart: 0 };
	/** The wall ride under way: the height it got on at, and the highest it's been. */
	private wallFrom = 0;
	private wallTop = 0;
	/** The line under the combo after it ends ("Landed!", "Bail!"), and how long it has left. */
	private result = '';
	private resultTime = 0;
	private readonly root = document.getElementById('skate-score');
	private readonly total = document.getElementById('skate-total');
	private readonly moves = document.getElementById('skate-moves');
	private readonly value = document.getElementById('skate-combo');
	/** The text shown last, so the page is only written when it changes. */
	private shown = '';
	/** Called with each move's points as it's scored (to fill the nitro bar). */
	onPoints: ((points: number) => void) | null = null;

	constructor() {
		try {
			this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
		} catch {
			// Storage blocked: the best starts over.
		}
	}

	/** Call every frame: scores air and wall rides as they end, banks or bails the combo, and shows it all. */
	update(dt: number, walker: WalkControls): void {
		const skating = walker.active && walker.skating;
		const was = this.was;
		const now = { skating, state: walker.state, airTime: walker.airTime, wall: walker.wall !== null, trick: walker.trick ?? '', trickStart: walker.trickStart };
		this.was = now;
		this.resultTime = Math.max(0, this.resultTime - dt);
		this.doubleTime = Math.max(0, this.doubleTime - dt);
		if (skating) {
			if (now.wall && !was.wall) this.wallFrom = this.wallTop = walker.position.y;
			if (now.wall) this.wallTop = Math.max(this.wallTop, walker.position.y);
			if (was.wall && !now.wall) this.add('Wall Ride', WALL_POINTS + Math.round(Math.max(0, this.wallTop - this.wallFrom) * WALL_PER_YARD));
			if (was.state === 'air' && now.state === 'ground') this.land(was);
			if (was.state === 'ground' && now.state === 'swim') this.bail('Wipeout!');
		}
		if (this.combo.length) {
			if (!skating) this.bank();
			else if (walker.state === 'ground' && walker.wall === null) {
				this.idle += dt;
				if (this.idle > COMBO_WINDOW) this.bank();
			} else {
				this.idle = 0;
			}
		}
		this.show(skating);
	}

	/** A trick started in the air. */
	trick(name: SkateTrick): void {
		this.add(name, TRICK_POINTS[name]);
	}

	/** Flung up off something (an ore vein, a meeting stone). */
	megaJump(from: string): void {
		this.add(`${from} Mega Jump`, MEGA_JUMP_POINTS);
	}

	/** Something ridden into: what it gave, as a move worth some points. */
	pickup(name: string, points: number): void {
		this.add(name, points);
	}

	/** Every move's points doubled for a while (s; from a chest). */
	doublePoints(time: number): void {
		this.doubleTime = Math.max(this.doubleTime, time);
	}

	/** Seconds left of double points. */
	private doubleTime = 0;

	/** So many knocked down at once, named, its points multiplied by how rare they were. */
	takedown(count: number, name: string, rarity: number): void {
		this.add(count === 1 ? name : `${count}× ${name}`, Math.round(((TAKEDOWN_POINTS * count * (count + 1)) / 2) * rarity));
	}

	/** Down on the ground: a trick still coming round is a bail; else the air time counts. */
	private land(was: { airTime: number; trick: string; trickStart: number }): void {
		if (was.trick && was.airTime - was.trickStart < TRICK_TIME) {
			this.bail('Bail!');
			return;
		}
		if (was.airTime > AIR_LEAST) this.add(`${was.airTime.toFixed(1)}s Air`, Math.round(was.airTime * AIR_POINTS));
	}

	private add(name: string, points: number): void {
		// The same move again is worth less each time in a combo.
		const repeats = this.combo.filter((m) => m.name === name).length;
		const scored = Math.max(1, Math.round(points * REPEAT_SHARE ** repeats * (this.doubleTime > 0 ? 2 : 1)));
		this.combo.push({ name, points: scored });
		this.onPoints?.(scored);
		this.idle = 0;
		this.resultTime = 0;
	}

	private get comboBase(): number {
		return this.combo.reduce((sum, m) => sum + m.points, 0);
	}

	/** The combo lands: into the score, and the best if it beats it. */
	private bank(): void {
		const points = this.comboBase * this.combo.length;
		this.score += points;
		if (points > this.best) {
			this.best = points;
			try {
				localStorage.setItem(BEST_KEY, String(points));
			} catch {
				// Not remembered; it still counts for this visit.
			}
			this.result = `New best! +${points.toLocaleString()}`;
		} else {
			this.result = `Landed! +${points.toLocaleString()}`;
		}
		this.resultTime = RESULT_TIME;
		this.combo = [];
	}

	private bail(text: string): void {
		if (!this.combo.length) return;
		this.combo = [];
		this.result = text;
		this.resultTime = RESULT_TIME;
	}

	/** The score and best, the moves of the combo running and what it's worth, or how the last one ended. */
	private show(skating: boolean): void {
		if (!this.root || !this.total || !this.moves || !this.value) return;
		const moves = this.combo.map((m) => m.name).join(' + ');
		const value = this.combo.length ? `${this.comboBase.toLocaleString()} × ${this.combo.length}` : this.resultTime > 0 ? this.result : '';
		const double = this.doubleTime > 0 ? `  ·  2× points ${Math.ceil(this.doubleTime)}s` : '';
		const total = `${this.score.toLocaleString()}  ·  Best combo ${this.best.toLocaleString()}${double}`;
		const text = `${skating}|${total}|${moves}|${value}|${this.result === 'Bail!' || this.result === 'Wipeout!'}`;
		if (text === this.shown) return;
		this.shown = text;
		this.root.hidden = !skating && !this.combo.length && this.resultTime <= 0;
		this.total.textContent = total;
		this.moves.textContent = moves;
		this.value.textContent = value;
		this.value.classList.toggle('bail', !this.combo.length && (this.result === 'Bail!' || this.result === 'Wipeout!'));
	}
}
