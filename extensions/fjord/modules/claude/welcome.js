import { CLAUDE_ID } from "./ids.js";

const $ = (id) => document.getElementById(id);

async function installed() {
  try {
    return (await chrome.management.get(CLAUDE_ID)).enabled;
  } catch {
    return false;
  }
}

async function refresh() {
  const ok = await installed();
  $("status").textContent = ok ? "✓ Claude 확장이 설치되어 있어요." : "Claude 확장이 아직 설치되지 않았어요.";
  $("status").className = ok ? "ok" : "";
  $("install").hidden = ok;
  $("later").textContent = ok ? "닫기" : "나중에";
  $("never").hidden = ok;
}

$("later").onclick = () => window.close();
$("never").onclick = async () => {
  await chrome.storage.local.set({ claudeSetup: { dismissed: true } });
  window.close();
};

refresh();
setInterval(refresh, 2000); // picks up the install as soon as the Web Store finishes
