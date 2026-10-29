# Fjord as an Electron app (`app/`)

Why: the Chromium + extension build cannot change the tab strip, toolbar or tab groups (they are native Chromium UI).
In an Electron shell the whole browser UI is ours (HTML/CSS), while pages still render in Chromium. This runs **alongside**
the extension build (`extensions/fjord`, `scripts/launch.ps1`), which keeps working.

## Architecture
- One frameless `BaseWindow`. Bottom view = our chrome UI (`renderer/index.html`: left rail, tab strip, toolbar). Each tab is a
  `WebContentsView` placed on top of it in the content area (`src/main.js`). Only the active tab's view is attached; tab views
  are created lazily after a restart.
- Workspaces are separate tab lists (`src/store.js`, `state.json` in userData). Switching swaps the visible list: no extra
  windows, no tab groups. Tab URLs/titles persist; `Alt+Q` next workspace; right-click a workspace icon or a tab for a menu.
- `fjord://app/*` serves `renderer/`, `fjord://shared/*` serves `extensions/fjord/ui` (the same design tokens as the extension).
  Only `fjord://` pages get the `window.fjord` command API (`src/preload.js`); the main process rejects commands from other origins.
- Sites see a normal Chrome user agent (the `Electron/...` token is removed).
- Shortcuts: Ctrl+T/W/L/R/Tab, Ctrl+1..9, Alt+←/→, Alt+Q, F12.

## Run / test
- `cd app && npm install && npm start`; desktop shortcut: `scripts/make-app-shortcut.ps1` ("Fjord (app)").
- `npm run smoke` runs the real app with a hidden window (11 checks: tabs, workspaces, move/close, persistence) and writes
  `logs/app-ui.png` / `logs/app-content.png`. Screenshots use an invisible (opacity 0, off-taskbar) window; nothing appears on screen.

## What you give up compared to the Chromium build (honest list)
- **Chrome extensions**: Electron implements only a small part of the extension API, so the Claude extension (side panel, tab
  control, native messaging for Claude Code `/chrome`) does not work here, nor does the stand-alone ad blocker (declarativeNetRequest).
  Replacements have to be built into the app (ad blocking via `webRequest`, Claude as a side-panel page).
- Google account sync, built-in password manager/autofill, DRM video (Widevine) and automatic Chromium security updates:
  updates now mean bumping Electron.

## Roadmap
1. Done: shell, tabs, workspaces, rail, new tab page, persistence, smoke test.
2. Browser basics: downloads, find in page (Ctrl+F), zoom, context menu (copy/open link), permissions prompts, history/bookmarks, settings page, dark/light switch.
3. Built-ins: ad blocking (lists + `webRequest`), Claude side panel (claude.ai in a right-hand view), pinned-site panel.
4. Packaging: electron-builder installer, branded exe icon, GitHub Releases + auto-update.
