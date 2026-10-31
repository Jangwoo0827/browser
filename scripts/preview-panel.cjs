// Renders the extension's side panel panes and the page rail in a hidden Electron window with a mocked `chrome` API and
// saves screenshots to logs/ (no browser window appears). Usage (from the app/ folder, which has Electron):
//   npx electron ../scripts/preview-panel.cjs
const { app, BrowserWindow, nativeTheme, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "extensions", "fjord");
const LOGS = path.join(__dirname, "..", "logs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };

// ---- static server: the extension folder + a favicon service + stand-ins for claude.ai and a normal web page
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/_favicon/") {
    const page = u.searchParams.get("pageUrl") || "";
    let host = "";
    try { host = new URL(page).hostname.replace(/^www\./, ""); } catch {}
    const hue = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    res.writeHead(200, { "content-type": "image/svg+xml" });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="hsl(${hue} 55% 45%)"/><text x="16" y="22" font-size="17" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${(host[0] || "?").toUpperCase()}</text></svg>`);
  }
  if (u.pathname === "/mock-claude") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<body style="margin:0;background:#262624;color:#e8e6dc;font:15px system-ui;display:flex;flex-direction:column;height:100vh"><div style="flex:1;display:grid;place-items:center;text-align:center"><div><div style="font-size:30px;color:#d97757">✻</div><p>안녕하세요, 무엇을 도와드릴까요?</p></div></div><div style="margin:12px;padding:14px;border:1px solid #4a4a46;border-radius:14px;color:#9a9890">Claude에게 질문하기</div></body>`);
  }
  if (u.pathname === "/mock-page") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<body style="margin:0;font:16px system-ui;background:#fff;color:#222"><div style="max-width:720px;margin:60px auto;padding:0 24px"><h1>예시 페이지</h1><p>레일이 페이지 가장자리에 붙어 있어요. 가장자리에 마우스를 올리면 펼쳐져요.</p><p>${"본문 텍스트 ".repeat(120)}</p></div></body>`);
  }
  const file = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

// ---- mocked chrome API (runs before the page scripts)
const PRELOAD = path.join(LOGS, "preview-preload.js");
fs.mkdirSync(LOGS, { recursive: true });
fs.writeFileSync(PRELOAD, `
const ORIGIN = location.origin;
const ev = () => ({ addListener() {}, removeListener() {} });
const now = Date.now();
const DAY = 86400e3;
const hash = new URLSearchParams(location.hash.slice(1));
const store = {
  items: [{ id: "claude", name: "Claude", url: "https://claude.ai/" }, { id: "google", name: "Google", url: "https://www.google.com/" }, { id: "github", name: "GitHub", url: "https://github.com/" }, { id: "naver", name: "네이버", url: "https://www.naver.com/" }],
  ui: { activeId: hash.get("pane") || "@claude" },
  workspaces: [{ id: "personal", name: "개인", icon: "home" }, { id: "work", name: "업무", icon: "briefcase" }, { id: "game", name: "게임", icon: "gamepad" }],
  wsActive: "personal",
};
const sess = { wsWindows: { personal: 1, work: 2 } };
const area = (data) => ({ get: async (keys) => { if (keys == null) return { ...data }; const ks = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys); const o = {}; for (const k of ks) if (k in data) o[k] = data[k]; return o; }, set: async (o) => { Object.assign(data, o); } });
const bm = (id, title, url) => ({ id, title, url, parentId: "1" });
const folder = (id, title, children, parentId = "1") => ({ id, title, parentId, children: children.map((c) => ({ ...c, parentId: id })) });
const tree = [{ id: "0", title: "", children: [
  { id: "1", title: "북마크 바", parentId: "0", children: [
    bm("10", "Claude", "https://claude.ai/"), bm("11", "GitHub — Jangwoo0827/browser", "https://github.com/Jangwoo0827/browser"), bm("12", "네이버", "https://www.naver.com/"),
    folder("20", "개발", [bm("21", "MDN Web Docs", "https://developer.mozilla.org/ko/"), bm("22", "Electron 문서", "https://www.electronjs.org/docs"), bm("23", "Chrome 확장 프로그램 문서", "https://developer.chrome.com/docs/extensions")]),
    folder("30", "읽을거리", [bm("31", "Hacker News", "https://news.ycombinator.com/")]),
  ] },
  { id: "2", title: "기타 북마크", parentId: "0", children: [bm("40", "YouTube", "https://www.youtube.com/"), bm("41", "위키백과", "https://ko.wikipedia.org/")] },
] }];
const flat = (n, out = []) => { if (n.url) out.push(n); (n.children || []).forEach((c) => flat(c, out)); return out; };
const hist = [
  ["Claude", "https://claude.ai/new", 8], ["GitHub — Jangwoo0827/browser", "https://github.com/Jangwoo0827/browser", 35], ["Electron 문서", "https://www.electronjs.org/docs/latest", 90],
  ["네이버", "https://www.naver.com/", 240], ["MDN Web Docs", "https://developer.mozilla.org/ko/", 60 * 26], ["Chrome 확장 프로그램 문서", "https://developer.chrome.com/docs/extensions", 60 * 27],
  ["YouTube", "https://www.youtube.com/", 60 * 30], ["위키백과", "https://ko.wikipedia.org/", 60 * 24 * 3 + 20], ["Hacker News", "https://news.ycombinator.com/", 60 * 24 * 3 + 50],
].map(([title, url, mins], i) => ({ id: String(i), title, url, lastVisitTime: now - mins * 60e3, visitCount: 3 }));
const T = (id, windowId, title, url, extra = {}) => ({ id, windowId, title, url, active: false, ...extra });
const wins = [
  { id: 1, tabs: [T(1, 1, "Fjord — 새 탭", ORIGIN + "/modules/newtab/newtab.html"), T(2, 1, "GitHub — Jangwoo0827/browser", "https://github.com/Jangwoo0827/browser", { active: true }), T(3, 1, "Electron 문서", "https://www.electronjs.org/docs"), T(4, 1, "YouTube — 로파이 라디오", "https://www.youtube.com/watch?v=x", { audible: true }), T(5, 1, "네이버", "https://www.naver.com/")] },
  { id: 2, tabs: [T(6, 2, "Claude", "https://claude.ai/new", { active: true }), T(7, 2, "MDN Web Docs", "https://developer.mozilla.org/ko/"), T(8, 2, "Hacker News", "https://news.ycombinator.com/")] },
];
const tabsAll = wins.flatMap((w) => w.tabs);
window.chrome = {
  runtime: { id: "preview", getURL: (p) => ORIGIN + (p.startsWith("/") ? p : "/" + p), openOptionsPage() {}, sendMessage: async (m) => m && m.type === "ws:state" ? { activeId: "personal", workspaces: store.workspaces.map((w, i) => ({ ...w, count: [5, 3, 0][i] })) } : {}, onMessage: ev() },
  storage: { local: area(store), session: area(sess), onChanged: ev() },
  tabs: { query: async () => tabsAll.filter((t) => t.windowId === 1 && !t.url.includes('newtab')), update: async () => ({}), create: async () => ({}), remove: async () => {}, onCreated: ev(), onRemoved: ev(), onUpdated: ev(), onActivated: ev(), onMoved: ev(), onAttached: ev(), onDetached: ev() },
  windows: { create: async () => ({}), getCurrent: async () => ({ id: 1 }), getAll: async () => wins, getLastFocused: async () => ({ id: 1 }), update: async () => ({}), onRemoved: ev(), onFocusChanged: ev() },
  bookmarks: { getTree: async () => tree, search: async (q) => { const needle = typeof q === "string" ? q.toLowerCase() : ""; return flat(tree[0]).filter((n) => typeof q === "string" ? (n.title + n.url).toLowerCase().includes(needle) : n.url === q.url); }, create: async () => ({}), remove: async () => {}, onCreated: ev(), onRemoved: ev(), onChanged: ev(), onMoved: ev() },
  history: { search: async ({ text }) => hist.filter((h) => !text || (h.title + h.url).toLowerCase().includes(text.toLowerCase())), deleteUrl: async () => {}, onVisited: ev(), onVisitRemoved: ev() },
  search: { query() {} },
  webNavigation: { onCommitted: ev(), onHistoryStateUpdated: ev() },
  sidePanel: { open: async () => {} },
  scripting: { executeScript: async () => [{ result: { selection: "", text: "예시 페이지 본문" } }] },
};
`);

async function shot(win, name) {
  for (let i = 0; i < 8; i++) {
    try {
      const img = await win.webContents.capturePage();
      if (!img.isEmpty()) { fs.writeFileSync(path.join(LOGS, name), img.toPNG()); return; }
    } catch {}
    await sleep(400);
  }
  throw new Error("capture failed: " + name);
}

app.on("window-all-closed", () => {}); // windows are closed one after another

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://claude.ai/*"] }, (d, cb) => cb({ redirectURL: base + "/mock-claude" }));
  const mk = (w, h) => new BrowserWindow({ show: false, width: w, height: h, backgroundColor: "#00000000", webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false, backgroundThrottling: false, webSecurity: false, nodeIntegrationInSubFrames: true } });
  const only = process.argv.slice(2);
  try {
    for (const theme of ["dark", "light"]) {
      nativeTheme.themeSource = theme;
      for (const pane of ["@claude", "@bookmarks", "@history", "@tabs", "@workspaces"]) {
        const win = mk(380, 700);
        await win.loadURL(`${base}/modules/sidebar/panel.html#pane=${encodeURIComponent(pane)}`).catch(async (e) => { console.log('retry', pane, e.code); await sleep(500); await win.loadURL(`${base}/modules/sidebar/panel.html#pane=${encodeURIComponent(pane)}`); });
        await sleep(900);
        if (pane === "@bookmarks") await win.webContents.executeJavaScript(`document.querySelectorAll('.row.folder')[1]?.click()`).catch(() => {}), await sleep(200);
        await shot(win, `panel-${pane.slice(1)}-${theme}.png`);
        if (pane === "@history" && theme === "dark") { await win.webContents.executeJavaScript(`const i=document.querySelector('.search-input'); i.value='문서'; i.dispatchEvent(new Event('input'))`); await sleep(400); await shot(win, "panel-history-search-dark.png"); }
        win.close();
        await sleep(250);
      }
      { // the workspaces tool page on its own (inside the panel it sits in an iframe, which the mock does not reach)
        const ww = mk(380, 520);
        await ww.loadURL(`${base}/modules/workspaces/popup.html`);
        await sleep(700);
        await shot(ww, `workspaces-page-${theme}.png`);
        ww.close();
        await sleep(250);
      }
      { // the new tab page
        const nw = mk(1280, 780);
        await nw.loadURL(`${base}/modules/newtab/newtab.html`);
        await sleep(1200);
        await shot(nw, `newtab-${theme}.png`);
        nw.close();
        await sleep(250);
      }
      { // the extension's options page
        const ow = mk(900, 1000);
        await ow.loadURL(`${base}/modules/sidebar/options.html`);
        await sleep(900);
        await shot(ow, `options-${theme}.png`);
        ow.close();
        await sleep(250);
      }
      // rail on a normal page: collapsed, then expanded
      const rw = mk(900, 560);
      await rw.loadURL(`${base}/mock-page`);
      await rw.webContents.executeJavaScript(`(async () => { const host = document.createElement('div'); host.style.cssText='all:initial'; const root = host.attachShadow({mode:'open'}); for (const h of ['ui/tokens.css','ui/base.css','modules/rail/rail.css']) { const l=document.createElement('link'); l.rel='stylesheet'; l.href=chrome.runtime.getURL(h); root.append(l);} document.body.append(host); const m = await import(chrome.runtime.getURL('modules/rail/rail.js')); window.__rail = await m.mountRail(root, { side: 'left', open(){}, workspace(){}, settings(){} }); })()`);
      await sleep(900);
      await shot(rw, `rail-collapsed-${theme}.png`);
      await rw.webContents.executeJavaScript(`const st=document.createElement('style'); st.textContent='*{transition:none!important}'; window.__rail.element.getRootNode().append(st); window.__rail.element.classList.add('expanded')`);
      await sleep(500);
      await shot(rw, `rail-expanded-${theme}.png`);
      rw.close();
    }
    console.log("previews saved to", LOGS);
  } catch (e) {
    console.error("preview failed:", e);
    process.exitCode = 1;
  }
  server.close();
  app.quit();
});
