// Workspaces, Opera style: every workspace is its own browser window, so the tab strip at the top only ever shows that
// workspace's tabs (no tab groups). Switching focuses the workspace's window (same size/position) and minimizes the
// previous one. Tab URLs are snapshotted so a workspace comes back after a browser restart.
const ICONS = ["home", "briefcase", "gamepad", "book", "star", "heart", "code", "globe"];
const DEFAULTS = [
  { id: "personal", name: "개인", icon: "home" },
  { id: "work", name: "업무", icon: "briefcase" },
];
const NEWTAB = chrome.runtime.getURL("modules/newtab/newtab.html");
const SNAPSHOT_DELAY_MS = 3000;
const MAX_RESTORED_TABS = 40;

// ---- storage ----------------------------------------------------------------
async function getWorkspaces() {
  const { workspaces } = await chrome.storage.local.get("workspaces");
  const list = Array.isArray(workspaces) && workspaces.length ? workspaces : DEFAULTS.map((w) => ({ ...w }));
  // workspaces saved by the old tab-group version had colours instead of icons
  return list.map((w, i) => ({ ...w, icon: ICONS.includes(w.icon) ? w.icon : ICONS[i % ICONS.length] }));
}
const saveWorkspaces = (workspaces) => chrome.storage.local.set({ workspaces });

async function getActiveId() {
  const { wsActive } = await chrome.storage.local.get("wsActive");
  const wss = await getWorkspaces();
  return wss.some((w) => w.id === wsActive) ? wsActive : wss[0].id;
}
const setActiveId = (id) => chrome.storage.local.set({ wsActive: id });

// workspace id -> window id (window ids change on restart, so this lives in session storage)
async function getMap() {
  const { wsWindows } = await chrome.storage.session.get("wsWindows");
  const map = wsWindows || {};
  const alive = new Set((await chrome.windows.getAll({ windowTypes: ["normal"] })).map((w) => w.id));
  for (const [ws, id] of Object.entries(map)) if (!alive.has(id)) delete map[ws];
  return map;
}
const setMap = (wsWindows) => chrome.storage.session.set({ wsWindows });

// ---- serial queue so concurrent events cannot create duplicate windows ----------
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((e) => console.warn("workspaces:", e));
  return run;
};

// ---- snapshots (restore after restart) ------------------------------------------
let snapshotTimer = null;
function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => enqueue(takeSnapshot), SNAPSHOT_DELAY_MS);
}
async function takeSnapshot() {
  const map = await getMap();
  const { wsTabs } = await chrome.storage.local.get("wsTabs");
  const next = { ...(wsTabs || {}) };
  for (const [ws, windowId] of Object.entries(map)) {
    const tabs = await chrome.tabs.query({ windowId });
    const urls = tabs.map((t) => t.url || t.pendingUrl || "").filter((u) => /^https?:\/\//.test(u));
    next[ws] = urls.slice(0, MAX_RESTORED_TABS);
  }
  await chrome.storage.local.set({ wsTabs: next });
}

// ---- core -----------------------------------------------------------------------
function boundsOf(win) {
  if (!win) return {};
  if (win.state === "maximized" || win.state === "fullscreen") return { state: "maximized" };
  return { left: win.left, top: win.top, width: win.width, height: win.height };
}

// like: window to copy size/state from. refocus: window to give focus back to after creating a maximized window.
async function ensureWindow(wsId, like, refocus) {
  const map = await getMap();
  if (map[wsId]) return map[wsId];
  const { wsTabs } = await chrome.storage.local.get("wsTabs");
  const urls = (wsTabs && wsTabs[wsId]) || [];
  const frame = boundsOf(like);
  // Chromium rejects { state: "maximized", focused: false }, so a maximized window is created focused
  const created = await chrome.windows.create({
    url: urls.length ? urls : NEWTAB,
    ...frame,
    ...(frame.state ? {} : { focused: false }),
  });
  map[wsId] = created.id;
  await setMap(map);
  if (frame.state && refocus) await chrome.windows.update(refocus, { focused: true }).catch(() => {});
  return created.id;
}

function switchTo(wsId) {
  return enqueue(async () => {
    const wss = await getWorkspaces();
    if (!wss.some((w) => w.id === wsId)) return;
    const map = await getMap();
    const curId = await getActiveId();
    const curWin = map[curId] ? await chrome.windows.get(map[curId]).catch(() => null) : null;

    const targetId = await ensureWindow(wsId, curWin);
    if (targetId === map[curId]) return setActiveId(wsId);

    const target = await chrome.windows.get(targetId);
    const update = { focused: true, ...boundsOf(curWin) };
    if (target.state === "minimized" && !update.state) update.state = "normal";
    await chrome.windows.update(targetId, update);
    if (map[curId] && map[curId] !== targetId) await chrome.windows.update(map[curId], { state: "minimized" }).catch(() => {});
    await setActiveId(wsId);
  });
}

async function listState() {
  const wss = await getWorkspaces();
  const map = await getMap();
  const { wsTabs } = await chrome.storage.local.get("wsTabs");
  const out = [];
  for (const ws of wss) {
    const count = map[ws.id] ? (await chrome.tabs.query({ windowId: map[ws.id] })).length : ((wsTabs && wsTabs[ws.id]) || []).length;
    out.push({ ...ws, count });
  }
  return { workspaces: out, activeId: await getActiveId() };
}

async function addWorkspace(name) {
  name = String(name || "").trim();
  const wss = await getWorkspaces();
  if (!name || wss.some((w) => w.name === name)) return { error: "이름이 비었거나 이미 있어요." };
  const icon = ICONS.find((i) => !wss.some((w) => w.icon === i)) || ICONS[wss.length % ICONS.length];
  wss.push({ id: "w" + Date.now().toString(36), name, icon });
  await saveWorkspaces(wss);
  return {};
}

async function renameWorkspace(id, name) {
  name = String(name || "").trim();
  const wss = await getWorkspaces();
  const ws = wss.find((w) => w.id === id);
  if (!ws || !name) return { error: "이름이 비었어요." };
  if (wss.some((w) => w.id !== id && w.name === name)) return { error: "이미 있는 이름이에요." };
  ws.name = name;
  await saveWorkspaces(wss);
  return {};
}

async function setIcon(id, icon) {
  const wss = await getWorkspaces();
  const ws = wss.find((w) => w.id === id);
  if (!ws || !ICONS.includes(icon)) return { error: "알 수 없는 아이콘이에요." };
  ws.icon = icon;
  await saveWorkspaces(wss);
  return {};
}

function deleteWorkspace(id) {
  return enqueue(async () => {
    const wss = await getWorkspaces();
    if (wss.length <= 1) return { error: "마지막 워크스페이스는 삭제할 수 없어요." };
    const rest = wss.filter((w) => w.id !== id);
    const map = await getMap();
    const destWin = await ensureWindow(rest[0].id, null);
    if (map[id]) {
      // keep the tabs: move them into the first remaining workspace, then drop the empty window
      const tabs = await chrome.tabs.query({ windowId: map[id] });
      if (tabs.length) await chrome.tabs.move(tabs.map((t) => t.id), { windowId: destWin, index: -1 });
      await chrome.windows.remove(map[id]).catch(() => {});
      delete map[id];
      await setMap(map);
    }
    await saveWorkspaces(rest);
    const { wsTabs } = await chrome.storage.local.get("wsTabs");
    if (wsTabs) {
      delete wsTabs[id];
      await chrome.storage.local.set({ wsTabs });
    }
    const active = await getActiveId();
    if (active === id || !rest.some((w) => w.id === active)) await setActiveId(rest[0].id);
    return {};
  });
}

// move the active tab of the focused workspace window into another workspace
function moveActiveTab(toId) {
  return enqueue(async () => {
    const map = await getMap();
    const fromId = await getActiveId();
    if (fromId === toId || !map[fromId]) return { error: "같은 워크스페이스예요." };
    const [tab] = await chrome.tabs.query({ windowId: map[fromId], active: true });
    if (!tab) return { error: "옮길 탭이 없어요." };
    const toWin = await ensureWindow(toId, await chrome.windows.get(map[fromId]), map[fromId]);
    await chrome.tabs.move(tab.id, { windowId: toWin, index: -1 });
    return {};
  });
}

// ---- adopt the windows that exist at startup ---------------------------------------
async function adoptStartupWindow() {
  const map = await getMap();
  const activeId = await getActiveId();
  if (Object.keys(map).length) return;
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (!wins.length) return;
  const win = wins.find((w) => w.focused) || wins[0];
  map[activeId] = win.id;
  await setMap(map);

  // bring back the workspace's tabs when the window only holds a fresh new tab
  const { wsTabs } = await chrome.storage.local.get("wsTabs");
  const saved = (wsTabs && wsTabs[activeId]) || [];
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const fresh = tabs.length === 1 && [NEWTAB, "chrome://newtab/", "about:blank", ""].includes(tabs[0].url || tabs[0].pendingUrl || "");
  if (saved.length && fresh) {
    await chrome.tabs.update(tabs[0].id, { url: saved[0] });
    for (const url of saved.slice(1)) await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
}

async function init() {
  const { workspaces } = await chrome.storage.local.get("workspaces");
  // first run, or workspaces saved by the old tab-group version (no icons): store the normalized list
  if (!Array.isArray(workspaces) || workspaces.some((w) => !ICONS.includes(w.icon))) await saveWorkspaces(await getWorkspaces());
  await enqueue(adoptStartupWindow);
}

// ---- events ----------------------------------------------------------------------
// Other modules share this service worker's onMessage: only answer our own "ws:" messages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("ws:")) return;
  (async () => {
    switch (msg.type) {
      case "ws:state":
        return listState();
      case "ws:switch":
        await switchTo(msg.id);
        return {};
      case "ws:add":
        return addWorkspace(msg.name);
      case "ws:rename":
        return renameWorkspace(msg.id, msg.name);
      case "ws:icon":
        return setIcon(msg.id, msg.icon);
      case "ws:delete":
        return deleteWorkspace(msg.id);
      case "ws:moveTab":
        return moveActiveTab(msg.id);
    }
    return {};
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true; // async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "next-workspace") return;
  const wss = await getWorkspaces();
  const activeId = await getActiveId();
  await switchTo(wss[(wss.findIndex((w) => w.id === activeId) + 1) % wss.length].id);
});

// Focusing another workspace window (Alt+Tab, taskbar) makes that workspace the active one.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  enqueue(async () => {
    const map = await getMap();
    const hit = Object.entries(map).find(([, id]) => id === windowId);
    if (hit && (await getActiveId()) !== hit[0]) await setActiveId(hit[0]);
  });
});

chrome.windows.onRemoved.addListener(() => scheduleSnapshot());
for (const ev of ["onCreated", "onRemoved", "onUpdated", "onMoved", "onAttached", "onDetached"]) {
  chrome.tabs[ev].addListener(() => scheduleSnapshot());
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init().catch((e) => console.warn("workspaces init:", e));
