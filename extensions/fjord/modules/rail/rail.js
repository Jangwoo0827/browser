// The always-visible edge rail: workspaces, the side panel panes and pinned sites. Collapsed it is a 48px icon strip;
// hovering it for a moment slides it open over the page (labels + headings), like Arc/Zen's compact sidebar.
// Mounted into a shadow root by content.js on web pages and directly into the new tab page.
import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";
import { Store } from "../sidebar/store.js";
import { PANES, TOOLS, isClaudeSite } from "../sidebar/panes.js";

export const DEFAULTS = { enabled: true, side: "left", expand: true };
const FALLBACK_WORKSPACES = [{ id: "personal", name: "개인", icon: "home" }, { id: "work", name: "업무", icon: "briefcase" }];
const EXPAND_DELAY_MS = 260;

export async function loadSettings() {
  const { railSettings } = await chrome.storage.local.get("railSettings");
  return { ...DEFAULTS, ...(railSettings || {}) };
}

function glyph(name, url) {
  const el = document.createElement("span");
  el.className = "fj-glyph";
  el.style.background = glyphColor(name, url);
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

function button(title, content, label, onClick, { active = false } = {}) {
  const b = document.createElement("button");
  b.className = "rail-btn" + (active ? " active" : "");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  const g = document.createElement("span");
  g.className = "rail-glyph";
  if (typeof content === "string") g.innerHTML = content;
  else g.append(content);
  const text = document.createElement("span");
  text.className = "rail-label";
  text.textContent = label;
  b.append(g, text);
  b.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
  return b;
}

function section(heading, ...children) {
  const wrap = document.createElement("div");
  wrap.className = "rail-section";
  if (heading) {
    const hd = document.createElement("div");
    hd.className = "rail-heading";
    hd.textContent = heading;
    wrap.append(hd);
  }
  wrap.append(...children);
  return wrap;
}

// a link dragged from a page / the address bar / a bookmark: { url, name }
export function droppedLink(dt) {
  if (!dt) return null;
  const uri = (dt.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  const url = Store.normalizeUrl(uri || dt.getData("text/plain"));
  if (!url) return null;
  let name = "";
  try { name = new DOMParser().parseFromString(dt.getData("text/html") || "", "text/html").querySelector("a")?.textContent.trim() || ""; } catch {}
  if (!name) { const host = new URL(url).hostname.replace(/^www\./, ""); name = host.split(".")[0]; name = name.charAt(0).toUpperCase() + name.slice(1); }
  return { url, name: name.slice(0, 24) };
}
const hasLink = (dt) => !!dt && [...(dt.types || [])].some((t) => t === "text/uri-list" || t === "text/plain");

const divider = () => Object.assign(document.createElement("div"), { className: "rail-divider" });

// parent: element to append the rail to. callbacks: { open(id), workspace(id), settings() }. side: "left" | "right".
export async function mountRail(parent, { open, workspace, settings, side }) {
  const { items } = await Store.load();
  const { expand } = await loadSettings();
  const data = await chrome.storage.local.get(["workspaces", "wsActive"]);
  const workspaces = Array.isArray(data.workspaces) && data.workspaces.length ? data.workspaces : FALLBACK_WORKSPACES;
  const activeId = workspaces.some((w) => w.id === data.wsActive) ? data.wsActive : workspaces[0].id;

  const rail = document.createElement("aside");
  rail.className = "rail " + (side === "right" ? "right" : "left");
  rail.setAttribute("aria-label", "Fjord 사이드바");

  const spaces = workspaces.map((w) => button(`워크스페이스: ${w.name}`, icon(w.icon || "home"), w.name, () => workspace(w.id), { active: w.id === activeId }));
  const add = button("워크스페이스 추가/관리", icon("plus"), "워크스페이스 추가", () => open("@workspaces"));
  add.classList.add("quiet");

  const panes = PANES.map((p) => button(p.name, icon(p.icon), p.name, () => open(p.id)));
  const sites = items.filter((i) => !isClaudeSite(i)).map((item) => {
    const img = document.createElement("img");
    img.alt = "";
    try { img.src = new URL("/favicon.ico", item.url).href; } catch {}
    img.onerror = () => img.replaceWith(glyph(item.name, item.url));
    return button(`${item.name}\n${item.url}`, img, item.name, () => open(item.id));
  });
  const tools = [...TOOLS.filter((t) => t.id === "@adblock").map((t) => button(t.name, icon(t.icon), t.name, () => open(t.id))), button("설정", icon("sliders"), "설정", () => settings())];

  const spacer = Object.assign(document.createElement("div"), { className: "rail-spacer" });
  rail.append(
    section("워크스페이스", ...spaces, add),
    divider(),
    section("패널", ...panes),
    ...(sites.length ? [divider(), section("사이트", ...sites)] : []),
    spacer,
    divider(),
    section(null, ...tools)
  );

  // expand on hover (after a short delay so a passing cursor does not trigger it), collapse as soon as it leaves
  let timer = null;
  if (expand !== false) {
    rail.addEventListener("mouseenter", () => { clearTimeout(timer); timer = setTimeout(() => rail.classList.add("expanded"), EXPAND_DELAY_MS); });
    rail.addEventListener("mouseleave", () => { clearTimeout(timer); rail.classList.remove("expanded"); });
  }

  rail.addEventListener("dragover", (e) => { if (hasLink(e.dataTransfer)) { e.preventDefault(); rail.classList.add("drop"); } });
  rail.addEventListener("dragleave", (e) => { if (!rail.contains(e.relatedTarget)) rail.classList.remove("drop"); });
  rail.addEventListener("drop", async (e) => {
    rail.classList.remove("drop");
    const link = droppedLink(e.dataTransfer);
    if (!link) return;
    e.preventDefault();
    const { items: pinned } = await Store.load();
    const same = (u) => { try { return new URL(u).origin === new URL(link.url).origin; } catch { return false; } };
    if (!pinned.some((i) => same(i.url))) await Store.saveItems([...pinned, { id: Store.newId(), name: link.name, url: link.url }]); // the rail redraws on the storage change
  });

  parent.append(rail);
  return { element: rail, destroy: () => { clearTimeout(timer); rail.remove(); } };
}
