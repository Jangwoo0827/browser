import { Store } from "./store.js";

const $ = (id) => document.getElementById(id);
let items = [];

function mini(label, title, fn, disabled) {
  const b = document.createElement("button");
  b.className = "fj-btn mini";
  b.textContent = label;
  b.title = title;
  b.disabled = !!disabled;
  b.onclick = fn;
  return b;
}

function row(item, index) {
  const li = document.createElement("li");
  li.className = "fj-row";
  const name = Object.assign(document.createElement("span"), { className: "name", textContent: item.name });
  const url = Object.assign(document.createElement("span"), { className: "url", textContent: item.url });
  li.append(
    name,
    url,
    mini("↑", "위로", () => move(index, -1), index === 0),
    mini("↓", "아래로", () => move(index, 1), index === items.length - 1),
    mini("삭제", "삭제", () => remove(index))
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
  const cur = { enabled: true, side: "left", ...(railSettings || {}) };
  $("railOn").checked = cur.enabled;
  $("railSide").value = cur.side;
  const save = () => chrome.storage.local.set({ railSettings: { enabled: $("railOn").checked, side: $("railSide").value } });
  $("railOn").onchange = save;
  $("railSide").onchange = save;
}

(async () => {
  items = (await Store.load()).items;
  render();
  railInit();
})();
