// Page context menu: "Fjord 메모에 추가" (selected text -> a note that remembers the page) and "이 페이지를 Fjord 웹 패널로 추가"
// (the page becomes a pinned site, i.e. a web panel in the side panel and on the rail). The click is a user gesture, so the
// side panel can be opened on the spot.
import { Store } from "../sidebar/store.js";

const NOTE_MENU = "fjord-note-selection";
const PANEL_MENU = "fjord-web-panel";

async function setupMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: NOTE_MENU, title: "Fjord 메모에 추가", contexts: ["selection"] });
  chrome.contextMenus.create({ id: PANEL_MENU, title: "이 페이지를 Fjord 웹 패널로 추가", contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] });
}
chrome.runtime.onInstalled.addListener(() => setupMenus());
chrome.runtime.onStartup.addListener(() => setupMenus());

// show the side panel on a pane / panel (must be called straight from the click)
async function openPanel(windowId, activeId) {
  const opened = chrome.sidePanel.open({ windowId });
  const { ui } = await chrome.storage.local.get("ui");
  await chrome.storage.local.set({ ui: { ...(ui || {}), activeId } });
  await opened.catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === NOTE_MENU) {
    const { notes = [] } = await chrome.storage.local.get("notes");
    const text = String(info.selectionText || "").trim();
    notes.push({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), body: text, url: tab.url, pageTitle: tab.title || "", created: Date.now(), updated: Date.now() });
    await chrome.storage.local.set({ notes });
    await openPanel(tab.windowId, "@notes");
  } else if (info.menuItemId === PANEL_MENU) {
    const { items } = await Store.load();
    const url = Store.normalizeUrl(tab.url);
    if (!url) return;
    let item = items.find((i) => i.url === url) || items.find((i) => { try { return new URL(i.url).origin === new URL(url).origin; } catch { return false; } });
    if (!item) {
      item = { id: Store.newId(), name: (tab.title || new URL(url).hostname).split(/ [-|·–—] /)[0].slice(0, 24), url };
      await Store.saveItems([...items, item]);
    }
    await openPanel(tab.windowId, item.id);
  }
});
