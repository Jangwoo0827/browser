// Quick find (Ctrl+Shift+K): one box that searches open tabs, bookmarks, history, workspaces and commands, and also takes
// an address or a search. The box is an overlay on ordinary web pages (content script) and a small popup window on pages
// where scripts cannot run (new tab page, chrome:// pages, the store). Only "quick:*" messages are handled here.
const COMMAND = "quick-find";
const MAX = { tabs: 6, bookmarks: 5, history: 5 };

const norm = (s) => String(s || "").toLowerCase();
const matches = (q, ...fields) => q.split(/\s+/).every((word) => fields.some((f) => norm(f).includes(word)));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function search(rawQuery) {
  const q = norm(rawQuery).trim();
  const out = [];

  const [wins, ws] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
    chrome.storage.session.get("wsWindows").then((r) => r.wsWindows || {}),
  ]);
  const { workspaces } = await chrome.storage.local.get("workspaces");
  const wsName = {};
  for (const [id, windowId] of Object.entries(ws)) wsName[windowId] = (workspaces || []).find((w) => w.id === id)?.name;
  const tabs = wins.flatMap((w) => (w.tabs || []).map((t) => ({ ...t, ws: wsName[w.id] })));
  const tabHits = tabs
    .filter((t) => !q || matches(q, t.title, t.url))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, q ? MAX.tabs : 8);
  for (const t of tabHits) out.push({ kind: "tab", id: t.id, windowId: t.windowId, title: t.title || t.url, sub: [t.ws, hostOf(t.url)].filter(Boolean).join(" · "), url: t.url });

  if (q) {
    const seen = new Set(tabHits.map((t) => t.url));
    for (const b of (await chrome.bookmarks.search(q)).filter((n) => n.url && !seen.has(n.url)).slice(0, MAX.bookmarks)) {
      seen.add(b.url);
      out.push({ kind: "bookmark", title: b.title || b.url, sub: hostOf(b.url), url: b.url });
    }
    for (const h of (await chrome.history.search({ text: q, maxResults: 30, startTime: 0 })).filter((x) => !seen.has(x.url)).slice(0, MAX.history)) {
      seen.add(h.url);
      out.push({ kind: "history", title: h.title || h.url, sub: hostOf(h.url), url: h.url });
    }
  }
  return out;
}

async function currentTabId(sender) {
  if (sender?.tab) return sender.tab.id;
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  if (!win) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab ? tab.id : null;
}

async function run(item, sender) {
  const newTab = !!item.newTab;
  if (item.kind === "tab") {
    await chrome.tabs.update(item.id, { active: true });
    await chrome.windows.update(item.windowId, { focused: true });
  } else if (item.kind === "url") {
    if (newTab) await chrome.tabs.create({ url: item.url });
    else await chrome.tabs.update(await currentTabId(sender), { url: item.url });
  } else if (item.kind === "search") {
    const tabId = await currentTabId(sender);
    await chrome.search.query(newTab || tabId == null ? { text: item.text, disposition: "NEW_TAB" } : { text: item.text, disposition: "CURRENT_TAB", tabId });
  }
}

async function openWindowFallback() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  const width = 680;
  const height = 500;
  await chrome.windows.create({
    url: chrome.runtime.getURL("modules/quick/quick.html"), type: "popup", width, height,
    left: win && win.left != null ? Math.round(win.left + (win.width - width) / 2) : undefined,
    top: win && win.top != null ? Math.round(win.top + 80) : undefined,
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== COMMAND) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("not scriptable");
    await chrome.tabs.sendMessage(tab.id, { type: "quick:toggle" });
  } catch {
    await openWindowFallback(); // no content script here (internal page, still loading, blocked site)
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("quick:")) return;
  (async () => {
    if (msg.type === "quick:query") return { results: await search(msg.q) };
    if (msg.type === "quick:run") { await run(msg.item, sender); return { ok: true }; }
    if (msg.type === "quick:open-internal" && /^chrome:\/\//.test(msg.url)) { await chrome.tabs.create({ url: msg.url }); return { ok: true }; }
    return { ok: false };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
