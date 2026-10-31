// Content tools run from the service worker: reader mode, screenshots (visible / region / full page), saving the page as
// MHTML, translating through Google Translate, printing, and the reading list. Triggered by keyboard shortcuts, the page
// context menu, or quick find ("tools:run"). The page-side half is modules/tools/page.js.
const SHOT_GAP_MS = 560; // captureVisibleTab is limited to 2 calls per second
const MAX_FULL_PX = 14000; // taller pages are cut here (canvas limits)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString("sv-SE").replace(/:/g, "-").replace("T", " ").slice(0, 19); // 2026-10-31 18-30-12
const safeName = (s) => String(s || "page").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "page";

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

const ask = (tab, msg) => chrome.tabs.sendMessage(tab.id, msg).catch(() => null);
const say = (tab, text) => ask(tab, { type: "tools:toast", text });

async function targetTab(sender) {
  if (sender?.tab) return sender.tab;
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  if (!win) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab || null;
}

async function save(tab, dataUrl, filename, doneText) {
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  await say(tab, doneText);
}

// ---- screenshots -------------------------------------------------------------------------------------
const capture = (tab) => chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
const bitmapOf = async (dataUrl) => createImageBitmap(await (await fetch(dataUrl)).blob());

async function shotVisible(tab) {
  await save(tab, await capture(tab), `Fjord 스크린샷 ${stamp()}.png`, "스크린샷을 다운로드 폴더에 저장했어요");
}

async function shotRegion(tab) {
  const r = await ask(tab, { type: "tools:region" });
  if (!r || !r.rect) return;
  await sleep(160); // let the selection overlay disappear before the capture
  const bmp = await bitmapOf(await capture(tab));
  const k = bmp.width / (tab.width || bmp.width / r.dpr) || r.dpr; // capture pixels per CSS pixel
  const scale = Number.isFinite(k) && k > 0 ? k : r.dpr;
  const out = new OffscreenCanvas(Math.round(r.rect.w * scale), Math.round(r.rect.h * scale));
  out.getContext("2d").drawImage(bmp, Math.round(r.rect.x * scale), Math.round(r.rect.y * scale), out.width, out.height, 0, 0, out.width, out.height);
  await save(tab, await blobToDataUrl(await out.convertToBlob({ type: "image/png" })), `Fjord 영역 캡처 ${stamp()}.png`, "영역 캡처를 다운로드 폴더에 저장했어요");
}

async function shotFull(tab) {
  const m = await ask(tab, { type: "tools:metrics" });
  if (!m) return shotVisible(tab);
  const total = Math.min(m.height, MAX_FULL_PX);
  const strips = [];
  let y = 0;
  for (let i = 0; y < total; i++) {
    const { y: realY } = (await ask(tab, { type: "tools:scrollto", y })) || { y };
    if (i) await sleep(SHOT_GAP_MS);
    strips.push({ url: await capture(tab), y: realY });
    if (i === 0) await ask(tab, { type: "tools:hide-fixed" }); // keep the sticky header once, at the top
    if (realY + m.viewport >= total) break;
    y += m.viewport;
  }
  await ask(tab, { type: "tools:restore", y: m.y });
  const first = await bitmapOf(strips[0].url);
  const scale = first.width / m.width;
  const canvas = new OffscreenCanvas(first.width, Math.round(total * scale));
  const ctx = canvas.getContext("2d");
  for (const s of strips) ctx.drawImage(await bitmapOf(s.url), 0, Math.round(s.y * scale)); // overlapping strips simply overwrite each other
  await save(tab, await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" })), `Fjord 전체 캡처 ${stamp()}.png`, m.height > MAX_FULL_PX ? "페이지가 너무 길어 위쪽만 저장했어요" : "전체 페이지를 다운로드 폴더에 저장했어요");
}

// ---- other tools ----------------------------------------------------------------------------------------
async function saveMhtml(tab) {
  const blob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id });
  await save(tab, await blobToDataUrl(new Blob([blob], { type: "multipart/related" })), `${safeName(tab.title)}.mhtml`, "페이지를 .mhtml 파일로 저장했어요 (오프라인에서도 열려요)");
}

async function addToReadingList(tab) {
  try {
    await chrome.readingList.addEntry({ url: tab.url, title: tab.title || tab.url, hasBeenRead: false });
    return true;
  } catch {
    return false; // already in the list, or not a web page
  }
}

const ACTIONS = {
  reader: (tab) => ask(tab, { type: "tools:reader" }),
  "shot-visible": shotVisible,
  "shot-region": shotRegion,
  "shot-full": shotFull,
  "save-mhtml": saveMhtml,
  translate: (tab) => chrome.tabs.create({ url: `https://translate.google.com/translate?sl=auto&tl=ko&u=${encodeURIComponent(tab.url)}`, index: tab.index + 1 }),
  print: (tab) => ask(tab, { type: "tools:print" }),
  "reading-add": async (tab) => { await say(tab, (await addToReadingList(tab)) ? "읽기 목록에 추가했어요" : "이미 읽기 목록에 있거나 추가할 수 없는 페이지예요"); },
};

async function run(id, tab) {
  const fn = ACTIONS[id];
  if (!fn || !tab) return { ok: false };
  if (!/^https?:/.test(tab.url || "") && !["shot-visible"].includes(id)) return { ok: false, error: "web page only" };
  try {
    await fn(tab);
    return { ok: true };
  } catch (e) {
    await say(tab, "실패했어요: " + String(e && e.message ? e.message : e).slice(0, 80));
    return { ok: false, error: String(e) };
  }
}

// ---- entry points ----------------------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  const id = { "reader-mode": "reader", screenshot: "shot-region" }[command];
  if (!id) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await run(id, tab);
});

const MENUS = [
  ["fjord-tool-reader", "리더 모드로 읽기", "reader"],
  ["fjord-tool-translate", "이 페이지 번역 (Google 번역)", "translate"],
  ["fjord-tool-shot-region", "화면 영역 캡처", "shot-region"],
  ["fjord-tool-reading-add", "읽기 목록에 추가", "reading-add"],
];

async function setupMenus() {
  for (const [id, title] of MENUS) {
    await chrome.contextMenus.remove(id).catch(() => {});
    chrome.contextMenus.create({ id, title, contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] });
  }
}
chrome.runtime.onInstalled.addListener(() => setupMenus());
chrome.runtime.onStartup.addListener(() => setupMenus());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const entry = MENUS.find(([id]) => id === info.menuItemId);
  if (entry && tab) run(entry[2], tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type !== "string" || !msg.type.startsWith("tools:")) return;
  if (!["tools:run", "tools:reading-add"].includes(msg.type)) return; // the rest are answered by the page script
  (async () => {
    const tab = await targetTab(sender);
    if (msg.type === "tools:reading-add") return { ok: tab ? await addToReadingList(tab) : false };
    return run(msg.id, tab);
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
