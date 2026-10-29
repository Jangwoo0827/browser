import { icon } from "fjord://shared/icons.js";

const $ = (id) => document.getElementById(id);
const cmd = (name, arg) => window.fjord.cmd(name, arg);
let data = { bookmarks: [], folders: [] };

async function load() {
  data = await cmd("bookmarkList");
  render();
}

function row(b) {
  const el = document.createElement("div");
  el.className = "row";
  const img = document.createElement("img");
  img.alt = "";
  try { img.src = new URL("/favicon.ico", b.url).href; } catch {}
  img.onerror = () => { img.style.visibility = "hidden"; };
  const a = document.createElement("a");
  a.href = b.url;
  a.innerHTML = '<div class="t"></div><div class="u"></div>';
  a.querySelector(".t").textContent = b.title;
  a.querySelector(".u").textContent = b.url;
  const sel = document.createElement("select");
  sel.className = "fj-field";
  const opts = [["bar", "북마크 바"], ["other", "기타 북마크"], ...data.folders.map((f) => [f.id, f.name])];
  for (const [v, n] of opts) sel.append(Object.assign(document.createElement("option"), { value: v, textContent: n }));
  sel.value = b.folder;
  sel.onchange = async () => { await cmd("bookmarkUpdate", { id: b.id, folder: sel.value }); load(); };
  const del = document.createElement("button");
  del.className = "del";
  del.title = "삭제";
  del.innerHTML = icon("trash");
  del.onclick = async () => { await cmd("bookmarkRemove", b.id); load(); };
  el.append(img, a, sel, del);
  return el;
}

function group(title, items, folder) {
  const g = document.createElement("section");
  g.className = "group";
  const h = document.createElement("h2");
  h.append(document.createTextNode(title));
  if (folder) {
    const del = document.createElement("button");
    del.textContent = "폴더 삭제";
    del.title = "북마크는 기타 북마크로 옮겨져요";
    del.onclick = async () => { await cmd("folderRemove", folder.id); load(); };
    h.append(del);
  }
  g.append(h);
  if (items.length) g.append(...items.map(row));
  else g.append(Object.assign(document.createElement("div"), { className: "empty", textContent: "비어 있어요." }));
  return g;
}

function render() {
  const q = $("filter").value.trim().toLowerCase();
  const match = (b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q);
  const sections = [group("북마크 바", data.bookmarks.filter((b) => b.folder === "bar" && match(b)))];
  for (const f of data.folders.filter((x) => x.parent === "bar")) sections.push(group("북마크 바 › " + f.name, data.bookmarks.filter((b) => b.folder === f.id && match(b)), f));
  sections.push(group("기타 북마크", data.bookmarks.filter((b) => b.folder === "other" && match(b))));
  for (const f of data.folders.filter((x) => x.parent === "other")) sections.push(group("기타 북마크 › " + f.name, data.bookmarks.filter((b) => b.folder === f.id && match(b)), f));
  $("list").replaceChildren(...sections);
}

$("filter").oninput = render;
$("folderForm").onsubmit = async (e) => {
  e.preventDefault();
  const r = await cmd("folderAdd", { name: $("folderName").value, parent: "bar" });
  $("msg").textContent = (r && r.error) || "";
  if (!r || !r.error) $("folderName").value = "";
  load();
};
$("export").onclick = async () => { const r = await cmd("bookmarksExport"); $("msg").textContent = "내보냈어요: " + r.path; };
$("import").onclick = async () => { const r = await cmd("bookmarksImport"); $("msg").textContent = r.added ? `${r.added}개를 가져왔어요.` : "가져온 북마크가 없어요."; load(); };
load();
