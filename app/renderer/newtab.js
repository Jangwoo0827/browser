import { glyphColor } from "fjord://shared/glyph.js";

const $ = (id) => document.getElementById(id);

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
tick();
setInterval(tick, 15000);

$("search").onsubmit = (e) => {
  e.preventDefault();
  const input = $("q").value.trim();
  if (input) window.fjord.cmd("navigate", { input });
};

function tile(p) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = p.url;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = p.name;
  const img = document.createElement("img");
  img.className = "fav";
  img.alt = "";
  try { img.src = new URL("/favicon.ico", p.url).href; } catch {}
  img.onerror = () => {
    const g = document.createElement("span");
    g.className = "fj-glyph fj-glyph--lg";
    g.style.background = glyphColor(p.name, p.url);
    g.textContent = (p.name.trim()[0] || "?").toUpperCase();
    img.replaceWith(g);
  };
  a.append(img, name);
  return a;
}

window.fjord.cmd("dial").then((pins) => $("grid").replaceChildren(...pins.map(tile)));
$("q").focus();
