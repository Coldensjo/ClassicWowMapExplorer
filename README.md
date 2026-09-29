# MapExplorer

Fly over the World of Warcraft world in your browser, rendered from your own local game install. Everything is read straight from the game's CASC storage on your machine; nothing is hosted or downloaded.

Built against WoW Classic (`wow_classic_beta`), with the whole of Eastern Kingdoms and Kalimdor loaded as one seamless world.

## Features

- Whole-continent far terrain (WDL) with detailed ADT tiles streamed in near the camera
- Terrain texture splatting, water and other liquids
- Buildings (WMO) and doodads (M2) placed as in-game
- Sky, fog and lighting from the game's Light tables, with a time-of-day control
- Zone names
- Clickable creature and object spawns with Wowhead links, NPCs wearing their gear, and name plates

## Getting started

Requires Node.js and a local WoW install.

```sh
npm install
npm run dev
```

Open the page Vite prints, click **Open World of Warcraft folder**, select your install folder, then click **Explore**. **Direct access** is faster, but Chrome and Edge refuse folders under `Program Files`.

`inspector.html` is a small test page for browsing the storage and file formats.

## Controls

| Key | Action |
| --- | --- |
| Click | Capture the mouse to look around, or open info on a creature or object |
| W A S D / arrows | Move |
| Space / E, C / Q | Up, down |
| Shift | Move faster |
| Mouse wheel | Zoom |
| 1, 2, ... | Jump to a continent |
| O | Overview of the whole world |
| R | Return to the start position |
| T / Shift+T | Time of day forward / back |
| N | Reset time to the local clock |
| L | Toggle torch |
| F | Switch name plate colours between Alliance and Horde |

The camera position is kept in the URL hash, so links bring you back to the same spot. Add `?time=HH:MM` to set the time of day.

## Spawn data

Creature and object spawns in `public/spawns` come from the [VMaNGOS](https://github.com/vmangos/core) world database. To rebuild them, download the SQLite database from the VMaNGOS `db_latest` release and run:

```sh
npm run spawns -- path/to/mangos.sqlite
```

This needs `sqlite3` on the PATH.

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: type-check and build to `dist`
- `npm run typecheck`: type-check only
- `npm run probe`: inspect game data from Node
- `npm run spawns`: rebuild the spawn files

## Layout

- `src/casc`: CASC storage reader
- `src/formats`: WoW file formats (ADT, WDT, WDL, WMO, M2, BLP, DB2)
- `src/worker`: storage and parsing in a web worker
- `src/explorer`: world data, meshes, lighting, spawns
- `src/viewer`: three.js renderer and controls
- `tools`: Node scripts for probing data and building spawns
