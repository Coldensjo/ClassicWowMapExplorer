/**
 * The dev-only gallery (gallery.html): every molecule in the default look, so a change can be
 * eyeballed without loading the game. See DESIGN_SYSTEM.md §8. Not part of the build.
 */
import {
	assetGrid,
	assetTile,
	attachTooltip,
	bindModeShortcuts,
	button,
	confirmDialog,
	floatingWindow,
	grabBar,
	hotkeyList,
	icon,
	iconButton,
	iconNames,
	kbd,
	kbdChord,
	loading,
	menu,
	modeController,
	radioGroup,
	segmentedControl,
	select,
	setAssetGridColumns,
	setAssetGridLayout,
	setAssetTileLayout,
	setAssetTileSelected,
	setInvalid,
	showToast,
	slider,
	stepper,
	swatchPicker,
	textInput,
	tile,
	toggleSwitch,
	type ButtonSize,
	type ButtonVariant,
	type AssetTilePictureSize,
	type IconButtonSize,
	type IconButtonVariant,
} from './index';
import { el } from './dom';

const gallery = document.getElementById('gallery')!;

function section(title: string, spec: string, note: string, ...children: HTMLElement[]): void {
	const s = el('section', { id: title.toLowerCase().replace(/\W+/g, '-') });
	s.append(el('h2', {}, title, el('small', {}, `specs/${spec}`)), el('p', {}, note), ...children);
	gallery.append(s);
}

const row = (...children: (HTMLElement | string)[]) => el('div', { class: 'row' }, ...children);
const col = (...children: HTMLElement[]) => el('div', { class: 'col' }, ...children);
const caption = (text: string) => el('span', { class: 'caption' }, text);
const status = () => el('div', { class: 'status' }, '—');

// Buttons
{
	const variants: ButtonVariant[] = ['primary', 'secondary', 'outline'];
	const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
	const rows = variants.map((variant) =>
		row(caption(variant), ...sizes.map((size) => button({ label: 'Save', variant, size })), button({ label: 'Save', variant, icon: 'save' }), button({ label: 'Save', variant, disabled: true })),
	);
	const pressed = button({ label: 'Toggle me', pressed: false, onClick: (e) => {
		const b = e.currentTarget as HTMLButtonElement;
		b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
	} });
	const iconVariants: IconButtonVariant[] = ['primary', 'secondary', 'ghost'];
	const iconSizes: IconButtonSize[] = ['xs', 'sm', 'md', 'lg'];
	const iconRows = iconVariants.map((variant) =>
		row(
			caption(variant),
			...iconSizes.filter((s) => variant === 'ghost' || s !== 'xs').map((size) => iconButton({ icon: 'close', label: 'Close', variant, size })),
			iconButton({ icon: 'close', label: 'Close', variant, disabled: true }),
		),
	);
	section('Buttons', 'buttons.md', 'Text buttons in three variants and sizes, then icon buttons. Hover washes, pressing doubles the wash, Tab shows the focus ring.', ...rows, row(caption('pressed'), pressed), ...iconRows);
}

// Switch
{
	const s = status();
	const on = toggleSwitch({ label: 'Fog', checked: true, onChange: (v) => (s.textContent = `Fog: ${v ? 'on' : 'off'}`) });
	const off = toggleSwitch({ label: 'Show ground clutter with a label long enough to truncate inside the column', checked: false });
	const disabled = toggleSwitch({ label: 'Weather', checked: true, disabled: true });
	const bare = toggleSwitch({ label: 'Bare switch', layout: 'bare' });
	section('Switch', 'switch.md', 'A row toggles anywhere it is clicked; the knob slides and the track cross-fades.', col(on.root, off.root, disabled.root), row(caption('bare'), bare.root), s);
}

// Radio
{
	const s = status();
	const group = radioGroup({
		name: 'sculpt-mode',
		legend: 'Sculpt mode',
		value: 'raise',
		options: [
			{ value: 'raise', label: 'Raise/lower', info: { label: 'About Raise/lower', onClick: () => showToast('Raise or lower the ground under the brush.') } },
			{ value: 'smooth', label: 'Smooth' },
			{ value: 'flatten', label: 'Flatten to a height, with a label long enough that it truncates', info: { label: 'About Flatten', onClick: () => showToast('Flattens toward the height you first touch.') } },
			{ value: 'noise', label: 'Noise (unavailable)', disabled: true, info: { label: 'About Noise', onClick: () => showToast('Noise needs a larger brush.') } },
		],
		onChange: (v) => (s.textContent = `Selected: ${v}`),
	});
	section('Radio', 'radio.md', 'Arrow keys move and select; the info button beside an option is its own control and stays usable when the option is disabled.', col(group.root), s);
}

// Segmented control
{
	const s = status();
	const two = segmentedControl({ name: 'paint-mode', label: 'Paint mode', value: 'paint', options: [{ value: 'paint', label: 'Paint' }, { value: 'sample', label: 'Sample' }], onChange: (v) => (s.textContent = `Paint mode: ${v}`) });
	const six = segmentedControl({
		name: 'sculpt-seg',
		label: 'Sculpt mode',
		value: 'raise',
		options: ['Raise', 'Lower', 'Smooth', 'Flatten', 'Noise', 'Ramp'].map((l) => ({ value: l.toLowerCase(), label: l, disabled: l === 'Ramp' })),
		onChange: (v) => (s.textContent = `Sculpt mode: ${v}`),
	});
	const view = segmentedControl({
		name: 'view-seg',
		label: 'View',
		variant: 'icon',
		value: 'grid',
		options: [{ value: 'grid', label: 'Grid', icon: 'grid' }, { value: 'list', label: 'List', icon: 'list' }],
		onChange: (v) => (s.textContent = `View: ${v}`),
	});
	section('Segmented control', 'segmented-control.md', 'Two segments as drawn, and six as the editor needs; segments share the width and labels truncate. The icon variant hugs 24px icon-only segments, each named in a tooltip.', col(two.root, six.root), row(caption('icon'), view.root), s);
}

// Text input
{
	const s = status();
	const name = textInput({ label: 'Scene name', optional: true, placeholder: 'My dungeon', hint: 'Shown in the scene list', onChange: (v) => (s.textContent = `Name: ${v}`) });
	const search = textInput({ ariaLabel: 'Search textures', type: 'search', icon: 'search', placeholder: 'Search textures' });
	const money = textInput({ label: 'Amount', prefix: '$', suffix: '%', value: '100' });
	const invalid = textInput({ label: 'Tiles across', value: '99', hint: '1 to 64' });
	setInvalid(invalid.root, 'Must be 64 or fewer');
	const disabled = textInput({ label: 'Disabled', value: 'Cannot edit', disabled: true, hint: 'Also dimmed' });
	const readOnly = textInput({ label: 'Read only', value: 'Fixed value', readOnly: true });
	const smallSearch = textInput({ ariaLabel: 'Search (small)', type: 'search', icon: 'search', placeholder: 'Search…', size: 'sm' });
	const smallMoney = textInput({ label: 'Small with suffix', value: '100', suffix: '%', size: 'sm' });
	section('Text input', 'text-input.md', 'Label, optional suffix, leading icon, prefix, suffix and supporting text. Focus recolours the border; there is no ring on fields. The third column is the small size: a 30px box with 12px text.', row(col(name.root, search.root, money.root), col(invalid.root, disabled.root, readOnly.root), col(smallSearch.root, smallMoney.root)), s);
}

// Slider
{
	const s = status();
	const radius = slider({ label: 'Radius', value: 40, min: 1, max: 100, suffix: 'yd', title: '[ and ] change it too', onInput: (v) => (s.textContent = `Radius: ${v}`) });
	const strength = slider({ label: 'Strength', value: 0.5, min: 0, max: 1, step: 0.05, suffix: '%' });
	const bare = slider({ ariaLabel: 'Opacity', value: 70, showInput: false });
	const disabled = slider({ label: 'Disabled', value: 25, disabled: true });
	const five = slider({ label: 'Opacity (5 stops)', value: 60, stops: 5, suffix: '%', onChange: (v) => (s.textContent = `Opacity: ${v}`) });
	const powers = slider({ label: 'Resolution', value: 4, stops: [1, 2, 4, 8, 16], suffix: 'x', onChange: (v) => (s.textContent = `Resolution: ${v}x`) });
	const quality = slider({
		label: 'Quality',
		value: 2,
		stops: [{ value: 0, label: 'Low' }, { value: 1, label: 'Medium' }, { value: 2, label: 'High' }, { value: 3, label: 'Ultra' }, { value: 4, label: 'Max' }],
		onChange: (v) => (s.textContent = `Quality: ${v}`),
	});
	const small = slider({ label: 'Small', value: 60, suffix: '%', size: 'sm', onInput: (v) => (s.textContent = `Small: ${v}`) });
	const smallStops = slider({ ariaLabel: 'Tile size', value: 3, min: 1, max: 3, stops: 3, showInput: false, size: 'sm' });
	smallStops.root.style.width = '140px';
	section(
		'Slider',
		'slider.md',
		'Native range with the tall thumb; the value field commits on Enter or blur, clamped and stepped. The second column has discrete stops: evenly spaced, explicit values, and labelled. The third is the small size: a 30px row with a square thumb, as the browser toolbars use it.',
		row(col(radius.root, strength.root, bare.root, disabled.root), col(five.root, powers.root, quality.root), col(small.root, smallStops.root)),
		s,
	);
}

// Stepper
{
	const s = status();
	const facing = stepper({ label: 'Facing', value: 90, min: 0, max: 360, step: 15, onChange: (v) => (s.textContent = `Facing: ${v}`) });
	const scale = stepper({ label: 'Scale', value: 1, min: 0.1, max: 10, step: 0.1, fieldWidth: '96px' });
	const flatten = stepper({ label: 'Flatten to', value: null, placeholder: 'first touch', step: 1, onChange: (v) => (s.textContent = `Flatten to: ${v}`) });
	const disabled = stepper({ label: 'Disabled', value: 3, disabled: true });
	section('Stepper', 'stepper.md', 'Minus and plus step, repeat while held and disable at the limits; ↑/↓ step in the field, Shift for ten steps.', row(facing.root, scale.root, flatten.root, disabled.root), s);
}

// Select and menu
{
	const s = status();
	const weather = select({
		label: 'Weather effects',
		value: 'none',
		options: [{ value: 'none', label: 'No weather' }, { value: 'rain', label: 'Rain' }, { value: 'snow', label: 'Snow' }, { value: 'fog', label: 'Fog (needs a sky)', disabled: true }, { value: 'storm', label: 'Storm' }],
		onChange: (v) => (s.textContent = `Weather: ${v}`),
	});
	const falloff = select({ ariaLabel: 'Falloff', value: null, placeholder: 'Choose a falloff', hint: 'How the brush fades at its edge', options: [{ value: 'linear', label: 'Linear' }, { value: 'smooth', label: 'Smooth' }, { value: 'flat', label: 'Flat' }] });
	const many = select({ label: 'Many options', value: '3', options: Array.from({ length: 20 }, (_, i) => ({ value: String(i), label: `Option ${i + 1}` })) });
	const disabled = select({ label: 'Disabled', value: 'a', options: [{ value: 'a', label: 'Fixed' }], disabled: true });
	const more = iconButton({ icon: 'more', label: 'More actions', variant: 'ghost', size: 'sm' });
	menu(more, [
		{ label: 'Drop to ground', onSelect: () => (s.textContent = 'Dropped to ground') },
		{ label: 'Duplicate', icon: 'plus', onSelect: () => (s.textContent = 'Duplicated') },
		{ label: 'Rename (soon)', disabled: true, onSelect: () => {} },
		{ label: 'Delete', destructive: true, onSelect: () => (s.textContent = 'Deleted') },
	]);
	const sceneMenu = iconButton({ icon: 'down', label: 'Scene menu', variant: 'ghost', size: 'xs' });
	let format = 'mac';
	const grouped = menu(sceneMenu, [
		{ heading: 'Hotkey format' },
		{ id: 'mac', label: 'Mac', checked: true, onSelect: () => choose('mac') },
		{ id: 'windows', label: 'Windows', checked: false, onSelect: () => choose('windows') },
		{ separator: true },
		{ label: 'Settings', icon: 'scene', onSelect: () => (s.textContent = 'Settings') },
		{ label: 'Export', icon: 'download', onSelect: () => (s.textContent = 'Export') },
		{ label: 'Exit scene', icon: 'log-out', onSelect: () => (s.textContent = 'Exit scene') },
	]);
	grouped.root.style.inlineSize = '218px';
	function choose(next: string): void {
		format = next;
		grouped.setChecked('mac', format === 'mac');
		grouped.setChecked('windows', format === 'windows');
		s.textContent = `Hotkey format: ${format}`;
	}
	section('Select and menu', 'dropdown.md', 'A select-only combobox: Enter, Space or arrows open; typing jumps; the selected option is semibold with a checkmark. The ⋯ button opens an action menu with a destructive item; the ⌄ button one with a headed group of choices, a separator and icons, as the scene control panel uses.', row(col(weather.root, falloff.root), col(many.root, disabled.root)), row(caption('action menu'), more, caption('grouped'), sceneMenu), s);
}

// Swatch picker
{
	const s = status();
	const colours = ['#e6c09e', '#c99a6b', '#a9734a', '#7c4f2e', '#4a2e1b', '#f2d6c0', '#006fb4', '#181818'];
	const picker = swatchPicker({ label: 'Skin colour', name: 'skin', value: '2', options: colours.map((color, i) => ({ value: String(i), color, disabled: i === 5 })), onChange: (v) => (s.textContent = `Skin colour ${Number(v) + 1}`) });
	section('Swatch picker', 'color-swatch.md', 'The selected swatch has the accent ring and dot; hover outlines; each swatch has a name in a tooltip. The blue and near-black swatches show the issue flagged in the spec.', col(picker.root), s);
}

// Tile
{
	const s = status();
	section(
		'Interactive tile',
		'interactive-tile.md',
		'A card that navigates, as a button or a link; the title and description stay on one line.',
		col(
			tile({ title: 'Local NPCs', description: 'Created in this scene.', onActivate: () => (s.textContent = 'Opened Local NPCs') }),
			tile({ title: 'All creatures', onActivate: () => (s.textContent = 'Opened All creatures') }),
			tile({ title: 'A very long title that will not fit in the tile at this width', description: 'And a description that is also far too long to fit in one line here', onActivate: () => {} }),
			tile({ title: 'Documentation', description: 'Opens in a new place.', href: '#interactive-tile' }),
			tile({ title: 'Disabled', description: 'Nothing to open yet.', disabled: true }),
		),
		s,
	);
}

// Mode controller
{
	const s = status();
	const bar = modeController({ value: 'sculpt', onChange: (m) => (s.textContent = `Mode: ${m}`) });
	bindModeShortcuts(bar.root);
	const column = modeController({ value: 'sculpt', name: 'gallery-mode-column', orientation: 'vertical', onChange: (m) => (s.textContent = `Mode: ${m}`) });
	const scene = el('div', { class: 'scene', style: 'height: 288px; gap: var(--space-4)' }, bar.root, column.root);
	section('Mode controller', 'mode-controller.md', 'Over a fake scene so the blur shows. ←/→ switch; keys 1 to 7 switch the bar from anywhere on this page; hover a chip for its tooltip. Beside it, the vertical column for the side panel: every chip icon-only.', scene, s);
}

// Key command
{
	section('Key command', 'key-command.md', 'Medium and small keycaps, and a chord.', row(kbd('Shift'), kbd('W'), kbd('Esc'), caption('small'), kbd('Shift', { size: 'sm' }), kbd('1', { size: 'sm' }), caption('chord'), kbdChord(['Shift', '1']), kbdChord(['Cmd', 'S'], { size: 'sm' })));
}

// Hotkey list
{
	const plain = hotkeyList({
		rows: [
			{ label: 'Move gizmo', keys: ['W'] },
			{ label: 'Rotate', keys: ['Cmd'], tail: 'drag' },
			{ label: 'Drop to ground', keys: ['Cmd', 'Space'] },
			{ label: 'Delete', keys: ['Del'] },
		],
	});
	const headed = hotkeyList({ heading: 'Hotkeys', rows: [{ label: 'Raise', keys: ['Shift'], tail: 'click' }, { label: 'Lower', keys: ['Cmd'], tail: 'click' }] });
	section('Hotkey list', 'hotkey-list.md', 'What each key does, as a tool panel lists them: a plain list for a module of its own, and a headed list indented behind a rule as it sits under a radio option.', row(col(plain.root), col(headed.root)));
}

// Tooltip
{
	const save = iconButton({ icon: 'save', label: 'Save scene', variant: 'secondary', size: 'md' });
	attachTooltip(save, { text: 'Save scene', shortcut: 'S', placement: 'top' });
	const play = iconButton({ icon: 'play', label: 'Play', variant: 'primary', size: 'md' });
	attachTooltip(play, { text: 'Play the scene', placement: 'bottom' });
	const left = iconButton({ icon: 'left', label: 'Previous', variant: 'ghost', size: 'md' });
	attachTooltip(left, { text: 'Previous', placement: 'left' });
	const right = iconButton({ icon: 'right', label: 'Next', variant: 'ghost', size: 'md' });
	attachTooltip(right, { text: 'Next', placement: 'right' });
	const info = iconButton({ icon: 'help', label: 'About falloff', variant: 'ghost', size: 'sm' });
	attachTooltip(info, { variant: 'complex', text: 'Falloff is how the brush fades from full strength at its centre to nothing at its edge. Smooth is usually what you want for terrain.', placement: 'bottom' });
	const rich = iconButton({ icon: 'info', label: 'About textures', variant: 'ghost', size: 'sm' });
	attachTooltip(rich, { variant: 'complex', text: 'Textures come from the game files.', placement: 'right', content: button({ label: 'Open the browser', size: 'sm', onClick: () => showToast('Would open the texture browser.') }) });
	section('Tooltip', 'tooltip.md', 'Simple tooltips show after a short hover, at once when moving between neighbours, and on focus. Complex ones open on click and stay until Escape or a click outside.', row(caption('simple'), save, play, left, right, caption('complex'), info, rich));
}

// Toast
{
	section(
		'Toast',
		'toast.md',
		'Shown at the bottom centre of the viewport, at most three at once; hover pauses the timer, click dismisses.',
		row(
			button({ label: 'Scene saved', onClick: () => showToast('Scene saved.') }),
			button({ label: 'Long message', onClick: () => showToast('Copied 14 tiles, 212 doodads and 3 buildings from Elwynn Forest into the scene; the base textures are still loading.') }),
			button({ label: 'With action', onClick: () => showToast({ message: 'Deleted 3 objects.', action: { label: 'Undo', onClick: () => showToast('Restored.') } }) }),
		),
	);
}

// Scrollbar
{
	const box = el('div', { class: 'scrollbox ds-scroll' }, ...Array.from({ length: 12 }, (_, i) => el('p', {}, `Row ${i + 1}: the thumb is 4px, rounded, with no track, and brightens a little on hover.`)));
	section('Scrollbar', 'scrollbar.md', 'Native scrolling with the ds-scroll class.', el('div', { style: 'width: 320px' }, box));
}

// Grab bar
{
	const body = el('div', { class: 'body' }, 'Drag the bar above to resize this panel; it is focusable, ↑/↓ resize it, Home/End jump, Enter or a double click collapse and restore it.');
	const demo = el('div', { class: 'resize-demo' });
	let height = 160;
	let collapsed = false;
	const apply = () => (demo.style.height = `${collapsed ? 16 : height}px`);
	const bar = grabBar({ label: 'Resize demo panel', value: height, min: 60, max: 320, grows: 'end', onChange: (v) => { height = v; collapsed = false; apply(); }, onToggle: () => { collapsed = !collapsed; apply(); } });
	demo.append(bar.root, body);
	apply();
	const side = el('div', { class: 'resize-demo', style: 'display: flex; height: 120px; width: 240px' });
	let width = 160;
	const sideBody = el('div', { class: 'body', style: 'flex: 1' }, 'Vertical');
	const sideBar = grabBar({ label: 'Resize side panel', value: width, min: 80, max: 220, orientation: 'vertical', grows: 'start', onChange: (v) => { width = v; side.style.width = `${v + 16}px`; } });
	side.style.width = `${width + 16}px`;
	side.append(sideBody, sideBar.root);
	section('Grab bar', 'grab-bar.md', 'A separator with a 16px hit area around the 2px handle, horizontal above a panel or vertical beside one.', row(demo, side));
}

// Loading
{
	section('Loading', 'loading-indicator.md', 'A CSS ring in the text colour, shown after a 300ms delay. Reduced motion stops it turning.', row(loading({ label: 'Loading models…' }), loading({ label: 'Loading', size: 48 }), loading({ label: 'Loading', size: 24 })));
}

// Asset tile and grid
{
	const s = status();
	const swatch = (hue: number) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 64;
		const ctx = canvas.getContext('2d')!;
		const g = ctx.createLinearGradient(0, 0, 64, 64);
		g.addColorStop(0, `hsl(${hue} 30% 35%)`);
		g.addColorStop(1, `hsl(${hue + 40} 30% 20%)`);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 64, 64);
		return canvas;
	};
	const names = ['elwynn / elwynngrassbase01', 'elwynn / elwynndirt', 'westfall / westfallgrass', 'dun morogh / snow01', 'barrens / barrensdirt', 'durotar / durotarrocks'];
	const grid = assetGrid(3);
	grid.style.width = '416px';
	let selected: HTMLElement | null = null;
	const tiles = names.map((name, i) => {
		// The NPC library's extras: a "…" menu on the picture's corner, a variants pill on its edge.
		let action: HTMLButtonElement | undefined;
		if (i === 2) {
			action = iconButton({ icon: 'more', label: `More for ${name}`, variant: 'secondary', size: 'sm' });
			menu(action, [
				{ label: 'Edit', onSelect: () => (s.textContent = `Edit ${name}`) },
				{ label: 'Remix', onSelect: () => (s.textContent = `Remix ${name}`) },
				{ label: 'Add to favorites', onSelect: () => (s.textContent = `Favorited ${name}`) },
			]);
		}
		return assetTile({
			label: name,
			picture: swatch(i * 50),
			disabled: i === 5,
			badge: i === 3 ? '12 variants' : undefined,
			action,
			onActivate: (e) => {
				const root = e.currentTarget as HTMLElement;
				if (selected) setAssetTileSelected(selected, false);
				selected = selected === root ? null : root;
				if (selected) setAssetTileSelected(selected, true);
				s.textContent = selected ? `Selected: ${name}` : 'Nothing selected';
			},
		});
	});
	setAssetTileSelected(tiles[1].root, true);
	selected = tiles[1].root;
	grid.append(...tiles.map((t) => t.frame));
	const columns = slider({ label: 'Columns', value: 3, min: 3, max: 5, stops: 3, showInput: false, onInput: (v) => setAssetGridColumns(grid, v) });
	columns.root.style.width = '200px';
	// The same tiles as rows, with the picture at each of its three sizes.
	const rows = assetGrid(1);
	rows.style.width = '416px';
	setAssetGridLayout(rows, 'row');
	const sizes: AssetTilePictureSize[] = ['sm', 'md', 'lg'];
	const rowTiles = names.slice(0, 4).map((name, i) => {
		let action: HTMLButtonElement | undefined;
		if (i === 2) {
			action = iconButton({ icon: 'more', label: `More for ${name}`, variant: 'secondary', size: 'sm' });
			menu(action, [{ label: 'Edit', onSelect: () => (s.textContent = `Edit ${name}`) }]);
		}
		return assetTile({ label: i === 0 ? `${name} with a caption long enough to wrap onto a second line and then be cut` : name, picture: swatch(i * 50), layout: 'row', badge: i === 3 ? '12 variants' : undefined, action, selected: i === 1 });
	});
	rows.append(...rowTiles.map((t) => t.frame));
	const pictureSize = slider({ label: 'Row picture', value: 2, min: 1, max: 3, stops: 3, showInput: false, onInput: (v) => rowTiles.forEach((t) => setAssetTileLayout(t.root, 'row', sizes[v - 1])) });
	pictureSize.root.style.width = '200px';
	section('Asset tile', 'asset-tile.md', 'A square picture with a one-line caption; hover washes the picture, the selected tile has the accent border, wash and bold caption; the third tile has a corner menu and the fourth a badge (npc-library.md); the last tile is unavailable. The slider changes the grid\'s columns. Below, the row layout: picture, a caption on up to two lines and the action at the end, with the washes over the whole row; its slider changes the picture size.', columns.root, grid, pictureSize.root, rows, s);
}

// Floating window
{
	const s = status();
	let demo: ReturnType<typeof floatingWindow> | null = null;
	const open = button({
		label: 'Open a demo window',
		variant: 'primary',
		onClick: () => {
			if (demo) demo.dispose();
			demo = floatingWindow({
				title: 'Demo window',
				defaultRect: { right: 24, y: 80, width: 360, height: 400 },
				onCollapsedChange: (collapsed) => (s.textContent = collapsed ? 'Collapsed' : 'Expanded'),
			});
			const body = el('div', { style: 'padding: var(--space-4); color: var(--color-text-muted); font: var(--type-body-secondary);' });
			body.append(
				el('p', { style: 'margin: 0 0 var(--space-3)' }, 'Drag the header to move, the corner grip to resize, the button to collapse. Arrow keys work on the focused header and grip.'),
				button({ label: 'Close', variant: 'outline', onClick: () => demo?.dispose() }),
			);
			demo.body.append(body);
			s.textContent = 'Opened';
		},
	});
	section('Floating window', 'floating-window.md', 'The frame the texture, object and NPC browsers share. It floats over the page, so open it and look to the right.', row(open), s);
}

// Dialog
{
	const s = status();
	const ask = (destructive: boolean) =>
		void confirmDialog({
			title: destructive ? 'Delete "Stormwind Guard"?' : 'Exit NPC studio?',
			message: destructive ? 'Scenes that use it keep their own copy.' : 'Any changes you’ve made will be lost.',
			cancel: { label: destructive ? 'Keep it' : 'Go back' },
			confirm: { label: destructive ? 'Delete' : 'Exit', destructive },
		}).then((yes) => (s.textContent = yes ? 'Confirmed' : 'Cancelled'));
	section(
		'Dialog',
		'dialog.md',
		'A modal question on the native <dialog>: the scrim behind, Escape and the close button cancel, the safe choice has focus first. The second opens the destructive shape.',
		row(button({ label: 'Exit NPC studio?', onClick: () => ask(false) }), button({ label: 'Delete a preset', variant: 'outline', onClick: () => ask(true) })),
		s,
	);
}

// Icons
{
	const grid = el('div', { class: 'icons' }, ...iconNames.map((name) => el('div', {}, icon(name, { size: 'lg' }), name)));
	section('Icons', '(icons/)', 'Every icon in the set at 24px.', grid);
}
