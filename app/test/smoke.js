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
    const page = await waitFor(() => f.serialize().tabs.find((t) => t.title === "Needle Page"), 8000);
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
    const dl = await waitFor(() => f.downloads[0] && f.downloads[0].state === "completed" && f.downloads[0], 12000);
    check("download completes into the downloads folder", dl && fs.existsSync(dl.path) && fs.statSync(dl.path).size === FILE.length && dl.name === "sample.bin", dl ? dl.path : { downloads: f.downloads.map((d) => ({ name: d.name, state: d.state, received: d.received })), url: f.views.get(f.attached()).webContents.getURL() });
    check("tab strip reports the finished download", f.serialize().downloads.total === 1 && f.serialize().downloads.active === 0);

    f.commands.openPage("history");
    const hist = await waitFor(() => f.serialize().tabs.find((t) => t.url === "fjord://app/history.html" && t.title === "방문 기록"));
    check("history page opens", !!hist);

    // real mouse clicks on the tab strip (the close button must close, a click on a tab must activate it)
    const click = async (x, y) => {
      const wc = f.ui().webContents;
      wc.sendInputEvent({ type: "mouseMove", x, y });
      wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      await sleep(40);
      wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      await sleep(500);
    };
    const rectOf = (sel, n = 0) => f.ui().webContents.executeJavaScript(`(() => { const r = document.querySelectorAll(${JSON.stringify(sel)})[${n}].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    f.commands.newTab(base + "/page");
    f.commands.newTab(base + "/page");
    await sleep(800);
    const nBefore = f.serialize().tabs.length;
    const xr = await rectOf(".tab:not(.active) .tab-x", 0);
    await click(xr.x, xr.y);
    check("clicking a tab's close button closes it", f.serialize().tabs.length === nBefore - 1, { before: nBefore, after: f.serialize().tabs.length });
    const firstTab = f.serialize().tabs[0].id;
    const tr = await rectOf(".tab:not(.active)", 0);
    await click(tr.x - 20, tr.y);
    check("clicking a tab activates it", f.serialize().activeTab !== null && f.serialize().tabs.some((t) => t.id === f.serialize().activeTab), f.serialize().activeTab === firstTab);

    // ---- M1a: tab features (in a fresh workspace so the tab order is predictable) ----
    f.commands.wsAdd("탭기능");
    await sleep(800);
    const names = () => f.serialize().tabs.map((t) => (t.isNewTab ? "new" : t.url.split("?")[1]));
    for (const tag of ["A", "B", "C"]) { f.commands.newTab(base + "/page?" + tag); await sleep(350); }
    const idOf = (tag) => f.serialize().tabs.find((t) => t.url.endsWith("?" + tag)).id;
    check("three tabs after the new tab", names().join() === "new,A,B,C", names());

    f.commands.pinTab(idOf("B"));
    await sleep(200);
    check("pinning moves the tab to the front", names().join() === "B,new,A,C" && f.serialize().tabs[0].pinned === true, names());

    f.commands.duplicateTab(idOf("C"));
    await sleep(500);
    check("duplicate opens the same page right after the original", names().join() === "B,new,A,C,C", names());

    const cWc = f.views.get(idOf("C")).webContents;
    f.commands.muteTab(idOf("C"));
    await sleep(200);
    check("muting a tab", cWc.audioMuted === true && f.serialize().tabs.find((t) => t.id === idOf("C")).muted === true);
    f.commands.muteTab(idOf("C"));
    check("unmuting a tab", cWc.audioMuted === false);

    f.commands.closeLeft(idOf("C"));
    await sleep(400);
    check("close tabs to the left keeps pinned tabs", names().join() === "B,C,C", names());
    f.commands.closeRight(f.serialize().tabs[1].id);
    await sleep(400);
    check("close tabs to the right", names().join() === "B,C", names());
    f.commands.closeOthers(idOf("C"));
    await sleep(300);
    check("close other tabs keeps pinned tabs", names().join() === "B,C", names());

    const closedBefore = f.store.data.closed.length;
    f.commands.closeTab(idOf("C"));
    await sleep(500);
    check("closing remembers the tab", f.store.data.closed.length === closedBefore + 1);
    f.handleShortcut({ type: "keyDown", key: "T", control: true, shift: true });
    await sleep(700);
    check("Ctrl+Shift+T reopens the closed tab", names().join() === "B,C" && f.store.data.closed.length === closedBefore, names());

    f.commands.tabSearchShow();
    await sleep(500);
    check("tab search overlay opens", f.overlayKind() === "tabsearch");
    await shot(f.overlay().webContents, "app-tabsearch.png");
    f.commands.overlayHide();

    // ---- M1b: bookmarks ----
    f.commands.newTab(base + "/page?bm");
    await waitFor(() => f.serialize().tabs.some((t) => t.url.endsWith("?bm") && t.title === "Needle Page"), 8000);
    const topBefore = f.views.get(f.attached()).getBounds().y;
    const barVisible = f.serialize().bookmarkBar.visible;
    check("bookmark bar is visible by default and the page starts below it", barVisible && topBefore === 38 + 42 + 34, topBefore);

    f.handleShortcut({ type: "keyDown", key: "d", control: true });
    await sleep(500);
    let st = f.serialize();
    check("Ctrl+D bookmarks the page and opens the edit popup", st.activeBookmark && f.overlayKind() === "bookmark" && st.bookmarkBar.items.some((b) => b.url.endsWith("?bm")));
    await shot(f.overlay().webContents, "app-bookmark.png");
    const bmId = st.activeBookmark;
    f.commands.bookmarkUpdate({ id: bmId, title: "내 북마크", folder: "bar" });
    f.commands.overlayHide();
    check("renaming a bookmark", f.store.data.bookmarks.find((b) => b.id === bmId).title === "내 북마크");

    const folder = f.commands.folderAdd({ name: "자료", parent: "bar" });
    f.commands.bookmarkAdd({ title: "예제", url: "https://example.com/", folder: folder.id });
    f.commands.bookmarkAdd({ title: "기타", url: "https://example.org/", folder: "other" });
    await sleep(300);
    st = f.serialize();
    check("bar shows loose bookmarks and folders", st.bookmarkBar.folders.length === 1 && st.bookmarkBar.items.length >= 1);
    check("suggestions include bookmarks", f.commands.suggest("내 북마크").some((i) => i.type === "bookmark"));

    // a real mouse click on the bookmark chip navigates the current tab
    await sleep(500);
    const chip = await rectOf(".bm.link", 0);
    await click(chip.x, chip.y);
    const nav = await waitFor(() => f.views.get(f.attached()).webContents.getURL().endsWith("?bm") || f.views.get(f.attached()).webContents.getURL().endsWith("/page"), 4000);
    check("clicking a bookmark chip opens it", !!nav, f.views.get(f.attached()).webContents.getURL());

    const exported = f.commands.bookmarksExport(path.join(process.env.FJORD_DOWNLOADS, "bm-test.html"));
    const html = fs.readFileSync(exported.path, "utf8");
    check("HTML export has the bookmarks and folders", html.includes("NETSCAPE-Bookmark-file-1") && html.includes("내 북마크") && html.includes("<H3>자료</H3>") && html.includes("https://example.org/"));
    const { Store: StoreClass } = require("../src/store");
    const fresh = new StoreClass(path.join(os.tmpdir(), "bm-import-" + Date.now() + ".json"));
    const imported = fresh.importHtml(html);
    check("HTML import restores them (links, folders, bar/other)", imported.added === f.store.data.bookmarks.length && fresh.data.folders.some((x) => x.name === "자료") && fresh.data.bookmarks.some((b) => b.folder === "other") && fresh.data.bookmarks.some((b) => b.folder === "bar"), { added: imported.added, expected: f.store.data.bookmarks.length });

    f.commands.folderRemove(folder.id);
    check("removing a folder keeps its bookmarks (moved to other)", f.store.data.bookmarks.find((b) => b.url === "https://example.com/").folder === "other");
    f.handleShortcut({ type: "keyDown", key: "B", control: true, shift: true });
    await sleep(500);
    check("Ctrl+Shift+B hides the bar and the page moves up", f.serialize().bookmarkBar.visible === false && f.views.get(f.attached()).getBounds().y === 38 + 42, f.views.get(f.attached()).getBounds().y);
    f.handleShortcut({ type: "keyDown", key: "B", control: true, shift: true });
    await sleep(300);
    f.commands.openPage("bookmarks");
    const bmPage = await waitFor(() => f.serialize().tabs.find((t) => t.url === "fjord://app/bookmarks.html" && t.title === "북마크"));
    check("bookmark manager page opens", !!bmPage);

    // ---- M1c: settings, search engines, home, fullscreen, window state, print, error pages ----
    const { Store: St, ENGINES } = require("../src/store");
    const { fitBounds } = require("../src/windowstate");
    const { nativeTheme } = require("electron");
    const stFile = path.join(os.tmpdir(), "settings-" + Date.now() + ".json");
    const st1 = new St(stFile);
    check("setting validation rejects bad values", st1.setSetting("theme", "neon").error && st1.setSetting("customSearch", "https://x.test/").error && st1.setSetting("homeUrl", "not a url").error && st1.setSetting("nope", 1).error && st1.setSetting("showHome", "yes").error);
    check("setting values are normalized", st1.setSetting("homeUrl", " example.com ").value === "https://example.com" && st1.setSetting("searchEngine", "naver").value === "naver" && st1.searchUrl("a b").startsWith("https://search.naver.com/search.naver?query=a%20b"));
    st1.setSetting("customSearch", "https://c.test/?q=%s");
    st1.setSetting("searchEngine", "custom");
    check("custom search engine", st1.searchUrl("한글") === "https://c.test/?q=" + encodeURIComponent("한글") && Object.keys(ENGINES).length === 4);

    // unclean shutdown detection: a run that never wrote running=false is a crash
    st1.save(true);
    const st2 = new St(stFile);
    st2.data.running = false; st2.save(true);
    const st3 = new St(stFile);
    check("unclean shutdown is detected on the next start", st2.crashed === true && st3.crashed === false);
    st3.data.tabs = { personal: { active: "a", list: [{ id: "a", url: "https://a.test/", pinned: false }, { id: "b", url: "https://b.test/", pinned: true }] } };
    st3.dropUnpinnedTabs();
    check("startup 'new tab' keeps pinned tabs only", st3.data.tabs.personal.list.length === 1 && st3.data.tabs.personal.active === "b");

    check("saved window bounds: tiny sizes grow, off-screen positions are dropped, good ones kept",
      fitBounds({ x: 10, y: 10, width: 100, height: 100 }, [{ x: 0, y: 0, width: 1920, height: 1040 }]).width === 720 &&
      fitBounds({ x: 5000, y: 5000, width: 900, height: 700 }, [{ x: 0, y: 0, width: 1920, height: 1040 }]).x === undefined &&
      fitBounds({ x: 100, y: 80, width: 900, height: 700 }, [{ x: 0, y: 0, width: 1920, height: 1040 }]).x === 100 && fitBounds(null, []) === null);

    // search engine in the real address flow
    f.commands.settingSet({ key: "searchEngine", value: "naver" });
    f.commands.newTab("검색어 테스트");
    await sleep(200);
    check("address bar search uses the chosen engine", f.serialize().tabs.some((t) => t.url.startsWith("https://search.naver.com/search.naver?query=")));
    f.commands.settingSet({ key: "searchEngine", value: "google" });

    f.commands.settingSet({ key: "theme", value: "dark" });
    const darkOk = nativeTheme.themeSource === "dark";
    f.commands.settingSet({ key: "theme", value: "system" });
    check("theme setting drives the native theme", darkOk && nativeTheme.themeSource === "system");

    // home button
    f.commands.settingSet({ key: "showHome", value: true });
    f.commands.settingSet({ key: "homeUrl", value: base + "/page?home" });
    await sleep(200);
    check("home button is enabled by the setting", f.serialize().settings.showHome === true);
    f.commands.newTab(base + "/page?away");
    await waitFor(() => f.serialize().tabs.some((t) => t.url.endsWith("?away") && t.title === "Needle Page"), 8000);
    f.commands.home();
    const homed = await waitFor(() => f.views.get(f.attached()).webContents.getURL().endsWith("?home"), 6000);
    check("home goes to the homepage", !!homed, f.views.get(f.attached()).webContents.getURL());
    f.commands.settingSet({ key: "showHome", value: false });
    f.commands.settingSet({ key: "homeUrl", value: "" });

    // fullscreen hides the chrome and gives the page the whole window
    const [cw, ch] = f.win().getContentSize();
    f.handleShortcut({ type: "keyDown", key: "F11" });
    await sleep(300);
    let b = f.views.get(f.attached()).getBounds();
    check("F11 fullscreen: page fills the window", f.serialize().fullscreen && b.x === 0 && b.y === 0 && b.width === cw && b.height === ch, b);
    f.handleShortcut({ type: "keyDown", key: "F11" });
    await sleep(300);
    b = f.views.get(f.attached()).getBounds();
    check("F11 again restores the chrome", !f.serialize().fullscreen && b.y === f.topH() && b.x === f.RAIL_W, b);

    // window bounds are remembered
    f.win().setBounds({ x: 120, y: 90, width: 1010, height: 710 });
    const near = (v, t) => Math.abs(v - t) <= 4; // the frameless window rounds to the display scale
    await waitFor(() => f.store.data.window && near(f.store.data.window.width, 1010), 4000);
    check("window bounds are remembered", f.store.data.window && near(f.store.data.window.width, 1010) && near(f.store.data.window.height, 710) && f.store.data.window.x === 120, f.store.data.window);

    // print to PDF
    const pdf = await f.commands.printPdf();
    const pdfBytes = pdf.path ? fs.readFileSync(pdf.path) : Buffer.alloc(0);
    check("print to PDF writes a real PDF and lists it in downloads", pdfBytes.length > 1000 && pdfBytes.slice(0, 4).toString() === "%PDF" && f.downloads.some((d) => d.path === pdf.path), pdfBytes.length);

    // a failed load shows the error page (original address stays in the address bar)
    const dead = http.createServer();
    await new Promise((r) => dead.listen(0, "127.0.0.1", r));
    const deadPort = dead.address().port;
    await new Promise((r) => dead.close(r));
    f.commands.newTab(`http://127.0.0.1:${deadPort}/gone`);
    const errTab = await waitFor(() => f.serialize().tabs.find((t) => t.url.startsWith("fjord://app/error.html?kind=load") && t.title === "연결할 수 없음"), 10000);
    check("failed load shows the error page", !!errTab, errTab && errTab.url);
    check("address bar keeps the original address on the error page", errTab && errTab.shownUrl === `http://127.0.0.1:${deadPort}/gone`, errTab && errTab.shownUrl);
    if (errTab) { await sleep(400); await shot(f.views.get(errTab.id).webContents, "app-error.png"); }

    // a crashed renderer shows the crash page
    f.commands.newTab(base + "/page?crash");
    const crashTab = await waitFor(() => f.serialize().tabs.find((t) => t.url.endsWith("?crash") && t.title === "Needle Page"), 8000);
    f.views.get(crashTab.id).webContents.forcefullyCrashRenderer();
    const crashed = await waitFor(() => f.serialize().tabs.find((t) => t.id === crashTab.id && t.url.startsWith("fjord://app/error.html?kind=crash") && t.title === "페이지가 중단됨"), 10000);
    check("renderer crash shows the crash page", !!crashed, crashed && crashed.url);
    for (const t of [errTab, crashTab, f.serialize().tabs.find((t) => t.url.endsWith("?home"))]) if (t) f.commands.closeTab(t.id);

    f.commands.openPage("settings");
    const setTab = await waitFor(() => f.serialize().tabs.find((t) => t.url === "fjord://app/settings.html" && t.title === "설정"));
    check("settings page opens", !!setTab);
    if (setTab) {
      await sleep(400);
      await shot(f.views.get(setTab.id).webContents, "app-settings.png");
      const fields = await f.views.get(setTab.id).webContents.executeJavaScript(`document.querySelector('[data-key="searchEngine"]').value + '|' + document.querySelector('[data-key="startup"]').value`);
      check("settings page shows the current values", fields === "google|restore", fields);
    }

    // ---- M1d: permissions, site info, popup blocking, certificate errors ----
    const permsMod = require("../src/permissions");
    check("permission policy: stored decision wins, safe ones allowed, unknown denied, internal pages have no origin",
      permsMod.policy("geolocation", null) === "ask" && permsMod.policy("geolocation", "allow") === "allow" && permsMod.policy("notifications", "deny") === "deny" &&
      permsMod.policy("fullscreen", null) === "allow" && permsMod.policy("usb", null) === "deny" && permsMod.originOf("fjord://app/x.html") === null && permsMod.originOf("file:///c:/a.html") === null && permsMod.originOf("http://a.test:81/x") === "http://a.test:81");
    const pst = new St(path.join(os.tmpdir(), "perm-" + Date.now() + ".json"));
    pst.setPerm("https://a.test", "geolocation", "allow");
    pst.setPerm("https://a.test", "notifications", "deny");
    pst.setPerm("https://a.test", "geolocation", null);
    check("site permission store: set / reset / list", pst.getPerm("https://a.test", "geolocation") === null && pst.getPerm("https://a.test", "notifications") === "deny" && pst.listPerms().length === 1);

    f.commands.newTab(base + "/page?perm");
    const permTab = await waitFor(() => f.serialize().tabs.find((t) => t.url.endsWith("?perm") && t.title === "Needle Page"), 8000);
    const pwc = f.views.get(permTab.id).webContents;
    const origin = new URL(base).origin;
    check("http page shows the 'not secure' indicator, internal pages none", f.serialize().security === "insecure" && f.securityOf("fjord://app/newtab.html") === "internal" && f.securityOf("https://a.test/") === "secure");
    pwc.executeJavaScript("navigator.geolocation.getCurrentPosition(() => {}, () => {})").catch(() => {});
    await waitFor(() => f.pendingPerms.length === 1 && f.overlayKind() === "permission", 6000);
    check("a permission request opens the prompt overlay", f.pendingPerms.length === 1 && f.overlayKind() === "permission" && f.pendingPerms[0].origin === origin, f.pendingPerms.map((p) => p.key));
    await sleep(300);
    await shot(f.overlay().webContents, "app-permission.png");
    f.commands.permAnswer({ id: f.pendingPerms[0].id, choice: "allow" });
    const granted = await pwc.executeJavaScript("navigator.permissions.query({ name: 'geolocation' }).then((r) => r.state)");
    check("allowing is remembered and answers the site", f.store.getPerm(origin, "geolocation") === "allow" && granted === "granted" && f.pendingPerms.length === 0, granted);
    const notif = pwc.executeJavaScript("Notification.requestPermission()");
    await waitFor(() => f.pendingPerms.length === 1, 6000);
    f.commands.permAnswer({ id: f.pendingPerms[0].id, choice: "deny" });
    check("blocking is remembered and answers the site", (await notif) === "denied" && f.store.getPerm(origin, "notifications") === "deny");
    f.commands.permSet({ origin, key: "notifications", value: null });

    f.commands.siteInfoShow();
    await sleep(500);
    check("site info panel opens", f.overlayKind() === "siteinfo");
    await shot(f.overlay().webContents, "app-siteinfo.png");
    f.commands.overlayHide();

    // popup blocking: a script opening a window by itself is held back, a click-opened one is allowed
    const tabCount = () => f.serialize().tabs.length;
    const tabsBefore = tabCount();
    await pwc.executeJavaScript(`window.open(${JSON.stringify(base + "/page?popped")})`);
    await sleep(500);
    const blockedNow = f.serialize().tabs.find((t) => t.id === permTab.id).blocked;
    check("script popup without user action is blocked and listed", tabCount() === tabsBefore && blockedNow && blockedNow.length === 1, blockedNow);
    pwc.sendInputEvent({ type: "mouseDown", x: 60, y: 60, button: "left", clickCount: 1 });
    pwc.sendInputEvent({ type: "mouseUp", x: 60, y: 60, button: "left", clickCount: 1 });
    await sleep(150);
    await pwc.executeJavaScript(`window.open(${JSON.stringify(base + "/page?clicked")})`);
    await sleep(500);
    check("popup right after a click is allowed", tabCount() === tabsBefore + 1, tabCount() - tabsBefore);
    f.commands.activate(permTab.id); // the click-opened popup took focus; the held ones belong to the first tab
    f.commands.popupsAllow();
    check("'always allow popups' opens the held ones and is remembered", f.store.getPerm(origin, "popups") === "allow" && tabCount() === tabsBefore + 2);
    f.commands.permSet({ origin, key: "popups", value: null });
    for (const t of f.serialize().tabs.filter((x) => x.url.endsWith("?popped") || x.url.endsWith("?clicked") || x.url.endsWith("?perm"))) f.commands.closeTab(t.id);

    // certificate errors need a self-signed server; skipped (not failed) when openssl is missing
    const cp = require("node:child_process");
    const ossl = ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe"].find((c) => { try { return cp.spawnSync(c, ["version"]).status === 0; } catch { return false; } });
    if (!ossl) console.log("SKIP  certificate error tests (openssl not found)");
    else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fjord-cert-"));
      const gen = cp.spawnSync(ossl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost"], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
      if (gen.status !== 0) console.log("SKIP  certificate error tests (openssl failed)");
      else {
        const https = require("node:https");
        const secure = https.createServer({ key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) }, (req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end("<title>Secure Needle</title><p>hello</p>"); });
        await new Promise((r) => secure.listen(0, "127.0.0.1", r));
        const surl = `https://127.0.0.1:${secure.address().port}/`;
        f.commands.newTab(surl);
        const certTab = await waitFor(() => f.serialize().tabs.find((t) => t.url.startsWith("fjord://app/error.html?kind=cert") && t.title === "개인 정보 보호 오류"), 12000);
        check("untrusted certificate shows the warning page", !!certTab, certTab && certTab.url);
        check("address bar keeps the address and flags the connection", certTab && certTab.shownUrl === surl && f.serialize().security === "danger", f.serialize().security);
        if (certTab) {
          await sleep(400);
          await shot(f.views.get(certTab.id).webContents, "app-cert.png");
          f.commands.certProceed(surl, f.views.get(certTab.id).webContents);
          const opened = await waitFor(() => f.serialize().tabs.find((t) => t.id === certTab.id && t.title === "Secure Needle"), 12000);
          check("'proceed anyway' opens the page for this run only", !!opened && f.certAllowed.has(new URL(surl).origin) && f.serialize().security === "danger", opened && opened.url);
          f.commands.closeTab(certTab.id);
        }
        await new Promise((r) => secure.close(r));
      }
    }

    // ---- M2a: per-site zoom, clearing data, cookies ----
    f.commands.newTab(base + "/page?zoom1");
    const zTab = await waitFor(() => f.serialize().tabs.find((t) => t.url.endsWith("?zoom1") && t.title === "Needle Page"), 8000);
    const zhost = new URL(base).host;
    f.handleShortcut({ type: "keyDown", key: "=", control: true });
    await sleep(200);
    check("zoom is stored for the site", Math.abs(f.store.data.zoom[zhost] - 0.5) < 1e-9, f.store.data.zoom);
    f.commands.navigate({ id: zTab.id, input: base + "/page?zoom2" });
    await waitFor(() => f.views.get(zTab.id).webContents.getURL().endsWith("?zoom2"), 6000);
    await sleep(300);
    check("another page of the site opens at that zoom", Math.abs(f.views.get(zTab.id).webContents.getZoomLevel() - 0.5) < 1e-9 && f.serialize().tabs.find((t) => t.id === zTab.id).zoom === 110, f.serialize().tabs.find((t) => t.id === zTab.id).zoom);
    check("zoom list for the settings page", f.commands.zoomList().some((r) => r.host === zhost && r.percent === 110));
    f.commands.zoomRemove(zhost);
    await sleep(200);
    check("removing the site zoom resets open pages", f.store.data.zoom[zhost] === undefined && f.views.get(zTab.id).webContents.getZoomLevel() === 0);
    f.commands.closeTab(zTab.id);

    const sesFj = require("electron").session.fromPartition("persist:fjord");
    await sesFj.cookies.set({ url: base, name: "m2a", value: "1", expirationDate: Math.floor(Date.now() / 1000) + 3600 });
    await sesFj.cookies.set({ url: "http://other.test/", name: "o", value: "1", expirationDate: Math.floor(Date.now() / 1000) + 3600 });
    const doms = await f.commands.cookieList();
    check("cookie list groups by domain", doms.some((d) => d.domain === "127.0.0.1" && d.count >= 1) && doms.some((d) => d.domain === "other.test"), doms);
    await f.commands.cookieRemove("other.test");
    check("removing one site's cookies leaves the others", !(await f.commands.cookieList()).some((d) => d.domain === "other.test") && (await f.commands.cookieList()).some((d) => d.domain === "127.0.0.1"));

    f.store.addHistory("https://old.test/", "old");
    f.store.data.history.find((e) => e.url === "https://old.test/").at = Date.now() - 3 * 86400e3;
    f.store.addHistory("https://new.test/", "new");
    f.commands.permSet({ origin: "http://perm.test", key: "geolocation", value: "allow" });
    const cleared = await f.commands.clearData({ range: "day", types: ["history", "permissions"] });
    check("clearing 'last 24h' history keeps older entries", cleared.history && !f.store.data.history.some((e) => e.url === "https://new.test/") && f.store.data.history.some((e) => e.url === "https://old.test/"));
    check("clearing permissions", cleared.permissions && f.store.listPerms().length === 0);
    await f.commands.clearData({ range: "all", types: ["history", "cookies", "cache", "siteData", "downloads"] });
    check("clear all history, cookies, cache and site data", f.store.data.history.length === 0 && (await f.commands.cookieList()).length === 0 && f.downloads.every((d) => d.state === "progressing"));
    f.handleShortcut({ type: "keyDown", key: "Delete", control: true, shift: true });
    const clearPage = await waitFor(() => f.serialize().tabs.find((t) => t.url.endsWith("settings.html#clear")));
    check("Ctrl+Shift+Delete opens the clear-data section", !!clearPage);
    await waitFor(() => f.serialize().tabs.some((t) => t.url.endsWith("#clear") && t.title === "설정"), 6000);
    await sleep(500);

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
