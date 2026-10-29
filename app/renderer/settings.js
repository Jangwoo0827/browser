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

async function load() {
  s = await cmd("settingsGet");
  fill();
}

async function save(el) {
  const value = el.type === "checkbox" ? el.checked : el.value;
  const r = await cmd("settingSet", { key: el.dataset.key, value });
  if (r && r.error) { say(r.error, true); await load(); return; }
  say("저장됨");
  await load();
}

for (const el of document.querySelectorAll("[data-key]")) el.addEventListener("change", () => save(el));
$("pickDir").onclick = async () => { const r = await cmd("pickDownloadDir"); if (r && r.error) say(r.error, true); await load(); };
load();
