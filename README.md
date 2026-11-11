<p align="center"><img src="extension/icons/icon128.png" width="96" height="96" alt="Chessist"></p>
<h1 align="center">Chessist</h1>
<p align="center">Live Stockfish evaluation for Chess.com and Lichess — a desktop app + browser extension.</p>
<img width="1609" height="939" alt="chessist" src="https://github.com/user-attachments/assets/754eead5-5897-4954-81ce-8d2334497c43" />

---

## What it is

Two parts working together:

- **Chessist desktop app** (Electron + React) — runs native Stockfish, owns all settings, shows live
  evaluation, and (optionally) draws a transparent, screen-capture-invisible overlay on the board.
- **Chessist browser extension** — reads the board on chess.com / lichess.org, sends positions to the
  app, draws in-page arrows, and plays auto-moves.

Windows 10/11. The transparent overlay is Windows-only.

## Features

- **Native Stockfish** — one persistent engine per session; the transposition table is reused across
  moves (reset only on a new game) with a large hash and multi-threading for fast, deepening analysis.
- **Three render modes** — *Overlay* (transparent native window on the board), *In-page* (arrows drawn
  on the chess site), or *App* (the desktop window draws its own board + best-move arrows).
- **Live board + eval** in the app — score, depth, best move, kNPS, and a board rendered from the
  current position (greys out and reports "Disconnected" when no game is active).
- **Auto-move** with human-like timing, best/opponent/alternative arrows, player-color perspective,
  and win/loss balancing — all configured in the app.
- **No setup.bat, no Python** — the app downloads Stockfish on first run; the extension is a pure
  WebSocket client and the app guides loading it.

## Install

> Prebuilt installers will land on the [Releases](https://github.com/imluri/Chessist/releases) page.
> Until then, install from source — one click builds **and** installs it.

**Requirements:** [Node 20+](https://nodejs.org/) and the
[.NET SDK 8](https://dotnet.microsoft.com/download) (used to build the overlay).

1. Get the code — clone it (recommended; enables in-app auto-update):
   ```bash
   git clone https://github.com/imluri/Chessist.git
   ```
   …or download the ZIP from the repo / a release and extract it.
2. Double-click **`install.bat`**. It requests administrator rights (one UAC prompt — needed to build
   the installer), checks Node/.NET, installs dependencies and the overlay, then builds the Windows
   installer (`npm run dist`) and runs it. **Chessist installs and launches automatically.**
   - If the installer build can't run on your machine, it falls back to a portable **Chessist**
     shortcut in the project folder — launch from there and keep the folder where it is.
3. First launch downloads Stockfish — watch the **Setup** tab.
4. On the **Setup** tab, follow the **Browser extension** card: it reveals the bundled extension
   folder and walks you through `chrome://extensions` → Developer mode → **Load unpacked**. Works on
   any Chromium browser — **Chrome, Brave, or Edge**.
5. Open a game on chess.com or lichess.org. The board and evaluation appear in the app; choose your
   render mode and tweak settings via the **gear** (Settings → Game / Engine).

**Updating:** the **About** tab checks GitHub for new versions. A git clone updates in place
(stable = release tags, beta = every commit on `main`); a ZIP install gets a one-click link to the
latest release.

## Using the app

- **Evaluation** — the live board, score, and best-move arrow (one purple arrow by default; enable
  *Alternative arrows* for the yellow/red lines).
- **Settings** (gear, or the sidebar item) — a modal with **Game** (depth, render mode, player color,
  arrows, auto-move + timing, behavior, win/loss balance) and **Engine** (skill, ELO, threads, hash).
- **Setup** — Stockfish / Overlay / Extension status, each in its own card, plus a re-download button.

The extension popup shows whether it can reach the desktop app and whether Stockfish is ready.
If Stockfish is unavailable, open **Setup → Stockfish engine** for the error and a retry button.

## Develop

Requirements: Node 20+, .NET SDK 8 (only to build the C# overlay).

```bash
npm install
npm run build:overlay     # builds the C# overlay helper (overlay/bin/Release/net48)
npm run dev               # Vite + Electron
```

Build an installer: `npm run dist` (output in `release/`). CI builds the overlay + installer on a
`v*.*.*` tag.

## Project structure

```
Chessist/
├── electron/      # Electron main: Stockfish engine, WebSocket server, overlay driver, IPC
├── src/           # React renderer (sidebar, Evaluation, Settings modal, board, controls)
├── overlay/       # C# overlay helper — transparent, capture-invisible window (stdin-driven)
├── extension/     # browser extension (load unpacked)
├── scripts/       # dev helpers (build-overlay.ps1)
└── build/         # app / installer icon
```

## Credits

Created by [imluri](https://github.com/imluri/). Powered by
[Stockfish](https://stockfishchess.org/) (GPL, downloaded at first run). MIT licensed (app + extension).
