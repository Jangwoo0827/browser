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
  if (u.pathname === "/mock-article") {
    const para = (n) => `<p>${n}번째 문단입니다. 리더 모드는 광고와 메뉴를 걷어내고 글만 깔끔하게 보여 줘야 해요. 이 문장은 충분히 길어서 본문으로 판단되어야 합니다. 한국어 글은 한 문단에도 글자가 많이 들어갑니다.</p>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<title>피오르드에서 보낸 하루 - 예시 블로그</title><meta property="og:site_name" content="예시 블로그"><meta name="author" content="홍길동"><body><nav><a href="/">홈</a> <a href="/about">소개</a> 메뉴메뉴메뉴</nav><main><article><h1>피오르드에서 보낸 하루</h1>${[1, 2, 3, 4, 5, 6].map(para).join("")}<blockquote>인용문도 남아야 해요.</blockquote><img src="/img.png" alt="사진"></article><aside class="ads">광고광고광고 지금 구매</aside></main><footer>푸터 저작권 푸터</footer></body>`);
  }
  if (u.pathname === "/mock-video") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<body style="margin:0;background:#111"><video id="v" width="560" height="315" style="display:block;margin:60px auto;background:#000" controls></video></body>`);
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
const listeners = [];
window.__calls = [];
const rec = (name) => async (...a) => { window.__calls.push([name, ...a]); return {}; };
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
const readingEntries = [
  { url: "https://example.com/a", title: "나중에 읽을 글 A", hasBeenRead: false, creationTime: now - 3 * 3600e3, lastUpdateTime: now },
  { url: "https://example.org/b", title: "이미 읽은 글 B", hasBeenRead: true, creationTime: now - 30 * 3600e3, lastUpdateTime: now },
  { url: "https://news.ycombinator.com/c", title: "해커뉴스 글 C", hasBeenRead: false, creationTime: now - 5 * 3600e3, lastUpdateTime: now },
];
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
  runtime: {
    id: "preview", getURL: (p) => ORIGIN + (p.startsWith("/") ? p : "/" + p), openOptionsPage() {},
    onMessage: { addListener: (f) => listeners.push(f), removeListener() {} },
    sendMessage: (m) => new Promise((resolve) => {
      if (m && m.type === "ws:state") return resolve({ activeId: "personal", workspaces: store.workspaces.map((w, i) => ({ ...w, count: [5, 3, 0][i] })) });
      window.__calls.push(["message", m]);
      let async = false;
      for (const l of listeners) if (l(m, {}, resolve) === true) async = true;
      if (!async) resolve({});
    }),
  },
  storage: { local: area(store), session: area(sess), onChanged: ev() },
  tabs: { query: async () => tabsAll.filter((t) => t.windowId === 1 && !t.url.includes('newtab')), update: rec("tabs.update"), create: rec("tabs.create"), remove: async () => {}, onCreated: ev(), onRemoved: ev(), onUpdated: ev(), onActivated: ev(), onMoved: ev(), onAttached: ev(), onDetached: ev() },
  windows: { create: rec("windows.create"), getCurrent: async () => ({ id: 1 }), getAll: async () => wins, getLastFocused: async () => ({ id: 1 }), update: rec("windows.update"), onRemoved: ev(), onFocusChanged: ev() },
  bookmarks: { getTree: async () => tree, search: async (q) => { const needle = typeof q === "string" ? q.toLowerCase() : ""; return flat(tree[0]).filter((n) => typeof q === "string" ? (n.title + n.url).toLowerCase().includes(needle) : n.url === q.url); }, create: async () => ({}), remove: async () => {}, onCreated: ev(), onRemoved: ev(), onChanged: ev(), onMoved: ev() },
  history: { search: async ({ text }) => hist.filter((h) => !text || (h.title + h.url).toLowerCase().includes(text.toLowerCase())), deleteUrl: async () => {}, onVisited: ev(), onVisitRemoved: ev() },
  readingList: {
    query: async () => readingEntries.map((e) => ({ ...e })),
    addEntry: async (e) => { window.__calls.push(["readingList.add", e]); readingEntries.push({ ...e, creationTime: Date.now(), lastUpdateTime: Date.now() }); },
    removeEntry: async ({ url }) => { window.__calls.push(["readingList.remove", url]); const i = readingEntries.findIndex((e) => e.url === url); if (i >= 0) readingEntries.splice(i, 1); },
    updateEntry: async (u) => { window.__calls.push(["readingList.update", u]); const e = readingEntries.find((x) => x.url === u.url); if (e) Object.assign(e, u); },
    onEntryAdded: ev(), onEntryRemoved: ev(), onEntryUpdated: ev(),
  },
  search: { query: rec("search.query") },
  commands: { onCommand: ev() },
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
        await nw.webContents.executeJavaScript(`document.getElementById('custBtn').click()`);
        await sleep(300);
        await shot(nw, `newtab-customize-${theme}.png`);
        await nw.webContents.executeJavaScript(`document.querySelector('.swatch[aria-label="노을"]').click()`);
        await sleep(400);
        await shot(nw, `newtab-sunset-${theme}.png`);
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
      { // quick find: the real UI talking to the real background module (mocked chrome underneath)
        const qw = mk(680, 500);
        await qw.loadURL(`${base}/modules/quick/quick.html#keep`);
        await qw.webContents.executeJavaScript(`window.close = () => { window.__closed = true; }; import(chrome.runtime.getURL('modules/quick/background.js')).then(() => 0)`);
        await sleep(700);
        const text = () => qw.webContents.executeJavaScript(`[...document.querySelectorAll('.qk-item')].map((li) => li.querySelector('.qk-tag').textContent + ':' + li.querySelector('.qk-title').textContent)`);
        const type = async (v) => { await qw.webContents.executeJavaScript(`(() => { const i = document.querySelector('.qk-input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); })()`); await sleep(500); };
        const key = (k, extra = "") => qw.webContents.executeJavaScript(`document.querySelector('.qk-input').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true${extra} }))`);
        const calls = () => qw.webContents.executeJavaScript(`window.__calls.filter((c) => c[0] !== 'message' || c[1].type !== 'quick:query')`);
        const check = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  quick: ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);

        await type('');
        let items = await text();
        check('empty box lists open tabs, workspaces and commands', items.some((t) => t.startsWith('탭:')) && items.some((t) => t.startsWith('워크스페이스:')) && items.some((t) => t.startsWith('명령:')), items);
        await shot(qw, `quick-empty-${theme}.png`);

        await type('youtube');
        items = await text();
        check('search puts the open tab first, then the bookmark, and the web search last', items[0].startsWith('탭:YouTube') && items.some((t) => t.startsWith('북마크:YouTube')) && items[items.length - 1] === '검색:"youtube" 검색', items);
        await shot(qw, `quick-search-${theme}.png`);

        await key('Enter');
        await sleep(300);
        let c = await calls();
        check('Enter on a tab switches to it', c.some((x) => x[0] === 'tabs.update' && x[1] === 4) && c.some((x) => x[0] === 'windows.update'), c.map((x) => x[0]));

        await qw.webContents.executeJavaScript(`window.__calls.length = 0`);
        await qw.loadURL(`${base}/modules/quick/quick.html#keep`);
        await qw.webContents.executeJavaScript(`window.close = () => { window.__closed = true; }; import(chrome.runtime.getURL('modules/quick/background.js')).then(() => 0)`);
        await sleep(500);
        await type('example.com/path');
        items = await text();
        check('an address becomes an "open" row on top', items[0] && items[0].startsWith('열기:https://example.com/path'), items[0]);
        await key('Enter', ', ctrlKey: true');
        await sleep(300);
        c = await calls();
        check('Ctrl+Enter opens it in a new tab', c.some((x) => x[0] === 'tabs.create' && x[1].url === 'https://example.com/path'), c.map((x) => x[0]));

        await qw.loadURL(`${base}/modules/quick/quick.html#keep`);
        await qw.webContents.executeJavaScript(`window.close = () => { window.__closed = true; }; import(chrome.runtime.getURL('modules/quick/background.js')).then(() => 0)`);
        await sleep(500);
        await type('업무');
        items = await text();
        check('workspaces are searchable', items.some((t) => t === '워크스페이스:업무'), items);
        qw.close();
        await sleep(250);
      }
      { // notes pane: create, edit, list, search, delete + undo (real pane code on the mocked storage)
        const nw = mk(380, 640);
        nw.webContents.on('console-message', (...a) => console.log('console', JSON.stringify(a.map((x) => (x && x.message) || x)).slice(0, 400)));
        await nw.loadURL(`${base}/modules/sidebar/panel.html#pane=%40notes`);
        await sleep(900);
        const ev = (code) => nw.webContents.executeJavaScript(code);
        const log = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  notes pane: ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
        log('starts empty', (await ev(`document.querySelectorAll('.note-card').length`)) === 0);
        await ev(`document.querySelector('.pane-bar .ibtn.primary').click()`);
        await sleep(300);
        await ev(`(() => { const a = document.querySelector('.note-body'); a.value = '장보기 목록\\n우유, 달걀, 바나나'; a.dispatchEvent(new Event('input')); })()`);
        await sleep(600);
        log('typing saves the note', ((await ev(`chrome.storage.local.get('notes')`)).notes || []).length === 1);
        await shot(nw, `notes-editor-${theme}.png`);
        await ev(`[...document.querySelectorAll('.chip.nav')].find((b) => b.textContent.includes('목록')).click()`);
        await sleep(300);
        const titles = await ev(`[...document.querySelectorAll('.note-title')].map((n) => n.textContent)`);
        log('list shows the title (first line)', titles[0] === '장보기 목록', titles);
        await ev(`document.querySelector('.pane-bar .ibtn.primary').click()`);
        await sleep(200);
        await ev(`[...document.querySelectorAll('.chip.nav')].find((b) => b.textContent.includes('목록')).click()`);
        await sleep(300);
        log('a note left empty is not kept', (await ev(`document.querySelectorAll('.note-card').length`)) === 1);
        await ev(`(() => { const i = document.querySelector('.search-input'); i.value = '달걀'; i.dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        log('search looks into the body', (await ev(`document.querySelectorAll('.note-card').length`)) === 1);
        await ev(`(() => { const i = document.querySelector('.search-input'); i.value = '없는말'; i.dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        log('search with no hit shows the empty state', (await ev(`document.querySelectorAll('.note-card').length`)) === 0);
        await ev(`(() => { const i = document.querySelector('.search-input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
        await sleep(300);
        await shot(nw, `notes-list-${theme}.png`);
        await ev(`document.querySelector('.note-card .ibtn').click()`);
        await sleep(400);
        log('delete removes it', ((await ev(`chrome.storage.local.get('notes')`)).notes || []).length === 0);
        await ev(`document.querySelector('.toast-act').click()`);
        await sleep(400);
        log('undo brings it back', ((await ev(`chrome.storage.local.get('notes')`)).notes || []).length === 1);
        nw.close();
        await sleep(250);
      }
      { // reading list pane
        const rw2 = mk(380, 560);
        await rw2.loadURL(`${base}/modules/sidebar/panel.html#pane=%40readinglist`);
        await sleep(900);
        const ev = (code) => rw2.webContents.executeJavaScript(code);
        const log = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  reading list: ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
        let titles = await ev(`[...document.querySelectorAll('.row-title')].map((n) => n.textContent)`);
        log('unread entries come first', titles.length === 3 && titles[2] === '이미 읽은 글 B', titles);
        await shot(rw2, `readinglist-${theme}.png`);
        await ev(`[...document.querySelectorAll('.chip.nav')].find((b) => b.textContent.includes('안 읽음')).click()`);
        await sleep(300);
        log('the unread filter hides read entries', (await ev(`document.querySelectorAll('.row').length`)) === 2);
        await ev(`document.querySelector('.pane-bar .ibtn.primary').click()`);
        await sleep(400);
        const calls = await ev(`window.__calls.filter((c) => c[0] === 'readingList.add').length`);
        log('the + button adds the current page', calls === 1, calls);
        rw2.close();
        await sleep(250);
      }
      { // reader mode: extraction + overlay, against an article page
        const aw = mk(960, 640);
        await aw.loadURL(`${base}/mock-article`);
        const ev = (code) => aw.webContents.executeJavaScript(code);
        const log = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  reader: ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
        await ev(require("node:fs").readFileSync(path.join(ROOT, "modules", "tools", "page.js"), "utf8").replace(/^/, "") + "\n0");
        const art = await ev(`window.__fjordReader.extractArticle()`);
        log('finds the article, its title and author', art && art.title === '피오르드에서 보낸 하루' && art.byline === '홍길동' && art.site === '예시 블로그', art && { t: art.title, b: art.byline });
        log('keeps the paragraphs and the quote', art && art.html.includes('3번째 문단') && art.html.includes('인용문'));
        log('drops the menu, ads and footer', art && !art.html.includes('메뉴메뉴') && !art.html.includes('광고광고') && !art.html.includes('푸터'));
        await ev(`chrome.runtime.sendMessage({ type: 'tools:reader' }).then(() => 0)`);
        await sleep(500);
        log('the overlay opens', await ev(`!!document.getElementById('fjord-reader')`));
        await shot(aw, `reader-${theme}.png`);
        await ev(`chrome.runtime.sendMessage({ type: 'tools:reader' }).then(() => 0)`);
        await sleep(200);
        log('and closes again', await ev(`!document.getElementById('fjord-reader')`));
        const plain = mk(600, 400);
        await plain.loadURL(`${base}/mock-video`);
        await plain.webContents.executeJavaScript(require("node:fs").readFileSync(path.join(ROOT, "modules", "tools", "page.js"), "utf8") + "\n0");
        const none = await plain.webContents.executeJavaScript(`window.__fjordReader.extractArticle()`);
        log('a page without an article is refused', none === null, none && none.title);
        plain.close();
        aw.close();
        await sleep(250);
      }
      { // video tools: speed strip, keys
        const vw = mk(900, 560);
        await vw.loadURL(`${base}/mock-video`);
        const ev = (code) => vw.webContents.executeJavaScript(code);
        const log = (name, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  video: ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
        await ev(require("node:fs").readFileSync(path.join(ROOT, "modules", "tools", "video.js"), "utf8") + "\n0");
        await ev(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 200, bubbles: true }))`);
        await sleep(400);
        log('the strip appears over the video', await ev(`!![...document.documentElement.children].find((el) => el.tagName === 'DIV' && el.style.zIndex === '2147483647')`));
        await shot(vw, `video-${theme}.png`);
        const key = (k) => ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
        await key(']');
        await key(']');
        log(']] speeds up to 1.5×', (await ev(`document.getElementById('v').playbackRate`)) === 1.5);
        await key('[');
        log('[ slows down by a step', (await ev(`document.getElementById('v').playbackRate`)) === 1.25);
        await key('\\');
        log('\\ resets', (await ev(`document.getElementById('v').playbackRate`)) === 1);
        vw.close();
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
