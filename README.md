<p align="center">
  <img src="icons/icon128.png" alt="Chessist Logo" width="128" height="128">
</p>

<h1 align="center">Chessist</h1>

<p align="center">
  A Chromium extension that adds a live evaluation bar to Chess.com and Lichess games, powered by Stockfish.
  <br>
  <strong>Created by <a href="https://github.com/lurimous/">lurimous</a></strong>
</p>

<p align="center">
  <a href="https://github.com/lurimous/Chessist">GitHub</a> •
  <a href="https://discord.gg/2WgHtrgqZm">Discord</a> •
  <a href="https://ko-fi.com/imluri">Ko-fi</a>
</p>

---

## Compatibility

| | Supported |
|---|---|
| **Browsers** | Chrome, Brave, Edge (Chromium-based) |
| **Sites** | Chess.com, Lichess.org |
| **OS** | Windows 10 / 11 |
| **Overlay Mode** | Windows only (native .exe) |

---

## Screenshots

<p align="center">
  <img src="ss1.png" alt="Chessist eval bar and settings popup" width="700">
  <br><br>
  <img src="ss2.png" alt="Chessist in a live game with native engine" width="700">
</p>

## Features

- Real-time position evaluation bar (Chess.com and Lichess)
- Score in pawns format (e.g., +1.5) with depth indicator
- Best move arrow — plus optional alternative move arrows
- **Overlay Mode** — transparent native window drawn over the board, invisible to screen capture
- Works on live games, spectating, analysis, and archived games
- Auto-move and smart timing
- Configurable engine depth and skill level
- Native Stockfish support for 10–100× faster analysis
- Runs entirely locally — no server, no account required

---

## Quick Start

### 1. Download

```
git clone https://github.com/lurimous/Chessist.git
```

### 2. Load the extension

1. Go to `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked** → select the `Chessist` folder
4. The Chessist icon appears in your toolbar — copy the extension ID shown below the name

### 3. Run setup

**Requirements before running:**
- **Python 3** in PATH ([python.org](https://www.python.org/downloads/) — check "Add to PATH" during install)
- **Stockfish** ([stockfishchess.org/download](https://stockfishchess.org/download/))

Run **`setup.bat`** from the root of the repo:

```
setup.bat
```

It will:
1. Check Python is installed
2. Install the `websockets` Python package
3. Set up Stockfish (or let you point to your `.exe`)
4. Ask for your extension ID and register the native messaging host
5. Optionally add the overlay to Windows startup

### 4. Play

1. Restart your browser
2. Click the Chessist icon → select **Native** under Engine — status should show **Connected**
3. Open any game on [chess.com](https://www.chess.com) or [lichess.org](https://lichess.org)

---

## Overlay Mode

Overlay Mode renders the evaluation bar and move arrows in a **transparent native window** that sits on top of the browser. The browser-side UI is hidden, making Chessist invisible to screen capture and recording tools.

### Starting the overlay

The overlay launches automatically when you enable Overlay Mode — or run manually:

```
start.bat
```

The overlay minimizes to the **system tray** (bottom right). Right-click → Quit to exit.

### Overlay status

When Overlay Mode is enabled the popup shows a live status dot:

- 🟢 **Overlay connected** — overlay is running and receiving data
- 🔴 **Overlay not running** — run `start.bat` to launch it

### Updates

The overlay checks for updates on startup. A tray notification appears if a newer version is available on GitHub.

---

## Configuration

| Setting | Description |
|---|---|
| **Skill Level** | 1–20. Lower values allow occasional suboptimal moves |
| **Engine Depth** | How deep Stockfish searches (higher = stronger, slower) |
| **Show Best Move** | Draw an arrow for the top engine move |
| **Show Alternative Arrows** | Draw arrows for 2nd and 3rd best moves |
| **Auto Move** | Automatically play the best move |
| **Overlay Mode** | Use transparent native window instead of browser UI |
| **Player Color** | Auto-detect, or force White/Black perspective |

---

## Project Structure

```
Chessist/
├── setup.bat               # First-time setup (run this)
├── start.bat               # Launch overlay manually
├── dev/
│   ├── rebuild.bat         # Rebuild overlay from source
│   └── start_debug.bat     # Launch overlay with debug console
├── manifest.json
├── src/
│   ├── content/
│   │   ├── content.js      # Chess.com board detection & eval
│   │   ├── lichess.js      # Lichess board detection & eval
│   │   └── content.css
│   ├── background/
│   │   └── service-worker.js
│   ├── engine/             # Stockfish WASM (built-in engine)
│   ├── offscreen/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── options/
├── native-host/
│   ├── stockfish_host.py   # Native messaging host
│   ├── chessist_overlay.py # Overlay tray app (WebSocket server)
│   ├── chessist_overlay.bat
│   ├── stockfish_host.bat
│   └── dist/               # Built exe (after running setup.bat)
└── icons/
```

---

## Troubleshooting

**Eval bar doesn't appear**
- Make sure you're on chess.com or lichess.org
- Refresh the page
- Check the extension is enabled in `chrome://extensions`

**Native engine not connecting**
- Run `setup.bat` again and make sure the extension ID is correct
- Verify Python 3 is in PATH: `python --version` in a terminal
- Verify Stockfish is in PATH: `stockfish` in a terminal, or set `STOCKFISH_PATH` env var

**Overlay not showing**
- Check the tray icon area (click `^` in the taskbar corner)
- Run `start.bat` manually and check for errors in the console
- Windows Defender may flag the exe — if so, allow it or build from source: `dotnet build overlay\ChessistOverlay.csproj -c Release`

**"Extension context invalidated" error**
- Refresh the chess page — this happens when Chrome restarts the service worker after a long session

---

## Credits

- Created by [lurimous](https://github.com/lurimous/)
- Powered by [Stockfish](https://stockfishchess.org/)
- WASM build from [lichess-org/stockfish.js](https://github.com/lichess-org/stockfish.js)

## License

MIT
