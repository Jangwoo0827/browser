const $ = (id) => document.getElementById(id);
let all = [];

const dayLabel = (t) => {
  const d = new Date(t);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
};

function render() {
  const q = $("filter").value.trim().toLowerCase();
  const list = all.filter((e) => !q || (e.title || "").toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  $("empty").hidden = list.length > 0;
  const nodes = [];
  let last = "";
  for (const e of list) {
    const label = dayLabel(e.at);
    if (label !== last) {
      const h = document.createElement("div");
      h.className = "day";
      h.textContent = label;
      nodes.push(h);
      last = label;
    }
    const a = document.createElement("a");
    a.className = "entry";
    a.href = e.url;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const img = document.createElement("img");
    img.alt = "";
    try { img.src = new URL("/favicon.ico", e.url).href; } catch {}
    img.onerror = () => { img.style.visibility = "hidden"; };
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = e.title || e.url;
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = e.url.replace(/^https?:\/\/(www\.)?/, "");
    a.append(time, img, t, u);
    nodes.push(a);
  }
  $("list").replaceChildren(...nodes);
}

$("filter").oninput = render;
$("clear").onclick = async () => {
  await window.fjord.cmd("historyClear");
  all = [];
  render();
};
window.fjord.cmd("history").then((h) => { all = h; render(); });
