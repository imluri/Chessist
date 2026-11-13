# Desktop UI template

A standalone React preview of the title bar, sidebar, and settings controls for the planned Chessist 3.0.0 UI. Try the sample settings in the preview before integrating the shell into Chessist.

From this directory, with Bun 1.3.10 or newer:

```sh
bun install
bun run dev
```

Open the URL printed by Bun. To open the same interface in a native Electron window, run `bun run desktop` with Node.js 22.12 or newer available for Electron's launcher. The first run downloads the Electron binary. The title bar controls minimize, maximize, and close that window.

Run `bun run preview:html` to build a self-contained browser preview at `dist/preview/index.html`. Open it directly in your browser to try the controls.

Bun builds the React renderer. Electron serves that build from a local protocol and exposes only the window controls through its preload bridge. Browser previews use the same renderer and require no Electron APIs.

For another app, pass its branding, navigation, window controls, and page content to `DesktopShell`. Give `SettingsPanel` your settings groups, current values, and change handler. The preview's sample settings and local storage are in `src/demoSettings.js` and `src/main.jsx`.
