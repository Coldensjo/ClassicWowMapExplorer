/**
 * The editor's command pattern (spec 7.11): every change is a command that can undo and redo
 * itself. A brush stroke is one command, holding sparse snapshots of the chunks it touched.
 */
export interface Command {
	/** Short label for tooltips, e.g. "Raise terrain". */
	label: string;
	/** Rough memory the command holds on to, for the stack's budget. */
	bytes: number;
	undo(): void;
	redo(): void;
}

/** Stack depth of 200 commands or 256 MB, whichever comes first (spec 7.11). */
const MAX_COMMANDS = 200;
const MAX_BYTES = 256 * 1024 * 1024;

export class CommandStack {
	private readonly undos: Command[] = [];
	private readonly redos: Command[] = [];
	/** Called whenever what can be undone or redone changes, to refresh the buttons. */
	onChange: () => void = () => {};

	/** Records a command already applied to the model; redo is not run. */
	push(command: Command): void {
		this.undos.push(command);
		this.redos.length = 0;
		let bytes = 0;
		for (const c of this.undos) bytes += c.bytes;
		while (this.undos.length > MAX_COMMANDS || (bytes > MAX_BYTES && this.undos.length > 1)) {
			bytes -= this.undos.shift()!.bytes;
		}
		this.onChange();
	}

	get canUndo(): boolean {
		return this.undos.length > 0;
	}

	get canRedo(): boolean {
		return this.redos.length > 0;
	}

	/** The next command each way, for button tooltips. */
	get undoLabel(): string | null {
		return this.undos.at(-1)?.label ?? null;
	}

	get redoLabel(): string | null {
		return this.redos.at(-1)?.label ?? null;
	}

	undo(): void {
		const command = this.undos.pop();
		if (!command) return;
		command.undo();
		this.redos.push(command);
		this.onChange();
	}

	redo(): void {
		const command = this.redos.pop();
		if (!command) return;
		command.redo();
		this.undos.push(command);
		this.onChange();
	}

	clear(): void {
		this.undos.length = 0;
		this.redos.length = 0;
		this.onChange();
	}
}
