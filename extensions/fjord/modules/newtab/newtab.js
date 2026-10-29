import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";
import { loadSettings, mountRail } from "../rail/rail.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_WORKSPACES = [{ id: "personal", name: "개인" }, { id: "work", name: "업무" }]; // same defaults as the workspaces module
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
  const data = await chrome.storage.local.get(["workspaces", "dialByWs", "dial"]);
  workspaces = Array.isArray(data.workspaces) && data.workspaces.length ? data.workspaces : DEFAULT_WORKSPACES;
  dials = data.dialByWs && typeof data.dialByWs === "object" ? data.dialByWs : {};
  legacy = Array.isArray(data.dial) ? data.dial : null;
  try {
    const win = await chrome.windows.getCurrent();
    const map = (await chrome.storage.session.get("active")).active || {};
    activeId = map[win.id];
  } catch {
    activeId = null;
  }
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

function favicon(item) {
  const img = document.createElement("img");
  img.className = "fav";
  img.alt = "";
  img.src = new URL("/favicon.ico", item.url).href;
  img.onerror = () => img.replaceWith(glyph(item.name, item.url));
  return img;
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
      b.textContent = w.name;
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
  $("clock").textContent = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.dialByWs || changes.dial || changes.workspaces)) {
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
  $("q").focus();
  showRail();
})();
