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

## Browser basics (stage 2)
- **Overlay view**: a transparent `WebContentsView` above the page hosts popups the bottom UI view cannot draw over the page:
  address suggestions, find bar, downloads panel (`renderer/overlay.*`). Only popup-sized bounds are covered; it hides on tab switch / Esc.
- Address bar: suggestions from pinned sites + history (`Store.suggest`), arrow keys + Enter, "search" row.
- History (`Ctrl+H` → `fjord://app/history.html`, search + clear), saved with the state (max 5000 URLs).
- Find in page (`Ctrl+F`), zoom (`Ctrl+=`/`-`/`0`, badge in the toolbar), downloads (auto-save to Downloads, `Ctrl+J` panel, open / show in folder / cancel, native notification), page context menu (links, images, selection, editable fields, view source, inspect).
- **Rule**: anything that must appear above the page (menus, prompts, dropdowns, toasts) is drawn by the overlay view. A `<dialog>`/popup inside the bottom UI view is hidden behind the page view while a modal one still disables the rail and tab strip.
- Known quirk: Chromium searches the focused frame, so `find` focuses the page for the request and hands focus back to the find box when results arrive (`found-in-page`); the request is retried once when no answer comes.

## Run / test
- `cd app && npm install && npm start`; desktop shortcut: `scripts/make-app-shortcut.ps1` ("Fjord (app)").
- `npm run smoke` runs the real app against a local HTTP server (23 checks: tabs, workspaces, move/close, history, suggestions, find,
  zoom, download, popups, persistence) and writes `logs/app-ui.png`, `app-content.png`, `app-suggest.png`, `app-downloads.png`.
  The window is shown invisibly (opacity 0, off-taskbar, not activated); nothing appears on screen, but because it is never activated
  Chromium may drop the first find request, so the test asks up to three times.

## What you give up compared to the Chromium build (honest list)
- **Chrome extensions**: Electron implements only a small part of the extension API, so the Claude extension (side panel, tab
  control, native messaging for Claude Code `/chrome`) does not work here, nor does the stand-alone ad blocker (declarativeNetRequest).
  Replacements have to be built into the app (ad blocking via `webRequest`, Claude as a side-panel page).
- Google account sync, built-in password manager/autofill, DRM video (Widevine) and automatic Chromium security updates:
  updates now mean bumping Electron.

## Roadmap
1. Done: shell, tabs, workspaces, rail, new tab page, persistence, smoke test.
2. Done: downloads, find, zoom, context menu, history, address suggestions. Since then: tab features, bookmarks, settings page, print/fullscreen/window state, error pages, permission prompts, site info, popup blocking, certificate errors (M1 done). Still open: see `docs/feature-checklist.md` (M2+).
3. Built-ins: ad blocking (lists + `webRequest`), Claude side panel (claude.ai in a right-hand view), pinned-site panel.
4. Packaging: electron-builder installer, branded exe icon, GitHub Releases + auto-update.

## 여러 창 구조 (M2c)
- 창마다 `ctx` 객체(`createWindow`)가 있고, `main.js`의 모듈 변수(`win, ui, overlay, attached, views, meta, ts ...`)는 **현재 창**의 값이다. `inCtx(ctx, fn)`이 값을 바꿔 끼운다.
- 나중에 실행되는 코드(이벤트 핸들러, 타이머, 메뉴 클릭, `await` 이후)는 반드시 `inCtx` / `later()` / `popupMenu()`를 거쳐야 올바른 창에서 돈다. 웹 컨텐츠 이벤트는 `ensureView` 안의 `on()` 헬퍼가 처리.
- 탭/워크스페이스 데이터는 `ts`(프로필 저장소 또는 메모리 전용 저장소), 프로필 공통 데이터(설정/북마크/기록/권한/줌)는 `store`, 시크릿/게스트 창의 권한·줌은 `ps()`로 창 쪽 저장소를 쓴다.
- 파티션: 일반 `persist:fjord`, 시크릿 `fjord-private`, 게스트 `fjord-guest`(메모리 전용). 세션 훅은 `ensureSession(partition)`이 한 번씩 설치.
