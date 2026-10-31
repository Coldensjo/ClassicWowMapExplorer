# ForeverForge

Build your ideas on Azeroth. ForeverForge is a free, browser-based map editor for World of
Warcraft: sculpt and paint terrain, set the time of day and weather, place objects, buildings
and NPCs, then walk through what you made. It reads textures, models and maps straight from the
game files on your computer; nothing is hosted, uploaded or downloaded.

Scenes start blank or as a copy of an area of Azeroth, are kept in your browser, and export as
`.wscene` files to share or back up.

## What you need

- **World of Warcraft Classic** installed (the folder that contains `_classic_` or `_classic_beta_`).
- **Chrome** or another Chromium-based browser.

## Windows

1. Download **ForeverForge-portable.zip** from the latest release and unzip it anywhere.
2. Run **ForeverForge.exe**. If Windows says *"Windows protected your PC"* (the program isn't
   signed), click **More info**, then **Run anyway**.
3. It finds World of Warcraft by itself. If not, click **Choose folder** and pick the folder that
   contains `_classic_` or `_classic_beta_`. The files never leave your computer.

## Linux and macOS

Run from source. You need **git** and **[Bun](https://bun.sh)** besides the game and the browser.

```sh
git clone <this repository>
cd wow-dungeon-builder
bun install
bun run dev
```

Then open **http://localhost:5173**. The dev server looks for the game in the usual places
(Wine, Lutris, Bottles, Steam, Heroic on Linux; `/Applications` on macOS). If it can't find it,
set `WOW_DIR` to the folder that contains `_classic_` or `_classic_beta_`, or choose the folder
in the page:

```sh
WOW_DIR="/path/to/World of Warcraft" bun run dev
```

The browser may ask you to confirm an "upload" when you choose the folder: nothing leaves your
computer, the page only reads the game files. The browser can't keep the folder between visits,
so the landing page asks for it again each time you come back.

## Working on it

- `bun run dev` serves the app; `bun run build` type-checks and builds it into `dist/`.
- `bun test` runs the tests in `tests/`.
- The UI follows the design system in `src/ui` (see `src/ui/DESIGN_SYSTEM.md`); `/gallery.html`
  on the dev server shows every control.
- `bun run portable` builds the Windows portable version (needs mingw-w64, ImageMagick and 7-Zip).
