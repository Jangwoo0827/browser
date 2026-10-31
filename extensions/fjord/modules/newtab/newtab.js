import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";
import { loadSettings, mountRail } from "../rail/rail.js";
import { resolveFavicon } from "../../ui/favicon.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_WORKSPACES = [{ id: "personal", name: "개인", icon: "home" }, { id: "work", name: "업무", icon: "briefcase" }]; // same defaults as the workspaces module
const DEFAULT_TILES = [
  { id: "claude", name: "Claude", url: "https://claude.ai/" },
  { id: "google", name: "Google", url: "https://www.google.com/" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
  { id: "naver", name: "네이버", url: "https://www.naver.com/" },
  { id: "wikipedia", name: "Wikipedia", url: "https://www.wikipedia.org/" },
];

let workspaces = DEFAULT_WORKSPACES;
let activeId = null;   // the workspace whose tabs are expanded in this window
let current = null;    // the workspace whose speed dial is shown
let dials = {};        // { [workspaceId]: tile[] }
let legacy = null;     // pre-workspace single dial, adopted by the first workspace
let editingId = null;
let dragId = null;

// ---- data ------------------------------------------------------------------
async function load() {
  const data = await chrome.storage.local.get(["workspaces", "dialByWs", "dial", "wsActive"]);
  workspaces = Array.isArray(data.workspaces) && data.workspaces.length ? data.workspaces : DEFAULT_WORKSPACES;
  dials = data.dialByWs && typeof data.dialByWs === "object" ? data.dialByWs : {};
  legacy = Array.isArray(data.dial) ? data.dial : null;
  activeId = data.wsActive;
  if (!workspaces.some((w) => w.id === activeId)) activeId = workspaces[0].id;
  if (!workspaces.some((w) => w.id === current)) current = activeId;
}

function tiles() {
  if (Array.isArray(dials[current])) return dials[current];
  if (current === workspaces[0].id && legacy) return legacy.map((t) => ({ ...t }));
  return DEFAULT_TILES.map((t) => ({ ...t }));
}
async function save(list) {
  dials[current] = list;
  await chrome.storage.local.set({ dialByWs: dials });
}
const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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

// ---- rendering -------------------------------------------------------------
function glyph(name, url) {
  const el = document.createElement("span");
  el.className = "fj-glyph fj-glyph--lg";
  el.style.background = glyphColor(name, url);
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

// Chrome's favicon cache (sharp, works for every site); the letter avatar if it has nothing
const faviconUrl = (url, size = 64) => `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=${size}`;

function favicon(item) {
  const wrap = document.createElement("span");
  wrap.className = "fav-wrap";
  wrap.append(glyph(item.name, item.url)); // letter avatar until (and unless) a real icon turns up
  resolveFavicon(item.url, 64).then((r) => {
    if (!r) return;
    const img = document.createElement("img");
    img.className = "fav";
    img.alt = "";
    img.src = r.src;
    wrap.replaceChildren(img);
    wrap.classList.toggle("dark", r.light); // a white logo needs a dark tile
  });
  return wrap;
}

function toolButton(name, title, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = icon(name);
  b.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return b;
}

function tile(item, list) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = item.url;
  a.draggable = true;
  a.setAttribute("role", "listitem");

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;

  const tools = document.createElement("span");
  tools.className = "tools";
  tools.append(
    toolButton("edit", "편집", () => openDialog(item.id)),
    toolButton("close", "삭제", async () => {
      await save(list.filter((t) => t.id !== item.id));
      render();
    })
  );
  a.append(favicon(item), name, tools);

  a.ondragstart = (e) => {
    dragId = item.id;
    a.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  };
  a.ondragend = () => {
    dragId = null;
    a.classList.remove("dragging");
    document.querySelectorAll(".over").forEach((n) => n.classList.remove("over"));
  };
  a.ondragover = (e) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    a.classList.add("over");
  };
  a.ondragleave = () => a.classList.remove("over");
  a.ondrop = async (e) => {
    e.preventDefault();
    if (!dragId || dragId === item.id) return;
    const next = [...list];
    const from = next.findIndex((t) => t.id === dragId);
    const to = next.findIndex((t) => t.id === item.id);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await save(next);
    render();
  };
  return a;
}

function addTile() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile add";
  b.innerHTML = `${icon("plus")}<span>사이트 추가</span>`;
  b.onclick = () => openDialog(null);
  return b;
}

function renderChips() {
  $("chips").replaceChildren(
    ...workspaces.map((w) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(w.id === current));
      b.innerHTML = icon(w.icon || "home", 14);
      b.append(w.name);
      if (w.id === activeId) {
        const live = document.createElement("span");
        live.className = "live";
        live.title = "지금 활성인 워크스페이스";
        b.prepend(live);
      }
      b.onclick = () => {
        current = w.id;
        render();
      };
      return b;
    })
  );
}

function render() {
  renderChips();
  const list = tiles();
  $("grid").replaceChildren(...list.map((t) => tile(t, list)), addTile());
}

// ---- dialog ----------------------------------------------------------------
function openDialog(id) {
  editingId = id;
  const item = tiles().find((t) => t.id === id);
  $("dlgTitle").textContent = item ? "사이트 편집" : "사이트 추가";
  $("dName").value = item ? item.name : "";
  $("dUrl").value = item ? item.url : "";
  $("dMsg").textContent = "";
  $("dlg").showModal();
  $("dName").focus();
}

$("dCancel").onclick = () => $("dlg").close();
$("dlgForm").onsubmit = async (e) => {
  e.preventDefault();
  const url = normalizeUrl($("dUrl").value);
  const name = $("dName").value.trim();
  if (!url) {
    $("dMsg").textContent = "올바른 주소가 아니에요 (http/https).";
    return;
  }
  const list = tiles();
  const item = list.find((t) => t.id === editingId);
  if (item) Object.assign(item, { name, url });
  else list.push({ id: newId(), name, url });
  await save(list);
  $("dlg").close();
  render();
};

// ---- search + clock ----------------------------------------------------------
// Address-like input navigates directly; anything else goes to the default search engine.
$("search").onsubmit = (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (!text) return;
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || (/^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(text) && !/\s/.test(text));
  if (looksLikeUrl) {
    const url = normalizeUrl(text);
    if (url) {
      location.href = url;
      return;
    }
  }
  chrome.search.query({ text, disposition: "CURRENT_TAB" });
};

function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  $("date").textContent = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const hr = now.getHours();
  $("greeting").textContent = hr < 5 ? "늦은 시간이네요" : hr < 12 ? "좋은 아침이에요" : hr < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
}

// icon for the card rows / tab pills: a letter avatar that turns into the real icon when it is found
function smallIcon(url, title, px) {
  const holder = document.createElement("span");
  holder.className = "small-icon";
  holder.style.setProperty("--px", px + "px");
  holder.append(glyph(title || hostOf(url), url));
  resolveFavicon(url, 32).then((r) => {
    if (!r) return;
    const img = document.createElement("img");
    img.alt = "";
    img.src = r.src;
    holder.replaceChildren(img);
  });
  return holder;
}

// ---- cards: recent visits + bookmark bar (both come from Chrome itself) ----
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function cardRow(item) {
  const a = document.createElement("a");
  a.className = "card-row";
  a.href = item.url;
  a.title = `${item.title || item.url}
${item.url}`;
  const img = smallIcon(item.url, item.title, 18);
  const text = document.createElement("span");
  text.className = "card-text";
  const t = document.createElement("span");
  t.className = "card-title";
  t.textContent = item.title || hostOf(item.url);
  const s = document.createElement("span");
  s.className = "card-sub";
  s.textContent = hostOf(item.url);
  text.append(t, s);
  a.append(img, text);
  return a;
}

async function renderCards() {
  const tile = new Set(tiles().map((x) => hostOf(x.url)));
  let recent = [];
  try {
    const seen = new Set();
    for (const h of await chrome.history.search({ text: "", maxResults: 60, startTime: 0 })) {
      const host = hostOf(h.url);
      if (!/^https?:/.test(h.url) || seen.has(host) || tile.has(host)) continue; // one per site, skip what is already a tile
      seen.add(host);
      recent.push(h);
      if (recent.length === 5) break;
    }
  } catch {}
  let marks = [];
  try {
    const roots = (await chrome.bookmarks.getTree())[0].children || [];
    marks = (roots[0]?.children || []).filter((n) => n.url).slice(0, 5);
  } catch {}
  $("listHistory").replaceChildren(...recent.map(cardRow));
  $("listBookmarks").replaceChildren(...marks.map(cardRow));
  $("cardHistory").hidden = !recent.length;
  $("cardBookmarks").hidden = !marks.length;
  $("cards").hidden = !recent.length && !marks.length;
}

document.querySelectorAll(".more").forEach((b) => {
  b.onclick = async () => {
    const opened = chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
    const { ui } = await chrome.storage.local.get("ui");
    await chrome.storage.local.set({ ui: { ...(ui || {}), activeId: b.dataset.pane } });
    await opened;
  };
});

// ---- open tabs of this window, shaped like tab-strip tabs; "+" copies one into the speed dial ----
async function renderOpenTabs() {
  let tabs = [];
  try { tabs = (await chrome.tabs.query({ currentWindow: true })).filter((t) => /^https?:/.test(t.url || "")); } catch {}
  const inDial = (t) => tiles().some((x) => x.url === t.url || hostOf(x.url) === hostOf(t.url));
  $("openTabs").replaceChildren(...tabs.map((t) => {
    const el = document.createElement("div");
    el.className = "otab" + (t.active ? " current" : "");
    el.tabIndex = 0;
    el.title = `${t.title || t.url}
${t.url}`;
    const go = () => chrome.tabs.update(t.id, { active: true });
    el.onclick = go;
    el.onkeydown = (e) => e.key === "Enter" && go();
    const img = smallIcon(t.url, t.title, 16);
    const title = document.createElement("span");
    title.textContent = t.title || hostOf(t.url);
    el.append(img, title);
    if (!inDial(t)) {
      const tools = document.createElement("span");
      tools.className = "tools";
      tools.append(toolButton("plus", "스피드 다이얼에 추가", async () => {
        const list = tiles();
        list.push({ id: newId(), name: (t.title || hostOf(t.url)).split(/ [-|·–—] /)[0].slice(0, 24), url: t.url });
        await save(list);
        render();
        renderOpenTabs();
      }));
      el.append(tools);
    }
    return el;
  }));
  $("openTabsWrap").hidden = !tabs.length;
}

let openTabsTimer = null;
const refreshOpenTabs = () => { clearTimeout(openTabsTimer); openTabsTimer = setTimeout(renderOpenTabs, 150); };
for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated]) ev.addListener(refreshOpenTabs);

// "/" jumps to the search box, like most start pages
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("q") && !document.querySelector("dialog[open]")) { e.preventDefault(); $("q").focus(); }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.dialByWs || changes.dial || changes.workspaces || changes.wsActive)) {
    await load();
    render();
  }
});

async function showRail() {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  document.body.style["padding" + (settings.side === "right" ? "Right" : "Left")] = "48px";
  await mountRail(document.body, {
    side: settings.side,
    workspace: (id) => chrome.runtime.sendMessage({ type: "ws:switch", id }),
    open: async (id) => {
      const opened = chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
      const { ui } = await chrome.storage.local.get("ui");
      await chrome.storage.local.set({ ui: { collapsed: true, ...(ui || {}), activeId: id } });
      await opened;
    },
    settings: () => chrome.runtime.openOptionsPage(),
  });
}

(async () => {
  $("searchIcon").innerHTML = icon("search");
  tick();
  setInterval(tick, 15000);
  await load();
  render();
  renderCards();
  renderOpenTabs();
  $("q").focus();
  showRail();
})();
