// Smoke test: runs the real app with a hidden window (never pops anything on the desktop), drives the commands
// and saves screenshots to ../logs. Usage: npm run smoke
process.env.FJORD_TEST = "1";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
process.env.FJORD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fjord-smoke-"));
process.env.FJORD_DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "fjord-dl-"));
const http = require("node:http");

const { app } = require("electron");
require("../src/main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(logs, { recursive: true });
const checks = [];
const check = (name, ok, extra) => { checks.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); };

async function shot(webContents, file) {
  let lastError;
  for (let i = 0; i < 8; i++) { // the surface of a freshly shown window is not always ready
    try {
      const img = await webContents.capturePage();
      if (!img.isEmpty()) {
        fs.writeFileSync(path.join(logs, file), img.toPNG());
        return img.getSize();
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(500);
  }
  throw lastError || new Error("empty capture");
}

// local server: a page with a known word count and a downloadable file
const FILE = Buffer.alloc(4096, 7);
const server = http.createServer((req, res) => {
  if (req.url === "/file.bin") {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="sample.bin"', "content-length": FILE.length });
    res.end(FILE);
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<title>Needle Page</title><body><p>needle one</p><p>another needle</p><p>last needle here</p>");
  }
});

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}

app.whenReady().then(async () => {
  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    await sleep(2500);
    const f = global.__fjord;
    // find-in-page and capturing need a shown window: fully transparent, off the taskbar, unfocused -> nothing visible
    f.win().setSkipTaskbar(true);
    f.win().setOpacity(0);
    f.win().showInactive();
    await sleep(800);
    let s = f.serialize();
    check("starts with a new tab in the first workspace", s.tabs.length === 1 && s.tabs[0].isNewTab && s.activeWs === "personal", { ws: s.activeWs, tabs: s.tabs.length });

    f.commands.newTab("data:text/html,<title>Hello Fjord</title><body style='background:%23264;color:%23fff;font:32px sans-serif'><h1>Hello Fjord</h1>");
    await waitFor(() => f.serialize().tabs.some((t) => t.title === "Hello Fjord"));
    s = f.serialize();
    check("opening a page adds an active tab with its title", s.tabs.length === 2 && s.tabs[1].title === "Hello Fjord" && s.activeTab === s.tabs[1].id, s.tabs.map((t) => t.title || (t.isNewTab ? "(new tab)" : t.url)));

    f.commands.newTab("data:text/html,<title>Second</title><body style='background:%23623;color:%23fff;font:32px sans-serif'><h1>Second</h1>");
    await sleep(1000);
    check("three tabs", f.serialize().tabs.length === 3);

    f.commands.wsSwitch("work");
    await sleep(1200);
    s = f.serialize();
    check("switching workspace shows that workspace's own tabs", s.activeWs === "work" && s.tabs.length === 1 && s.tabs[0].isNewTab, { ws: s.activeWs, tabs: s.tabs.length });
    check("the workspace counts are kept", s.workspaces.find((w) => w.id === "personal").count === 3);

    f.commands.wsSwitch("personal");
    await sleep(800);
    s = f.serialize();
    check("back in the first workspace the old tabs are still there", s.tabs.length === 3 && s.activeWs === "personal");

    const target = s.tabs[1].id;
    f.commands.moveTab({ id: target, ws: "work" });
    await sleep(600);
    check("moving a tab to another workspace", f.serialize().tabs.length === 2 && f.store.tabsOf("work").list.length === 2);

    f.commands.closeTab(f.serialize().activeTab);
    await sleep(500);
    check("closing a tab selects a neighbour", f.serialize().tabs.length === 1 && !!f.serialize().activeTab);

    const addRes = f.commands.wsAdd("공부");
    await sleep(800);
    s = f.serialize();
    check("adding a workspace switches to it with a fresh tab", !addRes.error && s.workspaces.length === 3 && s.tabs.length === 1);

    // ---- browser basics ----
    f.commands.newTab(base + "/page");
    await sleep(1500);
    const page = f.serialize().tabs.find((t) => t.title === "Needle Page");
    check("loads a real http page", !!page, page && page.url);
    check("history records the visit", f.store.data.history.some((h) => h.url === base + "/page" && h.title === "Needle Page"));
    check("suggestions find it by title and by empty query", f.commands.suggest("needle").some((i) => i.url === base + "/page") && f.commands.suggest("").length >= 1);

    const wc = f.views.get(f.attached()).webContents;
    f.commands.findShow();
    await sleep(500);
    check("find bar overlay opens", f.overlayKind() === "find");
    // (the test window is never activated, so Chromium may drop the first find after focus moved: ask again once)
    let r = null;
    for (let attempt = 0; attempt < 3 && !r; attempt++) {
      const found = new Promise((resolve) => wc.once("found-in-page", (_e, res) => resolve(res)));
      await f.commands.find({ text: "needle", next: attempt > 0 });
      r = await Promise.race([found, sleep(1500).then(() => null)]);
    }
    check("find in page counts matches", r && r.matches === 3, r && r.matches);
    f.commands.overlayHide();
    check("overlay hides", f.overlayKind() === null);

    f.handleShortcut({ type: "keyDown", key: "=", control: true });
    f.handleShortcut({ type: "keyDown", key: "=", control: true });
    await sleep(300);
    check("Ctrl+= zooms in (120%)", wc.getZoomLevel() === 1 && f.serialize().tabs.find((t) => t.id === f.serialize().activeTab).zoom === 120, wc.getZoomLevel());
    f.handleShortcut({ type: "keyDown", key: "0", control: true });
    await sleep(200);
    check("Ctrl+0 resets zoom", wc.getZoomLevel() === 0);

    f.commands.overlayShow({ kind: "suggest", rect: { x: 100, y: 90, width: 500, height: 120 }, payload: { items: [{ type: "history", title: "t", url: "https://example.com/" }], index: 0 } });
    await sleep(400);
    check("suggestion overlay opens", f.overlayKind() === "suggest");
    f.commands.overlayHide();

    f.commands.navigate({ input: base + "/file.bin" });
    const dl = await waitFor(() => f.downloads[0] && f.downloads[0].state === "completed" && f.downloads[0]);
    check("download completes into the downloads folder", dl && fs.existsSync(dl.path) && fs.statSync(dl.path).size === FILE.length && dl.name === "sample.bin", dl && dl.path);
    check("tab strip reports the finished download", f.serialize().downloads.total === 1 && f.serialize().downloads.active === 0);

    f.commands.openPage("history");
    const hist = await waitFor(() => f.serialize().tabs.find((t) => t.url === "fjord://app/history.html" && t.title === "방문 기록"));
    check("history page opens", !!hist);

    // workspace prompt (drawn by the overlay, not a modal dialog hidden behind the page)
    f.commands.promptShow({ mode: "add" });
    await sleep(500);
    check("add-workspace prompt opens in the overlay", f.overlayKind() === "prompt");
    await shot(f.overlay().webContents, "app-prompt.png");
    const dup = f.commands.promptSubmit({ mode: "add", id: null, value: "개인" });
    check("a duplicate name keeps the prompt open with an error", dup.error && f.overlayKind() === "prompt", dup.error);
    const before = f.serialize().workspaces.length;
    const ok = f.commands.promptSubmit({ mode: "add", id: null, value: "프롬프트" });
    await sleep(600);
    check("submitting a new name adds the workspace and closes the prompt", !ok.error && f.serialize().workspaces.length === before + 1 && f.overlayKind() === null);
    const wsId = f.serialize().workspaces.find((w) => w.name === "프롬프트").id;
    f.commands.promptShow({ mode: "rename", id: wsId, name: "프롬프트" });
    await sleep(300);
    f.commands.promptSubmit({ mode: "rename", id: wsId, value: "이름바꿈" });
    check("rename through the prompt", f.serialize().workspaces.some((w) => w.id === wsId && w.name === "이름바꿈") && f.overlayKind() === null);

    // persistence
    f.store.save(true);
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.FJORD_USER_DATA, "state.json"), "utf8"));
    check("state is written to disk", saved.workspaces.length >= 4 && saved.workspaces.some((w) => w.name === "이름바꿈") && Object.keys(saved.tabs).length >= 2);

    f.commands.wsSwitch("personal");
    await sleep(1000);
    const w = f.win();
    // popups: suggestions and the downloads panel
    f.commands.overlayShow({ kind: "suggest", rect: { x: 200, y: 84, width: 640, height: 4 * 44 + 12 }, payload: { index: 1, items: [
      { type: "history", title: "Needle Page", url: base + "/page" }, { type: "pin", title: "GitHub", url: "https://github.com/" },
      { type: "history", title: "Hacker News", url: "https://news.ycombinator.com/" }, { type: "search", title: '"needle" 검색', url: "needle" } ] } });
    await sleep(900);
    await shot(f.overlay().webContents, "app-suggest.png");
    f.commands.downloadsPanel();
    await sleep(900);
    await shot(f.overlay().webContents, "app-downloads.png");
    f.commands.overlayHide();
    const uiSize = await shot(f.ui().webContents, "app-ui.png");
    const viewSize = await shot(f.views.get(f.attached()).webContents, "app-content.png");
    w.hide();
    check("screenshots captured", uiSize.width > 100 && viewSize.width > 100, { ui: uiSize, content: viewSize });
  } catch (e) {
    check("no exception", false, String(e && e.stack || e));
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${checks.length} checks passed`);
  server.close();
  app.exit(failed ? 1 : 0);
});
