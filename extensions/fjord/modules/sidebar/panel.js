import { Store } from "./store.js";
import { icon } from "../../ui/icons.js";

const $ = (id) => document.getElementById(id);
let state = { items: [], ui: { collapsed: true, activeId: null } };

// Built-in modules of this extension, shown as extension pages inside the panel.
const BUILTINS = [
  { id: "@workspaces", name: "워크스페이스", icon: "layers", page: "../workspaces/popup.html" },
  { id: "@adblock", name: "광고 차단", icon: "shield", page: "../adblock/popup.html" },
];
const builtin = (id) => BUILTINS.find((b) => b.id === id);

// Letter avatar (also the favicon fallback): colour derived from the name.
function glyph(name) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const el = document.createElement("span");
  el.className = "fj-glyph";
  el.style.background = `hsl(${hue} 52% 42%)`;
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

// Site's own /favicon.ico (no third-party lookup); falls back to the letter avatar.
function siteGlyph(item) {
  const wrap = document.createElement("span");
  wrap.className = "rail-glyph";
  const img = document.createElement("img");
  img.alt = "";
  img.src = new URL("/favicon.ico", item.url).href;
  img.onerror = () => img.replaceWith(glyph(item.name));
  wrap.append(img);
  return wrap;
}

function iconGlyph(name) {
  const wrap = document.createElement("span");
  wrap.className = "rail-glyph";
  wrap.innerHTML = icon(name);
  return wrap;
}

function railButton(id, title, glyphEl, label) {
  const b = document.createElement("button");
  b.className = "rail-btn" + (id === state.ui.activeId ? " active" : "");
  b.title = title;
  b.append(glyphEl);
  const text = document.createElement("span");
  text.className = "rail-label";
  text.textContent = label;
  b.append(text);
  b.onclick = () => open(id);
  return b;
}

function render() {
  document.body.classList.toggle("collapsed", state.ui.collapsed);
  $("toggleIcon").innerHTML = icon(state.ui.collapsed ? "menu" : "collapse");
  $("settingsIcon").innerHTML = icon("sliders");
  $("reload").innerHTML = icon("reload");
  $("external").innerHTML = icon("external");

  $("items").replaceChildren(
    ...state.items.map((item) => railButton(item.id, `${item.name}\n${item.url}`, siteGlyph(item), item.name))
  );
  $("builtins").replaceChildren(...BUILTINS.map((b) => railButton(b.id, b.name, iconGlyph(b.icon), b.name)));
  showActive();
}

function showActive() {
  const frame = $("frame");
  const b = builtin(state.ui.activeId);
  const item = state.items.find((i) => i.id === state.ui.activeId);
  const target = b ? { name: b.name, url: new URL(b.page, location.href).href, external: false } : item && { ...item, external: true };

  if (!target) {
    frame.hidden = true;
    frame.removeAttribute("src");
    delete frame.dataset.url;
    $("empty").hidden = false;
    $("title").textContent = "사이트를 선택하세요";
    $("external").hidden = true;
    return;
  }
  $("empty").hidden = true;
  frame.hidden = false;
  $("external").hidden = !target.external;
  $("title").textContent = target.name;
  if (frame.dataset.url !== target.url) {
    frame.dataset.url = target.url;
    frame.src = target.url;
  }
}

async function open(id) {
  state.ui.activeId = id;
  await Store.saveUi(state.ui);
  render();
}

const validActive = (s) => !s.ui.activeId || builtin(s.ui.activeId) || s.items.some((i) => i.id === s.ui.activeId);

$("toggle").onclick = async () => {
  state.ui.collapsed = !state.ui.collapsed;
  await Store.saveUi(state.ui);
  render();
};
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("reload").onclick = () => {
  const f = $("frame");
  if (f.dataset.url) f.src = f.dataset.url;
};
$("external").onclick = () => {
  const item = state.items.find((i) => i.id === state.ui.activeId);
  if (item) chrome.tabs.create({ url: item.url });
};

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  const next = await Store.load();
  if (!validActive(next)) next.ui.activeId = null;
  state = next;
  render();
});

(async () => {
  state = await Store.load();
  if (!validActive(state)) state.ui.activeId = null;
  render();
})();
