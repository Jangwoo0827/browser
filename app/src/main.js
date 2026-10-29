// Fjord (Electron shell): one frameless window = our own chrome UI (rail, tab strip, toolbar) as the bottom view, and
// every tab is a WebContentsView stacked on top of it in the content area. Workspaces are lists of tabs: switching
// swaps which list is shown (no extra windows, no tab groups).
const { app, BaseWindow, WebContentsView, ipcMain, session, protocol, net, nativeTheme, Menu, shell, clipboard, Notification, dialog, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Store, ICONS } = require("./store");

protocol.registerSchemesAsPrivileged([
  { scheme: "fjord", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const RAIL_W = 52;
const TAB_H = 38;
const TOOL_H = 42;
const BAR_H = 34; // bookmark bar
const topH = () => TAB_H + TOOL_H + (store && store.data.settings.bookmarkBar ? BAR_H : 0);
const TEST = !!process.env.FJORD_TEST;
const PARTITION = "persist:fjord";
const NEWTAB = "fjord://app/newtab.html";
const { fitBounds } = require("./windowstate");
const ROOT = path.join(__dirname, "..");
const MOUNTS = { app: path.join(ROOT, "renderer"), shared: path.join(ROOT, "..", "extensions", "fjord", "ui") };

let win = null;
let ui = null;          // WebContentsView with our chrome UI
let store = null;
const views = new Map(); // tabId -> WebContentsView (created lazily)
const meta = new Map();  // tabId -> { loading, canGoBack, canGoForward }
let attached = null;     // tab id whose view is currently in the window
let notifyTimer = null;
let overlay = null;      // transparent view above the page for popups (suggestions, find bar, downloads)
let overlayShown = false;
let overlayKind = null;
let findSeq = 0;         // find requests issued / answered (the first request after focus moves is sometimes dropped)
let findAnswered = 0;
let fullscreen = false;  // the window is full screen (F11 or an element asked for it): the chrome is hidden
let pageFullscreen = false; // ... because the page asked (video player), so leaving that ends it too
const downloads = [];    // { id, name, path, received, total, state, startedAt }
const downloadItems = new Map();

// ---- fjord:// protocol (renderer files and the shared design tokens) -----------------------------
function registerProtocol(ses) {
  ses.protocol.handle("fjord", (request) => {
    const url = new URL(request.url);
    const root = MOUNTS[url.hostname];
    if (!root) return new Response("not found", { status: 404 });
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---- helpers ------------------------------------------------------------------------------
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function toUrl(input) {
  const s = String(input || "").trim();
  if (!s) return NEWTAB;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|file|view-source):/i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s) || (/^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(s) && !/\s/.test(s))) return "https://" + s;
  return store ? store.searchUrl(s) : "https://www.google.com/search?q=" + encodeURIComponent(s);
}

// error.html?kind=...&url=<the address that failed>: the address bar shows the original address, not the error page
function errorTarget(url) {
  if (!url || !url.startsWith("fjord://app/error.html")) return null;
  try { return new URL(url).searchParams.get("url") || null; } catch { return null; }
}

function showError(wc, kind, failedUrl, extra = {}) {
  if (wc.isDestroyed()) return;
  const q = new URLSearchParams({ kind, url: failedUrl || "", ...extra });
  wc.loadURL("fjord://app/error.html?" + q.toString()).catch(() => {});
}

const isNewTab = (url) => !url || url.startsWith("fjord://app/newtab");

function serialize() {
  const wsId = store.activeWs;
  const bucket = store.tabsOf(wsId);
  return {
    workspaces: store.workspaces.map((w) => ({ ...w, count: store.tabsOf(w.id).list.length })),
    activeWs: wsId,
    activeTab: bucket.active,
    tabs: bucket.list.map((t) => ({ ...t, ...(meta.get(t.id) || {}), isNewTab: isNewTab(t.url), shownUrl: errorTarget(t.url) })),
    fullscreen,
    settings: { showHome: !!store.data.settings.showHome },
    pinned: store.pinned,
    bookmarkBar: {
      visible: !!store.data.settings.bookmarkBar,
      folders: store.data.folders.filter((f) => f.parent === "bar"),
      items: store.data.bookmarks.filter((b) => b.folder === "bar"),
    },
    activeBookmark: (() => { const t = bucket.list.find((x) => x.id === bucket.active); const b = t && store.findBookmark(t.url); return b ? b.id : null; })(),
    downloads: { active: downloads.filter((d) => d.state === "progressing").length, total: downloads.length },
  };
}

function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send("state", serialize());
  }, 16);
  store.save();
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  ui.setBounds({ x: 0, y: 0, width: w, height: h });
  ui.setVisible(!fullscreen);
  const view = attached && views.get(attached);
  if (!view) return;
  if (fullscreen) view.setBounds({ x: 0, y: 0, width: w, height: h });
  else view.setBounds({ x: RAIL_W, y: topH(), width: Math.max(w - RAIL_W, 0), height: Math.max(h - topH(), 0) });
}

function setFullscreen(on, byPage = false) {
  if (!win || fullscreen === on) return;
  fullscreen = on;
  pageFullscreen = on && byPage;
  hideOverlay();
  if (!TEST) win.setFullScreen(on); // the hidden test window is never really switched
  layout();
  notify();
}

function applyTheme() {
  nativeTheme.themeSource = store.data.settings.theme;
  if (!win) return;
  const dark = nativeTheme.shouldUseDarkColors;
  const color = dark ? "#0f1115" : "#eceef2";
  try {
    win.setBackgroundColor(color);
    if (win.setTitleBarOverlay) win.setTitleBarOverlay({ color, symbolColor: dark ? "#c7ccd6" : "#3a3f4a", height: TAB_H });
  } catch {}
}

function downloadDir() {
  const chosen = store && store.data.settings.downloadDir;
  return process.env.FJORD_DOWNLOADS || (chosen && fs.existsSync(chosen) ? chosen : app.getPath("downloads"));
}

// ---- tabs ---------------------------------------------------------------------------------
function ensureView(tab) {
  let view = views.get(tab.id);
  if (view) return view;
  view = new WebContentsView({
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  views.set(tab.id, view);
  meta.set(tab.id, { loading: false, canGoBack: false, canGoForward: false });
  const wc = view.webContents;

  const refreshNav = () => {
    const m = meta.get(tab.id);
    if (!m || wc.isDestroyed()) return;
    m.canGoBack = wc.navigationHistory.canGoBack();
    m.canGoForward = wc.navigationHistory.canGoForward();
  };

  wc.setWindowOpenHandler(({ url }) => {
    createTab(store.activeWs, url, { afterActive: true });
    return { action: "deny" };
  });
  wc.on("page-title-updated", (_e, title) => { tab.title = title; notify(); });
  wc.on("page-favicon-updated", (_e, favicons) => { tab.favicon = favicons[0] || ""; notify(); });
  wc.on("did-start-loading", () => { meta.get(tab.id).loading = true; notify(); });
  wc.on("did-stop-loading", () => { meta.get(tab.id).loading = false; refreshNav(); notify(); });
  wc.on("did-navigate", (_e, url) => { tab.url = url; refreshNav(); notify(); });
  wc.on("did-navigate-in-page", (_e, url, isMain) => { if (isMain) { tab.url = url; refreshNav(); notify(); } });
  wc.on("render-process-gone", (_e, details) => {
    const m = meta.get(tab.id);
    if (m) m.loading = false;
    if (details.reason !== "clean-exit" && !wc.isDestroyed()) {
      const failed = errorTarget(tab.url) || tab.url;
      setImmediate(() => showError(wc, "crash", failed));
    }
    notify();
  });
  wc.on("did-fail-load", (_e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3 || !failedUrl || failedUrl.startsWith("fjord://")) return; // -3: the navigation was replaced
    setImmediate(() => showError(wc, "load", failedUrl, { code: String(code), desc }));
  });
  wc.on("enter-html-full-screen", () => setFullscreen(true, true));
  wc.on("leave-html-full-screen", () => { if (pageFullscreen) setFullscreen(false); });
  wc.on("audio-state-changed", () => { const m = meta.get(tab.id); if (m) { m.audible = wc.isCurrentlyAudible(); m.muted = wc.audioMuted; notify(); } });
  wc.on("did-navigate", (_e, url) => store.addHistory(url, tab.title));
  wc.on("page-title-updated", (_e, title) => store.updateHistoryTitle(tab.url, title));
  wc.on("found-in-page", (_e, r) => {
    if (!overlay || overlayKind !== "find") return;
    findAnswered = findSeq;
    overlay.webContents.send("found", { active: r.activeMatchOrdinal, total: r.matches });
    if (r.finalUpdate) overlay.webContents.focus(); // findInPage only works while the page has focus: hand it back to the find box
  });
  wc.on("context-menu", (_e, params) => pageMenu(wc, params).popup({ window: win }));
  wc.on("before-input-event", (event, input) => { if (handleShortcut(input)) event.preventDefault(); });

  wc.loadURL(tab.url || NEWTAB).catch(() => {});
  return view;
}

function attach(tabId) {
  hideOverlay();
  const view = tabId && views.get(tabId);
  if (attached === tabId && view) return layout();
  if (attached && views.get(attached)) win.contentView.removeChildView(views.get(attached));
  attached = null;
  if (!view) return;
  win.contentView.addChildView(view);
  attached = tabId;
  layout();
  if (!TEST) view.webContents.focus();
}

function createTab(wsId, url, { activate = true, afterActive = false, afterId = null, pinned = false } = {}) {
  const bucket = store.tabsOf(wsId);
  const tab = { id: newId(), url: url || NEWTAB, title: "", favicon: "", pinned };
  const pinnedCount = bucket.list.filter((t) => t.pinned).length; // pinned tabs always stay at the front
  let at = bucket.list.length;
  const ref = afterId || (afterActive ? bucket.active : null);
  if (pinned) at = pinnedCount;
  else if (ref) {
    const i = bucket.list.findIndex((t) => t.id === ref);
    if (i >= 0) at = i + 1;
  }
  bucket.list.splice(Math.max(at, pinned ? 0 : pinnedCount), 0, tab);
  if (activate) activateTab(tab.id);
  else notify();
  return tab;
}

function activateTab(tabId) {
  const found = store.findTab(tabId);
  if (!found) return;
  if (found.wsId !== store.activeWs) store.activeWs = found.wsId;
  found.bucket.active = tabId;
  ensureView(found.tab);
  attach(tabId);
  notify();
}

function closeTab(tabId) {
  const found = store.findTab(tabId);
  if (!found) return;
  const { bucket, wsId } = found;
  const idx = bucket.list.findIndex((t) => t.id === tabId);
  if (!isNewTab(found.tab.url)) store.pushClosed({ url: found.tab.url, title: found.tab.title, favicon: found.tab.favicon, ws: wsId, pinned: !!found.tab.pinned });
  bucket.list.splice(idx, 1);
  const view = views.get(tabId);
  if (view) {
    if (attached === tabId) {
      win.contentView.removeChildView(view);
      attached = null;
    }
    views.delete(tabId);
    view.webContents.close();
  }
  meta.delete(tabId);
  if (bucket.active === tabId) {
    const next = bucket.list[Math.min(idx, bucket.list.length - 1)];
    bucket.active = next ? next.id : null;
  }
  if (wsId === store.activeWs) {
    if (!bucket.list.length) createTab(wsId, NEWTAB);
    else activateTab(bucket.active);
  }
  notify();
}

function switchWorkspace(wsId) {
  if (!store.workspaces.some((w) => w.id === wsId)) return;
  store.activeWs = wsId;
  const bucket = store.tabsOf(wsId);
  if (!bucket.list.length) return void createTab(wsId, NEWTAB);
  if (!bucket.list.some((t) => t.id === bucket.active)) bucket.active = bucket.list[0].id;
  activateTab(bucket.active);
}

function nextWorkspace(step = 1) {
  const i = store.workspaces.findIndex((w) => w.id === store.activeWs);
  switchWorkspace(store.workspaces[(i + step + store.workspaces.length) % store.workspaces.length].id);
}

function deleteWorkspace(wsId) {
  if (store.workspaces.length <= 1) return { error: "마지막 워크스페이스는 삭제할 수 없어요." };
  const rest = store.workspaces.filter((w) => w.id !== wsId);
  const dest = store.tabsOf(rest[0].id);
  const gone = store.tabsOf(wsId);
  for (const tab of gone.list) dest.list.push(tab); // keep the tabs: they move to the first remaining workspace
  delete store.data.tabs[wsId];
  store.data.workspaces = rest;
  if (store.activeWs === wsId) store.activeWs = rest[0].id;
  switchWorkspace(store.activeWs);
  return {};
}

function moveTab(tabId, toWs) {
  const found = store.findTab(tabId);
  if (!found || found.wsId === toWs || !store.workspaces.some((w) => w.id === toWs)) return;
  const idx = found.bucket.list.indexOf(found.tab);
  found.bucket.list.splice(idx, 1);
  store.tabsOf(toWs).list.push(found.tab);
  if (found.bucket.active === tabId) found.bucket.active = (found.bucket.list[Math.min(idx, found.bucket.list.length - 1)] || {}).id || null;
  if (found.wsId === store.activeWs) {
    if (attached === tabId) {
      win.contentView.removeChildView(views.get(tabId));
      attached = null;
    }
    if (!found.bucket.list.length) createTab(found.wsId, NEWTAB);
    else activateTab(found.bucket.active);
  }
  notify();
}

const activeTabId = () => store.tabsOf(store.activeWs).active;
const activeContents = () => {
  const v = views.get(activeTabId());
  return v && !v.webContents.isDestroyed() ? v.webContents : null;
};

// ---- page context menu -----------------------------------------------------------------------------
function pageMenu(wc, params) {
  const items = [];
  const openTab = (url) => createTab(store.activeWs, url, { afterActive: true });
  if (params.linkURL) {
    items.push({ label: "새 탭에서 링크 열기", click: () => openTab(params.linkURL) });
    items.push({ label: "링크 주소 복사", click: () => clipboard.writeText(params.linkURL) });
  }
  if (params.mediaType === "image" && params.srcURL) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "새 탭에서 이미지 열기", click: () => openTab(params.srcURL) });
    items.push({ label: "이미지 주소 복사", click: () => clipboard.writeText(params.srcURL) });
    items.push({ label: "이미지 저장", click: () => wc.downloadURL(params.srcURL) });
  }
  if (params.isEditable) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "실행 취소", role: "undo" }, { label: "다시 실행", role: "redo" }, { type: "separator" },
      { label: "잘라내기", role: "cut" }, { label: "복사", role: "copy" }, { label: "붙여넣기", role: "paste" }, { label: "모두 선택", role: "selectAll" });
  } else if (params.selectionText) {
    if (items.length) items.push({ type: "separator" });
    const short = params.selectionText.trim().slice(0, 24);
    items.push({ label: "복사", role: "copy" });
    items.push({ label: `${store.engineName()}에서 "${short}" 검색`, click: () => openTab(toUrl(params.selectionText)) });
  }
  if (!items.length) {
    items.push({ label: "뒤로", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: "앞으로", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: "새로고침", click: () => wc.reload() });
  }
  items.push({ type: "separator" },
    { label: "인쇄…", click: () => commands.print() },
    { label: "PDF로 저장", click: () => commands.printPdf() },
    { label: "페이지 소스 보기", click: () => openTab("view-source:" + wc.getURL()) },
    { label: "검사", click: () => wc.inspectElement(params.x, params.y) });
  return Menu.buildFromTemplate(items);
}

// ---- overlay: popups drawn above the page ---------------------------------------------------------
function ensureOverlay() {
  if (overlay) return;
  overlay = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  overlay.setBackgroundColor("#00000000");
  overlay.webContents.loadURL("fjord://app/overlay.html");
  overlay.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") { hideOverlay(); event.preventDefault(); }
    else if (handleShortcut(input)) event.preventDefault();
  });
  overlay.webContents.on("blur", () => { if (overlayKind === "downloads" || overlayKind === "prompt" || overlayKind === "tabsearch" || overlayKind === "bookmark") hideOverlay(); });
}

function showOverlay(kind, rect, payload) {
  if (!win) return;
  ensureOverlay();
  if (overlayShown) win.contentView.removeChildView(overlay);
  win.contentView.addChildView(overlay);
  overlayShown = true;
  overlayKind = kind;
  overlay.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
  overlay.webContents.send("show", { kind, payload });
  if (kind === "find" || kind === "downloads" || kind === "prompt" || kind === "tabsearch" || kind === "bookmark") overlay.webContents.focus();
}

function hideOverlay() {
  if (!overlayShown) return;
  win.contentView.removeChildView(overlay);
  overlayShown = false;
  if (overlayKind === "find") activeContents()?.stopFindInPage("clearSelection");
  overlayKind = null;
  const v = attached && views.get(attached);
  if (v && !TEST) v.webContents.focus();
}

function contentSize() {
  const [w, h] = win.getContentSize();
  return { w, h };
}

function showFind() {
  const { w } = contentSize();
  showOverlay("find", { x: w - 372, y: topH() + 8, width: 360, height: 52 });
}

// small text prompt (new workspace / rename). Drawn by the overlay: a modal <dialog> inside the bottom UI view would
// open *under* the page view, invisible, while still disabling the whole rail and tab strip.
function showPrompt(mode, id, value) {
  const { w } = contentSize();
  const width = 340;
  showOverlay("prompt", { x: Math.round((w - width) / 2), y: topH() + 48, width, height: 188 },
    { mode, id, value: value || "", title: mode === "add" ? "새 워크스페이스" : "워크스페이스 이름 변경" });
}

// ---- bookmarks ----------------------------------------------------------------------------------------
function showBookmarkEdit(bookmark) {
  const { w } = contentSize();
  const folders = store.data.folders.map((f) => ({ id: f.id, name: f.name }));
  showOverlay("bookmark", { x: w - 364, y: TAB_H + TOOL_H - 6, width: 348, height: 212 }, { bookmark, folders });
}

function toggleBookmarkForActiveTab() {
  const wc = activeContents();
  if (!wc) return;
  const url = wc.getURL();
  const tab = store.findTab(activeTabId());
  let b = store.findBookmark(url);
  if (!b) b = store.addBookmark({ title: (tab && tab.tab.title) || url, url, folder: "bar" });
  if (!b) return; // new-tab and internal pages are not bookmarkable
  notify();
  showBookmarkEdit(b);
}

function bookmarkMenuItems(list) {
  return list.length
    ? list.map((b) => ({ label: b.title.slice(0, 60), click: () => commands.navigate({ id: activeTabId(), input: b.url }) }))
    : [{ label: "(비어 있음)", enabled: false }];
}

// ---- tab operations -----------------------------------------------------------------------------------
function setPinned(id, pinned) {
  const f = store.findTab(id);
  if (!f) return;
  f.tab.pinned = pinned;
  const list = f.bucket.list;
  list.splice(list.indexOf(f.tab), 1);
  list.splice(list.filter((t) => t.pinned).length, 0, f.tab); // end of the pinned block (pin) / right after it (unpin)
  notify();
}

function closeWhere(id, pick) {
  const f = store.findTab(id);
  if (!f) return;
  const list = f.bucket.list;
  const i = list.indexOf(f.tab);
  list.filter((t, j) => !t.pinned && t.id !== id && pick(j, i)).map((t) => t.id).forEach((t) => closeTab(t));
}

function allTabs() {
  return store.workspaces.flatMap((w) => store.tabsOf(w.id).list.map((t) => ({ id: t.id, title: t.title || "", url: t.url, favicon: t.favicon, ws: w.id, wsName: w.name, isNewTab: isNewTab(t.url), pinned: !!t.pinned })));
}

function showTabSearch() {
  const { w } = contentSize();
  const width = 540;
  showOverlay("tabsearch", { x: Math.round((w - width) / 2), y: topH() + 10, width, height: 440 }, { tabs: allTabs(), active: activeTabId() });
}

function showDownloads() {
  const { w, h } = contentSize();
  showOverlay("downloads", { x: w - 396, y: topH() + 4, width: 384, height: Math.min(440, h - topH() - 16) }, { downloads });
}

function setZoom(delta) {
  const wc = activeContents();
  if (!wc) return;
  const level = delta === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
  const m = meta.get(activeTabId());
  if (m) m.zoom = Math.round(Math.pow(1.2, level) * 100);
  notify();
}

// ---- downloads -------------------------------------------------------------------------------------
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function pushDownloads() {
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.send("state", serialize());
  if (overlay && overlayKind === "downloads") overlay.webContents.send("downloads", downloads);
}

function onWillDownload(_event, item) {
  const dir = downloadDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = uniquePath(dir, item.getFilename() || "download");
  item.setSavePath(file);
  const d = { id: newId(), name: path.basename(file), path: file, received: 0, total: item.getTotalBytes(), state: "progressing", startedAt: Date.now() };
  downloads.unshift(d);
  downloadItems.set(d.id, item);
  item.on("updated", (_e, state) => {
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    d.state = state === "interrupted" ? "interrupted" : "progressing";
    pushDownloads();
  });
  item.once("done", (_e, state) => {
    d.state = state; // completed | cancelled | interrupted
    d.received = item.getReceivedBytes();
    downloadItems.delete(d.id);
    pushDownloads();
    if (state === "completed" && !TEST) new Notification({ title: "다운로드 완료", body: d.name }).show();
  });
  pushDownloads();
}

// ---- shortcuts ---------------------------------------------------------------------------
function handleShortcut(input) {
  if (input.type !== "keyDown") return false;
  const ctrl = input.control || input.meta;
  const key = input.key;
  const bucket = store.tabsOf(store.activeWs);
  const idx = bucket.list.findIndex((t) => t.id === bucket.active);
  const go = (d) => { const n = bucket.list.length; if (n) activateTab(bucket.list[(idx + d + n) % n].id); };

  if (key === "F11") commands.fullscreenToggle();
  else if (ctrl && !input.shift && !input.alt && key.toLowerCase() === "p") commands.print();
  else if (ctrl && !input.alt && key === ",") commands.openPage("settings");
  else if (input.alt && key === "Home") commands.home();
  else if (ctrl && !input.shift && !input.alt && key.toLowerCase() === "d") toggleBookmarkForActiveTab();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "b") commands.barToggle();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "o") commands.openPage("bookmarks");
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "t") commands.restoreClosed();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "a") showTabSearch();
  else if (ctrl && !input.alt && key.toLowerCase() === "t") { setFullscreen(false); createTab(store.activeWs, NEWTAB); }
  else if (ctrl && !input.alt && key.toLowerCase() === "w") closeTab(bucket.active);
  else if (ctrl && !input.alt && key.toLowerCase() === "l") { setFullscreen(false); ui.webContents.send("focus-address"); }
  else if ((ctrl && key.toLowerCase() === "r") || key === "F5") activeContents()?.reload();
  else if (input.alt && key === "ArrowLeft") activeContents()?.navigationHistory.goBack();
  else if (input.alt && key === "ArrowRight") activeContents()?.navigationHistory.goForward();
  else if (ctrl && key === "Tab") go(input.shift ? -1 : 1);
  else if (ctrl && /^[1-9]$/.test(key)) { const t = bucket.list[Number(key) === 9 ? bucket.list.length - 1 : Number(key) - 1]; if (t) activateTab(t.id); }
  else if (input.alt && key.toLowerCase() === "q") nextWorkspace(1);
  else if (ctrl && !input.alt && key.toLowerCase() === "f") showFind();
  else if (ctrl && !input.alt && (key === "=" || key === "+")) setZoom(0.5);
  else if (ctrl && !input.alt && (key === "-" || key === "_")) setZoom(-0.5);
  else if (ctrl && !input.alt && key === "0") setZoom(0);
  else if (ctrl && !input.alt && key.toLowerCase() === "h") commands.openPage("history");
  else if (ctrl && !input.alt && key.toLowerCase() === "j") showDownloads();
  else if (key === "F12" || (ctrl && input.shift && key.toLowerCase() === "i")) activeContents()?.toggleDevTools();
  else return false;
  return true;
}

// ---- commands from our own pages ----------------------------------------------------------------
const commands = {
  state: () => serialize(),
  newTab: (url) => void createTab(store.activeWs, url ? toUrl(url) : NEWTAB),
  closeTab: (id) => closeTab(id || activeTabId()),
  activate: (id) => activateTab(id),
  navigate: ({ id, input }) => {
    const found = store.findTab(id || activeTabId());
    if (!found) return;
    found.tab.url = toUrl(input);
    ensureView(found.tab).webContents.loadURL(found.tab.url).catch(() => {});
    notify();
  },
  back: () => activeContents()?.navigationHistory.goBack(),
  forward: () => activeContents()?.navigationHistory.goForward(),
  reload: () => activeContents()?.reload(),
  stop: () => activeContents()?.stop(),
  wsSwitch: (id) => switchWorkspace(id),
  wsAdd: (name) => { const r = store.addWorkspace(name); if (r.id) switchWorkspace(r.id); notify(); return r; },
  wsRename: ({ id, name }) => { const r = store.renameWorkspace(id, name); notify(); return r; },
  wsIcon: (id) => { store.cycleIcon(id); notify(); },
  wsDelete: (id) => { const r = deleteWorkspace(id); notify(); return r; },
  moveTab: ({ id, ws }) => moveTab(id, ws),
  openPinned: (id) => {
    const pin = store.pinned.find((p) => p.id === id);
    if (!pin) return;
    const bucket = store.tabsOf(store.activeWs);
    const existing = bucket.list.find((t) => { try { return new URL(t.url).origin === new URL(pin.url).origin; } catch { return false; } });
    if (existing) activateTab(existing.id);
    else createTab(store.activeWs, pin.url);
  },
  reorder: ({ id, beforeId }) => {
    const bucket = store.tabsOf(store.activeWs);
    const from = bucket.list.findIndex((t) => t.id === id);
    if (from < 0 || id === beforeId) return;
    const [tab] = bucket.list.splice(from, 1);
    const to = beforeId ? bucket.list.findIndex((t) => t.id === beforeId) : bucket.list.length;
    bucket.list.splice(to < 0 ? bucket.list.length : to, 0, tab);
    notify();
  },
  dial: () => store.pinned,
  settingsGet: () => ({ ...store.data.settings, downloadDirEffective: downloadDir() }),
  settingSet: ({ key, value }) => {
    const r = store.setSetting(key, value);
    if (r.error) return r;
    if (key === "theme") applyTheme();
    if (key === "bookmarkBar") layout();
    notify();
    return r;
  },
  pickDownloadDir: async () => {
    const r = await dialog.showOpenDialog(win, { title: "다운로드 폴더", defaultPath: downloadDir(), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return {};
    return commands.settingSet({ key: "downloadDir", value: r.filePaths[0] });
  },
  home: () => {
    const url = store.data.settings.homeUrl || NEWTAB;
    commands.navigate({ id: activeTabId(), input: url });
  },
  retry: (url) => {
    const wc = activeContents();
    if (wc && /^(https?|file):\/\//i.test(String(url || ""))) wc.loadURL(url).catch(() => {});
  },
  fullscreenToggle: () => setFullscreen(!fullscreen),
  print: () => {
    const wc = activeContents();
    if (wc && !TEST) wc.print({ printBackground: true });
  },
  printPdf: async () => {
    const wc = activeContents();
    if (!wc) return {};
    const data = await wc.printToPDF({ printBackground: true });
    const dir = downloadDir();
    fs.mkdirSync(dir, { recursive: true });
    const base = (wc.getTitle() || "page").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "page";
    const file = uniquePath(dir, base + ".pdf");
    fs.writeFileSync(file, data);
    downloads.unshift({ id: newId(), name: path.basename(file), path: file, received: data.length, total: data.length, state: "completed", startedAt: Date.now() });
    pushDownloads();
    return { path: file };
  },
  bookmarkToggle: () => toggleBookmarkForActiveTab(),
  bookmarkEditShow: () => {
    const t = store.findTab(activeTabId());
    const b = t && store.findBookmark(t.tab.url);
    if (b) showBookmarkEdit(b);
    else toggleBookmarkForActiveTab();
  },
  bookmarkAdd: (b) => { const r = store.addBookmark(b); notify(); return r; },
  bookmarkUpdate: ({ id, title, folder }) => { const r = store.updateBookmark(id, { title, folder }); notify(); return r; },
  bookmarkRemove: (id) => { store.removeBookmark(id); notify(); },
  bookmarkList: () => ({ bookmarks: store.data.bookmarks, folders: store.data.folders }),
  folderAdd: ({ name, parent }) => { const r = store.addFolder(name, parent); notify(); return r; },
  folderRename: ({ id, name }) => { const r = store.renameFolder(id, name); notify(); return r; },
  folderRemove: (id) => { store.removeFolder(id); notify(); },
  barToggle: () => { store.data.settings.bookmarkBar = !store.data.settings.bookmarkBar; layout(); notify(); },
  folderMenu: (id) => Menu.buildFromTemplate(bookmarkMenuItems(store.data.bookmarks.filter((b) => b.folder === id))).popup({ window: win }),
  bookmarkMenu: (id) => {
    const b = store.data.bookmarks.find((x) => x.id === id);
    if (!b) return;
    Menu.buildFromTemplate([
      { label: "새 탭에서 열기", click: () => createTab(store.activeWs, b.url, { afterActive: true }) },
      { label: "편집…", click: () => showBookmarkEdit(b) },
      { label: "주소 복사", click: () => clipboard.writeText(b.url) },
      { type: "separator" },
      { label: "삭제", click: () => commands.bookmarkRemove(id) },
    ]).popup({ window: win });
  },
  bookmarksExport: (target) => {
    const dir = downloadDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = target || uniquePath(dir, "fjord-bookmarks.html");
    fs.writeFileSync(file, store.exportHtml(), "utf8");
    return { path: file };
  },
  bookmarksImport: async (file) => {
    let target = file;
    if (!target) {
      const r = await dialog.showOpenDialog(win, { title: "북마크 가져오기", filters: [{ name: "북마크 HTML", extensions: ["html", "htm"] }], properties: ["openFile"] });
      if (r.canceled || !r.filePaths[0]) return { added: 0 };
      target = r.filePaths[0];
    }
    const res = store.importHtml(fs.readFileSync(target, "utf8"));
    notify();
    return res;
  },
  pinTab: (id) => { const f = store.findTab(id); if (f) setPinned(id, !f.tab.pinned); },
  duplicateTab: (id) => { const f = store.findTab(id); if (f) createTab(f.wsId, f.tab.url, { afterId: id }); },
  muteTab: (id) => {
    const f = store.findTab(id);
    if (!f) return;
    const wc = ensureView(f.tab).webContents;
    wc.setAudioMuted(!wc.audioMuted);
    meta.get(id).muted = wc.audioMuted;
    notify();
  },
  closeOthers: (id) => closeWhere(id, () => true),
  closeRight: (id) => closeWhere(id, (j, i) => j > i),
  closeLeft: (id) => closeWhere(id, (j, i) => j < i),
  restoreClosed: () => {
    const c = store.popClosed();
    if (!c) return;
    createTab(store.workspaces.some((w) => w.id === c.ws) ? c.ws : store.activeWs, c.url, { pinned: !!c.pinned });
  },
  tabSearchShow: () => showTabSearch(),
  suggest: (q) => store.suggest(q),
  history: () => store.data.history.slice(0, 500),
  historyClear: () => { store.clearHistory(); notify(); },
  openPage: (name) => {
    const url = `fjord://app/${name}.html`;
    const found = store.tabsOf(store.activeWs).list.find((t) => t.url === url);
    if (found) activateTab(found.id);
    else createTab(store.activeWs, url);
  },
  overlayShow: ({ kind, rect, payload }) => {
    if (kind !== "suggest" || !rect) return;
    showOverlay("suggest", { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 360) }, payload);
  },
  overlayUpdate: (payload) => { if (overlay && overlayKind === "suggest") overlay.webContents.send("show", { kind: "suggest", payload }); },
  overlayHide: () => hideOverlay(),
  promptShow: ({ mode, id, name }) => showPrompt(mode === "rename" ? "rename" : "add", id, name),
  promptSubmit: ({ mode, id, value }) => {
    const r = mode === "rename" ? commands.wsRename({ id, name: value }) : commands.wsAdd(value);
    if (r && r.error) return r; // keep the prompt open and show the message
    hideOverlay();
    return {};
  },
  find: async ({ text, forward = true, next = false, matchCase = false }) => {
    const wc = activeContents();
    if (!wc) return;
    if (!text) { wc.stopFindInPage("clearSelection"); overlay?.webContents.send("found", { active: 0, total: 0 }); return; }
    if (!wc.isFocused()) { // Chromium searches the focused frame; focusing is asynchronous, so give it a moment
      wc.focus();
      await new Promise((r) => setTimeout(r, 90));
    }
    const run = () => wc.findInPage(text, { forward, findNext: next, matchCase }); // the found-in-page handler hands focus back to the find box
    const mine = ++findSeq;
    run();
    setTimeout(() => { if (findAnswered < mine && findSeq === mine && !wc.isDestroyed()) run(); }, 250); // retry once when no answer came
  },
  findShow: () => showFind(),
  downloadsPanel: () => (overlayKind === "downloads" ? hideOverlay() : showDownloads()),
  dlOpen: (id) => { const d = downloads.find((x) => x.id === id); if (d) shell.openPath(d.path); },
  dlShow: (id) => { const d = downloads.find((x) => x.id === id); if (d) shell.showItemInFolder(d.path); },
  dlCancel: (id) => downloadItems.get(id)?.cancel(),
  dlClear: () => { for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== "progressing") downloads.splice(i, 1); pushDownloads(); },
  dlList: () => downloads,
  zoomReset: () => setZoom(0),
  wsMenu: (id) => {
    const ws = store.workspaces.find((w) => w.id === id);
    if (!ws) return;
    Menu.buildFromTemplate([
      { label: "이름 변경…", click: () => showPrompt("rename", id, ws.name) },
      { label: "아이콘 바꾸기", click: () => commands.wsIcon(id) },
      { type: "separator" },
      { label: "삭제", enabled: store.workspaces.length > 1, click: () => commands.wsDelete(id) },
    ]).popup({ window: win });
  },
  tabMenu: (id) => {
    const found = store.findTab(id);
    if (!found) return;
    const list = found.bucket.list;
    const i = list.indexOf(found.tab);
    const muted = !!(meta.get(id) && meta.get(id).muted);
    Menu.buildFromTemplate([
      { label: "새로고침", click: () => ensureView(found.tab).webContents.reload() },
      { label: "탭 복제", click: () => commands.duplicateTab(id) },
      { label: found.tab.pinned ? "탭 고정 해제" : "탭 고정", click: () => commands.pinTab(id) },
      { label: muted ? "탭 음소거 해제" : "탭 음소거", click: () => commands.muteTab(id) },
      { type: "separator" },
      ...store.workspaces.filter((w) => w.id !== found.wsId).map((w) => ({ label: `${w.name}(으)로 옮기기`, click: () => moveTab(id, w.id) })),
      { type: "separator" },
      { label: "탭 닫기", click: () => closeTab(id) },
      { label: "다른 탭 닫기", enabled: list.length > 1, click: () => commands.closeOthers(id) },
      { label: "왼쪽 탭 닫기", enabled: i > 0, click: () => commands.closeLeft(id) },
      { label: "오른쪽 탭 닫기", enabled: i < list.length - 1, click: () => commands.closeRight(id) },
      { label: "닫은 탭 다시 열기", enabled: store.data.closed.length > 0, click: () => commands.restoreClosed() },
    ]).popup({ window: win });
  },
};

ipcMain.handle("cmd", (event, name, arg) => {
  const url = event.senderFrame && event.senderFrame.url;
  if (!url || !url.startsWith("fjord://")) throw new Error("forbidden");
  const fn = commands[name];
  if (!fn) throw new Error("unknown command " + name);
  return fn(arg);
});

// ---- window --------------------------------------------------------------------------------------
function createWindow() {
  const saved = fitBounds(store.data.window, screen.getAllDisplays().map((d) => d.workArea));
  win = new BaseWindow({
    ...(saved || { width: 1280, height: 800 }),
    minWidth: 720,
    minHeight: 480,
    show: !TEST,
    backgroundColor: "#0f1115",
    title: "Fjord",
    icon: path.join(ROOT, "..", "assets", "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0f1115", symbolColor: "#c7ccd6", height: TAB_H },
  });
  ui = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  win.contentView.addChildView(ui);
  ui.webContents.on("before-input-event", (event, input) => { if (handleShortcut(input)) event.preventDefault(); });
  win.on("resize", layout);
  let boundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isMinimized() || win.isFullScreen()) return;
      store.data.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      store.save();
    }, 500);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, rememberBounds);
  win.on("leave-full-screen", () => { if (fullscreen) setFullscreen(false); });
  if (store.data.window && store.data.window.maximized && !TEST) win.maximize();
  win.on("closed", () => { win = null; });
  ui.webContents.loadURL("fjord://app/index.html");
  layout();

  const bucket = store.tabsOf(store.activeWs);
  if (!bucket.list.length) createTab(store.activeWs, !store.crashed && store.data.settings.startup === "home" && store.data.settings.homeUrl ? store.data.settings.homeUrl : NEWTAB);
  else {
    if (!bucket.list.some((t) => t.id === bucket.active)) bucket.active = bucket.list[0].id;
    activateTab(bucket.active);
  }
}

app.setAppUserModelId("Fjord.App");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "system";
  store = new Store(path.join(process.env.FJORD_USER_DATA || app.getPath("userData"), "state.json"));
  if (!store.crashed && store.data.settings.startup !== "restore") store.dropUnpinnedTabs(); // after a crash always bring the tabs back
  store.save(true); // marks this run as "running"; before-quit clears it
  const ses = session.fromPartition(PARTITION);
  // present as a normal Chrome: sites (Google sign-in ...) refuse the "Electron" token
  const ua = app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\sfjord-app\/\S+/i, "");
  ses.setUserAgent(ua);
  ses.on("will-download", onWillDownload);
  registerProtocol(ses);
  registerProtocol(session.defaultSession);
  createWindow();
  applyTheme();
  nativeTheme.on("updated", applyTheme);
  if (TEST) global.__fjord = { commands, serialize, store, ui: () => ui, win: () => win, views, attached: () => attached, overlay: () => overlay, overlayKind: () => overlayKind, downloads, topH, RAIL_W, handleShortcut, createTab, isFullscreen: () => fullscreen };
  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("before-quit", () => { if (store) { store.data.running = false; store.save(true); } });
app.on("window-all-closed", () => app.quit());

module.exports = { topH, RAIL_W, ICONS };
