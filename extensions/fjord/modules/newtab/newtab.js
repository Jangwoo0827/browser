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

// ---- customize: background picture (preset, colour or an uploaded image), dimming, and what to show ----
const PRESETS = [
  { id: "auto", label: "기본", css: null },
  { id: "fjord", label: "피오르드", css: 'url("../../ui/bg-fjord.jpg")', thumb: 'url("../../ui/bg-fjord.jpg")' },
  { id: "aurora", label: "오로라", css: "linear-gradient(160deg, #0b1026 0%, #2a1b5e 55%, #0f766e 100%)" },
  { id: "ocean", label: "밤바다", css: "radial-gradient(120% 90% at 20% 100%, #0e7490 0%, #0c1a33 55%, #070b18 100%)" },
  { id: "forest", label: "숲", css: "linear-gradient(170deg, #07140f 0%, #0f3d2e 60%, #1f6f4a 100%)" },
  { id: "sunset", label: "노을", css: "linear-gradient(165deg, #1b1033 0%, #6b2d5c 50%, #e0754a 100%)" },
  { id: "graphite", label: "그래파이트", css: "linear-gradient(180deg, #16181d 0%, #20232a 100%)" },
];
const NTP_DEFAULTS = { bg: "auto", dim: 0, clock: true, cards: true, tabs: true };
let ntp = { ...NTP_DEFAULTS };
let ntpImage = null; // data URL of the uploaded picture

function applyNtp() {
  const b = document.body;
  const preset = PRESETS.find((p) => p.id === ntp.bg);
  let bg = null;
  if (ntp.bg === "custom" && ntpImage) bg = `url("${ntpImage}")`;
  else if (preset && preset.css) bg = preset.css;
  if (ntp.bg === "auto" || (!bg && ntp.bg !== "custom")) b.removeAttribute("data-bg");
  else b.dataset.bg = ntp.bg;
  if (bg) b.style.setProperty("--ntp-bg", bg);
  else b.style.removeProperty("--ntp-bg");
  b.style.setProperty("--ntp-dim", String((ntp.dim || 0) / 100));
  b.classList.toggle("on-image", !!bg);
  b.classList.toggle("hide-clock", !ntp.clock);
  b.classList.toggle("hide-cards", !ntp.cards);
  b.classList.toggle("hide-tabs", !ntp.tabs);
}

async function loadNtp() {
  const data = await chrome.storage.local.get(["ntpSettings", "ntpImage"]);
  ntp = { ...NTP_DEFAULTS, ...(data.ntpSettings || {}) };
  ntpImage = data.ntpImage || null;
  applyNtp();
}

const saveNtp = () => chrome.storage.local.set({ ntpSettings: ntp });

// shrink an uploaded picture so it fits comfortably in extension storage
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없어요.")); };
    img.src = url;
  });
}

function renderCustomize() {
  const panel = $("custPanel");
  const swatch = (p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (p.id === "auto" ? " plain" : "");
    b.title = p.label;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(ntp.bg === p.id));
    b.setAttribute("aria-label", p.label);
    if (p.css) b.style.backgroundImage = p.thumb || p.css;
    if (p.id === "auto") b.textContent = "기본";
    b.onclick = async () => { ntp.bg = p.id; await saveNtp(); applyNtp(); renderCustomize(); };
    return b;
  };

  const upload = document.createElement("button");
  upload.type = "button";
  upload.className = "swatch";
  upload.title = "내 이미지";
  upload.setAttribute("role", "radio");
  upload.setAttribute("aria-checked", String(ntp.bg === "custom"));
  upload.setAttribute("aria-label", "내 이미지");
  if (ntpImage) upload.style.backgroundImage = `url("${ntpImage}")`;
  else upload.innerHTML = icon("plus");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  file.onchange = async () => {
    if (!file.files[0]) return;
    try {
      ntpImage = await shrinkImage(file.files[0]);
      ntp.bg = "custom";
      await chrome.storage.local.set({ ntpImage, ntpSettings: ntp });
      applyNtp();
      renderCustomize();
    } catch (e) {
      $("custNote").textContent = e.message;
    }
  };
  upload.onclick = () => (ntpImage && ntp.bg !== "custom" ? (ntp.bg = "custom", saveNtp(), applyNtp(), renderCustomize()) : file.click());

  const toggle = (key, label) => {
    const l = document.createElement("label");
    l.className = "cust-row";
    l.innerHTML = `<span class="grow"></span><span class="fj-toggle"><input type="checkbox"><span class="fj-toggle__track"></span></span>`;
    l.querySelector(".grow").textContent = label;
    const input = l.querySelector("input");
    input.checked = !!ntp[key];
    input.onchange = async () => { ntp[key] = input.checked; await saveNtp(); applyNtp(); };
    return l;
  };

  const dim = document.createElement("input");
  dim.type = "range";
  dim.min = "0";
  dim.max = "70";
  dim.value = String(ntp.dim || 0);
  dim.setAttribute("aria-label", "배경 어둡게");
  dim.oninput = () => { ntp.dim = Number(dim.value); applyNtp(); };
  dim.onchange = () => saveNtp();

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  swatches.setAttribute("role", "radiogroup");
  swatches.append(...PRESETS.map(swatch), upload, file);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "fj-btn fj-btn--ghost";
  remove.textContent = "내 이미지 지우기";
  remove.hidden = !ntpImage;
  remove.onclick = async () => { ntpImage = null; if (ntp.bg === "custom") ntp.bg = "auto"; await chrome.storage.local.remove("ntpImage"); await saveNtp(); applyNtp(); renderCustomize(); };

  const note = document.createElement("p");
  note.id = "custNote";
  note.className = "cust-note";

  const title = document.createElement("h3");
  title.textContent = "새 탭 맞춤설정";
  const h4 = (t) => Object.assign(document.createElement("h4"), { textContent: t });
  panel.replaceChildren(title, h4("배경"), swatches, h4("배경 어둡게 (글자가 안 보일 때)"), dim, h4("보이기"),
    toggle("clock", "인사와 시계"), toggle("tabs", "열린 탭 줄"), toggle("cards", "최근 방문 · 북마크 카드"), remove, note);
}

function setupCustomize() {
  $("custBtn").innerHTML = `${icon("edit")}맞춤설정`;
  const close = () => { $("custPanel").hidden = true; $("custBtn").setAttribute("aria-expanded", "false"); };
  $("custBtn").onclick = (e) => {
    e.stopPropagation();
    const open = $("custPanel").hidden;
    if (open) renderCustomize();
    $("custPanel").hidden = !open;
    $("custBtn").setAttribute("aria-expanded", String(open));
  };
  document.addEventListener("click", (e) => { if (!$("custPanel").hidden && !$("custPanel").contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("custPanel").hidden) close(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.ntpSettings || changes.ntpImage)) loadNtp(); });
}

(async () => {
  $("searchIcon").innerHTML = icon("search");
  setupCustomize();
  await loadNtp();
  tick();
  setInterval(tick, 15000);
  await load();
  render();
  renderCards();
  renderOpenTabs();
  $("q").focus();
  showRail();
})();
