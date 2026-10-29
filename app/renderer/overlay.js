import { icon } from "fjord://shared/icons.js";

const $ = (id) => document.getElementById(id);
const cmd = (name, arg) => window.fjord.cmd(name, arg);
let kind = null;

function showOnly(k) {
  kind = k;
  for (const id of ["suggest", "find", "downloads", "prompt", "tabsearch", "bookmark"]) $(id).hidden = id !== k;
}

// ---- suggestions ----
function renderSuggest({ items, index }) {
  $("suggestList").replaceChildren(
    ...items.map((item, i) => {
      const li = document.createElement("li");
      li.className = "sug" + (i === index ? " sel" : "");
      const ico = document.createElement("span");
      ico.className = "ico";
      if (item.type === "search") ico.innerHTML = icon("search");
      else {
        const img = document.createElement("img");
        img.alt = "";
        try { img.src = new URL("/favicon.ico", item.url).href; } catch {}
        img.onerror = () => { ico.innerHTML = icon(item.type === "pin" || item.type === "bookmark" ? "star" : "history"); };
        ico.append(img);
      }
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = item.title;
      li.append(ico, t);
      if (item.type !== "search") {
        const u = document.createElement("span");
        u.className = "u";
        u.textContent = item.url.replace(/^https?:\/\/(www\.)?/, "");
        li.append(u);
      }
      // mousedown, not click: the address bar blurs (and hides this) before a click would land
      li.onmousedown = (e) => { e.preventDefault(); cmd("navigate", { input: item.url }); cmd("overlayHide"); };
      return li;
    })
  );
}

// ---- find ----
const find = (opts) => cmd("find", { text: $("findInput").value, ...opts });
$("findPrev").innerHTML = icon("arrowLeft");
$("findNext").innerHTML = icon("arrowRight");
$("findClose").innerHTML = icon("close");
$("findInput").oninput = () => find({});
$("findInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); find({ next: true, forward: !e.shiftKey }); } };
$("findPrev").onclick = () => find({ next: true, forward: false });
$("findNext").onclick = () => find({ next: true, forward: true });
$("findClose").onclick = () => cmd("overlayHide");

// ---- downloads ----
const fmt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : n + " B");
const STATE = { completed: "완료", cancelled: "취소됨", interrupted: "중단됨" };

function renderDownloads(list) {
  $("dlEmpty").hidden = list.length > 0;
  $("dlList").replaceChildren(
    ...list.map((d) => {
      const li = document.createElement("li");
      li.className = "dl";
      const pct = d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
      const info = d.state === "progressing" ? `${fmt(d.received)}${d.total ? " / " + fmt(d.total) : ""}` : `${STATE[d.state] || d.state} · ${fmt(d.received)}`;
      li.innerHTML = `<div class="name"></div><div class="info"></div>`;
      li.querySelector(".name").textContent = d.name;
      li.querySelector(".info").textContent = info;
      if (d.state === "progressing") li.insertAdjacentHTML("beforeend", `<div class="bar"><i style="width:${pct}%"></i></div>`);
      const actions = document.createElement("div");
      actions.className = "actions";
      const add = (label, name) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => cmd(name, d.id); actions.append(b); };
      if (d.state === "progressing") add("취소", "dlCancel");
      if (d.state === "completed") { add("열기", "dlOpen"); add("폴더에서 보기", "dlShow"); }
      li.append(actions);
      return li;
    })
  );
}
$("dlClear").onclick = () => cmd("dlClear");

// ---- bookmark edit ----
let bmCurrent = null;
$("bmRemove").onclick = async () => { await cmd("bookmarkRemove", bmCurrent.id); cmd("overlayHide"); };
$("bookmark").onsubmit = async (e) => {
  e.preventDefault();
  await cmd("bookmarkUpdate", { id: bmCurrent.id, title: $("bmName").value, folder: $("bmFolder").value });
  cmd("overlayHide");
};

// ---- tab search ----
let tsAll = [];
let tsShown = [];
let tsIndex = 0;

function tsRender() {
  $("tsEmpty").hidden = tsShown.length > 0;
  $("tsList").replaceChildren(
    ...tsShown.map((t, i) => {
      const li = document.createElement("li");
      li.className = "ts" + (i === tsIndex ? " sel" : "");
      const ico = document.createElement("span");
      ico.className = "ico";
      if (t.isNewTab) ico.innerHTML = icon("home");
      else {
        const img = document.createElement("img");
        img.alt = "";
        img.src = t.favicon || "";
        img.onerror = () => { ico.innerHTML = icon("globe"); };
        if (t.favicon) ico.append(img); else ico.innerHTML = icon("globe");
      }
      const title = document.createElement("span");
      title.className = "t";
      title.textContent = t.isNewTab ? "새 탭" : t.title || t.url;
      const ws = document.createElement("span");
      ws.className = "w";
      ws.textContent = t.wsName;
      li.append(ico, title, ws);
      li.onmousedown = (e) => { e.preventDefault(); cmd("activate", t.id); cmd("overlayHide"); };
      return li;
    })
  );
  const sel = $("tsList").children[tsIndex];
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function tsFilter() {
  const q = $("tsInput").value.trim().toLowerCase();
  tsShown = tsAll.filter((t) => !q || (t.title || "").toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.wsName.toLowerCase().includes(q));
  tsIndex = 0;
  tsRender();
}
$("tsInput").oninput = tsFilter;
$("tsInput").onkeydown = (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); tsIndex = Math.min(tsIndex + 1, tsShown.length - 1); tsRender(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); tsIndex = Math.max(tsIndex - 1, 0); tsRender(); }
  else if (e.key === "Enter" && tsShown[tsIndex]) { e.preventDefault(); cmd("activate", tsShown[tsIndex].id); cmd("overlayHide"); }
};

// ---- prompt ----
let promptData = null;
$("promptCancel").onclick = () => cmd("overlayHide");
$("prompt").onsubmit = async (e) => {
  e.preventDefault();
  const res = await cmd("promptSubmit", { mode: promptData.mode, id: promptData.id, value: $("promptInput").value });
  if (res && res.error) $("promptMsg").textContent = res.error;
};

window.fjord.on("show", ({ kind: k, payload }) => {
  showOnly(k);
  if (k === "suggest") renderSuggest(payload);
  else if (k === "find") { $("findCount").textContent = ""; $("findInput").focus(); $("findInput").select(); }
  else if (k === "downloads") renderDownloads(payload.downloads);
  else if (k === "bookmark") {
    bmCurrent = payload.bookmark;
    $("bmName").value = bmCurrent.title;
    const opts = [["bar", "북마크 바"], ["other", "기타 북마크"], ...payload.folders.map((f) => [f.id, f.name])];
    $("bmFolder").replaceChildren(...opts.map(([v, n]) => Object.assign(document.createElement("option"), { value: v, textContent: n })));
    $("bmFolder").value = bmCurrent.folder;
    $("bmName").focus();
    $("bmName").select();
  } else if (k === "tabsearch") {
    tsAll = payload.tabs;
    $("tsInput").value = "";
    tsFilter();
    $("tsInput").focus();
  } else if (k === "prompt") {
    promptData = payload;
    $("promptTitle").textContent = payload.title;
    $("promptInput").value = payload.value;
    $("promptMsg").textContent = "";
    $("promptInput").focus();
    $("promptInput").select();
  }
});
window.fjord.on("found", ({ active, total }) => { $("findCount").textContent = total ? `${active}/${total}` : $("findInput").value ? "없음" : ""; });
window.fjord.on("downloads", renderDownloads);
