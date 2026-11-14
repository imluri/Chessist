# Changelog

## [3.0.3] — 2026-11-14

- Lichess Instant move rechecks queued moves when the turn indicator changes. Chessist verifies the current game, position, and turn before sending input and waits while a premove is active.
- The Evaluation page shows whether Auto-move is waiting for the browser board, the expected move appeared, the board stayed the same or changed unexpectedly, the board could not be verified, or the browser reported an input error.

## [3.0.2] — 2026-11-14

- Run **Setup → Performance check** to measure the local Bun connection, Stockfish on offline positions, and sample desktop updates with Chessist in the foreground or background.
- See median and 95th-percentile timings and sample counts. Use the Lichess lag check link to measure your connection to the site separately.

## [3.0.1] — 2026-11-14

- Move the local WebSocket service and native Stockfish process into a Bun worker. The extension sends analysis requests and receives results directly through that worker.
- Restore saved settings when the worker restarts and show local connection errors in **Setup → Browser extension**.
- Bundle the Bun worker in the Windows x64 installer. No separate Bun installation is required.

## [3.0.0] — 2026-11-14

- Introduce a redesigned title bar, sidebar, and Settings panel built on the reusable desktop UI template.
- Use existing Chessist preferences for Game and Engine controls in the new Settings panel.
- Build the desktop renderer with Bun.

## [2.1.1] — 2026-11-12

- Preview the available stable version's release notes in **About → Updates** before installing.
- Keep sidebar shortcuts and Settings in sync, including when the browser extension reconnects.
- Keep the desktop app responsive while its window is in the background.

## [2.1.0] — 2026-11-12

- Use **+ Add shortcuts** in the sidebar to pin Game and Engine settings. Pinned controls stay in sync with Settings and are saved between launches.
- Start analysis for new Lichess rounds as soon as the opening board is ready, even when the previous round showed the same position.
- Show a Fair Play notice on Chess.com online play pages when Auto-move is enabled.

## [2.0.9] — 2026-11-12

- Fix Lichess stalls after reconnecting or when an engine result arrives before the live board and turn are ready.
- Show a progress bar while downloading a Windows installer update in **About → Updates**.

## [2.0.8] — 2026-11-12

- Recheck the live Lichess board and turn before sending an automatic move. Drop stale moves and avoid retries when input may already have reached the board.
- Fix the GitHub Actions Windows release build so packaging finishes before the workflow publishes the installer.

## [2.0.7] — 2026-11-12

- Recognize current Lichess game URLs and detect the player's own round before the clocks start.
- Keep spectator rounds read-only even when a clock is running or a player color is selected manually.

## [2.0.6] — 2026-11-12

- The bundled browser extension reloads automatically after future desktop updates when its folder contains the newer version.
- The score panel and board keep their size while Stockfish evaluates a new position.

After installing v2.0.6, reload the existing browser extension once to enable automatic reloads.
If it still shows an older version, load the bundled folder from **Setup → Browser extension**.
Refresh any chess tabs that were already open after the extension reloads.

## [2.0.5] — 2026-11-12

### Fixed

- Improved instant auto-move and Lichess promotion handling.
- Fixed Firefox extension startup when Chromium's debugger API is unavailable.
- Stockfish keeps the latest position when requests overlap and resumes it after an engine restart.

Chromium may ask you to approve the new debugger permission when you reload the extension.
Thanks to [@ibadullaevrahil67-maker](https://github.com/ibadullaevrahil67-maker) for [PR #3](https://github.com/imluri/Chessist/pull/3).

## [2.0.4] — 2026-11-12

### Added

- **Update & restart** in **About → Updates** for Windows installer builds. Chessist downloads and
  verifies the matching stable installer from GitHub, then restarts after installation.
- Download progress and retry feedback for in-app updates.

Users on earlier Windows installer builds need to install v2.0.4 manually once. Future stable
releases can be installed from the app.

## [2.0.3] — 2026-11-12

### Fixed

- Windows setup downloads the Stockfish build for the correct CPU and replaces a cached executable built for the wrong architecture.
- Analysis requests made while Stockfish starts now run as soon as the engine is ready.
- Setup reports launch and download failures and offers a retry. The browser popup shows engine readiness separately from the desktop connection.

## [2.0.2] — 2026-06-09

### Fixed
- **Connection refused (`net::ERR_CONNECTION_REFUSED`)** — the WebSocket server now binds both the
  IPv4 (`127.0.0.1`) and IPv6 (`::1`) loopback, so the extension connects regardless of how the OS
  resolves localhost
- **Auto-move freezing after one move** — player color is no longer clobbered to `null` mid-game, so
  auto-move keeps playing each turn
- **Single instance** — a second launch focuses the existing window instead of racing for the port

### Added
- Update check shows the installed version, commit hash, and channel (stable/beta)

## [2.0.1] — 2026-06-09

### Added
- **In-app auto-updater** — checks GitHub for new versions on launch and from About → Updates; one
  click runs `git pull`/checkout → reinstall → rebuild → relaunch
- **Beta channel** — toggle in About: on = update on every commit to `main`; off (default) = released
  tags only

### Fixed
- **Eval bar no longer flips each move** — scores are normalized to White's perspective (Stockfish
  reports relative to the side to move)
- **Crash on engine death** — guarded Stockfish stdin writes (no more `write EPIPE` taking down the
  app) with a bounded auto-restart

## [2.0.0] — 2026-06-08

### Changed
- **Rebuilt as an Electron desktop app** (React + Vite) — owns Stockfish and the WebSocket server
- **Overlay is now a slim C# helper** (`ChessistOverlay.exe`) driven by the desktop app over stdin — same transparent, screen-capture-invisible window
- **No setup.bat, no native messaging** — the app downloads Stockfish on first run; the extension is a pure WebSocket client
- **Faster within a game** — one persistent Stockfish process with a large hash and multiple threads; the transposition table is reused across moves and reset only on a new game
- **Settings live in the app** — a sidebar with Evaluation, Game, Engine, Setup, About; the app is the single settings authority and pushes settings to the extension over WS. The extension popup is now just a connectivity indicator, and its options page is gone
- **Three render modes** — *Overlay* (transparent native window), *In-page* (drawn on the chess site), or *App* (the desktop window draws its own board + best-move arrows; nothing in the browser)
- **Guided extension install** — the installer bundles the extension; the Setup tab reveals the folder and walks through loading it
- **Bundled font + logo** — Instrument Sans as the app font; Chessist logo for the window/installer icon, title bar, and About
- **Repo reorganized** — Electron app at root, browser extension under `extension/`, overlay under `overlay/`
- Removed the C# engine, native-messaging host, and WASM remnants

---

## [1.3.2] — 2026-06-08

### Changed
- **Lean repo** — compiled binaries removed from git; repo is now ~4 MB instead of ~170 MB
- **GitHub Actions CI** — tagged releases (`v*.*.*`) build and publish `chessist-engine-windows.zip`
- **setup.bat downloads binaries** — `ChessistEngine.exe` and `stockfish.exe` are fetched from GitHub releases on first run (skipped if already present)
- **Auto-download Stockfish** — `ChessistEngine.exe` re-fetches Stockfish automatically if missing, with download progress broadcast over WebSocket
- **Extension detection** — the engine detects when the Chrome extension is connected (via an `identify` message)
- **Eldritch theme** — the status panel adopts a flat pitch-black aesthetic with the Chessist purple (`#792A9E`) accent
- **BootstrapGate** — the status panel shows a setup checklist (engine → Stockfish → extension) until everything is ready

---

## [1.3.1] — 2026-06-08

### Changed
- **Removed WASM engine** — `ChessistEngine.exe` (native Stockfish) is now the sole analysis engine; no WASM fallback
- **Removed Python dependency** — `ChessistEngine.exe` now acts as its own native-messaging host (HostBridge mode)
- **Bundled Stockfish** — `stockfish.exe` is included; no separate install required
- **Zero-prompt setup** — `setup.bat` requires no user input; extension ID is pinned via manifest key
- **React+Vite status panel** — tray icon → "Open Panel" shows live engine status, eval depth, score, and NPS
- Repo reorganized: `overlay/` → `engine/`, `native-host/` → `host/`, dev scripts → `scripts/`
- `ChessistEngine.exe` prevents duplicate instances via named mutex

---

## v1.3.0 — Chessist Engine

### Added
- **Chessist Engine** — native C# engine host replaces Python native messaging; run `ChessistEngine.exe` and Stockfish analysis streams directly to the extension over WebSocket with no Python dependency
- **Always-on WebSocket engine connection** — content scripts connect to the engine on page load regardless of overlay mode; no manual engine-source switching required
- **WASM fallback** — extension automatically falls back to the built-in WASM Stockfish when ChessistEngine.exe is not running; no configuration needed
- **Bidirectional eval protocol** — same WebSocket connection used for overlay display and engine eval requests; engine streams multi-PV results back as JSON `eval` messages
- **Engine status indicator** — popup shows live engine connection state (connected / not running)

### Removed
- **Python native messaging host** — no longer needed; Python and the `websockets` pip package are not required
- **Engine source toggle** — replaced with automatic detection; extension uses native engine when available, WASM when not
- `setup.bat` no longer requires Python, pip, or extension ID for native messaging registration

### Changed
- `setup.bat` simplified — only checks for Stockfish and optionally adds ChessistEngine.exe to Windows startup

---

## v1.2.2 — Performance update

### Changed
- **MultiPV 1 by default** — Stockfish now searches a single line unless "Show Alternative Arrows" is enabled, cutting analysis time roughly in half for most positions
- **Dynamic MultiPV toggle** — enabling/disabling alternative arrows at runtime sends `setoption name MultiPV` live to the engine without requiring a restart
- **Stealth Mode** - enabled by default

### Fixed
- **Per-eval storage read removed** — `engineDepth` is now cached in memory and updated on change; previously a `chrome.storage.sync.get` was awaited on every single eval request, adding unnecessary latency
- **Parallel tab broadcasts** — `EVAL_RESULT` messages are now sent to all content-script tabs simultaneously (`Promise.all`) instead of sequentially, reducing broadcast overhead with multiple tabs open
- **Tab ID cache** — content-script tab IDs are cached between broadcasts and only re-queried when tabs open, close, or navigate, eliminating repeated `chrome.tabs.query` calls on every Stockfish depth line

---

## v1.2.1 — Overlay fixes

### Fixed
- **Overlay not drawing on page load** — eval completed before the WebSocket connected so nothing was ever sent; last evaluation is now cached and immediately replayed when the overlay connects
- **Overlay hiding when extension popup opens** — `window.blur` fired whenever the popup opened, sending `visible: false`; replaced with `visibilitychange` which only fires on actual tab switches and minimises
- **Overlay hiding on alt-tab** — added `GetForegroundWindow()` check in the C# render loop; overlay blanks only when a non-browser window is foreground
- **Debug mode overlay blank** — `AllocConsole()` window (owned by the overlay process) caused `IsActualBrowser()` to return false; added `_selfPid` check to whitelist the overlay's own windows
- **"View Logs" opening a hidden log window** — replaced the in-process `LogWindow` form with file-based logging (`ChessistOverlay.log`) opened in the system default text editor

### Added
- **Debug Mode toggle** — sub-option under Overlay Mode; restarts the overlay exe with `-debug` flag, showing a console window for live troubleshooting
- **Always-on file logging** — overlay writes a timestamped log to `ChessistOverlay.log` in all modes (not just debug)

---

## v1.2.0 — Overlay update

### Added
- **Native overlay window** — transparent C# WinForms window drawn over the browser using `UpdateLayeredWindow` with premultiplied alpha; invisible to screen capture (`SetWindowDisplayAffinity`)
- **Pixel-accurate positioning** — overlay uses `EnumChildWindows` to find `Chrome_RenderWidgetHostHWND` and `ClientToScreen` to get the exact web content origin, bypassing Chrome's unreliable JS screen coordinate APIs
- **Drag tracking** — 16ms timer re-polls `ClientToScreen` so the overlay follows the browser window in real time
- **Maximize sync** — `ResizeObserver` on the board element fires post-reflow so overlay resizes correctly after maximize/restore
- **Focus sync** — overlay hides on `window.blur` and reappears on `window.focus`; Electron apps (VS Code, Discord) are excluded via process-name check
- **Settings sync** — overlay respects Show Best Move, Show Opponent's Best Move, Show Alternative Arrows, and Target Depth; arrows are only drawn when analysis reaches target depth
- **Show Opponent's Best Move** toggle — best-move arrow stays visible during the opponent's turn; appears as a sub-option under Show Best Move
- **Overlay status indicator** — live dot in the popup shows whether the overlay is connected or still connecting, polling every second


---

## v1.1.0 - Lichess update

### Added
- **Lichess support** — full eval bar, best-move arrows, move classification icons, auto-move, accuracy tracking, W/L balance, auto-rematch, and all other features now work on lichess.org in addition to Chess.com
- **Lichess auto-move** — uses click-to-move directly on Chessground (CSP blocks inline script injection on lichess)
- **Lichess spectator mode** — eval bar and best-move arrows calculate for both sides when watching games on the home TV feed or any spectated game
- **Puzzle mode detection** — Lichess training/puzzle pages follow the current turn for color detection
- **Instant move disables timing controls** — delay min/max inputs and Smart Timing toggle are greyed out and non-interactive when Instant Move is enabled

### Fixed
- **Lichess CSP violation** — removed `tryPageContextMove` which injected inline scripts blocked by lichess's Content Security Policy, causing auto-move to silently do nothing
- **Accuracy icons showing when disabled on Lichess** — popup settings changes were only broadcast to Chess.com tabs; Lichess tabs now receive all setting updates immediately
- **Auto-move firing on spectated Lichess games** — auto-move is now gated to games where the user is an active participant; no longer attempts moves on the home TV feed or top-rated player games
- **Stale accuracy when force-moving during calculation** — `prevCpWhite` now updates on every eval depth rather than only at target depth, so manually moving before Stockfish finishes no longer causes accuracy to be calculated from a two-move-old eval
- **Best-move arrow only showing for white when spectating** — `detectPlayerColor()` incorrectly read board orientation on TV/home page boards; now returns `null` when not in own game so arrows are drawn for whichever side is to move
- **`.rclock` false positive in spectator detection** — clock elements are visible to spectators too; own-game detection now relies solely on `lichess.round.data.player.color`
- **Puzzle mode broken by spectator detection** — puzzle URLs (`/training/...`) matched the 8-char game ID pattern and triggered the `isInOwnGame()` check too early; puzzle check is now evaluated first

---

## v1.0.2

### Added
- **Live accuracy display** on the eval bar — shows your running average accuracy as a colored icon + percentage (green/yellow/red based on performance)
- **Accuracy persistence** — accuracy is saved to local storage per game ID and restored on page refresh mid-game
- **Move classification icons** on the board — best, excellent, good, inaccuracy, mistake, blunder icons drawn at the destination square after each move
- **Show Move Icon** toggle in popup settings
- **Auto-move** via `chrome.scripting.executeScript({ world: 'MAIN' })` — runs in page context with trusted events for reliable move submission
- **Smart timing** for auto-move — adjusts delay based on move complexity, eval magnitude, and captures
- **Target Accuracy** setting — intentionally play at a lower accuracy percentage
- **W/L Balance** — automatically throws a game after winning too many in a row, then wins the next
- **Match Player ELO** — Stockfish plays at your detected Chess.com rating; supports manual override
- **Auto Rematch / Auto New Game** after game ends
- **Stealth Mode** — suppresses all console logs
- **Best move arrow** drawn as SVG overlay on the board
- **Native Stockfish engine** support via native messaging host (much faster than WASM)
- **PV cache** — instant eval response when opponent plays the expected move
- **Position cache** — revisited positions return instantly from cache

### Fixed
- Auto-move `movePending` deadlock that blocked every move after the first in bot games
- Move icon appearing on the wrong square (FROM instead of TO)
- CSP blocking inline script injection — removed `tryPageContextMove` in favour of service worker scripting
- `moveIconEl is not defined` error after cleanup of old eval bar elements
- Accuracy eval never triggering because opponent's position wasn't being evaluated
- Eval bar glitching on game load due to `board.game.move()` mutating the DOM silently

---

## v1.0.1

### Added
- Instant move mode
- Countdown timer shown on eval bar during delayed auto-move
- Depth indicator on eval bar
- Turn indicator (debug)
- Auto-detection of player color from board SVG rank orientation

### Fixed
- Various eval bar positioning issues on Chess.com layout changes
- Shadow DOM piece lookup for `wc-chess-board`

---

## v1.0.0 — Initial Release

- Live evaluation bar injected into Chess.com
- WASM Stockfish engine (built-in, no install required)
- Best move display on eval bar
- Skill level slider
- Analysis depth control
- Auto-move with configurable min/max delay
- Playing As color override (Auto / White / Black)
- Native engine support with install script
