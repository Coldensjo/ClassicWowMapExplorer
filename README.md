# MapExplorer

Fly over the World of Warcraft world in your browser, drawn from your own game install. Everything is read straight from the game files on your computer; nothing is hosted, uploaded or downloaded.

Built for WoW Classic, with Eastern Kingdoms and Kalimdor loaded as one seamless world.

## Get started

You need **World of Warcraft Classic** installed, and **[Node.js](https://nodejs.org)** (the LTS version).

1. Download this project: **Code → Download ZIP** on GitHub and unzip it, or
   `git clone https://github.com/Coldensjo/ClassicWowMapExplorer.git`
2. Open a terminal in the project folder and run:

   ```sh
   npm install
   npm run dev
   ```

3. Open **http://localhost:5173** in Chrome or Edge.
4. Click **Choose your World of Warcraft folder** (or drag the folder onto the page) and pick the
   folder that contains `_classic_` or `_classic_beta_`, usually
   `C:\Program Files (x86)\World of Warcraft`. The browser calls it an upload, but the files never
   leave your computer.

The world opens by itself. Click to look around, fly with **W A S D**, and hold **Shift** to go faster.

## Features

- The whole world at once: distant terrain for both continents, with full detail streamed in around you
- Terrain textures, water and other liquids, with the game's underwater look and sound
- Buildings and props placed as in the game, with animated fire, smoke and sparks
- Sky, fog and lighting from the game's own light data, with a time-of-day control
- Zone names and zone music, including inside inns, Ironforge and other buildings
- Creatures and objects from VMaNGOS: clickable, with Wowhead links, name plates, their gear and
  animations, walking their patrols
- Dungeons and raids you can walk into through their entrances, and a map picker for every map in
  the install (battlegrounds, unused and test maps included)

## Controls

| Key | Action |
| --- | --- |
| Click | Capture the mouse to look around, or open info on a creature or object |
| W A S D / arrows | Move |
| Space / E, C / Q | Up, down |
| Shift | Move faster |
| Mouse wheel | Zoom |
| 1, 2 | Jump to a continent |
| O | Overview of the whole world |
| R | Return to the start position |
| T / Shift+T | Time of day forward / back |
| N | Reset time to the local clock |
| L | Toggle torch |
| F | Switch name plate colours between Alliance and Horde |
| M | Music and sound on / off |

**Go to map…** (top right) jumps to any map, including ones nothing leads to.

The camera position is kept in the URL, so a link brings you back to the same spot. Add `?time=HH:MM` to set the time of day.

## Troubleshooting

- **"That isn't the World of Warcraft folder"**: pick the folder one level up, the one that
  contains `_classic_` or `_classic_beta_`.
- **Direct access** (under *More options*) opens faster, but Chrome and Edge refuse folders under
  `Program Files`; use the main button for those.
- If nothing shows up, check that you're in Chrome or Edge with hardware acceleration on.

## For developers

### Spawn data

Creature and object spawns, patrols and dungeon entrances in `public/spawns` come from the [VMaNGOS](https://github.com/vmangos/core) world database. To rebuild them, download the SQLite database from the VMaNGOS `db_latest` release and run:

```sh
npm run spawns -- path/to/mangos.sqlite
```

This needs `sqlite3` on the PATH. NPC hair textures come from the community listfile, expected at `.cache/listfile.csv`.

### Scripts

- `npm run dev`: start the dev server
- `npm run build`: type-check and build to `dist`
- `npm run typecheck`: type-check only
- `npm run probe`: inspect game data from Node
- `npm run spawns`: rebuild the spawn files

`inspector.html` is a small test page for browsing the storage and file formats.

### Layout

- `src/casc`: CASC storage reader
- `src/formats`: WoW file formats (ADT, WDT, WDL, WMO, M2, BLP, DB2)
- `src/worker`: storage and parsing in a web worker
- `src/explorer`: world data, meshes, lighting, spawns, music
- `src/viewer`: three.js renderer, controls, particles, audio
- `tools`: Node scripts for probing data and building spawns
