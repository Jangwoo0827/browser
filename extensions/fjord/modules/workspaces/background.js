// Workspace = a tab group (same title + colour) in each window. Only the active workspace's group is expanded.
const COLORS = ["blue", "orange", "green", "red", "purple", "cyan", "pink", "yellow", "grey"];
const DEFAULTS = [
  { id: "personal", name: "개인", color: "blue" },
  { id: "work", name: "업무", color: "orange" },
];

// ---- storage -------------------------------------------------------------
async function getWorkspaces() {
  const { workspaces } = await chrome.storage.local.get("workspaces");
  return Array.isArray(workspaces) && workspaces.length ? workspaces : DEFAULTS.map((w) => ({ ...w }));
}
const saveWorkspaces = (workspaces) => chrome.storage.local.set({ workspaces });

async function sessionGet(key) {
  return (await chrome.storage.session.get(key))[key] || {};
}
async function getActiveId(windowId, wss) {
  const map = await sessionGet("active");
  if (wss.some((w) => w.id === map[windowId])) return map[windowId];
  // after a restart: the workspace whose group is currently expanded, else the first one
  for (const ws of wss) {
    const g = await findGroup(windowId, ws);
    if (g && !g.collapsed) return ws.id;
  }
  return wss[0].id;
}
async function setActiveId(windowId, id) {
  const map = await sessionGet("active");
  map[windowId] = id;
  await chrome.storage.session.set({ active: map });
}
async function rememberTab(windowId, wsId, tabId) {
  const last = await sessionGet("last");
  last[`${windowId}:${wsId}`] = tabId;
  await chrome.storage.session.set({ last });
}

// ---- serial queue: every group mutation goes through here to avoid duplicate groups --------------
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((e) => console.warn("workspaces:", e));
  return run;
};

// ---- helpers -------------------------------------------------------------
async function isNormalWindow(windowId) {
  try {
    return (await chrome.windows.get(windowId)).type === "normal";
  } catch {
    return false;
  }
}
async function findGroup(windowId, ws) {
  const gs = await chrome.tabGroups.query({ windowId, title: ws.name });
  return gs[0];
}
async function assignTab(tab, ws) {
  const g = await findGroup(tab.windowId, ws);
  if (g) {
    await chrome.tabs.group({ groupId: g.id, tabIds: [tab.id] });
    return g.id;
  }
  const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: ws.name, color: ws.color });
  return groupId;
}
async function collapseOthers(windowId, wss, activeId) {
  for (const ws of wss) {
    if (ws.id === activeId) continue;
    const g = await findGroup(windowId, ws);
    if (g && !g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: true });
  }
}

// ---- core operations -----------------------------------------------------
function switchTo(windowId, wsId) {
  return enqueue(async () => {
    if (!(await isNormalWindow(windowId))) return;
    const wss = await getWorkspaces();
    const target = wss.find((w) => w.id === wsId);
    if (!target) return;
    await setActiveId(windowId, wsId);

    let g = await findGroup(windowId, target);
    let tabId;
    if (g) {
      const tabs = await chrome.tabs.query({ windowId, groupId: g.id });
      const last = (await sessionGet("last"))[`${windowId}:${wsId}`];
      tabId = (tabs.find((t) => t.id === last) || tabs[0] || {}).id;
    }
    if (tabId === undefined) {
      const t = await chrome.tabs.create({ windowId, active: true });
      await assignTab(t, target);
      tabId = t.id;
      g = await findGroup(windowId, target);
    }
    await chrome.tabs.update(tabId, { active: true });
    if (g) await chrome.tabGroups.update(g.id, { collapsed: false });
    await collapseOthers(windowId, wss, wsId);
  });
}

// Put every loose (ungrouped, unpinned) tab of a window into the active workspace.
function adoptLooseTabs(windowId) {
  return enqueue(async () => {
    if (!(await isNormalWindow(windowId))) return;
    const wss = await getWorkspaces();
    const activeId = await getActiveId(windowId, wss);
    const active = wss.find((w) => w.id === activeId);
    const tabs = await chrome.tabs.query({ windowId, pinned: false });
    for (const t of tabs.filter((t) => t.groupId === -1)) await assignTab(t, active);
    await collapseOthers(windowId, wss, activeId);
  });
}

async function listState(windowId) {
  const wss = await getWorkspaces();
  const activeId = await getActiveId(windowId, wss);
  const out = [];
  for (const ws of wss) {
    const g = await findGroup(windowId, ws);
    const count = g ? (await chrome.tabs.query({ windowId, groupId: g.id })).length : 0;
    out.push({ ...ws, count });
  }
  return { workspaces: out, activeId };
}

async function addWorkspace(name) {
  name = String(name || "").trim();
  const wss = await getWorkspaces();
  if (!name || wss.some((w) => w.name === name)) return { error: "이름이 비었거나 이미 있어요." };
  const color = COLORS.find((c) => !wss.some((w) => w.color === c)) || COLORS[wss.length % COLORS.length];
  wss.push({ id: "w" + Date.now().toString(36), name, color });
  await saveWorkspaces(wss);
  return {};
}

function renameWorkspace(id, name) {
  return enqueue(async () => {
    name = String(name || "").trim();
    const wss = await getWorkspaces();
    const ws = wss.find((w) => w.id === id);
    if (!ws || !name) return { error: "이름이 비었어요." };
    if (wss.some((w) => w.id !== id && w.name === name)) return { error: "이미 있는 이름이에요." };
    const oldName = ws.name;
    ws.name = name;
    await saveWorkspaces(wss);
    for (const g of await chrome.tabGroups.query({ title: oldName })) await chrome.tabGroups.update(g.id, { title: name });
    return {};
  });
}

function deleteWorkspace(id) {
  return enqueue(async () => {
    const wss = await getWorkspaces();
    if (wss.length <= 1) return { error: "마지막 워크스페이스는 삭제할 수 없어요." };
    const ws = wss.find((w) => w.id === id);
    if (!ws) return {};
    const rest = wss.filter((w) => w.id !== id);
    const dest = rest[0];
    for (const g of await chrome.tabGroups.query({ title: ws.name })) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      if (!tabs.length) continue;
      const destGroup = await findGroup(g.windowId, dest);
      if (destGroup) {
        await chrome.tabs.group({ groupId: destGroup.id, tabIds: tabs.map((t) => t.id) });
      } else {
        await chrome.tabGroups.update(g.id, { title: dest.name, color: dest.color });
      }
    }
    await saveWorkspaces(rest);
    const map = await sessionGet("active");
    for (const [winId, wsId] of Object.entries(map)) if (wsId === id) map[winId] = dest.id;
    await chrome.storage.session.set({ active: map });
    return {};
  });
}

// ---- events --------------------------------------------------------------
// Other modules share this service worker's onMessage: only answer our own "ws:" messages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("ws:")) return;
  (async () => {
    switch (msg.type) {
      case "ws:state":
        return listState(msg.windowId);
      case "ws:switch":
        await switchTo(msg.windowId, msg.id);
        return {};
      case "ws:add":
        return addWorkspace(msg.name);
      case "ws:rename":
        return renameWorkspace(msg.id, msg.name);
      case "ws:delete":
        return deleteWorkspace(msg.id);
    }
    return {};
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true; // async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "next-workspace") return;
  const win = await chrome.windows.getLastFocused();
  const wss = await getWorkspaces();
  const activeId = await getActiveId(win.id, wss);
  const next = wss[(wss.findIndex((w) => w.id === activeId) + 1) % wss.length];
  await switchTo(win.id, next.id);
});

// Other extensions (e.g. Claude) create a tab and put it into their own group a moment later. Wait for them
// before adopting a loose tab, otherwise we steal it and their group disappears from under them.
const ADOPT_DELAY_MS = 1500;
const later = (fn) => setTimeout(fn, ADOPT_DELAY_MS);

// New tabs join the active workspace.
chrome.tabs.onCreated.addListener((tab) => {
  later(() => enqueue(async () => {
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t || t.pinned || t.groupId !== -1 || !(await isNormalWindow(t.windowId))) return;
    const wss = await getWorkspaces();
    const activeId = await getActiveId(t.windowId, wss);
    await assignTab(t, wss.find((w) => w.id === activeId));
  }));
});

// A tab dragged into another window joins that window's active workspace.
chrome.tabs.onAttached.addListener((tabId) => {
  later(() => enqueue(async () => {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.pinned || t.groupId !== -1 || !(await isNormalWindow(t.windowId))) return;
    const wss = await getWorkspaces();
    const activeId = await getActiveId(t.windowId, wss);
    await assignTab(t, wss.find((w) => w.id === activeId));
  }));
});

// Activating a tab of another workspace (search, history, a click on an expanded group) switches the workspace.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  enqueue(async () => {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.groupId === -1) return;
    const g = await chrome.tabGroups.get(t.groupId).catch(() => null);
    if (!g) return;
    const wss = await getWorkspaces();
    const ws = wss.find((w) => w.name === g.title);
    if (!ws) return;
    await rememberTab(windowId, ws.id, tabId);
    if ((await getActiveId(windowId, wss)) === ws.id) return;
    await setActiveId(windowId, ws.id);
    if (g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: false });
    await collapseOthers(windowId, wss, ws.id);
  });
});

async function init() {
  const { workspaces } = await chrome.storage.local.get("workspaces");
  if (!Array.isArray(workspaces)) await saveWorkspaces(DEFAULTS);
  for (const w of await chrome.windows.getAll({ windowTypes: ["normal"] })) await adoptLooseTabs(w.id);
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.windows.onCreated.addListener((w) => {
  if (w.type === "normal") setTimeout(() => adoptLooseTabs(w.id), ADOPT_DELAY_MS);
});
