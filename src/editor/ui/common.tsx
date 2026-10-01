import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { iconUrls, type IconName } from '../../ui/wowSkin';

/** An icon from the game, or a plain square until (or unless) the skin has loaded. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
	const src = iconUrls.get(name);
	return src
		? <img class="ed-icon" src={src} width={size} height={size} alt="" draggable={false} />
		: <span class="ed-icon ed-icon-blank" style={{ width: size, height: size }} />;
}

/** An action-bar style button: the icon in a slot frame, its key in the corner. */
export function Slot({ icon, title, keyLabel, pressed, disabled, onClick }: {
	icon: IconName; title: string; keyLabel?: string; pressed?: boolean; disabled?: boolean; onClick: () => void;
}) {
	const src = iconUrls.get(icon);
	return (
		<button
			class="wow-slot ed-slot"
			style={src ? { backgroundImage: `url("${src}")` } : undefined}
			title={keyLabel ? `${title} (${keyLabel})` : title}
			aria-label={title}
			aria-pressed={pressed === undefined ? undefined : pressed}
			disabled={disabled}
			onClick={onClick}
		>
			{keyLabel && <span class="ed-slot-key">{keyLabel}</span>}
		</button>
	);
}

/** A checkbox with the game's box and tick. */
export function Check({ checked, onChange, children, title }: { checked: boolean; onChange: (on: boolean) => void; children: ComponentChildren; title?: string }) {
	return (
		<label class="ed-check" title={title}>
			<input type="checkbox" class="wow-check" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
			<span>{children}</span>
		</label>
	);
}

/**
 * A number field that applies on Enter or when left, not on every keystroke, and shows the
 * value it's given otherwise (it changes as things are dragged and undone).
 */
export function NumberField({ label, value, digits = 2, step, onCommit }: { label: string; value: number | null; digits?: number; step?: number; onCommit: (v: number) => void }) {
	const shown = value === null ? '' : String(Number(value.toFixed(digits)));
	const [text, setText] = useState(shown);
	const editing = useRef(false);
	useEffect(() => {
		if (!editing.current) setText(shown);
	}, [shown]);
	const commit = () => {
		editing.current = false;
		const v = Number(text);
		if (text.trim() !== '' && Number.isFinite(v) && text !== shown) onCommit(v);
		else setText(shown);
	};
	return (
		<label class="ed-field">
			<span class="wow-label">{label}</span>
			<input
				class="wow-input"
				type="number"
				step={step}
				value={text}
				placeholder={value === null ? 'mixed' : undefined}
				onFocus={() => (editing.current = true)}
				onInput={(e) => setText((e.target as HTMLInputElement).value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					if (e.key === 'Escape') {
						editing.current = false;
						setText(shown);
						(e.target as HTMLInputElement).blur();
					}
				}}
			/>
		</label>
	);
}

/** A framed panel with a title bar. */
export function Panel({ title, children, class: className = '', actions }: { title: string; children: ComponentChildren; class?: string; actions?: ComponentChildren }) {
	return (
		<section class={`wow-panel ed-panel ${className}`}>
			<header class="ed-panel-head">
				<h2 class="wow-label">{title}</h2>
				{actions}
			</header>
			{children}
		</section>
	);
}
