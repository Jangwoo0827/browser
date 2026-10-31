import { Store } from "./store.js";
import { icon } from "../../ui/icons.js";
import { glyphColor } from "../../ui/glyph.js";
import { resolveFavicon } from "../../ui/favicon.js";

const $ = (id) => document.getElementById(id);
let items = [];

function iconBtn(name, title, fn, { disabled = false, cls = "" } = {}) {
  const b = document.createElement("button");
  b.className = "ibtn " + cls;
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.disabled = disabled;
  b.innerHTML = icon(name);
  b.onclick = fn;
  return b;
}

function glyph(item) {
  const el = document.createElement("span");
  el.className = "fj-glyph";
  el.style.background = glyphColor(item.name, item.url);
  el.textContent = (item.name.trim()[0] || "?").toUpperCase();
  return el;
}

function row(item, index) {
  const li = document.createElement("li");
  const img = glyph(item);
  resolveFavicon(item.url, 64).then((r) => {
    if (!r) return;
    const real = document.createElement("img");
    real.alt = "";
    real.src = r.src;
    img.replaceWith(real);
  });
  const who = document.createElement("span");
  who.className = "who";
  who.append(Object.assign(document.createElement("span"), { className: "name", textContent: item.name }), Object.assign(document.createElement("span"), { className: "url", textContent: item.url }));
  li.append(
    img,
    who,
    iconBtn("chevronDown", "위로", () => move(index, -1), { disabled: index === 0, cls: "up" }),
    iconBtn("chevronDown", "아래로", () => move(index, 1), { disabled: index === items.length - 1 }),
    iconBtn("trash", "삭제", () => remove(index), { cls: "danger" })
  );
  return li;
}

function render() {
  if (!items.length) {
    $("list").replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: "항목이 없어요" }));
    return;
  }
  $("list").replaceChildren(...items.map(row));
}

async function commit() {
  await Store.saveItems(items);
  render();
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  commit();
}

function remove(i) {
  items.splice(i, 1);
  commit();
}

$("add").onsubmit = (e) => {
  e.preventDefault();
  const url = Store.normalizeUrl($("url").value);
  const name = $("name").value.trim();
  if (!url) {
    $("msg").textContent = "올바른 주소가 아니에요 (http/https).";
    return;
  }
  $("msg").textContent = "";
  items.push({ id: Store.newId(), name, url });
  $("name").value = "";
  $("url").value = "";
  commit();
};

$("reset").onclick = () => {
  items = Store.DEFAULT_ITEMS.map((i) => ({ ...i }));
  commit();
};

// edge rail settings (read by modules/rail)
async function railInit() {
  const { railSettings } = await chrome.storage.local.get("railSettings");
  const cur = { enabled: true, side: "left", expand: true, ...(railSettings || {}) };
  $("railOn").checked = cur.enabled;
  $("railExpand").checked = cur.expand !== false;
  const paintSide = () => document.querySelectorAll("#railSide button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.side === cur.side)));
  paintSide();
  const save = () => chrome.storage.local.set({ railSettings: { enabled: $("railOn").checked, side: cur.side, expand: $("railExpand").checked } });
  $("railOn").onchange = save;
  $("railExpand").onchange = save;
  document.querySelectorAll("#railSide button").forEach((b) => (b.onclick = () => { cur.side = b.dataset.side; paintSide(); save(); }));
}

$("shortcuts").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });

(async () => {
  items = (await Store.load()).items;
  render();
  railInit();
})();
