import { effect, untracked } from '@preact/signals';
import { render } from 'preact';
import { workspace } from '../app/input';
import '../ui/wow.css';
import './editor.css';
import { EditorApp } from './ui/app';
import type { EditorContext } from './ui/context';

/**
 * Shows the editor's panels while the edit workspace is active, and takes them away (handing
 * the minimap back to the explorer) when it isn't. The body's ws-edit class sizes the 3D view
 * to the gap between them.
 */
export function mountEditor(ctx: EditorContext): void {
	const root = document.createElement('div');
	root.id = 'editor';
	document.body.append(root);
	effect(() => {
		const editing = workspace.value === 'edit';
		document.body.classList.toggle('ws-edit', editing);
		// Untracked: the panels follow their own signals, not this effect.
		untracked(() => render(editing ? <EditorApp ctx={ctx} /> : null, root));
	});
}
