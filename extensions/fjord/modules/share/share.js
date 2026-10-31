// Share window: the page's address as text + QR code, with copy, system share sheet and "save the QR as PNG".
import { qrSvg } from "../../ui/qr.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const url = params.get("url") || "";
const title = params.get("title") || url;
let svg = "";

$("title").textContent = title;
$("url").value = url;
try { $("host").textContent = new URL(url).hostname.replace(/^www\./, ""); } catch {}

try {
  svg = qrSvg(url, { px: 6, margin: 0 });
  $("qr").innerHTML = svg;
} catch {
  $("qr").hidden = true;
  $("save").disabled = true;
  $("qrNote").textContent = "주소가 너무 길어서 QR 코드를 만들 수 없어요. 링크 복사를 이용하세요.";
  $("qrNote").hidden = false;
}

const say = (text) => { $("msg").textContent = text; setTimeout(() => { if ($("msg").textContent === text) $("msg").textContent = ""; }, 2500); };

$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText(url); say("링크를 복사했어요"); }
  catch { $("url").select(); document.execCommand("copy"); say("링크를 복사했어요"); }
};

if (typeof navigator.share === "function") {
  $("share").onclick = () => navigator.share({ title, url }).catch(() => {}); // cancelling the sheet is not an error
} else {
  $("share").hidden = true; // no system share sheet here
}

$("save").onclick = () => {
  if (!svg) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const side = 1024; // a sharp print-size image
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, side, side);
    const pad = 64;
    ctx.drawImage(img, pad, pad, side - pad * 2, side - pad * 2);
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `QR ${(new URL(url).hostname || "page").replace(/^www\./, "")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say("QR 코드를 저장했어요");
    }, "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
};
