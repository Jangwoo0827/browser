const $ = (id) => document.getElementById(id);
const cmd = (name, arg) => window.fjord.cmd(name, arg);
let s = {};
let timer = null;

function say(text, err = false) {
  $("msg").textContent = text;
  $("msg").classList.toggle("err", err);
  clearTimeout(timer);
  if (text && !err) timer = setTimeout(() => say(""), 1800);
}

function fill() {
  for (const el of document.querySelectorAll("[data-key]")) {
    const v = s[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  }
  $("customRow").hidden = s.searchEngine !== "custom";
  $("dir").textContent = s.downloadDirEffective || "";
}

async function loadPerms() {
  const rows = await cmd("permList");
  $("permEmpty").hidden = rows.length > 0;
  $("permList").replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement("div");
      el.className = "perm-row";
      const o = Object.assign(document.createElement("span"), { className: "o", textContent: r.origin.replace(/^https?:\/\//, ""), title: r.origin });
      const k = Object.assign(document.createElement("span"), { className: "k", textContent: r.label });
      const sel = document.createElement("select");
      sel.className = "fj-field";
      for (const [v, t] of [["allow", "허용"], ["deny", "차단"]]) sel.append(Object.assign(document.createElement("option"), { value: v, textContent: t }));
      sel.value = r.value;
      sel.onchange = async () => { await cmd("permSet", { origin: r.origin, key: r.key, value: sel.value }); say("저장됨"); };
      const x = Object.assign(document.createElement("button"), { className: "x", textContent: "지우기" });
      x.onclick = async () => { await cmd("permSet", { origin: r.origin, key: r.key, value: null }); loadPerms(); };
      el.append(o, k, sel, x);
      return el;
    })
  );
}

async function load() {
  s = await cmd("settingsGet");
  fill();
  loadPerms();
}

async function save(el) {
  const value = el.type === "checkbox" ? el.checked : el.value;
  const r = await cmd("settingSet", { key: el.dataset.key, value });
  if (r && r.error) { say(r.error, true); await load(); return; }
  say("저장됨");
  await load();
}

for (const el of document.querySelectorAll("[data-key]")) el.addEventListener("change", () => save(el));
$("permClear").onclick = async () => { await cmd("permClearAll"); loadPerms(); };
$("pickDir").onclick = async () => { const r = await cmd("pickDownloadDir"); if (r && r.error) say(r.error, true); await load(); };
load();
