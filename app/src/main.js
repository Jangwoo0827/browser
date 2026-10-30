// Fjord (Electron shell): one frameless window = our own chrome UI (rail, tab strip, toolbar) as the bottom view, and
// every tab is a WebContentsView stacked on top of it in the content area. Workspaces are lists of tabs: switching
// swaps which list is shown (no extra windows, no tab groups).
const { app, BaseWindow, WebContentsView, ipcMain, session, protocol, net, nativeTheme, Menu, shell, clipboard, Notification, dialog, screen, webContents } = require("electron");
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
const barVisible = () => !!(store && store.data.settings.bookmarkBar && !(CUR && CUR.kind === "guest"));
const topH = () => TAB_H + TOOL_H + (barVisible() ? BAR_H : 0);
const TEST = !!process.env.FJORD_TEST;
const PARTITION = "persist:fjord";
const NEWTAB = "fjord://app/newtab.html";
const { fitBounds } = require("./windowstate");
const perms = require("./permissions");
const { Blocker, sameSite } = require("./blocker");
const ROOT = path.join(__dirname, "..");
const MOUNTS = { app: path.join(ROOT, "renderer"), shared: path.join(ROOT, "..", "extensions", "fjord", "ui") };

let win = null;
let ui = null;          // WebContentsView with our chrome UI
let store = null;
let views = new Map();   // tabId -> WebContentsView (created lazily)
let meta = new Map();    // tabId -> { loading, canGoBack, canGoForward }
let attached = null;     // tab id whose view is currently in the window
let notifyTimer = null;
let overlay = null;      // transparent view above the page for popups (suggestions, find bar, downloads)
let overlayShown = false;
let overlayKind = null;
let findSeq = 0;         // find requests issued / answered (the first request after focus moves is sometimes dropped)
let findAnswered = 0;
let blocker = new Blocker();
const wcTab = new Map(); // webContents id -> tab id (for per-tab blocked counts)
let pendingPerms = []; // permission requests waiting for an answer: { id, tabId, origin, key, label, callback }
let shownPermId = null;
const certAllowed = new Set(); // origins the user chose to open despite a certificate error (this run only)
const lastGesture = new Map(); // tabId -> time of the last click/key in that page (popup blocking)
let fullscreen = false;  // the window is full screen (F11 or an element asked for it): the chrome is hidden
let pageFullscreen = false; // ... because the page asked (video player), so leaving that ends it too
const downloads = [];    // { id, name, path, received, total, state, startedAt }
const downloadItems = new Map();

// ---- window contexts ------------------------------------------------------------------------------------
// Every browser window has a ctx: its BaseWindow, chrome view, overlay, tab views and tab store. The module-level variables
// above always describe the *current* ctx, and inCtx() switches them, so the code below reads like single-window code.
// Anything that runs later (events, timers, menu clicks) must come back through inCtx / later / popupMenu.
let ts = null;            // tab store of the current window: the profile store (main window) or an in-memory one
let isPrivate = false;    // the current window is a private or guest window
let CUR = null;
let mainCtx = null;
let ctxSeq = 0;
const ctxs = new Set();
const wcCtx = new Map();  // webContents id -> ctx

function saveCtx(c) {
  Object.assign(c, { win, ui, overlay, overlayShown, overlayKind, attached, fullscreen, pageFullscreen, shownPermId, findSeq, findAnswered });
}

function loadCtx(c) {
  ({ win, ui, overlay, overlayShown, overlayKind, attached, fullscreen, pageFullscreen, shownPermId, findSeq, findAnswered, views, meta, pendingPerms, ts } = c);
  isPrivate = c.private;
  CUR = c;
}

function inCtx(c, fn) {
  if (!c || c === CUR) return fn();
  const prev = CUR;
  if (prev) saveCtx(prev);
  loadCtx(c);
  try {
    return fn();
  } finally {
    saveCtx(c);
    if (prev && ctxs.has(prev)) loadCtx(prev);
  }
}

// run fn in the window that is current now, after ms (it is skipped when that window has been closed meanwhile)
function later(fn, ms = 0) {
  const c = CUR;
  return setTimeout(() => { if (!c || ctxs.has(c)) inCtx(c, fn); }, ms);
}

// private/guest windows keep decisions (permissions, zoom) in their own in-memory store instead of the profile
const ps = () => (isPrivate ? ts : store);

// a native menu whose click handlers run in the window the menu was opened in
function popupMenu(items, pos) {
  const c = CUR;
  const wrap = (it) => ({ ...it, ...(it.click ? { click: (...a) => inCtx(c, () => it.click(...a)) } : {}), ...(it.submenu ? { submenu: it.submenu.map(wrap) } : {}) });
  Menu.buildFromTemplate(items.map(wrap)).popup({ window: win, ...(pos || {}) });
}

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
  const wsId = ts.activeWs;
  const bucket = ts.tabsOf(wsId);
  return {
    workspaces: ts.workspaces.map((w) => ({ ...w, count: ts.tabsOf(w.id).list.length })),
    activeWs: wsId,
    activeTab: bucket.active,
    tabs: bucket.list.map((t) => ({ ...t, ...(meta.get(t.id) || {}), isNewTab: isNewTab(t.url), shownUrl: errorTarget(t.url) })),
    fullscreen,
    kind: CUR.kind,
    adblock: { enabled: !!store.data.settings.adblock, total: store.data.adblock.total },
    security: securityOf((bucket.list.find((t) => t.id === bucket.active) || {}).url),
    settings: { showHome: !!store.data.settings.showHome },
    pinned: CUR.kind === "guest" ? [] : store.pinned,
    bookmarkBar: {
      visible: barVisible(),
      folders: CUR.kind === "guest" ? [] : store.data.folders.filter((f) => f.parent === "bar"),
      items: CUR.kind === "guest" ? [] : store.data.bookmarks.filter((b) => b.folder === "bar"),
    },
    activeBookmark: (() => { const t = bucket.list.find((x) => x.id === bucket.active); const b = t && store.findBookmark(t.url); return b ? b.id : null; })(),
    downloads: { active: downloads.filter((d) => d.state === "progressing").length, total: downloads.length },
  };
}

function pushState() {
  for (const c of ctxs) {
    inCtx(c, () => {
      if (ui && !ui.webContents.isDestroyed()) ui.webContents.send("state", serialize());
    });
  }
}

function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(pushState, 16);
  store.save();
}

const layoutAll = () => { for (const c of ctxs) inCtx(c, layout); };

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

const chromeColor = (kind, dark) => (kind === "normal" ? (dark ? "#0f1115" : "#eceef2") : dark ? "#17112a" : "#e6e0f5");

function applyTheme() {
  nativeTheme.themeSource = store.data.settings.theme;
  const dark = nativeTheme.shouldUseDarkColors;
  for (const c of ctxs) {
    if (!c.win || c.win.isDestroyed()) continue;
    const color = chromeColor(c.kind, dark);
    try {
      c.win.setBackgroundColor(color);
      if (c.win.setTitleBarOverlay) c.win.setTitleBarOverlay({ color, symbolColor: dark ? "#c7ccd6" : "#3a3f4a", height: TAB_H });
    } catch {}
  }
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
    webPreferences: { partition: CUR.partition, sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  views.set(tab.id, view);
  meta.set(tab.id, { loading: false, canGoBack: false, canGoForward: false });
  const wc = view.webContents;
  const ctx = CUR;
  wcCtx.set(wc.id, ctx);
  const on = (ev, fn) => wc.on(ev, (...a) => inCtx(wcCtx.get(wc.id) || ctx, () => fn(...a))); // the tab may move to another window

  const refreshNav = () => {
    const m = meta.get(tab.id);
    if (!m || wc.isDestroyed()) return;
    m.canGoBack = wc.navigationHistory.canGoBack();
    m.canGoForward = wc.navigationHistory.canGoForward();
  };

  on("input-event", (_e, ev) => {
    if (ev.type === "mouseDown" || ev.type === "keyDown" || ev.type === "rawKeyDown" || ev.type === "touchStart") lastGesture.set(tab.id, Date.now());
  });
  wc.setWindowOpenHandler(({ url }) => inCtx(wcCtx.get(wc.id) || ctx, () => {
    const origin = perms.originOf(wc.getURL());
    const userAction = Date.now() - (lastGesture.get(tab.id) || 0) < 1500;
    if (userAction || (origin && ps().getPerm(origin, "popups") === "allow")) {
      createTab(ts.activeWs, url, { afterActive: true });
    } else { // a script opened a window without the user doing anything: hold it back and say so
      const m = meta.get(tab.id);
      if (m) {
        m.blocked = [...(m.blocked || []).filter((u) => u !== url), url].slice(-8);
        notify();
      }
    }
    return { action: "deny" };
  }));
  wcTab.set(wc.id, tab.id);
  on("did-start-navigation", (_e, _url, inPlace, isMain) => {
    if (!isMain || inPlace) return;
    dropPending(tab.id);
    const m = meta.get(tab.id);
    if (m) m.ads = 0;
  });
  on("page-title-updated", (_e, title) => { tab.title = title; notify(); });
  on("page-favicon-updated", (_e, favicons) => { tab.favicon = favicons[0] || ""; notify(); });
  on("did-start-loading", () => { meta.get(tab.id).loading = true; notify(); });
  on("did-stop-loading", () => { meta.get(tab.id).loading = false; refreshNav(); notify(); });
  on("did-navigate", (_e, url) => { tab.url = url; const m = meta.get(tab.id); if (m) m.blocked = []; applySiteZoom(wc, tab.id, url); refreshNav(); notify(); });
  on("did-navigate-in-page", (_e, url, isMain) => { if (isMain) { tab.url = url; refreshNav(); notify(); } });
  on("render-process-gone", (_e, details) => {
    const m = meta.get(tab.id);
    if (m) m.loading = false;
    if (details.reason !== "clean-exit" && !wc.isDestroyed()) {
      const failed = errorTarget(tab.url) || tab.url;
      setImmediate(() => showError(wc, "crash", failed));
    }
    notify();
  });
  on("did-fail-load", (_e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3 || !failedUrl || failedUrl.startsWith("fjord://")) return; // -3: the navigation was replaced
    const cert = code <= -200 && code >= -299; // ERR_CERT_*
    setImmediate(() => showError(wc, cert ? "cert" : "load", failedUrl, { code: String(code), desc }));
  });
  on("enter-html-full-screen", () => setFullscreen(true, true));
  on("leave-html-full-screen", () => { if (pageFullscreen) setFullscreen(false); });
  on("audio-state-changed", () => { const m = meta.get(tab.id); if (m) { m.audible = wc.isCurrentlyAudible(); m.muted = wc.audioMuted; notify(); } });
  on("did-navigate", (_e, url) => { if (!isPrivate) store.addHistory(url, tab.title); });
  on("page-title-updated", (_e, title) => { if (!isPrivate) store.updateHistoryTitle(tab.url, title); });
  on("found-in-page", (_e, r) => {
    if (!overlay || overlayKind !== "find") return;
    findAnswered = findSeq;
    overlay.webContents.send("found", { active: r.activeMatchOrdinal, total: r.matches });
    if (r.finalUpdate) overlay.webContents.focus(); // findInPage only works while the page has focus: hand it back to the find box
  });
  on("context-menu", (_e, params) => popupMenu(pageMenu(wc, params)));
  on("before-input-event", (event, input) => { if (handleShortcut(input)) event.preventDefault(); });

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
  const bucket = ts.tabsOf(wsId);
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
  const found = ts.findTab(tabId);
  if (!found) return;
  if (found.wsId !== ts.activeWs) ts.activeWs = found.wsId;
  found.bucket.active = tabId;
  ensureView(found.tab);
  attach(tabId);
  notify();
  later(showNextPermission, 0);
}

function closeTab(tabId) {
  const found = ts.findTab(tabId);
  if (!found) return;
  const { bucket, wsId } = found;
  const idx = bucket.list.findIndex((t) => t.id === tabId);
  if (!isNewTab(found.tab.url)) ts.pushClosed({ url: found.tab.url, title: found.tab.title, favicon: found.tab.favicon, ws: wsId, pinned: !!found.tab.pinned });
  bucket.list.splice(idx, 1);
  dropPending(tabId);
  lastGesture.delete(tabId);
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
  if (wsId === ts.activeWs) {
    if (!bucket.list.length) createTab(wsId, NEWTAB);
    else activateTab(bucket.active);
  }
  notify();
}

function switchWorkspace(wsId) {
  if (!ts.workspaces.some((w) => w.id === wsId)) return;
  ts.activeWs = wsId;
  const bucket = ts.tabsOf(wsId);
  if (!bucket.list.length) return void createTab(wsId, NEWTAB);
  if (!bucket.list.some((t) => t.id === bucket.active)) bucket.active = bucket.list[0].id;
  activateTab(bucket.active);
}

function nextWorkspace(step = 1) {
  const i = ts.workspaces.findIndex((w) => w.id === ts.activeWs);
  switchWorkspace(ts.workspaces[(i + step + ts.workspaces.length) % ts.workspaces.length].id);
}

function deleteWorkspace(wsId) {
  if (ts.workspaces.length <= 1) return { error: "마지막 워크스페이스는 삭제할 수 없어요." };
  const rest = ts.workspaces.filter((w) => w.id !== wsId);
  const dest = ts.tabsOf(rest[0].id);
  const gone = ts.tabsOf(wsId);
  for (const tab of gone.list) dest.list.push(tab); // keep the tabs: they move to the first remaining workspace
  delete ts.data.tabs[wsId];
  ts.data.workspaces = rest;
  if (ts.activeWs === wsId) ts.activeWs = rest[0].id;
  switchWorkspace(ts.activeWs);
  return {};
}

function moveTab(tabId, toWs) {
  const found = ts.findTab(tabId);
  if (!found || found.wsId === toWs || !ts.workspaces.some((w) => w.id === toWs)) return;
  const idx = found.bucket.list.indexOf(found.tab);
  found.bucket.list.splice(idx, 1);
  ts.tabsOf(toWs).list.push(found.tab);
  if (found.bucket.active === tabId) found.bucket.active = (found.bucket.list[Math.min(idx, found.bucket.list.length - 1)] || {}).id || null;
  if (found.wsId === ts.activeWs) {
    if (attached === tabId) {
      win.contentView.removeChildView(views.get(tabId));
      attached = null;
    }
    if (!found.bucket.list.length) createTab(found.wsId, NEWTAB);
    else activateTab(found.bucket.active);
  }
  notify();
}

const activeTabId = () => ts.tabsOf(ts.activeWs).active;
const activeContents = () => {
  const v = views.get(activeTabId());
  return v && !v.webContents.isDestroyed() ? v.webContents : null;
};

// ---- page context menu -----------------------------------------------------------------------------
function pageMenu(wc, params) {
  const items = [];
  const openTab = (url) => createTab(ts.activeWs, url, { afterActive: true });
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
  return items;
}

// ---- overlay: popups drawn above the page ---------------------------------------------------------
function ensureOverlay() {
  if (overlay) return;
  overlay = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  overlay.setBackgroundColor("#00000000");
  const ov = CUR;
  wcCtx.set(overlay.webContents.id, ov);
  const on = (ev, fn) => overlay.webContents.on(ev, (...a) => inCtx(ov, () => fn(...a)));
  overlay.webContents.loadURL("fjord://app/overlay.html");
  on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      if (overlayKind === "permission" && shownPermId) commands.permAnswer({ id: shownPermId, choice: "dismiss" });
      else hideOverlay();
      event.preventDefault();
    }
    else if (handleShortcut(input)) event.preventDefault();
  });
  on("blur", () => { if (overlayKind === "downloads" || overlayKind === "prompt" || overlayKind === "tabsearch" || overlayKind === "bookmark" || overlayKind === "siteinfo" || overlayKind === "popups" || overlayKind === "shield") hideOverlay(); });
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
  if (kind === "find" || kind === "downloads" || kind === "prompt" || kind === "tabsearch" || kind === "bookmark" || kind === "siteinfo" || kind === "popups" || kind === "shield") overlay.webContents.focus();
}

function hideOverlay() {
  if (!overlayShown) return;
  win.contentView.removeChildView(overlay);
  overlayShown = false;
  if (overlayKind === "find") activeContents()?.stopFindInPage("clearSelection");
  overlayKind = null;
  shownPermId = null;
  const v = attached && views.get(attached);
  if (v && !TEST) v.webContents.focus();
  if (pendingPerms.length) later(showNextPermission, 0);
}

// ---- permissions, site info, blocked popups ---------------------------------------------------------
const popupAnchor = () => ({ x: RAIL_W + 64, y: TAB_H + TOOL_H - 4 });

function dropPending(tabId) {
  for (let i = pendingPerms.length - 1; i >= 0; i--) {
    if (pendingPerms[i].tabId !== tabId) continue;
    const [p] = pendingPerms.splice(i, 1);
    try { p.callback(false); } catch {}
    if (shownPermId === p.id) hideOverlay();
  }
}

function showNextPermission() {
  if (!win || overlayShown) return;
  const p = pendingPerms.find((x) => x.tabId === activeTabId());
  if (!p) return;
  shownPermId = p.id;
  showOverlay("permission", { ...popupAnchor(), width: 372, height: 150 }, { id: p.id, origin: p.origin, label: p.label });
  shownPermId = p.id; // showOverlay() does not touch it, but hide-then-show paths reset it
}

function onPermissionRequest(wc, permission, callback, details) { // runs in the window that owns wc
  const origin = perms.originOf((details && details.requestingUrl) || wc.getURL());
  if (!origin) return callback(false); // internal pages and files never get permissions
  const decision = perms.policy(permission, ps().getPerm(origin, permission));
  if (decision !== "ask") return callback(decision === "allow");
  let tabId = null;
  for (const [id, v] of views) if (v.webContents === wc) tabId = id;
  if (!tabId) return callback(false);
  pendingPerms.push({ id: newId(), tabId, origin, key: permission, label: perms.label(permission, details), callback });
  showNextPermission();
}

// ---- ad & tracker blocking ----------------------------------------------------------------------------
const BLOCKLIST_URL = "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt";
const blocklistFile = () => path.join(process.env.FJORD_USER_DATA || app.getPath("userData"), "blocklist.txt");
const hostnameOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

function adBlocked(details) {
  if (!store.data.settings.adblock || details.resourceType === "mainFrame") return false;
  const host = hostnameOf(details.url);
  if (!host) return false;
  const wc = details.webContentsId != null ? webContents.fromId(details.webContentsId) : null;
  const top = hostnameOf((details.frame && details.frame.top && details.frame.top.url) || (wc && wc.getURL()) || "");
  if (top) {
    if (store.data.adblock.allow.includes(top) || sameSite(host, top)) return false;
  }
  if (!blocker.matches(host)) return false;
  const tabId = wcTab.get(details.webContentsId);
  const m = tabId && meta.get(tabId);
  if (m) m.ads = (m.ads || 0) + 1;
  store.data.adblock.total++;
  notify();
  return true;
}

function loadBlocklist() {
  const fresh = new Blocker();
  fresh.loadRuleFiles(path.join(MOUNTS.shared, "..", "modules", "adblock", "rules"));
  blocker = fresh; // bundled rules work immediately; the downloaded list joins when it is read
  const file = blocklistFile();
  if (!fs.existsSync(file)) return;
  fs.promises.readFile(file, "utf8").then(async (text) => {
    const next = new Blocker();
    next.domains = new Set(fresh.domains);
    await next.parseListAsync(text);
    blocker = next;
    store.data.adblock.listCount = next.size;
    notify();
  }).catch(() => {});
}

async function updateBlocklist() {
  try {
    const res = await net.fetch(BLOCKLIST_URL);
    if (!res.ok) return { error: "목록을 받지 못했어요 (" + res.status + ")" };
    const text = await res.text();
    if (text.length < 10000 || !text.includes("||")) return { error: "받은 목록이 올바르지 않아요." };
    const next = new Blocker();
    next.loadRuleFiles(path.join(MOUNTS.shared, "..", "modules", "adblock", "rules"));
    await next.parseListAsync(text);
    fs.mkdirSync(path.dirname(blocklistFile()), { recursive: true });
    fs.writeFileSync(blocklistFile(), text);
    blocker = next;
    store.data.adblock.listCount = next.size;
    store.data.adblock.updatedAt = Date.now();
    notify();
    return { count: next.size, updatedAt: store.data.adblock.updatedAt };
  } catch (e) {
    return { error: "목록을 받지 못했어요: " + e.message };
  }
}

function adblockInfo() {
  return { enabled: !!store.data.settings.adblock, auto: !!store.data.settings.adblockUpdate, listCount: blocker.size, updatedAt: store.data.adblock.updatedAt, total: store.data.adblock.total, allow: store.data.adblock.allow };
}

function showShield() {
  const wc = activeContents();
  const host = wc ? hostnameOf(wc.getURL()) : "";
  const m = meta.get(activeTabId());
  const { h } = contentSize();
  showOverlay("shield", { x: RAIL_W + 8, y: Math.max(topH(), h - 330), width: 340, height: 262 },
    { ...adblockInfo(), host, siteOff: !!host && store.data.adblock.allow.includes(host), ads: (m && m.ads) || 0 });
}

function securityOf(url) {
  if (!url || isNewTab(url) || /^(fjord|about|view-source|devtools|chrome):/i.test(url)) return url && url.startsWith("fjord://app/error.html?kind=cert") ? "danger" : "internal";
  if (/^file:/i.test(url)) return "file";
  if (/^https:/i.test(url)) return certAllowed.has(perms.originOf(url)) ? "danger" : "secure";
  if (/^http:/i.test(url)) return "insecure";
  return "internal";
}

function showSiteInfo() {
  const wc = activeContents();
  if (!wc) return;
  const url = wc.getURL();
  const origin = perms.originOf(url);
  const keys = origin ? [...perms.SITE_KEYS, ...Object.keys(ps().data.permissions[origin] || {}).filter((k) => !perms.SITE_KEYS.includes(k))] : [];
  const rows = keys.map((k) => ({ key: k, label: perms.label(k), value: ps().getPerm(origin, k) }));
  showOverlay("siteinfo", { ...popupAnchor(), width: 352, height: 92 + rows.length * 40 }, { origin, shown: origin || errorTarget(url) || url, security: securityOf(url), rows });
}

function showPopups() {
  const t = ts.findTab(activeTabId());
  const m = t && meta.get(t.tab.id);
  const urls = (m && m.blocked) || [];
  if (!urls.length) return;
  showOverlay("popups", { ...popupAnchor(), x: Math.max(RAIL_W, contentSize().w - 424), width: 400, height: 150 + urls.length * 40 }, { origin: perms.originOf(t.tab.url), urls });
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
  if (!wc || CUR.kind === "guest") return;
  const url = wc.getURL();
  const tab = ts.findTab(activeTabId());
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
  const f = ts.findTab(id);
  if (!f) return;
  f.tab.pinned = pinned;
  const list = f.bucket.list;
  list.splice(list.indexOf(f.tab), 1);
  list.splice(list.filter((t) => t.pinned).length, 0, f.tab); // end of the pinned block (pin) / right after it (unpin)
  notify();
}

function closeWhere(id, pick) {
  const f = ts.findTab(id);
  if (!f) return;
  const list = f.bucket.list;
  const i = list.indexOf(f.tab);
  list.filter((t, j) => !t.pinned && t.id !== id && pick(j, i)).map((t) => t.id).forEach((t) => closeTab(t));
}

function allTabs() {
  return ts.workspaces.flatMap((w) => ts.tabsOf(w.id).list.map((t) => ({ id: t.id, title: t.title || "", url: t.url, favicon: t.favicon, ws: w.id, wsName: w.name, isNewTab: isNewTab(t.url), pinned: !!t.pinned })));
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

const siteHost = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.host : null;
  } catch {
    return null;
  }
};

function setZoom(delta) {
  const wc = activeContents();
  if (!wc) return;
  const level = delta === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
  ps().setSiteZoom(siteHost(wc.getURL()), level); // remembered for the site, also after a restart
  const m = meta.get(activeTabId());
  if (m) m.zoom = Math.round(Math.pow(1.2, level) * 100);
  notify();
}

// a page opens at the zoom the user chose for its site
function applySiteZoom(wc, tabId, url) {
  const host = siteHost(url);
  if (!host || wc.isDestroyed()) return;
  const level = ps().siteZoom(host);
  if (wc.getZoomLevel() !== level) wc.setZoomLevel(level);
  const m = meta.get(tabId);
  if (m) m.zoom = Math.round(Math.pow(1.2, level) * 100);
}

// ---- clearing browsing data ---------------------------------------------------------------------------
const RANGES = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 28 * 86400e3 };
const pses = () => session.fromPartition(CUR.partition);
const stripDot = (d) => String(d || "").replace(/^\./, "");

async function clearData({ range = "all", types = [] }) {
  const since = RANGES[range] ? Date.now() - RANGES[range] : 0;
  const done = {};
  const ses = pses();
  const pstore = ps();
  if (types.includes("history")) { store.clearHistory(since); done.history = true; }
  if (types.includes("downloads")) {
    for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== "progressing" && downloads[i].startedAt >= since) downloads.splice(i, 1);
    pushDownloads();
    done.downloads = true;
  }
  // Electron cannot clear cookies/cache/site data by time, so these always clear everything
  if (types.includes("cookies")) { await ses.clearStorageData({ storages: ["cookies"] }); done.cookies = true; }
  if (types.includes("siteData")) { await ses.clearStorageData({ storages: ["localstorage", "indexdb", "cachestorage", "serviceworkers", "websql", "filesystem"] }); done.siteData = true; }
  if (types.includes("cache")) { await ses.clearCache(); done.cache = true; }
  if (types.includes("permissions")) { pstore.clearPerms(); done.permissions = true; }
  notify();
  return done;
}

async function cookieDomains() {
  const by = new Map();
  for (const c of await pses().cookies.get({})) {
    const d = stripDot(c.domain);
    by.set(d, (by.get(d) || 0) + 1);
  }
  return [...by].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
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
  pushState();
  for (const c of ctxs) if (c.overlay && c.overlayKind === "downloads" && !c.overlay.webContents.isDestroyed()) c.overlay.webContents.send("downloads", downloads);
}

function onWillDownload(_event, item) {
  const dir = downloadDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = uniquePath(dir, item.getFilename() || "download");
  item.setSavePath(file);
  const d = { id: newId(), name: path.basename(file), path: file, url: item.getURL(), received: 0, total: item.getTotalBytes(), state: "progressing", paused: false, canResume: false, startedAt: Date.now() };
  downloads.unshift(d);
  downloadItems.set(d.id, item);
  item.on("updated", (_e, state) => {
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    d.state = state === "interrupted" ? "interrupted" : "progressing";
    d.paused = item.isPaused();
    d.canResume = item.canResume();
    pushDownloads();
  });
  item.once("done", (_e, state) => {
    d.state = state; // completed | cancelled | interrupted
    d.received = item.getReceivedBytes();
    d.paused = false;
    d.canResume = false;
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
  const bucket = ts.tabsOf(ts.activeWs);
  const idx = bucket.list.findIndex((t) => t.id === bucket.active);
  const go = (d) => { const n = bucket.list.length; if (n) activateTab(bucket.list[(idx + d + n) % n].id); };

  if (key === "F11") commands.fullscreenToggle();
  else if (ctrl && input.shift && !input.alt && key === "Delete") commands.openPage("settings#clear");
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "n") commands.newPrivateWindow();
  else if (ctrl && !input.shift && !input.alt && key.toLowerCase() === "n") commands.newWindow();
  else if (ctrl && !input.shift && !input.alt && key.toLowerCase() === "p") commands.print();
  else if (ctrl && !input.alt && key === ",") commands.openPage("settings");
  else if (input.alt && key === "Home") commands.home();
  else if (ctrl && !input.shift && !input.alt && key.toLowerCase() === "d") toggleBookmarkForActiveTab();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "b") commands.barToggle();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "o") commands.openPage("bookmarks");
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "t") commands.restoreClosed();
  else if (ctrl && input.shift && !input.alt && key.toLowerCase() === "a") showTabSearch();
  else if (ctrl && !input.alt && key.toLowerCase() === "t") { setFullscreen(false); createTab(ts.activeWs, NEWTAB); }
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
// ---- windows ---------------------------------------------------------------------------------------
function openWindow(kind, extra = {}) {
  const b = win && win.getBounds();
  return createWindow(kind, { bounds: b ? { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height } : undefined, ...extra });
}

// tab -> another window (null = a new one). Only between windows that share a session (same partition).
function moveTabToWindow(tabId, target, bounds) {
  const found = ts.findTab(tabId);
  if (!found) return null;
  const total = ts.workspaces.reduce((n, w) => n + ts.tabsOf(w.id).list.length, 0);
  if (!target && total < 2) return null; // a window cannot walk away with its only tab
  if (target && (target === CUR || target.partition !== CUR.partition)) return null;
  const { tab, bucket, wsId } = found;
  const view = ensureView(tab);
  const m = meta.get(tabId);
  const idx = bucket.list.indexOf(tab);
  bucket.list.splice(idx, 1);
  if (attached === tabId) {
    win.contentView.removeChildView(view);
    attached = null;
  }
  views.delete(tabId);
  meta.delete(tabId);
  const moved = pendingPerms.filter((p) => p.tabId === tabId);
  for (const p of moved) { pendingPerms.splice(pendingPerms.indexOf(p), 1); if (shownPermId === p.id) hideOverlay(); }
  if (bucket.active === tabId) bucket.active = (bucket.list[Math.min(idx, bucket.list.length - 1)] || {}).id || null;
  if (wsId === ts.activeWs) {
    if (!bucket.list.length) createTab(wsId, NEWTAB);
    else activateTab(bucket.active);
  }
  notify();
  const adopt = { tab, view, m };
  let dst = target;
  if (dst) inCtx(dst, () => adoptTab(adopt));
  else dst = openWindow(CUR.kind, { adopt, bounds });
  dst.pendingPerms.push(...moved);
  return dst;
}

function adoptTab({ tab, view, m }) {
  const bucket = ts.tabsOf(ts.activeWs);
  const pinnedCount = bucket.list.filter((t) => t.pinned).length;
  bucket.list.splice(tab.pinned ? pinnedCount : bucket.list.length, 0, tab);
  views.set(tab.id, view);
  meta.set(tab.id, m || { loading: false, canGoBack: false, canGoForward: false });
  wcCtx.set(view.webContents.id, CUR);
  activateTab(tab.id);
}

const otherWindows = () => [...ctxs].filter((c) => c !== CUR && c.partition === CUR.partition && c.win && !c.win.isDestroyed());

function mainMenuItems() {
  return [
    { label: "새 창", accelerator: "Ctrl+N", registerAccelerator: false, click: () => commands.newWindow() },
    { label: "새 시크릿 창", accelerator: "Ctrl+Shift+N", registerAccelerator: false, click: () => commands.newPrivateWindow() },
    { label: "새 게스트 창", click: () => commands.newGuestWindow() },
    { type: "separator" },
    { label: "이 페이지 북마크", accelerator: "Ctrl+D", registerAccelerator: false, enabled: CUR.kind !== "guest", click: () => toggleBookmarkForActiveTab() },
    { label: "북마크 관리", accelerator: "Ctrl+Shift+O", registerAccelerator: false, enabled: CUR.kind !== "guest", click: () => commands.openPage("bookmarks") },
    { label: "방문 기록", accelerator: "Ctrl+H", registerAccelerator: false, enabled: CUR.kind !== "guest", click: () => commands.openPage("history") },
    { label: "다운로드", accelerator: "Ctrl+J", registerAccelerator: false, click: () => showDownloads() },
    { type: "separator" },
    { label: "확대", accelerator: "Ctrl+=", registerAccelerator: false, click: () => setZoom(0.5) },
    { label: "축소", accelerator: "Ctrl+-", registerAccelerator: false, click: () => setZoom(-0.5) },
    { label: "확대/축소 초기화", accelerator: "Ctrl+0", registerAccelerator: false, click: () => setZoom(0) },
    { label: "페이지에서 찾기", accelerator: "Ctrl+F", registerAccelerator: false, click: () => showFind() },
    { label: "인쇄…", accelerator: "Ctrl+P", registerAccelerator: false, click: () => commands.print() },
    { label: "전체 화면", accelerator: "F11", registerAccelerator: false, click: () => commands.fullscreenToggle() },
    { type: "separator" },
    { label: "인터넷 사용 기록 삭제…", accelerator: "Ctrl+Shift+Delete", registerAccelerator: false, click: () => commands.openPage("settings#clear") },
    { label: "설정", accelerator: "Ctrl+,", registerAccelerator: false, click: () => commands.openPage("settings") },
    { type: "separator" },
    { label: "Fjord 종료", click: () => app.quit() },
  ];
}

const commands = {
  state: () => serialize(),
  newWindow: () => { openWindow("normal"); },
  newPrivateWindow: () => { openWindow("private"); },
  newGuestWindow: () => { openWindow("guest"); },
  tabToNewWindow: (id) => { moveTabToWindow(id || activeTabId(), null); },
  tabToWindow: ({ id, window: wid }) => { const t = [...ctxs].find((c) => c.id === wid); if (t) moveTabToWindow(id, t); },
  // a tab dropped outside the strip: onto another window of the same kind it joins it, otherwise it becomes a window
  tabDragEnd: ({ id, x, y }) => {
    if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const inside = (c) => { if (!c.win || c.win.isDestroyed()) return false; const b = c.win.getBounds(); return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height; };
    if (inside(CUR)) return;
    const target = otherWindows().find(inside);
    if (target) return void moveTabToWindow(id, target);
    const b = win.getBounds();
    moveTabToWindow(id, null, { x: Math.round(x - 200), y: Math.round(y - 20), width: b.width, height: b.height });
  },
  mainMenu: ({ x, y }) => popupMenu(mainMenuItems(), { x: Math.round(x), y: Math.round(y) }),
  newTab: (url) => void createTab(ts.activeWs, url ? toUrl(url) : NEWTAB),
  closeTab: (id) => closeTab(id || activeTabId()),
  activate: (id) => activateTab(id),
  navigate: ({ id, input }) => {
    const found = ts.findTab(id || activeTabId());
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
  wsAdd: (name) => { const r = ts.addWorkspace(name); if (r.id) switchWorkspace(r.id); notify(); return r; },
  wsRename: ({ id, name }) => { const r = ts.renameWorkspace(id, name); notify(); return r; },
  wsIcon: (id) => { ts.cycleIcon(id); notify(); },
  wsDelete: (id) => { const r = deleteWorkspace(id); notify(); return r; },
  moveTab: ({ id, ws }) => moveTab(id, ws),
  openPinned: (id) => {
    const pin = store.pinned.find((p) => p.id === id);
    if (!pin) return;
    const bucket = ts.tabsOf(ts.activeWs);
    const existing = bucket.list.find((t) => { try { return new URL(t.url).origin === new URL(pin.url).origin; } catch { return false; } });
    if (existing) activateTab(existing.id);
    else createTab(ts.activeWs, pin.url);
  },
  reorder: ({ id, beforeId }) => {
    const bucket = ts.tabsOf(ts.activeWs);
    const from = bucket.list.findIndex((t) => t.id === id);
    if (from < 0 || id === beforeId) return;
    const [tab] = bucket.list.splice(from, 1);
    const to = beforeId ? bucket.list.findIndex((t) => t.id === beforeId) : bucket.list.length;
    bucket.list.splice(to < 0 ? bucket.list.length : to, 0, tab);
    notify();
  },
  dial: () => (CUR.kind === "guest" ? [] : store.pinned),
  settingsGet: () => ({ ...store.data.settings, downloadDirEffective: downloadDir() }),
  shieldShow: () => (overlayKind === "shield" ? hideOverlay() : showShield()),
  adblockInfo: () => adblockInfo(),
  adblockUpdate: async () => {
    const c = CUR;
    const r = await updateBlocklist();
    inCtx(c, () => { if (overlayKind === "shield") showShield(); });
    return r;
  },
  // turn blocking off/on for the current site, then reload it so the change shows
  adblockSite: () => {
    const wc = activeContents();
    const host = wc ? hostnameOf(wc.getURL()) : "";
    if (!host) return;
    const list = store.data.adblock.allow;
    const i = list.indexOf(host);
    if (i >= 0) list.splice(i, 1);
    else list.push(host);
    store.save();
    wc.reload();
    if (overlayKind === "shield") showShield();
    notify();
  },
  adblockAllowRemove: (host) => {
    store.data.adblock.allow = store.data.adblock.allow.filter((h) => h !== host);
    store.save();
    notify();
  },
  settingSet: ({ key, value }) => {
    const r = store.setSetting(key, value);
    if (r.error) return r;
    if (key === "adblock" && overlayKind === "shield") showShield();
    if (key === "theme") applyTheme();
    if (key === "bookmarkBar") layoutAll();
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
  retry: (url, sender) => {
    const wc = sender || activeContents();
    if (wc && /^(https?|file):\/\//i.test(String(url || ""))) wc.loadURL(url).catch(() => {});
  },
  certProceed: (url, sender) => {
    const origin = /^https:\/\//i.test(String(url || "")) ? perms.originOf(url) : null;
    if (!origin) return;
    certAllowed.add(origin); // this run only, never saved
    (sender || activeContents())?.loadURL(url).catch(() => {});
  },
  safeExit: (_arg, sender) => {
    const wc = sender || activeContents();
    if (!wc) return;
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else wc.loadURL(NEWTAB).catch(() => {});
  },
  siteInfoShow: () => (overlayKind === "siteinfo" ? hideOverlay() : showSiteInfo()),
  popupsShow: () => (overlayKind === "popups" ? hideOverlay() : showPopups()),
  popupOpen: (url) => {
    const t = ts.findTab(activeTabId());
    const m = t && meta.get(t.tab.id);
    if (m) m.blocked = (m.blocked || []).filter((u) => u !== url);
    if (/^(https?|about):/i.test(String(url || ""))) createTab(ts.activeWs, url, { afterActive: true });
    hideOverlay();
    notify();
  },
  popupsAllow: () => {
    const t = ts.findTab(activeTabId());
    const m = t && meta.get(t.tab.id);
    const origin = t && perms.originOf(t.tab.url);
    if (origin) ps().setPerm(origin, "popups", "allow");
    for (const u of (m && m.blocked) || []) if (/^(https?):/i.test(u)) createTab(ts.activeWs, u, { afterActive: true });
    if (m) m.blocked = [];
    hideOverlay();
    notify();
  },
  permAnswer: ({ id, choice }) => {
    const i = pendingPerms.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = pendingPerms.splice(i, 1);
    if (choice === "allow" || choice === "deny") ps().setPerm(p.origin, p.key, choice);
    try { p.callback(choice === "allow" || choice === "once"); } catch {}
    if (overlayKind === "permission") hideOverlay();
    notify();
  },
  permList: () => ps().listPerms().map((r) => ({ ...r, label: perms.label(r.key) })),
  permSet: ({ origin, key, value }) => {
    ps().setPerm(origin, key, value);
    if (overlayKind === "siteinfo") showSiteInfo();
    notify();
    return {};
  },
  permClearAll: () => { ps().clearPerms(); notify(); },
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
    const t = ts.findTab(activeTabId());
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
  barToggle: () => { store.data.settings.bookmarkBar = !store.data.settings.bookmarkBar; layoutAll(); notify(); },
  folderMenu: (id) => popupMenu(bookmarkMenuItems(store.data.bookmarks.filter((b) => b.folder === id))),
  bookmarkMenu: (id) => {
    const b = store.data.bookmarks.find((x) => x.id === id);
    if (!b) return;
    popupMenu([
      { label: "새 탭에서 열기", click: () => createTab(ts.activeWs, b.url, { afterActive: true }) },
      { label: "편집…", click: () => showBookmarkEdit(b) },
      { label: "주소 복사", click: () => clipboard.writeText(b.url) },
      { type: "separator" },
      { label: "삭제", click: () => commands.bookmarkRemove(id) },
    ]);
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
  pinTab: (id) => { const f = ts.findTab(id); if (f) setPinned(id, !f.tab.pinned); },
  duplicateTab: (id) => { const f = ts.findTab(id); if (f) createTab(f.wsId, f.tab.url, { afterId: id }); },
  muteTab: (id) => {
    const f = ts.findTab(id);
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
    const c = ts.popClosed();
    if (!c) return;
    createTab(ts.workspaces.some((w) => w.id === c.ws) ? c.ws : ts.activeWs, c.url, { pinned: !!c.pinned });
  },
  tabSearchShow: () => showTabSearch(),
  suggest: (q) => (CUR.kind === "guest" ? [] : store.suggest(q)),
  history: () => (CUR.kind === "guest" ? [] : store.data.history.slice(0, 500)),
  historyClear: () => { store.clearHistory(); notify(); },
  openPage: (name) => {
    const [page, hash] = String(name).split("#");
    const url = `fjord://app/${page}.html${hash ? "#" + hash : ""}`;
    const found = ts.tabsOf(ts.activeWs).list.find((t) => t.url === url);
    if (found) activateTab(found.id);
    else createTab(ts.activeWs, url);
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
    const c0 = CUR;
    if (!text) { wc.stopFindInPage("clearSelection"); overlay?.webContents.send("found", { active: 0, total: 0 }); return; }
    if (!wc.isFocused()) { // Chromium searches the focused frame; focusing is asynchronous, so give it a moment
      wc.focus();
      await new Promise((r) => setTimeout(r, 90));
    }
    inCtx(c0, () => {
      const run = () => wc.findInPage(text, { forward, findNext: next, matchCase }); // the found-in-page handler hands focus back to the find box
      const mine = ++findSeq;
      run();
      later(() => { if (findAnswered < mine && findSeq === mine && !wc.isDestroyed()) run(); }, 250); // retry once when no answer came
    });
  },
  findShow: () => showFind(),
  downloadsPanel: () => (overlayKind === "downloads" ? hideOverlay() : showDownloads()),
  dlOpen: (id) => { const d = downloads.find((x) => x.id === id); if (d) shell.openPath(d.path); },
  dlShow: (id) => { const d = downloads.find((x) => x.id === id); if (d) shell.showItemInFolder(d.path); },
  dlCancel: (id) => downloadItems.get(id)?.cancel(),
  dlPause: (id) => {
    const item = downloadItems.get(id);
    const d = downloads.find((x) => x.id === id);
    if (!item || !d || item.isPaused()) return;
    item.pause();
    d.paused = true;
    pushDownloads();
  },
  dlResume: (id) => {
    const item = downloadItems.get(id);
    const d = downloads.find((x) => x.id === id);
    if (!item || !d || !item.canResume()) return;
    item.resume();
    d.paused = false;
    pushDownloads();
  },
  // a finished-with-error or cancelled download starts over from its address (the old entry is replaced)
  dlRetry: (id) => {
    const i = downloads.findIndex((x) => x.id === id);
    const d = downloads[i];
    const wc = activeContents();
    if (!d || !wc || d.state === "progressing" || !/^https?:\/\//i.test(d.url || "")) return;
    downloads.splice(i, 1);
    wc.downloadURL(d.url);
    pushDownloads();
  },
  dlClear: () => { for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== "progressing") downloads.splice(i, 1); pushDownloads(); },
  dlList: () => downloads,
  zoomReset: () => setZoom(0),
  zoomList: () => Object.entries(ps().data.zoom).map(([host, level]) => ({ host, percent: Math.round(Math.pow(1.2, level) * 100) })),
  zoomRemove: (host) => {
    ps().setSiteZoom(host, 0);
    for (const [id, v] of views) if (!v.webContents.isDestroyed() && siteHost(v.webContents.getURL()) === host) applySiteZoom(v.webContents, id, v.webContents.getURL());
    notify();
  },
  clearData: (opts) => clearData(opts || {}),
  cookieList: () => cookieDomains(),
  cookieRemove: async (domain) => {
    const d = stripDot(domain);
    for (const c of await pses().cookies.get({})) {
      const cd = stripDot(c.domain);
      if (cd === d) await pses().cookies.remove(`${c.secure ? "https" : "http"}://${cd}${c.path}`, c.name);
    }
    return {};
  },
  wsMenu: (id) => {
    const ws = ts.workspaces.find((w) => w.id === id);
    if (!ws) return;
    popupMenu([
      { label: "이름 변경…", click: () => showPrompt("rename", id, ws.name) },
      { label: "아이콘 바꾸기", click: () => commands.wsIcon(id) },
      { type: "separator" },
      { label: "삭제", enabled: ts.workspaces.length > 1, click: () => commands.wsDelete(id) },
    ]);
  },
  tabMenu: (id) => {
    const found = ts.findTab(id);
    if (!found) return;
    const list = found.bucket.list;
    const i = list.indexOf(found.tab);
    const muted = !!(meta.get(id) && meta.get(id).muted);
    popupMenu([
      { label: "새로고침", click: () => ensureView(found.tab).webContents.reload() },
      { label: "탭 복제", click: () => commands.duplicateTab(id) },
      { label: found.tab.pinned ? "탭 고정 해제" : "탭 고정", click: () => commands.pinTab(id) },
      { label: muted ? "탭 음소거 해제" : "탭 음소거", click: () => commands.muteTab(id) },
      { type: "separator" },
      ...ts.workspaces.filter((w) => w.id !== found.wsId).map((w) => ({ label: `${w.name}(으)로 옮기기`, click: () => moveTab(id, w.id) })),
      { type: "separator" },
      { label: "새 창으로 이동", enabled: ts.workspaces.reduce((n, w) => n + ts.tabsOf(w.id).list.length, 0) > 1, click: () => moveTabToWindow(id, null) },
      ...otherWindows().map((c) => ({ label: `창 ${c.id}(으)로 이동`, click: () => moveTabToWindow(id, c) })),
      { type: "separator" },
      { label: "탭 닫기", click: () => closeTab(id) },
      { label: "다른 탭 닫기", enabled: list.length > 1, click: () => commands.closeOthers(id) },
      { label: "왼쪽 탭 닫기", enabled: i > 0, click: () => commands.closeLeft(id) },
      { label: "오른쪽 탭 닫기", enabled: i < list.length - 1, click: () => commands.closeRight(id) },
      { label: "닫은 탭 다시 열기", enabled: ts.data.closed.length > 0, click: () => commands.restoreClosed() },
    ]);
  },
};

ipcMain.handle("cmd", (event, name, arg) => {
  const url = event.senderFrame && event.senderFrame.url;
  if (!url || !url.startsWith("fjord://")) throw new Error("forbidden");
  const fn = commands[name];
  if (!fn) throw new Error("unknown command " + name);
  return inCtx(wcCtx.get(event.sender.id), () => fn(arg, event.sender));
});

// ---- window --------------------------------------------------------------------------------------
const TITLES = { normal: "Fjord", private: "Fjord 시크릿", guest: "Fjord 게스트" };
const PARTITIONS = { normal: PARTITION, private: "fjord-private", guest: "fjord-guest" }; // the last two live in memory only

function createWindow(kind = "normal", opts = {}) {
  const ctx = {
    id: ++ctxSeq, kind, private: kind !== "normal", main: !!opts.main, partition: PARTITIONS[kind],
    win: null, ui: null, overlay: null, overlayShown: false, overlayKind: null, attached: null,
    fullscreen: false, pageFullscreen: false, shownPermId: null, findSeq: 0, findAnswered: 0,
    views: new Map(), meta: new Map(), pendingPerms: [], ts: store,
  };
  if (!ctx.main) { // other windows keep their tabs in memory: only the main window is restored after a restart
    ctx.ts = new Store(null);
    if (kind === "normal") ctx.ts.data.workspaces = ts.data.workspaces.map((w) => ({ ...w }));
    ctx.ts.data.activeWs = ctx.ts.data.workspaces[0].id;
  }
  ensureSession(ctx.partition);
  ctxs.add(ctx);
  if (ctx.main) mainCtx = ctx;
  inCtx(ctx, () => buildWindow(ctx, opts));
  applyTheme();
  return ctx;
}

function buildWindow(ctx, opts) {
  const saved = ctx.main ? fitBounds(store.data.window, screen.getAllDisplays().map((d) => d.workArea)) : null;
  const color = chromeColor(ctx.kind, true);
  win = new BaseWindow({
    ...(opts.bounds || saved || { width: 1280, height: 800 }),
    minWidth: 720,
    minHeight: 480,
    show: !TEST,
    backgroundColor: color,
    title: TITLES[ctx.kind],
    icon: path.join(ROOT, "..", "assets", "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color, symbolColor: "#c7ccd6", height: TAB_H },
  });
  ui = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "preload.js"), backgroundThrottling: !TEST },
  });
  wcCtx.set(ui.webContents.id, ctx);
  win.contentView.addChildView(ui);
  ui.webContents.on("before-input-event", (event, input) => { if (inCtx(ctx, () => handleShortcut(input))) event.preventDefault(); });
  win.on("resize", () => inCtx(ctx, layout));
  if (ctx.main) {
    let boundsTimer = null;
    const w = win;
    const rememberBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
        store.data.window = { ...w.getNormalBounds(), maximized: w.isMaximized() };
        store.save();
      }, 500);
    };
    for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, rememberBounds);
    if (store.data.window && store.data.window.maximized && !TEST) win.maximize();
  }
  win.on("leave-full-screen", () => inCtx(ctx, () => { if (fullscreen) setFullscreen(false); }));
  win.on("closed", () => inCtx(ctx, () => onWindowClosed(ctx)));
  ui.webContents.loadURL("fjord://app/index.html");
  layout();

  if (opts.adopt) adoptTab(opts.adopt);
  else if (ctx.main) {
    const bucket = ts.tabsOf(ts.activeWs);
    if (!bucket.list.length) createTab(ts.activeWs, !store.crashed && store.data.settings.startup === "home" && store.data.settings.homeUrl ? store.data.settings.homeUrl : NEWTAB);
    else {
      if (!bucket.list.some((t) => t.id === bucket.active)) bucket.active = bucket.list[0].id;
      activateTab(bucket.active);
    }
  } else createTab(ts.activeWs, opts.url || NEWTAB);
}

function onWindowClosed(ctx) {
  win = null;
  attached = null;
  overlayShown = false;
  for (const v of ctx.views.values()) if (!v.webContents.isDestroyed()) v.webContents.close();
  for (const v of [ctx.ui, ctx.overlay]) if (v && !v.webContents.isDestroyed()) v.webContents.close();
  for (const [id, c] of wcCtx) if (c === ctx) wcCtx.delete(id);
  for (const p of ctx.pendingPerms) { try { p.callback(false); } catch {} }
  ctx.pendingPerms.length = 0;
  ctxs.delete(ctx);
  if (CUR === ctx) {
    const next = [...ctxs][0];
    if (next) loadCtx(next);
  }
  // private and guest data lives only as long as the last window of that kind
  if (ctx.partition !== PARTITION && ![...ctxs].some((c) => c.partition === ctx.partition)) {
    const ses = session.fromPartition(ctx.partition);
    ses.clearStorageData().catch(() => {});
    ses.clearCache().catch(() => {});
    ses.clearAuthCache().catch(() => {});
  }
}

// ---- sessions: one per partition, all with the same hooks ----------------------------------------------
const sessionsReady = new Set();

function ensureSession(partition) {
  if (sessionsReady.has(partition)) return;
  sessionsReady.add(partition);
  const ses = session.fromPartition(partition);
  // present as a normal Chrome: sites (Google sign-in ...) refuse the "Electron" token
  ses.setUserAgent(app.userAgentFallback.replace(/\sElectron\/\S+/, "").replace(/\sfjord-app\/\S+/i, ""));
  ses.on("will-download", onWillDownload);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => inCtx(wcCtx.get(wc.id), () => onPermissionRequest(wc, permission, callback, details)));
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => inCtx(wc ? wcCtx.get(wc.id) : null, () => {
    const origin = perms.originOf(requestingOrigin);
    return !!origin && perms.policy(permission, ps().getPerm(origin, permission)) === "allow";
  }));
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
    let block = false;
    try { block = inCtx(wcCtx.get(details.webContentsId), () => adBlocked(details)); } catch {}
    callback({ cancel: block });
  });
  registerProtocol(ses);
}

app.setAppUserModelId("Fjord.App");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "system";
  store = new Store(path.join(process.env.FJORD_USER_DATA || app.getPath("userData"), "state.json"));
  if (!store.crashed && store.data.settings.startup !== "restore") store.dropUnpinnedTabs(); // after a crash always bring the tabs back
  store.save(true); // marks this run as "running"; before-quit clears it
  loadBlocklist();
  const stale = Date.now() - store.data.adblock.updatedAt > 7 * 86400e3;
  if (!TEST && store.data.settings.adblock && store.data.settings.adblockUpdate && stale) setTimeout(() => updateBlocklist(), 5000);
  registerProtocol(session.defaultSession);
  createWindow("normal", { main: true });
  applyTheme();
  nativeTheme.on("updated", applyTheme);
  // the test hook describes the main window (module variables are the main window's while nothing else runs)
  if (TEST) {
    global.__fjord = {
      commands, serialize, store, downloads, topH, RAIL_W, handleShortcut, createTab, certAllowed, securityOf, inCtx, createWindow, moveTabToWindow,
      ui: () => ui, win: () => win, attached: () => attached, overlay: () => overlay, overlayKind: () => overlayKind, isFullscreen: () => fullscreen, getBlocker: () => blocker,
      get views() { return mainCtx.views; },
      get pendingPerms() { return mainCtx.pendingPerms; },
      windows: () => [...ctxs],
      main: () => mainCtx,
    };
  }
  app.on("activate", () => { if (!ctxs.size) createWindow("normal", { main: true }); });
});

app.on("certificate-error", (event, _wc, url, _error, _cert, callback) => {
  if (certAllowed.has(perms.originOf(url))) { event.preventDefault(); callback(true); } // otherwise the load fails and the error page offers the choice
  else callback(false);
});

app.on("before-quit", () => { if (store) { store.data.running = false; store.save(true); } });
app.on("window-all-closed", () => app.quit());

module.exports = { topH, RAIL_W, ICONS };
