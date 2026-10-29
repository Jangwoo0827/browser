// Persistent browser state: workspaces, their tabs (URLs/titles only; views are created lazily), pinned sites.
const fs = require("node:fs");
const path = require("node:path");

const ICONS = ["home", "briefcase", "gamepad", "book", "star", "heart", "code", "globe"];
const DEFAULT_WORKSPACES = [
  { id: "personal", name: "개인", icon: "home" },
  { id: "work", name: "업무", icon: "briefcase" },
];
const DEFAULT_PINNED = [
  { id: "claude", name: "Claude", url: "https://claude.ai/" },
  { id: "google", name: "Google", url: "https://www.google.com/" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
];

const ENGINES = {
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  naver: { name: "네이버", url: "https://search.naver.com/search.naver?query=%s" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
};
const SETTING_DEFAULTS = { bookmarkBar: true, searchEngine: "google", customSearch: "", startup: "restore", homeUrl: "", showHome: false, theme: "system", downloadDir: "" };
const ENUMS = { searchEngine: [...Object.keys(ENGINES), "custom"], startup: ["restore", "newtab", "home"], theme: ["system", "light", "dark"] };

class Store {
  constructor(file) {
    this.file = file;
    this.data = this._load();
    this._timer = null;
    this.crashed = this.data.running === true; // the previous run never reached before-quit
    this.data.running = true;
  }

  _load() {
    let d = {};
    try {
      d = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    const workspaces = Array.isArray(d.workspaces) && d.workspaces.length ? d.workspaces : DEFAULT_WORKSPACES.map((w) => ({ ...w }));
    return {
      workspaces,
      activeWs: workspaces.some((w) => w.id === d.activeWs) ? d.activeWs : workspaces[0].id,
      tabs: d.tabs && typeof d.tabs === "object" ? d.tabs : {},
      pinned: Array.isArray(d.pinned) ? d.pinned : DEFAULT_PINNED.map((p) => ({ ...p })),
      history: Array.isArray(d.history) ? d.history : [],
      closed: Array.isArray(d.closed) ? d.closed : [],
      bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
      folders: Array.isArray(d.folders) ? d.folders : [],
      settings: { ...SETTING_DEFAULTS, ...(d.settings || {}) },
      window: d.window && typeof d.window === "object" ? d.window : null,
      running: d.running === true,
    };
  }

  save(now = false) {
    clearTimeout(this._timer);
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        // only persistent fields of a tab
        const tabs = {};
        for (const [ws, t] of Object.entries(this.data.tabs)) {
          tabs[ws] = { active: t.active, list: t.list.map(({ id, url, title, favicon, pinned }) => ({ id, url, title, favicon, pinned: !!pinned })) };
        }
        fs.writeFileSync(this.file, JSON.stringify({ ...this.data, tabs }, null, 1));
      } catch (e) {
        console.warn("[fjord] save failed:", e.message);
      }
    };
    if (now) write();
    else this._timer = setTimeout(write, 400);
  }

  // ---- settings ----
  searchUrl(q) {
    const s = this.data.settings;
    const custom = s.searchEngine === "custom" && /^https?:\/\/\S*%s\S*$/i.test(s.customSearch || "");
    const tpl = custom ? s.customSearch : (ENGINES[s.searchEngine] || ENGINES.google).url;
    return tpl.replace("%s", encodeURIComponent(q));
  }

  engineName() {
    const s = this.data.settings;
    return s.searchEngine === "custom" ? "검색엔진" : (ENGINES[s.searchEngine] || ENGINES.google).name;
  }

  setSetting(key, value) {
    if (!(key in SETTING_DEFAULTS)) return { error: "알 수 없는 설정이에요." };
    if (typeof SETTING_DEFAULTS[key] === "boolean") {
      if (typeof value !== "boolean") return { error: "켜짐/꺼짐 값이어야 해요." };
    } else if (typeof value !== "string") {
      return { error: "문자열이어야 해요." };
    } else if (ENUMS[key] && !ENUMS[key].includes(value)) {
      return { error: "허용되지 않는 값이에요." };
    } else if (key === "customSearch" && value && !/^https?:\/\/\S*%s\S*$/i.test(value.trim())) {
      return { error: "http(s):// 주소에 검색어 자리 %s가 들어가야 해요." };
    } else if (key === "homeUrl") {
      value = value.trim();
      if (value) {
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
        let u = null;
        try { u = new URL(value); } catch {}
        if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) return { error: "올바른 주소가 아니에요." };
      }
    } else if (key === "downloadDir" && value && !require("node:path").isAbsolute(value)) {
      return { error: "폴더의 전체 경로여야 해요." };
    } else if (key === "customSearch") {
      value = value.trim();
    }
    this.data.settings[key] = value;
    this.save();
    return { value };
  }

  // startup "새 탭" / "홈페이지": keep only the pinned tabs of every workspace
  dropUnpinnedTabs() {
    for (const t of Object.values(this.data.tabs)) {
      t.list = t.list.filter((x) => x.pinned);
      t.active = t.list[0] ? t.list[0].id : null;
    }
  }

  get workspaces() { return this.data.workspaces; }
  get pinned() { return this.data.pinned; }
  get activeWs() { return this.data.activeWs; }
  set activeWs(id) { this.data.activeWs = id; }

  tabsOf(wsId) {
    if (!this.data.tabs[wsId]) this.data.tabs[wsId] = { active: null, list: [] };
    return this.data.tabs[wsId];
  }

  findTab(tabId) {
    for (const [wsId, t] of Object.entries(this.data.tabs)) {
      const tab = t.list.find((x) => x.id === tabId);
      if (tab) return { wsId, tab, bucket: t };
    }
    return null;
  }

  addWorkspace(name) {
    name = String(name || "").trim();
    if (!name || this.workspaces.some((w) => w.name === name)) return { error: "이름이 비었거나 이미 있어요." };
    const icon = ICONS.find((i) => !this.workspaces.some((w) => w.icon === i)) || ICONS[this.workspaces.length % ICONS.length];
    const id = "w" + Date.now().toString(36);
    this.workspaces.push({ id, name, icon });
    this.save();
    return { id };
  }

  renameWorkspace(id, name) {
    name = String(name || "").trim();
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws || !name) return { error: "이름이 비었어요." };
    if (this.workspaces.some((w) => w.id !== id && w.name === name)) return { error: "이미 있는 이름이에요." };
    ws.name = name;
    this.save();
    return {};
  }

  // ---- bookmarks: folder is "bar" | "other" | a folder id (folders live under the bar or "other") ----
  findBookmark(url) { return this.data.bookmarks.find((b) => b.url === url) || null; }

  addBookmark({ title, url, folder = "bar" }) {
    if (!/^(https?|file):\/\//i.test(url || "")) return null;
    const existing = this.findBookmark(url);
    if (existing) return existing;
    const b = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: title || url, url, folder, at: Date.now() };
    this.data.bookmarks.push(b);
    this.save();
    return b;
  }

  updateBookmark(id, patch) {
    const b = this.data.bookmarks.find((x) => x.id === id);
    if (!b) return null;
    if (typeof patch.title === "string" && patch.title.trim()) b.title = patch.title.trim();
    if (patch.folder && (patch.folder === "bar" || patch.folder === "other" || this.data.folders.some((f) => f.id === patch.folder))) b.folder = patch.folder;
    this.save();
    return b;
  }

  removeBookmark(id) {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    this.save();
  }

  addFolder(name, parent = "bar") {
    name = String(name || "").trim();
    if (!name) return { error: "이름이 비었어요." };
    if (this.data.folders.some((f) => f.name === name && f.parent === parent)) return { error: "이미 있는 폴더예요." };
    const f = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name, parent: parent === "other" ? "other" : "bar" };
    this.data.folders.push(f);
    this.save();
    return f;
  }

  renameFolder(id, name) {
    const f = this.data.folders.find((x) => x.id === id);
    name = String(name || "").trim();
    if (!f || !name) return { error: "이름이 비었어요." };
    f.name = name;
    this.save();
    return {};
  }

  removeFolder(id) {
    for (const b of this.data.bookmarks) if (b.folder === id) b.folder = "other"; // bookmarks are never deleted with a folder
    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    this.save();
  }

  // Netscape bookmark file (what Chrome/Firefox/Edge export and import)
  exportHtml() {
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const link = (b) => `<DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.round((b.at || Date.now()) / 1000)}">${esc(b.title)}</A>`;
    const folder = (f) => `<DT><H3>${esc(f.name)}</H3>\n<DL><p>\n${this.data.bookmarks.filter((b) => b.folder === f.id).map(link).join("\n")}\n</DL><p>`;
    const section = (parent) => this.data.folders.filter((f) => f.parent === parent).map(folder).join("\n");
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n` +
      `<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">북마크 바</H3>\n<DL><p>\n${section("bar")}\n${this.data.bookmarks.filter((b) => b.folder === "bar").map(link).join("\n")}\n</DL><p>\n` +
      `<DT><H3>기타 북마크</H3>\n<DL><p>\n${section("other")}\n${this.data.bookmarks.filter((b) => b.folder === "other").map(link).join("\n")}\n</DL><p>\n</DL><p>\n`;
  }

  importHtml(html) {
    const unesc = (t) => t.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
    const re = /<H3([^>]*)>([\s\S]*?)<\/H3>|<A\s[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<\/DL>|<DL>/gi;
    const stack = []; // one entry per open <DL>: "bar" | "other" | folder id
    let pending = null;
    let added = 0;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0].toLowerCase();
      if (m[2] !== undefined) {
        const name = unesc(m[2]);
        if (/personal_toolbar_folder/i.test(m[1]) || /^(북마크 바|bookmarks bar|bookmarks toolbar|즐겨찾기 모음)$/i.test(name)) pending = "bar";
        else if (/^(기타 북마크|other bookmarks|기타 즐겨찾기)$/i.test(name) || stack.length === 0) pending = "other";
        else {
          const parent = stack.includes("bar") ? "bar" : "other";
          const f = this.data.folders.find((x) => x.name === name && x.parent === parent) || this.addFolder(name, parent);
          pending = f.id; // nested folders are flattened into this one
        }
      } else if (tag === "<dl>") {
        stack.push(pending || stack[stack.length - 1] || "other");
        pending = null;
      } else if (tag === "</dl>") {
        stack.pop();
      } else if (m[3] !== undefined) {
        const b = this.addBookmark({ title: unesc(m[4]) || m[3], url: m[3], folder: stack[stack.length - 1] || "other" });
        if (b) added++;
      }
    }
    this.save();
    return { added };
  }

  // ---- recently closed tabs (Ctrl+Shift+T) ----
  pushClosed(entry) {
    this.data.closed.push({ ...entry, at: Date.now() });
    if (this.data.closed.length > 25) this.data.closed.shift();
    this.save();
  }

  popClosed() {
    const c = this.data.closed.pop();
    if (c) this.save();
    return c;
  }

  // ---- history (most recent first, one entry per URL) ----
  addHistory(url, title) {
    if (!/^https?:\/\//i.test(url || "")) return;
    const h = this.data.history;
    const i = h.findIndex((e) => e.url === url);
    const entry = i >= 0 ? h.splice(i, 1)[0] : { url, title: "", visits: 0 };
    entry.title = title || entry.title;
    entry.visits += 1;
    entry.at = Date.now();
    h.unshift(entry);
    if (h.length > 5000) h.length = 5000;
    this.save();
  }

  updateHistoryTitle(url, title) {
    const e = this.data.history.find((x) => x.url === url);
    if (e && title) { e.title = title; this.save(); }
  }

  clearHistory() {
    this.data.history = [];
    this.save();
  }

  // address-bar suggestions: pinned sites and history, best match first
  suggest(query, limit = 7) {
    const q = String(query || "").trim().toLowerCase();
    const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
    if (!q) return this.data.history.slice(0, limit).map((e) => ({ type: "history", title: e.title || host(e.url), url: e.url }));
    const scored = [];
    for (const b of this.data.bookmarks) {
      const hay = (b.title + " " + b.url).toLowerCase();
      if (hay.includes(q)) scored.push({ score: 60 + (b.title.toLowerCase().startsWith(q) ? 15 : 0), item: { type: "bookmark", title: b.title, url: b.url } });
    }
    for (const p of this.data.pinned) {
      const hay = (p.name + " " + p.url).toLowerCase();
      if (hay.includes(q)) scored.push({ score: 50 + (p.name.toLowerCase().startsWith(q) ? 20 : 0), item: { type: "pin", title: p.name, url: p.url } });
    }
    this.data.history.forEach((e, rank) => {
      const h = host(e.url).toLowerCase();
      const t = (e.title || "").toLowerCase();
      let score = 0;
      if (h.startsWith(q)) score = 40;
      else if (t.startsWith(q)) score = 30;
      else if (h.includes(q) || t.includes(q) || e.url.toLowerCase().includes(q)) score = 15;
      if (score) scored.push({ score: score + Math.min(e.visits, 10) - rank * 0.01, item: { type: "history", title: e.title || host(e.url), url: e.url } });
    });
    const seen = new Set();
    return scored.sort((a, b) => b.score - a.score).map((x) => x.item).filter((i) => (seen.has(i.url) ? false : seen.add(i.url))).slice(0, limit);
  }

  cycleIcon(id) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;
    ws.icon = ICONS[(ICONS.indexOf(ws.icon) + 1) % ICONS.length];
    this.save();
  }
}

module.exports = {
  ENGINES, Store, ICONS };
