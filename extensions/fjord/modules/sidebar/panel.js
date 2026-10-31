import { Store } from "./store.js";
import { icon } from "../../ui/icons.js";
import { PANES, TOOLS, DEFAULT_PANE, paneById, toolById, isClaudeSite } from "./panes.js";
import { favicon, h } from "./kit.js";

const $ = (id) => document.getElementById(id);
let state = { items: [], ui: { activeId: null } };
let current = null; // { id, destroy } of the mounted native pane

const NATIVE = {
  "@claude": () => import("./panes/claude.js"),
  "@bookmarks": () => import("./panes/bookmarks.js"),
  "@history": () => import("./panes/history.js"),
  "@notes": () => import("./panes/notes.js"),
  "@readinglist": () => import("./panes/readinglist.js"),
  "@tabs": () => import("./panes/tabs.js"),
};

const sites = () => state.items.filter((i) => !isClaudeSite(i));
const activeId = () => state.ui.activeId || DEFAULT_PANE;
const validId = (id) => !id || paneById(id) || toolById(id) || state.items.some((i) => i.id === id);

function tab(id, title, glyph, label) {
  const active = id === activeId();
  const b = h("button", { class: "ptab" + (active ? " active" : ""), type: "button", role: "tab", "aria-selected": String(active), title, onclick: () => select(id) },
    h("span", { class: "ptab-ico" }, glyph), h("span", { class: "ptab-label" }, label));
  return b;
}

const iconGlyph = (name) => h("span", { class: "g", html: icon(name) });

function renderTabs() {
  $("tabs").replaceChildren(
    ...PANES.map((p) => tab(p.id, p.name, iconGlyph(p.icon), p.name)),
    sites().length && h("span", { class: "sep" }),
    ...sites().map((i) => tab(i.id, `${i.name}\n${i.url}`, favicon(i.url, i.name), i.name)),
    h("span", { class: "sep" }),
    ...TOOLS.map((t) => tab(t.id, t.name, iconGlyph(t.icon), t.name))
  );
  $("tabs").querySelector(".ptab.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  $("settings").innerHTML = icon("sliders");
  $("reload").innerHTML = icon("reload");
  $("external").innerHTML = icon("external");
}

async function show() {
  const id = activeId();
  const frame = $("frame");
  const pane = $("pane");
  const bar = $("bar");
  const native = NATIVE[id];

  if (current && current.id !== id) { current.destroy?.(); current = null; pane.replaceChildren(); }

  if (native) {
    frame.hidden = true;
    frame.removeAttribute("src");
    delete frame.dataset.url;
    bar.hidden = true;
    pane.hidden = false;
    if (!current) {
      const mod = await native();
      if (activeId() !== id) return; // switched again while loading
      pane.className = "pane pane-" + id.slice(1);
      current = { id, ...(await mod.mount(pane)) };
    }
    return;
  }

  // embedded page: one of our own tool pages or a pinned site
  pane.hidden = true;
  const tool = toolById(id);
  const item = state.items.find((i) => i.id === id);
  const target = tool ? { name: tool.name, url: new URL(tool.page, location.href).href, external: false } : item && { ...item, external: true };
  if (!target) return;
  bar.hidden = false;
  frame.hidden = false;
  $("external").hidden = !target.external;
  $("title").textContent = target.name;
  if (frame.dataset.url !== target.url) {
    frame.dataset.url = target.url;
    frame.src = target.url;
  }
}

async function select(id) {
  state.ui.activeId = id;
  await Store.saveUi(state.ui);
  renderTabs();
  show();
}

$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("reload").onclick = () => {
  const f = $("frame");
  if (f.dataset.url) f.src = f.dataset.url;
};
$("external").onclick = () => {
  const item = state.items.find((i) => i.id === state.ui.activeId);
  if (item) chrome.tabs.create({ url: item.url });
};

// arrow keys move between the panel tabs
$("tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const all = [...$("tabs").querySelectorAll(".ptab")];
  const i = all.indexOf(document.activeElement);
  if (i < 0) return;
  all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length].focus();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !(changes.items || changes.ui)) return;
  const next = await Store.load();
  if (!validId(next.ui.activeId)) next.ui.activeId = null;
  const changedPane = next.ui.activeId !== state.ui.activeId;
  state = next;
  renderTabs();
  if (changedPane || changes.items) show(); // the rail asked for another pane, or the site list changed
});

(async () => {
  state = await Store.load();
  if (!validId(state.ui.activeId)) state.ui.activeId = null;
  renderTabs();
  show();
})();
