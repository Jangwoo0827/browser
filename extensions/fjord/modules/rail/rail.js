// The always-visible edge rail: pinned sites + built-in tools. Mounted into a shadow root by content.js on web pages
// and directly into the new tab page. Clicking an item asks the caller to open it in the side panel.
import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";
import { Store } from "../sidebar/store.js";

export const DEFAULTS = { enabled: true, side: "left" };

export async function loadSettings() {
  const { railSettings } = await chrome.storage.local.get("railSettings");
  return { ...DEFAULTS, ...(railSettings || {}) };
}

const BUILTINS = [
  { id: "@workspaces", name: "워크스페이스", icon: "layers" },
  { id: "@adblock", name: "광고 차단", icon: "shield" },
];

function glyph(name, url) {
  const el = document.createElement("span");
  el.className = "fj-glyph";
  el.style.background = glyphColor(name, url);
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

function button(title, content, onClick) {
  const b = document.createElement("button");
  b.className = "rail-btn";
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  const g = document.createElement("span");
  g.className = "rail-glyph";
  if (typeof content === "string") g.innerHTML = content;
  else g.append(content);
  b.append(g);
  b.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
  return b;
}

// parent: element to append the rail to. callbacks: { open(id), settings() }. side: "left" | "right".
export async function mountRail(parent, { open, settings, side }) {
  const { items } = await Store.load();
  const rail = document.createElement("aside");
  rail.className = "rail " + (side === "right" ? "right" : "left");
  rail.setAttribute("aria-label", "Fjord 사이드바");

  const sites = document.createElement("div");
  sites.className = "rail-group";
  for (const item of items) {
    const img = document.createElement("img");
    img.alt = "";
    try {
      img.src = new URL("/favicon.ico", item.url).href;
    } catch {}
    img.onerror = () => img.replaceWith(glyph(item.name, item.url));
    sites.append(button(`${item.name}\n${item.url}`, img, () => open(item.id)));
  }
  const spacer = document.createElement("div");
  spacer.className = "rail-spacer";
  const divider = document.createElement("div");
  divider.className = "rail-divider";
  const tools = document.createElement("div");
  tools.className = "rail-group";
  for (const b of BUILTINS) tools.append(button(b.name, icon(b.icon), () => open(b.id)));
  tools.append(button("설정", icon("sliders"), () => settings()));

  rail.append(sites, spacer, divider, tools);
  parent.append(rail);
  return { element: rail, destroy: () => rail.remove() };
}
