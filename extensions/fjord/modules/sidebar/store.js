// Shared storage helpers for the panel, the options page and the service worker (ES module).
const DEFAULT_ITEMS = [
  { id: "claude", name: "Claude", url: "https://claude.ai/" },
  { id: "google", name: "Google", url: "https://www.google.com/" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
];
const DEFAULT_UI = { collapsed: true, activeId: null };

async function load() {
  const data = await chrome.storage.local.get(["items", "ui"]);
  return {
    items: Array.isArray(data.items) ? data.items : DEFAULT_ITEMS.map((i) => ({ ...i })),
    ui: { ...DEFAULT_UI, ...(data.ui || {}) },
  };
}

const saveItems = (items) => chrome.storage.local.set({ items });
const saveUi = (ui) => chrome.storage.local.set({ ui });

function normalizeUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

const newId = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const Store = { DEFAULT_ITEMS, load, saveItems, saveUi, normalizeUrl, newId };
