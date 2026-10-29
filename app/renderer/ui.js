import { icon } from "fjord://shared/icons.js";
import { glyphColor } from "fjord://shared/glyph.js";

const $ = (id) => document.getElementById(id);
const cmd = (name, arg) => window.fjord.cmd(name, arg);
let state = null;
let dragId = null;

function railButton(title, content, onClick, { active = false, disabled = false, onContext } = {}) {
  const b = document.createElement("button");
  b.className = "rail-btn" + (active ? " active" : "");
  b.title = title;
  b.disabled = disabled;
  b.setAttribute("aria-label", title);
  const g = document.createElement("span");
  g.className = "rail-glyph";
  if (typeof content === "string") g.innerHTML = content;
  else g.append(content);
  b.append(g);
  b.onclick = onClick;
  if (onContext) b.oncontextmenu = (e) => { e.preventDefault(); onContext(); };
  return b;
}

function letterGlyph(name, url) {
  const el = document.createElement("span");
  el.className = "fj-glyph";
  el.style.background = glyphColor(name, url);
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

function siteGlyph(p) {
  const img = document.createElement("img");
  img.alt = "";
  try { img.src = new URL("/favicon.ico", p.url).href; } catch {}
  img.onerror = () => img.replaceWith(letterGlyph(p.name, p.url));
  return img;
}

function renderRail() {
  $("spaces").replaceChildren(
    ...state.workspaces.map((w) =>
      railButton(`${w.name} (${w.count})`, icon(w.icon), () => cmd("wsSwitch", w.id), { active: w.id === state.activeWs, onContext: () => cmd("wsMenu", w.id) })
    ),
    railButton("워크스페이스 추가", icon("plus"), () => openDialog("add"))
  );
  $("pins").replaceChildren(...state.pinned.map((p) => railButton(`${p.name}\n${p.url}`, siteGlyph(p), () => cmd("openPinned", p.id))));
  $("tools").replaceChildren(
    railButton("광고 차단 (준비 중)", icon("shield"), () => {}, { disabled: true }),
    railButton("설정 (Ctrl+,)", icon("sliders"), () => cmd("openPage", "settings"))
  );
}

function tabTitle(t) {
  if (t.isNewTab) return "새 탭";
  if (t.title) return t.title;
  try { return new URL(t.url).host; } catch { return t.url; }
}

function audioButton(t) {
  if (!t.audible && !t.muted) return null;
  const b = document.createElement("button");
  b.className = "tab-audio";
  b.title = t.muted ? "음소거 해제" : "음소거";
  b.setAttribute("aria-label", b.title);
  b.innerHTML = icon(t.muted ? "volumeOff" : "volume");
  b.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); cmd("muteTab", t.id); };
  return b;
}

function tabIcon(t) {
  const box = document.createElement("span");
  box.className = "tab-ico";
  if (t.loading) box.innerHTML = '<span class="spin"></span>';
  else if (t.isNewTab) box.innerHTML = icon("home");
  else if (t.favicon) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = t.favicon;
    img.onerror = () => { box.innerHTML = icon("globe"); };
    box.append(img);
  } else box.innerHTML = icon("globe");
  return box;
}

function renderTabs() {
  $("tabList").replaceChildren(
    ...state.tabs.map((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (t.id === state.activeTab ? " active" : "") + (t.pinned ? " pinned" : "");
      el.setAttribute("role", "tab");
      el.draggable = true;
      el.title = tabTitle(t);
      const x = document.createElement("button");
      x.className = "tab-x";
      x.setAttribute("aria-label", "탭 닫기");
      x.innerHTML = icon("close");
      // close on mousedown, like activation: the tab's own mousedown re-renders the strip, which would replace this
      // button before the mouseup and swallow a click
      x.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); if (e.button === 0) cmd("closeTab", t.id); };
      x.onclick = (e) => e.stopPropagation();
      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tabTitle(t);
      const audio = audioButton(t);
      el.append(tabIcon(t), ...(t.pinned ? [] : [title]), ...(audio ? [audio] : []), ...(t.pinned ? [] : [x]));
      el.onmousedown = (e) => { if (e.button === 0 && !e.target.closest(".tab-x")) cmd("activate", t.id); };
      el.onauxclick = (e) => { if (e.button === 1) cmd("closeTab", t.id); };
      el.oncontextmenu = (e) => { e.preventDefault(); cmd("tabMenu", t.id); };
      el.ondragstart = (e) => { dragId = t.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
      el.ondragend = () => { dragId = null; el.classList.remove("dragging"); document.querySelectorAll(".tab.over").forEach((n) => n.classList.remove("over")); };
      el.ondragover = (e) => { if (dragId && dragId !== t.id) { e.preventDefault(); el.classList.add("over"); } };
      el.ondragleave = () => el.classList.remove("over");
      el.ondrop = (e) => { e.preventDefault(); if (dragId && dragId !== t.id) cmd("reorder", { id: dragId, beforeId: t.id }); };
      return el;
    })
  );
}

function renderToolbar() {
  const cur = state.tabs.find((t) => t.id === state.activeTab);
  const zoom = cur && cur.zoom && cur.zoom !== 100 ? cur.zoom : null;
  $("zoomBadge").hidden = !zoom;
  if (zoom) $("zoomBadge").textContent = zoom + "%";
  $("dlDot").hidden = !(state.downloads && state.downloads.active > 0);
  const tab = state.tabs.find((t) => t.id === state.activeTab);
  $("back").disabled = !tab || !tab.canGoBack;
  $("forward").disabled = !tab || !tab.canGoForward;
  $("reload").innerHTML = icon(tab && tab.loading ? "close" : "reload");
  $("reload").title = tab && tab.loading ? "중지" : "새로고침 (Ctrl+R)";
  const input = $("addrInput");
  if (document.activeElement !== input) input.value = !tab || tab.isNewTab ? "" : tab.shownUrl || tab.url;
}

function renderBar() {
  const bar = state.bookmarkBar || { visible: false, folders: [], items: [] };
  document.body.classList.toggle("has-bar", bar.visible);
  $("starBtn").classList.toggle("on", !!state.activeBookmark);
  $("starBtn").title = state.activeBookmark ? "북마크 편집 (Ctrl+D)" : "이 페이지를 북마크 (Ctrl+D)";
  if (!bar.visible) return;
  const chips = [];
  for (const f of bar.folders) {
    const b = document.createElement("button");
    b.className = "bm folder";
    b.title = f.name;
    b.innerHTML = icon("folder") + "<span></span>" + icon("chevronDown");
    b.querySelector("span").textContent = f.name;
    b.onclick = () => cmd("folderMenu", f.id);
    chips.push(b);
  }
  for (const item of bar.items) {
    const b = document.createElement("button");
    b.className = "bm link";
    b.title = item.title + "\n" + item.url;
    const img = document.createElement("img");
    img.alt = "";
    try { img.src = new URL("/favicon.ico", item.url).href; } catch {}
    img.onerror = () => img.replaceWith(Object.assign(document.createElement("span"), { innerHTML: "" }));
    const t = document.createElement("span");
    t.textContent = item.title;
    b.append(img, t);
    b.onclick = (e) => cmd(e.ctrlKey || e.shiftKey ? "newTab" : "navigate", e.ctrlKey || e.shiftKey ? item.url : { id: state.activeTab, input: item.url });
    b.onauxclick = (e) => { if (e.button === 1) cmd("newTab", item.url); };
    b.oncontextmenu = (e) => { e.preventDefault(); cmd("bookmarkMenu", item.id); };
    chips.push(b);
  }
  $("bmBar").replaceChildren(...chips);
}

function render(s) {
  state = s;
  renderBar();
  $("homeBtn").hidden = !(state.settings && state.settings.showHome);
  renderRail();
  renderTabs();
  renderToolbar();
}

// ---- address bar / buttons ----
$("newTab").innerHTML = icon("plus");
$("back").innerHTML = icon("arrowLeft");
$("forward").innerHTML = icon("arrowRight");
$("newTab").onclick = () => cmd("newTab");
$("tabSearch").innerHTML = icon("search");
$("tabSearch").onclick = () => cmd("tabSearchShow");
$("back").onclick = () => cmd("back");
$("forward").onclick = () => cmd("forward");
$("reload").onclick = () => {
  const tab = state && state.tabs.find((t) => t.id === state.activeTab);
  cmd(tab && tab.loading ? "stop" : "reload");
};
$("addr").onsubmit = (e) => {
  e.preventDefault();
  const input = $("addrInput");
  const picked = sugg.open && sugg.index >= 0 ? sugg.items[sugg.index] : null;
  const text = picked ? picked.url : input.value;
  hideSuggestions();
  if (text.trim()) cmd("navigate", { id: state.activeTab, input: text });
  input.blur();
};
$("homeBtn").innerHTML = icon("home");
$("homeBtn").onclick = () => cmd("home");
$("starBtn").innerHTML = icon("star");
$("starBtn").onclick = () => cmd("bookmarkEditShow");
$("findBtn").innerHTML = icon("search");
$("histBtn").innerHTML = icon("history");
$("dlBtn").insertAdjacentHTML("afterbegin", icon("download"));
$("findBtn").onclick = () => cmd("findShow");
$("histBtn").onclick = () => cmd("openPage", "history");
$("dlBtn").onclick = () => cmd("downloadsPanel");
$("zoomBadge").onclick = () => cmd("zoomReset");

// ---- address suggestions (drawn by the overlay view above the page) ----
const sugg = { items: [], index: -1, open: false, seq: 0 };
const ROW_H = 44;

function suggRect() {
  const r = $("addrInput").getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4, width: r.width, height: sugg.items.length * ROW_H + 12 };
}

async function refreshSuggestions() {
  const q = $("addrInput").value.trim();
  const mine = ++sugg.seq;
  const items = await cmd("suggest", q);
  if (mine !== sugg.seq) return; // a newer keystroke already asked
  sugg.items = items.slice();
  if (q) sugg.items.push({ type: "search", title: `"${q}" 검색`, url: q });
  sugg.index = -1;
  if (!sugg.items.length) return hideSuggestions();
  sugg.open = true;
  cmd("overlayShow", { kind: "suggest", rect: suggRect(), payload: { items: sugg.items, index: sugg.index } });
}

function hideSuggestions() {
  sugg.seq++;
  if (sugg.open) cmd("overlayHide");
  sugg.open = false;
}

function moveSuggestion(d) {
  if (!sugg.open || !sugg.items.length) return;
  const n = sugg.items.length;
  sugg.index = (sugg.index + d + n) % n;
  const item = sugg.items[sugg.index];
  if (item.type !== "search") $("addrInput").value = item.url;
  cmd("overlayUpdate", { items: sugg.items, index: sugg.index });
}

$("addrInput").onfocus = () => { $("addrInput").select(); refreshSuggestions(); };
$("addrInput").oninput = () => refreshSuggestions();
$("addrInput").onkeydown = (e) => {
  if (e.key === "Escape") { hideSuggestions(); $("addrInput").blur(); renderToolbar(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
};
$("addrInput").onblur = () => { setTimeout(hideSuggestions, 200); renderToolbar(); };

// ---- workspace add (rename comes from the context menu) ----
// Both use a prompt drawn by the overlay view above the page (a <dialog> here would be hidden behind the page).
function openDialog(mode) {
  cmd("promptShow", { mode });
}

window.fjord.on("state", render);
window.fjord.on("focus-address", () => $("addrInput").focus());
cmd("state").then(render);
