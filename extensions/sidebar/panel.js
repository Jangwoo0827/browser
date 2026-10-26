const $ = (id) => document.getElementById(id);
let state = { items: [], ui: { collapsed: true, activeId: null } };

function avatar(name) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const el = document.createElement("span");
  el.className = "avatar";
  el.style.background = `hsl(${hue} 55% 45%)`;
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

// Site's own /favicon.ico (no third-party lookup); falls back to a coloured letter.
function icon(item) {
  const wrap = document.createElement("span");
  wrap.className = "ico";
  const img = document.createElement("img");
  img.className = "fav";
  img.alt = "";
  img.src = new URL("/favicon.ico", item.url).href;
  img.onerror = () => img.replaceWith(avatar(item.name));
  wrap.append(img);
  return wrap;
}

function render() {
  document.body.classList.toggle("collapsed", state.ui.collapsed);
  $("toggle").querySelector(".ico").innerHTML = state.ui.collapsed ? "&#9776;" : "&#171;";

  const box = $("items");
  box.replaceChildren();
  for (const item of state.items) {
    const b = document.createElement("button");
    b.className = "rail-btn" + (item.id === state.ui.activeId ? " active" : "");
    b.title = `${item.name}\n${item.url}`;
    b.append(icon(item));
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = item.name;
    b.append(label);
    b.onclick = () => open(item.id);
    box.append(b);
  }
  showActive();
}

function showActive() {
  const item = state.items.find((i) => i.id === state.ui.activeId);
  const frame = $("frame");
  if (!item) {
    frame.hidden = true;
    frame.removeAttribute("src");
    $("empty").hidden = false;
    $("title").textContent = "사이트를 선택하세요";
    return;
  }
  $("empty").hidden = true;
  frame.hidden = false;
  $("title").textContent = item.name;
  if (frame.dataset.url !== item.url) {
    frame.dataset.url = item.url;
    frame.src = item.url;
  }
}

async function open(id) {
  state.ui.activeId = id;
  await Store.saveUi(state.ui);
  render();
}

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

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const next = await Store.load();
  // keep the loaded page when only the item list changed and the active one is still there
  if (!next.items.some((i) => i.id === next.ui.activeId)) next.ui.activeId = null;
  state = next;
  render();
});

(async () => {
  state = await Store.load();
  if (!state.items.some((i) => i.id === state.ui.activeId)) state.ui.activeId = null;
  render();
})();
