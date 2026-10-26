const $ = (id) => document.getElementById(id);

const DEFAULT_DIAL = [
  { id: "claude", name: "Claude", url: "https://claude.ai/" },
  { id: "google", name: "Google", url: "https://www.google.com/" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
  { id: "naver", name: "네이버", url: "https://www.naver.com/" },
  { id: "wikipedia", name: "Wikipedia", url: "https://www.wikipedia.org/" },
];

let dial = [];
let editingId = null;
let dragId = null;

async function load() {
  const { dial: stored } = await chrome.storage.local.get("dial");
  dial = Array.isArray(stored) ? stored : DEFAULT_DIAL.map((d) => ({ ...d }));
}
const save = () => chrome.storage.local.set({ dial });
const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function normalizeUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function avatar(name) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const el = document.createElement("span");
  el.className = "avatar";
  el.style.background = `hsl(${hue} 55% 45%)`;
  el.textContent = (name.trim()[0] || "?").toUpperCase();
  return el;
}

function favicon(item) {
  const img = document.createElement("img");
  img.className = "fav";
  img.alt = "";
  img.src = new URL("/favicon.ico", item.url).href;
  img.onerror = () => img.replaceWith(avatar(item.name));
  return img;
}

function toolButton(text, title, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.title = title;
  b.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return b;
}

function tile(item) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = item.url;
  a.draggable = true;
  a.setAttribute("role", "listitem");
  a.dataset.id = item.id;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;

  const tools = document.createElement("span");
  tools.className = "tools";
  tools.append(
    toolButton("✎", "편집", () => openDialog(item.id)),
    toolButton("✕", "삭제", async () => {
      dial = dial.filter((d) => d.id !== item.id);
      await save();
      render();
    })
  );

  a.append(favicon(item), name, tools);

  a.ondragstart = (e) => {
    dragId = item.id;
    a.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  };
  a.ondragend = () => {
    dragId = null;
    a.classList.remove("dragging");
    document.querySelectorAll(".over").forEach((n) => n.classList.remove("over"));
  };
  a.ondragover = (e) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    a.classList.add("over");
  };
  a.ondragleave = () => a.classList.remove("over");
  a.ondrop = async (e) => {
    e.preventDefault();
    if (!dragId || dragId === item.id) return;
    const from = dial.findIndex((d) => d.id === dragId);
    const to = dial.findIndex((d) => d.id === item.id);
    const [moved] = dial.splice(from, 1);
    dial.splice(to, 0, moved);
    await save();
    render();
  };
  return a;
}

function addTile() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile add";
  b.innerHTML = '<span class="plus">+</span><span>사이트 추가</span>';
  b.onclick = () => openDialog(null);
  return b;
}

function render() {
  $("grid").replaceChildren(...dial.map(tile), addTile());
}

function openDialog(id) {
  editingId = id;
  const item = dial.find((d) => d.id === id);
  $("dlgTitle").textContent = item ? "사이트 편집" : "사이트 추가";
  $("dName").value = item ? item.name : "";
  $("dUrl").value = item ? item.url : "";
  $("dMsg").textContent = "";
  $("dlg").showModal();
  $("dName").focus();
}

$("dCancel").onclick = () => $("dlg").close();
$("dlgForm").onsubmit = async (e) => {
  e.preventDefault();
  const url = normalizeUrl($("dUrl").value);
  const name = $("dName").value.trim();
  if (!url) {
    $("dMsg").textContent = "올바른 주소가 아니에요 (http/https).";
    return;
  }
  const item = dial.find((d) => d.id === editingId);
  if (item) Object.assign(item, { name, url });
  else dial.push({ id: newId(), name, url });
  await save();
  $("dlg").close();
  render();
};

// Address-like input navigates directly; anything else goes to the default search engine.
$("search").onsubmit = (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (!text) return;
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || (/^[^\s]+\.[a-z]{2,}([/:?#].*)?$/i.test(text) && !/\s/.test(text));
  if (looksLikeUrl) {
    const url = normalizeUrl(text);
    if (url) {
      location.href = url;
      return;
    }
  }
  chrome.search.query({ text, disposition: "CURRENT_TAB" });
};

function tick() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
tick();
setInterval(tick, 15000);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes.dial) {
    await load();
    render();
  }
});

(async () => {
  await load();
  render();
  $("q").focus();
})();
