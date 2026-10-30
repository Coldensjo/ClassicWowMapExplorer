/**
 * Small DOM helpers the molecules build with, so no molecule uses innerHTML and every one
 * makes ids the same way. See DESIGN_SYSTEM.md §5.
 */

export type Child = Node | string | null | undefined | false;

export type Attrs = Record<string, string | number | boolean | null | undefined>;

/**
 * Makes an element. `attrs` are set as attributes (a boolean true sets an empty attribute,
 * false/null/undefined skip it); `class` and `className` both set the class list.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Attrs = {},
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		const name = key === 'className' ? 'class' : key;
		node.setAttribute(name, value === true ? '' : String(value));
	}
	append(node, ...children);
	return node;
}

/** Appends children, skipping empty ones and turning strings into text nodes. */
export function append(parent: Node, ...children: Child[]): void {
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	}
}

let counter = 0;

/** A document-unique id with the given prefix, for label/for and aria-* links. */
export function uid(prefix: string): string {
	counter += 1;
	return `ds-${prefix}-${counter}`;
}

/** True when the element is, or is inside, something the user types into. */
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.closest('input, textarea, select, [contenteditable]') !== null;
}

/** Rounds `value` to the precision of `step` (so 0.1 + 0.2 reads 0.3) and clamps it. */
export function snap(value: number, min: number, max: number, step: number): number {
	const decimals = step.toString().split('.')[1]?.length ?? 0;
	const stepped = Math.round((value - min) / step) * step + min;
	const clamped = Math.min(max, Math.max(min, stepped));
	return Number(clamped.toFixed(decimals));
}
