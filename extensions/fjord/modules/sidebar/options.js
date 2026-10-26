import { Store } from "./store.js";

const $ = (id) => document.getElementById(id);
let items = [];

function row(item, index) {
  const li = document.createElement("li");
  const name = Object.assign(document.createElement("span"), { className: "name", textContent: item.name });
  const url = Object.assign(document.createElement("span"), { className: "url", textContent: item.url });

  const up = Object.assign(document.createElement("button"), { textContent: "↑", title: "위로" });
  up.disabled = index === 0;
  up.onclick = () => move(index, -1);
  const down = Object.assign(document.createElement("button"), { textContent: "↓", title: "아래로" });
  down.disabled = index === items.length - 1;
  down.onclick = () => move(index, 1);
  const del = Object.assign(document.createElement("button"), { textContent: "삭제" });
  del.onclick = () => remove(index);

  li.append(name, url, up, down, del);
  return li;
}

function render() {
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

(async () => {
  items = (await Store.load()).items;
  render();
})();
