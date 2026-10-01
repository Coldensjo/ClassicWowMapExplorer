/** Whether a key went to a text box or a list, which keep keys for themselves; checkboxes and buttons don't. */
export function isTyping(e: Event): boolean {
	const t = e.target;
	if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
	return t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}
