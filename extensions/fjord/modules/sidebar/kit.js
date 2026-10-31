// Small DOM kit for the side panel panes (no framework): element helper, favicons, search box, empty state, snackbar.
import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
};

export function letter(name, url) {
  const el = h("span", { class: "fj-glyph fav" }, (String(name || hostOf(url)).trim()[0] || "?").toUpperCase());
  el.style.background = glyphColor(String(name || hostOf(url)), url);
  return el;
}

// Chrome's own favicon cache (works for history / bookmarks / tabs, needs the "favicon" permission); letter avatar as fallback
export function favicon(url, name) {
  if (!/^https?:/i.test(url || "")) return letter(name || "•", url);
  const img = h("img", { class: "fav", alt: "", width: 16, height: 16 });
  img.src = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=32`;
  img.onerror = () => img.replaceWith(letter(name, url));
  return img;
}

export const iconBtn = (name, title, onClick, cls = "") =>
  h("button", { class: "ibtn " + cls, type: "button", title, "aria-label": title, html: icon(name), onclick: (e) => { e.stopPropagation(); onClick(e); } });

export function searchBox(placeholder, onInput) {
  const input = h("input", { class: "search-input", type: "search", placeholder, spellcheck: "false", autocomplete: "off", "aria-label": placeholder });
  const clear = iconBtn("close", "지우기", () => { input.value = ""; input.focus(); update(); }, "clear");
  const update = () => { wrap.classList.toggle("has-value", !!input.value); onInput(input.value.trim()); };
  const wrap = h("label", { class: "search" }, h("span", { class: "search-ico", html: icon("search") }), input, clear);
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { input.value = ""; update(); e.stopPropagation(); } });
  return { el: wrap, input, get value() { return input.value.trim(); } };
}

export const empty = (title, hint) => h("div", { class: "empty" }, h("p", { class: "empty-title" }, title), hint && h("p", { class: "empty-hint" }, hint));

export const debounce = (fn, ms = 120) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// snackbar with one action (undo)
let toastTimer = null;
export function toast(text, actionLabel, onAction) {
  document.getElementById("toast")?.remove();
  clearTimeout(toastTimer);
  const el = h("div", { id: "toast", class: "toast", role: "status" }, h("span", {}, text),
    actionLabel && h("button", { class: "toast-act", type: "button", onclick: () => { el.remove(); onAction?.(); } }, actionLabel));
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 5000);
}

// the tab the user is looking at (the panel is not a tab itself)
export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// open url in the current tab, or in a new one with ctrl / middle click
export async function openUrl(url, { newTab = false } = {}) {
  if (newTab) return chrome.tabs.create({ url, active: true });
  const tab = await activeTab();
  if (tab) return chrome.tabs.update(tab.id, { url });
  return chrome.tabs.create({ url });
}

export const wantsNewTab = (e) => e.ctrlKey || e.metaKey || e.button === 1;
